import { ValidationError } from '../../domain/errors.js';

export class MetricsController {
  #metrics;

  constructor({ metricsService }) {
    this.#metrics = metricsService;
  }

  webVitals = (req, res) => {
    let body = req.body ?? {};
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body || '{}');
      } catch {
        throw new ValidationError('Las métricas deben enviarse como JSON');
      }
    }
    const result = this.#metrics.recordVitals(body.metrics ?? body, { page: body.page });
    res.status(202).json(result);
  };

  summary = (_req, res) => {
    res.json(this.#metrics.summary());
  };

  prometheus = (_req, res) => {
    res.type('text/plain; version=0.0.4').send(this.#metrics.prometheus());
  };
}
