import { open } from 'node:fs/promises';
import { historyFor } from './conversation.mjs';

// Independent of high-volume telemetry; at most twelve utterances per speaker.
export class DialogueMemory {
  constructor(session, saved = []) { this.reset(session, saved); }
  reset(session, saved = []) {
    this.session = session; this.entries = [];
    for (const event of saved) this.add(event);
  }
  add(event) {
    if (event.session !== this.session || !['reply', 'chat'].includes(event.kind) || typeof event.text !== 'string' || !event.text.trim()) return;
    if (event.kind === 'reply' && event.purpose !== 'llm') return;
    const speaker = event.kind === 'reply' ? event.bot : event.owner;
    if (!Number.isInteger(speaker) || speaker < 0 || speaker > 23) return;
    const key = `${event.kind}:${speaker}`;
    const identity = event.kind === 'reply' ? event.poll : event.seq;
    if (this.entries.some(entry => entry.speaker === key && (entry.kind === 'reply' ? entry.poll : entry.seq) === identity)) return;
    const { kind, session, bot, owner, seq, poll, channel, recipient, recipients, publishedAt, time, purpose } = event;
    this.entries.push({ kind, session, bot, owner, seq, poll, channel, recipient, recipients, publishedAt, time, purpose, text: event.text.slice(0, 450), speaker: key });
    const own = this.entries.filter(entry => entry.speaker === key);
    if (own.length > 12) this.entries.splice(this.entries.indexOf(own[0]), 1);
    // A slot may be a human or a bot, never both in one session.
    if (this.entries.length > 288) this.entries.splice(0, this.entries.length - 288);
  }
  ownForBot(slot) { return this.entries.filter(entry => entry.kind === 'reply' && entry.bot === slot); }
  forBot(slot) {
    const own = this.ownForBot(slot).slice(-8);
    const others = historyFor(slot, this.entries.filter(entry => entry.kind !== 'reply' || entry.bot !== slot)).slice(-8);
    const selected = new Set([...own, ...others]);
    return this.entries.filter(entry => selected.has(entry));
  }
  toJSON() { return this.entries; }
}

export async function recoverDialogue(filename, session, saved = []) {
  const memory = new DialogueMemory(session);
  let file;
  try {
    file = await open(filename, 'r');
    const { size } = await file.stat();
    const start = Math.max(0, size - 1024 * 1024);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const rows = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (start) rows.shift();
    for (const row of rows) {
      try {
        const record = JSON.parse(row);
        if (record.kind === 'reply-published') memory.add({ ...record.data, kind: 'reply' });
        else if (record.kind === 'game-event' && record.data?.kind === 'chat') memory.add(record.data);
      } catch { /* Partial or invalid diagnostics do not affect recovery. */ }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  finally { await file?.close(); }
  // The journal is ordered and includes publications newer than the checkpoint.
  const identities = new Set(memory.entries.map(entry => `${entry.speaker}:${entry.kind === 'reply' ? entry.poll : entry.seq}`));
  const older = saved.filter(entry => !identities.has(`${entry.speaker || `${entry.kind}:${entry.kind === 'reply' ? entry.bot : entry.owner}`}:${entry.kind === 'reply' ? entry.poll : entry.seq}`));
  return new DialogueMemory(session, [...older, ...memory.entries]);
}

function words(text) {
  return text.normalize('NFKC').toLowerCase().replace(/ё/g, 'е')
    .replace(/(?:^|\s)(?:[:;=]-?[()dp]+|[xх]d)(?=$|\s|[!?.,])/giu, ' ')
    .replace(/[()]+[()0]*$/u, '').match(/[\p{L}\p{N}]+/gu) || [];
}
export function repeatedReply(text, previous) {
  const tokens = words(text), normalized = tokens.join(' '), current = new Set(tokens);
  if (!normalized) return null;
  for (const entry of previous.slice(-12).reverse()) {
    const prior = words(entry.text), other = new Set(prior);
    if (normalized === prior.join(' ')) return { reason: 'exact', matched: entry.text };
    const shared = [...current].filter(word => other.has(word)).length;
    const similarity = shared / Math.max(current.size, other.size, 1);
    if (shared >= 4 && similarity >= 0.65) return { reason: 'similar', matched: entry.text, similarity };
  }
  return null;
}
