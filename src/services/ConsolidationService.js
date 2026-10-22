import { performance } from 'node:perf_hooks';
import { IncidentStatus } from '../domain/IncidentStatus.js';
import { Events } from '../infrastructure/EventBus.js';
import { Clock } from '../infrastructure/Clock.js';

const MERGEABLE = new Set([IncidentStatus.REPORTED, IncidentStatus.IN_REVIEW]);

export class ConsolidationService {
  #incidents;
  #reports;
  #workerPool;
  #bus;
  #clock;
  #eps;
  #running = null;
  #lastRun = null;
  #timer = null;
  #intervalMs = null;

  constructor({ incidentRepository, reportRepository, workerPool, eventBus, clock = new Clock(), clusterRadiusMeters = 30 }) {
    this.#incidents = incidentRepository;
    this.#reports = reportRepository;
    this.#workerPool = workerPool;
    this.#bus = eventBus;
    this.#clock = clock;
    this.#eps = clusterRadiusMeters;
  }

  run() {
    this.#running ??= this.#execute().finally(() => { this.#running = null; });
    return this.#running;
  }

  async #execute() {
    const started = performance.now();
    const candidates = await this.#incidents.findAll((incident) => MERGEABLE.has(incident.status));
    const reportOwner = new Map();
    const points = [];
    for (const incident of candidates) {
      for (const report of await this.#reports.findByIncident(incident.id)) {
        reportOwner.set(report.id, incident.id);
        points.push({ id: report.id, lat: report.location.lat, lng: report.location.lng });
      }
    }

    const clusterStarted = performance.now();
    const { clusters } = await this.#workerPool.run('dbscan', { points, epsMeters: this.#eps, minPoints: 1 });
    const clusterMs = performance.now() - clusterStarted;

    const merges = [];
    for (const cluster of clusters) {
      const incidentIds = [...new Set(cluster.memberIds.map((id) => reportOwner.get(id)))];
      if (incidentIds.length < 2) continue;
      merges.push(await this.#merge(incidentIds));
    }

    this.#lastRun = {
      at: this.#clock.now().toISOString(),
      durationMs: Math.round(performance.now() - started),
      clusteringMs: Math.round(clusterMs),
      reportsAnalyzed: points.length,
      clustersFound: clusters.length,
      incidentsMerged: merges.reduce((sum, merge) => sum + merge.absorbedIds.length, 0),
      merges: merges.filter((merge) => merge.absorbedIds.length > 0),
    };
    return this.#lastRun;
  }

  async #merge(incidentIds) {
    const incidents = (await Promise.all(incidentIds.map((id) => this.#incidents.findById(id))))
      .filter((incident) => incident && MERGEABLE.has(incident.status))
      .sort((a, b) => a.createdAt - b.createdAt);
    const [target, ...others] = incidents;
    const absorbedIds = [];
    for (const other of others) {
      const reports = await this.#reports.findByIncident(other.id);
      target.absorb(other, reports, { at: this.#clock.now() });
      await Promise.all(reports.map((report) => this.#reports.save(report)));
      await this.#incidents.delete(other.id);
      absorbedIds.push(other.id);
    }
    if (target && absorbedIds.length > 0) {
      await this.#incidents.save(target);
      await this.#bus.publish(Events.INCIDENTS_MERGED, { incident: target, absorbedIds });
    }
    return { targetId: target?.id ?? null, absorbedIds };
  }

  status() {
    return { running: Boolean(this.#running), intervalMs: this.#intervalMs, lastRun: this.#lastRun };
  }

  start(intervalMs) {
    if (!intervalMs || this.#timer) return;
    this.#intervalMs = intervalMs;
    this.#timer = setInterval(() => {
      this.run().catch((error) => console.error('[Consolidation] Falló la consolidación:', error));
    }, intervalMs);
    this.#timer.unref();
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#intervalMs = null;
  }
}
