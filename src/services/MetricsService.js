import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { ValidationError } from '../domain/errors.js';

export class RollingSample {
  #values;
  #next = 0;
  #filled = 0;
  #count = 0;
  #sum = 0;

  constructor(capacity = 1000) {
    this.#values = new Float64Array(capacity);
  }

  add(value) {
    this.#values[this.#next] = value;
    this.#next = (this.#next + 1) % this.#values.length;
    this.#filled = Math.min(this.#filled + 1, this.#values.length);
    this.#count++;
    this.#sum += value;
  }

  get count() { return this.#count; }

  percentile(p) {
    if (this.#filled === 0) return 0;
    const sorted = this.#values.slice(0, this.#filled).sort();
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  }

  summary() {
    const round = (value) => Math.round(value * 100) / 100;
    return {
      count: this.#count,
      avg: this.#count ? round(this.#sum / this.#count) : 0,
      p50: round(this.percentile(50)),
      p75: round(this.percentile(75)),
      p95: round(this.percentile(95)),
      p99: round(this.percentile(99)),
    };
  }
}

const VITAL_THRESHOLDS = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export function rateVital(name, value) {
  const [good, poor] = VITAL_THRESHOLDS[name];
  if (value <= good) return 'good';
  return value <= poor ? 'needs-improvement' : 'poor';
}

export class MetricsService {
  #routes = new Map();
  #vitals = new Map();
  #tasks = new Map();
  #queries = new Map();
  #eventLoop = null;
  #startedAt = performance.now();
  #workerPool;
  #extraGauges;

  constructor({ workerPool, extraGauges = () => ({}) } = {}) {
    this.#workerPool = workerPool;
    this.#extraGauges = extraGauges;
    workerPool?.onTask((task) => this.recordTask(task));
  }

  start() {
    this.#eventLoop ??= monitorEventLoopDelay({ resolution: 20 });
    this.#eventLoop.enable();
  }

  stop() {
    this.#eventLoop?.disable();
  }

  recordRequest({ method, route, status, durationMs }) {
    const key = `${method} ${route}`;
    if (!this.#routes.has(key)) this.#routes.set(key, { method, route, sample: new RollingSample(), errors: 0 });
    const entry = this.#routes.get(key);
    entry.sample.add(durationMs);
    if (status >= 500) entry.errors++;
  }

  recordTask({ type, ok, runMs, waitMs }) {
    if (!this.#tasks.has(type)) this.#tasks.set(type, { run: new RollingSample(), wait: new RollingSample(), failed: 0 });
    const entry = this.#tasks.get(type);
    if (!ok) { entry.failed++; return; }
    entry.run.add(runMs);
    entry.wait.add(waitMs);
  }

  recordQuery({ name, durationMs }) {
    if (!this.#queries.has(name)) this.#queries.set(name, new RollingSample());
    this.#queries.get(name).add(durationMs);
  }

  recordVitals(entries, { page } = {}) {
    const list = Array.isArray(entries) ? entries : [entries];
    if (list.length === 0 || list.length > 20) throw new ValidationError('Envía entre 1 y 20 métricas');
    let accepted = 0;
    for (const { name, value } of list) {
      if (!(name in VITAL_THRESHOLDS) || !Number.isFinite(value) || value < 0) continue;
      const key = `${name}|${String(page ?? '/').slice(0, 100)}`;
      if (!this.#vitals.has(key)) this.#vitals.set(key, { name, page: String(page ?? '/').slice(0, 100), sample: new RollingSample(500) });
      this.#vitals.get(key).sample.add(value);
      accepted++;
    }
    return { accepted };
  }

  #webVitalsSummary() {
    const byName = {};
    for (const { name, page, sample } of this.#vitals.values()) {
      const p75 = sample.percentile(75);
      (byName[name] ??= []).push({ page, count: sample.count, p75: Math.round(p75 * 1000) / 1000, rating: rateVital(name, p75) });
    }
    return byName;
  }

  summary() {
    const memory = process.memoryUsage();
    const toMs = (ns) => Math.round((ns / 1e6) * 100) / 100;
    const loop = this.#eventLoop;
    return {
      uptimeSeconds: Math.round((performance.now() - this.#startedAt) / 1000),
      memoryMB: {
        rss: Math.round(memory.rss / 1048576),
        heapUsed: Math.round(memory.heapUsed / 1048576),
      },
      eventLoopDelayMs: loop && loop.count > 0
        ? { mean: toMs(loop.mean), p99: toMs(loop.percentile(99)), max: toMs(loop.max) }
        : null,
      http: [...this.#routes.values()]
        .map(({ method, route, sample, errors }) => ({ method, route, ...sample.summary(), errors }))
        .sort((a, b) => b.count - a.count),
      workers: {
        pool: this.#workerPool?.stats() ?? null,
        tasks: Object.fromEntries([...this.#tasks.entries()].map(([type, entry]) => [type, {
          run: entry.run.summary(), wait: entry.wait.summary(), failed: entry.failed,
        }])),
      },
      database: Object.fromEntries([...this.#queries.entries()].map(([name, sample]) => [name, sample.summary()])),
      webVitals: this.#webVitalsSummary(),
      ...this.#extraGauges(),
    };
  }

  prometheus() {
    const lines = [];
    const label = (value) => String(value).replace(/["\\\n]/g, '_');
    lines.push('# HELP http_request_duration_ms Latency of HTTP requests per route');
    lines.push('# TYPE http_request_duration_ms summary');
    for (const { method, route, sample, errors } of this.#routes.values()) {
      const base = `method="${label(method)}",route="${label(route)}"`;
      for (const q of [50, 95, 99]) lines.push(`http_request_duration_ms{${base},quantile="${q / 100}"} ${sample.percentile(q).toFixed(2)}`);
      lines.push(`http_request_duration_ms_count{${base}} ${sample.count}`);
      lines.push(`http_request_errors_total{${base}} ${errors}`);
    }
    const pool = this.#workerPool?.stats();
    if (pool) {
      lines.push('# TYPE worker_pool_tasks_total counter');
      lines.push(`worker_pool_tasks_total{result="completed"} ${pool.completed}`);
      lines.push(`worker_pool_tasks_total{result="failed"} ${pool.failed}`);
      lines.push('# TYPE worker_pool_queue gauge');
      lines.push(`worker_pool_queue ${pool.queued}`);
    }
    if (this.#queries.size > 0) {
      lines.push('# TYPE db_query_duration_ms summary');
      for (const [name, sample] of this.#queries.entries()) {
        for (const q of [50, 95, 99]) lines.push(`db_query_duration_ms{query="${label(name)}",quantile="${q / 100}"} ${sample.percentile(q).toFixed(2)}`);
        lines.push(`db_query_duration_ms_count{query="${label(name)}"} ${sample.count}`);
      }
    }
    if (this.#eventLoop?.count > 0) {
      lines.push('# TYPE nodejs_eventloop_delay_p99_ms gauge');
      lines.push(`nodejs_eventloop_delay_p99_ms ${(this.#eventLoop.percentile(99) / 1e6).toFixed(2)}`);
    }
    lines.push('# TYPE web_vitals_p75 gauge');
    for (const { name, page, sample } of this.#vitals.values()) {
      lines.push(`web_vitals_p75{name="${name}",page="${label(page)}"} ${sample.percentile(75)}`);
    }
    lines.push(`process_resident_memory_bytes ${process.memoryUsage().rss}`);
    return `${lines.join('\n')}\n`;
  }
}
