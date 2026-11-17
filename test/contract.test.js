import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createApiRouter } from '../src/http/routes.js';
import { describeErrors, operations, responseValidator } from '../src/http/contract.js';
import { offsetMeters } from '../src/clustering/geo.js';
import { CENTER, PNG_BYTES, buildJpegWithGps, createTestContainer } from './helpers.js';

let container;
let server;
let base;

before(async () => {
  const analyzer = {
    enabled: true,
    model: 'fake-vision',
    analyze: async () => ({
      isRoad: true, category: 'POTHOLE', risk: 'HIGH', confidence: 0.9, reason: 'Bache', provider: 'groq', model: 'fake-vision', analyzedAt: new Date().toISOString(),
    }),
  };
  container = await createTestContainer({ damageAnalyzer: analyzer });
  server = createApp(container).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await container.shutdown();
});

async function call(operationId, path, { token, body, contentType, method } = {}) {
  const operation = operations.find((item) => item.operationId === operationId);
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['Content-Type'] = contentType ?? 'application/json';
  const response = await fetch(base + path, {
    method: method ?? operation.method,
    headers,
    body: body === undefined || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const json = await response.json();
  const validate = responseValidator(operationId, String(response.status));
  assert.ok(validate(json), `${operationId} ${response.status} no cumple el contrato: ${describeErrors(validate.errors).join('; ')}`);
  return { status: response.status, json };
}

test('Contrato: cada ruta de Express está en openapi.json y cada operación del contrato está implementada', () => {
  const implemented = createApiRouter(container).router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} /api${layer.route.path}`))
    .sort();
  const declared = operations.map(({ method, expressPath }) => `${method} ${expressPath}`).sort();
  assert.deepEqual(implemented, declared);
  assert.equal(new Set(operations.map((item) => item.operationId)).size, operations.length);
});

test('Contrato: las respuestas reales cumplen los esquemas de openapi.json', async () => {
  await call('getHealth', '/api/health');
  await call('getCatalog', '/api/catalog');

  const citizen = (await call('register', '/api/auth/register', { body: { name: 'Ana', email: 'ana@contrato.co', password: 'secreto1' } })).json;
  const official = (await call('register', '/api/auth/register', {
    body: { name: 'Funcionaria', email: 'f@contrato.co', password: 'secreto1', role: 'OFFICIAL', inviteCode: container.config.officialInviteCode },
  })).json;
  await call('login', '/api/auth/login', { body: { email: 'ana@contrato.co', password: 'secreto1', role: 'CITIZEN' } });
  await call('me', '/api/auth/me', { token: citizen.token });

  const point = offsetMeters(CENTER, 0, 0);
  await call('analyzePhoto', '/api/reports/photo-analysis', { token: citizen.token, body: PNG_BYTES, contentType: 'image/png' });
  const { json: created } = await call('createReport', '/api/reports', { token: citizen.token, body: { ...point, category: 'POTHOLE', roadType: 'PRIMARY' } });
  await call('attachReportPhoto', `/api/reports/${created.report.id}/photo`, {
    token: citizen.token, body: buildJpegWithGps(point.lat, point.lng), contentType: 'image/jpeg',
  });
  await call('createReportBatch', '/api/reports/batch', {
    token: citizen.token, body: { reports: [{ ...offsetMeters(CENTER, 2000, 0), category: 'CRACK', clientRequestId: 'offline-1' }] },
  });
  await call('listMyReports', '/api/reports/mine', { token: citizen.token });

  const incidentId = created.incident.id;
  await call('listIncidents', `/api/incidents?bbox=4.5,-74.2,4.7,-74.0&status=OPEN&sort=priority`);
  await call('priorityQueue', '/api/incidents/priority-queue?limit=5');
  await call('getHeatmap', '/api/heatmap');
  const { json: changed } = await call('changeIncidentStatus', `/api/incidents/${incidentId}/status`, {
    token: official.token, body: { status: 'IN_REVIEW', note: 'Cuadrilla asignada' },
  });
  await call('attachHistoryPhoto', `/api/incidents/${incidentId}/history/${changed.history.length - 1}/photo`, {
    token: official.token, body: PNG_BYTES, contentType: 'image/png',
  });
  await call('getIncident', `/api/incidents/${incidentId}`);

  const { json: inbox } = await call('listNotifications', '/api/notifications', { token: citizen.token });
  await call('markNotificationRead', `/api/notifications/${inbox.items[0].id}/read`, { token: citizen.token });

  await call('adminSummary', '/api/admin/summary', { token: official.token });
  await call('consolidate', '/api/admin/consolidate', { token: official.token });
  await call('consolidationStatus', '/api/admin/consolidation', { token: official.token });
  await call('metricsSummary', '/api/metrics/summary');
});

test('Contrato: una petición que no lo cumple se rechaza antes de llegar al controlador', async () => {
  const { json: session } = await call('register', '/api/auth/register', { body: { name: 'Beto', email: 'beto@contrato.co', password: 'secreto1' } });
  const { status, json } = await call('createReport', '/api/reports', { token: session.token, body: { lat: 4.6, lng: -74.08, category: 'METEORITO' } });
  assert.equal(status, 400);
  assert.equal(json.error.code, 'VALIDATION_ERROR');
  assert.match(json.error.message, /contrato.*«category» debe ser uno de/);

  const missing = await call('register', '/api/auth/register', { body: { email: 'sin-nombre@contrato.co', password: 'secreto1' } });
  assert.equal(missing.status, 400);
  assert.match(missing.json.error.message, /falta el campo «name»/);
});
