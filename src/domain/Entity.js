import { randomUUID } from 'node:crypto';

export class Entity {
  #id;
  #createdAt;

  constructor({ id = randomUUID(), createdAt = new Date() } = {}) {
    this.#id = id;
    this.#createdAt = new Date(createdAt);
  }

  get id() { return this.#id; }
  get createdAt() { return this.#createdAt; }

  equals(other) {
    return other instanceof Entity && other.id === this.#id;
  }

  toJSON() {
    return { id: this.#id, createdAt: this.#createdAt.toISOString() };
  }

  toRecord() {
    return this.toJSON();
  }
}
