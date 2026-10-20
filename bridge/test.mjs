import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEvents, makeReply, cleanText, Inbox, replyWindow, expireReplies } from './protocol.mjs';
import { JsonRpc, validateAnswer } from './codex.mjs';
import { PassThrough } from 'node:stream';
import { Scheduler } from './scheduler.mjs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const record = (seq, text = 'Привет%7C%22ДК%22%5C') => `\tcall Preload( "AMAI1|123456789|${seq}|12.50|chat|1|0|0||0|0|-1|${text}|" )\r\n`;
const snapshotEvents = records => [{ ...records[0], seq: 0, kind: 'tick' }, ...records];
test('complete bounded snapshots preserve Cyrillic, quotes, slashes and delimiters', () => {
  assert.deepEqual(parseEvents(record(2))[0].text, 'Привет|"ДК"\\');
  assert.deepEqual(parseEvents(record(2).slice(0, -8)), []);
  assert.deepEqual(parseEvents('x'.repeat(262145)), []);
  assert.deepEqual(parseEvents(record(-1)), []);
});
test('inbox rejects duplicate records, retired sessions and malformed records', () => {
  const inbox = new Inbox();
  assert.equal(inbox.accept(snapshotEvents(parseEvents(record(1)))).filter(e => e.kind !== 'tick').length, 1);
  assert.equal(inbox.accept(snapshotEvents(parseEvents(record(1)))).filter(e => e.kind !== 'tick').length, 0);
  assert.equal(inbox.accept(snapshotEvents(parseEvents(record(2).replace('123456789', '555555555')))).filter(e => e.kind !== 'tick').length, 1);
  assert.equal(inbox.accept(snapshotEvents(parseEvents(record(3)))).length, 0);
});
test('reply wrapper cannot turn hostile text into JASS or Warcraft markup', () => {
  const reply = makeReply('123456789', 2, 1, 'ДК "\\\nendfunction |cffff0000привет|r', 50);
  assert.equal(reply.split('\n').length, 4);
  assert.ok(reply.includes('\\"'));
  assert.ok(!reply.includes('|cffff0000'));
  assert.equal([...cleanText('я'.repeat(200))].length, 180);
  assert.throws(() => makeReply('../x', 2, 1, 'нет', 50));
});

test('JSON-RPC rejects server errors, timeouts and exited processes', async () => {
  const input = new PassThrough();
  const rpc = new JsonRpc(input);
  const pending = rpc.call('test', {}, 1000);
  rpc.receive({ id: 1, error: { message: 'denied' } });
  await assert.rejects(pending, /denied/);
  await assert.rejects(rpc.call('test', {}, 5), /timeout/);
  const exiting = rpc.call('test', {}, 1000);
  rpc.close(new Error('exited'));
  await assert.rejects(exiting, /exited/);
  await assert.rejects(rpc.call('after-exit'), /exited/);
});
test('structured output is bounded and tied to its event', () => {
  assert.equal(validateAnswer('{"event":2,"text":"ДК отлетел","silent":false}', 2).text, 'ДК отлетел');
  assert.throws(() => validateAnswer('{"event":3,"text":"ложь","silent":false}', 2));
  assert.throws(() => validateAnswer('{"event":2,"text":42,"silent":false}', 2));
});
test('new reply channels and structured assessments reject invalid targets', () => {
  assert.match(makeReply('123456789', 2, 1, 'текст', 20, 5, { channel: 'team', recipient: 2 }), /\|team\|2/);
  assert.throws(() => makeReply('123456789', 2, 1, 'текст', 20, 5, { channel: 'team', recipient: -1 }));
  const answer = { event: 2, text: 'реснись, прикрою', silent: false, recipient: 2, valence: -0.6, relationshipTarget: 2, relationshipDelta: 0.04 };
  assert.equal(validateAnswer(JSON.stringify(answer), 2, [2]).valence, -0.6);
  assert.throws(() => validateAnswer(JSON.stringify({ ...answer, recipient: 3 }), 2, [2]));
  assert.throws(() => validateAnswer(JSON.stringify({ ...answer, valence: 2 }), 2, [2]));
});

const options = { globalCooldownMs: 8000, botCooldownMs: 20000, eventTtlMs: 20000, chatTtlMs: 45000 };
const event = (seq, kind = 'death', bot = 1) => ({ session: '123456789', seq, kind, bot, time: 10, text: 'тест' });
test('scheduler prioritizes chat, caps its queue and expires old events', () => {
  const s = new Scheduler(options);
  s.add(event(1), 100000); s.add(event(2), 100001); s.add(event(3), 100002); s.add(event(4, 'chat'), 100003);
  assert.equal(s.queue.length, 3);
  assert.equal(s.take(100004).seq, 4);
  s.done(1, 100004);
  assert.equal(s.take(121000), null);
});
test('scheduler allows one in-flight request and enforces global and per-bot cooldowns', () => {
  const s = new Scheduler(options);
  s.add(event(1, 'chat'), 100000); s.add(event(2, 'chat', 2), 100000);
  assert.equal(s.take(100000).seq, 1);
  assert.equal(s.take(100001), null);
  s.done(1, 100002);
  assert.equal(s.take(108001), null);
  assert.equal(s.take(108002).bot, 2);
  s.done(2, 108002);
  s.add(event(3, 'chat', 1), 108002);
  assert.equal(s.take(116002), null);
  assert.equal(s.take(120002).bot, 1);
});
test('new session discards old queue and never releases an old generated answer', () => {
  const s = new Scheduler(options);
  s.add(event(1), 100000);
  const old = s.take(100001);
  s.reset('555555555');
  assert.equal(s.isCurrent(old, 100002), false);
  assert.equal(s.queue.length, 0);
});

