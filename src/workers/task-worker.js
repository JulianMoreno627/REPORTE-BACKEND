import { parentPort } from 'node:worker_threads';
import { Dbscan } from '../clustering/Dbscan.js';
import { analyzeImage } from '../images/imageAnalysis.js';

const handlers = {
  dbscan: ({ points, epsMeters, minPoints }) => new Dbscan({ epsMeters, minPoints }).run(points),
  'analyze-image': ({ bytes }) => analyzeImage(bytes),
};

parentPort.on('message', ({ id, type, payload }) => {
  try {
    const handler = handlers[type];
    if (!handler) throw new Error(`Tarea desconocida: ${type}`);
    parentPort.postMessage({ id, ok: true, result: handler(payload) });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: error.message });
  }
});
