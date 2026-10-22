import { Clock } from '../infrastructure/Clock.js';

export class IsrCache {
  #ttlMs;
  #clock;
  #entries = new Map();
  #pending = new Map();
  #stats = { hits: 0, stale: 0, misses: 0, invalidations: 0 };

  constructor({ ttlMs = 60_000, clock = new Clock() } = {}) {
    this.#ttlMs = ttlMs;
    this.#clock = clock;
  }

  async get(key, render) {
    const entry = this.#entries.get(key);
    const now = this.#clock.now().getTime();
    if (entry && now - entry.renderedAt < this.#ttlMs) {
      this.#stats.hits++;
      return { html: entry.html, state: 'HIT', renderedAt: entry.renderedAt };
    }
    if (entry) {
      this.#stats.stale++;
      this.#revalidate(key, render).catch(() => {});
      return { html: entry.html, state: 'STALE', renderedAt: entry.renderedAt };
    }
    this.#stats.misses++;
    const html = await this.#revalidate(key, render);
    return { html, state: 'MISS', renderedAt: now };
  }

  #revalidate(key, render) {
    if (this.#pending.has(key)) return this.#pending.get(key);
    const promise = render()
      .then((html) => {
        if (html === null) this.#entries.delete(key);
        else this.#entries.set(key, { html, renderedAt: this.#clock.now().getTime() });
        return html;
      })
      .finally(() => this.#pending.delete(key));
    this.#pending.set(key, promise);
    return promise;
  }

  invalidate(key) {
    if (this.#entries.delete(key)) this.#stats.invalidations++;
  }

  stats() {
    return { ...this.#stats, entries: this.#entries.size, ttlMs: this.#ttlMs };
  }
}
