import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { demoSnapshot } from './demo.js';
import './style.css';

const nf = new Intl.NumberFormat('ru-RU');
const num = value => value == null ? '—' : nf.format(Math.round(value));
const short = value => value == null ? '—' : value >= 1000000 ? `${(value / 1000000).toFixed(2)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : num(value);
const ms = value => value == null ? '—' : value >= 1000 ? `${(value / 1000).toFixed(2)} с` : `${num(value)} мс`;
const clock = value => value ? new Date(value).toLocaleTimeString('ru-RU', { hour12: false }) : '—';
const duration = value => value == null ? '—' : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
const labels = { chat: 'CHAT', death: 'HERO DEATH', revive: 'REVIVE', hello: 'SESSION', bot: 'ROSTER', 'game-session': 'SESSION', 'model-ready': 'MODEL READY', 'token-usage': 'TOKENS', 'reply-published': 'BOT REPLY', 'reply-acknowledged': 'DELIVERED', 'generation-started': 'GENERATE', 'generation-finished': 'COMPLETE', 'model-request': 'REQUEST', 'bridge-start': 'BRIDGE UP', 'bridge-error': 'ERROR', 'generation-skipped': 'SKIPPED', 'transport-verified': 'VERIFIED' };
Object.assign(labels, { 'action-decision': 'TASK DECISION', 'action-published': 'TASK SENT', 'action-status': 'TASK STATUS', sighting: 'SIGHTING', 'self-state': 'OWN STATE', 'reply-deferred': 'WAIT GAME', 'reply-resumed': 'RESUMED', 'reply-shortened': 'TEXT FITTED' });
const typeOf = record => record.kind === 'game-event' ? record.data.kind : record.kind;
const tint = type => /error|skipped|unconfirmed/.test(type) ? 'red' : /death|revive|deferred|shortened/.test(type) ? 'amber' : /reply|delivered|acknowledged/.test(type) ? 'mint' : /token|model|generation/.test(type) ? 'violet' : 'cyan';
const botName = (id, bots) => bots.find(bot => bot.slot === Number(id))?.name || `Бот #${Number(id) + 1}`;
const raceName = value => ({ 1: 'HUMAN', 2: 'ORC', 3: 'UNDEAD', 4: 'NIGHT ELF' }[value] || `RACE ${value ?? '—'}`);
Object.assign(labels, { move: 'ORDER', position: 'POSITION', inventory: 'INVENTORY', abilities: 'ABILITIES', skill: 'SKILL', level: 'LEVEL UP', research: 'RESEARCH', 'build-start': 'BUILD START', 'build-finish': 'BUILD FINISH', 'build-cancel': 'BUILD CANCEL', 'upgrade-start': 'UPGRADE START', 'upgrade-finish': 'UPGRADE FINISH', 'upgrade-cancel': 'UPGRADE CANCEL', 'item-buy': 'ITEM BUY', 'item-sell': 'ITEM SELL', 'item-pickup': 'ITEM PICKUP', 'item-drop': 'ITEM DROP', 'item-use': 'ITEM USE', 'event-assessment': 'ASSESSMENT', 'bot-dialogue': 'BOT DIALOGUE' });

