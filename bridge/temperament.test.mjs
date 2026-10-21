import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Relationships } from './context.mjs';

test('starting personalities and directed affinities are stable across restarts and different each match', () => {
  const state = new Relationships();
  for (let bot = 1; bot < 12; bot++) state.initialize('123456789', bot, [0, 1, 2, 3]);
  const saved = state.toJSON();
  const restored = new Relationships(saved);
  restored.initialize('123456789', 1, [0, 1, 2, 3]);
  assert.deepEqual(restored.toJSON(), saved);
  assert.notEqual(state.get('123456789', 1, 0), 0);
  state.initialize('987654321', 1, [0]);
  assert.notDeepEqual(state.personality('123456789', 1), state.personality('987654321', 1));
});

test('toxic bots resist praise, friendly bots resist insults; a strong insult still has impact', () => {
  const state = new Relationships();
  for (let bot = 1; bot < 24; bot++) state.initialize('123456789', bot, [0]);
  const ids = Array.from({ length: 23 }, (_, i) => i + 1).sort((a, b) => state.personality('123456789', a).temperament - state.personality('123456789', b).temperament);
  const toxic = ids[0], friendly = ids.at(-1);
  const change = (bot, impact) => {
    const before = state.get('123456789', bot, 0);
    return state.apply('123456789', bot, `impact-${impact}`, { valence: 0, relationshipTarget: 0, relationshipImpact: impact }) - before;
  };
  assert.ok(change(toxic, 0.6) < change(friendly, 0.6));
  assert.ok(Math.abs(change(toxic, -0.6)) > Math.abs(change(friendly, -0.6)));
  assert.ok(Math.abs(change(friendly, -1)) > 0.1);
});
