import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generationRunner } from '../tests/helpers/bridge-generation.mjs';

test('an immediately skipped event releases the generation slot for the next player message', async () => {
  const runner = generationRunner(() => {});
  runner.finishImmediately();

  await runner.start();
  assert.equal(runner.idle(), true);

  await runner.start();
  assert.equal(runner.idle(), true);
});

test('a pending model request occupies its generation slot until it settles', async () => {
  let finish;
  const reply = new Promise(resolve => { finish = resolve; });
  const runner = generationRunner(() => reply);

  const generation = runner.start();
  await Promise.resolve();
  assert.equal(runner.idle(), false);

  finish();
  await generation;
  assert.equal(runner.idle(), true);
});