function Icon({ name, size = 18 }) {
  const paths = { activity: 'M2 12h4l3-8 6 16 3-8h4', chat: 'M21 11a8 8 0 0 1-8 8H6l-4 3 1-7a8 8 0 1 1 18-4Z', terminal: 'm5 7 5 5-5 5m8 0h6', pause: 'M8 5v14M16 5v14', play: 'm8 4 12 8-12 8Z', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', close: 'm6 6 12 12M6 18 18 6', chevron: 'm9 5 7 7-7 7', chip: 'M7 7h10v10H7ZM9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4', cross: 'M12 2v5m0 10v5M2 12h5m10 0h5M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0', file: 'M6 2h9l4 4v16H5V2Zm8 0v6h5M8 12h8m-8 4h8' };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.activity} /></svg>;
}
function Badge({ children, color = 'muted', dot = false }) { return <span className={`badge ${color}`}>{dot && <i className="dot" />}{children}</span>; }
function Panel({ id, title, code, children, right, className = '' }) { return <section id={id} className={`panel ${className}`}><div className="panel-heading"><h2><span className="section-code">{code}</span>{title}</h2>{right}</div>{children}</section>; }
function Empty({ title, detail, icon = 'activity' }) { return <div className="empty"><div className="empty-reticle"><Icon name={icon} size={24} /></div><strong>{title}</strong><span>{detail}</span></div>; }
function Spark({ values, color = 'var(--cyan)', height = 34, area = true }) {
  const max = Math.max(1, ...values);
  const points = values.map((v, i) => `${i * 300 / Math.max(1, values.length - 1)},${height - 3 - v / max * (height - 8)}`).join(' ');
  return <svg className="spark" viewBox={`0 0 300 ${height}`} preserveAspectRatio="none" aria-label="Динамика"><line x1="0" x2="300" y1={height - 3} y2={height - 3} stroke="var(--line)" strokeDasharray="3 4" />{area && values.some(Boolean) && <polygon points={`0,${height} ${points} 300,${height}`} fill={color} opacity=".08" />}<polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}
function Instrument({ label, value, suffix, detail, color = 'white', values = [] }) { return <div className="instrument"><div className="instrument-label">{label}</div><div className={`instrument-value ${color}`}>{value}<small>{suffix}</small></div><div className="instrument-foot">{detail}</div><Spark values={values} color={`var(--${color === 'white' ? 'cyan' : color})`} /></div>; }

function useFeed() {
  const [feed, setFeed] = useState(null);
  const [connection, setConnection] = useState('connecting');
  useEffect(() => {
    const stream = new EventSource('/api/stream');
    stream.addEventListener('update', message => {
      try {
        const next = JSON.parse(message.data);
        setFeed(previous => {
          if (next.reset || !previous) return next;
          const existing = previous.records || [];
          const last = existing.at(-1)?.id || 0;
          const added = next.records.filter(r => r.id > last);
          return { ...next, records: added.length ? [...existing, ...added].slice(-4000) : existing };
        });
        setConnection('live');
      } catch { setConnection('error'); }
    });
    stream.onerror = () => setConnection('reconnecting');
    return () => stream.close();
  }, []);
  return { feed, connection };
}

function Inspector({ record, onClose }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);
  const [chunk, setChunk] = useState(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const key = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const nodes = [...ref.current.querySelectorAll('button')];
        const first = nodes[0], last = nodes.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [onClose]);
  return <div className="inspector-shade" onClick={onClose}><aside className="inspector" role="dialog" aria-modal="true" aria-labelledby="inspector-title" tabIndex={-1} ref={ref} onClick={e => e.stopPropagation()}><div className="panel-heading"><h2 id="inspector-title">Сырые данные <span className="mono muted">#{record.id}</span></h2><button className="icon-button" onClick={onClose} aria-label="Закрыть инспектор"><Icon name="close" /></button></div><div className="inspect-meta"><Badge color={tint(typeOf(record))}>{labels[typeOf(record)] || typeOf(record)}</Badge><span className="mono">{clock(record.at)}</span></div><pre>{chunk ?? JSON.stringify(record, null, 2)}</pre>{record.data?.chunkFile && !chunk && <button className="button" onClick={async () => { try { const response = await fetch(`/api/chunk/${record.data.requestId}`); setChunk(response.ok ? await response.text() : "Чанк недоступен"); } catch { setChunk("Нет соединения с локальным сервером"); } }}>Показать текст чанка</button>}<button className="button" onClick={async () => { try { await navigator.clipboard.writeText(chunk ?? JSON.stringify(record, null, 2)); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Скопировано' : chunk ? 'Копировать текст' : 'Копировать JSON'}</button></aside></div>;
}

