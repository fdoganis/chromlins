// A socket in the gameboard: a position + a self-contained AR "hole" - a
// tight, deep invisible depth-only occluder cylinder wrapped around a dark
// visible pit. It does not know or care what rises out of it - that is the
// Actors system's job.
//
// The occluder is what sells the illusion in passthrough AR: it writes depth
// across the "table", so anything below the surface (outside a hole) is hidden.
// It writes no color. On desktop / the WebXR emulator there is no real table,
// so the holes read as dark shapes in a void - that is expected.
//
// Simplified from an earlier 5-piece design (a flat brim ring + a shallower
// crown skirt + a base disc capping the bottom, wrapped around the same pit):
// this occluder is deep enough (2x the visible pit's own depth) that no
// realistic viewing angle ever sees past its open bottom end, so the base cap
// is unnecessary; the brim's wide reach (overlapping between adjacent holes)
// was never verified as load-bearing (see .doc/SIZE-AUDIT.md) and a live
// comparison (tests/hole-occluder-simplification.spec.ts) found no visible
// gap without it, at a normal angle or a lower one across the whole board.
// Real device passthrough at a steep raking angle, and the shadow-catcher
// plane's own stencil cutout (RenderingManager.ts) at the mouth, are not
// covered by that test, worth checking on-device before trusting this
// beyond an emulator screenshot.
import {
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  CylinderGeometry,
  CircleGeometry,
  BackSide,
  DoubleSide,
  ReplaceStencilOp
} from 'three';
import type { Object3D } from 'three';

// --- fixed dimensions (module-private: Gameboard just places holes) ---
const HOLE_R_m = 0.055;    // visible pit opening radius
const OCC_R_m = 0.06;      // occluder radius, strictly outside the pit, no z-fight
const PIT_DEPTH_m = 0.28;  // deep enough for a full-height body (~0.20) to vanish with travel room
const OCC_DEPTH_m = PIT_DEPTH_m * 2; // deep enough that no realistic angle sees its open bottom end
const PIT_WALL = 0x3a3a46; // lit dark-grey wall, the rim catches light, deeper falls off, reads as a volume

// --- shared resources (built once, referenced by every Hole) ---
// Not disposed: they live for the page lifetime, which matches the rest of the
// codebase - Game is created once in main.ts and never torn down.
const OCC_GEO = new CylinderGeometry(OCC_R_m, OCC_R_m, OCC_DEPTH_m, 24, 1, true);
const PIT_GEO = new CylinderGeometry(HOLE_R_m, HOLE_R_m, PIT_DEPTH_m, 24, 1, true);
const MOUTH_GEO = new CircleGeometry(HOLE_R_m, 24).rotateX(-Math.PI / 2); // exactly the visible opening

const OCC_MAT = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
const PIT_MAT = new MeshPhongMaterial({ color: PIT_WALL, emissive: 0x141418, side: BackSide, shininess: 6 }); // lit, rim-to-floor gradient, never full black
// Marks the true opening in the stencil buffer only (no color/depth write) so
// RenderingManager's shadow-catcher plane, which knows nothing about holes
// and sits nearer than everything in the pit, can be told to skip drawing
// there. Without this the catcher always wins the depth test at the opening
// and caps it with a translucent disc wherever a shadow crosses (looks like
// glass over the hole).
const MOUTH_MAT = new MeshBasicMaterial({
  colorWrite: false, depthWrite: false, depthTest: false,
  stencilWrite: true, stencilRef: 1, stencilZPass: ReplaceStencilOp
});

const OCC_ORDER = -10; // depth laid down before the actors (default order)
const PIT_ORDER = -5;  // dark wall fills the opening, after the occluder

export class Hole {
  readonly x: number;
  readonly z: number;
  free = true;

  #root: Object3D;
  #fixtures: Mesh[];

  constructor(root: Object3D, x: number, z: number) {
    this.#root = root;
    this.x = x;
    this.z = z;

    const occ = new Mesh(OCC_GEO, OCC_MAT);
    occ.position.set(x, -OCC_DEPTH_m / 2, z);
    occ.renderOrder = OCC_ORDER;

    const pit = new Mesh(PIT_GEO, PIT_MAT);
    pit.position.set(x, -PIT_DEPTH_m / 2, z);
    pit.receiveShadow = true;
    pit.renderOrder = PIT_ORDER;

    const mouth = new Mesh(MOUTH_GEO, MOUTH_MAT);
    mouth.position.set(x, 0, z);
    mouth.renderOrder = OCC_ORDER;

    this.#fixtures = [occ, pit, mouth];
    root.add(...this.#fixtures);
  }

  // Currently unreachable (nothing tears down a whole Game instance today),
  // but correct: only detaches this hole's own meshes from the scene, the
  // shared geometries/materials above are a deliberate page-lifetime static,
  // never freed here (see the comment on them).
  dispose(): void {
    for (const f of this.#fixtures) this.#root.remove(f);
  }
}
