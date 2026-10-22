import { ValidationError } from './errors.js';

export class Enumeration {
  static displayName = 'Valor';

  constructor(code, label) {
    this.code = code;
    this.label = label;
  }

  static values() {
    return Object.values(this).filter((value) => value instanceof this);
  }

  static from(value) {
    if (value instanceof this) return value;
    const found = this.values().find((item) => item.code === value);
    if (!found) {
      throw new ValidationError(`${this.displayName} inválido: ${value}`, {
        allowed: this.values().map((item) => item.code),
      });
    }
    return found;
  }

  static catalog() {
    return this.values().map((item) => item.describe());
  }

  describe() {
    return { code: this.code, label: this.label };
  }

  toJSON() { return this.code; }
  toString() { return this.code; }
}
