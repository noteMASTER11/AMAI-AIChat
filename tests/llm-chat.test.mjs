import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { llmChatGame } from './helpers/llm-chat-game.mjs';
describe('Local LLM chat channel and observation boundaries', () => {
  it('Given two enemy allies, when they exchange a team reply, then the game accepts it without showing the human', () => {
    const game = llmChatGame();

    game.LLMPoll();

    assert.equal(game.llmLastReply, 1);
    assert.equal(game.llmLastVisible, 0);
    assert.equal(game.shown.length, 0);
  });
  it('Given a human allied to the speaker, when a team reply arrives, then the human sees the team label', () => {
    const game = llmChatGame({ humanAllied: true });

    game.LLMPoll();

    assert.equal(game.llmLastVisible, 1);
    assert.deepEqual(game.shown, [{ speaker: 1, channel: 1, text: 'hello' }]);
    assert.equal(game.overlays.length, 0);
  });
  it('Given a public reply, when it arrives, then native chat receives the bot author and unprefixed text', () => {
    const game = llmChatGame({ channel: 'all', recipient: 0 });

    game.LLMPoll();

    assert.deepEqual(game.shown, [{ speaker: 1, channel: 0, text: 'hello' }]);
    assert.equal(game.overlays.length, 0);
  });
  it('Given an enemy recipient, when a forged team route arrives, then the game rejects its acknowledgement', () => {
    const game = llmChatGame({ recipient: 2 });

    game.LLMPoll();

    assert.equal(game.llmLastReply, 0);
    assert.equal(game.shown.length, 0);
  });
  it('Given an unseen unit, when ordinary or allied-only facts arrive, then only entitled observers receive them', () => {
    const game = llmChatGame();
    const hero = { owner: 1, id: 42, name: 'Hero', visibleTo: [] };

    game.LLMObserve('inventory', hero, 1, 'boots', '', false);
    game.LLMObserve('research', hero, 1, 'upgrade', '', true);

    assert.deepEqual(game.observed.filter(row => row[0] === 'inventory').map(row => row[1]), [1]);
    assert.deepEqual(game.observed.filter(row => row[0] === 'research').map(row => row[1]), [1, 3]);
  });
});
