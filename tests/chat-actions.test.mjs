import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatActionsGame as game } from './helpers/chat-actions-game.mjs';
describe('AMAI chat task acceptance', () => {
  it('Given a new collector session, enabling chat resets old task IDs and cancels previous goals', () => {
    const state = game(); state.llmTaskLast = 10; state.llmTaskId = 8;
    state.LLMTaskReset(); state.LLMTaskReceive(1);
    assert.equal(state.value('out-status'), 1); assert.equal(state.llmTaskId, 1);
  });
  it('Given an enemy retreat request, AMAI rejects it without interrupting the army', () => {
    const state = game({ action: 1, source: 0 }); state.LLMTaskReceive(1);
    assert.equal(state.value('out-status'), 4); assert.equal(state.break_attack, false);
  });
  it('Given a timely allied attack request, AMAI accepts the fixed point and interrupts its previous goal', () => {
    const state = game(); state.LLMTaskReceive(1);
    assert.equal(state.llmTaskAction, 4); assert.equal(state.llmTaskX, 500); assert.equal(state.break_attack, true);
    assert.equal(state.value('out-status'), 1);
  });
  it('Given an expired request or a threatened home, AMAI rejects attack requests', () => {
    for (const options of [{ expired: true }, { threatened: true }]) {
      const state = game(options); state.LLMTaskReceive(1);
      assert.equal(state.value('out-status'), 4); assert.equal(state.llmTaskAction, 0);
    }
  });
});

describe('AMAI task execution and map acknowledgement', () => {
  it('Given a valid mailbox task, the map dispatches it, AI executes a fixed point and reports completion', () => {
    const state = game();
    state.receiveFile({ session: '123456789', id: 1, bot: 1, source: 2, owner: 0, action: 'attack', x: 500, y: 400, observedAt: 100, expires: 130 });
    assert.equal(state.value('out-status'), 1);
    assert.equal(state.LLMTaskExecute(), true);
    state.LLMActionPoll();
    assert.deepEqual(state.orders[0], [500, 400]);
    assert.equal(state.value('out-status'), 3);
    assert.match(state.observed.at(-1)[8], /status=completed/);
  });
  it('Given an attack whose observation aged during delivery, AI scouts without moving the whole army', () => {
    const state = game({ units: [{ name: 'hero', hero: true, attack: true }, { name: 'worker', worker: true, attack: true }, { name: 'footman', attack: true }] });
    state.LLMTaskReceive(1); state.advance(8); state.LLMTaskExecute();
    assert.ok(state.orders.some(o => o[0] === 'footman' && o[1] === 'move'));
    assert.ok(!state.orders.some(o => o[0] === 500 || o[0] === 'hero' || o[0] === 'worker'));
    assert.equal(state.unit_harassing.size, 0);
    assert.equal(state.value('out-status'), 3);
  });
  it('Given a new threat during a goal, AMAI cancels it and returns control to its normal defense', () => {
    const state = game(); state.CaptainAtGoal = () => false;
    state.onSleep = () => { state.town_threatened = true; };
    state.LLMTaskReceive(1); state.LLMTaskExecute();
    assert.equal(state.value('out-status'), 5); assert.equal(state.llmTaskId, 0);
  });
  it('Given an overwhelming visible force, AMAI rejects a requested attack before issuing orders', () => {
    const state = game(); state.GetLocationEnemyStrength = () => 500;
    state.LLMTaskReceive(1); state.LLMTaskExecute();
    assert.equal(state.value('out-status'), 4); assert.equal(state.orders.length, 0);
  });
});
