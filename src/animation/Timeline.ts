// A one-shot beat sequencer for scripted sequences (the intro / win cinematics).
// Give it a list of { at, fn }; tick(dt) fires every beat whose time has passed,
// in order, once. Per-frame motion (bobs, rises, scale-ins) is done by the
// caller as a function of `time` — this only handles the discrete triggers.
export type Beat = { at: number; fn: () => void };

export class Timeline {
  #beats: Beat[];
  #t = 0;
  #i = 0;

  constructor(beats: Beat[]) {
    this.#beats = beats.slice().sort((a, b) => a.at - b.at);
  }

  get time(): number { return this.#t; }
  get done(): boolean { return this.#i >= this.#beats.length; }

  tick(dt: number): void {
    this.#t += dt;
    while (this.#i < this.#beats.length && this.#beats[this.#i].at <= this.#t) {
      this.#beats[this.#i++].fn();
    }
  }
}
