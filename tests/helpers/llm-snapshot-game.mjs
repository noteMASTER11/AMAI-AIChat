import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { compile, zeros } from './jass.mjs';
import { groupNatives } from './warcraft-natives.mjs';
export function llmSnapshotGame(units) {
  const records = [], inventoryReads = [], skillReads = [];
  const state = {
    ...groupNatives(), llmCache: {}, llmClock: {}, llmTick: 0, llmForceCache: new Map(), zeros,
    ModuloInteger: (a,b) => a % b,
    UNIT_TYPE_HERO: 'hero', UNIT_TYPE_STRUCTURE: 'building', UNIT_TYPE_PEON: 'worker', UNIT_TYPE_DEAD: 'dead', UNIT_TYPE_TOWNHALL: 'hall', UNIT_STATE_MAX_LIFE: 'maxLife', PLAYER_STATE_RESOURCE_GOLD: 'gold', PLAYER_STATE_RESOURCE_LUMBER: 'lumber', MAP_CONTROL_COMPUTER: 1, PLAYER_SLOT_STATE_PLAYING: 1,
    Player: n => n, GetBJMaxPlayers: () => 3, GetPlayerController: n => n ? 1 : 0, GetPlayerSlotState: () => 1,
    GroupEnumUnitsOfPlayer: (g, p) => units.filter(u => u.owner === p).forEach(u => g.add(u)),
    GetPlayers: () => 3, IsMaskedToPlayer: () => true,
    GetUnitCurrentOrder: u => u.order || 0, OrderId: s => ({harvest:1,resumeharvesting:2,returnresources:3}[s] || 100),
    GetPlayerStartLocation: p => p, GetStartLocationX: p => p * 1000, GetStartLocationY: p => p * 1000,
    IsUnitType: (u, type) => !!u[type], GetUnitTypeId: u => u.id, GetHandleId: u => u.id,
    GetUnitX: u => u.x || 500, GetUnitY: u => u.y || 400,
    GetUnitName: u => u.name, GetHeroProperName: u => u.name, GetHeroLevel: () => 1,
    IsUnitVisible: (u, p) => u.visibleTo.includes(p), IsUnitInvisible: (u, p) => u.invisibleTo?.includes(p) || false, IsUnitHidden: u => u.hidden || false,
    LLMInventory: u => { inventoryReads.push(u.id); return 'items'; },
    LLMAbilities: u => { skillReads.push(u.id); return 'skills'; },
    LoadReal: () => 0, LoadStr: (t,p,c) => t instanceof Map ? t.get(`${p}:${c}`) || '' : '', HaveSavedReal: () => false, SaveReal: () => {}, SaveStr: (t,p,c,v) => { if(t instanceof Map)t.set(`${p}:${c}`,v); },
    LoadInteger: (t,p,c) => t.get(`${p}:${c}`) || 0, SaveInteger: (t,p,c,v) => t.set(`${p}:${c}`,v), HaveSavedInteger: (t,p,c) => t.has(`${p}:${c}`), FlushParentHashtable: t => t.clear(),
    TimerGetElapsed: () => 100, I2S: String, R2S: String,
    GetWidgetLife: () => 100, GetUnitState: () => 100, GetPlayerState: () => 1000,
    LLMRecord: (...args) => records.push(args),
    records, inventoryReads, skillReads,
  };
  const source = readFileSync(new URL('../../LLMChat.eai', import.meta.url), 'utf8');
  vm.runInContext(['LLMOwnForces','LLMSample'].map(n => compile(source,n)).join('\n'), vm.createContext(state));
  return state;
}
