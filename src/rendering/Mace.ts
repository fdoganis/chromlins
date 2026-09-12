// A cylinder parented to an XR controller's node — pure affordance/juice, no
// gameplay effect (.doc/GNOMES.md §16). Swings on every `select` from that
// controller so a trigger pull reads as a little hit, not just a silent ray.
import { Mesh, CylinderGeometry, MeshPhongMaterial } from 'three';
import type { Group } from 'three';

const GEO = new CylinderGeometry(0.012, 0.022, 0.14, 8);
const MAT = new MeshPhongMaterial({ color: 0x8a8a90 });
const SWING_S = 0.18;

export class Mace {
  #mesh: Mesh;
  #t = SWING_S; // at rest

  constructor(controller: Group) {
    this.#mesh = new Mesh(GEO, MAT);
    this.#mesh.position.set(0, -0.01, -0.09); // hangs forward from the grip, along the aim ray
    this.#mesh.rotation.x = Math.PI / 2;
    controller.add(this.#mesh);
  }

  swing(): void { this.#t = 0; }

  update(delta: number): void {
    if (this.#t >= SWING_S) return;
    this.#t = Math.min(SWING_S, this.#t + delta);
    const p = this.#t / SWING_S;
    this.#mesh.rotation.x = Math.PI / 2 - Math.sin(p * Math.PI) * 0.9; // quick downward chop and back
  }
}
