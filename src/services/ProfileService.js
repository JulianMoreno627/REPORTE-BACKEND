import { ConflictError, ValidationError } from '../domain/errors.js';
import { AuthService } from './AuthService.js';

export class ProfileService {
  #users;
  #storage;
  #workerPool;
  #maxPhotoBytes;

  constructor({ userRepository, imageStorage, workerPool, maxPhotoBytes = 2 * 1024 * 1024 }) {
    this.#users = userRepository;
    this.#storage = imageStorage;
    this.#workerPool = workerPool;
    this.#maxPhotoBytes = maxPhotoBytes;
  }

  async update(user, data) {
    if (data.email !== undefined) {
      const owner = await this.#users.findByEmail(data.email);
      if (owner && owner.id !== user.id) throw new ConflictError('Ya existe otra cuenta con ese correo');
    }
    user.updateProfile(data);
    await this.#users.save(user);
    return user;
  }

  async changePassword(user, { currentPassword, newPassword }) {
    if (!(await AuthService.verifyPassword(String(currentPassword ?? ''), user.passwordHash))) {
      throw new ValidationError('La contraseña actual no es correcta');
    }
    if (String(newPassword ?? '').length < 6) throw new ValidationError('La nueva contraseña debe tener al menos 6 caracteres');
    user.changePasswordHash(await AuthService.hashPassword(newPassword));
    await this.#users.save(user);
    return user;
  }

  async setAvatar(user, bytes) {
    if (!bytes?.length) throw new ValidationError('Envía la imagen en el cuerpo de la petición');
    if (bytes.length > this.#maxPhotoBytes) {
      throw new ValidationError(`La foto supera ${(this.#maxPhotoBytes / 1024 / 1024).toFixed(0)} MB; comprímela antes de enviarla`);
    }
    const { mimeType } = await this.#workerPool.run('analyze-image', { bytes });
    if (!mimeType) throw new ValidationError('Formato de imagen no soportado (usa JPEG, PNG o WebP)');
    user.setAvatar(await this.#storage.save(bytes, { mimeType }));
    await this.#users.save(user);
    return user;
  }

  async removeAvatar(user) {
    user.setAvatar(null);
    await this.#users.save(user);
    return user;
  }
}
