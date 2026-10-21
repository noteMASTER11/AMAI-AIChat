import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { llmChatGame } from './helpers/llm-chat-game.mjs';
import { routeHumanChat } from '../bridge/conversation.mjs';
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
    assert.equal(game.observed[0][8], 'input=auto;native=unknown;route-source=bridge-mode');

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

describe('Local chat hotkeys select recipients at input opening', () => {
  it('typed AMAI commands retain their text without becoming LLM conversation', () => {
    const game = llmChatGame({ humanAllied: true, inputText: '-zoom 2000' });
    game.LLMOnChatKey();
    game.presentInput();
    game.LLMOnComposerEnter();

    assert.deepEqual(game.forwardedCommands, [{ name: 'ZoomSet', text: '-zoom 2000' }]);
    assert.equal(game.llmForwardedChat, '');
    assert.equal(game.observed.length, 0);
  });
  it('Enter shows one team message through native chat, records TEAM in F12, and excludes enemies', () => {
    const game = llmChatGame({ humanAllied: true, inputText: 'прикрой' });
    game.LLMOnChatKey();
    game.presentInput();
    assert.equal(game.llmInputBox.focused, true);
    assert.equal(game.nativeDismissals, 1);

    game.LLMOnComposerEnter();

    assert.deepEqual(game.shown, [{ speaker: 0, channel: 1, text: 'прикрой' }]);
    assert.match(game.journal[0].text, /\[TEAM\]/);
    const route = routeHumanChat({ text: 'прикрой', extra: game.observed[0][8] }, new Map([[1, { slot: 1, allies: [0, 1] }], [2, { slot: 2, allies: [2] }]]), 0);
    assert.deepEqual(route.recipients, [1]);
    assert.equal(game.llmInputBox.visible, false);
  });
  it('Shift+Enter displays a public message after Shift is released', () => {
    const game = llmChatGame({ humanAllied: true, inputText: 'привет всем' });
    game.meta = 1;
    game.LLMOnChatKey();
    game.presentInput();
    game.meta = 0;
    game.LLMOnComposerEnter();

    assert.deepEqual(game.shown, [{ speaker: 0, channel: 0, text: 'привет всем' }]);
    assert.match(game.journal[0].text, /\[ALL\]/);
  });
  it('an explicit prefix changes both the rendered channel and LLM recipients', () => {
    const game = llmChatGame({ humanAllied: true, inputText: '@all привет' });
    game.LLMOnChatKey();
    game.presentInput();
    game.LLMOnComposerEnter();

    assert.deepEqual(game.shown, [{ speaker: 0, channel: 0, text: 'привет' }]);
    assert.match(game.observed[0][8], /^input=all;/);
  });
  it('Escape closes the composer and a stale frame event cannot send its text', () => {
    const game = llmChatGame({ humanAllied: true });
    game.LLMOnChatKey();
    game.presentInput();
    game.keys.add(game.OSKEY_ESCAPE);
    game.LLMInputUpdate();
    game.LLMOnComposerEnter();

    assert.equal(game.shown.length, 0);
    assert.equal(game.observed.length, 0);
    assert.equal(game.llmInputBox.focused, false);
  });
  it('an immediate duplicate native chat event cannot enqueue the custom submission again', () => {
    const game = llmChatGame({ humanAllied: true });
    game.LLMOnChatKey();
    game.presentInput();
    game.LLMOnComposerEnter();
    game.LLMOnChat();

    assert.equal(game.observed.length, 1);
    assert.equal(game.shown.length, 1);
  });
  it('Enter with a computer ally keeps the message away from enemy LLM contexts', () => {
    const game = llmChatGame({ humanAllied: true, inputText: 'прикрой базу' });
    game.keys.add(game.OSKEY_RETURN);
    game.LLMInputUpdate();
    game.LLMOnChat();

    const route = routeHumanChat({ text: 'прикрой базу', extra: game.observed[0][8] }, new Map([[1, { slot: 1, allies: [0, 1] }], [2, { slot: 2, allies: [2] }]]), 0);
    assert.equal(route.channel, 'team');
    assert.deepEqual(route.recipients, [1]);
    assert.equal(game.llmInputOpen, false);
  });
  it('Shift+Enter stays public even after Shift is released before submission', () => {
    const game = llmChatGame({ humanAllied: true });
    game.meta = 1;
    game.LLMOnChatKey();
    game.meta = 0;
    game.keys.clear();
    game.LLMInputUpdate();
    game.LLMOnChat();

    assert.match(game.observed[0][8], /^input=all;/);
  });
  it('submitting a public message does not reinterpret that same Enter press as a new team input', () => {
    const game = llmChatGame({ humanAllied: true });
    game.meta = 1;
    game.LLMOnChatKey();
    game.keys.add(game.OSKEY_RETURN);
    game.LLMOnChat();
    game.LLMInputUpdate();

    assert.equal(game.llmInputOpen, false);
    assert.equal(game.llmInputChoice, '');
  });
  it('Escape discards the previous channel before another input opens', () => {
    const game = llmChatGame({ humanAllied: true });
    game.LLMOnChatKey();
    assert.equal(game.llmInputChoice, 'team');
    game.keys.add(game.OSKEY_ESCAPE);
    game.LLMInputUpdate();
    assert.equal(game.llmInputChoice, '');
    game.keys.clear();
    game.meta = 1;
    game.LLMOnChatKey();

    assert.equal(game.llmInputChoice, 'all');
  });
  it('Enter without a computer ally remains public', () => {
    const game = llmChatGame();
    game.LLMOnChatKey();
    assert.equal(game.llmInputChoice, 'all');
  });
  it('menu navigation cannot select a chat route or show its label', () => {
    const game = llmChatGame({ humanAllied: true });
    game.frames.set('AllianceDialog', { visible: true });
    game.LLMOnChatKey();

    assert.equal(game.llmInputOpen, false);
    assert.equal(game.llmInputLabel.visible, false);
  });
});
