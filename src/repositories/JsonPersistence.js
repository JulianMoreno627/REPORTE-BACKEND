import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class JsonPersistence {
  #path;
  #repositories;
  #delayMs;
  #timer = null;
  #writing = Promise.resolve();

  constructor(path, repositories, { delayMs = 200 } = {}) {
    this.#path = path;
    this.#repositories = repositories;
    this.#delayMs = delayMs;
  }

  async load() {
    let data;
    try {
      data = JSON.parse(await readFile(this.#path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    for (const [name, repository] of Object.entries(this.#repositories)) repository.load(data[name] ?? []);
    return true;
  }

  watch() {
    for (const repository of Object.values(this.#repositories)) repository.onChange(() => this.#schedule());
  }

  #schedule() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), this.#delayMs);
    this.#timer.unref?.();
  }

  flush() {
    clearTimeout(this.#timer);
    this.#writing = this.#writing.then(async () => {
      const data = { version: 1, savedAt: new Date().toISOString() };
      for (const [name, repository] of Object.entries(this.#repositories)) data[name] = repository.snapshot();
      await mkdir(dirname(this.#path), { recursive: true });
      const temporary = `${this.#path}.tmp`;
      await writeFile(temporary, JSON.stringify(data, null, 2));
      await rename(temporary, this.#path);
    }).catch((error) => console.error('[JsonPersistence] No se pudieron guardar los datos:', error));
    return this.#writing;
  }
}
