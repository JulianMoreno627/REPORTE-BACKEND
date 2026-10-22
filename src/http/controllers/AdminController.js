export class AdminController {
  #incidents;
  #consolidation;
  #isrCache;

  constructor({ incidentService, consolidationService, isrCache }) {
    this.#incidents = incidentService;
    this.#consolidation = consolidationService;
    this.#isrCache = isrCache;
  }

  summary = async (_req, res) => {
    res.json({
      ...(await this.#incidents.summary()),
      consolidation: this.#consolidation.status(),
      isrCache: this.#isrCache.stats(),
    });
  };

  consolidate = async (_req, res) => {
    const result = await res.locals.timing.measure('dbscan', () => this.#consolidation.run(), 'worker thread');
    res.json(result);
  };

  consolidationStatus = (_req, res) => {
    res.json(this.#consolidation.status());
  };
}
