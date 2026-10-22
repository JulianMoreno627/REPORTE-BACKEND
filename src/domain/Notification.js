import { Entity } from './Entity.js';

export class Notification extends Entity {
  #userId;
  #incidentId;
  #title;
  #message;
  #read;

  constructor({ userId, incidentId, title, message, read = false, ...base }) {
    super(base);
    this.#userId = userId;
    this.#incidentId = incidentId;
    this.#title = title;
    this.#message = message;
    this.#read = read;
  }

  get userId() { return this.#userId; }
  get read() { return this.#read; }

  markRead() {
    this.#read = true;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      userId: this.#userId,
      incidentId: this.#incidentId,
      title: this.#title,
      message: this.#message,
      read: this.#read,
    };
  }

  static restore(record) {
    return new Notification(record);
  }
}
