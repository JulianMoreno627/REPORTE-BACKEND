export class ReportController {
  #reports;

  constructor({ reportService }) {
    this.#reports = reportService;
  }

  create = async (req, res) => {
    const result = await res.locals.timing.measure('assign', () => this.#reports.create(req.user, req.body ?? {}), 'clustering 30 m');
    const message = result.replayed
      ? 'Este reporte ya se había recibido'
      : result.grouped
        ? `Gracias. Ya existía un reporte de este daño a ${result.distanceMeters} m: tu reporte suma prioridad.`
        : 'Gracias. Registramos un nuevo incidente.';
    res.status(result.replayed ? 200 : 201).json({
      message,
      grouped: result.grouped,
      replayed: result.replayed,
      report: result.report.toJSON(),
      incident: result.incident?.toJSON() ?? null,
    });
  };

  createBatch = async (req, res) => {
    const results = await this.#reports.createBatch(req.user, req.body?.reports);
    res.status(207).json({ results });
  };

  attachPhoto = async (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : null;
    const { report, analysis } = await res.locals.timing.measure('photo', () => this.#reports.attachPhoto(req.user, req.params.id, bytes), 'worker EXIF');
    res.json({ report: report.toJSON(), analysis });
  };

  previewPhoto = async (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : null;
    res.json(await res.locals.timing.measure('ai', () => this.#reports.previewPhoto(req.user, bytes), 'análisis IA'));
  };

  listMine = async (req, res) => {
    const items = await this.#reports.listMine(req.user);
    res.json({ count: items.length, items });
  };
}
