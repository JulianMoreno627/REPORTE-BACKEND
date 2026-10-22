import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Coordinate } from '../src/domain/Coordinate.js';
import { Incident } from '../src/domain/Incident.js';
import { Report } from '../src/domain/Report.js';
import { IncidentStatus } from '../src/domain/IncidentStatus.js';
import { DamageCategory } from '../src/domain/DamageCategory.js';
import { User, Citizen, Official } from '../src/domain/User.js';
import { ValidationError } from '../src/domain/errors.js';
import { WeightedPriorityStrategy, ReportCountPriorityStrategy } from '../src/domain/priority/strategies.js';
import { offsetMeters } from '../src/clustering/geo.js';
import { CENTER } from './helpers.js';

const report = (citizenId, point, extra = {}) => new Report({ citizenId, location: point, category: 'POTHOLE', ...extra });

test('Coordinate: la distancia haversine coincide con la geometría esperada', () => {
  const a = new Coordinate(CENTER.lat, CENTER.lng);
  const b = Coordinate.from(offsetMeters(CENTER, 0, 30));
  assert.ok(Math.abs(a.distanceTo(b) - 30) < 0.5);
  assert.ok(Math.abs(new Coordinate(0, 0).distanceTo(new Coordinate(1, 0)) - 111_195) < 50);
});

test('Coordinate: rechaza latitudes y longitudes inválidas', () => {
  assert.throws(() => new Coordinate(91, 0), ValidationError);
  assert.throws(() => new Coordinate(0, null), ValidationError);
  assert.throws(() => new Coordinate('abc', 0), ValidationError);
});

test('Enumeration: valida los códigos y expone el catálogo', () => {
  assert.equal(DamageCategory.from('SINKHOLE').label, 'Hundimiento');
  assert.throws(() => DamageCategory.from('VOLCAN'), ValidationError);
  assert.equal(DamageCategory.catalog().length, 6);
});

test('Incident: la máquina de estados solo permite transiciones válidas', () => {
  const incident = Incident.open(report('u1', CENTER));
  assert.throws(() => incident.changeStatus('RESOLVED', { by: 'f1' }), /No se puede pasar/);
  incident.changeStatus('IN_REVIEW', { by: 'f1' });
  incident.changeStatus('IN_REPAIR', { by: 'f1' });
  incident.changeStatus('RESOLVED', { by: 'f1', note: 'Listo' });
  assert.equal(incident.status, IncidentStatus.RESOLVED);
  assert.equal(incident.isOpen, false);
  assert.deepEqual(incident.history.map((entry) => entry.status), ['REPORTED', 'IN_REVIEW', 'IN_REPAIR', 'RESOLVED']);
});

test('Incident: agrega reportes moviendo el centroide y eligiendo la categoría dominante', () => {
  const incident = Incident.open(report('u1', CENTER));
  incident.addReport(report('u2', offsetMeters(CENTER, 20, 0), { category: 'SINKHOLE', roadType: 'PRIMARY' }));
  incident.addReport(report('u3', offsetMeters(CENTER, 10, 0), { category: 'SINKHOLE' }));
  assert.equal(incident.reportCount, 3);
  assert.equal(incident.category, DamageCategory.SINKHOLE);
  assert.equal(incident.roadType.code, 'PRIMARY');
  assert.ok(Math.abs(incident.location.distanceTo(Coordinate.from(offsetMeters(CENTER, 10, 0)))) < 0.5);
});

test('Prioridad ponderada: más reportes, más antigüedad y vía principal suben el puntaje', () => {
  const strategy = new WeightedPriorityStrategy();
  const now = new Date('2026-10-20T00:00:00Z');
  const old = Incident.open(report('u1', CENTER, { roadType: 'PRIMARY', createdAt: '2026-09-25T00:00:00Z' }));
  for (let i = 2; i <= 6; i++) old.addReport(report(`u${i}`, CENTER, { createdAt: '2026-09-26T00:00:00Z' }));
  const recent = Incident.open(report('u9', CENTER, { roadType: 'RESIDENTIAL', category: 'CRACK', createdAt: '2026-10-19T00:00:00Z' }));
  const high = strategy.evaluate(old, now);
  const low = strategy.evaluate(recent, now);
  assert.ok(high.score > low.score);
  assert.equal(high.level, 'HIGH');
  assert.equal(low.level, 'LOW');
});

test('Strategy intercambiable y cerrado = prioridad 0', () => {
  const incident = Incident.open(report('u1', CENTER));
  assert.equal(new ReportCountPriorityStrategy().evaluate(incident).score, 0.1);
  incident.changeStatus('REJECTED', { by: 'f1' });
  assert.equal(new WeightedPriorityStrategy().evaluate(incident).level, 'NONE');
});

test('User: polimorfismo de permisos y clase abstracta', () => {
  const citizen = User.create({ name: 'Ana', email: 'ana@x.co', role: 'CITIZEN' });
  const official = User.create({ name: 'Luis', email: 'luis@alcaldia.gov.co', role: 'OFFICIAL' });
  assert.ok(citizen instanceof Citizen && official instanceof Official);
  assert.equal(citizen.canManageIncidents(), false);
  assert.equal(official.canManageIncidents(), true);
  assert.equal('passwordHash' in citizen.toJSON(), false);
  assert.throws(() => new User({ name: 'X', email: 'x@x.co' }), TypeError);
});
