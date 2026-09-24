// Invisible depth-only occluder for the real hand, in AR passthrough. Depth
// Sensing (WebXR's own real-world-mesh occlusion) is too coarse and noisy at
// hand distance to hide a virtual object cleanly behind moving fingers — see
// HAND-OCCLUSION.md. This instead draws the hand's own tracked skeleton with
// `colorWrite: false, depthWrite: true` geometry: nothing is drawn, but real
// depth is written, so anything virtual behind a real finger gets depth-tested
// away — the same trick Hole.ts already uses for the AR pit illusion, applied
// to a moving hand instead of a static hole.
//
// No hand model, no mesh asset — one shape, one InstancedPool, reused for
// both fingers AND the palm: fingers are one instance per bone (handBones.ts's
// BONES), the palm is two more "spokes" (wrist->index-metacarpal,
// wrist->pinky-metacarpal, the mjswan PR's own two-capsule palm
// approximation: https://github.com/ttktjmt/mjswan/pull/114), all built the
// same way (handBones.ts's boneMatrix). A CapsuleGeometry (three's own
// built-in, not the tapered lathe-profile shape an earlier version of this
// file hand-rolled — see HAND-OCCLUSION.md's ablation table: smaller AND a
// better measured overlap against a real reference hand). Fixed instance
// count (hands.length * (BONES.length + 2)), allocated once, matching this
// project's "at most N live objects, built once" convention; an untracked or
// invisible joint just zero-scales its instance for the frame.
import { CapsuleGeometry, Matrix4, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { XRHandSpace } from 'three';
import { InstancedPool } from '../rendering/InstancedPool';
import { ZERO_SCALE_MATRIX, IDENTITY_QUAT } from '../text/engines/voxel/constants';
import { ALL_JOINTS, BONES, boneMatrix } from './handBones';

const DEFAULT_RADIUS_m = 0.008; // three's own XRHandPrimitiveModel fallback, for a runtime that reports no joint radius

// Lower (more negative) draws EARLIER. Confirmed load-bearing, not cosmetic —
// and NOT a depth-test bug: depth test alone can't make a colorWrite:false
// occluder hide anything, no matter the draw order, because color and depth
// are separate buffers. If the target draws FIRST, it paints its color; the
// occluder drawing after it, even though closer and passing the depth test,
// only updates depth — colorWrite:false means it never touches color, so the
// target's pixels just sit there unhidden. Only if the occluder draws FIRST
// does this work: the target's own later draw then fails ITS depth test and
// never paints color at all. A colorWrite:false occluder can only ever
// prevent a draw, never undo one — so it must always draw before whatever it
// occludes, full stop, on every conforming implementation, no driver quirk
// involved. (A second, smaller reason the default order was wrong here: this
// project's InstancedPool computes its opaque-queue sort key from the mesh's
// own single identity-origin transform, not real per-instance positions, so
// a hand instance can't even rely on distance-based sorting to usually help.)
// Measured directly: with the default renderOrder (0), a hand placed in
// front of a live decoy left it fully visible; forcing a low renderOrder
// dropped a 39px patch of its color to 15 (matching ordinary coverage
// imprecision, not a remaining depth bug) — see tests/hand-occlusion-scene.spec.ts.
//
// Strictly BEFORE Hole.ts's own OCC_ORDER (-10), not equal to it: a real
// hand is the frontmost thing this game ever draws — closer to the camera
// than any virtual geometry, including Hole's own "solid table" trick — so
// it must win that tie outright, not leave it to the same unreliable
// same-renderOrder fallback sort that caused this in the first place.
const OCC_ORDER = -20;

export type HandOccluderOptions = {
  // Also draw a small, VISIBLE sphere at every tracked joint — for checking
  // this class's own alignment against the real (or emulated) hand, not part
  // of the occlusion effect itself (those spheres write color, not just
  // depth). Off by default. For a nicer-looking VISIBLE hand — a VR
  // self-avatar on a headset with no passthrough to occlude, e.g. Vision Pro
  // in VR mode — use three's own `XRHandModelFactory` instead of this flag:
  // it is built for exactly that job (see HAND-OCCLUSION.md), including a
  // realistic skinned hand loaded at runtime from a CDN, not shipped bytes.
  debug?: boolean;
};

const _a = new Vector3();
const _b = new Vector3();
const _debugScale = new Vector3();
const _debugMat = new Matrix4();

export class HandOccluder {
  #hands: XRHandSpace[];
  #bones: InstancedPool;     // fingers + the 2 palm spokes: hands.length * (BONES.length + 2)
  #boneIdx: number[] = [];
  #debug: InstancedPool | null = null; // optional: one visible sphere per joint per hand
  #debugIdx: number[] = [];
  #occluderMat: MeshBasicMaterial;

  constructor(scene: Object3D, hands: XRHandSpace[], options: HandOccluderOptions = {}) {
    this.#hands = hands;
    const occluderMat = new MeshBasicMaterial({ colorWrite: false });
    this.#occluderMat = occluderMat;

    const boneCount = hands.length * (BONES.length + 2); // +2 per hand: the two palm spokes
    this.#bones = new InstancedPool(scene, new CapsuleGeometry(1, 1, 2, 6), boneCount, occluderMat, OCC_ORDER);
    for (let i = 0; i < boneCount; i++) this.#boneIdx.push(this.#bones.allocate()!);

    if (options.debug) {
      const jointCount = hands.length * ALL_JOINTS.length;
      this.#debug = new InstancedPool(scene, new SphereGeometry(1, 6, 6), jointCount, new MeshBasicMaterial({ color: 0x00ff88 }));
      for (let i = 0; i < jointCount; i++) this.#debugIdx.push(this.#debug.allocate()!);
    }
  }

  // Call once per frame while an AR session is active with tracked hands.
  update(): void {
    let k = 0, d = 0;
    for (const hand of this.#hands) {
      for (const [nameA, nameB] of BONES) {
        const idx = this.#boneIdx[k++];
        const jointA = hand.joints[nameA];
        const jointB = hand.joints[nameB];
        if (!jointA || !jointB || !jointA.visible || !jointB.visible) { this.#bones.setMatrix(idx, ZERO_SCALE_MATRIX); continue; }
        jointA.getWorldPosition(_a);
        jointB.getWorldPosition(_b);
        const m = boneMatrix(_a, _b, jointA.jointRadius ?? DEFAULT_RADIUS_m, jointB.jointRadius ?? DEFAULT_RADIUS_m);
        this.#bones.setMatrix(idx, m ?? ZERO_SCALE_MATRIX);
      }

      // The palm: two more bones, not a bone-list entry, since they share one
      // endpoint (the wrist) instead of chaining.
      const wrist = hand.joints.wrist;
      const wristR = wrist?.jointRadius ?? DEFAULT_RADIUS_m;
      for (const mc of [hand.joints['index-finger-metacarpal'], hand.joints['pinky-finger-metacarpal']]) {
        const idx = this.#boneIdx[k++];
        if (!wrist?.visible || !mc?.visible) { this.#bones.setMatrix(idx, ZERO_SCALE_MATRIX); continue; }
        wrist.getWorldPosition(_a);
        mc.getWorldPosition(_b);
        const m = boneMatrix(_a, _b, wristR, mc.jointRadius ?? DEFAULT_RADIUS_m);
        this.#bones.setMatrix(idx, m ?? ZERO_SCALE_MATRIX);
      }

      if (this.#debug) {
        for (const name of ALL_JOINTS) {
          const idx = this.#debugIdx[d++];
          const joint = hand.joints[name];
          if (!joint?.visible) { this.#debug.setMatrix(idx, ZERO_SCALE_MATRIX); continue; }
          joint.getWorldPosition(_a);
          _debugScale.setScalar(joint.jointRadius ?? DEFAULT_RADIUS_m);
          this.#debug.setMatrix(idx, _debugMat.compose(_a, IDENTITY_QUAT, _debugScale));
        }
      }
    }
  }

  // Swaps the occluder material between its real behavior ('occlude':
  // colorWrite:false, invisible but writes depth), a visible color
  // ('visible': for seeing or measuring the occluder's own silhouette), or
  // fully inert ('off': neither writes color nor depth, so a ground-truth
  // hand model can be measured without this class's own depth interfering).
  // 'visible' is reachable two ways: HAND-OCCLUSION.md's __DEV__-only
  // comparison tool, and Game.ts's always-shipped `?occluder=visible` query
  // flag — the latter is the one real-device check, since __DEV__ code folds
  // away in production and never reaches a real build.
  setDebugMaterial(mode: 'occlude' | 'visible' | 'off', color = 0x00ffff): void {
    if (mode === 'occlude') { this.#occluderMat.colorWrite = false; this.#occluderMat.depthWrite = true; }
    else if (mode === 'visible') { this.#occluderMat.colorWrite = true; this.#occluderMat.depthWrite = true; this.#occluderMat.color.setHex(color); }
    else { this.#occluderMat.colorWrite = false; this.#occluderMat.depthWrite = false; }
  }

  dispose(): void {
    this.#bones.dispose();
    this.#debug?.dispose();
  }
}
