import { ValidationError } from './errors.js';
import { haversineMeters } from '../clustering/geo.js';

export class Coordinate {
  #lat;
  #lng;

  constructor(lat, lng) {
    const latitude = Coordinate.#parse(lat);
    const longitude = Coordinate.#parse(lng);
    if (latitude === null || latitude < -90 || latitude > 90) throw new ValidationError('Latitud inválida');
    if (longitude === null || longitude < -180 || longitude > 180) throw new ValidationError('Longitud inválida');
    this.#lat = latitude;
    this.#lng = longitude;
  }

  static #parse(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  static from(value) {
    return value instanceof Coordinate ? value : new Coordinate(value?.lat, value?.lng);
  }

  get lat() { return this.#lat; }
  get lng() { return this.#lng; }

  distanceTo(other) {
    return haversineMeters(this.#lat, this.#lng, other.lat, other.lng);
  }

  isWithin(other, meters) {
    return this.distanceTo(other) <= meters;
  }

  equals(other) {
    return other instanceof Coordinate && other.lat === this.#lat && other.lng === this.#lng;
  }

  toJSON() {
    return { lat: this.#lat, lng: this.#lng };
  }
}
