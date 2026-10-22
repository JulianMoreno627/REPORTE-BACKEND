import { Clock } from './Clock.js';

export class SlidingWindowRateLimiter {
  #limit;
  #windowMs;
  #clock;
  #hits = new Map();

  constructor({ limit, windowMs, clock = new Clock() }) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#clock = clock;
  }

  get limit() { return this.#limit; }

  #recent(key, now) {
    return (this.#hits.get(key) ?? []).filter((time) => now - time < this.#windowMs);
  }

  peek(key) {
    const now = this.#clock.now().getTime();
    const recent = this.#recent(key, now);
    const allowed = recent.length < this.#limit;
    return {
      allowed,
      remaining: Math.max(0, this.#limit - recent.length),
      retryAfterMs: allowed ? 0 : this.#windowMs - (now - recent[0]),
    };
  }

  consume(key) {
    const now = this.#clock.now().getTime();
    const recent = this.#recent(key, now);
    if (recent.length >= this.#limit) {
      this.#hits.set(key, recent);
      return { allowed: false, remaining: 0, retryAfterMs: this.#windowMs - (now - recent[0]) };
    }
    recent.push(now);
    this.#hits.set(key, recent);
    return { allowed: true, remaining: this.#limit - recent.length, retryAfterMs: 0 };
  }

  prune() {
    const now = this.#clock.now().getTime();
    for (const key of this.#hits.keys()) {
      if (this.#recent(key, now).length === 0) this.#hits.delete(key);
    }
  }
}
