import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { compile } from './jass.mjs';
const source = readFileSync(new URL('../../LLMChat.eai', import.meta.url), 'utf8');
export function llmChatGame({ humanAllied = false, channel = 'team', recipient = 3, inputText = 'hello', inputChannel = 'auto' } = {}) {
  const tooltip = { value: 'original' };
  const shown = [], overlays = [], observed = [], journal = [];
  const allies = new Set(['1:3', '3:1', ...(humanAllied ? ['0:1', '1:0'] : [])]);
  const state = {
    llmActive: true, llmSeq: 1, llmTick: 0, llmLastReply: 0, llmLastVisible: 0,
    llmSession: '123456789', llmHuman: 0, llmClock: {}, llmRecords: [],
    llmInputChannel: inputChannel,
    MAP_CONTROL_COMPUTER: 1, PLAYER_SLOT_STATE_PLAYING: 1,
    GetBJMaxPlayers: () => 4, Player: slot => slot, GetPlayerId: p => p,
    GetPlayerController: p => p === 0 ? 0 : 1, GetPlayerSlotState: () => 1,
    IsPlayerAlly: (a, b) => a === b || allies.has(`${a}:${b}`),
    GetPlayerName: p => `Player ${p}`, GetPlayerRace: () => 1, GetHandleId: value => value,
    BlzGetAbilityTooltip: () => tooltip.value, BlzSetAbilityTooltip: (_, value) => { tooltip.value = value; },
    Preloader: () => { tooltip.value = `123456789|1|1|20|hello|1|${channel}|${recipient}`; },
    TimerGetElapsed: () => 10, StringLength: value => value.length,
    R2I: Math.trunc, StringCase: (value, upper) => upper ? value.toUpperCase() : value.toLowerCase(),
    GetEventPlayerChatString: () => inputText, GetTriggerPlayer: () => 0, GetLocalPlayer: () => 0,
    SubString: (value, a, b) => value.slice(a, b), S2I: value => parseInt(value, 10) || 0, S2R: Number,
    I2S: String, R2S: String, ModuloInteger: (a, b) => a % b,
    PreloadGenClear: () => {}, PreloadGenStart: () => {}, PreloadGenEnd: () => {}, Preload: () => {},
    LLMColor: () => 'ffffff', LLMSample: () => {},
    DisplayTimedTextToPlayer: (player, x, y, duration, text) => { journal.push({ player, duration, text }); if (duration > 0) overlays.push([player, x, y, duration, text]); },
    BlzDisplayChatMessage: (speaker, channel, text) => shown.push({ speaker, channel, text }),
    GetOwningPlayer: unit => unit.owner, GetUnitTypeId: unit => unit.id, GetUnitName: unit => unit.name,
    IsUnitVisible: (unit, bot) => unit.visibleTo.includes(bot),
    LLMRecord: (...args) => observed.push(args),
    shown, overlays, observed, journal,
  };
  vm.runInContext(['LLMEncode', 'LLMField', 'LLMJournal', 'LLMChatChannel', 'LLMAllies', 'LLMObserve', 'LLMPoll', 'LLMOnChat'].map(name => compile(source, name)).join('\n'), vm.createContext(state));
  return state;
}
