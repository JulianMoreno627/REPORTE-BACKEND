import express, { Router } from 'express';
import { authenticate, rateLimitByIp, requireOfficial } from './middlewares.js';
import { AuthController } from './controllers/AuthController.js';
import { ReportController } from './controllers/ReportController.js';
import { IncidentController } from './controllers/IncidentController.js';
import { NotificationController } from './controllers/NotificationController.js';
import { AdminController } from './controllers/AdminController.js';
import { MetricsController } from './controllers/MetricsController.js';
import { ProfileController } from './controllers/ProfileController.js';
import { contract, contractDocsPage, validateBody } from './contract.js';
import { DamageCategory } from '../domain/DamageCategory.js';
import { RoadType } from '../domain/RoadType.js';
import { IncidentStatus } from '../domain/IncidentStatus.js';

export function createApiRouter(container) {
  const { authService, config, ipLimiter } = container;
  const auth = new AuthController(container);
  const reports = new ReportController(container);
  const incidents = new IncidentController(container);
  const notifications = new NotificationController(container);
  const admin = new AdminController(container);
  const metrics = new MetricsController(container);
  const profile = new ProfileController(container);

  const signedIn = authenticate(authService);
  const router = Router();

  router.get('/health', (_req, res) => res.json({
    status: 'ok',
    storage: container.storage,
    ai: container.damageAnalyzer.enabled ? container.damageAnalyzer.model : 'disabled',
    time: new Date().toISOString(),
  }));

  router.get('/catalog', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      categories: DamageCategory.catalog(),
      roadTypes: RoadType.catalog(),
      statuses: IncidentStatus.catalog(),
      clusterRadiusMeters: config.clusterRadiusMeters,
      maxPhotoBytes: config.maxPhotoBytes,
      cityCenter: config.cityCenter,
    });
  });

  router.get('/openapi.json', (_req, res) => res.json(contract));
  router.get('/docs', (_req, res) => res.type('html').send(contractDocsPage('/api/openapi.json')));

  router.post('/auth/register', validateBody('register'), auth.register);
  router.post('/auth/login', validateBody('login'), auth.login);
  router.get('/auth/me', signedIn, auth.me);

  router.patch('/profile', signedIn, validateBody('updateProfile'), profile.update);
  router.put('/profile/password', signedIn, validateBody('changePassword'), profile.changePassword);
  router.put(
    '/profile/avatar',
    signedIn,
    express.raw({ type: ['image/*', 'application/octet-stream'], limit: config.maxPhotoBytes + 1024 }),
    profile.uploadAvatar,
  );
  router.delete('/profile/avatar', signedIn, profile.removeAvatar);

  router.post('/reports', rateLimitByIp(ipLimiter), signedIn, validateBody('createReport'), reports.create);
  router.post('/reports/batch', rateLimitByIp(ipLimiter), signedIn, validateBody('createReportBatch'), reports.createBatch);
  router.get('/reports/mine', signedIn, reports.listMine);
  router.post(
    '/reports/photo-analysis',
    signedIn,
    express.raw({ type: ['image/*', 'application/octet-stream'], limit: config.maxPhotoBytes + 1024 }),
    reports.previewPhoto,
  );
  router.post(
    '/reports/:id/photo',
    signedIn,
    express.raw({ type: ['image/*', 'application/octet-stream'], limit: config.maxPhotoBytes + 1024 }),
    reports.attachPhoto,
  );

  router.get('/incidents', incidents.list);
  router.get('/incidents/priority-queue', incidents.priorityQueue);
  router.get('/incidents/:id', incidents.detail);
  router.patch('/incidents/:id/status', signedIn, requireOfficial, validateBody('changeIncidentStatus'), incidents.changeStatus);
  router.post(
    '/incidents/:id/history/:entry/photo',
    signedIn,
    requireOfficial,
    express.raw({ type: ['image/*', 'application/octet-stream'], limit: config.maxPhotoBytes + 1024 }),
    incidents.attachHistoryPhoto,
  );
  router.get('/heatmap', incidents.heatmap);

  router.get('/notifications', signedIn, notifications.list);
  router.get('/notifications/stream', authenticate(authService, { allowQueryToken: true }), notifications.stream);
  router.patch('/notifications/:id/read', signedIn, notifications.markRead);

  router.get('/admin/summary', signedIn, requireOfficial, admin.summary);
  router.get('/admin/consolidation', signedIn, requireOfficial, admin.consolidationStatus);
  router.post('/admin/consolidate', signedIn, requireOfficial, admin.consolidate);

  router.post('/metrics/web-vitals', express.text({ type: 'text/plain', limit: '16kb' }), metrics.webVitals);
  router.get('/metrics/summary', metrics.summary);

  return { router, metricsController: metrics };
}
