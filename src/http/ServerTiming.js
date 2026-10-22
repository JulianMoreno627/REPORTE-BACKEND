import { performance } from 'node:perf_hooks';

export class ServerTiming {
  #start = performance.now();
  #entries = [];

  add(name, durationMs, description) {
    this.#entries.push({ name, durationMs, description });
  }

  async measure(name, fn, description) {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.add(name, performance.now() - start, description);
    }
  }

  get elapsedMs() {
    return performance.now() - this.#start;
  }

  header() {
    const parts = this.#entries.map(({ name, durationMs, description }) => {
      const desc = description ? `;desc="${description.replace(/"/g, "'")}"` : '';
      return `${name};dur=${durationMs.toFixed(1)}${desc}`;
    });
    parts.push(`total;dur=${this.elapsedMs.toFixed(1)}`);
    return parts.join(', ');
  }
}
