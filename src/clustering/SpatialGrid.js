import { haversineMeters, metersToLatDegrees, metersToLngDegrees } from './geo.js';

export class SpatialGrid {
  #cellLat;
  #cellLng;
  #cells = new Map();

  constructor(cellMeters, referenceLat = 0) {
    this.#cellLat = metersToLatDegrees(cellMeters);
    this.#cellLng = metersToLngDegrees(cellMeters, referenceLat);
  }

  #cellOf(lat, lng) {
    return [Math.floor(lat / this.#cellLat), Math.floor(lng / this.#cellLng)];
  }

  insert(point) {
    const key = this.#cellOf(point.lat, point.lng).join(':');
    if (!this.#cells.has(key)) this.#cells.set(key, []);
    this.#cells.get(key).push(point);
  }

  *#candidates(lat, lng) {
    const [row, col] = this.#cellOf(lat, lng);
    for (let dRow = -1; dRow <= 1; dRow++) {
      for (let dCol = -1; dCol <= 1; dCol++) {
        const cell = this.#cells.get(`${row + dRow}:${col + dCol}`);
        if (cell) yield* cell;
      }
    }
  }

  neighbors(point, radiusMeters) {
    const found = [];
    for (const candidate of this.#candidates(point.lat, point.lng)) {
      if (haversineMeters(point.lat, point.lng, candidate.lat, candidate.lng) <= radiusMeters) found.push(candidate);
    }
    return found;
  }
}
