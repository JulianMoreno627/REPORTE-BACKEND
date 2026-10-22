import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

export class WorkerPool {
  #scriptUrl;
  #size;
  #workers = new Set();
  #idle = [];
  #active = new Map();
  #queue = [];
  #nextTaskId = 1;
  #started = false;
  #closed = false;
  #listeners = new Set();
  #stats = { completed: 0, failed: 0, totalRunMs: 0, totalWaitMs: 0 };

  constructor(scriptUrl, { size = 2 } = {}) {
    this.#scriptUrl = scriptUrl;
    this.#size = Math.max(1, size);
  }

  onTask(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  run(type, payload) {
    if (this.#closed) return Promise.reject(new Error('El pool de workers está cerrado'));
    this.#ensureStarted();
    return new Promise((resolve, reject) => {
      this.#queue.push({ id: this.#nextTaskId++, type, payload, resolve, reject, enqueuedAt: performance.now() });
      this.#drain();
    });
  }

  #ensureStarted() {
    if (this.#started) return;
    this.#started = true;
    for (let i = 0; i < this.#size; i++) this.#spawn();
  }

  #spawn() {
    const worker = new Worker(this.#scriptUrl);
    worker.on('message', (message) => this.#onMessage(worker, message));
    worker.on('error', (error) => this.#retire(worker, error));
    worker.on('exit', (code) => this.#retire(worker, new Error(`El worker terminó con código ${code}`)));
    this.#workers.add(worker);
    this.#idle.push(worker);
  }

  #drain() {
    while (this.#idle.length > 0 && this.#queue.length > 0) {
      const worker = this.#idle.pop();
      const task = this.#queue.shift();
      task.startedAt = performance.now();
      this.#active.set(worker, task);
      worker.postMessage({ id: task.id, type: task.type, payload: task.payload });
    }
  }

  #onMessage(worker, { id, ok, result, error }) {
    const task = this.#active.get(worker);
    if (!task || task.id !== id) return;
    this.#active.delete(worker);
    this.#idle.push(worker);

    const runMs = performance.now() - task.startedAt;
    const waitMs = task.startedAt - task.enqueuedAt;
    if (ok) {
      this.#stats.completed++;
      this.#stats.totalRunMs += runMs;
      this.#stats.totalWaitMs += waitMs;
      task.resolve(result);
    } else {
      this.#stats.failed++;
      task.reject(new Error(error));
    }
    for (const listener of this.#listeners) listener({ type: task.type, ok, runMs, waitMs });
    this.#drain();
  }

  #retire(worker, error) {
    if (!this.#workers.has(worker)) return;
    this.#workers.delete(worker);
    this.#idle = this.#idle.filter((candidate) => candidate !== worker);
    const task = this.#active.get(worker);
    if (task) {
      this.#active.delete(worker);
      this.#stats.failed++;
      task.reject(error);
    }
    if (!this.#closed) {
      this.#spawn();
      this.#drain();
    }
  }

  stats() {
    const { completed, failed, totalRunMs, totalWaitMs } = this.#stats;
    return {
      size: this.#size,
      started: this.#started,
      busy: this.#active.size,
      idle: this.#idle.length,
      queued: this.#queue.length,
      completed,
      failed,
      avgRunMs: completed ? Math.round((totalRunMs / completed) * 100) / 100 : 0,
      avgWaitMs: completed ? Math.round((totalWaitMs / completed) * 100) / 100 : 0,
    };
  }

  async close() {
    this.#closed = true;
    const workers = [...this.#workers];
    this.#workers.clear();
    this.#idle = [];
    for (const task of [...this.#queue, ...this.#active.values()]) task.reject(new Error('El pool de workers se cerró'));
    this.#queue = [];
    this.#active.clear();
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}
