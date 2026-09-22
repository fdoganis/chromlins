// Invisible depth-only occluder for the real hand, in AR passthrough. Depth
// Sensing (WebXR's own real-world-mesh occlusion) is too coarse and noisy at
// hand distance to hide a virtual object cleanly behind moving fingers — see
// HAND-OCCLUSION.md. This instead draws the hand's own tracked skeleton with
// `colorWrite: false, depthWrite: true` geometry: nothing is drawn, but real
// depth is written, so anything virtual behind a real finger gets depth-tested
// away — the same trick Hole.ts already uses for the AR pit illusion, applied
// to a moving hand instead of a static hole.
//
// Three kinds of shape, none of them a hand model or mesh asset:
// - fingers: one instance per bone (handBones.ts's BONES) of a shared
//   "phalanx" lathe shape, non-uniformly scaled per bone (handBones.ts's
//   boneMatrix). Technique and profile-arc math are prisoner849's (three.js
//   forum, CC BY-SA): https://codepen.io/prisoner849/pen/qBaNKNM — adapted
//   here from an animated finger-bend demo to a real WebXR hand skeleton.
// - forearm: one more instance of the SAME phalanx shape per hand, from
//   the wrist along a guessed direction+length (handBones.ts's
//   forearmMatrix) — the WebXR hand skeleton has no forearm joints at all.
// - palm: a separate flat box per hand (handBones.ts's palmPlateMatrix),
//   spanning wrist/index-metacarpal/pinky-metacarpal, replacing an earlier
//   version's five wrist-to-metacarpal spokes (thin lines with real gaps
//   between them — see HAND-OCCLUSION.md).
//
// Every instance comes from the project's existing InstancedPool (the same
// allocator Sparkles/VoxelTextEngine use): fixed count, allocated once, held
// for the occluder's lifetime, matching this project's "at most N live
// objects, built once" convention.
import { BoxGeometry, LatheGeometry, Matrix4, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3, Path } from 'three';
import type { Object3D } from 'three';
import type { XRHandSpace } from 'three';
import { InstancedPool } from '../rendering/InstancedPool';
import { ZERO_SCALE_MATRIX } from '../text/engines/voxel/constants';
import { ALL_JOINTS, BONES, boneMatrix, forearmMatrix, palmPlateMatrix } from './handBones';

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
const _c = new Vector3();
const _quat = new Quaternion();
const IDENTITY = new Quaternion(); // a joint marker sphere is rotation-invariant, so debug instances never need to rotate
const _debugScale = new Vector3();
const _debugMat = new Matrix4();

export class HandOccluder {
  #hands: XRHandSpace[];
  #bones: InstancedPool;     // fingers + forearm: hands.length * (BONES.length + 1)
  #boneIdx: number[] = [];
  #palm: InstancedPool;      // one flat plate per hand
  #palmIdx: number[] = [];
  #debug: InstancedPool | null = null; // optional: one visible sphere per joint per hand
  #debugIdx: number[] = [];
  #occluderMat: MeshBasicMaterial;

  constructor(scene: Object3D, hands: XRHandSpace[], options: HandOccluderOptions = {}) {
    this.#hands = hands;
    const occluderMat = new MeshBasicMaterial({ colorWrite: false });
    this.#occluderMat = occluderMat;

    const boneCount = hands.length * (BONES.length + 1); // +1 per hand: the guessed forearm segment
    this.#bones = new InstancedPool(scene, createPhalanxGeometry(), boneCount, occluderMat);
    for (let i = 0; i < boneCount; i++) this.#boneIdx.push(this.#bones.allocate()!);

    this.#palm = new InstancedPool(scene, new BoxGeometry(1, 1, 1), hands.length, occluderMat);
    for (let i = 0; i < hands.length; i++) this.#palmIdx.push(this.#palm.allocate()!);

    if (options.debug) {
      const jointCount = hands.length * ALL_JOINTS.length;
      this.#debug = new InstancedPool(scene, new SphereGeometry(1, 6, 6), jointCount, new MeshBasicMaterial({ color: 0x00ff88 }));
      for (let i = 0; i < jointCount; i++) this.#debugIdx.push(this.#debug.allocate()!);
    }
  }

  // Call once per frame while an AR session is active with tracked hands.
  update(): void {
    let k = 0, p = 0, d = 0;
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

      const wrist = hand.joints.wrist;
      const indexMc = hand.joints['index-finger-metacarpal'];
      const pinkyMc = hand.joints['pinky-finger-metacarpal'];

      const forearmIdx = this.#boneIdx[k++];
      if (wrist?.visible) {
        wrist.getWorldPosition(_a);
        wrist.getWorldQuaternion(_quat);
        const m = forearmMatrix(_a, _quat, wrist.jointRadius ?? DEFAULT_RADIUS_m);
        this.#bones.setMatrix(forearmIdx, m ?? ZERO_SCALE_MATRIX);
      } else {
        this.#bones.setMatrix(forearmIdx, ZERO_SCALE_MATRIX);
      }

      const palmIdx = this.#palmIdx[p++];
      if (wrist?.visible && indexMc?.visible && pinkyMc?.visible) {
        wrist.getWorldPosition(_a);
        indexMc.getWorldPosition(_b);
        pinkyMc.getWorldPosition(_c);
        const m = palmPlateMatrix(_a, _b, _c);
        this.#palm.setMatrix(palmIdx, m ?? ZERO_SCALE_MATRIX);
      } else {
        this.#palm.setMatrix(palmIdx, ZERO_SCALE_MATRIX);
      }

      if (this.#debug) {
        for (const name of ALL_JOINTS) {
          const idx = this.#debugIdx[d++];
          const joint = hand.joints[name];
          if (!joint?.visible) { this.#debug.setMatrix(idx, ZERO_SCALE_MATRIX); continue; }
          joint.getWorldPosition(_a);
          _debugScale.setScalar(joint.jointRadius ?? DEFAULT_RADIUS_m);
          this.#debug.setMatrix(idx, _debugMat.compose(_a, IDENTITY, _debugScale));
        }
      }
    }
  }

  // Debug/measurement only — never called in production. Swaps the occluder
  // material (shared by the finger/forearm bones and the palm plate) between
  // its real behavior ('occlude': colorWrite:false, invisible but writes
  // depth), a visible color ('visible': for seeing or measuring the
  // occluder's own silhouette), or fully inert ('off': neither writes color
  // nor depth, so a ground-truth hand model can be measured without this
  // class's own depth interfering). See HAND-OCCLUSION.md's comparison tool.
  setDebugMaterial(mode: 'occlude' | 'visible' | 'off', color = 0x00ffff): void {
    if (mode === 'occlude') { this.#occluderMat.colorWrite = false; this.#occluderMat.depthWrite = true; }
    else if (mode === 'visible') { this.#occluderMat.colorWrite = true; this.#occluderMat.depthWrite = true; this.#occluderMat.color.setHex(color); }
    else { this.#occluderMat.colorWrite = false; this.#occluderMat.depthWrite = false; }
  }

  dispose(): void {
    this.#bones.dispose();
    this.#palm.dispose();
    this.#debug?.dispose();
  }
}
