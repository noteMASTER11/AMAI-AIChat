import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionController, actionCandidates, validateIntent, disclosureContext } from './actions.mjs';

const self = { bot: 1, owner: 1, seq: 10, time: 100, kind: 'self-state', extra: 'x=0;y=0;gold=600;army=6;health=0.9;unit=0', text: 'own' };
const foe = { bot: 1, owner: 0, seq: 11, time: 99, kind: 'sighting', unitName: 'Hero', extra: 'x=500;y=400;unit=42;hero=1;observed=1' };
const bot = { slot: 1, allies: [1, 2], id: 'tilter' };
const intent = (action, target = '11') => ({ kind: 'request', action, target, confidence: 0.9, duration: 30, amount: 0, claim: 'none', rationale: 'test' });

test('candidate coordinates come only from that observer and retain their observation time', () => {
  const list = actionCandidates(1, [self, foe, { ...foe, bot: 3, seq: 99, extra: 'x=900;y=900;unit=88' }], 100);
  assert.ok(list.some(entry => entry.unit === 42 && entry.observedAt === 99));
  assert.ok(!list.some(entry => entry.unit === 88));
  assert.throws(() => validateIntent({ ...intent('attack'), target: '999' }, list));
});
test('an enemy cannot order retreat or resource transfer, but can provoke investigation of a known point', () => {
  const controller = new ActionController('123456789');
  const context = { event: { session: '123456789', seq: 20, time: 100, kind: 'chat', bot: 1 }, bot, human: 0, observations: [self, foe], relationship: -0.6 };
  assert.equal(controller.propose(intent('retreat', 'self'), context).accepted, false);
  assert.equal(controller.propose(intent('tribute', 'self'), context).accepted, false);
  assert.equal(controller.propose({ ...intent('scout'), kind: 'report', claim: 'attack' }, context).accepted, true);
});
test('old sightings permit investigation but never a live attack on a hidden moving unit', () => {
  const controller = new ActionController('123456789');
  const context = { event: { session: '123456789', seq: 20, time: 140, kind: 'chat', bot: 1, sourceBot: 2 }, bot, human: 2, observations: [ { ...self, time: 140 }, foe ], relationship: 0.5 };
  const result = controller.propose(intent('attack'), context);
  assert.equal(result.accepted, true);
  assert.equal(result.task.action, 'scout');
  assert.equal(result.task.x, 500);
});
test('public recipient context does not include private own inventory, construction or active plans', () => {
  const event = { bot: 1, audience: [{ slot: 0, relation: 'enemy' }], observations: [self, foe, { ...self, kind: 'build-finish', unitName: 'Aviary' }], activeTask: { action: 'attack', x: 10 }, text: 'hello' };
  const filtered = disclosureContext(event, [{ kind: 'build-start', bot: 1, owner: 1, unitName: 'Aviary' }], [{ kind: 'reply', channel: 'team', recipients: [1, 2], text: 'secret' }]);
  assert.ok(!JSON.stringify(filtered).includes('Aviary'));
  assert.ok(!JSON.stringify(filtered).includes('secret'));
  assert.equal(filtered.event.activeTask, undefined);
});
