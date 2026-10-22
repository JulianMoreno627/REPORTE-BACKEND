export class Clock {
  now() {
    return new Date();
  }
}

export class FixedClock extends Clock {
  #time;

  constructor(date = new Date()) {
    super();
    this.#time = new Date(date).getTime();
  }

  now() {
    return new Date(this.#time);
  }

  set(date) {
    this.#time = new Date(date).getTime();
  }

  advance(ms) {
    this.#time += ms;
  }
}