test('prioritized newer reply retires older queued comments', () => {
  const s = new Scheduler(options);
  s.add(event(1), 100000); s.add(event(2, 'chat'), 100001);
  assert.equal(s.take(100002).seq, 2);
  s.done(1, 100002, true, 2);
  assert.equal(s.queue.length, 0);
});

test('restart recovers a current roster after initial bot events roll out of history', () => {
  const inbox = new Inbox();
  const records = snapshotEvents([{ ...event(0, 'bot'), text: 'Current bot' }, event(100)]);
  assert.equal(inbox.accept(records).filter(e => e.kind === 'bot').length, 1);
  assert.equal(inbox.accept(records).filter(e => e.kind === 'bot').length, 1);
});

test('foreign records reject a whole snapshot without retiring the real session', () => {
  const inbox = new Inbox();
  inbox.accept(snapshotEvents([event(1)]));
  assert.deepEqual(inbox.accept(snapshotEvents([event(2), { ...event(3), session: '555555555' }])), []);
  assert.equal(inbox.session, '123456789');
  assert.equal(inbox.accept(snapshotEvents([event(4)])).at(-1).seq, 4);
  assert.deepEqual(inbox.accept([{ ...event(5), session: '555555555' }]), []);
});

test('transport reserves poll delay and encodes a display deadline', () => {
  const tick = { time: 10, wall: 100000 };
  assert.throws(() => replyWindow({ expires: 101999 }, tick, 100000, 2000), /expired/);
  assert.deepEqual(replyWindow({ expires: 110000 }, tick, 100000, 2000), { expiresAt: 110000, gameDeadline: 20 });
  assert.match(makeReply('123456789', 1, 1, 'ДК', 20), /123456789\|1\|1\|20\|ДК/);
  assert.match(makeReply('123456789', 2, 1, 'ДК', 20, 5), /123456789\|5\|1\|20\|ДК\|2/);
});

test('wall-clock expiry removes a pending file even when game polls are paused', async () => {
  const root = await mkdtemp('D:/ChatGPT/Temp/amai-test-');
  const filename = path.join(root, 'reply.pld');
  try {
    await writeFile(filename, 'pending reply');
    const pending = new Map([[filename, 101000]]);
    await expireReplies(pending, 100999);
    await access(filename);
    await expireReplies(pending, 101000);
    await assert.rejects(access(filename));
    assert.equal(pending.size, 0);
  } finally {
    assert.ok(path.resolve(root).toLowerCase().startsWith(path.resolve('D:/ChatGPT/Temp/amai-test-').toLowerCase()));
    await rm(root, { recursive: true, force: true });
  }
});

test('bridge loopback waits for acknowledgement and exits cleanly (simulated game files)', { timeout: 15000 }, async () => {
  const root = await mkdtemp('D:/ChatGPT/Temp/amai-test-');
  const mailbox = path.join(root, 'mailbox');
  const runtime = path.join(root, 'runtime');
  await mkdir(mailbox);
  const child = spawn(process.execPath, [new URL('./main.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), '--loopback', '--once'], { windowsHide: true, env: { ...process.env, AMAI_MAILBOX: mailbox, AMAI_RUNTIME: runtime }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const snapshot = (tick, ack) => `function PreloadFiles takes nothing returns nothing\ncall Preload( "AMAI1|123456789|0|10|tick|-1|0|${tick}||0|-1|-1||${ack}" )\ncall Preload( "AMAI1|123456789|1|9|hello|-1|0|0||0|0|-1|test|User" )\ncall Preload( "AMAI1|123456789|2|9|bot|1|0|0||0|1|-1|Bot|" )\nendfunction\n`;
  try {
    await writeFile(path.join(mailbox, 'events.pld'), snapshot(1, 2));
    let filename;
    for (let i = 0; i < 50; i++) {
      filename = (await readdir(mailbox)).find(n => /^reply-/.test(n));
      if (filename) break;
      await sleep(100);
    }
    assert.ok(filename, output);
    assert.match(await readFile(path.join(mailbox, filename), 'utf8'), /Проверка моста/);
    await assert.rejects(access(path.join(runtime, 'transport-verified.json')));
    // Acknowledgement from a previous bridge must not validate this probe.
    await writeFile(path.join(mailbox, 'events.pld'), snapshot(3, 2));
    await sleep(300);
    await assert.rejects(access(path.join(runtime, 'transport-verified.json')));
    await writeFile(path.join(mailbox, 'events.pld'), snapshot(5, 5));
    const code = await Promise.race([exited, sleep(7000, undefined, { ref: false }).then(() => 'timeout')]);
    assert.equal(code, 0, output);
    const proof = JSON.parse(await readFile(path.join(runtime, 'transport-verified.json'), 'utf8'));
    assert.equal(proof.session, '123456789');
    assert.equal(proof.seq, 5);
    await assert.rejects(access(path.join(mailbox, 'bridge.lock')));
  } finally {
    if (child.exitCode == null) child.kill();
    assert.ok(path.resolve(root).toLowerCase().startsWith(path.resolve('D:/ChatGPT/Temp/amai-test-').toLowerCase()));
    await rm(root, { recursive: true, force: true });
  }
});
