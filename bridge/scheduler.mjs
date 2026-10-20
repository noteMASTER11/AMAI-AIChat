export class Scheduler {
  queue = [];
  session = null;
  inFlight = false;
  lastGlobal = -Infinity;
  lastBot = new Map();
  constructor(config) { this.config = config; }
  reset(session) {
    this.session = session;
    this.queue = [];
    this.lastGlobal = -Infinity;
    this.lastBot.clear();
    // An old generation still occupies the one provider slot until it settles.
  }
  add(event, now, age = 0) {
    if (!this.session) this.session = event.session;
    if (event.session !== this.session) return;
    const ttl = ['chat', 'bot-chat'].includes(event.kind) ? this.config.chatTtlMs : this.config.eventTtlMs;
    const entry = { ...event, expires: now + ttl - age };
    if (entry.expires <= now) return;
    this.queue.push(entry);
    const priority = e => e.kind === 'chat' ? 2 : e.kind === 'bot-chat' ? 1 : 0;
    this.queue.sort((a, b) => priority(b) - priority(a) || a.seq - b.seq);
    if (this.queue.length > 3) this.queue.pop();
  }
  take(now) {
    this.queue = this.queue.filter(e => e.expires > now && e.session === this.session);
    if (this.inFlight || now - this.lastGlobal < this.config.globalCooldownMs) return null;
    const index = this.queue.findIndex(e => now - (this.lastBot.get(e.bot) ?? -Infinity) >= this.config.botCooldownMs);
    if (index < 0) return null;
    this.inFlight = true;
    return this.queue.splice(index, 1)[0];
  }
  isCurrent(event, now) { return event.session === this.session && event.expires > now; }
  done(bot, now, shown = true, seq = null) {
    this.inFlight = false;
    if (shown) { this.lastGlobal = now; this.lastBot.set(bot, now); }
    if (shown && seq != null) this.queue = this.queue.filter(e => e.seq > seq);
  }
}
