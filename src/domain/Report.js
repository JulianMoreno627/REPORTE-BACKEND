import { Entity } from './Entity.js';
import { Coordinate } from './Coordinate.js';
import { DamageCategory } from './DamageCategory.js';
import { RoadType } from './RoadType.js';
import { ValidationError } from './errors.js';

export const PhotoCheck = Object.freeze({
  NONE: 'NONE',
  VERIFIED: 'VERIFIED',
  MISMATCH: 'MISMATCH',
  NO_GPS: 'NO_GPS',
});

const MAX_DESCRIPTION = 500;

export class Report extends Entity {
  #citizenId;
  #location;
  #category;
  #roadType;
  #description;
  #incidentId;
  #photoUrl;
  #photoCheck;
  #photoDistanceMeters;
  #aiAnalysis;
  #clientRequestId;

  constructor({
    citizenId, location, category, roadType = RoadType.SECONDARY, description = '',
    incidentId = null, photoUrl = null, photoCheck = PhotoCheck.NONE, photoDistanceMeters = null,
    aiAnalysis = null, clientRequestId = null, ...base
  }) {
    super(base);
    if (!citizenId) throw new ValidationError('El reporte debe tener un ciudadano');
    const text = String(description ?? '').trim();
    if (text.length > MAX_DESCRIPTION) throw new ValidationError(`La descripción admite máximo ${MAX_DESCRIPTION} caracteres`);
    this.#citizenId = citizenId;
    this.#location = Coordinate.from(location);
    this.#category = DamageCategory.from(category);
    this.#roadType = RoadType.from(roadType);
    this.#description = text;
    this.#incidentId = incidentId;
    this.#photoUrl = photoUrl;
    this.#photoCheck = photoCheck;
    this.#photoDistanceMeters = photoDistanceMeters;
    this.#aiAnalysis = aiAnalysis ? { ...aiAnalysis } : null;
    this.#clientRequestId = clientRequestId;
  }

  get citizenId() { return this.#citizenId; }
  get location() { return this.#location; }
  get category() { return this.#category; }
  get roadType() { return this.#roadType; }
  get description() { return this.#description; }
  get incidentId() { return this.#incidentId; }
  get photoUrl() { return this.#photoUrl; }
  get photoCheck() { return this.#photoCheck; }
  get aiAnalysis() { return this.#aiAnalysis ? { ...this.#aiAnalysis } : null; }
  get clientRequestId() { return this.#clientRequestId; }

  assignTo(incidentId) {
    this.#incidentId = incidentId;
  }

  attachPhoto(url, check, distanceMeters = null, aiAnalysis = null) {
    this.#photoUrl = url;
    this.#photoCheck = check;
    this.#photoDistanceMeters = distanceMeters === null ? null : Math.round(distanceMeters);
    this.#aiAnalysis = aiAnalysis ? { ...aiAnalysis } : null;
  }

  toPublicJSON() {
    return {
      ...super.toJSON(),
      location: this.#location.toJSON(),
      category: this.#category.code,
      categoryLabel: this.#category.label,
      roadType: this.#roadType.code,
      description: this.#description,
      incidentId: this.#incidentId,
      photoUrl: this.#photoUrl,
      photoCheck: this.#photoCheck,
      photoDistanceMeters: this.#photoDistanceMeters,
      aiAnalysis: this.aiAnalysis,
    };
  }

  toJSON() {
    return { ...this.toPublicJSON(), citizenId: this.#citizenId, clientRequestId: this.#clientRequestId };
  }

  static restore(record) {
    return new Report(record);
  }
}
