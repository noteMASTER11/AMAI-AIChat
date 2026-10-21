import { createHash } from 'node:crypto';
const slot = value => Number.isInteger(value) && value >= 0 && value < 24;
const draw = seed => createHash('sha256').update(seed).digest().readUInt32BE(0) / 0x100000000;
const bounded = (value, low, high) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
export function relationshipChange(impact) {
  if (!bounded(impact, -1, 1)) throw new Error('Invalid relationship impact');
  return Math.sign(impact) * 0.8 * Math.expm1(3 * Math.abs(impact)) / Math.expm1(3);
}
export function validateAssessment(value, targets) {
  if (!bounded(value.valence, -1, 1) || ![-1, ...targets].includes(value.relationshipTarget)) throw new Error('Invalid event assessment');
  const hasImpact = value.relationshipImpact !== undefined;
  // Older saved assessments retain their original delta; new model output uses impact.
  if (!hasImpact && !bounded(value.relationshipDelta, -0.1, 0.1)) throw new Error('Invalid event assessment');
  const delta = hasImpact ? relationshipChange(value.relationshipImpact) : value.relationshipDelta;
  if (value.relationshipTarget === -1 && delta !== 0) throw new Error('An untargeted event cannot change a relationship');
  return { valence: value.valence, relationshipTarget: value.relationshipTarget, ...(hasImpact ? { relationshipImpact: value.relationshipImpact } : {}), relationshipDelta: delta };
}
export class Relationships {
  sessions = new Map();
  seen = new Set();
  personalities = new Map();
  constructor(saved) {
    if (![1, 2].includes(saved?.schema)) return;
    for (const [session, pairs] of saved.sessions || []) {
      if (!/^\d{6,18}$/.test(session) || !pairs || typeof pairs !== 'object') continue;
      const valid = Object.fromEntries(Object.entries(pairs).filter(([key, coefficient]) => /^\d+:\d+$/.test(key) && key.split(':').map(Number).every(slot) && bounded(coefficient, -1, 1)));
      this.sessions.set(session, valid);
    }
    this.seen = new Set((saved.seen || []).filter(v => typeof v === 'string').slice(-4000));
    for (const [key, value] of saved.personalities || []) {
      if (/^\d{6,18}:\d+$/.test(key) && bounded(value?.temperament, -1, 1) && bounded(value?.positiveGain, 0.25, 1.75) && bounded(value?.negativeGain, 0.25, 1.75)) this.personalities.set(key, value);
    }
  }
  initialize(session, bot, targets) {
    if (!/^\d{6,18}$/.test(session) || !slot(bot)) throw new Error('Invalid personality identity');
    const key = `${session}:${bot}`;
    if (!this.personalities.has(key)) {
      const temperament = Math.round((draw(key + ':temperament') * 2 - 1) * 1000) / 1000;
      this.personalities.set(key, { temperament, label: temperament < -0.3 ? 'toxic' : temperament > 0.3 ? 'friendly' : 'reserved', positiveGain: Math.round((1 + 0.75 * temperament) * 1000) / 1000, negativeGain: Math.round((1 - 0.75 * temperament) * 1000) / 1000 });
    }
    const personality = this.personality(session, bot);
    const pairs = this.sessions.get(session) || {};
    for (const target of targets) if (slot(target) && target !== bot && pairs[`${bot}:${target}`] === undefined) {
      pairs[`${bot}:${target}`] = Math.round(Math.max(-0.7, Math.min(0.7, personality.temperament * 0.5 + (draw(`${key}:${target}:affinity`) - 0.5) * 0.3)) * 10000) / 10000;
    }
    this.sessions.set(session, pairs);
    while (this.sessions.size > 8) this.sessions.delete(this.sessions.keys().next().value);
    for (const key of this.personalities.keys()) if (!this.sessions.has(key.split(':')[0])) this.personalities.delete(key);
    return personality;
  }
  personality(session, bot) { return this.personalities.get(`${session}:${bot}`) || { temperament: 0, label: 'reserved', positiveGain: 1, negativeGain: 1 }; }
  get(session, bot, target) { return this.sessions.get(session)?.[`${bot}:${target}`] || 0; }
  forBot(session, bot, audience) { return audience.map(player => ({ slot: player.slot, name: player.name, alliance: player.relation, coefficient: this.get(session, bot, player.slot) })); }
  apply(session, bot, requestId, assessment) {
    if (!/^\d{6,18}$/.test(session) || !slot(bot)) throw new Error('Invalid relationship identity');
    const validated = validateAssessment(assessment, Array.from({ length: 24 }, (_, i) => i).filter(i => i !== bot));
    const target = assessment.relationshipTarget;
    const previous = this.get(session, bot, target);
    const key = `${session}:${bot}:${requestId}`;
    if (this.seen.has(key)) return previous;
    this.seen.add(key);
    if (this.seen.size > 4000) this.seen.delete(this.seen.values().next().value);
    if (target < 0 || validated.relationshipDelta === 0) return previous;
    const pairs = this.sessions.get(session) || {};
    const personality = this.personality(session, bot);
    const gain = validated.relationshipDelta > 0 ? personality.positiveGain : personality.negativeGain;
    const next = Math.round(Math.max(-1, Math.min(1, previous + validated.relationshipDelta * gain)) * 10000) / 10000;
    pairs[`${bot}:${target}`] = next;
    this.sessions.set(session, pairs);
    if (this.sessions.size > 8) this.sessions.delete(this.sessions.keys().next().value);
    return next;
  }
  toJSON() { return { schema: 2, sessions: [...this.sessions], seen: [...this.seen], personalities: [...this.personalities] }; }
}
export class Observations {
  latest = new Map();
  add(event) {
    if (!['inventory', 'abilities', 'position', 'skill', 'level', 'sighting', 'self-state'].includes(event.kind)) return;
    const unit = /(?:^|;)unit=(\d+)/.exec(event.extra || '')?.[1] || `${event.owner}:${event.unitType}`;
    const key = `${event.bot}:${unit}:${event.kind}`;
    const previous = this.latest.get(key);
    this.latest.set(key, { ...event });
    if (this.latest.size > 512) this.latest.delete(this.latest.keys().next().value);
    return !previous || previous.text !== event.text;
  }
  forBot(bot, time) { return [...this.latest.values()].filter(event => event.bot === bot && time - event.time >= 0 && time - event.time <= 300).sort((a, b) => b.time - a.time).slice(0, 18); }
  clear() { this.latest.clear(); }
}
export function buildChunk(event, history = [], observations = [], relationships = [], maxChars = 12000, dialogue = []) {
  const lines = [JSON.stringify({ type: 'scope', schema: 'AMAI_CHUNK_1', session: event.session, observer: event.bot, gameSeconds: event.time }), JSON.stringify({ type: 'current-event', data: event }), JSON.stringify({ type: 'relationships', data: relationships })];
  if (lines.join('\n').length > maxChars) throw new Error('Current event exceeds context budget');
  let omitted = 0;
  const candidates = [...dialogue.slice(-16).reverse().map(data => ({ type: 'recent-dialogue', data })), ...observations.map(data => ({ type: 'last-observed-state', data })), ...history.slice(-12).reverse().map(data => ({ type: 'recent-observed-event', data }))];
  for (const entry of candidates) {
    const text = JSON.stringify(entry);
    if (lines.join('\n').length + text.length + 1 <= maxChars) lines.push(text); else omitted++;
  }
  return { text: lines.join('\n'), records: lines.length, omitted: omitted + Math.max(0, history.length - 12), maxChars };
}
