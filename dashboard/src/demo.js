import { MonitorStore } from '../../bridge/monitor-store.mjs';

export function demoSnapshot() {
  const now = Date.now();
  const store = new MonitorStore();
  const session = '834291507612';
  const bots = [
    { slot: 1, name: 'Grubby.exe', race: 2, id: 'tryhard', style: 'Самодовольный задрот. Микро, фокус и забытые ТП.' },
    { slot: 2, name: 'coil_nova', race: 3, id: 'tilter', style: 'Вспыльчивый игрок. Сарказм и оправдания после ошибок.' },
    { slot: 3, name: 'no_tp_no_cry', race: 4, id: 'troll', style: 'Сухой тролль. Короткие насмешки по делу.' },
  ];
  const add = (seconds, kind, data) => store.ingest({ at: new Date(now - seconds * 1000).toISOString(), kind, data });
  bots[0].allies = [1, 3]; bots[1].allies = [0, 2]; bots[2].allies = [1, 3];
  const observations = [
    { session, seq: 78, kind: 'inventory', bot: 2, owner: 0, unitType: 1010, unitName: 'Рыцарь смерти', time: 1120, text: '1:Сапоги-скороходы [charges=0]; 2:Свиток телепортации [charges=1]; 3:Когти атаки +6; 4:empty; 5:empty; 6:empty', extra: 'unit=42' },
    { session, seq: 79, kind: 'abilities', bot: 2, owner: 2, unitType: 1010, unitName: 'Рыцарь смерти', time: 1120, text: 'Аура смерти [level=2]; Лик смерти [level=2]', extra: 'unit=42' },
  ];
  add(920, 'bridge-start', { pid: 21480, model: 'gpt-6.1-sol', effort: 'low', mode: 'llm' });
  add(910, 'game-session', session);
  add(905, 'transport-verified', { session, seq: 5 });
  add(900, 'model-ready', { model: 'gpt-6.1-sol', effort: 'low' });
  for (let i = 0; i < 21; i++) {
    const seconds = 880 - i * 40;
    const bot = bots[i % 3];
    const seq = i + 10;
    add(seconds, 'game-event', { session, seq, kind: i % 3 === 0 ? 'chat' : 'death', bot: bot.slot, human: 0, owner: 0, killer: bot.slot, unitName: ['Рыцарь смерти', 'Охотник на демонов', 'Горный король'][i % 3], level: 3, time: 1080 - seconds, text: ['Ну и где твой легендарный микро?', 'Лич оставил последнее слово за собой.', 'Сейчас вернусь с экспа.'][i % 3] });
    add(seconds - 0.1, 'model-request', { session, seq, bot: bot.slot, threadId: `demo-${i}`, model: 'gpt-6.1-sol', effort: 'low', historyEntries: 12 + i % 8 });
    add(seconds - 1.5, 'token-usage', { session, seq, bot: bot.slot, threadId: `demo-${i}`, total: { inputTokens: 6000 + i * 45, outputTokens: 38 + i % 15, totalTokens: 6038 + i * 45 + i % 15, cachedInputTokens: i > 2 ? 4096 : 0, reasoningOutputTokens: 8 + i % 5 } });
    add(seconds - 2.4, 'generation-finished', { session, seq, bot: bot.slot, status: 'published', durationMs: 1800 + i * 91 % 2200 });
    add(seconds - 2.5, 'reply-published', { session, seq, bot: bot.slot, poll: 300 + i * 8, purpose: 'llm', text: ['ДК снова без ТП. Ты его в таверну по абонементу водишь?', 'Эксп поставил, а охранять кто будет — чат?', 'Микро на уровне: выделил героя и проводил взглядом.'][i % 3] });
    add(seconds - 4, 'reply-acknowledged', { session, poll: 300 + i * 8, delayMs: 1500 });
  }
  add(27, 'game-event', { session, seq: 74, kind: 'revive', bot: 1, unitName: 'Рыцарь смерти', level: 3, owner: 0, killer: -1, time: 1103, text: 'Лорд Тёмный Клинок' });
  add(18, 'game-event', { session, seq: 75, kind: 'chat', bot: -1, human: 0, time: 1112, text: 'Ну всё, ДК вернулся. Попробуй повторить.' });
  add(14, 'reply-published', { session, seq: 75, bot: 1, poll: 2241, purpose: 'llm', text: 'Реснул? Спасибо за доставку. На этот раз ТП хоть купи.' });
  add(12, 'reply-acknowledged', { session, poll: 2241, delayMs: 1950 });
  add(7, 'game-event', { session, seq: 76, kind: 'death', bot: 2, human: 0, owner: 0, killer: 2, time: 1123, unitName: 'Горный король', level: 4, text: 'Бор Молот Бури' });
  add(2, 'generation-started', { session, seq: 76, bot: 2, kind: 'death', startedAt: now - 2000 });
  for (const event of observations) add(6, 'game-event', event);
  add(5, 'event-assessment', { session, seq: 76, bot: 2, valence: -0.65, target: 0, delta: 0.04, coefficient: 0.52 });
  add(4, 'reply-published', { session, seq: 80, bot: 1, recipient: 3, channel: 'team', recipients: [1, 3], poll: 2248, purpose: 'llm', text: 'на эксп не лезь один, я с блейдом подойду. потом уже геройствуй))' });
  add(3, 'reply-acknowledged', { session, poll: 2248, visible: false, delayMs: 1000 });
  return {
    records: store.records, summary: store.summary(now),
    state: { knowledgePolicy: 3, actions: { tasks: [{ id: 1, bot: 2, source: 0, created: 1100, expires: 1150, observedAt: 1100, action: 'defend', status: 'running', reason: 'started', x: 512, y: 1024 }], trust: { '2:0': 0.2 } }, updatedAt: new Date(now).toISOString(), pid: 21480, uptimeSeconds: 924, model: 'gpt-6.1-sol', effort: 'low', mode: 'llm', modelReady: true, verified: true, session, bots, human: { slot: 0, name: 'Ты' }, observations, relationships: { session, personalities: { 1: { label: 'toxic', temperament: -0.8, positiveGain: 0.4, negativeGain: 1.6 }, 2: { label: 'friendly', temperament: 0.6, positiveGain: 1.45, negativeGain: 0.55 } }, pairs: { '1:0': -0.35, '2:0': 0.52, '1:3': 0.3, '3:1': 0.12, '2:1': -0.7 } }, queue: [{ seq: 77, kind: 'chat', bot: 3, text: 'А где мой эксп?', expires: now + 22000 }], activeRequest: { seq: 76, bot: 2, kind: 'death', startedAt: now - 2000 }, transport: { poll: 2254, gameSeconds: 1127, lastHeartbeatAt: now - 118, acknowledgedPoll: 2241, attempts: 1, pendingFiles: 0 }, memory: { rss: 52211712, heapUsed: 15308288 }, cpuPercent: 0.8, settings: { globalCooldownMs: 8000, botCooldownMs: 20000, timeoutMs: 20000, eventTtlMs: 20000, chatTtlMs: 45000 }, cooldowns: { globalUntil: now + 2500, bots: { 1: now + 14000 } } },
    health: { alive: true, snapshotAgeMs: 50, gameAgeMs: 118, error: null },
    installation: { status: 'installed', at: new Date(now - 1200000).toISOString() },
    limits: { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: Math.floor(now / 1000) + 86400 * 4 } } },
    monitor: { readonly: true, retained: store.records.length, historyTruncated: false },
  };
}
