// The socket grid: two cross clusters of four holes. Layout only — it imports
// Hole and places eight of them; it knows nothing of their geometry or materials.
import type { Object3D } from 'three';
import { Hole } from './Hole';

// Two crosses (Left/Up/Right/Down each), centered at ±CROSS_CENTER_X_m — easy taps,
// and maps onto a gamepad d-pad + face buttons if a pad fallback is ever added.
const CROSS_CENTER_X_m = 0.28;
const CROSS_ARM_m = 0.13;
const ARMS = [
  [-CROSS_ARM_m, 0], [CROSS_ARM_m, 0], [0, -CROSS_ARM_m], [0, CROSS_ARM_m]
] as const;

export class Gameboard {
  #holes: Hole[] = [];

  constructor(root: Object3D) {
    for (const cx of [-CROSS_CENTER_X_m, CROSS_CENTER_X_m]) {
      for (const [dx, dz] of ARMS) {
        this.#holes.push(new Hole(root, cx + dx, dz));
      }
    }
  }

  get holeCount(): number { return this.#holes.length; }
  holeAt(i: number): Hole { return this.#holes[i]; }

  freeHoles(): number[] {
    const free: number[] = [];
    this.#holes.forEach((h, i) => { if (h.free) free.push(i); });
    return free;
  }

  reset(): void {
    for (const h of this.#holes) h.free = true;
  }

  // Currently unreachable — see Hole.dispose()'s own comment.
  dispose(): void {
    for (const h of this.#holes) h.dispose();
  }
}
