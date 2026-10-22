import { performance } from 'node:perf_hooks';
import { IncidentRepository } from './repositories.js';
import { IncidentStatus } from '../domain/IncidentStatus.js';
import { insideBoundingBox } from '../clustering/geo.js';

const OPEN_STATUSES = IncidentStatus.values().filter((status) => status.isOpen).map((status) => status.code);

const NEAR_SQL = `
  SELECT id, ST_Distance(location, target.point) AS distance
  FROM incidents, (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS point) AS target
  WHERE status = ANY($4) AND ST_DWithin(location, target.point, $3)
  ORDER BY distance`;

const BOUNDS_SQL = `
  SELECT id FROM incidents
  WHERE location::geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)`;

export class PostgisIncidentRepository extends IncidentRepository {
  #pool;
  #sync;
  #onQuery;

  constructor({ pool, sync = async () => {}, onQuery = () => {} }) {
    super();
    this.#pool = pool;
    this.#sync = sync;
    this.#onQuery = onQuery;
  }

  async #query(name, sql, params) {
    await this.#sync();
    const started = performance.now();
    try {
      const { rows } = await this.#pool.query(sql, params);
      return rows;
    } finally {
      this.#onQuery({ name, durationMs: performance.now() - started });
    }
  }

  async findOpenNear(location, radiusMeters) {
    const rows = await this.#query('incidents.st_dwithin', NEAR_SQL, [location.lng, location.lat, radiusMeters, OPEN_STATUSES]);
    const matches = await Promise.all(rows.map(async ({ id, distance }) => ({ incident: await this.findById(id), distance })));
    return matches.filter(({ incident }) => incident?.isOpen);
  }

  async findInBounds(bbox, predicate = () => true) {
    if (!bbox) return super.findInBounds(bbox, predicate);
    const rows = await this.#query('incidents.bbox', BOUNDS_SQL, [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]);
    const incidents = await Promise.all(rows.map(({ id }) => this.findById(id)));
    return incidents.filter((incident) => incident && insideBoundingBox(incident.location, bbox) && predicate(incident));
  }
}
