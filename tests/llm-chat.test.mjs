import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { llmChatGame } from './helpers/llm-chat-game.mjs';
describe('Local LLM chat channel and observation boundaries', () => {
  it('Given a German game client, when polling telemetry, then every heartbeat includes its locale', () => {
    const game = llmChatGame();
    game.LLMPoll();
    assert.ok(game.preloads.some(row => typeof row === 'string' && row.includes('|tick|') && row.endsWith(',deDE')));
  });
  it('Given journal mirroring, when a visible reply is recorded, then it cannot create a permanent screen message', () => {
    const game = llmChatGame({ channel: 'all', recipient: 0 });
    game.LLMPoll();
    assert.equal(game.journal.length, 1);
    assert.ok(game.journal[0].duration > 0 && game.journal[0].duration <= 0.01);
  });
  it('Given two enemy allies, when they exchange a team reply, then the game accepts it without showing the human', () => {
    const game = llmChatGame();

    game.LLMPoll();

    assert.equal(game.llmLastReply, 1);
    assert.equal(game.llmLastVisible, 0);
    assert.equal(game.shown.length, 0);
    assert.equal(game.journal.length, 0);
  });
  it('Given a human allied to the speaker, when a team reply arrives, then the human sees the team label', () => {
    const game = llmChatGame({ humanAllied: true });

    game.LLMPoll();

    assert.equal(game.llmLastVisible, 1);
    assert.deepEqual(game.shown, [{ speaker: 1, channel: 1, text: 'hello' }]);
    assert.ok(game.overlays.every(call => call[3] > 0 && call[3] <= 0.01));
    assert.equal(game.journal.length, 1);
    assert.match(game.journal[0].text, /\[TEAM\].*Player 1.*hello/);
  });
  it('Given a public reply, when it arrives, then native chat receives the bot author and unprefixed text', () => {
    const game = llmChatGame({ channel: 'all', recipient: 0 });

    game.LLMPoll();

    assert.deepEqual(game.shown, [{ speaker: 1, channel: 0, text: 'hello' }]);
    assert.ok(game.overlays.every(call => call[3] > 0 && call[3] <= 0.01));
    assert.equal(game.journal.length, 1);
    assert.equal(game.journal[0].duration, 0.01);
    assert.match(game.journal[0].text, /\[0:10\] \[ALL\].*Player 1.*hello/);

    game.LLMPoll();
    assert.equal(game.journal.length, 1, 'a repeated poll must not duplicate the journal entry');
  });
  it('Given an enemy recipient, when a forged team route arrives, then the game rejects its acknowledgement', () => {
    const game = llmChatGame({ recipient: 2 });

    game.LLMPoll();

    assert.equal(game.llmLastReply, 0);
    assert.equal(game.shown.length, 0);
    assert.equal(game.journal.length, 0);
  });
  it('Given a human public message, when it is collected, then F12 receives the author without asserting an unavailable native channel', () => {
    const game = llmChatGame({ inputText: 'где твой тп?', inputChannel: 'all' });

    game.LLMOnChat();

    assert.equal(game.journal.length, 1);
    assert.match(game.journal[0].text, /\[CHAT\].*Player 0.*где твой тп\?/);
    assert.equal(game.shown.length, 0, 'the player already sent the real chat message');
    assert.ok(game.overlays.every(call => call[3] > 0 && call[3] <= 0.01));
  });
  it('Given an allied human, a logical bridge route is not presented as the native game channel', () => {
    const game = llmChatGame({ humanAllied: true, inputText: 'держи мейн' });
    game.LLMOnChat();
    assert.match(game.journal[0].text, /\[CHAT\]/);
    assert.equal(game.observed[0][8], 'input=auto;native=unknown');

    const publicGame = llmChatGame({ humanAllied: true, inputText: '@all привет' });
    publicGame.LLMOnChat();
    assert.match(publicGame.journal[0].text, /\[CHAT\].*привет/);
    assert.ok(!publicGame.journal[0].text.includes('@all'));
  });
  it('Given an LLM control command, when it is processed, then it is not mirrored as a dialogue message', () => {
    const game = llmChatGame({ inputText: '-llm all' });
    game.LLMOnChat();
    assert.equal(game.journal.filter(row => row.duration <= 0.01).length, 0);
  });
  it('Given an unseen unit, when ordinary or allied-only facts arrive, then only entitled observers receive them', () => {
    const game = llmChatGame();
    const hero = { owner: 1, id: 42, name: 'Hero', visibleTo: [] };

    game.LLMObserve('inventory', hero, 1, 'boots', '', false);
    game.LLMObserve('research', hero, 1, 'upgrade', '', true);

    assert.deepEqual(game.observed.filter(row => row[0] === 'inventory').map(row => row[1]), [1]);
    assert.deepEqual(game.observed.filter(row => row[0] === 'research').map(row => row[1]), [1]);
  });
});
