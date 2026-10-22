import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Role, User } from '../domain/User.js';
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '../domain/errors.js';
import { Clock } from '../infrastructure/Clock.js';

const scrypt = promisify(scryptCallback);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class AuthService {
  #users;
  #secret;
  #officialInviteCode;
  #clock;
  #ttlMs;

  constructor({ userRepository, tokenSecret, officialInviteCode, clock = new Clock(), tokenTtlMs = WEEK_MS }) {
    this.#users = userRepository;
    this.#secret = tokenSecret;
    this.#officialInviteCode = officialInviteCode;
    this.#clock = clock;
    this.#ttlMs = tokenTtlMs;
  }

  async register({ name, email, password, role = Role.CITIZEN, inviteCode, agency }) {
    if (role === Role.OFFICIAL && inviteCode !== this.#officialInviteCode) {
      throw new ForbiddenError('Código de invitación de funcionario inválido');
    }
    const user = await this.createUser({ name, email, password, role, agency });
    return { token: this.issueToken(user), user };
  }

  async createUser({ name, email, password, role = Role.CITIZEN, agency }) {
    if (String(password ?? '').length < 6) throw new ValidationError('La contraseña debe tener al menos 6 caracteres');
    if (await this.#users.findByEmail(email)) throw new ConflictError('Ya existe una cuenta con ese correo');
    const user = User.create({
      name, email, role, agency,
      passwordHash: await AuthService.hashPassword(password),
      createdAt: this.#clock.now(),
    });
    await this.#users.save(user);
    return user;
  }

  async login({ email, password, role }) {
    const user = await this.#users.findByEmail(email);
    if (!user || !(await AuthService.verifyPassword(String(password ?? ''), user.passwordHash))) {
      throw new UnauthorizedError('Correo o contraseña incorrectos');
    }
    if (role && role !== user.role) {
      throw new ForbiddenError(role === Role.OFFICIAL
        ? 'Esta cuenta es de ciudadano: ingresa por la opción "Ciudadano"'
        : 'Esta cuenta es de funcionario: ingresa por la opción "Funcionario"');
    }
    return { token: this.issueToken(user), user };
  }

  issueToken(user) {
    const payload = Buffer.from(JSON.stringify({
      sub: user.id,
      role: user.role,
      exp: this.#clock.now().getTime() + this.#ttlMs,
    })).toString('base64url');
    return `${payload}.${this.#sign(payload)}`;
  }

  async authenticate(token) {
    const [payload, signature] = String(token ?? '').split('.');
    if (!payload || !signature) throw new UnauthorizedError();
    const expected = Buffer.from(this.#sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedError('Sesión inválida');
    }
    const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (exp < this.#clock.now().getTime()) throw new UnauthorizedError('La sesión expiró, inicia sesión de nuevo');
    const user = await this.#users.findById(sub);
    if (!user) throw new UnauthorizedError('La cuenta ya no existe');
    return user;
  }

  #sign(payload) {
    return createHmac('sha256', this.#secret).update(payload).digest('base64url');
  }

  static async hashPassword(password) {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, 64);
    return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
  }

  static async verifyPassword(password, stored) {
    const [scheme, saltHex, keyHex] = String(stored ?? '').split('$');
    if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
    const expected = Buffer.from(keyHex, 'hex');
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
    return timingSafeEqual(expected, actual);
  }
}
