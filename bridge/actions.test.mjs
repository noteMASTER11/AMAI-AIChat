import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionController, actionCandidates, validateIntent, disclosureContext, actionCapabilities } from './actions.mjs';
import { buildChunk } from './context.mjs';

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

test('all allied tactical requests reach an executable goal, with cooperation affecting confidence and duration', () => {
  for (const action of ['attack', 'defend', 'rally', 'retreat', 'scout', 'focus']) {
    const context = { event: { session: '123456789', seq: 20, time: 100, kind: 'chat', bot: 1 }, bot, human: 2, observations: [self, foe], relationship: 0.9 };
    const result = new ActionController('123456789').propose({ ...intent(action, action === 'retreat' ? 'self' : '11'), confidence: 0.6, duration: 75 }, context);
    assert.equal(result.accepted, true, action);
    assert.ok(result.task.cooperation > 0.9);
  }
});

test('unseen public terrain sites allow reconnaissance, never an attack that assumes an enemy spawn', () => {
  const site = { bot: 1, owner: 27, seq: 12, time: 99, kind: 'map-site', unitType: 3, extra: 'x=5000;y=4000;site=3;explored=0' };
  const context = { event: { session: '123456789', seq: 20, time: 100, kind: 'chat', bot: 1 }, bot, human: 2, observations: [self, site], relationship: 0.8 };
  const result = new ActionController('123456789').propose(intent('attack', 'site:3'), context);
  assert.equal(result.accepted, true);
  assert.equal(result.task.action, 'scout');
  assert.equal(result.task.owner, 27);
});

test('a friendly ally can request a specific owned unit, but no imaginary or unaffordable worker', () => {
  const force = { bot: 1, owner: 1, kind: 'own-forces', unitType: 1969711215, unitName: 'Ghoul', time: 99, extra: 'count=4;working=3' };
  const context = { event: { session: '123456789', seq: 20, time: 100, kind: 'chat', bot: 1 }, bot, human: 2, observations: [self, foe, force], relationship: 0.9 };
  assert.equal(actionCapabilities(1, context.observations, 100).units[0].unitType, force.unitType);
  const request = { ...intent('scout'), unitType: force.unitType };
  const result = new ActionController('123456789').propose(request, context);
  assert.equal(result.accepted, true);
  assert.equal(result.task.unitType, force.unitType);
  assert.equal(new ActionController('123456789').propose({ ...request, unitType: 999 }, context).reason, 'requested-unit-unavailable');
});

test('dense map telemetry retains distinct target categories inside the independent prompt budget', () => {
  const observations = [self, ...Array.from({length:40},(_,i)=>({...foe,seq:100+i,extra:`x=${3000+i*200};y=4000;unit=${100+i}`})), ...Array.from({length:24},(_,i)=>({bot:1,owner:27,seq:200+i,time:99,kind:'map-site',unitType:i,extra:`x=${4000+i*100};y=5000;site=${i};explored=0`}))];
  const candidates = actionCandidates(1,observations,100);
  assert.ok(candidates.length <= 24);
  assert.ok(candidates.some(c=>c.ref==='self'));
  assert.ok(candidates.some(c=>c.owner===0));
  assert.ok(candidates.some(c=>c.publicSite));
  assert.ok(buildChunk({bot:1,actionCandidates:candidates},[],[],[],12000).text.length < 12000);
});

test('an accepted replacement cancels the previous goal only after the AI acknowledges it', () => {
  const controller = new ActionController('123456789');
  const context = { event:{session:'123456789',seq:20,time:100,kind:'chat',bot:1},bot,human:2,observations:[self,foe],relationship:0.9 };
  const first = controller.propose(intent('attack'),context).task;
  const second = controller.propose(intent('retreat','self'),context).task;
  assert.equal(first.status,'published');
  controller.acknowledge({bot:1,time:101,extra:`id=${second.id};status=accepted;reason=validated`});
  assert.equal(first.status,'cancelled');
  assert.equal(second.status,'accepted');
});
