import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Relationships, Observations, buildChunk, validateAssessment } from './context.mjs';
test('relationship score and event valence are distinct, bounded, directional and deduplicated', () => {
  const state = new Relationships();
  const assessment = { valence: -0.8, relationshipTarget: 2, relationshipDelta: 0.06 };
  assert.equal(state.apply('123456789', 1, 'request-1', assessment), 0.06);
  assert.equal(state.get('123456789', 2, 1), 0);
  assert.equal(state.apply('123456789', 1, 'request-1', assessment), 0.06);
  assert.equal(state.get('other-session', 1, 2), 0);
  for (let i = 0; i < 30; i++) state.apply('123456789', 1, `positive-${i}`, { ...assessment, relationshipDelta: 0.1 });
  assert.equal(state.get('123456789', 1, 2), 1);
  assert.deepEqual(new Relationships(state.toJSON()).toJSON(), state.toJSON());
  assert.throws(() => validateAssessment({ ...assessment, valence: 1.1 }, [2]));
  assert.throws(() => validateAssessment({ ...assessment, relationshipDelta: -1 }, [2]));
  assert.throws(() => validateAssessment({ ...assessment, relationshipTarget: 23 }, [2]));
});
test('snapshot context is observer-specific, expires and survives chat history eviction', () => {
  const observations = new Observations();
  observations.add({ bot: 1, kind: 'inventory', owner: 0, unitType: 99, text: 'boots', time: 10, extra: 'unit=42' });
  observations.add({ bot: 1, kind: 'abilities', owner: 0, unitType: 99, text: 'aura level 2', time: 10, extra: 'unit=42' });
  observations.add({ bot: 1, kind: 'inventory', owner: 0, unitType: 99, text: 'boots, tp', time: 20, extra: 'unit=42' });
  assert.equal(observations.forBot(2, 20).length, 0);
  assert.equal(observations.forBot(1, 20).length, 2);
  assert.equal(observations.forBot(1, 400).length, 0);
  const chunk = buildChunk({ seq: 1, bot: 1, kind: 'inventory' }, [], observations.forBot(1, 20), [{ slot: 0, coefficient: 0.4 }], 1800);
  assert.ok(chunk.text.includes('aura level 2')); assert.ok(chunk.text.includes('boots, tp'));
});
test('each standalone chunk has a fixed budget and keeps the current event before old context', () => {
  const current = { seq: 42, kind: 'death', text: 'current event' };
  const chunk = buildChunk(current, Array.from({ length: 100 }, (_, i) => ({ kind: 'chat', text: `${i}:` + 'old '.repeat(150) })), [], [], 2000);
  assert.ok(chunk.text.length <= 2000); assert.ok(chunk.text.includes('current event'));
  assert.ok(chunk.omitted > 0);
});

test('dialogue gets context space before frequent telemetry and stays inside the fixed budget', () => {
  const dialogue = [{ kind: 'reply', bot: 1, text: 'последняя реплика бота' }];
  const observations = Array.from({ length: 18 }, () => ({ kind: 'position', text: 'coordinates '.repeat(100) }));
  const chunk = buildChunk({ seq: 42, bot: 1, kind: 'inventory' }, [], observations, [], 1200, dialogue);
  const records = chunk.text.split('\n').map(JSON.parse);
  assert.ok(records.some(record => record.type === 'recent-dialogue' && record.data.text === dialogue[0].text));
  assert.ok(chunk.text.length <= 1200);
});

test('unchanged inventory refreshes observations without triggering another inventory comment', () => {
  const observations = new Observations();
  const inventory = { bot: 1, kind: 'inventory', owner: 0, unitType: 99, text: 'boots', time: 10, extra: 'unit=42;refresh=false' };
  assert.equal(observations.add(inventory), true);
  assert.equal(observations.add({ ...inventory, time: 70 }), false);
  assert.equal(observations.forBot(1, 70)[0].time, 70);
  assert.equal(observations.add({ ...inventory, text: 'boots, tp', time: 75 }), true);
});