function App() {
  const { feed, connection } = useFeed();
  const [demo, setDemo] = useState(new URLSearchParams(location.search).has('demo'));
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState(null);
  const [query, setQuery] = useState('');
  const [botFilter, setBotFilter] = useState('all');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const [tab, setTab] = useState('chat');
  const [selected, setSelected] = useState(null);
  const closeInspector = useCallback(() => setSelected(null), []);
  const [now, setNow] = useState(Date.now());
  const [visibleRows, setVisibleRows] = useState(150);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const demoFeed = useMemo(() => demoSnapshot(), [demo]);
  const live = demo ? demoFeed : feed;
  const data = paused ? frozen : live;
  const state = data?.state || {};
  const summary = data?.summary || { tokens: {}, latency: {}, series: [], retained: 0, events: 0, errors: 0, playerMessages: 0, botMessages: 0, delivered: 0, generations: 0 };
  const bots = state.bots || [];
  const records = data?.records || [];
  const health = data?.health || {};
  const currentState = live?.state || {};
  const currentHealth = live?.health || {};
  const bridgeLive = demo || (connection === 'live' && currentHealth.alive && now - Date.parse(currentState.updatedAt) < 5000);
  const gameAge = demo ? currentHealth.gameAgeMs : currentState.transport?.lastHeartbeatAt ? Math.max(0, now - currentState.transport.lastHeartbeatAt) : null;
  const gameLive = bridgeLive && gameAge != null && gameAge < 3000;
  const modelLive = bridgeLive && currentState.modelReady;
  const activeRequest = modelLive ? state.activeRequest : null;
  const tokens = summary.tokens;
  const quota = data?.limits?.rateLimits?.primary;
  const remaining = quota ? Math.max(0, 100 - quota.usedPercent) : null;
  const sessions = useMemo(() => [...new Set(records.map(r => r.data?.session).filter(Boolean))].reverse(), [records]);
  const filtered = useMemo(() => records.filter(r => {
    if (sessionFilter !== 'all' && r.data?.session !== sessionFilter && r.kind !== 'account-limits') return false;
    if (botFilter !== 'all' && String(r.data?.bot) !== botFilter) return false;
    if (query && !JSON.stringify(r).toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [records, sessionFilter, botFilter, query]);
  const messages = useMemo(() => filtered.filter(r => (r.kind === 'game-event' && r.data.kind === 'chat') || r.kind === 'reply-published').slice(-80).reverse(), [filtered]);
  const acknowledgements = useMemo(() => new Map(records.filter(r => r.kind === 'reply-acknowledged').map(r => [`${r.data.session}:${r.data.poll}`, r.data])), [records]);
  const assessments = records.filter(r => r.kind === 'event-assessment').slice(-8).reverse();
  const relationships = Object.entries(state.relationships?.pairs || {}).filter(([key]) => botFilter === 'all' || key.startsWith(`${botFilter}:`)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 18);
  const snapshots = (state.observations || []).filter(e => ['inventory', 'abilities'].includes(e.kind) && (botFilter === 'all' || e.bot === Number(botFilter))).slice(-18).reverse();
  const participant = slot => Number(slot) === state.human?.slot ? state.human.name || 'Ты' : botName(Number(slot), bots);
  const requests = useMemo(() => {
    const map = new Map();
    for (const r of filtered) if (['model-request', 'generation-finished', 'token-usage', 'first-token', 'event-assessment', 'reply-deferred', 'reply-resumed'].includes(r.kind)) {
      const key = `${r.data.session}:${r.data.seq}:${r.data.bot}`;
      const item = map.get(key) || { data: {}, id: r.id, at: r.at };
      item.data = { ...item.data, ...r.data }; item.record = r;
      map.set(key, item);
    }
    return [...map.values()].reverse().slice(0, 100);
  }, [filtered]);
  const events = useMemo(() => filtered.filter(r => {
    const type = typeOf(r);
    if (eventFilter === 'chat') return type === 'chat' || r.kind === 'reply-published';
    if (eventFilter === 'hero') return type === 'death' || type === 'revive';
    if (eventFilter === 'items') return type === 'inventory' || type.startsWith('item-');
    if (eventFilter === 'development') return ['skill', 'abilities', 'research', 'level'].includes(type);
    if (eventFilter === 'economy') return type.startsWith('build-') || type.startsWith('upgrade-');
    if (eventFilter === 'actions') return type.startsWith('action-');
    if (eventFilter === 'movement') return type === 'move' || type === 'position';
    if (eventFilter === 'error') return /error|skipped|unconfirmed|unavailable/.test(type);
    if (eventFilter === 'system') return r.kind !== 'game-event' && r.kind !== 'reply-published';
    return true;
  }).reverse(), [filtered, eventFilter]);
  const errors = records.filter(r => /error|skipped|unconfirmed|unavailable/.test(r.kind)).slice(-4).reverse();
  const exportData = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ source: demo ? 'explicit-demo' : 'live-journal', exportedAt: new Date().toISOString(), state, summary, records: filtered }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `amai-${demo ? 'demo' : 'journal'}-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const togglePause = () => { if (!paused) setFrozen(live); setPaused(!paused); };
  const switchSource = value => { setDemo(value); setPaused(false); setFrozen(null); setSelected(null); setSessionFilter('all'); setBotFilter('all'); setEventFilter('all'); setQuery(''); };
  const detail = r => r.kind === 'game-event' ? r.data.kind === 'death' ? `${r.data.unitName} · ур. ${r.data.level} · владелец ${r.data.owner + 1} → убийца ${r.data.killer >= 0 ? r.data.killer + 1 : '—'}` : r.data.kind === 'revive' ? `${r.data.unitName} снова в игре` : [r.data.unitName, r.data.text, r.data.extra].filter(Boolean).join(' · ') || r.data.kind : typeof r.data === 'string' ? r.data : r.data?.text || r.data?.status || (r.kind === 'token-usage' ? `${num(r.data.total?.totalTokens)} токенов · ${r.data.threadId?.slice(0, 8)}` : r.data?.model || JSON.stringify(r.data));
  const scroll = id => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });

  return <div className="app-shell">
    <aside className="rail"><div className="rail-mark">A<span>_</span></div>{[['chat-panel', 'chat', 'Диалог'], ['events-panel', 'activity', 'Телеметрия'], ['tokens-panel', 'chip', 'Токены'], ['diagnostics-panel', 'terminal', 'Диагностика']].map(([id, icon, label], i) => <button key={id} title={label} aria-label={label} onClick={() => scroll(id)}><Icon name={icon} /><span>0{i + 1}</span></button>)}<div className="rail-bottom">LOCAL<br />ONLY</div></aside>
    <div className="workspace">
      <header className="topbar"><div><div className="eyebrow">WARCRAFT III / COMMS OPERATIONS</div><h1>AMAI <span className="title-slash">/</span> <span>Flight Recorder</span><Badge color="amber">LOCAL</Badge></h1></div><div className="header-actions"><div className="system-clock"><span>LOCAL TIME</span><strong>{clock(now)}</strong></div><button className={`button subtle ${demo ? 'selected-button' : ''}`} onClick={() => switchSource(!demo)} aria-pressed={demo}>Демо</button><button className="button" onClick={exportData} title="Экспортировать отфильтрованные записи"><Icon name="download" />Экспорт</button></div></header>
      {demo && <div className="notice demo-notice"><strong>DEMO MODE</strong> Синтетический матч для просмотра интерфейса. С реальной игрой и расходом токенов не связан.<button onClick={() => switchSource(false)}>К реальным данным →</button></div>}
      {!demo && connection !== 'live' && <div className="notice"><i className="dot" /><span>{connection === 'connecting' ? 'Подключение к локальному потоку…' : 'Поток прерван. Переподключаемся автоматически; последние данные сохранены.'}</span></div>}
      <div className="status-strip"><div className="status-group"><Badge color={demo || connection === 'live' ? 'mint' : 'red'} dot>{demo ? 'DEMO STREAM' : connection === 'live' ? 'LIVE STREAM' : 'CONNECTING'}</Badge><span className="status-divider" /><span><i className={`dot ${bridgeLive ? 'mint' : 'muted'}`} />BRIDGE <b>{bridgeLive ? 'ONLINE' : currentHealth.alive ? 'STALE' : 'WAITING'}</b></span><span><i className={`dot ${gameLive ? 'mint' : 'amber'}`} />GAME <b>{gameLive ? 'CONNECTED' : 'NO TELEMETRY'}</b></span><span><i className={`dot ${modelLive ? 'mint' : 'muted'}`} />LLM <b>{modelLive ? 'READY' : 'STANDBY'}</b></span></div><div className="mono muted status-meta">{state.model || 'gpt-6.1-sol'} <span className="amber">/ {state.effort || 'low'}</span><span className="status-divider" />UPTIME {duration(state.uptimeSeconds)}</div></div>
      <section className="instruments" aria-label="Сводные показатели журнала"><Instrument label="СОБЫТИЯ ИГРЫ" value={num(summary.events)} detail="получено из телеметрии" color="cyan" values={summary.series.map(x => x.events)} /><Instrument label="РЕПЛИКИ БОТОВ" value={num(summary.botMessages)} detail={`${num(summary.delivered)} подтверждено игрой`} color="mint" values={summary.series.map(x => x.replies)} /><Instrument label="СООБЩЕНИЯ ИГРОКА" value={num(summary.playerMessages)} detail="принято из игрового чата" values={summary.series.map(x => x.events)} /><Instrument label="ТОКЕНЫ / ВСЕГО" value={short(tokens.totalTokens)} detail={tokens.totalTokens == null ? 'ожидаем отчёт Codex' : `${num(tokens.requests)} измеренных запросов`} color="amber" values={summary.series.map(x => x.tokens)} /><Instrument label="ВХОД / ВЫХОД" value={short(tokens.inputTokens)} suffix={` / ${short(tokens.outputTokens)}`} detail="фактические токены" color="violet" values={summary.series.map(x => x.tokens)} /><Instrument label="ЗАДЕРЖКА / P50" value={summary.latency.p50 == null ? '—' : (summary.latency.p50 / 1000).toFixed(2)} suffix={summary.latency.p50 == null ? '' : 'с'} detail={`P95 ${ms(summary.latency.p95)}`} values={summary.series.map(x => x.replies)} /><Instrument label="ОЧЕРЕДЬ" value={num(state.queue?.length || 0)} suffix="/ 3" detail={!bridgeLive ? 'последний известный снимок' : activeRequest?.phase === 'awaiting-game' ? 'готовый ответ ждёт игру' : activeRequest ? '1 генерация выполняется' : 'нет активной генерации'} color="cyan" values={[]} /><Instrument label="ОШИБКИ" value={num(summary.errors)} detail={`${num(summary.expired || 0)} просрочено · ${num(summary.silent || 0)} молчание`} color={summary.errors ? 'red' : 'mint'} values={[]} /></section>
      <div className="toolbar"><div className="search-box"><Icon name="search" size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по сообщениям, героям, ID…" aria-label="Поиск в журнале" /><kbd>/</kbd></div><select value={sessionFilter} onChange={e => setSessionFilter(e.target.value)} aria-label="Фильтр матча"><option value="all">Все матчи</option>{sessions.map(session => <option key={session} value={session}>Матч {session}</option>)}</select><select value={botFilter} onChange={e => setBotFilter(e.target.value)} aria-label="Фильтр бота"><option value="all">Все участники</option>{bots.map(bot => <option key={bot.slot} value={bot.slot}>{bot.name}</option>)}</select><span className="toolbar-spacer" /><span className="mono muted record-counter">{num(filtered.length)} записей</span><button className={`button ${paused ? 'selected-button' : ''}`} onClick={togglePause} disabled={!live} aria-pressed={paused}><Icon name={paused ? 'play' : 'pause'} size={15} />{paused ? 'Продолжить' : 'Пауза ленты'}</button></div>
      {paused && <div className="pause-bar">Отображение приостановлено. Сбор продолжается. <b>+{num((live?.summary.captured || 0) - (frozen?.summary.captured || 0))} новых записей</b></div>}
      <main className="cockpit-grid"><div className="main-column">
        <Panel id="chat-panel" code="01" title="Радиоканал" right={<div className="segmented"><button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Диалог <span>{messages.length}</span></button><button className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>Запросы <span>{requests.length}</span></button></div>}>
          {tab === 'chat' ? <div className="conversation">{messages.length ? messages.map(r => {
            const human = r.kind === 'game-event'; const probe = r.data.purpose === 'probe'; const delivered = acknowledgements.has(`${r.data.session}:${r.data.poll}`);
            return <button className={`message-row ${human ? 'human' : 'bot'}`} key={r.id} onClick={() => setSelected(r)}><span className="message-time mono">{clock(r.at)}</span><span className="message-avatar">{human ? 'YOU' : probe ? 'SYS' : String(r.data.bot + 1).padStart(2, '0')}</span><span className="message-body"><span className="message-author">{human ? 'Ты' : probe ? 'Проверка транспорта' : botName(r.data.bot, bots)}<small>{human ? 'INPUT / JASS' : probe ? 'DIAGNOSTIC' : `${r.data.channel === 'team' ? 'TEAM' : 'ALL'} → ${r.data.recipient == null || r.data.recipient < 0 ? 'ВСЕМ' : participant(r.data.recipient)}`}</small></span><span className="message-text">{r.data.text}</span></span><span className={`message-delivery ${human ? 'cyan' : delivered ? 'mint' : 'amber'}`}>{human ? 'RX' : delivered ? acknowledgements.get(`${r.data.session}:${r.data.poll}`)?.visible === false ? '✓ принят · TEAM' : '✓ показано' : '↗ записано'}</span></button>;
          }) : <Empty icon="chat" title={query ? 'Сообщения не найдены' : 'Радиоканал пока свободен'} detail={query ? 'Измени поисковый запрос или фильтр.' : 'Сообщения игрока и сгенерированные ответы появятся здесь после подключения игры.'} />}</div> : <div className="request-list">{requests.length ? <table><thead><tr><th>СОБЫТИЕ</th><th>БОТ / МОДЕЛЬ</th><th>INPUT</th><th>OUTPUT</th><th>ВРЕМЯ</th><th>СТАТУС</th></tr></thead><tbody>{requests.map(r => <tr key={r.id} onClick={() => setSelected({ ...r.record, data: r.data })}><td className="mono">#{r.data.seq}</td><td>{botName(r.data.bot, bots)}<small className="table-sub">{r.data.model || 'gpt-6.1-sol'}</small></td><td className="mono">{num(r.data.total?.inputTokens)}</td><td className="mono">{num(r.data.total?.outputTokens)}</td><td className="mono">{ms(r.data.durationMs)}</td><td><button className="text-button" onClick={() => setSelected({ ...r.record, data: r.data })}>{r.data.status || 'running'} ↗</button></td></tr>)}</tbody></table> : <Empty icon="chip" title="Запросов к модели ещё нет" detail="У каждого запроса будут свой ID, тайминг и фактический расход токенов." />}</div>}
          <div className="panel-footer"><span><i className="dot mint" />Публикация и подтверждение показа учитываются отдельно</span><span className="mono">CHANNEL / ALL</span></div>
        </Panel>
        <Panel id="events-panel" code="02" title="Поток телеметрии" right={<Badge color="cyan">{num(events.length)} EVENTS</Badge>}>
          <div className="event-tabs">{[['all', 'Всё'], ['chat', 'Чат'], ['hero', 'Герои'], ['items', 'Предметы'], ['development', 'Развитие'], ['economy', 'Стройки'], ['movement', 'Движение'], ['actions', 'Задачи AI'], ['system', 'Система'], ['error', 'Ошибки']].map(([id, label]) => <button className={eventFilter === id ? 'active' : ''} key={id} onClick={() => { setEventFilter(id); setVisibleRows(150); }}>{label}</button>)}</div>
          <div className="event-list"><div className="event-table-head"><span>ВРЕМЯ</span><span>СОБЫТИЕ</span><span>ДАННЫЕ</span><span>ID</span></div>{events.length ? events.slice(0, visibleRows).map(r => <button className="event-row" key={r.id} onClick={() => setSelected(r)}><time className="mono">{clock(r.at)}</time><span className={`event-type ${tint(typeOf(r))}`}><i className="dot" />{labels[typeOf(r)] || typeOf(r).toUpperCase()}</span><span className="event-detail">{detail(r)}</span><span className="event-id mono">{r.data?.seq ? `#${r.data.seq}` : `·${r.id}`}<Icon name="chevron" size={12} /></span></button>) : <Empty title={query ? 'Совпадений нет' : 'Ожидаем события'} detail={query ? 'Попробуй другой фильтр.' : 'Новый обычный матч → AMAI → сборщик → локальный мост.'} />}</div>
          <div className="panel-footer"><span>Нажми на запись, чтобы раскрыть JSON</span>{events.length > visibleRows ? <button className="text-button" onClick={() => setVisibleRows(Math.min(visibleRows + 150, 1000))}>Ещё 150 ↓</button> : <span className="mono">{num(events.length)} / {num(summary.captured || 0)}</span>}</div>
        </Panel>
        <div className="chart-grid"><Panel code="03" title="Активность" right={<span className="mono muted tiny">30 MIN</span>}><div className="chart-legend"><span><i className="dot cyan" />События / мин</span><span className="mono">{num(summary.series.at(-1)?.events || 0)}</span></div><div className="chart-body"><Spark values={summary.series.map(x => x.events)} height={90} /></div><div className="chart-axis"><span>−30 мин</span><span>−15 мин</span><span>сейчас</span></div></Panel><Panel code="04" title="Поток токенов" right={<span className="mono muted tiny">TOKENS / MIN</span>}><div className="chart-legend"><span><i className="dot amber" />Input + output</span><span className="mono amber">{num(summary.series.at(-1)?.tokens || 0)}</span></div><div className="chart-body"><Spark values={summary.series.map(x => x.tokens)} color="var(--amber)" height={90} /></div><div className="chart-axis"><span>−30 мин</span><span>−15 мин</span><span>сейчас</span></div></Panel></div>
        <Panel code="OBS" title="Последние наблюдения" right={<span className="tiny muted">ИНВЕНТАРЬ / НАВЫКИ</span>} className="observation-panel"><div className="observation-list">{snapshots.length ? snapshots.map((event, i) => <button className="observation-row" key={`${event.bot}:${event.seq}:${i}`} onClick={() => setSelected({ kind: 'game-event', data: event })}><span><b>{event.unitName}</b><small>{participant(event.owner)} · наблюдатель {botName(event.bot, bots)} · {duration(event.time)}</small></span><Badge color={event.kind === 'inventory' ? 'amber' : 'violet'}>{event.kind === 'inventory' ? 'ITEMS' : 'SKILLS'}</Badge><p>{event.text || 'Нет изученных способностей'}</p></button>) : <div className="mini-empty">Снимки появятся после подключения героев. Хранятся последние доступные наблюдателю сведения, с отметкой времени.</div>}</div></Panel>
        <Panel id="actions-panel" code="OPS" title="Решения и задачи AMAI" right={<Badge color="cyan">{(state.actions?.tasks || []).filter(t => ['published', 'accepted', 'running'].includes(t.status)).length} ACTIVE</Badge>}><div className="observation-list">{(state.actions?.tasks || []).filter(t => botFilter === 'all' || t.bot === Number(botFilter)).slice(-12).reverse().map(task => <button className="observation-row" key={task.id} onClick={() => setSelected({ kind: 'action-status', data: task })}><span><b>#{task.id} · {task.action} · {botName(task.bot, bots)}</b><small>от {participant(task.source)} · {duration(task.created)} → {duration(task.expires)}</small></span><Badge color={task.status === 'completed' ? 'mint' : ['rejected', 'cancelled', 'expired'].includes(task.status) ? 'red' : 'amber'}>{task.status}</Badge><p>{task.reason || task.rationale} · точка {Math.round(task.x)}, {Math.round(task.y)} · наблюдение {duration(task.observedAt)}</p></button>)}{!state.actions?.tasks?.length && <div className="mini-empty">Здесь появятся задачи из чата. Отправка, принятие AMAI и выполнение учитываются отдельно.</div>}</div><p className="micro-copy">Доверие к сведениям: {Object.entries(state.actions?.trust || {}).map(([pair, value]) => `${pair} ${value.toFixed(2)}`).join(' · ') || 'нет проверенных репортов'}. Приоритет — защита базы; устаревшая цель требует разведки.</p></Panel>
        <Panel code="MOOD" title="Оценки событий" right={<span className="tiny muted">VALENCE −1 … +1</span>} className="assessment-panel"><div className="assessment-list">{assessments.length ? assessments.map(record => <button className="assessment-row" key={record.id} onClick={() => setSelected(record)}><span className="mono muted">#{record.data.seq}</span><span>{botName(record.data.bot, bots)}<small>отношение к {record.data.target >= 0 ? participant(record.data.target) : '—'}: Δ {record.data.delta > 0 ? '+' : ''}{record.data.delta?.toFixed(2) || '0.00'}</small></span><b className={`mono ${record.data.valence < 0 ? 'red' : record.data.valence > 0 ? 'mint' : 'muted'}`}>{record.data.valence > 0 ? '+' : ''}{record.data.valence?.toFixed(2)}</b></button>) : <div className="mini-empty">Оценка пользы события и изменение отношения считаются отдельно. Неудача союзника не означает автоматический штраф отношений.</div>}</div></Panel>
      </div><aside className="side-column">
        <Panel code="LINK" title="Контур связи" right={<Icon name="cross" size={17} />}><div className="link-stages">{[['WARCRAFT III', gameLive ? `Такт ${num(state.transport?.poll)}` : 'Ожидание телеметрии', gameLive], ['FILE BRIDGE', gameLive && state.verified ? 'Обмен подтверждён' : 'Обмен не подтверждён', gameLive && state.verified], ['CODEX / SOL 6.1', modelLive ? 'Модель готова' : 'Ожидание подключения', modelLive]].map(([name, detail, ok], i) => <div className="link-stage" key={name}><span className={`stage-node ${ok ? 'mint' : 'muted'}`}>{String(i + 1).padStart(2, '0')}</span><span><b>{name}</b><small>{detail}</small></span><i className={`dot ${ok ? 'mint' : 'muted'}`} /></div>)}</div><div className="connection-stats"><span>Возраст такта <b className="mono">{ms(gameAge)}</b></span><span>Игровое время <b className="mono">{duration(state.transport?.gameSeconds)}</b></span><span>CPU / RAM <b className="mono">{state.cpuPercent == null ? '—' : `${state.cpuPercent.toFixed(1)}%`} / {state.memory?.rss ? `${(state.memory.rss / 1048576).toFixed(0)} MB` : '—'}</b></span></div></Panel>
        <Panel code="AI" title="Участники" right={<span className="mono muted tiny">{bots.length} BOTS</span>}><div className="bot-list">{bots.length ? bots.map(bot => {
          const cooldown = Math.max(0, (state.cooldowns?.bots?.[bot.slot] || 0) - now);
          const active = activeRequest?.bot === bot.slot;
          return <button key={bot.slot} className={`bot-row ${botFilter === String(bot.slot) ? 'selected' : ''}`} onClick={() => setBotFilter(botFilter === String(bot.slot) ? 'all' : String(bot.slot))} title={bot.style}><span className={`bot-index ${['amber', 'cyan', 'violet'][bot.slot % 3]}`}>{String(bot.slot + 1).padStart(2, '0')}</span><span className="bot-identity"><b>{bot.name}</b><small>{raceName(bot.race)} <span>· {bot.id?.toUpperCase()}</span></small></span><span className={active ? 'amber' : cooldown ? 'muted' : 'mint'}>{!gameLive ? 'STALE' : active ? 'GEN' : cooldown ? `${Math.ceil(cooldown / 1000)}s` : 'READY'}</span></button>;
        }) : <div className="mini-empty">Список слотов появится с первым тактом игры.</div>}</div></Panel>
        <Panel code="CHAR" title="Характер на старте"><div className="observation-list">{bots.map(bot => { const p = state.relationships?.personalities?.[bot.slot]; return p ? <div className="observation-row" key={bot.slot}><span><b>{bot.name}</b><small>{({toxic:'Токсичный',friendly:'Дружелюбный',reserved:'Сдержанный'}[p.label])} · настрой {p.temperament > 0 ? '+' : ''}{p.temperament.toFixed(2)}</small></span><p>Положительный сдвиг ×{p.positiveGain.toFixed(2)} · отрицательный ×{p.negativeGain.toFixed(2)}</p></div> : null; })}</div><p className="micro-copy">Характер постоянен в пределах матча. Начальное отношение к каждому участнику отличается; коэффициент реакции применяется после экспоненты.</p></Panel>
        <Panel code="REL" title="Отношения" right={<span className="tiny muted">НАПРАВЛЕННЫЕ</span>}><div className="relationship-list">{relationships.length ? relationships.map(([key, value]) => { const [from, to] = key.split(":").map(Number); return <div className="relationship-row" key={key}><span>{participant(from)}<small>→ {participant(to)}</small></span><div className="relationship-meter"><i style={{ width: `${Math.abs(value) * 50}%`, left: value >= 0 ? "50%" : `${50 + value * 50}%`, background: value < 0 ? "var(--red)" : "var(--mint)" }} /></div><b className={`mono ${value < 0 ? "red" : "mint"}`}>{value > 0 ? "+" : ""}{value.toFixed(2)}</b></div>; }) : <div className="mini-empty">Начальный характер и отношение назначаются при входе в матч; изменения учитывают чувствительность бота.</div>}</div></Panel>
        <Panel id="tokens-panel" code="LLM" title="Расход токенов" right={<Badge color="amber">METERED</Badge>}><div className="token-total"><span>ПО ЗАХВАЧЕННОМУ ЖУРНАЛУ</span><strong>{num(tokens.totalTokens)}</strong><small>{tokens.totalTokens == null ? 'Уведомления tokenUsage ещё не получены' : `${num(tokens.requests)} запросов с измеренным расходом`}</small></div><div className="token-breakdown">{[['Вход', tokens.inputTokens, 'cyan'], ['↳ из кэша', tokens.cachedInputTokens, 'muted'], ['Выход', tokens.outputTokens, 'amber'], ['↳ reasoning', tokens.reasoningOutputTokens, 'muted']].map(([label, value, color]) => <div key={label}><span>{label}</span><b className={`mono ${color}`}>{num(value)}</b></div>)}</div><div className="token-ratio"><i style={{ width: `${tokens.totalTokens ? tokens.inputTokens / tokens.totalTokens * 100 : 0}%` }} /><span /></div><p className="micro-copy">Кэш входит во входные токены, reasoning — в выходные. Данные Codex, без оценки стоимости.</p><div className="quota"><div><span>Остаток лимита аккаунта</span><b className="mono">{remaining == null ? '—' : `${remaining}%`}</b></div><div className="quota-track"><i style={{ width: `${remaining || 0}%` }} /></div><small>{quota ? `Общий лимит Codex · сброс ${new Date(quota.resetsAt * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Появится после подключения модели'}</small></div></Panel>
        <Panel code="Q" title="Планировщик" right={<Badge color={activeRequest ? 'amber' : 'muted'}>{!bridgeLive ? 'STALE' : activeRequest?.phase === 'awaiting-game' ? 'WAIT GAME' : activeRequest ? 'RUNNING' : 'IDLE'}</Badge>}><div className="scheduler-meta"><span>Глобальный интервал <b className="mono">{(state.settings?.globalCooldownMs || 8000) / 1000}s</b></span><span>Интервал бота <b className="mono">{(state.settings?.botCooldownMs || 20000) / 1000}s</b></span></div>{activeRequest && <div className="active-generation"><i className="dot amber" /><span>{botName(state.activeRequest.bot, bots)}<small>#{state.activeRequest.seq} · {typeOf({ kind: 'game-event', data: state.activeRequest })}</small></span><b className="mono amber">{ms(now - state.activeRequest.startedAt)}</b></div>}{activeRequest?.phase === "awaiting-game" && <p className="micro-copy">Ответ готов. Ожидаем свежий такт игры; вернись в матч. Повторного запроса к модели нет.</p>}<div className="queue-list">{state.queue?.length ? state.queue.map(q => <div key={`${q.seq}:${q.bot}`}><span className="mono muted">#{q.seq}</span><span>{botName(q.bot, bots)}<small>{q.kind.toUpperCase()}</small></span><b className="mono">{Math.max(0, Math.ceil((q.expires - now) / 1000))}s</b></div>) : <span className="muted tiny">Очередь свободна</span>}</div></Panel>
      </aside></main>
      <Panel id="diagnostics-panel" code="SYS" title="Диагностика" className="diagnostics" right={<span className="mono muted tiny">READ ONLY / 127.0.0.1:8765</span>}><div className="diagnostic-grid"><div><span className="eyebrow">УСТАНОВКА</span><strong className={data?.installation?.status === 'installed' ? 'mint' : 'amber'}>{({ installed: 'Новая сборка установлена', waiting: 'Ожидаем выхода из Warcraft', preparing: 'Подготовка сборки', failed: 'Ошибка замены файлов' }[data?.installation?.status]) || 'Состояние установки не получено'}</strong><small>{data?.installation?.message || 'Глобальные скрипты AMAI · резервная копия перед заменой'}</small></div><div><span className="eyebrow">ПОСЛЕДНИЕ СИГНАЛЫ</span>{errors.length ? errors.slice(0, 2).map(r => <button className="diagnostic-error" key={r.id} onClick={() => setSelected(r)}><span className="mono muted">{clock(r.at)}</span><span>{detail(r)}</span></button>) : <span className="diagnostic-clear"><i className="dot mint" />Ошибки в журнале не зарегистрированы</span>}</div><div><span className="eyebrow">КОНТЕКСТ</span><div className="context-line">SESSION <b className="mono">{state.session || '—'}</b></div><div className="context-line">PID / BUFFER <b className="mono">{state.pid || '—'} / {num(summary.retained)}</b></div></div></div></Panel>
      <footer className="page-footer"><span><i className="dot mint" />AMAI FLIGHT RECORDER <span className="muted">/ v0.2</span></span><span>Журнал: {num(summary.captured || 0)} записей · {data?.monitor?.historyTruncated ? 'загружен хвост до 8 MB' : 'загружен доступный журнал'} · SSE 1 Hz</span><span className="mono">SOL 6.1 / LOW</span></footer>
    </div>{selected && <Inspector record={selected} onClose={closeInspector} />}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
