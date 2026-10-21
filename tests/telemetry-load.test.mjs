import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { llmSnapshotGame } from './helpers/llm-snapshot-game.mjs';
import { llmChatGame } from './helpers/llm-chat-game.mjs';

describe('Bounded game telemetry work', () => {
  it('resetting a session leaves a usable cache after the parent table is flushed', () => {
    const game = llmSnapshotGame([]);
    game.LLMResetTelemetry();
    game.SaveReal(game.llmCache, 42, 1, 15);
    assert.equal(game.LoadReal(game.llmCache, 42, 1), 15);
  });
  it('multiple troops of one type produce one positive roster count without destroying their cache', () => {
    const game = llmSnapshotGame(Array.from({length: 6}, () => ({owner:1,id:1969711215,name:'Ghoul',visibleTo:[],order:1})));
    game.LLMOwnForces(1);
    const rows = game.records.filter(row => row[0] === 'own-forces');
    assert.equal(rows.length, 1);
    assert.equal(rows[0][3], 'Ghoul');
    assert.equal(rows[0][8], 'count=6;working=6');
    assert.notEqual(game.llmForceCache.destroyed, true);
  });
  it('unchanged buildings, inventories and troop rosters are not re-emitted at every sample', () => {
    const game = llmSnapshotGame([{owner:1,id:42,name:'Hero',hero:true,visibleTo:[]}, {owner:1,id:43,name:'Hall',building:true,visibleTo:[]}]);
    game.LLMSample(1);
    const before = game.records.length;
    game.now += 5;
    game.LLMSample(1);
    assert.deepEqual(game.records.slice(before).map(row => row[0]), ['self-state']);
  });
  it('a visible hero inventory is read once even when several bots can see that hero', () => {
    const game = llmSnapshotGame([{owner:0,id:42,name:'Hero',hero:true,visibleTo:[1,2]}]);
    game.LLMSample(0);
    assert.deepEqual(game.inventoryReads, [42]);
  });
  it('each collector tick scans at most one owner and does not rescan that owner before its deadline', () => {
    const game = llmSnapshotGame([]);
    game.LLMSampleStep();
    assert.deepEqual(game.enumerations, [0]);
    game.LLMSampleStep();
    game.LLMSampleStep();
    const before = game.enumerations.length;
    game.LLMSampleStep();
    assert.equal(game.enumerations.length, before);
    game.now += 5;
    game.LLMSampleStep();
    assert.equal(game.enumerations.at(-1), 0);
  });
  it('idle keyboard polling does not repeatedly touch or hide UI frames', () => {
    const game = llmChatGame();
    let reads = 0, writes = 0;
    game.BlzGetFrameByName = () => { reads++; return null; };
    game.BlzFrameSetVisible = () => { writes++; };
    game.BlzFrameSetFocus = () => { writes++; };
    for(let i=0;i<100;i++)game.LLMInputUpdate();
    assert.equal(reads, 0);
    assert.equal(writes, 0);
  });
  it('exports at most 64 recent plus 32 older important records in sequence order', () => {
    const game = llmChatGame();
    game.llmSeq = 256;
    game.llmRecordKinds = Array(256).fill('sighting');
    for(let seq=1;seq<=256;seq++)game.llmRecords[seq%256]=`AMAI1|123456789|${seq}|10|sighting|1|0|0||0|0|-1||`;
    game.llmRecordKinds[100] = 'chat';
    game.llmRecords[100] = 'AMAI1|123456789|100|10|chat|-1|0|0||0|0|-1|hello|';
    game.LLMPoll();
    const seqs = game.preloads.filter(row => typeof row==='string').map(row => Number(row.split('|')[2])).filter(seq => seq>0);
    assert.ok(seqs.length <= 96);
    assert.ok(seqs.includes(100));
    assert.deepEqual(seqs, [...seqs].sort((a,b)=>a-b));
  });
  it('a flood of important events still has a fixed export budget and retains the newest ones', () => {
    const game = llmChatGame();
    game.llmSeq = 256;
    game.llmRecordKinds = Array(256).fill('chat');
    for(let seq=1;seq<=256;seq++)game.llmRecords[seq%256]=`AMAI1|123456789|${seq}|10|chat|-1|0|0||0|0|-1|hello|`;
    game.LLMPoll();
    const seqs = game.preloads.filter(row => typeof row==='string').map(row => Number(row.split('|')[2])).filter(seq => seq>0);
    assert.equal(seqs.length, 96);
    assert.equal(seqs[0], 161);
    assert.equal(seqs.at(-1), 256);
  });
});
