import { Enumeration } from './Enumeration.js';

export class RoadType extends Enumeration {
  static displayName = 'Tipo de vía';

  static PRIMARY = new RoadType('PRIMARY', 'Vía principal', 1.0);
  static SECONDARY = new RoadType('SECONDARY', 'Vía secundaria', 0.6);
  static RESIDENTIAL = new RoadType('RESIDENTIAL', 'Vía local / residencial', 0.3);

  constructor(code, label, weight) {
    super(code, label);
    this.weight = weight;
    Object.freeze(this);
  }

  describe() {
    return { ...super.describe(), weight: this.weight };
  }
}
