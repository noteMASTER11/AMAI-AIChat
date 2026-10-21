export function alliesFrom(extra) {
  if (!/^allies:\d+(?:,\d+)*$/.test(extra)) return null;
  const slots = extra.slice(7).split(',').map(Number);
  return slots.every(slot => Number.isInteger(slot) && slot >= 0 && slot < 24) ? [...new Set(slots)] : null;
}
export function audienceFor(bot, bots, human) {
  return [human, ...bots.values()].filter(player => player && player.slot !== bot.slot && (player.slot === human.slot || !bot.allies?.includes(player.slot) || bot.allies?.includes(human.slot))).map(player => ({ slot: player.slot, name: player.name, relation: bot.allies?.includes(player.slot) ? 'ally' : 'enemy' }));
}
export function routeFor(bot, recipient, bots, humanSlot) {
  if (!Number.isInteger(recipient) || recipient === bot.slot || (recipient !== humanSlot && !bots.has(recipient))) throw new Error('Invalid conversation recipient');
  const team = bot.allies?.includes(recipient);
  if (team && !bot.allies.includes(humanSlot)) throw new Error('Invisible enemy team dialogue is disabled');
  return { channel: team ? 'team' : 'all', recipient, recipients: team ? [...bot.allies] : [humanSlot, ...bots.keys()] };
}
export function routeHumanChat(event, bots, humanSlot) {
  // EVENT_PLAYER_CHAT exposes text and sender, not the Enter/Shift+Enter channel.
  // Keep the bridge's recipient policy distinct from that unavailable fact.
  const allies = [...bots.values()].filter(bot => bot.allies.includes(humanSlot)).map(bot => bot.slot);
  const prefix = /^@(all|team)\s+/i.exec(event.text)?.[1].toLowerCase();
  const mode = /(?:^|;)input=(all|team|auto)(?:;|$)/.exec(event.extra || '')?.[1] || 'auto';
  const channel = prefix || (mode !== 'auto' ? mode : 'all');
  return { text: event.text.replace(/^@(all|team)\s+/i, ''), channel, bridgeChannel: channel, nativeChannel: 'unknown', inputChannelSource: prefix ? 'explicit-prefix' : mode === 'auto' ? 'public-default' : 'bridge-mode', recipients: channel === 'team' ? allies : [...bots.keys()] };
}
export function historyFor(slot, history) {
  return history.filter(event => {
    if (event.kind === 'reply') return event.channel !== 'team' || event.recipients?.includes(slot);
    if (event.kind === 'chat') return event.recipients?.includes(slot);
    return event.kind === 'hello' || event.bot === slot;
  }).slice(-24);
}
export function followupFor(delivery, bots, time, humanSlot = 0) {
  if (delivery.purpose !== 'llm' || (delivery.depth || 0) >= 1 || delivery.recipient === delivery.bot || !bots.has(delivery.recipient)) return null;
  if (delivery.channel === 'team' && !delivery.recipients?.includes(delivery.recipient)) return null;
  if (delivery.channel === 'team' && !delivery.recipients?.includes(humanSlot)) return null;
  return { session: delivery.session, seq: delivery.seq, time, kind: 'bot-chat', bot: delivery.recipient, sourceBot: delivery.bot, text: delivery.text, channel: delivery.channel, recipients: delivery.recipients, replyLanguage: delivery.replyLanguage, depth: 1 };
}
export function parseAcknowledgement(extra) {
  const [poll, visible] = String(extra).split(',');
  return { poll: /^\d+$/.test(poll) ? Number(poll) : -1, visible: visible === '1' ? true : visible === '0' ? false : null };
}
