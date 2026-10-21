import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strengthGame } from './helpers/strength-game.mjs';
import { llmChatGame } from './helpers/llm-chat-game.mjs';
import { llmSnapshotGame } from './helpers/llm-snapshot-game.mjs';

describe('Observer-specific fog of war', () => {
  it('Given unseen enemy troops, changing their hidden numbers does not change evaluated strength', () => {
    const game = strengthGame('REFORGED');
    const before = game.state.GetPlayerStrength(1);
    for (let i = 0; i < 20; i++) game.addUnit('FOOTMAN', { owner: 1, visible: false, food: 2 });
    assert.equal(game.state.GetPlayerStrength(1), before);
    game.addUnit('FOOTMAN', { owner: 1, visible: true, food: 2 });
    assert.ok(game.state.GetPlayerStrength(1) > before);
  });
  it('Given a visible enemy hero, its unobserved learned abilities do not affect strength', () => {
    const game = strengthGame('REFORGED');
    const hero = game.addUnit('Hmkg', { owner: 1, hero: true, level: 3, visible: true });
    const before = game.state.GetHeroStrength(hero);
    game.learnSkill(hero, 'THUNDER_BOLT', 3);
    assert.equal(game.state.GetHeroStrength(hero), before);
  });
  it('Given an ally without vision, private research and inventory are not delivered just because of alliance', () => {
    const game = llmChatGame();
    const hero = { owner: 1, id: 42, name: 'Hero', visibleTo: [] };
    game.LLMObserve('research', hero, 1, 'upgrade', '', true);
    game.LLMObserve('inventory', hero, 1, 'boots', '', false);
    assert.deepEqual(game.observed.map(row => row[1]), [1, 1]);
  });
  it('Given a hero hidden from every bot, sampling does not read its inventory or emit its location', () => {
    const game = llmSnapshotGame([{ owner: 0, id: 42, name: 'Hidden hero', hero: true, visibleTo: [] }]);
    game.LLMSample();
    assert.equal(game.inventoryReads.length, 0);
    assert.ok(!game.records.some(row => row[2] === 42));
  });
  it('Given a visible enemy hero and hidden building, sampling exports the hero but only its owner reads learned skills', () => {
    const game = llmSnapshotGame([{ owner: 0, id: 42, name: 'Enemy hero', hero: true, visibleTo: [1] }, { owner: 0, id: 43, name: 'Hidden building', building: true, visibleTo: [] }, { owner: 1, id: 44, name: 'Own hero', hero: true, visibleTo: [] }]);
    game.LLMSample();
    assert.ok(game.records.some(row => row[0] === 'sighting' && row[1] === 1 && row[2] === 42));
    assert.ok(!game.records.some(row => row[2] === 43));
    assert.deepEqual(game.skillReads, [44]);
    assert.ok(game.records.filter(row => row[0] === 'self-state').every(row => row[1] === row[5]));
  });
});
