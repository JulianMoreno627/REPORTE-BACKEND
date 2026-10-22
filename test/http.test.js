import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { offsetMeters } from '../src/clustering/geo.js';
import { CENTER, createOfficial, createTestContainer, buildJpegWithGps } from './helpers.js';

let container;
let server;
let base;

before(async () => {
  container = await createTestContainer();
  container.metricsService.start();
  server = createApp(container).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await container.shutdown();
});

const api = async (path, { token, body, headers = {}, ...options } = {}) => {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body && !Buffer.isBuffer(body) ? JSON.stringify(body) : body,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { response, json, text };
};

test('Flujo completo: registro → reporte → foto → mapa → página SSR/ISR', async () => {
  const register = await api('/api/auth/register', { method: 'POST', body: { name: 'Ana', email: 'ana@http.co', password: 'secreto1' } });
  assert.equal(register.response.status, 201);
  const { token } = register.json;

  const unauthorized = await api('/api/reports', { method: 'POST', body: { ...CENTER, category: 'POTHOLE' } });
  assert.equal(unauthorized.response.status, 401);

  const created = await api('/api/reports', { method: 'POST', token, body: { ...offsetMeters(CENTER, 0, 0), category: 'POTHOLE', roadType: 'PRIMARY' } });
  assert.equal(created.response.status, 201);
  assert.match(created.response.headers.get('server-timing'), /assign;dur=.*total;dur=/);
  const incidentId = created.json.incident.id;

  const photo = await api(`/api/reports/${created.json.report.id}/photo`, {
    method: 'POST', token, headers: { 'Content-Type': 'image/jpeg' }, body: buildJpegWithGps(CENTER.lat, CENTER.lng),
  });
  assert.equal(photo.response.status, 200);
  assert.equal(photo.json.analysis.photoCheck, 'VERIFIED');

  const list = await api('/api/incidents?status=OPEN&sort=priority');
  assert.equal(list.json.count, 1);
  assert.equal('citizenId' in list.json.items[0], false);

  const heat = await api('/api/heatmap');
  assert.equal(heat.json.points.length, 1);
  assert.match(heat.response.headers.get('cache-control'), /max-age=30/);

  const first = await fetch(`${base}/incidentes/${incidentId}`);
  const second = await fetch(`${base}/incidentes/${incidentId}`);
  assert.equal(first.headers.get('x-cache'), 'MISS');
  assert.equal(second.headers.get('x-cache'), 'HIT');
  assert.match(await second.text(), /<h1>Bache · Vía principal<\/h1>/);

  const official = await createOfficial(container);
  const officialToken = container.authService.issueToken(official);
  const change = await api(`/api/incidents/${incidentId}/status`, { method: 'PATCH', token: officialToken, body: { status: 'IN_REVIEW', note: 'Revisión' } });
  assert.equal(change.response.status, 200);
  const third = await fetch(`${base}/incidentes/${incidentId}`);
  assert.equal(third.headers.get('x-cache'), 'MISS');
  assert.match(await third.text(), /En revisión/);

  const notifications = await api('/api/notifications', { token });
  assert.equal(notifications.json.unread, 1);

  const missing = await fetch(`${base}/incidentes/no-existe`);
  assert.equal(missing.status, 404);
});

test('Errores HTTP: validación, permisos y rutas inexistentes', async () => {
  const { json } = await api('/api/auth/register', { method: 'POST', body: { name: 'Beto', email: 'beto@http.co', password: 'secreto1' } });
  const invalid = await api('/api/reports', { method: 'POST', token: json.token, body: { lat: 200, lng: 0, category: 'POTHOLE' } });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.json.error.code, 'VALIDATION_ERROR');

  const forbidden = await api('/api/admin/summary', { token: json.token });
  assert.equal(forbidden.response.status, 403);

  const badJson = await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.from('{malo') });
  assert.equal(badJson.response.status, 400);

  assert.equal((await api('/api/nada')).response.status, 404);
});

test('Métricas: Web Vitals por sendBeacon, resumen JSON y formato Prometheus', async () => {
  const beacon = await api('/api/metrics/web-vitals', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: Buffer.from(JSON.stringify({ page: '/mapa', metrics: [{ name: 'LCP', value: 4500 }, { name: 'INP', value: 120 }, { name: 'FAKE', value: 1 }] })),
  });
  assert.equal(beacon.response.status, 202);
  assert.equal(beacon.json.accepted, 2);

  const summary = await api('/api/metrics/summary');
  assert.equal(summary.json.webVitals.LCP[0].rating, 'poor');
  assert.equal(summary.json.webVitals.INP[0].rating, 'good');
  assert.ok(summary.json.http.some((row) => row.route === '/api/reports'));

  const prometheus = await api('/metrics');
  assert.match(prometheus.text, /http_request_duration_ms\{method="POST",route="\/api\/reports",quantile="0.95"\}/);
  assert.match(prometheus.text, /web_vitals_p75\{name="LCP",page="\/mapa"\} 4500/);
});

test('Catálogo y CORS para el frontend', async () => {
  const { response, json } = await api('/api/catalog', { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(json.categories.length, 6);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.match(response.headers.get('access-control-expose-headers'), /Server-Timing/);
});
