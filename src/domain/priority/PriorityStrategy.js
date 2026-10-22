export const PriorityLevel = Object.freeze({
  HIGH: { level: 'HIGH', levelLabel: 'Alta', min: 0.6 },
  MEDIUM: { level: 'MEDIUM', levelLabel: 'Media', min: 0.35 },
  LOW: { level: 'LOW', levelLabel: 'Baja', min: 0 },
  NONE: { level: 'NONE', levelLabel: 'Cerrado', min: -1 },
});

export class PriorityStrategy {
  constructor() {
    if (new.target === PriorityStrategy) throw new TypeError('PriorityStrategy es abstracta');
  }

  get name() { throw new Error('No implementado'); }

  evaluate(_incident, _now) {
    throw new Error('No implementado');
  }

  result(incident, score, factors) {
    if (!incident.isOpen) return { score: 0, level: 'NONE', levelLabel: PriorityLevel.NONE.levelLabel, factors };
    const rounded = Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000;
    const { level, levelLabel } = [PriorityLevel.HIGH, PriorityLevel.MEDIUM, PriorityLevel.LOW]
      .find((candidate) => rounded >= candidate.min);
    return { score: rounded, level, levelLabel, factors };
  }
}
