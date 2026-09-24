// A socket in the gameboard: a position + a self-contained AR "hole" - an
// invisible depth-only occluder (a flat brim ring at the surface plus a
// crown skirt down the sides) wrapped around a dark visible pit. It does not
// know or care what rises out of it - that is the Actors system's job.
//
// The occluder is what sells the illusion in passthrough AR: it writes depth
// across the "table", so anything below the surface (outside a hole) is hidden.
// It writes no color. On desktop / the WebXR emulator there is no real table,
// so the holes read as dark shapes in a void - that is expected.
//
// Settled after a real device test cycle. Three things were tried and
// reverted, kept here as the reasoning trail:
//  1. Dropping the brim's stencil-protected mouth entirely, relying only on
//     the brim/crown's own depth: real bug on device (the shadow-catcher
//     still showed its shadow right over a hole's opening).
//  2. Lifting the brim above the catcher plane (y>0, not y<0) so it would
//     WIN the depth test there instead of losing it: still didn't fix the
//     opening (a stencil-independent depth race was never the actual
//     mechanism protecting it - see MOUTH_MAT below), and broke something
//     that DID work before: with the brim closer than the catcher, the
//     catcher's own shadow could no longer be drawn anywhere in the brim's
//     ring either, not just at the opening. The brim was never meant to win
//     that depth test - sitting slightly BELOW the catcher (its original,
//     restored position) is deliberate, so the catcher keeps showing real
//     shadows normally across the brim's ring, exactly as intended.
//  3. Only the base disc (closing the bottom of the crown) and the pit's own
//     separate floor disc turned out to be safely removable: the crown is
//     now deep enough (2x the visible pit's own depth) that no realistic
//     angle sees past its open bottom end, and the pit's own closed cap
//     (free: PIT_MAT is BackSide, real GPU face culling, so looking down
//     into the hole this cap is always the culled side) already reads as a
//     floor without a separate disc/material for it.
// The one real, confirmed saving beyond that: BRIM_R_m no longer needs the
// original wide, cross-arm-spanning reach (0.13, sized to overlap between
// adjacent holes) - a much smaller ring (2*OCC_R_m - HOLE_R_m) tested clean
// on device, since nothing showed the wide reach was ever load-bearing.
import {
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  CylinderGeometry,
  CircleGeometry,
  RingGeometry,
  BackSide,
  DoubleSide,
  ReplaceStencilOp
} from 'three';
import type { Object3D } from 'three';

// --- fixed dimensions (module-private: Gameboard just places holes) ---
const HOLE_R_m = 0.055;    // visible pit opening radius
const OCC_R_m = 0.06;      // crown radius, strictly outside the pit, no z-fight
const BRIM_R_m = OCC_R_m + (OCC_R_m - HOLE_R_m); // one more OCC_R_m-HOLE_R_m step beyond the crown - tested clean on device; the original 0.13 board-wide reach was never shown to be load-bearing
const PIT_DEPTH_m = 0.28;  // deep enough for a full-height body (~0.20) to vanish with travel room
const OCC_DEPTH_m = PIT_DEPTH_m * 2; // deep enough that no realistic angle sees its open bottom end
const PIT_WALL = 0x3a3a46; // lit dark-grey wall, the rim catches light, deeper falls off, reads as a volume

// --- shared resources (built once, referenced by every Hole) ---
// Not disposed: they live for the page lifetime, which matches the rest of the
// codebase - Game is created once in main.ts and never torn down.
//
// All four (BRIM_GEO, OCC_GEO, PIT_GEO, MOUTH_GEO below) share edges at the
// same radii (BRIM_GEO's inner edge = HOLE_R_m = PIT_GEO's own radius =
// MOUTH_GEO's own radius; BRIM_GEO's outer-adjacent boundary lines up with
// OCC_GEO at OCC_R_m), so they're all harmonized to the same 32 radial
// segments - a circle approximated with a different vertex count doesn't
// line up exactly with another circle of the same radius approximated
// differently, meeting edge-to-edge as polygons of different facet counts
// instead of a true circular seam otherwise. 32 is also CylinderGeometry's
// own default, which is why PIT_GEO below omits it entirely.
const BRIM_GEO = new RingGeometry(HOLE_R_m, BRIM_R_m, 32).rotateX(-Math.PI / 2);
const OCC_GEO = new CylinderGeometry(OCC_R_m, OCC_R_m, OCC_DEPTH_m, 32, 1, true);
// PIT_GEO is closed (openEnded left at its default, false): PIT_MAT is
// BackSide, real GPU face culling (confirmed in three's own WebGLState.js),
// so looking down into the hole, the pit's own top cap is always the culled
// side, and closing it is free either way (shorter than spelling out the
// same segment count plus an explicit openEnded:true).
const PIT_GEO = new CylinderGeometry(HOLE_R_m, HOLE_R_m, PIT_DEPTH_m);

const OCC_MAT = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide });
const PIT_MAT = new MeshPhongMaterial({ color: PIT_WALL, emissive: 0x141418, side: BackSide, shininess: 6 }); // lit, rim-to-floor gradient, never full black
// Marks the true opening in the stencil buffer only (no color/depth write) so
// RenderingManager's shadow-catcher plane, which knows nothing about holes
// and sits nearer than everything in the pit, can be told to skip drawing
// there. Without this the catcher always wins the depth test at the opening
// and caps it with a translucent disc wherever a shadow crosses (looks like
// glass over the hole) - confirmed for real, twice, trying to drop this.
const MOUTH_MAT = new MeshBasicMaterial({
  colorWrite: false, depthWrite: false, depthTest: false,
  stencilWrite: true, stencilRef: 1, stencilZPass: ReplaceStencilOp
});
const MOUTH_GEO = new CircleGeometry(HOLE_R_m, 32).rotateX(-Math.PI / 2); // exactly the visible opening

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

    const brim = new Mesh(BRIM_GEO, OCC_MAT);
    brim.position.set(x, -0.002, z); // just under the shadow-catcher plane - no z-fight, and deliberately BELOW it, not above (see the file comment)
    brim.renderOrder = OCC_ORDER;

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

    this.#fixtures = [brim, occ, pit, mouth];
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
