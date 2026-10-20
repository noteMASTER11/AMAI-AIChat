const fields = ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'reasoningOutputTokens', 'cacheWriteInputTokens'];
export function normalizeUsage(value) {
  if (!value || !['inputTokens', 'outputTokens', 'totalTokens'].every(k => Number.isSafeInteger(value[k]) && value[k] >= 0)) return null;
  return Object.fromEntries(fields.map(key => [key, Number.isSafeInteger(value[key]) && value[key] >= 0 ? value[key] : null]));
}

export class MonitorStore {
  records = [];
  nextId = 0;
  usages = new Map();
  replies = new Map();
  latency = [];
  buckets = new Map();
  counts = { events: 0, playerMessages: 0, botMessages: 0, delivered: 0, generations: 0, errors: 0, silent: 0, expired: 0 };
  constructor(limit = 4000) { this.limit = limit; }
  ingest(record) {
    if (!record || typeof record.kind !== 'string' || !Number.isFinite(Date.parse(record.at))) return null;
    const entry = { ...record, id: ++this.nextId };
    this.records.push(entry);
    if (this.records.length > this.limit) this.records.splice(0, this.records.length - this.limit);
    const data = record.data || {};
    const minute = Math.floor(Date.parse(record.at) / 60000) * 60000;
    const bucket = this.buckets.get(minute) || { at: minute, events: 0, tokens: 0, replies: 0 };
    if (record.kind === 'game-event') {
      this.counts.events++; bucket.events++;
      if (data.kind === 'chat') this.counts.playerMessages++;
    }
    if (record.kind === 'reply-published') {
      this.replies.set(`${data.session}:${data.poll}`, { ...data, delivered: false });
      if (data.purpose !== 'probe') { this.counts.botMessages++; bucket.replies++; }
      if (this.replies.size > this.limit) this.replies.delete(this.replies.keys().next().value);
    }
    if (record.kind === 'reply-acknowledged') {
      const reply = this.replies.get(`${data.session}:${data.poll}`);
      if (reply && !reply.delivered) { reply.delivered = true; if (reply.purpose !== 'probe') this.counts.delivered++; }
    }
    if (record.kind === 'generation-finished') {
      this.counts.generations++;
      if (Number.isFinite(data.durationMs)) this.latency.push(data.durationMs);
      if (this.latency.length > 1000) this.latency.shift();
      if (data.status === 'silent') this.counts.silent++;
      if (data.status === 'expired') this.counts.expired++;
    }
    if (record.kind === 'token-usage' && typeof data.threadId === 'string') {
      const normalized = normalizeUsage(data.total);
      if (normalized) {
        bucket.tokens += normalized.totalTokens - (this.usages.get(data.threadId)?.totalTokens || 0);
        this.usages.set(data.threadId, normalized);
      }
    }
    if (['bridge-error', 'generation-skipped', 'protocol-error', 'expiry-error'].includes(record.kind)) this.counts.errors++;
    this.buckets.set(minute, bucket);
    while (this.buckets.size > 180) this.buckets.delete(this.buckets.keys().next().value);
    return entry;
  }
  summary(now = Date.now()) {
    const tokens = { requests: this.usages.size };
    for (const field of fields) {
      const known = [...this.usages.values()].map(u => u[field]).filter(v => v != null);
      tokens[field] = known.length ? known.reduce((sum, value) => sum + value, 0) : null;
    }
    const sorted = [...this.latency].sort((a, b) => a - b);
    const percentile = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
    const series = Array.from({ length: 30 }, (_, index) => {
      const at = Math.floor(now / 60000) * 60000 - (29 - index) * 60000;
      return this.buckets.get(at) || { at, events: 0, tokens: 0, replies: 0 };
    });
    return { ...this.counts, tokens, latency: { p50: percentile(0.5), p95: percentile(0.95), samples: sorted.length }, series, retained: this.records.length, captured: this.nextId };
  }
}
