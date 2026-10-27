import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offsetMeters } from '../src/clustering/geo.js';
import { Report } from '../src/domain/Report.js';
import {
  buildJpegWithGps, CENTER, createCitizen, createOfficial, createTestContainer, PNG_BYTES,
} from './helpers.js';

const at = (east, north) => offsetMeters(CENTER, east, north);
const input = (point, extra = {}) => ({ ...point, category: 'POTHOLE', roadType: 'PRIMARY', ...extra });

async function withContainer(fn, overrides) {
  const container = await createTestContainer(overrides);
  try {
    await fn(container);
  } finally {
    await container.shutdown();
  }
}

test('Reportes a menos de 30 m se agrupan en un solo incidente; lejanos abren otro', () => withContainer(async (c) => {
  const [ana, beto, caro] = [await createCitizen(c), await createCitizen(c), await createCitizen(c)];
  const first = await c.reportService.create(ana, input(at(0, 0)));
  const second = await c.reportService.create(beto, input(at(18, 10)));
  const far = await c.reportService.create(caro, input(at(200, 0)));
  assert.equal(first.grouped, false);
  assert.equal(second.grouped, true);
  assert.equal(second.incident.id, first.incident.id);
  assert.equal(second.incident.reportCount, 2);
  assert.notEqual(far.incident.id, first.incident.id);
}));

test('El mismo ciudadano no puede reportar dos veces el mismo daño', () => withContainer(async (c) => {
  const ana = await createCitizen(c);
  await c.reportService.create(ana, input(at(0, 0)));
  await assert.rejects(c.reportService.create(ana, input(at(5, 5))), { status: 409, code: 'DUPLICATE_REPORT' });
}));

test('Límite de reportes por usuario por hora (429 con Retry-After)', () => withContainer(async (c) => {
  const ana = await createCitizen(c);
  await c.reportService.create(ana, input(at(0, 0)));
  await c.reportService.create(ana, input(at(500, 0)));
  await assert.rejects(c.reportService.create(ana, input(at(1000, 0))), (error) => error.status === 429 && error.retryAfterSeconds > 0);
  c.clock.advance(61 * 60 * 1000);
  await c.reportService.create(ana, input(at(1000, 0)));
}, { reportsPerHourPerUser: 2 }));

test('Sincronización offline idempotente por clientRequestId', () => withContainer(async (c) => {
  const ana = await createCitizen(c);
  const items = [input(at(0, 0), { clientRequestId: 'offline-1' }), input(at(300, 0), { clientRequestId: 'offline-2' }), { lat: 999, lng: 0, category: 'POTHOLE', clientRequestId: 'bad' }];
  const results = await c.reportService.createBatch(ana, items);
  assert.deepEqual(results.map((result) => result.ok), [true, true, false]);
  const retry = await c.reportService.createBatch(ana, items.slice(0, 1));
  assert.equal(retry[0].replayed, true);
  assert.equal((await c.reportService.listMine(ana)).length, 2);
}));

test('Cambio de estado: solo funcionarios y notifica a todos los que reportaron', () => withContainer(async (c) => {
  const [ana, beto] = [await createCitizen(c), await createCitizen(c)];
  const official = await createOfficial(c);
  const { incident } = await c.reportService.create(ana, input(at(0, 0)));
  await c.reportService.create(beto, input(at(10, 0)));

  await assert.rejects(c.incidentService.changeStatus(ana, incident.id, 'IN_REVIEW'), { status: 403 });

  const pushed = [];
  const unsubscribe = c.notificationService.subscribe(ana.id, (notification) => pushed.push(notification));
  const view = await c.incidentService.changeStatus(official, incident.id, 'IN_REVIEW', 'Cuadrilla asignada');
  unsubscribe();

  assert.equal(view.status, 'IN_REVIEW');
  assert.equal(pushed.length, 1);
  assert.match(pushed[0].message, /Cuadrilla asignada/);
  assert.equal((await c.notificationService.list(beto.id)).unread, 1);
}));

