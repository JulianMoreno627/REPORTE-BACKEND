import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;
const port = Number(env.PORT ?? 3000);
const databaseUrl = env.DATABASE_URL || null;

function sslFor(url) {
  if (env.DATABASE_SSL) return env.DATABASE_SSL === 'true';
  if (!url) return false;
  const host = new URL(url).hostname;
  return host.includes('.') && host !== '127.0.0.1';
}

export const config = Object.freeze({
  port,
  frontendUrl: env.FRONTEND_URL ?? 'http://localhost:5173',
  allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4200')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
  trustProxy: env.TRUST_PROXY === 'true',
  tokenSecret: env.TOKEN_SECRET ?? 'dev-secret-change-me',
  officialInviteCode: env.OFFICIAL_INVITE_CODE ?? 'ALCALDIA-2026',
  databaseUrl,
  databaseSsl: sslFor(databaseUrl),
  dataPath: env.DATA_PATH ?? 'data/db.json',
  uploadsDir: env.UPLOADS_DIR ?? 'public/uploads',
  publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
  clusterRadiusMeters: Number(env.CLUSTER_RADIUS_M ?? 30),
  photoMaxDistanceMeters: Number(env.PHOTO_MAX_DISTANCE_M ?? 150),
  maxPhotoBytes: Number(env.MAX_PHOTO_BYTES ?? 2 * 1024 * 1024),
  reportsPerHourPerUser: Number(env.REPORTS_PER_HOUR ?? 10),
  reportRequestsPerIp: Number(env.REPORT_REQUESTS_PER_IP ?? 30),
  workerPoolSize: Number(env.WORKERS ?? Math.max(1, Math.min(4, availableParallelism() - 1))),
  consolidationIntervalMs: Number(env.CONSOLIDATION_INTERVAL_MS ?? 10 * 60 * 1000),
  priorityStrategy: env.PRIORITY_STRATEGY ?? 'weighted',
  isrTtlMs: Number(env.ISR_TTL_MS ?? 60_000),
  cityCenter: { lat: Number(env.CITY_LAT ?? 4.6097), lng: Number(env.CITY_LNG ?? -74.0817) },
  groqApiKey: env.GROQ_API_KEY || null,
  aiModel: env.AI_MODEL || 'qwen/qwen3.8-27b',
  geminiApiKey: env.GEMINI_API_KEY || null,
  geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  aiTimeoutMs: Number(env.AI_TIMEOUT_MS ?? 15_000),
});
