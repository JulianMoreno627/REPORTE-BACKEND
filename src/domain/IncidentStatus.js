import { Enumeration } from './Enumeration.js';

export class IncidentStatus extends Enumeration {
  static displayName = 'Estado';

  static REPORTED = new IncidentStatus('REPORTED', 'Reportado', ['IN_REVIEW', 'REJECTED']);
  static IN_REVIEW = new IncidentStatus('IN_REVIEW', 'En revisión', ['IN_REPAIR', 'REJECTED']);
  static IN_REPAIR = new IncidentStatus('IN_REPAIR', 'En reparación', ['RESOLVED']);
  static RESOLVED = new IncidentStatus('RESOLVED', 'Resuelto', []);
  static REJECTED = new IncidentStatus('REJECTED', 'Descartado', []);

  #next;

  constructor(code, label, next) {
    super(code, label);
    this.#next = next;
    Object.freeze(this);
  }

  get isFinal() { return this.#next.length === 0; }
  get isOpen() { return !this.isFinal; }

  get nextStatuses() {
    return this.#next.map((code) => IncidentStatus.from(code));
  }

  canTransitionTo(status) {
    return this.#next.includes(IncidentStatus.from(status).code);
  }

  describe() {
    return { ...super.describe(), isFinal: this.isFinal, next: [...this.#next] };
  }
}
