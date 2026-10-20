import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const native = process.env.AMAI_STORMLIB || 'D:/ChatGPT/Projects/Quenching-Repair-20261020/QMC3.6.1-Win/resources/app.asar.unpacked/node_modules/@jamiephan/stormlib/prebuilds/win32-x64/@jamiephan+stormlib.node';
const { Archive } = require(native);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceMap = process.argv[2] || path.join(process.env.USERPROFILE, 'Documents/Warcraft III/Maps/Download/Season1/(2)Amazonia.w3x');
const output = path.join(repo, 'runtime/AMAI-LLM-Probe.w3x');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.copyFileSync(sourceMap, output);
const archive = new Archive(); archive.SFileOpenArchive(output, 0);
const read = name => { const file = archive.SFileOpenFileEx(name, 0); try { return file.readFileAll().toString('utf8'); } finally { file.SFileCloseFile(); } };
const namespace = source => source.replace(/\bLLM(?=[A-Z])/g, 'ProbeLLM').replace(/\bllm(?=[A-Z])/g, 'probeLlm');
let script = read('war3map.j');
if (!/endglobals/.test(script) || !/function main takes/.test(script)) throw new Error('Unsupported probe base map script');
const globals = namespace(fs.readFileSync(path.join(repo, 'LLMChatGlobals.eai'), 'utf8'));
const functions = namespace(fs.readFileSync(path.join(repo, 'LLMChat.eai'), 'utf8'));
const probe = `
function ProbeHeroEvent takes nothing returns nothing
    local unit hero = CreateUnit(Player(0), 'Udea', 0, 0, 0)
    local unit killer = CreateUnit(Player(1), 'hfoo', 100, 0, 0)
    call DisplayTimedTextToPlayer(Player(0),0,0,20,"Probe: scripted hero death follows. This is a test scenario.")
    call UnitDamageTarget(killer, hero, 99999, true, false, ATTACK_TYPE_CHAOS, DAMAGE_TYPE_UNIVERSAL, WEAPON_TYPE_WHOKNOWS)
    set hero = null
    set killer = null
endfunction
function ProbeStart takes nothing returns nothing
    call FogEnable(false)
    call FogMaskEnable(false)
    call ProbeLLMSetEnabled(true)
    call DisplayTimedTextToPlayer(Player(0),0,0,60,"AMAI LLM PROBE: wait for the bridge acknowledgement. Type in chat to test generated responses.")
    call TimerStart(CreateTimer(), 12.0, false, function ProbeHeroEvent)
endfunction
`;
script = script.replace('endglobals', globals + '\nendglobals');
script = script.replace('function main takes', functions + '\n' + probe + '\nfunction main takes');
script = script.replace(/call SetPlayerController\(\s*Player\(1\),\s*MAP_CONTROL_USER\s*\)/g, 'call SetPlayerController(Player(1), MAP_CONTROL_COMPUTER)');
script = script.replace(/call SetPlayerSlotAvailable\(\s*Player\(1\),\s*MAP_CONTROL_USER\s*\)/g, 'call SetPlayerSlotAvailable(Player(1), MAP_CONTROL_COMPUTER)');
script = script.replace(/call MeleeInitVictoryDefeat\([^\n]*/g, '// Probe intentionally does not end on victory/defeat.');
script = script.replace(/call InitGlobals\([^\n]*/, '$&\n    call ProbeLLMInit()\n    call TimerStart(CreateTimer(), 4.0, false, function ProbeStart)');
const sourceFile = path.join(repo, 'runtime/probe-war3map.j');
fs.writeFileSync(sourceFile, script);
try {
  archive.SFileAddFileEx(sourceFile, 'war3map.j', 0x80000200, 2, 2);
  const mapInfo = archive.SFileOpenFileEx('war3map.w3i', 0);
  const bytes = mapInfo.readFileAll(); mapInfo.SFileCloseFile();
  // Standard map header starts with format/editor metadata, then title.
  // Preserve metadata and change the WTS entry referred to by the existing title.
  const stringTable = read('war3map.wts');
  const mapTitle = script.match(/call SetMapName\(\s*"(TRIGSTR_\d+)"/);
  if (mapTitle) {
    const id = Number(mapTitle[1].slice(8));
    const changed = stringTable.replace(new RegExp(`(STRING ${id}\\s*\\{)[^}]*\\}`), '$1\r\nAMAI LLM Probe\r\n}');
    const wtsPath = path.join(repo, 'runtime/probe-war3map.wts');
    fs.writeFileSync(wtsPath, changed); archive.SFileAddFileEx(wtsPath, 'war3map.wts', 0x80000200, 2, 2);
  }
  archive.SFileFlushArchive();
  console.log(JSON.stringify({ output, sourceFile, mapInfoFormat: bytes.readUInt32LE(0), syntheticScenario: true }));
} finally { archive.SFileCloseArchive(); }
