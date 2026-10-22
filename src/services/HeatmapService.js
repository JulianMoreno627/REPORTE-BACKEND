import { Clock } from '../infrastructure/Clock.js';

export class HeatmapService {
  #incidents;
  #priority;
  #clock;

  constructor({ incidentRepository, priorityStrategy, clock = new Clock() }) {
    this.#incidents = incidentRepository;
    this.#priority = priorityStrategy;
    this.#clock = clock;
  }

  async build({ bbox } = {}) {
    const now = this.#clock.now();
    const open = await this.#incidents.findInBounds(bbox, (incident) => incident.isOpen);
    const points = open.map((incident) => {
      const { score } = this.#priority.evaluate(incident, now);
      return [
        Math.round(incident.location.lat * 1e6) / 1e6,
        Math.round(incident.location.lng * 1e6) / 1e6,
        score,
      ];
    });
    return {
      generatedAt: now.toISOString(),
      strategy: this.#priority.name,
      count: points.length,
      gradient: { 0.35: '#facc15', 0.6: '#f97316', 1.0: '#dc2626' },
      points,
    };
  }
}
