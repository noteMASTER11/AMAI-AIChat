import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { compile } from './jass.mjs';
import { groupNatives } from './warcraft-natives.mjs';
export function llmSnapshotGame(units) {
  const records = [], inventoryReads = [], skillReads = [];
  const state = {
    ...groupNatives(), llmCache: {}, llmClock: {},
    UNIT_TYPE_HERO: 'hero', UNIT_TYPE_STRUCTURE: 'building', UNIT_TYPE_PEON: 'worker', UNIT_TYPE_DEAD: 'dead', UNIT_TYPE_TOWNHALL: 'hall', UNIT_STATE_MAX_LIFE: 'maxLife', PLAYER_STATE_RESOURCE_GOLD: 'gold', PLAYER_STATE_RESOURCE_LUMBER: 'lumber', MAP_CONTROL_COMPUTER: 1, PLAYER_SLOT_STATE_PLAYING: 1,
    Player: n => n, GetBJMaxPlayers: () => 3, GetPlayerController: n => n ? 1 : 0, GetPlayerSlotState: () => 1,
    GroupEnumUnitsOfPlayer: (g, p) => units.filter(u => u.owner === p).forEach(u => g.add(u)),
    GetPlayerStartLocation: p => p, GetStartLocationX: p => p * 1000, GetStartLocationY: p => p * 1000,
    IsUnitType: (u, type) => !!u[type], GetUnitTypeId: u => u.id, GetHandleId: u => u.id,
    GetUnitX: u => u.x || 500, GetUnitY: u => u.y || 400,
    GetUnitName: u => u.name, GetHeroProperName: u => u.name, GetHeroLevel: () => 1,
    IsUnitVisible: (u, p) => u.visibleTo.includes(p), IsUnitInvisible: (u, p) => u.invisibleTo?.includes(p) || false, IsUnitHidden: u => u.hidden || false,
    LLMInventory: u => { inventoryReads.push(u.id); return 'items'; },
    LLMAbilities: u => { skillReads.push(u.id); return 'skills'; },
    LoadReal: () => 0, LoadStr: () => '', HaveSavedReal: () => false, SaveReal: () => {}, SaveStr: () => {},
    TimerGetElapsed: () => 100, I2S: String, R2S: String,
    GetWidgetLife: () => 100, GetUnitState: () => 100, GetPlayerState: () => 1000,
    LLMRecord: (...args) => records.push(args),
    records, inventoryReads, skillReads,
  };
  vm.runInContext(compile(readFileSync(new URL('../../LLMChat.eai', import.meta.url), 'utf8'), 'LLMSample'), vm.createContext(state));
  return state;
}
