import pg from 'pg';
import { config as defaultConfig } from './config.js';
import { Clock } from './infrastructure/Clock.js';
import { EventBus } from './infrastructure/EventBus.js';
import { SlidingWindowRateLimiter } from './infrastructure/RateLimiter.js';
import { LocalImageStorage, PostgresImageStorage } from './infrastructure/ImageStorage.js';
import { DisabledDamageAnalyzer, GroqDamageAnalyzer } from './infrastructure/DamageAnalyzer.js';
import {
  IncidentRepository, NotificationRepository, ReportRepository, UserRepository,
} from './repositories/repositories.js';
import { PostgisIncidentRepository } from './repositories/PostgisIncidentRepository.js';
import { JsonPersistence } from './repositories/JsonPersistence.js';
import { PostgresPersistence } from './repositories/PostgresPersistence.js';
import { WorkerPool } from './workers/WorkerPool.js';
import { createPriorityStrategy } from './domain/priority/strategies.js';
import { AuthService } from './services/AuthService.js';
import { ReportService } from './services/ReportService.js';
import { IncidentService } from './services/IncidentService.js';
import { HeatmapService } from './services/HeatmapService.js';
import { ConsolidationService } from './services/ConsolidationService.js';
import { NotificationService } from './services/NotificationService.js';
import { MetricsService } from './services/MetricsService.js';
import { IsrCache } from './render/IsrCache.js';

const HOUR_MS = 60 * 60 * 1000;

function storageName(config) {
  if (config.databaseUrl) return 'postgresql+postgis';
  return config.dataPath ? 'json' : 'memory';
}

export function createContainer(overrides = {}) {
  const { clock = new Clock(), damageAnalyzer: analyzerOverride, ...configOverrides } = overrides;
  const config = { ...defaultConfig, ...configOverrides };

  const pool = config.databaseUrl
    ? new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
      max: 5,
    })
    : null;

  let persistence = null;
  let metricsService = null;

  const userRepository = new UserRepository();
  const reportRepository = new ReportRepository();
  const incidentRepository = pool
    ? new PostgisIncidentRepository({
      pool,
      sync: () => persistence?.flush(),
      onQuery: (query) => metricsService?.recordQuery(query),
    })
    : new IncidentRepository();
  const notificationRepository = new NotificationRepository();
  const repositories = {
    users: userRepository, incidents: incidentRepository, reports: reportRepository, notifications: notificationRepository,
  };

  if (pool) persistence = new PostgresPersistence(pool, repositories);
  else if (config.dataPath) persistence = new JsonPersistence(config.dataPath, repositories);
  const imageStorage = pool
    ? new PostgresImageStorage({ pool })
    : new LocalImageStorage({ directory: config.uploadsDir });
  const damageAnalyzer = analyzerOverride ?? (config.groqApiKey
    ? new GroqDamageAnalyzer({ apiKey: config.groqApiKey, model: config.aiModel, timeoutMs: config.aiTimeoutMs })
    : new DisabledDamageAnalyzer());

  const eventBus = new EventBus();
  const workerPool = new WorkerPool(new URL('./workers/task-worker.js', import.meta.url), { size: config.workerPoolSize });
  const priorityStrategy = createPriorityStrategy(config.priorityStrategy);
  const reportLimiter = new SlidingWindowRateLimiter({ limit: config.reportsPerHourPerUser, windowMs: HOUR_MS, clock });
  const ipLimiter = new SlidingWindowRateLimiter({ limit: config.reportRequestsPerIp, windowMs: 10 * 60 * 1000, clock });
  const isrCache = new IsrCache({ ttlMs: config.isrTtlMs, clock });

  const authService = new AuthService({ userRepository, tokenSecret: config.tokenSecret, officialInviteCode: config.officialInviteCode, clock });
  const reportService = new ReportService({
    reportRepository, incidentRepository, eventBus, reportLimiter, workerPool, clock,
    imageStorage, damageAnalyzer,
    clusterRadiusMeters: config.clusterRadiusMeters,
    photoMaxDistanceMeters: config.photoMaxDistanceMeters,
    maxPhotoBytes: config.maxPhotoBytes,
  });
  const incidentService = new IncidentService({
    incidentRepository, reportRepository, eventBus, priorityStrategy, imageStorage, workerPool, clock,
    maxPhotoBytes: config.maxPhotoBytes,
  });
  const heatmapService = new HeatmapService({ incidentRepository, priorityStrategy, clock });
  const consolidationService = new ConsolidationService({
    incidentRepository, reportRepository, workerPool, eventBus, clock, clusterRadiusMeters: config.clusterRadiusMeters,
  });
  const notificationService = new NotificationService({ notificationRepository, eventBus, clock });
  metricsService = new MetricsService({
    workerPool,
    extraGauges: () => ({ isrCache: isrCache.stats(), sseClients: notificationService.connectedUsers() }),
  });

  const pruneTimer = setInterval(() => { reportLimiter.prune(); ipLimiter.prune(); }, 10 * 60 * 1000);
  pruneTimer.unref();

  const container = {
    config, clock, eventBus, workerPool, pool, persistence, imageStorage, damageAnalyzer, isrCache, ipLimiter, reportLimiter, priorityStrategy,
    storage: storageName(config),
    userRepository, reportRepository, incidentRepository, notificationRepository, repositories,
    authService, reportService, incidentService, heatmapService, consolidationService, notificationService, metricsService,

    async init() {
      if (persistence) {
        await persistence.load();
        persistence.watch();
      }
      return container;
    },

    async shutdown() {
      clearInterval(pruneTimer);
      consolidationService.stop();
      metricsService.stop();
      await persistence?.flush();
      await pool?.end();
      await workerPool.close();
    },
  };
  return container;
}
