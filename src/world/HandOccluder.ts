// Invisible depth-only occluder for the real hand, in AR passthrough. Depth
// Sensing (WebXR's own real-world-mesh occlusion) is too coarse and noisy at
// hand distance to hide a virtual object cleanly behind moving fingers — see
// HAND-OCCLUSION.md. This instead draws the hand's own tracked skeleton with
// `colorWrite: false, depthWrite: true` geometry: nothing is drawn, but real
// depth is written, so anything virtual behind a real finger gets depth-tested
// away — the same trick Hole.ts already uses for the AR pit illusion, applied
// to a moving hand instead of a static hole.
//
// No hand model, no hand mesh asset: each bone (the segment between two
// adjacent XRHand joints, see handBones.ts's BONES) is one instance of a
// single shared "phalanx" lathe shape (createPhalanxGeometry below),
// non-uniformly scaled per bone from that bone's own two joint radii and
// length (handBones.ts's boneMatrix). Technique and the profile-arc math are
// prisoner849's (three.js forum, CC BY-SA):
// https://codepen.io/prisoner849/pen/qBaNKNM — adapted here from an animated
// finger-bend demo to a real WebXR hand skeleton, one InstancedMesh via the
// project's existing InstancedPool (matches HAND-OCCLUSION.md's build-once,
// fixed-count convention: exactly BONES_PER_HAND * hands.length instances,
// allocated once, never freed for the object's lifetime, same as Sparkles).
import { LatheGeometry, MeshBasicMaterial, Vector3, Path } from 'three';
import type { Object3D } from 'three';
import type { XRHandSpace } from 'three';
import { InstancedPool } from '../rendering/InstancedPool';
import { ZERO_SCALE_MATRIX } from '../text/engines/voxel/constants';
import { BONES, boneMatrix } from './handBones';

const DEFAULT_RADIUS_m = 0.008; // three's own XRHandPrimitiveModel fallback, for a runtime that reports no joint radius

// One shared "phalanx": a lathed capsule-like solid, base radius 1 tapering to
// 0.85 at the tip, both ends rounded. Built once at module load (no per-frame
// or per-instance geometry). Scaled non-uniformly per bone below (radius via
// x/z, length via y) — that distorts the taper/cap curvature at extreme aspect
// ratios, invisible on a colorWrite:false occluder so not worth a distinct
// geometry per bone to avoid.
function createPhalanxGeometry(): LatheGeometry {
  const R = 1, L = 1, r = R * 0.85;
  const a = Math.asin((R - r) / L);
  const path = new Path();
  path.absarc(0, 0, R, Math.PI * 1.5, a, false);
  path.absarc(0, L, r, a, Math.PI * 0.5, false);
  return new LatheGeometry(path.getPoints(5), 6); // 6 radial segments: invisible, cheap
}

const _a = new Vector3();
const _b = new Vector3();

export class HandOccluder {
  #pool: InstancedPool;
  #hands: XRHandSpace[];
  #indices: number[] = [];

  constructor(scene: Object3D, hands: XRHandSpace[]) {
    this.#hands = hands;
    const material = new MeshBasicMaterial({ colorWrite: false });
    this.#pool = new InstancedPool(scene, createPhalanxGeometry(), hands.length * BONES.length, material);
    for (let i = 0; i < hands.length * BONES.length; i++) this.#indices.push(this.#pool.allocate()!); // fixed budget, held for the occluder's lifetime
  }

  // Call once per frame while an AR session is active with tracked hands.
  update(): void {
    let k = 0;
    for (const hand of this.#hands) {
      for (const [nameA, nameB] of BONES) {
        const idx = this.#indices[k++];
        const jointA = hand.joints[nameA];
        const jointB = hand.joints[nameB];
        if (!jointA || !jointB || !jointA.visible || !jointB.visible) {
          this.#pool.setMatrix(idx, ZERO_SCALE_MATRIX);
          continue;
        }
        jointA.getWorldPosition(_a);
        jointB.getWorldPosition(_b);
        const m = boneMatrix(_a, _b, jointA.jointRadius ?? DEFAULT_RADIUS_m, jointB.jointRadius ?? DEFAULT_RADIUS_m);
        this.#pool.setMatrix(idx, m ?? ZERO_SCALE_MATRIX); // coincident joints (m === null): nothing to draw this frame
      }
    }
  }

  dispose(): void {
    this.#pool.dispose();
  }
}
