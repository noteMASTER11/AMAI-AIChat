import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { compile } from './jass.mjs';
import { groupNatives } from './warcraft-natives.mjs';
import { makeAction } from '../../bridge/actions.mjs';

export function chatActionsGame({ action = 4, source = 2, owner = 0, expired = false, threatened = false, units = [] } = {}) {
  const cache = new Map();
  const read = (_, section, key) => cache.get(`${section}:${key}`) ?? 0;
  const store = (_, section, key, value) => cache.set(`${section}:${key}`, value);
  for (const [key, value] of Object.entries({ id: 1, action, source, owner, x: 500, y: 400, expires: expired ? 99 : 130, observed: 100 })) store(null, '1', key, value);
  store(null, 'clock', 'now', 100);
  const reports = [], orders = [], observed = [];
  let incoming = '', tooltip = '';
  const state = {
    ...groupNatives(), llmActionCache: {}, llmTaskLast: 0, llmTaskId: 0, llmTaskAction: 0, llmTaskX: 0, llmTaskY: 0, llmTaskExpires: 0, llmTaskObserved: 0, llmTaskOwner: 0, llmTaskSource: 0,
    llm_chat_enabled: true, break_attack: false, ai_player: 1, town_threatened: threatened,
    llmSession: '123456789', llmClock: {}, llmTick: 1, llmActionId: Array(24).fill(0), llmActionStatus: Array(24).fill(0),
    MAP_CONTROL_COMPUTER: 1, PLAYER_SLOT_STATE_PLAYING: 1, ai_time: 100,
    unit_harassing: new Set(), unit_healing: new Set(), home_location: { x: 0, y: 0 },
    UNIT_TYPE_PEON: 'worker', UNIT_TYPE_HERO: 'hero', UNIT_TYPE_STRUCTURE: 'building', UNIT_TYPE_SUMMONED: 'summoned', UNIT_TYPE_ATTACKS_GROUND: 'attack', UNIT_TYPE_ATTACKS_FLYING: 'attackAir', UNIT_STATE_LIFE: 'life', UNIT_STATE_MAX_LIFE: 'maxLife',
    Int2Str: String, I2S: String, S2I: n => parseInt(n) || 0, S2R: Number, StringLength: s => s.length, SubString: (s, a, b) => s.slice(a, b),
    GetAiPlayer: () => 1, Player: n => n, GetBJMaxPlayers: () => 4,
    GetPlayerController: p => p === 0 ? 0 : 1, GetPlayerSlotState: () => 1,
    IsPlayerAlly: (a, b) => a === b || a === 1 && b === 2 || a === 2 && b === 1,
    GetStoredInteger: read, GetStoredReal: read, GetStoredString: (...args) => read(...args) || '',
    StoreInteger: store, StoreReal: store, StoreString: store,
    TimerGetElapsed: () => read(null, 'clock', 'now'),
    BlzGetAbilityTooltip: () => tooltip, BlzSetAbilityTooltip: (_, s) => { tooltip = s; },
    Preloader: () => { tooltip = incoming; },
    CommandAI: (_, id, n) => { if (id === 95) state.LLMTaskReceive(n); },
    LLMRecord: (...args) => observed.push(args),
    FromGroupAndGhoulsAM: () => {}, CaptainIsEmpty: () => false,
    CaptainGoHome: () => orders.push('home'), CaptainIsHome: () => true,
    CaptainAttack: (x, y) => orders.push([x, y]), CaptainAtGoal: () => true,
    GetOwnStrength: () => 100, GetLocationEnemyStrength: () => 0,
    Sleep: () => { store(null, 'clock', 'now', read(null, 'clock', 'now') + 1); state.onSleep?.(); },
    GroupEnumUnitsOfPlayer: g => units.forEach(u => g.add(u)),
    UnitAlive: u => u.alive !== false, IsUnitType: (u, type) => !!u[type], IsUnitHidden: () => false,
    GetUnitState: (u, key) => u[key] ?? 100,
    RemoveGuardPosition: u => orders.push(['release', u.name]), RecycleGuardPosition: u => orders.push(['recycle', u.name]),
    IssuePointOrder: (u, order, x, y) => { orders.push([u.name, order, x, y]); return true; },
    GetLocationX: l => l.x, GetLocationY: l => l.y, IsVisibleToPlayer: () => true,
    cache, orders, observed, reports,
  };
  const sourceText = readFileSync(new URL('../../LLMTasks.eai', import.meta.url), 'utf8') + readFileSync(new URL('../../LLMTaskExecute.eai', import.meta.url), 'utf8') + readFileSync(new URL('../../LLMChat.eai', import.meta.url), 'utf8');
  vm.runInContext(['LLMTaskReset', 'LLMTaskReport', 'LLMTaskReceive', 'LLMTaskScout', 'LLMTaskExecute', 'LLMField', 'LLMActionPoll'].map(n => compile(sourceText, n)).join('\n'), vm.createContext(state));
  return Object.assign(state, {
    value: key => read(null, '1', key),
    advance: seconds => store(null, 'clock', 'now', read(null, 'clock', 'now') + seconds),
    receiveFile(task) { incoming = /BlzSetAbilityTooltip\(\d+, "([^"]+)"/.exec(makeAction(task, 1, 110))[1]; store(null, '1', 'id', 0); state.LLMActionPoll(); incoming = ''; },
  });
}
