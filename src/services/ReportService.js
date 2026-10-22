import { Report, PhotoCheck } from '../domain/Report.js';
import { Incident } from '../domain/Incident.js';
import { Coordinate } from '../domain/Coordinate.js';
import {
  ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError, ValidationError,
} from '../domain/errors.js';
import { Events } from '../infrastructure/EventBus.js';
import { Clock } from '../infrastructure/Clock.js';

const MAX_BATCH = 50;

export class ReportService {
  #reports;
  #incidents;
  #bus;
  #clock;
  #limiter;
  #radius;
  #storage;
  #workerPool;
  #photoMaxDistance;
  #maxPhotoBytes;

  constructor({
    reportRepository, incidentRepository, eventBus, reportLimiter, imageStorage, workerPool,
    clock = new Clock(), clusterRadiusMeters = 30, photoMaxDistanceMeters = 150, maxPhotoBytes = 2 * 1024 * 1024,
  }) {
    this.#reports = reportRepository;
    this.#incidents = incidentRepository;
    this.#bus = eventBus;
    this.#limiter = reportLimiter;
    this.#storage = imageStorage;
    this.#workerPool = workerPool;
    this.#clock = clock;
    this.#radius = clusterRadiusMeters;
    this.#photoMaxDistance = photoMaxDistanceMeters;
    this.#maxPhotoBytes = maxPhotoBytes;
  }

  async create(user, input) {
    if (!user.canReport()) throw new ForbiddenError('Tu perfil no puede crear reportes');

    const clientRequestId = input.clientRequestId ? String(input.clientRequestId).slice(0, 100) : null;
    if (clientRequestId) {
      const existing = await this.#reports.findByClientRequestId(user.id, clientRequestId);
      if (existing) {
        return { report: existing, incident: await this.#incidents.findById(existing.incidentId), replayed: true, grouped: false };
      }
    }

    const report = new Report({
      citizenId: user.id,
      location: new Coordinate(input.lat, input.lng),
      category: input.category,
      roadType: input.roadType ?? undefined,
      description: input.description,
      clientRequestId,
      createdAt: this.#clock.now(),
    });

    const [nearest] = await this.#incidents.findOpenNear(report.location, this.#radius);
    if (nearest?.incident.hasReporter(user.id)) {
      throw new ConflictError('Ya reportaste este daño. Puedes seguir su estado en "Mis reportes".', 'DUPLICATE_REPORT');
    }

    const quota = this.#limiter.consume(user.id);
    if (!quota.allowed) {
      const minutes = Math.ceil(quota.retryAfterMs / 60000);
      throw new TooManyRequestsError(
        `Alcanzaste el límite de ${this.#limiter.limit} reportes por hora. Intenta de nuevo en ${minutes} min.`,
        Math.ceil(quota.retryAfterMs / 1000),
      );
    }

    return this.#assign(report, nearest);
  }

  async createBatch(user, items) {
    if (!Array.isArray(items) || items.length === 0) throw new ValidationError('Envía una lista de reportes');
    if (items.length > MAX_BATCH) throw new ValidationError(`Máximo ${MAX_BATCH} reportes por sincronización`);
    const results = [];
    for (const item of items) {
      try {
        const { report, incident, replayed, grouped } = await this.create(user, item);
        results.push({ clientRequestId: item.clientRequestId ?? null, ok: true, replayed, grouped, report: report.toJSON(), incidentId: incident?.id });
      } catch (error) {
        results.push({ clientRequestId: item.clientRequestId ?? null, ok: false, status: error.status ?? 500, error: error.message });
      }
    }
    return results;
  }

  async importReport(report) {
    const [nearest] = await this.#incidents.findOpenNear(report.location, this.#radius);
    return this.#assign(report, nearest);
  }

  async #assign(report, nearest) {
    const incident = nearest ? nearest.incident : Incident.open(report);
    if (nearest) incident.addReport(report);

    await this.#reports.save(report);
    await this.#incidents.save(incident);
    await this.#bus.publish(nearest ? Events.INCIDENT_UPDATED : Events.INCIDENT_CREATED, { incident });
    await this.#bus.publish(Events.REPORT_CREATED, { report, incident });

    return {
      report,
      incident,
      replayed: false,
      grouped: Boolean(nearest),
      distanceMeters: nearest ? Math.round(nearest.distance * 10) / 10 : 0,
    };
  }

  async attachPhoto(user, reportId, bytes) {
    const report = await this.#reports.findById(reportId);
    if (!report) throw new NotFoundError('Reporte');
    if (report.citizenId !== user.id) throw new ForbiddenError('Solo quien creó el reporte puede adjuntar la foto');
    if (!bytes?.length) throw new ValidationError('Envía la imagen en el cuerpo de la petición');
    if (bytes.length > this.#maxPhotoBytes) {
      throw new ValidationError(`La foto supera ${(this.#maxPhotoBytes / 1024 / 1024).toFixed(0)} MB; comprímela antes de enviarla`);
    }

    const analysis = await this.#workerPool.run('analyze-image', { bytes });
    if (!analysis.mimeType) throw new ValidationError('Formato de imagen no soportado (usa JPEG, PNG o WebP)');

    const url = await this.#storage.save(bytes, { mimeType: analysis.mimeType });
    let check = PhotoCheck.NO_GPS;
    let distance = null;
    if (analysis.gps) {
      distance = report.location.distanceTo(Coordinate.from(analysis.gps));
      check = distance <= this.#photoMaxDistance ? PhotoCheck.VERIFIED : PhotoCheck.MISMATCH;
    }
    report.attachPhoto(url, check, distance);
    await this.#reports.save(report);

    const incident = await this.#incidents.findById(report.incidentId);
    await this.#bus.publish(Events.REPORT_UPDATED, { report, incident });
    return { report, analysis: { ...analysis, photoCheck: check, distanceMeters: distance === null ? null : Math.round(distance) } };
  }

  async listMine(user) {
    const reports = await this.#reports.findByCitizen(user.id);
    return Promise.all(reports.map(async (report) => {
      const incident = await this.#incidents.findById(report.incidentId);
      return {
        ...report.toPublicJSON(),
        incident: incident && {
          id: incident.id,
          status: incident.status.code,
          statusLabel: incident.status.label,
          reportCount: incident.reportCount,
          updatedAt: incident.updatedAt.toISOString(),
        },
      };
    }));
  }
}
