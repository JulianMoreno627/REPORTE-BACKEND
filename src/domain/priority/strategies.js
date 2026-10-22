import { PriorityStrategy } from './PriorityStrategy.js';

const round = (value) => Math.round(value * 1000) / 1000;

export class WeightedPriorityStrategy extends PriorityStrategy {
  static DEFAULT_WEIGHTS = Object.freeze({ reports: 0.4, age: 0.25, road: 0.2, severity: 0.15 });

  #weights;
  #reportSaturation;
  #maxAgeDays;

  constructor({ weights = WeightedPriorityStrategy.DEFAULT_WEIGHTS, reportSaturation = 10, maxAgeDays = 30 } = {}) {
    super();
    this.#weights = weights;
    this.#reportSaturation = reportSaturation;
    this.#maxAgeDays = maxAgeDays;
  }

  get name() { return 'weighted'; }

  evaluate(incident, now = new Date()) {
    const factors = {
      reports: round(Math.min(1, Math.log1p(incident.reportCount) / Math.log1p(this.#reportSaturation))),
      age: round(Math.min(1, incident.ageInDays(now) / this.#maxAgeDays)),
      road: incident.roadType.weight,
      severity: incident.category.severity,
    };
    const totalWeight = Object.values(this.#weights).reduce((sum, weight) => sum + weight, 0);
    const score = Object.entries(this.#weights)
      .reduce((sum, [key, weight]) => sum + weight * factors[key], 0) / totalWeight;
    return this.result(incident, score, factors);
  }
}

export class ReportCountPriorityStrategy extends PriorityStrategy {
  #saturation;

  constructor({ saturation = 10 } = {}) {
    super();
    this.#saturation = saturation;
  }

  get name() { return 'count'; }

  evaluate(incident) {
    const reports = round(Math.min(1, incident.reportCount / this.#saturation));
    return this.result(incident, reports, { reports });
  }
}

export function createPriorityStrategy(name) {
  switch (name) {
    case 'count': return new ReportCountPriorityStrategy();
    case 'weighted':
    default: return new WeightedPriorityStrategy();
  }
}
