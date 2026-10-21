import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alliesFrom, audienceFor, routeFor, historyFor, followupFor, routeHumanChat } from './conversation.mjs';
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

test('unknown native chat channel stays unknown when an ally causes conservative bridge routing', () => {
  const route = routeHumanChat({ text: 'удачи всем', extra: 'input=auto;native=unknown' }, bots, 0);
  assert.equal(route.nativeChannel, 'unknown');
  assert.equal(route.channel, 'team');
  assert.equal(route.inputChannelSource, 'conservative-auto');
  assert.deepEqual(route.recipients, [1, 2]);
});
test('one-message route overrides persistent bridge mode without claiming the native channel', () => {
  const team = routeHumanChat({ text: '@team держи мейн', extra: 'input=all;native=unknown' }, bots, 0);
  assert.equal(team.channel, 'team'); assert.equal(team.text, 'держи мейн');
  assert.equal(team.nativeChannel, 'unknown');
  const all = routeHumanChat({ text: '@all привет', extra: 'input=team;native=unknown' }, bots, 0);
  assert.equal(all.channel, 'all'); assert.deepEqual(all.recipients, [1, 2, 3]);
  const legacy = routeHumanChat({ text: 'hey', extra: 'input=all' }, bots, 0);
  assert.equal(legacy.channel, 'all'); assert.equal(legacy.nativeChannel, 'unknown');
});

test('allied enemy bots are not offered private conversations invisible to the human', () => {
  const enemies = new Map([[3, { slot: 3, name: 'enemy A', allies: [3,4] }], [4, { slot: 4, name: 'enemy B', allies: [3,4] }]]);
  const human = { slot: 0, name: 'human' };
  assert.deepEqual(audienceFor(enemies.get(3), enemies, human).map(p => p.slot), [0]);
  assert.throws(() => routeFor(enemies.get(3),4,enemies,0));
  assert.equal(followupFor({ session:'123456789',seq:10,bot:3,recipient:4,channel:'team',recipients:[3,4],text:'private',purpose:'llm',depth:0 },enemies,100,0),null);
});
