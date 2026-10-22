import express from 'express';
import compression from 'compression';
import { resolve } from 'node:path';
import { cors, errorHandler, instrumentation, notFound } from './http/middlewares.js';
import { createApiRouter } from './http/routes.js';
import { createPagesRouter } from './render/pages.js';

export function createApp(container) {
  const { config, metricsService, imageStorage } = container;
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(instrumentation(metricsService));
  app.use(cors(config.allowedOrigins));
  app.use(compression({ filter: (req, res) => !req.path.endsWith('/stream') && compression.filter(req, res) }));
  app.use(express.json({ limit: '100kb' }));

  const { router, metricsController } = createApiRouter(container);
  app.use('/api', router);
  app.get('/metrics', metricsController.prometheus);

  app.use(createPagesRouter(container));

  if (typeof imageStorage?.read === 'function') {
    app.get('/uploads/:name', async (req, res, next) => {
      const photo = await imageStorage.read(req.params.name);
      if (!photo) return next();
      res.set('Cache-Control', 'public, max-age=2592000, immutable');
      res.type(photo.mimeType).send(photo.bytes);
    });
  }

  app.use('/uploads', express.static(resolve(config.uploadsDir), { maxAge: '30d', immutable: true }));
  app.use(express.static(resolve('public'), { maxAge: '5m' }));

  app.get('/', (_req, res) => {
    res.json({
      name: 'Vías Seguras API',
      description: 'Reporte y seguimiento ciudadano de baches y daños viales',
      endpoints: {
        api: '/api',
        catalog: '/api/catalog',
        incidents: '/api/incidents',
        heatmap: '/api/heatmap',
        statistics: '/estadisticas/ (SSG)',
        incidentPage: '/incidentes/:id (SSR + ISR)',
        metrics: '/api/metrics/summary · /metrics (Prometheus)',
      },
    });
  });

  app.use(notFound);
  app.use(errorHandler());
  return app;
}
