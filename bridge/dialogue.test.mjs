import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DialogueMemory, repeatedReply, recoverDialogue } from './dialogue.mjs';
import { CodexClient } from './codex.mjs';
import { EventEmitter } from 'node:events';

const session = '123456789';
const reply = (text, bot = 1, seq = 1, channel = 'all') => ({ kind: 'reply', session, bot, seq, poll: seq, text, channel, recipients: [0, 1, 2], purpose: 'llm' });

test('dialogue survives telemetry traffic, stays bounded per speaker, and restores without duplicates', () => {
  const memory = new DialogueMemory(session);
  for (let i = 0; i < 20; i++) memory.add(reply(`реплика ${i}`, 1, i));
  for (let i = 0; i < 1000; i++) memory.add({ kind: 'position', session, bot: 1, seq: i });
  assert.equal(memory.toJSON().length, 12);
  assert.equal(memory.forBot(1).at(-1).text, 'реплика 19');
  const restored = new DialogueMemory(session, memory.toJSON());
  restored.add(reply('реплика 19', 1, 19));
  assert.deepEqual(restored.toJSON(), memory.toJSON());
  restored.reset('987654321');
  assert.deepEqual(restored.forBot(1), []);
});

test('private allied chat never reaches an enemy and other speakers cannot evict own recent lines', () => {
  const memory = new DialogueMemory(session);
  memory.add(reply('свои в тимчате', 1, 1, 'team'));
  memory.add(reply('общий канал', 1, 2));
  for (let bot = 2; bot < 24; bot++) for (let i = 0; i < 12; i++) memory.add(reply(`другой бот ${bot}:${i}`, bot, i + 3));
  assert.ok(memory.forBot(1).some(event => event.text === 'свои в тимчате'));
  assert.ok(!memory.forBot(3).some(event => event.text === 'свои в тимчате'));
  assert.ok(memory.forBot(1).length <= 16);
  assert.ok(memory.toJSON().length <= 288);
});

test('repeat guard catches spelling decorations and the reported paraphrase, but permits a different point', () => {
  const past = [reply('мк налегке, весь шмот — билет домой?))')];
  assert.ok(repeatedReply('МК налегке, весь шмот - билет домой! xD', past));
  assert.ok(repeatedReply('у мк весь закуп — билет домой?))', past));
  assert.equal(repeatedReply('мк без маны, забери руну у лавки', past), null);
  assert.equal(repeatedReply('купи тп)))0)', [reply('купи тп :D')]).reason, 'exact');
});

test('restart recovery reads the bounded journal tail, isolates the session, and ignores incomplete rows', async () => {
  const root = await mkdtemp('D:/ChatGPT/Temp/amai-dialogue-test-');
  try {
    const filename = path.join(root, 'bridge.jsonl');
    const delivery = reply('билет домой', 1, 773);
    await writeFile(filename, [
      JSON.stringify({ kind: 'reply-published', data: { ...delivery, session: '987654321' } }),
      JSON.stringify({ kind: 'reply-published', data: delivery }),
      JSON.stringify({ kind: 'reply-acknowledged', data: delivery }),
      '{"partial":',
    ].join('\n'));
    const memory = await recoverDialogue(filename, session);
    assert.equal(memory.toJSON().length, 1);
    assert.equal(memory.forBot(1)[0].text, 'билет домой');
  } finally {
    assert.ok(path.resolve(root).toLowerCase().startsWith(path.resolve('D:/ChatGPT/Temp/amai-dialogue-test-').toLowerCase()));
    await rm(root, { recursive: true, force: true });
  }
});

test('model requests include separate dialogue in the saved bounded chunk and use a fresh thread', async () => {
  const root = await mkdtemp('D:/ChatGPT/Temp/amai-dialogue-test-');
  const calls = [];
  const logs = [];
  const client = new CodexClient({ runtime: root, model: 'gpt-6.1-sol', effort: 'low', timeoutMs: 1000, contextMaxChars: 2000 }, (kind, data) => logs.push({ kind, data }));
  const rpc = client.rpc = new EventEmitter();
  rpc.call = async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: `thread-${calls.length}` } };
    if (method === 'turn/start') {
      queueMicrotask(() => {
        rpc.emit('notification', { method: 'item/completed', params: { threadId: params.threadId, item: { type: 'agentMessage', text: JSON.stringify({ event: 773, text: 'теперь к драке готовься', silent: false, recipient: 0, valence: 0, relationshipTarget: -1, relationshipImpact: 0 }) } } });
        rpc.emit('notification', { method: 'turn/completed', params: { threadId: params.threadId, turn: { status: 'completed' } } });
      });
      return { turn: { id: 'turn-1' } };
    }
    return {};
  };
  try {
    const event = { session, seq: 773, bot: 1, kind: 'inventory', audience: [{ slot: 0 }], recentDialogue: [reply('мк налегке, весь шмот — билет домой?))')] };
    await client.generate(event, { slot: 1, name: 'bot', style: 'коротко' }, []);
    await client.generate(event, { slot: 1, name: 'bot', style: 'коротко' }, []);
    const starts = calls.filter(call => call.method === 'thread/start');
    const turns = calls.filter(call => call.method === 'turn/start');
    assert.equal(starts.length, 2);
    assert.notEqual(turns[0].params.threadId, turns[1].params.threadId);
    assert.equal(starts[0].params.ephemeral, true);
    assert.equal(turns[0].params.outputSchema.properties.relationshipImpact.minimum, -1);
    assert.equal(turns[0].params.outputSchema.properties.relationshipImpact.maximum, 1);
    assert.equal(turns[0].params.outputSchema.properties.relationshipDelta, undefined);
    assert.match(starts[0].params.baseInstructions, /не повторяй ни формулировку, ни смысл/i);
    const records = turns[0].params.input[0].text.split('\n').map(JSON.parse);
    assert.ok(records.some(record => record.type === 'recent-dialogue' && record.data.text.includes('билет домой')));
    assert.equal(records.find(record => record.type === 'current-event').data.recentDialogue, undefined);
    assert.ok(turns[0].params.input[0].text.length <= 2000);
    assert.equal(logs.find(record => record.kind === 'model-request').data.dialogueEntries, 1);
  } finally {
    assert.ok(path.resolve(root).toLowerCase().startsWith(path.resolve('D:/ChatGPT/Temp/amai-dialogue-test-').toLowerCase()));
    await rm(root, { recursive: true, force: true });
  }
});
