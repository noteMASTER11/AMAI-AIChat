import http from 'node:http';
import path from 'node:path';
import { readFile, stat, open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { MonitorStore } from './monitor-store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export async function createMonitor({ runtime, dist = path.join(here, '../dashboard/dist'), interval = 1000 } = {}) {
  const config = JSON.parse(await readFile(path.join(here, 'config.json'), 'utf8'));
  runtime ||= process.env.AMAI_RUNTIME || config.runtime;
  const store = new MonitorStore();
  const clients = new Set();
  const startedAt = Date.now();
  let offset = 0, identity = null, carry = '', decoder = new StringDecoder('utf8');
  let state = null, installation = null, truncated = false, reading = false, readError = null;
  let limits = null;
  const logfile = path.join(runtime, 'bridge.jsonl');
  async function collect() {
    if (reading) return;
    reading = true;
    try {
      const info = await stat(logfile);
      if (identity !== info.ino || info.size < offset) {
        identity = info.ino; carry = ''; decoder = new StringDecoder('utf8');
        offset = Math.max(0, info.size - 8 * 1024 * 1024);
        truncated ||= offset > 0;
        if (offset > 0) {
          const fh = await open(logfile, 'r');
          try { const first = Buffer.alloc(65536); const { bytesRead } = await fh.read(first, 0, first.length, offset); const newline = first.subarray(0, bytesRead).indexOf(10); offset += newline >= 0 ? newline + 1 : bytesRead; }
          finally { await fh.close(); }
        }
      }
      if (info.size > offset) {
        const fh = await open(logfile, 'r');
        try {
          const size = Math.min(info.size - offset, 8 * 1024 * 1024);
          const buffer = Buffer.alloc(size); const { bytesRead } = await fh.read(buffer, 0, size, offset); offset += bytesRead;
          const lines = (carry + decoder.write(buffer.subarray(0, bytesRead))).split('\n'); carry = lines.pop();
          if (carry.length > 262144) carry = '';
          for (const line of lines) {
            if (line.length > 262144) continue;
            try {
              const entry = store.ingest(JSON.parse(line));
              if (entry?.kind === 'account-limits') limits = entry.data;
            } catch { /* A partial/bad diagnostic record cannot break the monitor. */ }
          }
        } finally { await fh.close(); }
      }
      readError = null;
    } catch (error) { if (error.code !== 'ENOENT') readError = error.message; }
    try { state = JSON.parse(await readFile(path.join(runtime, 'status.json'), 'utf8')); } catch { /* retain last atomic snapshot */ }
    try { installation = JSON.parse(await readFile(path.join(runtime, 'deployment.json'), 'utf8')); } catch { /* optional deployment status */ }
    reading = false;
  }
  function snapshot() {
    let alive = false;
    if (Number.isSafeInteger(state?.pid) && state.pid > 0) { try { process.kill(state.pid, 0); alive = true; } catch { /* offline */ } }
    // Restart context stays on disk; the UI already receives the journal separately.
    const { history, recentDialogue, ...publicState } = state || {};
    return {
      state: state ? publicState : null, installation, limits, summary: store.summary(),
      health: { alive, snapshotAgeMs: state ? Date.now() - Date.parse(state.updatedAt) : null, gameAgeMs: state?.transport?.lastHeartbeatAt ? Date.now() - state.transport.lastHeartbeatAt : null, error: readError },
      monitor: { startedAt, pid: process.pid, runtime, logBytesRead: offset, historyTruncated: truncated, retained: store.records.length, readonly: true },
    };
  }
  function sendUpdate(client, current, reset = false) {
    if (client.res.destroyed || client.res.writableEnded) { clients.delete(client); return; }
    // write(false) means this frame was accepted, but the buffer needs to drain.
    // Keep at most one frame queued and catch up from the journal after draining.
    if (client.blocked) return;
    reset ||= Boolean(store.records.length && client.cursor < store.records[0].id - 1);
    const records = reset ? store.records : store.records.filter(record => record.id > client.cursor);
    const body = JSON.stringify({ ...current, records, reset });
    try {
      const ready = client.res.write(`event: update\ndata: ${body}\n\n`);
      client.cursor = store.nextId;
      if (!ready) {
        client.blocked = true;
        client.res.once('drain', () => { client.blocked = false; });
      }
    } catch {
      clients.delete(client);
      client.res.destroy();
    }
  }
  await collect();
  const timer = setInterval(async () => {
    await collect();
    const current = snapshot();
    for (const client of clients) sendUpdate(client, current);
  }, interval);
  timer.unref();
  const server = http.createServer(async (req, res) => {
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
    const fail = (status, message) => { res.writeHead(status, headers); res.end(message); };
    if (req.method !== 'GET') return fail(405, 'Read-only monitor');
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host || '')) return fail(403, 'Loopback host required');
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return fail(403, 'Origin mismatch');
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/health') { res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ app: 'amai-flight-recorder', pid: process.pid })); }
    if (url.pathname.startsWith('/api/chunk/')) {
      const requestId = url.pathname.slice('/api/chunk/'.length);
      if (!/^[a-f0-9-]{36}$/.test(requestId)) return fail(400, 'Invalid request ID');
      const record = store.records.find(r => r.kind === 'model-request' && r.data?.requestId === requestId);
      if (!record?.data?.chunkFile) return fail(404, 'Chunk not captured');
      const root = path.resolve(runtime, 'chunks');
      const filename = path.resolve(record.data.chunkFile);
      const relative = path.relative(root, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return fail(403, 'Invalid chunk path');
      try {
        if ((await stat(filename)).size > 262144) return fail(413, 'Chunk too large');
        const body = await readFile(filename, 'utf8');
        res.writeHead(200, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(body);
      } catch { return fail(404, 'Chunk unavailable'); }
    }
    if (url.pathname === '/api/snapshot' || url.pathname === '/api/export') {
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...(url.pathname.endsWith('export') ? { 'Content-Disposition': 'attachment; filename="amai-flight-recorder.json"' } : {}) });
      return res.end(JSON.stringify({ ...snapshot(), records: store.records, exportedAt: new Date().toISOString() }));
    }
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      const client = { res, cursor: store.nextId, blocked: false }; clients.add(client);
      res.once('close', () => clients.delete(client));
      res.once('error', () => { clients.delete(client); res.destroy(); });
      sendUpdate(client, snapshot(), true); return;
    }
    try {
      const decoded = decodeURIComponent(url.pathname);
      const root = path.resolve(dist);
      const filename = path.resolve(root, decoded === '/' ? 'index.html' : '.' + decoded);
      const relative = path.relative(root, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return fail(403, 'Invalid path');
      const extension = path.extname(filename);
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[extension];
      if (!mime) return fail(404, 'Not found');
      const body = await readFile(filename);
      res.writeHead(200, { ...headers, 'Content-Type': mime, 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'" }); res.end(body);
    } catch { fail(404, 'Not found'); }
  });
  const close = () => { clearInterval(timer); for (const client of clients) client.res.end(); clients.clear(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };
  return { server, store, collect, snapshot, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const monitor = await createMonitor();
  const port = Number(process.env.AMAI_DASHBOARD_PORT || 8765);
  monitor.server.listen(port, '127.0.0.1', () => console.log(`AMAI monitor http://127.0.0.1:${port}`));
  monitor.server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await monitor.close(); });
}
