import { readFile, writeFile, rename, mkdir, stat, readdir, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseEvents, makeReply, cleanText, Inbox, replyWindow, expireReplies } from './protocol.mjs';
import { Scheduler } from './scheduler.mjs';
import { CodexClient } from './codex.mjs';
import { alliesFrom, audienceFor, routeFor, historyFor, followupFor, parseAcknowledgement } from './conversation.mjs';
import { Relationships, Observations } from './context.mjs';
import { waitForGame } from './delivery.mjs';
import { recoverDialogue, repeatedReply } from './dialogue.mjs';

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
const previousState = await readFile(path.join(config.runtime, 'status.json'), 'utf8').then(JSON.parse).catch(() => null);
const dialogue = await recoverDialogue(logFile, previousState?.session, previousState?.recentDialogue || previousState?.history || []);
const resume = process.env.AMAI_RESUME_SESSION ? { session: process.env.AMAI_RESUME_SESSION, last: Number(process.env.AMAI_RESUME_SEQUENCE) } : { session: previousState?.session, last: previousState?.sequence };
const inbox = new Inbox(resume);
const scheduler = new Scheduler(config);
const client = new CodexClient(config, log);
const bots = new Map();
const pendingReplies = new Map();
const awaitingDelivery = new Map();
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
let lastStateWrite = 0;
let lastLimitsRead = 0;
let cpuPrevious = process.cpuUsage();
let cpuSampleAt = Date.now();
let cpuPercent = 0;
let activeRequest = null;
let human = previousState?.session === inbox.session && previousState.human ? previousState.human : { slot: 0, name: 'Игрок' };
const lastComment = new Map();
const relationshipsFile = path.join(config.runtime, 'relationships.json');
const relationships = new Relationships(await readFile(relationshipsFile, 'utf8').then(JSON.parse).catch(() => null));
const observations = new Observations();

async function writeState() {
  const now = Date.now();
  const cpu = process.cpuUsage(cpuPrevious);
  cpuPercent = (cpu.user + cpu.system) / Math.max(1, now - cpuSampleAt) / 10;
  cpuPrevious = process.cpuUsage(); cpuSampleAt = now;
  const state = {
    schema: 1, updatedAt: new Date(now).toISOString(), pid: process.pid, uptimeSeconds: process.uptime(),
    model: config.model, effort: config.effort, mode, modelReady, verified, session: inbox.session, sequence: inbox.last,
    history: history.slice(-256),
    recentDialogue: dialogue.toJSON(),
    transport: { poll: tick?.unitType ?? null, gameSeconds: tick?.time ?? null, lastHeartbeatAt: tick?.wall ?? null, acknowledgedPoll: tick ? parseAcknowledgement(tick.extra).poll : null, probe, attempts, pendingFiles: pendingReplies.size },
    bots: [...bots.values()], queue: scheduler.queue.map(e => ({ session: e.session, seq: e.seq, kind: e.kind, bot: e.bot, text: e.text, expires: e.expires })),
    human,
    activeRequest, memory: process.memoryUsage(), cpuPercent,
    relationships: { session: inbox.session, pairs: relationships.sessions.get(inbox.session) || {} },
    observations: [...observations.latest.values()],
    settings: { globalCooldownMs: config.globalCooldownMs, botCooldownMs: config.botCooldownMs, timeoutMs: config.timeoutMs, eventTtlMs: config.eventTtlMs, chatTtlMs: config.chatTtlMs },
    cooldowns: { globalUntil: Number.isFinite(scheduler.lastGlobal) ? scheduler.lastGlobal + config.globalCooldownMs : null, bots: Object.fromEntries([...scheduler.lastBot].map(([id, at]) => [id, at + config.botCooldownMs])) },
  };
  const filename = path.join(config.runtime, 'status.json');
  await writeFile(filename + '.tmp', JSON.stringify(state)); await rename(filename + '.tmp', filename);
}

const stop = () => { running = false; };
process.on('SIGINT', stop); process.on('SIGTERM', stop);

