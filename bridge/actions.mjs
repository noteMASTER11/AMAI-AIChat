// LLM chooses a typed goal and an observation ID, never arbitrary coordinates or code.
export const actionCodes = { retreat: 1, rally: 2, defend: 3, attack: 4, scout: 5, focus: 6 };
const fields = event => Object.fromEntries((event.extra || '').split(';').map(s => s.split('=')));
const bounded = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
export function actionCandidates(bot, observations, time) {
  return observations.filter(e => e.bot === bot && time >= e.time && time - e.time <= 180 && ['position', 'sighting', 'self-state'].includes(e.kind)).flatMap(e => {
    const f = fields(e), x = Number(f.x), y = Number(f.y);
    if (!bounded(x, -32768, 32768) || !bounded(y, -32768, 32768)) return [];
    return [{ ref: e.kind === 'self-state' ? 'self' : String(e.seq), owner: e.owner, unit: Number(f.unit) || 0, name: e.unitName || 'own army', x, y, observedAt: e.time, age: time - e.time, ...(e.kind === 'self-state' ? { army: Number(f.army), health: Number(f.health) } : {}) }];
  });
}
export const intentSchema = { type: 'object', properties: {
  kind: { type: 'string', enum: ['none', 'request', 'report', 'proposal', 'taunt'] },
  action: { type: 'string', enum: ['none', ...Object.keys(actionCodes)] },
  target: { type: 'string', maxLength: 24 }, confidence: { type: 'number', minimum: 0, maximum: 1 },
  duration: { type: 'integer', minimum: 10, maximum: 90 }, amount: { type: 'integer', const: 0 },
  claim: { type: 'string', enum: ['none', 'attack', 'defend', 'retreat', 'location'] }, rationale: { type: 'string', maxLength: 160 }
}, required: ['kind', 'action', 'target', 'confidence', 'duration', 'amount', 'claim', 'rationale'], additionalProperties: false };
export function validateIntent(intent, candidates) {
  if (!intent || !intentSchema.properties.kind.enum.includes(intent.kind) || !intentSchema.properties.action.enum.includes(intent.action) || !bounded(intent.confidence, 0, 1) || !Number.isInteger(intent.duration) || !bounded(intent.duration, 10, 90) || intent.amount !== 0 || !intentSchema.properties.claim.enum.includes(intent.claim) || typeof intent.rationale !== 'string' || intent.rationale.length > 160) throw new Error('Invalid action intent');
  if (intent.action !== 'none' && !candidates.some(c => c.ref === intent.target)) throw new Error('Unknown action target');
  return intent;
}
export class ActionController {
  constructor(session, saved) { this.session = session; this.next = 0; this.tasks = []; this.trust = {}; if (saved?.session === session) { this.next = saved.next || 0; this.tasks = (saved.tasks || []).slice(-100); this.trust = saved.trust || {}; } }
  propose(raw, { event, bot, human, observations, relationship = 0 }) {
    const candidates = actionCandidates(bot.slot, observations, event.time);
    let intent;
    try { intent = validateIntent(raw, candidates); } catch { return { accepted: false, reason: 'invalid-intent' }; }
    if (intent.action === 'none' || intent.kind === 'none') return { accepted: false, reason: 'no-task' };
    if (!['chat', 'bot-chat'].includes(event.kind)) return { accepted: false, reason: 'not-chat' };
    const source = event.kind === 'bot-chat' ? event.sourceBot : human;
    const allied = bot.allies.includes(source);
    const self = candidates.find(c => c.ref === 'self');
    const target = candidates.find(c => c.ref === intent.target);
    let action = intent.action;
    if (!self || self.age > 15) return { accepted: false, reason: 'stale-own-state' };
    if (intent.confidence < 0.65) return { accepted: false, reason: 'uncertain' };
    if (!allied && !(action === 'scout' && intent.kind === 'report' || ['focus', 'attack'].includes(action) && intent.kind === 'taunt')) return { accepted: false, reason: 'enemy-has-no-command-authority' };
    if (!allied && target.owner !== source) return { accepted: false, reason: 'enemy-cannot-redirect-to-third-party' };
    if (!allied && intent.kind === 'taunt' && relationship > 0.3) return { accepted: false, reason: 'provocation-ignored' };
    if (['attack', 'focus'].includes(action) && bot.allies.includes(target.owner)) return { accepted: false, reason: 'allied-target' };
    if (['attack', 'focus'].includes(action) && target.age > 6) action = 'scout';
    if (action === 'scout' && target.ref === 'self') return { accepted: false, reason: 'no-scout-destination' };
    if (action !== 'retreat' && (self.health < 0.35 || self.army < 2)) return { accepted: false, reason: 'army-unavailable' };
    if (allied && relationship < -0.6 && !['defend', 'retreat'].includes(action) && intent.confidence < 0.9) return { accepted: false, reason: 'low-cooperation' };
    const trustKey = `${bot.slot}:${source}`;
    if (intent.kind === 'report' && (this.trust[trustKey] ?? 0) < -0.6) return { accepted: false, reason: 'unreliable-source' };
    const active = this.tasks.findLast(t => t.bot === bot.slot && ['published', 'accepted', 'running'].includes(t.status) && t.expires > event.time);
    if (active && action !== 'retreat') return { accepted: false, reason: 'task-in-progress' };
    const last = this.tasks.findLast(t => t.bot === bot.slot);
    if (last && event.time - last.created < 20 && action !== 'retreat') return { accepted: false, reason: 'action-cooldown' };
    const task = { id: ++this.next, session: this.session, bot: bot.slot, source, sourceSeq: event.seq, created: event.time, expires: event.time + Math.min(intent.duration, allied ? 90 : 30), action, x: action === 'retreat' ? self.x : target.x, y: action === 'retreat' ? self.y : target.y, owner: target.owner, unit: target.unit, observedAt: target.observedAt, claim: intent.claim, rationale: intent.rationale, kind: intent.kind, status: 'published', allied };
    this.tasks.push(task); this.tasks = this.tasks.slice(-100);
    return { accepted: true, task };
  }
  acknowledge(event) {
    const f = fields(event), task = this.tasks.find(t => t.id === Number(f.id) && t.bot === event.bot);
    if (!task || !['accepted', 'running', 'completed', 'rejected', 'cancelled', 'expired'].includes(f.status)) return null;
    if (['completed', 'rejected', 'cancelled', 'expired'].includes(task.status)) return null;
    task.status = f.status; task.reason = f.reason; task.updatedAt = event.time;
    // Only a recorded reconnaissance outcome changes information trust. An insult does not.
    if (task.kind === 'report' && task.action === 'scout' && task.claim === 'location' && ['confirmed', 'empty'].includes(f.reason)) {
      const key = `${task.bot}:${task.source}`;
      this.trust[key] = Math.max(-1, Math.min(1, (this.trust[key] || 0) + (f.reason === 'confirmed' ? 0.2 : -0.25)));
    }
    return task;
  }
  expire(time) { for (const t of this.tasks) if (['published', 'accepted', 'running'].includes(t.status) && time > t.expires) { t.status = 'expired'; t.reason = 'deadline'; } }
  toJSON() { return { session: this.session, next: this.next, tasks: this.tasks, trust: this.trust }; }
}
export function disclosureContext(event, history = [], dialogue = []) {
  if (!event.audience?.some(p => p.relation === 'enemy')) return { event, history, dialogue };
  const own = e => [event.bot, ...(event.privateOwners || [])].includes(e.owner) && !['death', 'revive'].includes(e.kind);
  const { activeTask, actionOutcome, privateOwners, actionCandidates: candidates, ...publicEvent } = event;
  publicEvent.observations = (event.observations || []).filter(e => !own(e));
  const publicHistory = history.filter(e => !own(e) && e.channel !== 'team' && e.kind !== 'action-status');
  if (own(event) || event.kind === 'action-status') {
    for (const key of ['unitName', 'unitType', 'text', 'extra', 'level', 'owner', 'killer']) delete publicEvent[key];
    publicEvent.kind = 'private-event'; publicEvent.text = 'Private event: do not disclose its contents.';
  }
  return { event: publicEvent, history: publicHistory, dialogue: dialogue.filter(e => e.channel !== 'team') };
}
export function makeAction(task, poll, deadline) {
  if (!/^\d{6,18}$/.test(task.session) || !actionCodes[task.action] || ![task.id, task.bot, task.source, poll].every(Number.isSafeInteger) || !bounded(task.bot, 0, 23) || !bounded(task.source, 0, 23) || !bounded(task.x, -32768, 32768) || !bounded(task.y, -32768, 32768) || !Number.isFinite(deadline)) throw new Error('Invalid action transport');
  const payload = [task.session, poll, task.bot, deadline, task.id, actionCodes[task.action], Math.round(task.x), Math.round(task.y), task.source, task.owner, task.observedAt, task.expires].join('|');
  return `function PreloadFiles takes nothing returns nothing\ncall BlzSetAbilityTooltip(1097690227, "${payload}", 0)\nendfunction\n`;
}
