import { Enumeration } from './Enumeration.js';

export class DamageCategory extends Enumeration {
  static displayName = 'Categoría de daño';

  static POTHOLE = new DamageCategory('POTHOLE', 'Bache', 0.8);
  static SINKHOLE = new DamageCategory('SINKHOLE', 'Hundimiento', 1.0);
  static MANHOLE = new DamageCategory('MANHOLE', 'Alcantarilla', 0.9);
  static SIGNAGE = new DamageCategory('SIGNAGE', 'Señalización', 0.5);
  static CRACK = new DamageCategory('CRACK', 'Grieta', 0.4);
  static OTHER = new DamageCategory('OTHER', 'Otro', 0.3);

  constructor(code, label, severity) {
    super(code, label);
    this.severity = severity;
    Object.freeze(this);
  }

  describe() {
    return { ...super.describe(), severity: this.severity };
  }
}
