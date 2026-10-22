import { Entity } from './Entity.js';
import { ValidationError } from './errors.js';

export const Role = Object.freeze({ CITIZEN: 'CITIZEN', OFFICIAL: 'OFFICIAL' });

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class User extends Entity {
  #name;
  #email;
  #passwordHash;

  constructor({ name, email, passwordHash, ...base }) {
    if (new.target === User) throw new TypeError('User es abstracta: usa Citizen u Official');
    super(base);
    const cleanName = String(name ?? '').trim();
    const cleanEmail = String(email ?? '').trim().toLowerCase();
    if (cleanName.length < 2) throw new ValidationError('El nombre debe tener al menos 2 caracteres');
    if (!EMAIL_PATTERN.test(cleanEmail)) throw new ValidationError('Correo electrónico inválido');
    this.#name = cleanName;
    this.#email = cleanEmail;
    this.#passwordHash = passwordHash;
  }

  get name() { return this.#name; }
  get email() { return this.#email; }
  get passwordHash() { return this.#passwordHash; }

  get role() { throw new Error('Subclase debe definir role'); }
  get roleLabel() { throw new Error('Subclase debe definir roleLabel'); }

  canReport() { return false; }
  canManageIncidents() { return false; }

  toJSON() {
    return { ...super.toJSON(), name: this.#name, email: this.#email, role: this.role, roleLabel: this.roleLabel };
  }

  toRecord() {
    return { ...this.toJSON(), passwordHash: this.#passwordHash };
  }

  static create(data) {
    switch (data.role ?? Role.CITIZEN) {
      case Role.CITIZEN: return new Citizen(data);
      case Role.OFFICIAL: return new Official(data);
      default: throw new ValidationError(`Rol inválido: ${data.role}`);
    }
  }

  static restore(record) {
    return User.create(record);
  }
}

export class Citizen extends User {
  get role() { return Role.CITIZEN; }
  get roleLabel() { return 'Ciudadano'; }
  canReport() { return true; }
}

export class Official extends User {
  #agency;

  constructor({ agency = 'Alcaldía', ...data }) {
    super(data);
    this.#agency = agency;
  }

  get role() { return Role.OFFICIAL; }
  get roleLabel() { return 'Funcionario'; }
  get agency() { return this.#agency; }
  canReport() { return true; }
  canManageIncidents() { return true; }

  toJSON() {
    return { ...super.toJSON(), agency: this.#agency };
  }
}
