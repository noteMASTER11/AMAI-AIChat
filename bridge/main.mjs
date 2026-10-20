import { readFile, writeFile, rename, mkdir, stat, readdir, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseEvents, makeReply, Inbox } from './protocol.mjs';
import { Scheduler } from './scheduler.mjs';
import { CodexClient } from './codex.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(here, 'config.json'), 'utf8'));
if (process.env.AMAI_MAILBOX) config.mailbox = process.env.AMAI_MAILBOX;
if (process.env.AMAI_RUNTIME) config.runtime = process.env.AMAI_RUNTIME;
const personas = JSON.parse(await readFile(path.join(here, 'personas.json'), 'utf8'));
const mode = process.argv.includes('--loopback') ? 'loopback' : 'llm';
await mkdir(config.mailbox, { recursive: true });
await mkdir(config.runtime, { recursive: true });
const lock = path.join(config.mailbox, 'bridge.lock');
// Single mailbox owner prevents two generators publishing the same poll file.
try {
  const previous = Number(await readFile(lock, 'utf8'));
  if (previous) { try { process.kill(previous, 0); throw new Error('Another bridge is running'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  await unlink(lock);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const handle = await open(lock, 'wx'); await handle.writeFile(String(process.pid)); await handle.close();
const logFile = path.join(config.runtime, 'bridge.jsonl');
const log = (kind, data) => {
  const record = JSON.stringify({ at: new Date().toISOString(), kind, data });
  console.log(record);
  // Sequential appends preserve diagnostic records; logs contain game text only.
  logChain = logChain.then(async () => { const fh = await open(logFile, 'a'); try { await fh.writeFile(record + '\n'); } finally { await fh.close(); } }).catch(() => {});
};
let logChain = Promise.resolve();
const inbox = new Inbox();
const scheduler = new Scheduler(config);
const client = new CodexClient(config, log);
const bots = new Map();
let history = [];
let tick = null;
let lastFile = '';
let cursor = 0;
let running = true;
let generation = null;
let modelReady = false;
let verified = false;
let probe = null;
let publishedPoll = -1;
let attempts = 0;
let lastCleanup = 0;
let nextModelAttempt = 0;

const stop = () => { running = false; };
process.on('SIGINT', stop); process.on('SIGTERM', stop);

function chooseBot(text) {
  const list = [...bots.values()];
  if (!list.length) return null;
  return list.find(bot => text.toLowerCase().includes(bot.name.toLowerCase())) || list[cursor++ % list.length];
}

async function publish(event, bot, text) {
  if (!tick || event.session !== inbox.session || Date.now() - tick.wall > 3000) throw new Error('No live game heartbeat');
  const target = Math.max(tick.unitType + 4, publishedPoll + 1);
  const filename = path.join(config.mailbox, `reply-${event.session}-${target}.pld`);
  const temporary = filename + '.tmp';
  await writeFile(temporary, makeReply(event.session, event.seq, bot, text), 'utf8');
  await rename(temporary, filename);
  publishedPoll = target;
  log('reply-published', { session: event.session, seq: event.seq, bot, poll: target, text });
}

async function generateOne(event) {
  const bot = bots.get(event.bot);
  let shown = false;
  try {
    if (!bot) return;
    const visibleHistory = history.filter(e => e.kind === 'reply' || e.bot === bot.slot || e.bot < 0 || e.kind === 'hello');
    const answer = await client.generate(event, bot, visibleHistory.slice(-20));
    if (answer.silent || !answer.text || !running || !scheduler.isCurrent(event, Date.now())) return;
    await publish(event, event.bot, answer.text);
    history.push({ kind: 'reply', bot: event.bot, text: answer.text });
    shown = true;
  } catch (error) {
    log('generation-skipped', error.message);
    if (client.rpc?.closed) { modelReady = false; nextModelAttempt = Date.now() + 30000; await client.close(); }
  }
  finally { scheduler.done(event.bot, Date.now(), shown, event.seq); generation = null; }
}

try {
  log('bridge-start', { mode, mailbox: config.mailbox, model: config.model, effort: config.effort });
  log('instructions', 'In a new local melee match type -llm on. The bridge first verifies an in-game loopback; then LLM chat activates automatically.');
  while (running) {
    try {
      const filename = path.join(config.mailbox, 'events.pld');
      const info = await stat(filename);
      const fileKey = `${info.mtimeMs}:${info.size}`;
      if (info.size <= 262144 && Date.now() - info.mtimeMs < 3000 && fileKey !== lastFile) {
        const raw = await readFile(filename, 'utf8');
        // PreloadGen writes a complete function. Ignore an intermediate snapshot.
        if (/endfunction\s*$/.test(raw)) {
          lastFile = fileKey;
          const parsed = parseEvents(raw);
          const heartbeat = parsed.find(e => e.kind === 'tick');
          if (heartbeat) {
            const events = inbox.accept(parsed);
            if (scheduler.session !== inbox.session) {
              scheduler.reset(inbox.session); bots.clear(); history = []; verified = false; probe = null; attempts = 0; publishedPoll = -1;
              log('game-session', inbox.session);
            }
            tick = { ...heartbeat, wall: info.mtimeMs };
            if (probe && Number(tick.extra) >= probe.seq) {
              verified = true;
              await writeFile(path.join(config.runtime, 'transport-verified.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), session: inbox.session, seq: probe.seq, game: '3.0.1', method: 'observed-game-ack' }, null, 2));
              log('transport-verified', { session: inbox.session, seq: probe.seq }); probe = null;
              if (mode === 'loopback' && process.argv.includes('--once')) running = false;
            }
            for (const event of events) {
              if (event.kind === 'tick') continue;
              log('game-event', event);
              if (event.kind === 'off') { tick = null; scheduler.reset(null); bots.clear(); continue; }
              if (event.kind === 'bot') { bots.set(event.bot, { ...personas[event.bot % personas.length], slot: event.bot, name: event.text, race: event.unitType }); continue; }
              if (event.kind === 'hello') { history.push(event); continue; }
              if (!['chat', 'death', 'revive'].includes(event.kind)) continue;
              const bot = event.bot >= 0 ? bots.get(event.bot) : chooseBot(event.text);
              if (!bot) continue;
              history.push(event);
              if (verified && mode === 'llm') scheduler.add({ ...event, bot: bot.slot }, Date.now(), Math.max(0, (heartbeat.time - event.time) * 1000));
            }
            history = history.slice(-32);
          }
        }
      }
      if (tick && !verified && bots.size && Date.now() - tick.wall < 3000 && (!probe || tick.unitType >= probe.poll + 4) && attempts < 3) {
        const bot = [...bots.keys()][0];
        // A fixed diagnostic, not a substitute for LLM conversations.
        await publish({ session: inbox.session, seq: inbox.last }, bot, 'Проверка моста: «ДК», кавычки " и путь \\ работают.');
        probe = { seq: inbox.last, poll: publishedPoll }; attempts++;
      }
      if (verified && mode === 'llm' && !modelReady && Date.now() >= nextModelAttempt) {
        nextModelAttempt = Date.now() + 30000;
        await client.start(); modelReady = true;
        log('llm-active', 'Only generated conversations; AMAI template chat is muted.');
      }
      if (verified && mode === 'llm' && modelReady && !generation && tick && Date.now() - tick.wall < 3000) {
        const event = scheduler.take(Date.now());
        if (event) generation = generateOne(event);
      }
      if (Date.now() - lastCleanup > 30000) {
        lastCleanup = Date.now();
        for (const name of await readdir(config.mailbox)) if (/^reply-\d+-\d+\.pld(?:\.tmp)?$/.test(name)) {
          const file = path.join(config.mailbox, name);
          if (Date.now() - (await stat(file)).mtimeMs > 60000) await unlink(file);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') { log('bridge-error', error.message); if (!modelReady) await client.close(); }
    }
    await sleep(200);
  }
} finally {
  await client.close();
  if (generation) await generation;
  await logChain;
  await unlink(lock).catch(() => {});
}
