import { Router } from 'express';
import { incidentPage, notFoundPage } from './templates.js';
import { Events } from '../infrastructure/EventBus.js';
import { NotFoundError } from '../domain/errors.js';

export function createPagesRouter({ incidentService, isrCache, eventBus, config }) {
  const router = Router();
  const keyOf = (id) => `/incidentes/${id}`;

  for (const event of [Events.INCIDENT_UPDATED, Events.INCIDENT_STATUS_CHANGED, Events.REPORT_UPDATED, Events.INCIDENTS_MERGED]) {
    eventBus.subscribe(event, ({ incident, absorbedIds = [] }) => {
      if (incident) isrCache.invalidate(keyOf(incident.id));
      for (const id of absorbedIds) isrCache.invalidate(keyOf(id));
    });
  }

  router.get('/incidentes/:id', async (req, res) => {
    const frontendUrl = config.frontendUrl;
    const { html, state } = await res.locals.timing.measure('render', () => isrCache.get(keyOf(req.params.id), async () => {
      try {
        const incident = await incidentService.getDetail(req.params.id);
        return incidentPage(incident, { baseUrl: config.publicBaseUrl, frontendUrl });
      } catch (error) {
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    }));

    res.set('X-Render-Pattern', 'SSR+ISR');
    res.set('X-Cache', state);
    if (html === null) return res.status(404).type('html').send(notFoundPage());
    res.set('Cache-Control', `public, max-age=0, s-maxage=${Math.round(config.isrTtlMs / 1000)}, stale-while-revalidate=300`);
    res.type('html').send(html);
  });

  return router;
}
