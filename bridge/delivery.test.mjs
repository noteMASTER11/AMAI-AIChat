import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForGame } from './delivery.mjs';

test('a generated reply waits through a stale heartbeat and resumes without generating again', async () => {
  let now = 10000;
  let tick = { session: '123456789', wall: 5000 };
  let notices = 0;
  const result = await waitForGame({
    event: { session: '123456789', expires: 30000 },
    getTick: () => tick, getSession: () => '123456789', isRunning: () => true,
    now: () => now, sleep: async () => { now += 200; tick = { ...tick, wall: now }; },
    onWaiting: () => { notices++; },
  });
  assert.equal(result, 'ready');
  assert.equal(notices, 1);
});
test('waiting cannot release a stale response after a session change or module shutdown', async () => {
  for (const cause of ['session', 'shutdown']) {
    let session = '123456789', running = true;
    const result = await waitForGame({
      event: { session, expires: 30000 }, getTick: () => null,
      getSession: () => session, isRunning: () => running, now: () => 10000,
      sleep: async () => { if (cause === 'session') session = '555555555'; else running = false; },
    });
    assert.equal(result, 'cancelled');
  }
});
test('waiting expires with room for the game poll instead of publishing an already stale file', async () => {
  let now = 10000;
  const result = await waitForGame({
    event: { session: '123456789', expires: 14000 }, getTick: () => null,
    getSession: () => '123456789', isRunning: () => true,
    now: () => now, sleep: async () => { now += 1000; },
  });
  assert.equal(result, 'expired');
  assert.ok(now < 14000);
});
