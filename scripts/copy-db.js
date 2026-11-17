import { readFile } from 'node:fs/promises';
import { createPool } from '../src/container.js';
import { config } from '../src/config.js';

const TABLES = ['users', 'incidents', 'reports', 'notifications', 'photos'];
const SCHEMA_URL = new URL('../db/schema.sql', import.meta.url);

const sourceUrl = process.env.SOURCE_DATABASE_URL;
if (!sourceUrl || !config.databaseUrl) {
  console.error('Define en .env SOURCE_DATABASE_URL (base de origen, p. ej. Render) y DATABASE_URL (base de destino, p. ej. Neon).');
  process.exit(1);
}
if (sourceUrl === config.databaseUrl) {
  console.error('SOURCE_DATABASE_URL y DATABASE_URL apuntan a la misma base.');
  process.exit(1);
}

const source = createPool({ databaseUrl: sourceUrl, databaseSsl: true });
const target = createPool({ databaseUrl: config.databaseUrl, databaseSsl: config.databaseSsl });

async function copyableColumns(table) {
  const { rows } = await source.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER'
     ORDER BY ordinal_position`,
    [table],
  );
  return rows;
}

async function copyTable(table) {
  const columns = await copyableColumns(table);
  if (columns.length === 0) return 0;
  const names = columns.map((column) => column.column_name);
  const key = table === 'photos' ? 'name' : 'id';
  const insert = `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})
    ON CONFLICT (${key}) DO NOTHING`;
  const { rows } = await source.query(`SELECT ${names.join(', ')} FROM ${table}`);
  const client = await target.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(insert, columns.map(({ column_name: name, data_type: type }) => (
        type === 'json' || type === 'jsonb' ? JSON.stringify(row[name]) : row[name]
      )));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return rows.length;
}

try {
  await target.query(await readFile(SCHEMA_URL, 'utf8'));
  const summary = {};
  for (const table of TABLES) summary[table] = await copyTable(table);
  console.log('Datos copiados a la base de destino:');
  console.table(summary);
} finally {
  await Promise.all([source.end(), target.end()]);
}
