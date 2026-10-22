import { SpatialGrid } from './SpatialGrid.js';
import { centroid } from './geo.js';

const NOISE = -1;

export class Dbscan {
  #eps;
  #minPoints;

  constructor({ epsMeters = 30, minPoints = 1 } = {}) {
    if (!(epsMeters > 0)) throw new RangeError('epsMeters debe ser mayor que 0');
    if (!(minPoints >= 1)) throw new RangeError('minPoints debe ser al menos 1');
    this.#eps = epsMeters;
    this.#minPoints = minPoints;
  }

  run(points) {
    if (points.length === 0) return { clusters: [], noise: [] };

    const referenceLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
    const grid = new SpatialGrid(this.#eps, referenceLat);
    for (const point of points) grid.insert(point);

    const labels = new Map();
    let nextCluster = 0;

    for (const point of points) {
      if (labels.has(point.id)) continue;
      const neighbors = grid.neighbors(point, this.#eps);
      if (neighbors.length < this.#minPoints) {
        labels.set(point.id, NOISE);
        continue;
      }

      const cluster = nextCluster++;
      labels.set(point.id, cluster);
      const queue = neighbors.filter((neighbor) => neighbor.id !== point.id);

      for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        const label = labels.get(current.id);
        if (label === NOISE) labels.set(current.id, cluster);
        if (label !== undefined) continue;
        labels.set(current.id, cluster);
        const expansion = grid.neighbors(current, this.#eps);
        if (expansion.length >= this.#minPoints) queue.push(...expansion);
      }
    }

    const groups = new Map();
    const noise = [];
    for (const point of points) {
      const label = labels.get(point.id);
      if (label === NOISE) { noise.push(point.id); continue; }
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(point);
    }

    const clusters = [...groups.entries()].map(([index, members]) => ({
      index,
      size: members.length,
      memberIds: members.map((member) => member.id),
      centroid: centroid(members),
    }));
    return { clusters, noise };
  }
}
