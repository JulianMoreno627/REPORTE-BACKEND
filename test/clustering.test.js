import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dbscan } from '../src/clustering/Dbscan.js';
import { offsetMeters } from '../src/clustering/geo.js';
import { WorkerPool } from '../src/workers/WorkerPool.js';
import { detectImageType, readJpegGps } from '../src/images/imageAnalysis.js';
import { buildJpegWithGps, CENTER, PNG_BYTES } from './helpers.js';

const point = (id, east, north) => ({ id, ...offsetMeters(CENTER, east, north) });

test('DBSCAN: agrupa por densidad con distancia haversine y separa el ruido', () => {
  const points = [
    point('a1', 0, 0), point('a2', 10, 5), point('a3', -8, 12),
    point('b1', 500, 500), point('b2', 515, 500),
    point('solo', -900, 0),
  ];
  const { clusters, noise } = new Dbscan({ epsMeters: 30, minPoints: 2 }).run(points);
  const groups = clusters.map((cluster) => cluster.memberIds.sort().join(',')).sort();
  assert.deepEqual(groups, ['a1,a2,a3', 'b1,b2']);
  assert.deepEqual(noise, ['solo']);
});

test('DBSCAN: encadena puntos densamente conectados (40 m de extremo a extremo)', () => {
  const { clusters } = new Dbscan({ epsMeters: 30, minPoints: 1 }).run([point('p1', 0, 0), point('p2', 20, 0), point('p3', 40, 0)]);
  assert.equal(clusters.length, 1);
});

test('DBSCAN: 5.000 puntos en menos de un segundo gracias al índice espacial', () => {
  const points = Array.from({ length: 5000 }, (_, i) => point(`p${i}`, (i % 100) * 50, Math.floor(i / 100) * 50));
  const start = performance.now();
  const { clusters } = new Dbscan({ epsMeters: 30, minPoints: 1 }).run(points);
  assert.equal(clusters.length, 5000);
  assert.ok(performance.now() - start < 1000);
});

test('Imágenes: detecta el formato real y lee las coordenadas GPS del EXIF', () => {
  const jpeg = buildJpegWithGps(4.6097, -74.0817);
  assert.equal(detectImageType(jpeg), 'image/jpeg');
  assert.equal(detectImageType(PNG_BYTES), 'image/png');
  assert.equal(detectImageType(Buffer.from('hola mundo')), null);
  const gps = readJpegGps(jpeg);
  assert.ok(Math.abs(gps.lat - 4.6097) < 1e-4);
  assert.ok(Math.abs(gps.lng + 74.0817) < 1e-4);
  assert.equal(readJpegGps(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null);
});

test('WorkerPool: ejecuta tareas en hilos, encola y reporta errores', async () => {
  const pool = new WorkerPool(new URL('../src/workers/task-worker.js', import.meta.url), { size: 2 });
  try {
    const points = [point('a', 0, 0), point('b', 10, 0), point('c', 400, 0)];
    const results = await Promise.all([1, 2, 3].map(() => pool.run('dbscan', { points, epsMeters: 30, minPoints: 1 })));
    for (const result of results) assert.equal(result.clusters.length, 2);
    const analysis = await pool.run('analyze-image', { bytes: buildJpegWithGps(4.6, -74.08) });
    assert.equal(analysis.mimeType, 'image/jpeg');
    await assert.rejects(pool.run('desconocida', {}), /Tarea desconocida/);
    const stats = pool.stats();
    assert.equal(stats.completed, 4);
    assert.equal(stats.failed, 1);
  } finally {
    await pool.close();
  }
});
