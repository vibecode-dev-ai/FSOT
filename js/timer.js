// Per-section countdown. Drives the clock display and fires when time runs out.

export class Countdown {
  /**
   * @param {number} seconds Total seconds for this section.
   * @param {object} handlers
   * @param {(remaining:number)=>void} handlers.onTick
   * @param {()=>void} handlers.onExpire
   */
  constructor(seconds, { onTick, onExpire } = {}) {
    this.total = seconds;
    this.remaining = seconds;
    this.onTick = onTick ?? (() => {});
    this.onExpire = onExpire ?? (() => {});
    this._interval = null;
    this._endsAt = null;
    this._running = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    // Track against wall-clock so a throttled background tab can't gain time.
    this._endsAt = Date.now() + this.remaining * 1000;
    this._interval = setInterval(() => this._tick(), 250);
    this.onTick(this.remaining);
  }

  _tick() {
    const left = Math.max(0, Math.round((this._endsAt - Date.now()) / 1000));
    if (left === this.remaining) return;
    this.remaining = left;
    this.onTick(left);
    if (left <= 0) {
      this.stop();
      this.onExpire();
    }
  }

  pause() {
    if (!this._running) return;
    this.remaining = Math.max(0, Math.round((this._endsAt - Date.now()) / 1000));
    this.stop();
  }

  resume() {
    if (this._running || this.remaining <= 0) return;
    this.start();
  }

  stop() {
    this._running = false;
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
  }

  get running() {
    return this._running;
  }

  get elapsed() {
    return this.total - this.remaining;
  }
}

/** 2745 -> "45:45". Hours are included only when needed. */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** 9_240_000 -> "2h 34m". Used for durations in the history table. */
export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
