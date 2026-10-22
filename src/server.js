import { createContainer } from './container.js';
import { createApp } from './app.js';

const container = await createContainer().init();
const { config, metricsService, consolidationService } = container;

metricsService.start();
consolidationService.start(config.consolidationIntervalMs);

const server = createApp(container).listen(config.port, () => {
  console.log(`Vías Seguras API escuchando en http://localhost:${config.port}`);
  console.log(`  Workers: ${config.workerPoolSize} · radio de agrupación: ${config.clusterRadiusMeters} m · prioridad: ${config.priorityStrategy}`);
  console.log(`  Estadísticas (SSG): http://localhost:${config.port}/estadisticas/`);
});

async function shutdown(signal) {
  console.log(`\n${signal} recibido: cerrando...`);
  server.close();
  server.closeAllConnections?.();
  await container.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
