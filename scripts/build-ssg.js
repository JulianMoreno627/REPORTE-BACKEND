import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createContainer } from '../src/container.js';
import { statsPage } from '../src/render/templates.js';

const started = performance.now();
const container = await createContainer().init();
const html = statsPage(await container.incidentService.summary());
await mkdir('public/estadisticas', { recursive: true });
await writeFile('public/estadisticas/index.html', html);
await container.shutdown();
console.log(`SSG: public/estadisticas/index.html generado en ${(performance.now() - started).toFixed(0)} ms`);
