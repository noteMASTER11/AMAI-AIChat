const slot = value => Number.isInteger(value) && value >= 0 && value < 24;
const bounded = (value, low, high) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
export function validateAssessment(value, targets) {
  if (!bounded(value.valence, -1, 1) || !bounded(value.relationshipDelta, -0.1, 0.1) || ![-1, ...targets].includes(value.relationshipTarget)) throw new Error('Invalid event assessment');
  if (value.relationshipTarget === -1 && value.relationshipDelta !== 0) throw new Error('An untargeted event cannot change a relationship');
  return { valence: value.valence, relationshipTarget: value.relationshipTarget, relationshipDelta: value.relationshipDelta };
}
export class Relationships {
  sessions = new Map();
  seen = new Set();
  constructor(saved) {
    if (saved?.schema !== 1) return;
    for (const [session, pairs] of saved.sessions || []) {
      if (!/^\d{6,18}$/.test(session) || !pairs || typeof pairs !== 'object') continue;
      const valid = Object.fromEntries(Object.entries(pairs).filter(([key, coefficient]) => /^\d+:\d+$/.test(key) && key.split(':').map(Number).every(slot) && bounded(coefficient, -1, 1)));
      this.sessions.set(session, valid);
    }
    this.seen = new Set((saved.seen || []).filter(v => typeof v === 'string').slice(-4000));
  }
  get(session, bot, target) { return this.sessions.get(session)?.[`${bot}:${target}`] || 0; }
  forBot(session, bot, audience) { return audience.map(player => ({ slot: player.slot, name: player.name, alliance: player.relation, coefficient: this.get(session, bot, player.slot) })); }
  apply(session, bot, requestId, assessment) {
    if (!/^\d{6,18}$/.test(session) || !slot(bot)) throw new Error('Invalid relationship identity');
    validateAssessment(assessment, Array.from({ length: 24 }, (_, i) => i).filter(i => i !== bot));
    const target = assessment.relationshipTarget;
    const previous = this.get(session, bot, target);
    const key = `${session}:${bot}:${requestId}`;
    if (this.seen.has(key)) return previous;
    this.seen.add(key);
    if (this.seen.size > 4000) this.seen.delete(this.seen.values().next().value);
    if (target < 0 || assessment.relationshipDelta === 0) return previous;
    const pairs = this.sessions.get(session) || {};
    const next = Math.round(Math.max(-1, Math.min(1, previous + assessment.relationshipDelta)) * 10000) / 10000;
    pairs[`${bot}:${target}`] = next;
    this.sessions.set(session, pairs);
    if (this.sessions.size > 8) this.sessions.delete(this.sessions.keys().next().value);
    return next;
  }
  toJSON() { return { schema: 1, sessions: [...this.sessions], seen: [...this.seen] }; }
}
export class Observations {
  latest = new Map();
  add(event) {
    if (!['inventory', 'abilities', 'position', 'skill', 'level'].includes(event.kind)) return;
    const unit = /(?:^|;)unit=(\d+)/.exec(event.extra || '')?.[1] || `${event.owner}:${event.unitType}`;
    this.latest.set(`${event.bot}:${unit}:${event.kind}`, { ...event });
    if (this.latest.size > 512) this.latest.delete(this.latest.keys().next().value);
  }
  forBot(bot, time) { return [...this.latest.values()].filter(event => event.bot === bot && time - event.time >= 0 && time - event.time <= 300).sort((a, b) => b.time - a.time).slice(0, 18); }
  clear() { this.latest.clear(); }
}
export function buildChunk(event, history = [], observations = [], relationships = [], maxChars = 12000) {
  const lines = [JSON.stringify({ type: 'scope', schema: 'AMAI_CHUNK_1', session: event.session, observer: event.bot, gameSeconds: event.time }), JSON.stringify({ type: 'current-event', data: event }), JSON.stringify({ type: 'relationships', data: relationships })];
  if (lines.join('\n').length > maxChars) throw new Error('Current event exceeds context budget');
  let omitted = 0;
  const candidates = [...observations.map(data => ({ type: 'last-observed-state', data })), ...history.slice(-12).reverse().map(data => ({ type: 'recent-observed-event', data }))];
  for (const entry of candidates) {
    const text = JSON.stringify(entry);
    if (lines.join('\n').length + text.length + 1 <= maxChars) lines.push(text); else omitted++;
  }
  return { text: lines.join('\n'), records: lines.length, omitted: omitted + Math.max(0, history.length - 12), maxChars };
}
