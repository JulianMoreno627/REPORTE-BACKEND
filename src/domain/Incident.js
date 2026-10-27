import { Entity } from './Entity.js';
import { Coordinate } from './Coordinate.js';
import { DamageCategory } from './DamageCategory.js';
import { RoadType } from './RoadType.js';
import { IncidentStatus } from './IncidentStatus.js';
import { ConflictError, DomainError, NotFoundError } from './errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class Incident extends Entity {
  #location;
  #status;
  #roadType;
  #reportIds;
  #reporterIds;
  #categoryCounts;
  #history;
  #updatedAt;

  constructor({
    location, status = IncidentStatus.REPORTED, roadType = RoadType.SECONDARY,
    reportIds = [], reporterIds = [], categoryCounts = {}, history = [], updatedAt, ...base
  }) {
    super(base);
    this.#location = Coordinate.from(location);
    this.#status = IncidentStatus.from(status);
    this.#roadType = RoadType.from(roadType);
    this.#reportIds = [...reportIds];
    this.#reporterIds = new Set(reporterIds);
    this.#categoryCounts = { ...categoryCounts };
    this.#history = history.map((entry) => ({ ...entry, at: new Date(entry.at).toISOString() }));
    this.#updatedAt = new Date(updatedAt ?? this.createdAt);
  }

  static open(report) {
    const incident = new Incident({
      location: report.location,
      roadType: report.roadType,
      createdAt: report.createdAt,
      history: [{ status: IncidentStatus.REPORTED.code, at: report.createdAt, by: report.citizenId, note: 'Primer reporte ciudadano' }],
    });
    incident.addReport(report);
    return incident;
  }

  get location() { return this.#location; }
  get status() { return this.#status; }
  get roadType() { return this.#roadType; }
  get isOpen() { return this.#status.isOpen; }
  get reportCount() { return this.#reportIds.length; }
  get reportIds() { return [...this.#reportIds]; }
  get reporterIds() { return [...this.#reporterIds]; }
  get history() { return this.#history.map((entry) => ({ ...entry })); }
  get updatedAt() { return this.#updatedAt; }

  get category() {
    const ranked = Object.entries(this.#categoryCounts)
      .map(([code, count]) => ({ category: DamageCategory.from(code), count }))
      .sort((a, b) => b.count - a.count || b.category.severity - a.category.severity);
    return ranked[0]?.category ?? DamageCategory.OTHER;
  }

  hasReporter(userId) {
    return this.#reporterIds.has(userId);
  }

  ageInDays(now = new Date()) {
    return Math.max(0, (now.getTime() - this.createdAt.getTime()) / DAY_MS);
  }

  addReport(report) {
    if (!this.isOpen) throw new ConflictError('El incidente ya está cerrado');
    if (this.#reportIds.includes(report.id)) return;

    const n = this.#reportIds.length;
    this.#location = n === 0
      ? report.location
      : new Coordinate(
        (this.#location.lat * n + report.location.lat) / (n + 1),
        (this.#location.lng * n + report.location.lng) / (n + 1),
      );

    this.#reportIds.push(report.id);
    this.#reporterIds.add(report.citizenId);
    this.#categoryCounts[report.category.code] = (this.#categoryCounts[report.category.code] ?? 0) + 1;
    if (report.roadType.weight > this.#roadType.weight) this.#roadType = report.roadType;
    if (report.createdAt > this.#updatedAt) this.#updatedAt = report.createdAt;
    report.assignTo(this.id);
  }

  absorb(other, reports, { at = new Date() } = {}) {
    for (const report of reports) this.addReport(report);
    this.#history.push({
      status: this.#status.code,
      at: at.toISOString(),
      by: 'system',
      note: `Se unificó con el incidente ${other.id} (${reports.length} reporte(s) cercanos)`,
    });
  }

  changeStatus(next, { by, note = '', at = new Date() }) {
    const target = IncidentStatus.from(next);
    if (!this.#status.canTransitionTo(target)) {
      throw new DomainError(`No se puede pasar de "${this.#status.label}" a "${target.label}"`, {
        status: 409,
        code: 'INVALID_TRANSITION',
        details: { allowed: this.#status.nextStatuses.map((status) => status.code) },
      });
    }
    const previous = this.#status;
    this.#status = target;
    this.#updatedAt = at;
    this.#history.push({ status: target.code, at: at.toISOString(), by, note: String(note ?? '').slice(0, 500) });
    return { previous, current: target };
  }

  attachHistoryPhoto(index, photoUrl, { at = new Date() } = {}) {
    const entry = this.#history[index];
    if (!entry) throw new NotFoundError('Registro del historial');
    entry.photoUrl = photoUrl;
    this.#updatedAt = at;
    return { ...entry };
  }

  toJSON() {
    const category = this.category;
    return {
      ...super.toJSON(),
      updatedAt: this.#updatedAt.toISOString(),
      location: this.#location.toJSON(),
      status: this.#status.code,
      statusLabel: this.#status.label,
      nextStatuses: this.#status.nextStatuses.map((status) => status.describe()),
      category: category.code,
      categoryLabel: category.label,
      roadType: this.#roadType.code,
      roadTypeLabel: this.#roadType.label,
      reportCount: this.reportCount,
      reporterCount: this.#reporterIds.size,
      history: this.#history.map(({ status, at, note, photoUrl = null }) => ({
        status, statusLabel: IncidentStatus.from(status).label, at, note, photoUrl,
      })),
    };
  }

  toRecord() {
    return {
      ...super.toJSON(),
      updatedAt: this.#updatedAt.toISOString(),
      location: this.#location.toJSON(),
      status: this.#status.code,
      roadType: this.#roadType.code,
      reportIds: [...this.#reportIds],
      reporterIds: [...this.#reporterIds],
      categoryCounts: { ...this.#categoryCounts },
      history: this.history,
    };
  }

  static restore(record) {
    return new Incident(record);
  }
}
