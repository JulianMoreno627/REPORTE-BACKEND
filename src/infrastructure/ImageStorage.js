import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export class ImageStorage {
  constructor() {
    if (new.target === ImageStorage) throw new TypeError('ImageStorage es una interfaz abstracta');
  }

  async save(_bytes, _options) {
    throw new Error('No implementado');
  }
}

export class LocalImageStorage extends ImageStorage {
  #directory;
  #publicPath;

  constructor({ directory, publicPath = '/uploads' }) {
    super();
    this.#directory = directory;
    this.#publicPath = publicPath;
  }

  async save(bytes, { mimeType }) {
    const fileName = `${randomUUID()}${EXTENSIONS[mimeType] ?? ''}`;
    await mkdir(this.#directory, { recursive: true });
    await writeFile(join(this.#directory, fileName), bytes);
    return `${this.#publicPath}/${fileName}`;
  }
}

export class PostgresImageStorage extends ImageStorage {
  #pool;
  #publicPath;

  constructor({ pool, publicPath = '/uploads' }) {
    super();
    this.#pool = pool;
    this.#publicPath = publicPath;
  }

  async save(bytes, { mimeType }) {
    const fileName = `${randomUUID()}${EXTENSIONS[mimeType] ?? ''}`;
    await this.store(fileName, bytes, mimeType);
    return `${this.#publicPath}/${fileName}`;
  }

  async store(fileName, bytes, mimeType) {
    await this.#pool.query(
      'INSERT INTO photos (name, mime_type, bytes) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING',
      [fileName, mimeType, bytes],
    );
  }

  async read(fileName) {
    const { rows } = await this.#pool.query('SELECT mime_type, bytes FROM photos WHERE name = $1', [fileName]);
    return rows[0] ? { mimeType: rows[0].mime_type, bytes: rows[0].bytes } : null;
  }
}
