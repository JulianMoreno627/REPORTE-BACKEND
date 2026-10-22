export const Events = Object.freeze({
  REPORT_CREATED: 'report.created',
  REPORT_UPDATED: 'report.updated',
  INCIDENT_CREATED: 'incident.created',
  INCIDENT_UPDATED: 'incident.updated',
  INCIDENT_STATUS_CHANGED: 'incident.status_changed',
  INCIDENTS_MERGED: 'incidents.merged',
});

export class EventBus {
  #handlers = new Map();
  #logger;

  constructor({ logger = console } = {}) {
    this.#logger = logger;
  }

  subscribe(event, handler) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(handler);
    return () => this.#handlers.get(event)?.delete(handler);
  }

  async publish(event, payload) {
    const handlers = [...(this.#handlers.get(event) ?? [])];
    await Promise.all(handlers.map(async (handler) => {
      try {
        await handler(payload);
      } catch (error) {
        this.#logger.error(`[EventBus] Error en suscriptor de "${event}":`, error);
      }
    }));
  }
}
