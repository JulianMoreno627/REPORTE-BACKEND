import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { offsetMeters } from '../src/clustering/geo.js';
import { PostgisIncidentRepository } from '../src/repositories/PostgisIncidentRepository.js';
import { CENTER, createCitizen, createTestContainer } from './helpers.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = databaseUrl ? false : 'Define TEST_DATABASE_URL (PostgreSQL con PostGIS) para ejecutar esta prueba';
const at = (east, north) => ({ ...offsetMeters(CENTER, east, north), category: 'POTHOLE' });

let container;

before(async () => {
  if (!databaseUrl) return;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query('DROP VIEW IF EXISTS incidents_map, reports_map');
  await admin.query('DROP TABLE IF EXISTS users, incidents, reports, notifications, photos');
  await admin.end();
  container = await createTestContainer({ databaseUrl, databaseSsl: false });
});

after(async () => {
  await container?.shutdown();
});

test('PostGIS: ST_DWithin agrupa a 30 m, bbox filtra y las filas quedan con geografía', { skip }, async () => {
  assert.ok(container.incidentRepository instanceof PostgisIncidentRepository);
  const [ana, beto, caro] = [await createCitizen(container), await createCitizen(container), await createCitizen(container)];

  const first = await container.reportService.create(ana, at(0, 0));
  const second = await container.reportService.create(beto, at(20, 10));
  const far = await container.reportService.create(caro, at(300, 0));
  assert.equal(second.grouped, true);
  assert.equal(second.incident.id, first.incident.id);
  assert.ok(second.distanceMeters > 15 && second.distanceMeters < 30);
  assert.notEqual(far.incident.id, first.incident.id);

  const box = { minLat: CENTER.lat - 0.001, minLng: CENTER.lng - 0.001, maxLat: CENTER.lat + 0.001, maxLng: CENTER.lng + 0.001 };
  const inside = await container.incidentService.list({ bbox: box });
  assert.deepEqual(inside.map((incident) => incident.id), [first.incident.id]);
  assert.equal((await container.heatmapService.build({ bbox: box })).count, 1);

  await container.persistence.flush();
  const { rows } = await container.pool.query(`
    SELECT round(ST_Distance(a.location, b.location)) AS meters
    FROM incidents a, incidents b WHERE a.id = $1 AND b.id = $2`, [first.incident.id, far.incident.id]);
  assert.ok(Math.abs(Number(rows[0].meters) - 290) < 15);

  const map = await container.pool.query('SELECT count(*)::int AS total, bool_and(ST_SRID(geom) = 4326) AS wgs84 FROM reports_map');
  assert.deepEqual(map.rows[0], { total: 3, wgs84: true });

  assert.ok(container.metricsService.summary().database['incidents.st_dwithin'].count >= 3);
});
