import { parseBoundingBox } from '../../clustering/geo.js';

const parseLimit = (value, fallback, max = 500) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback;
};

export class IncidentController {
  #incidents;
  #heatmap;

  constructor({ incidentService, heatmapService }) {
    this.#incidents = incidentService;
    this.#heatmap = heatmapService;
  }

  list = async (req, res) => {
    const { status, category, roadType, priority, sort } = req.query;
    const items = await res.locals.timing.measure('query', () => this.#incidents.list({
      status, category, roadType, priority, sort,
      bbox: parseBoundingBox(req.query.bbox),
      limit: parseLimit(req.query.limit, 500),
    }));
    res.json({ count: items.length, items });
  };

  priorityQueue = async (req, res) => {
    const items = await this.#incidents.priorityQueue(parseLimit(req.query.limit, 20, 100));
    res.json({ strategy: this.#incidents.priorityStrategyName, items });
  };

  detail = async (req, res) => {
    res.json(await this.#incidents.getDetail(req.params.id));
  };

  changeStatus = async (req, res) => {
    const { status, note } = req.body ?? {};
    res.json(await this.#incidents.changeStatus(req.user, req.params.id, status, note));
  };

  attachHistoryPhoto = async (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : null;
    res.json(await res.locals.timing.measure('photo', () => this.#incidents.attachHistoryPhoto(req.user, req.params.id, req.params.entry, bytes)));
  };

  heatmap = async (req, res) => {
    const data = await res.locals.timing.measure('heatmap', () => this.#heatmap.build({ bbox: parseBoundingBox(req.query.bbox) }));
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json(data);
  };
}
