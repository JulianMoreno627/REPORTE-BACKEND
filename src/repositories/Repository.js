export class Repository {
  constructor() {
    if (new.target === Repository) throw new TypeError('Repository es una interfaz abstracta');
  }

  async findById(_id) { throw new Error('No implementado'); }
  async findAll(_predicate) { throw new Error('No implementado'); }
  async save(_entity) { throw new Error('No implementado'); }
  async delete(_id) { throw new Error('No implementado'); }
  async count() { throw new Error('No implementado'); }
}

export class InMemoryRepository extends Repository {
  #items = new Map();
  #restore;
  #changeListeners = new Set();

  constructor(restore) {
    super();
    this.#restore = restore;
  }

  async findById(id) {
    return this.#items.get(id) ?? null;
  }

  async findAll(predicate) {
    const all = [...this.#items.values()];
    return predicate ? all.filter(predicate) : all;
  }

  async save(entity) {
    this.#items.set(entity.id, entity);
    this.#notifyChange({ type: 'save', entity });
    return entity;
  }

  async delete(id) {
    const deleted = this.#items.delete(id);
    if (deleted) this.#notifyChange({ type: 'delete', id });
    return deleted;
  }

  async count() {
    return this.#items.size;
  }

  onChange(listener) {
    this.#changeListeners.add(listener);
  }

  #notifyChange(change) {
    for (const listener of this.#changeListeners) listener(change);
  }

  snapshot() {
    return [...this.#items.values()].map((entity) => entity.toRecord());
  }

  load(records) {
    this.#items.clear();
    for (const record of records) {
      const entity = this.#restore(record);
      this.#items.set(entity.id, entity);
    }
  }
}
