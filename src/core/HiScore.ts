// The all-time best score + its 3-letter name, in localStorage. Owned by Game,
// shown in the HUD, written by NameEntryState. Mirrors Score / Level.
const KEY = 'chromlins.hi';

export class HiScore {
  #score = 0;
  #name = 'AAA';

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const [s, n] = raw.split(' ');
        this.#score = +s || 0;
        if (n) this.#name = n;
      }
    } catch {
      // private mode / storage disabled — start from zero, never persist
    }
  }

  get score(): number { return this.#score; }
  get name(): string { return this.#name; }

  beaten(n: number): boolean { return n > this.#score; }

  submit(n: number, name: string): void {
    if (n <= this.#score) return;
    this.#score = n;
    this.#name = name;
    try { localStorage.setItem(KEY, `${n} ${name}`); } catch { /* not persisted */ }
  }
}
