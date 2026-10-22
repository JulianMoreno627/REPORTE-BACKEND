import { Notification } from '../domain/Notification.js';
import { NotFoundError } from '../domain/errors.js';
import { Events } from '../infrastructure/EventBus.js';
import { Clock } from '../infrastructure/Clock.js';

export class NotificationService {
  #notifications;
  #clock;
  #listeners = new Map();

  constructor({ notificationRepository, eventBus, clock = new Clock() }) {
    this.#notifications = notificationRepository;
    this.#clock = clock;
    eventBus.subscribe(Events.INCIDENT_STATUS_CHANGED, (event) => this.#onStatusChanged(event));
    eventBus.subscribe(Events.INCIDENTS_MERGED, (event) => this.#onMerged(event));
  }

  async #onStatusChanged({ incident, previous, current, changedBy, note }) {
    const category = incident.category.label.toLowerCase();
    const detail = note ? ` Nota de la alcaldía: ${note}` : '';
    await this.#notifyReporters(incident, changedBy?.id, {
      title: `Tu reporte ahora está: ${current.label}`,
      message: `El incidente de ${category} que reportaste pasó de "${previous.label}" a "${current.label}".${detail}`,
    });
  }

  async #onMerged({ incident }) {
    await this.#notifyReporters(incident, null, {
      title: 'Tu reporte se unió a otro cercano',
      message: `Tu reporte se agrupó con otros del mismo daño: ahora suma ${incident.reportCount} reportes.`,
    });
  }

  async #notifyReporters(incident, excludeUserId, { title, message }) {
    for (const userId of incident.reporterIds) {
      if (userId === excludeUserId) continue;
      const notification = new Notification({ userId, incidentId: incident.id, title, message, createdAt: this.#clock.now() });
      await this.#notifications.save(notification);
      for (const listener of this.#listeners.get(userId) ?? []) listener(notification.toJSON());
    }
  }

  subscribe(userId, listener) {
    if (!this.#listeners.has(userId)) this.#listeners.set(userId, new Set());
    this.#listeners.get(userId).add(listener);
    return () => {
      const set = this.#listeners.get(userId);
      set?.delete(listener);
      if (set?.size === 0) this.#listeners.delete(userId);
    };
  }

  connectedUsers() {
    return this.#listeners.size;
  }

  async list(userId) {
    const notifications = await this.#notifications.findByUser(userId);
    return {
      unread: notifications.filter((notification) => !notification.read).length,
      items: notifications.map((notification) => notification.toJSON()),
    };
  }

  async markRead(userId, id) {
    const notification = await this.#notifications.findById(id);
    if (!notification || notification.userId !== userId) throw new NotFoundError('Notificación');
    notification.markRead();
    await this.#notifications.save(notification);
    return notification.toJSON();
  }
}
