import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { compile } from './jass.mjs';
const source = readFileSync(new URL('../../LLMChat.eai', import.meta.url), 'utf8');
export function llmChatGame({ humanAllied = false, channel = 'team', recipient = 3, inputText = 'hello', inputChannel = 'auto' } = {}) {
  const tooltip = { value: 'original' };
  const shown = [], overlays = [], observed = [], journal = [], preloads = [];
  const allies = new Set(['1:3', '3:1', ...(humanAllied ? ['0:1', '1:0'] : [])]);
  const frames = new Map([['UpperButtonBarMenuButton', { enabled: true, visible: false }], ['UpperButtonBarAlliesButton', { enabled: false, visible: false }]]);
  const keys = new Set();
  const timers = new Map();
  const state = {
    llmActive: true, llmSeq: 1, llmTick: 0, llmLastReply: 0, llmLastVisible: 0,
    llmSession: '123456789', llmHuman: 0, llmClock: {}, llmRecords: [], llmRecordKinds: [],
    llmInputChannel: inputChannel,
    llmInputChoice: '', llmInputOpen: false, llmEnterDown: false, llmInputOpenedAt: 0, llmInputSubmittedAt: -10,
    llmInputLabel: { visible: false, text: '' }, now: 10, keys, frames, meta: 0, key: 'return',
    llmInputBox: { visible: false, focused: false }, llmInputBackdrop: { visible: false }, llmInputPresentationTimer: {},
    llmComposerActive: false, llmLastComposerText: '', llmLastComposerAt: -10,
    llmForwardedChat: '', forwardedCommands: [],
    ExecuteFunc: name => state.forwardedCommands.push({ name, text: state.llmForwardedChat }),
    submittedText: inputText, nativeDismissals: 0,
    TimerStart: (timer, seconds, periodic, callback) => timers.set(timer, callback),
    presentInput: () => { const callback = timers.get(state.llmInputPresentationTimer); timers.delete(state.llmInputPresentationTimer); callback?.(); },
    BlzGetTriggerFrame: () => state.llmInputBox, BlzGetTriggerFrameText: () => state.submittedText,
    BlzFrameSetFocus: (frame, focused) => { frame.focused = focused; },
    BlzFrameClick: () => { state.nativeDismissals++; }, ForceUICancel: () => {},
    OSKEY_RETURN: 'return', OSKEY_ESCAPE: 'escape', OSKEY_LSHIFT: 'left-shift', OSKEY_RSHIFT: 'right-shift',
    BlzIsKeyPressed: key => keys.has(key), BlzIsLocalClientActive: () => true,
    BlzGetTriggerPlayerKey: () => state.key, BlzGetTriggerPlayerMetaKey: () => state.meta,
    BlzFrameGetEnable: frame => frame.enabled, BlzFrameSetEnable: (frame, enabled) => { frame.enabled = enabled; },
    BlzFrameIsVisible: frame => frame.visible,
    BlzFrameSetText: (frame, text) => { frame.text = text; }, BlzFrameSetVisible: (frame, visible) => { frame.visible = visible; },
    MAP_CONTROL_COMPUTER: 1, PLAYER_SLOT_STATE_PLAYING: 1,
    GetBJMaxPlayers: () => 4, Player: slot => slot, GetPlayerId: p => p,
    GetPlayerController: p => p === 0 ? 0 : 1, GetPlayerSlotState: () => 1,
    IsPlayerAlly: (a, b) => a === b || allies.has(`${a}:${b}`),
    GetPlayerName: p => `Player ${p}`, GetPlayerRace: () => 1, GetHandleId: value => value,
    BlzGetAbilityTooltip: () => tooltip.value, BlzSetAbilityTooltip: (_, value) => { tooltip.value = value; },
    Preloader: () => { tooltip.value = `123456789|1|1|20|hello|1|${channel}|${recipient}`; },
    TimerGetElapsed: () => state.now, StringLength: value => value.length,
    R2I: Math.trunc, StringCase: (value, upper) => upper ? value.toUpperCase() : value.toLowerCase(),
    GetEventPlayerChatString: () => inputText, GetTriggerPlayer: () => 0, GetLocalPlayer: () => 0,
    SubString: (value, a, b) => value.slice(a, b), S2I: value => parseInt(value, 10) || 0, S2R: Number,
    I2S: String, R2S: String, ModuloInteger: (a, b) => a % b,
    PreloadGenClear: () => {}, PreloadGenStart: () => {}, PreloadGenEnd: () => {}, Preload: text => preloads.push(text),
    BlzGetLocale: () => 'deDE',
    BlzGetFrameByName: name => frames.get(name) || null,
    LLMActionPoll: () => {},
    LLMColor: () => 'ffffff', LLMSampleStep: () => {},
    DisplayTimedTextToPlayer: (player, x, y, duration, text) => { journal.push({ player, duration, text }); overlays.push([player, x, y, duration, text]); },
    BlzDisplayChatMessage: (speaker, channel, text) => shown.push({ speaker, channel, text }),
    GetOwningPlayer: unit => unit.owner, GetUnitTypeId: unit => unit.id, GetUnitName: unit => unit.name,
    IsUnitVisible: (unit, bot) => unit.visibleTo.includes(bot),
    IsUnitInvisible: () => false, IsUnitHidden: () => false,
    LLMRecord: (...args) => observed.push(args),
    shown, overlays, observed, journal, preloads,
  };
  vm.runInContext(['LLMEncode', 'LLMField', 'LLMJournal', 'LLMAllies', 'LLMObserve', 'LLMInputReady', 'LLMInputHasAlly', 'LLMInputCancel', 'LLMInputFinish', 'LLMInputCloseNative', 'LLMInputPresent', 'LLMInputSelect', 'LLMInputUpdate', 'LLMOnChatKey', 'LLMEnableAlliesMenu', 'LLMExportImportant', 'LLMPoll', 'LLMProcessHumanText', 'LLMOnChat', 'LLMOnComposerEnter'].map(name => compile(source, name)).join('\n'), vm.createContext(state));
  return state;
}
