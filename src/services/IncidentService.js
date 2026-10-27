import { IncidentStatus } from '../domain/IncidentStatus.js';
import { DamageCategory } from '../domain/DamageCategory.js';
import { RoadType } from '../domain/RoadType.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { Events } from '../infrastructure/EventBus.js';
import { Clock } from '../infrastructure/Clock.js';

const SORTERS = {
  priority: (a, b) => b.priority.score - a.priority.score || b.reportCount - a.reportCount,
  recent: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  reports: (a, b) => b.reportCount - a.reportCount,
  oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
};

export class IncidentService {
  #incidents;
  #reports;
  #bus;
  #clock;
  #priority;
  #storage;
  #workerPool;
  #maxPhotoBytes;

  constructor({
    incidentRepository, reportRepository, eventBus, priorityStrategy, imageStorage, workerPool,
    clock = new Clock(), maxPhotoBytes = 2 * 1024 * 1024,
  }) {
    this.#incidents = incidentRepository;
    this.#reports = reportRepository;
    this.#bus = eventBus;
    this.#priority = priorityStrategy;
    this.#storage = imageStorage;
    this.#workerPool = workerPool;
    this.#clock = clock;
    this.#maxPhotoBytes = maxPhotoBytes;
  }

  get priorityStrategyName() { return this.#priority.name; }

  view(incident, now = this.#clock.now()) {
    return { ...incident.toJSON(), priority: this.#priority.evaluate(incident, now) };
  }

  async list({ status, category, roadType, priority, bbox, sort = 'priority', limit } = {}) {
    const statusFilter = status && status !== 'OPEN' ? IncidentStatus.from(status) : null;
    const categoryFilter = category ? DamageCategory.from(category) : null;
    const roadFilter = roadType ? RoadType.from(roadType) : null;

    const incidents = await this.#incidents.findInBounds(bbox, (incident) => (status !== 'OPEN' || incident.isOpen)
      && (!statusFilter || incident.status === statusFilter)
      && (!categoryFilter || incident.category === categoryFilter)
      && (!roadFilter || incident.roadType === roadFilter));

    const now = this.#clock.now();
    let views = incidents.map((incident) => this.view(incident, now));
    if (priority) views = views.filter((view) => view.priority.level === priority);
    views.sort(SORTERS[sort] ?? SORTERS.priority);
    return limit ? views.slice(0, limit) : views;
  }

  priorityQueue(limit = 20) {
    return this.list({ status: 'OPEN', sort: 'priority', limit });
  }

  async getDetail(id) {
    const incident = await this.#incidents.findById(id);
    if (!incident) throw new NotFoundError('Incidente');
    const reports = await this.#reports.findByIncident(id);
    return {
      ...this.view(incident),
      reports: reports.sort((a, b) => a.createdAt - b.createdAt).map((report) => report.toPublicJSON()),
    };
  }

  async changeStatus(user, id, status, note = '') {
    if (!user.canManageIncidents()) throw new ForbiddenError('Solo un funcionario puede cambiar el estado');
    const incident = await this.#incidents.findById(id);
    if (!incident) throw new NotFoundError('Incidente');
    const { previous, current } = incident.changeStatus(status, { by: user.id, note, at: this.#clock.now() });
    await this.#incidents.save(incident);
    await this.#bus.publish(Events.INCIDENT_STATUS_CHANGED, { incident, previous, current, changedBy: user, note });
    return this.view(incident);
  }

  async attachHistoryPhoto(user, id, entryIndex, bytes) {
    if (!user.canManageIncidents()) throw new ForbiddenError('Solo un funcionario puede adjuntar fotos al seguimiento');
    const incident = await this.#incidents.findById(id);
    if (!incident) throw new NotFoundError('Incidente');
    const index = Number.parseInt(entryIndex, 10);
    if (!Number.isInteger(index) || !incident.history[index]) throw new NotFoundError('Registro del historial');
    if (!bytes?.length) throw new ValidationError('Envía la imagen en el cuerpo de la petición');
    if (bytes.length > this.#maxPhotoBytes) {
      throw new ValidationError(`La foto supera ${(this.#maxPhotoBytes / 1024 / 1024).toFixed(0)} MB; comprímela antes de enviarla`);
    }

    const { mimeType } = await this.#workerPool.run('analyze-image', { bytes });
    if (!mimeType) throw new ValidationError('Formato de imagen no soportado (usa JPEG, PNG o WebP)');

    const url = await this.#storage.save(bytes, { mimeType });
    incident.attachHistoryPhoto(index, url, { at: this.#clock.now() });
    await this.#incidents.save(incident);
    await this.#bus.publish(Events.INCIDENT_UPDATED, { incident });
    return this.view(incident);
  }

  async summary() {
    const incidents = await this.#incidents.findAll();
    const now = this.#clock.now();
    const count = (items, keyOf) => items.reduce((acc, item) => {
      const key = keyOf(item);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const open = incidents.filter((incident) => incident.isOpen);
    const resolved = incidents.filter((incident) => incident.status === IncidentStatus.RESOLVED);
    const resolutionDays = resolved.map((incident) => {
      const end = incident.history.findLast((entry) => entry.status === IncidentStatus.RESOLVED.code);
      return (new Date(end?.at ?? incident.updatedAt) - incident.createdAt) / 86_400_000;
    });

    return {
      generatedAt: now.toISOString(),
      priorityStrategy: this.#priority.name,
      totals: {
        incidents: incidents.length,
        open: open.length,
        reports: incidents.reduce((sum, incident) => sum + incident.reportCount, 0),
        duplicatesAvoided: incidents.reduce((sum, incident) => sum + incident.reportCount - 1, 0),
        avgResolutionDays: resolutionDays.length
          ? Math.round((resolutionDays.reduce((a, b) => a + b, 0) / resolutionDays.length) * 10) / 10
          : null,
      },
      byStatus: IncidentStatus.values().map((status) => ({
        code: status.code, label: status.label, count: incidents.filter((incident) => incident.status === status).length,
      })),
      byCategory: Object.entries(count(incidents, (incident) => incident.category.code))
        .map(([code, total]) => ({ code, label: DamageCategory.from(code).label, count: total }))
        .sort((a, b) => b.count - a.count),
      byPriority: count(open, (incident) => this.#priority.evaluate(incident, now).level),
    };
  }
}