function chooseBot(text, recipients = [...bots.keys()]) {
  const list = [...bots.values()].filter(bot => recipients.includes(bot.slot));
  if (!list.length) return null;
  return list.find(bot => text.toLowerCase().includes(bot.name.toLowerCase())) || list[cursor++ % list.length];
}

async function publish(event, bot, text, route = { channel: 'all', recipient: -1, recipients: [human.slot, ...bots.keys()] }) {
  if (!tick || event.session !== inbox.session || Date.now() - tick.wall > 3000) throw new Error('No live game heartbeat');
  const target = Math.max(tick.unitType + 4, publishedPoll + 1);
  text = cleanText(text, config);
  const window = replyWindow(event, tick, Date.now(), (target - tick.unitType) * 500);
  const filename = path.join(config.mailbox, `reply-${event.session}-${target}.pld`);
  const temporary = filename + '.tmp';
  await writeFile(temporary, makeReply(event.session, event.seq, bot, text, window.gameDeadline, target, route, config), 'utf8');
  await rename(temporary, filename);
  pendingReplies.set(filename, window.expiresAt);
  setTimeout(() => expireReplies(pendingReplies, Date.now()).catch(error => log('expiry-error', error.message)), Math.max(1, window.expiresAt - Date.now())).unref();
  publishedPoll = target;
  const delivery = { session: event.session, seq: event.seq, bot, poll: target, text, ...route, depth: event.depth || 0, purpose: event.kind ? 'llm' : 'probe', publishedAt: Date.now(), expiresAt: window.expiresAt };
  awaitingDelivery.set(target, delivery);
  log('reply-published', delivery);
  dialogue.add({ ...delivery, kind: 'reply' });
}

async function generateOne(event) {
  const bot = bots.get(event.bot);
  let shown = false;
  let outcome = 'failed';
  const startedAt = Date.now();
  activeRequest = { session: event.session, seq: event.seq, bot: event.bot, kind: event.kind, startedAt };
  log('generation-started', activeRequest);
  try {
    if (!bot) return;
    let audience = audienceFor(bot, bots, human);
    if (event.kind === 'chat') audience = audience.filter(p => p.slot === human.slot);
    if (event.kind === 'bot-chat') audience = audience.filter(p => p.slot === event.sourceBot);
    if (!audience.length) { outcome = 'silent'; return; }
    const context = { ...event, audience, humanSlot: human.slot, observations: observations.forBot(bot.slot, event.time), relationships: relationships.forBot(event.session, bot.slot, audience), recentDialogue: dialogue.forBot(bot.slot) };
    const answer = await client.generate(context, bot, historyFor(bot.slot, history));
    if (answer.shortened) log('reply-shortened', { session: event.session, seq: event.seq, bot: bot.slot, originalBytes: answer.originalBytes, outputBytes: Buffer.byteLength(answer.text, 'utf8'), text: answer.text });
    if (!running || event.session !== inbox.session) { outcome = 'expired'; return; }
    const previousCoefficient = relationships.get(event.session, bot.slot, answer.relationshipTarget);
    const coefficient = relationships.apply(event.session, bot.slot, answer.requestId, answer);
    await writeFile(relationshipsFile + '.tmp', JSON.stringify(relationships)); await rename(relationshipsFile + '.tmp', relationshipsFile);
    log('event-assessment', { session: event.session, seq: event.seq, bot: bot.slot, valence: answer.valence, target: answer.relationshipTarget, impact: answer.relationshipImpact ?? null, requestedDelta: answer.relationshipDelta, previousCoefficient, delta: Math.round((coefficient - previousCoefficient) * 10000) / 10000, coefficient, curve: answer.relationshipImpact === undefined ? 'legacy' : 'exponential-v1', requestId: answer.requestId });
    if (answer.silent || !answer.text) { outcome = 'silent'; return; }
    const repeated = repeatedReply(answer.text, dialogue.ownForBot(bot.slot));
    if (repeated) {
      log('reply-suppressed', { session: event.session, seq: event.seq, bot: bot.slot, text: answer.text, ...repeated, requestId: answer.requestId });
      outcome = 'silent'; return;
    }
    if (!running || !scheduler.isCurrent(event, Date.now())) { outcome = 'expired'; return; }
    const route = routeFor(bot, answer.recipient, bots, human.slot);
    if (event.kind === 'bot-chat' && route.recipient !== event.sourceBot) throw new Error('Followup addressed to a different conversation');
    let deferred = false;
    const delivery = await waitForGame({ event, getTick: () => tick, getSession: () => scheduler.session, isRunning: () => running, onWaiting: () => {
      deferred = true;
      activeRequest = { ...activeRequest, phase: 'awaiting-game', readyAt: Date.now(), text: answer.text };
      log('reply-deferred', { session: event.session, seq: event.seq, bot: event.bot, status: 'awaiting-game', reason: 'game-heartbeat-stale', expiresAt: event.expires });
    } });
    if (delivery !== 'ready') { outcome = 'expired'; return; }
    if (deferred) log('reply-resumed', { session: event.session, seq: event.seq, bot: event.bot, status: 'publishing' });
    activeRequest = { ...activeRequest, phase: 'publishing' };
    await publish(event, event.bot, answer.text, route);
    shown = true;
    outcome = 'published';
  } catch (error) {
    log('generation-skipped', error.message);
    if (client.rpc?.closed) { modelReady = false; nextModelAttempt = Date.now() + 30000; await client.close(); }
  }
  finally {
    log('generation-finished', { session: event.session, seq: event.seq, bot: event.bot, status: outcome, durationMs: Date.now() - startedAt });
    activeRequest = null; scheduler.done(event.bot, Date.now(), shown, event.seq); generation = null;
  }
}

