import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../../bridge/main.mjs', import.meta.url), 'utf8');
const launch = source.match(/if \(event\) (generation = [^\r\n]+);/)?.[1];
assert.ok(launch, 'Missing production generation launch');
export function generationRunner(job) {
  const state = { event: {}, generation: null };
  state.generateOne = async () => {
    try { await job(); }
    finally { state.generation = null; }
  };
  return {
    start() { vm.runInNewContext(launch, state); return state.generation; },
    idle: () => state.generation === null,
    finishImmediately() {
      state.generateOne = async () => { state.generation = null; };
    },
  };
}
