import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MonitorStore, normalizeUsage } from './monitor-store.mjs';
import { createMonitor } from './monitor-server.mjs';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';

const at = '2026-10-21T00:00:00.000Z';
const usage = (input, output) => ({ inputTokens: input, outputTokens: output, totalTokens: input + output, cachedInputTokens: 40, reasoningOutputTokens: 5 });
test('authoritative usage replaces repeated thread totals, without adding subsets twice', () => {
  const store = new MonitorStore();
  const add = (threadId, total) => store.ingest({ at, kind: 'token-usage', data: { threadId, total } });
  add('a', usage(100, 10)); add('a', usage(100, 10)); add('a', usage(120, 20)); add('b', usage(30, 10));
  assert.equal(store.summary().tokens.totalTokens, 180);
  assert.equal(store.summary().tokens.inputTokens, 150);
  assert.equal(store.summary().tokens.reasoningOutputTokens, 10);
  assert.equal(store.summary().tokens.requests, 2);
});
test('missing usage remains unknown, malformed counters never replace known data', () => {
  const store = new MonitorStore();
  assert.equal(store.summary().tokens.totalTokens, null);
  assert.equal(normalizeUsage({ inputTokens: -1, outputTokens: 1, totalTokens: 0 }), null);
  store.ingest({ at, kind: 'token-usage', data: { threadId: 'a', total: usage(100, 10) } });
  store.ingest({ at, kind: 'token-usage', data: { threadId: 'a', total: { inputTokens: 999 } } });
  assert.equal(store.summary().tokens.totalTokens, 110);
});
test('published replies are not counted as shown until the matching game acknowledgement', () => {
  const store = new MonitorStore();
  store.ingest({ at, kind: 'reply-published', data: { session: '123456', poll: 5, text: 'ДК', bot: 1, purpose: 'llm' } });
  assert.equal(store.summary().delivered, 0);
  store.ingest({ at, kind: 'reply-acknowledged', data: { session: '123456', poll: 6 } });
  assert.equal(store.summary().delivered, 0);
  store.ingest({ at, kind: 'reply-acknowledged', data: { session: '123456', poll: 5 } });
  assert.equal(store.summary().delivered, 1);
});
test('recent history is bounded while captured counters and monotonic IDs persist', () => {
  const store = new MonitorStore(3);
  for (let i = 0; i < 8; i++) store.ingest({ at, kind: 'game-event', data: { kind: 'chat', text: `строка ${i}` } });
  assert.equal(store.records.length, 3);
  assert.equal(store.records.at(-1).id, 8);
  assert.equal(store.summary().playerMessages, 8);
  assert.equal(store.ingest({ at: 'invalid', kind: 'game-event', data: {} }), null);
});

test('localhost API follows real JSONL appends, holds partial lines, and rejects foreign origins', async () => {
  const root = await mkdtemp('D:/ChatGPT/Temp/amai-monitor-test-');
  const dist = path.join(root, 'dist'); await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), '<html lang="ru">monitor</html>');
  await writeFile(path.join(root, 'bridge.jsonl'), JSON.stringify({ at, kind: 'game-event', data: { kind: 'chat', text: 'ДК привет' } }) + '\n');
  const monitor = await createMonitor({ runtime: root, dist, interval: 10000 });
  await new Promise(resolve => monitor.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${monitor.server.address().port}`;
  try {
    let body = await (await fetch(base + '/api/snapshot')).json();
    assert.equal(body.summary.playerMessages, 1);
    await appendFile(path.join(root, 'bridge.jsonl'), '{"at":');
    await monitor.collect(); assert.equal(monitor.store.records.length, 1);
    await appendFile(path.join(root, 'bridge.jsonl'), `"${at}","kind":"game-event","data":{"kind":"chat","text":"Лич"}}\n`);
    await monitor.collect();
    body = await (await fetch(base + '/api/snapshot')).json();
    assert.equal(body.summary.playerMessages, 2);
    assert.equal(body.records.at(-1).data.text, 'Лич');
    assert.equal((await fetch(base + '/api/snapshot', { headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await fetch(base + '/api/snapshot', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/%2e%2e%2fconfig.json')).status, 403);
    const page = await fetch(base + '/'); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const requestId = '12345678-1234-1234-1234-123456789012';
    const chunkRoot = path.join(root, 'chunks'); await mkdir(chunkRoot);
    const chunkFile = path.join(chunkRoot, 'event.txt'); await writeFile(chunkFile, 'current event: inventory');
    monitor.store.ingest({ at, kind: 'model-request', data: { requestId, chunkFile } });
    assert.equal(await (await fetch(base + '/api/chunk/' + requestId)).text(), 'current event: inventory');
    assert.equal((await fetch(base + '/api/chunk/not-a-request')).status, 400);
  } finally {
    await monitor.close();
    assert.ok(path.resolve(root).toLowerCase().startsWith(path.resolve('D:/ChatGPT/Temp/amai-monitor-test-').toLowerCase()));
    await rm(root, { recursive: true, force: true });
  }
});

test('large snapshots keep one SSE connection open and deliver later journal entries', { timeout: 10000 }, async () => {
  const root = await mkdtemp('D:/ChatGPT/Temp/amai-monitor-test-');
  const observations = [{ kind: 'inventory', text: 'предмет '.repeat(16000) }];
  await writeFile(path.join(root, 'status.json'), JSON.stringify({ observations, history: [{ text: 'internal restart context' }], recentDialogue: [{ text: 'internal dialogue memory' }] }));
  await writeFile(path.join(root, 'bridge.jsonl'), '');
  const monitor = await createMonitor({ runtime: root, interval: 30 });
  await new Promise(resolve => monitor.server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  let reader;
  try {
    const response = await fetch(`http://127.0.0.1:${monitor.server.address().port}/api/stream`, { signal: controller.signal });
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let carry = '', frames = 0, receivedLaterRecord = false;
    while (frames < 5 || !receivedLaterRecord) {
      const { value, done } = await reader.read();
      assert.equal(done, false, 'a full output buffer must not close the stream');
      carry += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = carry.indexOf('\n\n')) >= 0) {
        const frame = carry.slice(0, boundary); carry = carry.slice(boundary + 2);
        const payload = JSON.parse(frame.split('\ndata: ')[1]);
        assert.ok(Buffer.byteLength(frame) > 65536, 'exercise a snapshot larger than the stream buffer');
        assert.deepEqual(payload.state.observations, observations);
        assert.equal(payload.state.history, undefined, 'restart context should not duplicate the streamed journal');
        assert.equal(payload.state.recentDialogue, undefined, 'dialogue checkpoints should not duplicate the streamed journal');
        frames++;
        if (frames === 1) {
          assert.equal(payload.reset, true);
          await appendFile(path.join(root, 'bridge.jsonl'), JSON.stringify({ at, kind: 'game-event', data: { kind: 'chat', text: 'новая реплика' } }) + '\n');
        } else assert.equal(payload.reset, false);
        receivedLaterRecord ||= payload.records.some(record => record.data.text === 'новая реплика');
      }
    }
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    await monitor.close();
    assert.ok(path.resolve(root).toLowerCase().startsWith(path.resolve('D:/ChatGPT/Temp/amai-monitor-test-').toLowerCase()));
    await rm(root, { recursive: true, force: true });
  }
});
