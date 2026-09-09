// One body that rises from a Hole, holds, then sinks back — the shared capsule
// and the rise/hold/sink machine. Built once and reused: show() raises it from a
// hole, hide() puts it away, so nothing is allocated per appearance. Subclasses
// (Chromlin, Unicorn) build their own trim in their constructor and animate it
// in animate().
import { Mesh, MeshPhongMaterial, CapsuleGeometry, MathUtils } from 'three';
import type { Object3D, Vector3 } from 'three';
import { easeOutCubic } from '../animation/Easing';
import type { Hole } from './Hole';

export const BODY_R_m = 0.045;
const BODY_LEN_m = 0.11;                              // capsule mid-section
export const BODY_HALF_m = BODY_R_m + BODY_LEN_m / 2; // 0.10 — half the total height
const HIDDEN_Y_m = -0.17; // centre: the whole body is below the rim, inside the pit
const PEEK_Y_m = -0.01;   // centre: ~half the body clears the rim — it stays rooted in the hole
const RISE_S = 0.25;
const SINK_S = 0.22;

type Phase = 'rising' | 'holding' | 'sinking';

export abstract class Actor {
  static readonly GEO = new CapsuleGeometry(BODY_R_m, BODY_LEN_m, 4, 12); // shared by every body

  readonly mesh: Mesh<CapsuleGeometry, MeshPhongMaterial>;
  decoy = false; // Unicorn sets true — a tap never removes it, an unhit sink isn't a miss
  tag = -1;      // opaque caller id (RunState: rainbow colour index)

  #hole: Hole | null = null;
  #phase: Phase = 'rising';
  #phaseT = 0;
  #hold = 0;

  constructor(root: Object3D) {
    this.mesh = new Mesh(Actor.GEO, new MeshPhongMaterial({ shininess: 40 }));
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    root.add(this.mesh);
  }

  get active(): boolean { return this.mesh.visible; }
  get position(): Vector3 { return this.mesh.position; }

  // A soft self-glow: emit ~16% of the body colour → a cheap "lit from within".
  recolor(hex: string): void {
    const m = this.mesh.material;
    m.color.set(hex);
    m.emissive.copy(m.color).multiplyScalar(0.16);
  }

  show(hole: Hole, hex: string, hold: number, tag: number): void {
    this.#hole = hole;
    hole.free = false;
    this.tag = tag;
    this.recolor(hex);
    this.mesh.position.set(hole.x, HIDDEN_Y_m, hole.z);
    this.mesh.visible = true;
    this.mesh.updateWorldMatrix(true, false); // same-frame world pose for callers
    this.#phase = 'rising';
    this.#phaseT = 0;
    this.#hold = hold;
  }

  hide(): void {
    this.mesh.visible = false;
    if (this.#hole) { this.#hole.free = true; this.#hole = null; }
  }

  // Advances one frame. Returns true the frame it finishes sinking unhit — the
  // manager turns that into a "miss" for a Chromlin, ignores it for the decoy.
  update(delta: number, camPos: Vector3): boolean {
    this.#phaseT += delta;
    const prevY = this.mesh.position.y;

    if (this.#phase === 'rising') {
      const k = Math.min(this.#phaseT / RISE_S, 1);
      this.mesh.position.y = MathUtils.lerp(HIDDEN_Y_m, PEEK_Y_m, easeOutCubic(k));
      if (k >= 1) { this.#phase = 'holding'; this.#phaseT = 0; }
    } else if (this.#phase === 'holding') {
      if (this.#phaseT >= this.#hold) { this.#phase = 'sinking'; this.#phaseT = 0; }
    } else {
      const k = Math.min(this.#phaseT / SINK_S, 1);
      this.mesh.position.y = MathUtils.lerp(PEEK_Y_m, HIDDEN_Y_m, easeOutCubic(k));
      if (k >= 1) { this.hide(); return true; }
    }

    this.animate(delta, (this.mesh.position.y - prevY) / delta, camPos);
    return false;
  }

  // Per-frame trim animation (eyes / mane). ySpeed is the body's vertical
  // velocity this frame. Called by update() and directly by the cinematic.
  abstract animate(delta: number, ySpeed: number, camPos: Vector3): void;
}
