import { unlink } from 'node:fs/promises';

const sessionPattern = /^\d{6,18}$/;
const kinds = new Set(['sighting', 'self-state', 'action-status', 'hello', 'tick', 'bot', 'chat', 'death', 'revive', 'off', 'move', 'position', 'build-start', 'build-finish', 'build-cancel', 'upgrade-start', 'upgrade-finish', 'upgrade-cancel', 'research', 'level', 'skill', 'abilities', 'item-pickup', 'item-drop', 'item-use', 'item-buy', 'item-sell', 'inventory']);
const decode = s => s.replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
export function replyWindow(event, tick, now, delayMs) {
  if (!Number.isFinite(event.expires) || event.expires <= now + delayMs) throw new Error('Reply expired before its game poll');
  return { expiresAt: event.expires, gameDeadline: tick.time + (event.expires - tick.wall) / 1000 };
}
export async function expireReplies(pending, now) {
  for (const [filename, deadline] of pending) if (deadline <= now) {
    await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
    pending.delete(filename);
  }
}
export function parseEvents(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 262144) return [];
  const result = [];
  for (const match of text.matchAll(/call Preload\(\s*"(AMAI1\|[^"\r\n]*)"\s*\)/g)) {
    const f = match[1].split('|');
    if (f.length !== 14 || !sessionPattern.test(f[1]) || !kinds.has(f[4])) continue;
    const [seq, time, bot, human, unitType, level, owner, killer] = [f[2], f[3], f[5], f[6], f[7], f[9], f[10], f[11]].map(Number);
    if (![seq, bot, human, unitType, level, owner, killer].every(Number.isSafeInteger) || seq < 0 || !Number.isFinite(time) || time < 0) continue;
    if (bot < -1 || bot > 23 || human < 0 || human > 23 || owner < -1 || owner > 27 || killer < -1 || killer > 27) continue;
    result.push({ session: f[1], seq, time, kind: f[4], bot, human, unitType, unitName: decode(f[8]), level, owner, killer, text: decode(f[12]), extra: decode(f[13]) });
  }
  return result;
}

export function cleanText(text, { chatMaxBytes = 120, chatMaxChars = 80 } = {}) {
  if (!Number.isSafeInteger(chatMaxBytes) || chatMaxBytes < 8 || !Number.isSafeInteger(chatMaxChars) || chatMaxChars < 4) throw new Error('Invalid chat text budget');
  const normalized = String(text).replace(/\|c[0-9a-f]{8}/gi, '').replace(/\|[rn]/gi, ' ').replace(/[\x00-\x1f\x7f|]/g, ' ').replace(/\s+/g, ' ').trim();
  if ([...normalized].length <= chatMaxChars && Buffer.byteLength(normalized, 'utf8') <= chatMaxBytes) return normalized;
  const ellipsis = '…';
  let result = '';
  for (const char of normalized) {
    if ([...result].length + 1 > chatMaxChars - 1 || Buffer.byteLength(result + char + ellipsis, 'utf8') > chatMaxBytes) break;
    result += char;
  }
  const sentence = /^(.*[.!?])(?:\s|$)/u.exec(result)?.[1];
  if (sentence) return sentence.trim();
  const boundary = result.lastIndexOf(' ');
  return boundary >= 0 ? result.slice(0, boundary).trimEnd() + ellipsis : ellipsis;
}

export function makeReply(session, seq, bot, text, deadline, token = seq, route = { channel: 'all', recipient: -1 }, limits = {}) {
  if (!sessionPattern.test(session) || !Number.isSafeInteger(seq) || seq < 1 || !Number.isSafeInteger(token) || token < 1 || !Number.isSafeInteger(bot) || bot < 0 || bot > 23 || !Number.isFinite(deadline) || deadline <= 0) throw new Error('Invalid reply identity/deadline');
  if (!['all', 'team'].includes(route.channel) || !Number.isInteger(route.recipient) || route.recipient < (route.channel === 'team' ? 0 : -1) || route.recipient > 23 || route.recipient === bot) throw new Error('Invalid reply route');
  const payload = `${session}|${token}|${bot}|${deadline}|${cleanText(text, limits)}|${seq}|${route.channel}|${route.recipient}`.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `function PreloadFiles takes nothing returns nothing\ncall BlzSetAbilityTooltip(1097690227, "${payload}", 0)\nendfunction\n`;
}

export class Inbox {
  session = null;
  last = 0;
  retired = new Set();
  constructor(saved = {}) {
    if (sessionPattern.test(saved.session || '') && Number.isSafeInteger(saved.last) && saved.last >= 0) { this.session = saved.session; this.last = saved.last; }
  }
  accept(events) {
    const heartbeats = events.filter(e => e.kind === 'tick');
    if (heartbeats.length !== 1 || events.some(e => e.session !== heartbeats[0].session)) return [];
    const out = [];
    for (const event of events) {
      if (this.retired.has(event.session)) continue;
      if (event.session !== this.session) {
        if (this.session) this.retired.add(this.session);
        this.session = event.session;
        this.last = 0;
      }
      if (event.kind === 'tick' || (event.kind === 'bot' && event.seq === 0)) { out.push(event); continue; }
      if (event.seq <= this.last) continue;
      this.last = event.seq;
      out.push(event);
    }
    return out;
  }
}
