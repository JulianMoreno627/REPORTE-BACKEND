import { InMemoryRepository } from './Repository.js';
import { User } from '../domain/User.js';
import { Report } from '../domain/Report.js';
import { Incident } from '../domain/Incident.js';
import { Notification } from '../domain/Notification.js';
import { insideBoundingBox } from '../clustering/geo.js';

export class UserRepository extends InMemoryRepository {
  constructor() {
    super((record) => User.restore(record));
  }

  async findByEmail(email) {
    const normalized = String(email ?? '').trim().toLowerCase();
    const [user] = await this.findAll((candidate) => candidate.email === normalized);
    return user ?? null;
  }
}

export class ReportRepository extends InMemoryRepository {
  constructor() {
    super((record) => Report.restore(record));
  }

  findByIncident(incidentId) {
    return this.findAll((report) => report.incidentId === incidentId);
  }

  async findByCitizen(citizenId) {
    const reports = await this.findAll((report) => report.citizenId === citizenId);
    return reports.sort((a, b) => b.createdAt - a.createdAt);
  }

  async findByClientRequestId(citizenId, clientRequestId) {
    const [report] = await this.findAll((candidate) => candidate.citizenId === citizenId
      && candidate.clientRequestId === clientRequestId);
    return report ?? null;
  }
}

export class IncidentRepository extends InMemoryRepository {
  constructor() {
    super((record) => Incident.restore(record));
  }

  findOpen() {
    return this.findAll((incident) => incident.isOpen);
  }

  async findOpenNear(location, radiusMeters) {
    const open = await this.findOpen();
    return open
      .map((incident) => ({ incident, distance: incident.location.distanceTo(location) }))
      .filter(({ distance }) => distance <= radiusMeters)
      .sort((a, b) => a.distance - b.distance);
  }

  findInBounds(bbox, predicate = () => true) {
    return this.findAll((incident) => insideBoundingBox(incident.location, bbox) && predicate(incident));
  }
}

export class NotificationRepository extends InMemoryRepository {
  constructor() {
    super((record) => Notification.restore(record));
  }

  async findByUser(userId) {
    const notifications = await this.findAll((notification) => notification.userId === userId);
    return notifications.sort((a, b) => b.createdAt - a.createdAt);
  }
}
