import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createContainer } from '../src/container.js';
import { config } from '../src/config.js';
import { detectImageType } from '../src/images/imageAnalysis.js';
import {
  IncidentRepository, NotificationRepository, ReportRepository, UserRepository,
} from '../src/repositories/repositories.js';
import { JsonPersistence } from '../src/repositories/JsonPersistence.js';

if (!config.databaseUrl) {
  console.error('Define DATABASE_URL en el archivo .env para importar los datos a PostgreSQL.');
  process.exit(1);
}

const staging = {
  users: new UserRepository(),
  incidents: new IncidentRepository(),
  reports: new ReportRepository(),
  notifications: new NotificationRepository(),
};
if (!(await new JsonPersistence(config.dataPath, staging).load())) {
  console.error(`No existe ${config.dataPath}: no hay datos locales para importar.`);
  process.exit(1);
}

const container = await createContainer().init();
const summary = {};
for (const [name, source] of Object.entries(staging)) {
  const target = container.repositories[name];
  const entities = await source.findAll();
  for (const entity of entities) await target.save(entity);
  summary[name] = entities.length;
}

let photos = 0;
const files = await readdir(config.uploadsDir).catch(() => []);
for (const file of files) {
  const bytes = await readFile(join(config.uploadsDir, file));
  const mimeType = detectImageType(bytes);
  if (!mimeType) continue;
  await container.imageStorage.store(file, bytes, mimeType);
  photos++;
}

await container.shutdown();
console.log('Datos importados a PostgreSQL:');
console.table({ ...summary, photos });
