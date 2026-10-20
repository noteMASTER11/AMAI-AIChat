import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alliesFrom, audienceFor, routeFor, historyFor, followupFor } from './conversation.mjs';
const a = { slot: 1, name: 'one', allies: [0, 1, 2] };
const b = { slot: 2, name: 'two', allies: [0, 1, 2] };
const c = { slot: 3, name: 'enemy', allies: [3] };
const bots = new Map([[1, a], [2, b], [3, c]]);
test('alliance snapshots are validated and allied recipients always use team chat', () => {
  assert.deepEqual(alliesFrom('allies:0,1,2'), [0, 1, 2]);
  assert.equal(alliesFrom('allies:0,99'), null);
  assert.equal(alliesFrom(''), null);
  assert.deepEqual(audienceFor(a, bots, { slot: 0, name: 'human' }).map(x => x.slot), [0, 2, 3]);
  assert.deepEqual(routeFor(a, 2, bots, 0), { channel: 'team', recipient: 2, recipients: [0, 1, 2] });
  assert.equal(routeFor(a, 3, bots, 0).channel, 'all');
  assert.throws(() => routeFor(a, 1, bots, 0));
  assert.throws(() => routeFor(a, 22, bots, 0));
});
test('private team history and unseen telemetry never reach an enemy prompt', () => {
  const history = [{ kind: 'reply', bot: 1, channel: 'team', recipients: [0, 1, 2], text: 'private' }, { kind: 'reply', bot: 1, channel: 'all', text: 'public' }, { kind: 'death', bot: 2 }, { kind: 'hello', bot: -1 }];
  assert.deepEqual(historyFor(3, history).map(x => x.text).filter(Boolean), ['public']);
  assert.deepEqual(historyFor(2, history).map(x => x.text).filter(Boolean), ['private', 'public']);
});
test('bot replies get one addressed, bounded followup only after acknowledgement', () => {
  const reply = { session: '123456789', seq: 12, bot: 1, recipient: 2, channel: 'team', recipients: [0, 1, 2], text: 'go', purpose: 'llm', depth: 0 };
  const follow = followupFor(reply, bots, 1000);
  assert.equal(follow.bot, 2); assert.equal(follow.sourceBot, 1); assert.equal(follow.depth, 1);
  assert.equal(followupFor({ ...reply, depth: 1 }, bots, 1000), null);
  assert.equal(followupFor({ ...reply, recipient: 0 }, bots, 1000), null);
  assert.equal(followupFor({ ...reply, recipient: 3 }, bots, 1000), null);
  assert.equal(followupFor({ ...reply, purpose: 'probe' }, bots, 1000), null);
});