try {
  log('bridge-start', { mode, mailbox: config.mailbox, model: config.model, effort: config.effort, pid: process.pid });
  log('instructions', 'New local JASS melee matches enable the collector automatically. The bridge verifies an in-game round trip before enabling LLM replies. Manual commands: -llm on / -llm off.');
  while (running) {
    try {
      if (Date.now() - lastStateWrite >= 1000) { lastStateWrite = Date.now(); await writeState(); }
      if (modelReady && Date.now() - lastLimitsRead >= 60000) { lastLimitsRead = Date.now(); client.readRateLimits().catch(() => {}); }
      await expireReplies(pendingReplies, Date.now());
      const filename = path.join(config.mailbox, 'events.pld');
      const info = await stat(filename);
      const fileKey = `${info.mtimeMs}:${info.size}`;
      if (info.size <= 262144 && Date.now() - info.mtimeMs < 3000 && fileKey !== lastFile) {
        const raw = await readFile(filename, 'utf8');
        // PreloadGen writes a complete function. Ignore an intermediate snapshot.
        if (/endfunction\s*$/.test(raw)) {
          lastFile = fileKey;
          const parsed = parseEvents(raw);
          const events = inbox.accept(parsed);
          const heartbeat = events.find(e => e.kind === 'tick');
          if (!heartbeat) tick = null;
          if (heartbeat) {
            if (scheduler.session !== inbox.session) {
              scheduler.reset(inbox.session); bots.clear(); history = []; observations.clear(); awaitingDelivery.clear(); lastComment.clear(); verified = false; probe = null; attempts = 0; publishedPoll = -1;
              if (previousState?.session === inbox.session) for (const event of previousState.observations || []) observations.add(event);
              if (previousState?.session === inbox.session) history = (previousState.history || []).slice(-256);
              if (dialogue.session !== inbox.session) dialogue.reset(inbox.session);
              log('game-session', { session: inbox.session });
            }
            tick = { ...heartbeat, wall: info.mtimeMs };
            human.slot = heartbeat.human;
            const acknowledgement = parseAcknowledgement(tick.extra);
            for (const [poll, delivery] of awaitingDelivery) {
              if (acknowledgement.poll === poll) {
                log('reply-acknowledged', { ...delivery, visible: acknowledgement.visible, delayMs: Date.now() - delivery.publishedAt }); awaitingDelivery.delete(poll);
                if (delivery.purpose === 'llm') {
                  history.push({ ...delivery, kind: 'reply' });
                  const followup = followupFor(delivery, bots, heartbeat.time);
                  if (followup) { scheduler.add(followup, Date.now()); log('bot-dialogue', followup); }
                }
              }
              else if (Date.now() >= delivery.expiresAt) { log('reply-unconfirmed', delivery); awaitingDelivery.delete(poll); }
            }
            if (heartbeat.unitName.startsWith('roster-v')) {
              const roster = new Set(events.filter(e => e.kind === 'bot' && e.seq === 0).map(e => e.bot));
              for (const id of bots.keys()) if (!roster.has(id)) bots.delete(id);
            }
            if (probe && acknowledgement.poll >= probe.seq) {
              verified = true;
              await writeFile(path.join(config.runtime, 'transport-verified.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), session: inbox.session, seq: probe.seq, game: '3.0.1', method: 'observed-game-ack' }, null, 2));
              log('transport-verified', { session: inbox.session, seq: probe.seq }); probe = null;
              if (mode === 'loopback' && process.argv.includes('--once')) running = false;
            }
            for (const event of events) {
              if (event.kind === 'tick') continue;
              if (event.kind !== 'chat' && (event.kind !== 'bot' || event.seq !== 0)) log('game-event', event);
              if (event.kind === 'off') { tick = null; scheduler.reset(null); bots.clear(); continue; }
              if (event.kind === 'bot') { bots.set(event.bot, { ...personas[event.bot % personas.length], slot: event.bot, name: event.text, race: event.unitType, allies: alliesFrom(event.extra) || [event.bot] }); continue; }
              if (event.kind === 'hello') { human.name = event.extra || 'Игрок'; history.push(event); continue; }
              if (event.kind === 'chat') {
                const allies = [...bots.values()].filter(bot => bot.allies.includes(human.slot)).map(bot => bot.slot);
                const explicitAll = /^@all\s/i.test(event.text) || event.extra === 'input=all';
                const explicitTeam = /^@team\s/i.test(event.text) || event.extra === 'input=team';
                const team = !explicitAll && (explicitTeam || allies.length > 0);
                event.recipients = team ? allies : [...bots.keys()];
                event.channel = team ? 'team' : 'all';
                event.text = event.text.replace(/^@(all|team)\s+/i, '');
                log('game-event', { ...event, inputChannelSource: 'bridge-mode' });
              }
              const bot = event.bot >= 0 ? bots.get(event.bot) : chooseBot(event.text, event.recipients);
              if (!bot) continue;
              history.push(event);
              dialogue.add(event);
              const changedObservation = observations.add(event);
              const important = ['chat', 'death', 'revive', 'build-finish', 'upgrade-finish', 'research', 'level', 'skill', 'inventory'].includes(event.kind) && !event.extra.includes(';refresh=true') && (event.kind !== 'inventory' || changedObservation);
              const throttled = !['chat', 'death', 'revive'].includes(event.kind);
              const key = `${bot.slot}:${event.kind}`;
              if (verified && mode === 'llm' && important && (!throttled || Date.now() - (lastComment.get(key) || 0) >= 45000)) {
                scheduler.add({ ...event, bot: bot.slot }, Date.now(), Math.max(0, (heartbeat.time - event.time) * 1000));
                lastComment.set(key, Date.now());
              }
            }
            history = history.slice(-256);
          }
        }
      }
      if (tick && !verified && bots.size && Date.now() - tick.wall < 3000 && (!probe || tick.unitType >= probe.poll + 4) && attempts < 3) {
        const bot = [...bots.keys()][0];
        // A fixed diagnostic, not a substitute for LLM conversations.
        await publish({ session: inbox.session, seq: inbox.last, expires: Date.now() + 6000 }, bot, 'Проверка моста: «ДК», кавычки " и путь \\ работают.');
        probe = { seq: publishedPoll, poll: publishedPoll }; attempts++;
      }
      if (verified && mode === 'llm' && !modelReady && Date.now() >= nextModelAttempt) {
        nextModelAttempt = Date.now() + 30000;
        await client.start(); modelReady = true; lastLimitsRead = Date.now();
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
  log('bridge-stop', { pid: process.pid });
  await expireReplies(pendingReplies, Infinity);
  await client.close();
  if (generation) await generation;
  await logChain;
  await unlink(lock).catch(() => {});
}
