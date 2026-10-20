const sessionPattern = /^\d{6,18}$/;
const kinds = new Set(['hello', 'tick', 'bot', 'chat', 'death', 'revive', 'off']);
const decode = s => s.replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

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

export function cleanText(text) {
  return [...String(text).replace(/\|c[0-9a-f]{8}/gi, '').replace(/\|[rn]/gi, ' ').replace(/[\x00-\x1f\x7f|]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, 180).join('');
}

export function makeReply(session, seq, bot, text) {
  if (!sessionPattern.test(session) || !Number.isSafeInteger(seq) || seq < 1 || !Number.isSafeInteger(bot) || bot < 0 || bot > 23) throw new Error('Invalid reply identity');
  const payload = `${session}|${seq}|${bot}|${cleanText(text)}`.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `function PreloadFiles takes nothing returns nothing\ncall BlzSetAbilityTooltip(1097690227, "${payload}", 0)\nendfunction\n`;
}

export class Inbox {
  session = null;
  last = 0;
  retired = new Set();
  accept(events) {
    const out = [];
    for (const event of events) {
      if (this.retired.has(event.session)) continue;
      if (event.session !== this.session) {
        if (this.session) this.retired.add(this.session);
        this.session = event.session;
        this.last = 0;
      }
      if (event.kind === 'tick') { out.push(event); continue; }
      if (event.seq <= this.last) continue;
      this.last = event.seq;
      out.push(event);
    }
    return out;
  }
}