test('Seguimiento: el funcionario puede adjuntar una foto opcional a una etapa', () => withContainer(async (c) => {
  const ana = await createCitizen(c);
  const official = await createOfficial(c);
  const { incident } = await c.reportService.create(ana, input(at(0, 0)));
  const changed = await c.incidentService.changeStatus(official, incident.id, 'IN_REVIEW', 'Cuadrilla asignada');
  const entry = changed.history.length - 1;
  assert.equal(changed.history[entry].photoUrl, null);

  const view = await c.incidentService.attachHistoryPhoto(official, incident.id, entry, PNG_BYTES);
  assert.match(view.history[entry].photoUrl, /^\/uploads\/.+\.png$/);
  assert.equal(view.history[entry].note, 'Cuadrilla asignada');
  assert.match((await c.incidentService.getDetail(incident.id)).history[entry].photoUrl, /^\/uploads\//);

  await assert.rejects(c.incidentService.attachHistoryPhoto(ana, incident.id, entry, PNG_BYTES), { status: 403 });
  await assert.rejects(c.incidentService.attachHistoryPhoto(official, incident.id, 99, PNG_BYTES), { status: 404 });
  await assert.rejects(c.incidentService.attachHistoryPhoto(official, incident.id, entry, Buffer.from('no es imagen')), { status: 400 });
}));

test('Foto: el GPS del EXIF verifica o marca como sospechoso el reporte',() => withContainer(async (c) => {
  const [ana, beto, caro] = [await createCitizen(c), await createCitizen(c), await createCitizen(c)];
  const near = await c.reportService.create(ana, input(at(0, 0)));
  const verified = await c.reportService.attachPhoto(ana, near.report.id, buildJpegWithGps(near.report.location.lat, near.report.location.lng));
  assert.equal(verified.report.photoCheck, 'VERIFIED');
  assert.match(verified.report.photoUrl, /^\/uploads\/.+\.jpg$/);

  const far = await c.reportService.create(beto, input(at(1000, 0)));
  const mismatch = await c.reportService.attachPhoto(beto, far.report.id, buildJpegWithGps(4.7, -74.2));
  assert.equal(mismatch.report.photoCheck, 'MISMATCH');

  const png = await c.reportService.create(caro, input(at(3000, 0)));
  assert.equal((await c.reportService.attachPhoto(caro, png.report.id, PNG_BYTES)).report.photoCheck, 'NO_GPS');
  await assert.rejects(c.reportService.attachPhoto(ana, png.report.id, PNG_BYTES), { status: 403 });
  await assert.rejects(c.reportService.attachPhoto(caro, png.report.id, Buffer.from('no es imagen')), { status: 400 });
}));

test('Consolidación DBSCAN (en worker) une incidentes que quedaron duplicados', () => withContainer(async (c) => {
  const make = (citizenId, point, minutes) => new Report({ citizenId, location: point, category: 'POTHOLE', createdAt: new Date(Date.UTC(2026, 9, 1, 12, minutes)) });
  const a = await c.reportService.importReport(make('u1', at(0, 0), 0));
  const b = await c.reportService.importReport(make('u2', at(40, 0), 1));
  await c.reportService.importReport(make('u3', at(20, 0), 2));
  assert.notEqual(a.incident.id, b.incident.id);

  const result = await c.consolidationService.run();
  assert.equal(result.incidentsMerged, 1);
  const open = await c.incidentService.list({ status: 'OPEN' });
  assert.equal(open.length, 1);
  assert.equal(open[0].reportCount, 3);
  assert.equal(open[0].id, a.incident.id);
}));

test('Panel: filtros, cola de prioridad y mapa de calor', () => withContainer(async (c) => {
  const official = await createOfficial(c);
  const citizens = await Promise.all([1, 2, 3, 4].map(() => createCitizen(c)));
  for (const citizen of citizens) await c.reportService.create(citizen, input(at(Math.random() * 5, 0)));
  const lonely = await c.reportService.create(citizens[0], input(at(800, 0), { category: 'CRACK', roadType: 'RESIDENTIAL' }));
  await c.incidentService.changeStatus(official, lonely.incident.id, 'REJECTED');

  const queue = await c.incidentService.priorityQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].reportCount, 4);
  assert.equal((await c.incidentService.list({ category: 'CRACK' })).length, 1);
  assert.equal((await c.incidentService.list({ bbox: { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1 } })).length, 0);

  const heat = await c.heatmapService.build();
  assert.equal(heat.count, 1);
  assert.equal(heat.points[0].length, 3);

  const summary = await c.incidentService.summary();
  assert.equal(summary.totals.reports, 5);
  assert.equal(summary.totals.duplicatesAvoided, 3);
}));

test('Autenticación: registro, login, token y código de funcionario', () => withContainer(async (c) => {
  const { token, user } = await c.authService.register({ name: 'Ana', email: 'ANA@test.co', password: 'secreto1' });
  assert.equal(user.email, 'ana@test.co');
  assert.equal((await c.authService.authenticate(token)).id, user.id);
  await assert.rejects(c.authService.login({ email: 'ana@test.co', password: 'otra' }), { status: 401 });
  await assert.rejects(c.authService.authenticate(`${token}x`), { status: 401 });
  await assert.rejects(c.authService.register({ name: 'Ana', email: 'ana@test.co', password: 'secreto1' }), { status: 409 });
  await assert.rejects(c.authService.register({ name: 'Luis', email: 'l@x.co', password: 'secreto1', role: 'OFFICIAL', inviteCode: 'mal' }), { status: 403 });
  assert.equal((await c.authService.login({ email: 'ana@test.co', password: 'secreto1', role: 'CITIZEN' })).user.id, user.id);
  await assert.rejects(c.authService.login({ email: 'ana@test.co', password: 'secreto1', role: 'OFFICIAL' }), { status: 403 });
}));
