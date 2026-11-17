import { readFile } from 'node:fs/promises';

const SCHEMA_URL = new URL('../../db/schema.sql', import.meta.url);
const json = (value) => JSON.stringify(value ?? null);

const TABLES = {
  users: {
    table: 'users',
    columns: ['id', 'name', 'email', 'password_hash', 'role', 'agency', 'phone', 'avatar_url', 'created_at'],
    toRow: (r) => [r.id, r.name, r.email, r.passwordHash, r.role, r.agency ?? null, r.phone ?? null, r.avatarUrl ?? null, r.createdAt],
    fromRow: (row) => ({
      id: row.id, name: row.name, email: row.email, passwordHash: row.password_hash,
      role: row.role, agency: row.agency ?? undefined, phone: row.phone, avatarUrl: row.avatar_url, createdAt: row.created_at,
    }),
  },
  incidents: {
    table: 'incidents',
    columns: ['id', 'lat', 'lng', 'status', 'road_type', 'report_ids', 'reporter_ids', 'category_counts', 'history', 'created_at', 'updated_at'],
    toRow: (r) => [
      r.id, r.location.lat, r.location.lng, r.status, r.roadType,
      json(r.reportIds), json(r.reporterIds), json(r.categoryCounts), json(r.history), r.createdAt, r.updatedAt,
    ],
    fromRow: (row) => ({
      id: row.id, location: { lat: row.lat, lng: row.lng }, status: row.status, roadType: row.road_type,
      reportIds: row.report_ids, reporterIds: row.reporter_ids, categoryCounts: row.category_counts,
      history: row.history, createdAt: row.created_at, updatedAt: row.updated_at,
    }),
  },
  reports: {
    table: 'reports',
    columns: ['id', 'incident_id', 'citizen_id', 'lat', 'lng', 'category', 'road_type', 'description', 'photo_url', 'photo_check', 'photo_distance_m', 'ai_analysis', 'client_request_id', 'created_at'],
    toRow: (r) => [
      r.id, r.incidentId, r.citizenId, r.location.lat, r.location.lng, r.category, r.roadType, r.description,
      r.photoUrl, r.photoCheck, r.photoDistanceMeters, json(r.aiAnalysis), r.clientRequestId, r.createdAt,
    ],
    fromRow: (row) => ({
      id: row.id, incidentId: row.incident_id, citizenId: row.citizen_id, location: { lat: row.lat, lng: row.lng },
      category: row.category, roadType: row.road_type, description: row.description, photoUrl: row.photo_url,
      photoCheck: row.photo_check, photoDistanceMeters: row.photo_distance_m, aiAnalysis: row.ai_analysis,
      clientRequestId: row.client_request_id, createdAt: row.created_at,
    }),
  },
  notifications: {
    table: 'notifications',
    columns: ['id', 'user_id', 'incident_id', 'title', 'message', 'read', 'created_at'],
    toRow: (r) => [r.id, r.userId, r.incidentId ?? null, r.title, r.message, r.read, r.createdAt],
    fromRow: (row) => ({
      id: row.id, userId: row.user_id, incidentId: row.incident_id, title: row.title,
      message: row.message, read: row.read, createdAt: row.created_at,
    }),
  },
};

function upsertSql({ table, columns }) {
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const updates = columns.filter((column) => column !== 'id').map((column) => `${column} = EXCLUDED.${column}`).join(', ');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}`;
}

export class PostgresPersistence {
  #pool;
  #repositories;
  #pending = new Map();
  #draining = null;

  constructor(pool, repositories) {
    this.#pool = pool;
    this.#repositories = repositories;
  }

  async load() {
    try {
      await this.#pool.query(await readFile(SCHEMA_URL, 'utf8'));
    } catch (error) {
      if (/postgis/i.test(error.message)) {
        throw new Error('PostGIS no está instalado en el servidor PostgreSQL. En Windows instálalo con Stack Builder (Spatial Extensions → PostGIS).', { cause: error });
      }
      throw error;
    }
    for (const [name, repository] of Object.entries(this.#repositories)) {
      const { table, fromRow } = TABLES[name];
      const { rows } = await this.#pool.query(`SELECT * FROM ${table}`);
      repository.load(rows.map(fromRow));
    }
    return true;
  }

  watch() {
    for (const [name, repository] of Object.entries(this.#repositories)) {
      repository.onChange((change) => {
        const id = change.type === 'save' ? change.entity.id : change.id;
        this.#pending.set(`${name}:${id}`, { name, ...change });
        this.#drain();
      });
    }
  }

  #drain() {
    this.#draining ??= (async () => {
      await new Promise((resolve) => setImmediate(resolve));
      while (this.#pending.size > 0) {
        const batch = [...this.#pending.values()];
        this.#pending.clear();
        for (const change of batch) await this.#write(change);
      }
    })().finally(() => { this.#draining = null; });
    return this.#draining;
  }

  async #write({ name, type, entity, id }) {
    const mapping = TABLES[name];
    try {
      if (type === 'delete') await this.#pool.query(`DELETE FROM ${mapping.table} WHERE id = $1`, [id]);
      else await this.#pool.query(upsertSql(mapping), mapping.toRow(entity.toRecord()));
    } catch (error) {
      console.error(`[PostgresPersistence] No se pudo guardar ${name}/${id ?? entity.id}:`, error.message);
    }
  }

  async flush() {
    await (this.#draining ?? this.#drain());
  }

  async close() {
    await this.flush();
    await this.#pool.end();
  }
}
