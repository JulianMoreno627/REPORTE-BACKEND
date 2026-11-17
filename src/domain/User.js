import { Entity } from './Entity.js';
import { ValidationError } from './errors.js';

export const Role = Object.freeze({ CITIZEN: 'CITIZEN', OFFICIAL: 'OFFICIAL' });

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,19}$/;

function cleanName(name) {
  const value = String(name ?? '').trim();
  if (value.length < 2) throw new ValidationError('El nombre debe tener al menos 2 caracteres');
  if (value.length > 100) throw new ValidationError('El nombre admite máximo 100 caracteres');
  return value;
}

function cleanEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(value)) throw new ValidationError('Correo electrónico inválido');
  return value;
}

function cleanPhone(phone) {
  const value = String(phone ?? '').trim();
  if (!value) return null;
  if (!PHONE_PATTERN.test(value)) throw new ValidationError('Teléfono inválido: usa solo números, espacios, guiones y un + inicial');
  return value;
}

export class User extends Entity {
  #name;
  #email;
  #passwordHash;
  #phone;
  #avatarUrl;

  constructor({ name, email, passwordHash, phone = null, avatarUrl = null, ...base }) {
    if (new.target === User) throw new TypeError('User es abstracta: usa Citizen u Official');
    super(base);
    this.#name = cleanName(name);
    this.#email = cleanEmail(email);
    this.#passwordHash = passwordHash;
    this.#phone = cleanPhone(phone);
    this.#avatarUrl = avatarUrl ?? null;
  }

  get name() { return this.#name; }
  get email() { return this.#email; }
  get passwordHash() { return this.#passwordHash; }
  get phone() { return this.#phone; }
  get avatarUrl() { return this.#avatarUrl; }

  get role() { throw new Error('Subclase debe definir role'); }
  get roleLabel() { throw new Error('Subclase debe definir roleLabel'); }

  canReport() { return false; }
  canManageIncidents() { return false; }

  updateProfile({ name, email, phone } = {}) {
    const next = {
      name: name === undefined ? this.#name : cleanName(name),
      email: email === undefined ? this.#email : cleanEmail(email),
      phone: phone === undefined ? this.#phone : cleanPhone(phone),
    };
    this.#name = next.name;
    this.#email = next.email;
    this.#phone = next.phone;
  }

  changePasswordHash(passwordHash) {
    this.#passwordHash = passwordHash;
  }

  setAvatar(avatarUrl) {
    this.#avatarUrl = avatarUrl ?? null;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      name: this.#name,
      email: this.#email,
      role: this.role,
      roleLabel: this.roleLabel,
      phone: this.#phone,
      avatarUrl: this.#avatarUrl,
    };
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

  updateProfile({ agency, ...data } = {}) {
    if (agency !== undefined) throw new ValidationError('Solo los funcionarios tienen dependencia');
    super.updateProfile(data);
  }
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

  updateProfile({ agency, ...data } = {}) {
    const nextAgency = agency === undefined ? this.#agency : String(agency).trim();
    if (nextAgency.length < 2) throw new ValidationError('La dependencia debe tener al menos 2 caracteres');
    super.updateProfile(data);
    this.#agency = nextAgency;
  }

  toJSON() {
    return { ...super.toJSON(), agency: this.#agency };
  }
}
