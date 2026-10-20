import { setTimeout } from 'node:timers/promises';

export async function waitForGame({ event, getTick, getSession, isRunning, now = Date.now, sleep = () => setTimeout(200), onWaiting = () => {}, pollReserveMs = 2500 }) {
  let announced = false;
  while (true) {
    if (!isRunning() || getSession() !== event.session) return 'cancelled';
    const time = now();
    if (!Number.isFinite(event.expires) || event.expires <= time + pollReserveMs) return 'expired';
    const tick = getTick();
    if (tick?.session === event.session && time - tick.wall >= 0 && time - tick.wall < 3000) return 'ready';
    if (!announced) { onWaiting(); announced = true; }
    await sleep();
  }
}
