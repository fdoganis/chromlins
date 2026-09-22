// Pure hand-skeleton geometry: no InstancedPool, no scene, no WebXR session —
// only `three`'s math classes, so this is plain-Node testable
// (tests/unit/hand-occluder.test.mjs) without going through Vite's resolver
// the way the rest of src/ (extensionless imports) needs. HandOccluder.ts is
// the WebXR/rendering side that consumes this.
//
// An earlier version of this file also had a forearm segment (a guessed
// extension past the wrist — WebXR's hand skeleton has no forearm joints at
// all) and a flat box "palm plate" (spanning wrist/index-metacarpal/
// pinky-metacarpal via its own basis-matrix construction). Both were measured
// against three's own ground-truth hand mesh (tests/hand-occlusion.spec.ts)
// and dropped: the forearm cost real bytes for a segment the reference model
// can't even validate (it has no forearm either) and measurably hurt the
// overlap score (IoU 0.749 with it, 0.982 without, same run); the box plate
// cost ~90-135 B more than two extra `boneMatrix` "spokes" reusing this exact
// function and HandOccluder's existing pool, for the same coverage. See
// HAND-OCCLUSION.md for the full ablation table.
import { Matrix4, Quaternion, Vector3 } from 'three';

// Not imported from text/engines/voxel/constants.ts's own shared UP: that
// import is extensionless (this project's own-source-file convention), which
// only Vite's resolver can follow — this file's whole point is staying
// plain-Node testable (tests/unit/hand-occluder.test.mjs) with no local
// imports of its own. A one-line duplicate, same as Unicorn.ts's and
// AnchorState.ts's own local copies of this exact constant.
const UP = new Vector3(0, 1, 0);

// The 25 WebXR hand joints, chained finger-by-finger — same names and order
// three.js's own XRHandPrimitiveModel uses. Finger segments only: the palm is
// two extra "spokes" HandOccluder builds itself (wrist -> index-metacarpal,
// wrist -> pinky-metacarpal) by calling boneMatrix directly, not a bone here.
const CHAINS: XRHandJoint[][] = [
  ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ['wrist', 'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  ['wrist', 'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ['wrist', 'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  ['wrist', 'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
];
export const BONES: Array<[XRHandJoint, XRHandJoint]> = CHAINS.flatMap((chain) => {
  const finger = chain.slice(1); // drop 'wrist' — the palm's own two spokes cover that segment instead
  return finger.slice(0, -1).map((a, i): [XRHandJoint, XRHandJoint] => [a, finger[i + 1]]);
});

// All 25 joints, wrist first, then finger-by-finger — for a debug view that
// draws every joint individually (HandOccluder's optional `debug` mode),
// distinct from BONES (finger segments).
export const ALL_JOINTS: XRHandJoint[] = ['wrist', ...new Set(CHAINS.flatMap((c) => c.slice(1)))];

const _mid = new Vector3();
const _dir = new Vector3();
const _scale = new Vector3();
const _quat = new Quaternion();
const _mat = new Matrix4();

// Given two joint world positions and radii, the instance matrix that places,
// orients (local +Y along a->b) and scales a unit (radius 1, length 1) shape
// to span them — or null if the two points are coincident (nothing to draw).
// Reuses one scratch Matrix4/Vector3/Quaternion set per call, like the rest of
// this codebase's hot paths; the returned Matrix4 is only valid until the next
// call. Also how HandOccluder builds the two palm "spokes" (see the file
// comment above) — not just finger bones.
export function boneMatrix(a: Vector3, b: Vector3, radiusA: number, radiusB: number): Matrix4 | null {
  const length = a.distanceTo(b);
  if (length < 1e-5) return null;
  _mid.copy(a).add(b).multiplyScalar(0.5);
  _dir.copy(b).sub(a).normalize();
  _quat.setFromUnitVectors(UP, _dir);
  _scale.set((radiusA + radiusB) / 2, length, (radiusA + radiusB) / 2);
  return _mat.compose(_mid, _quat, _scale);
}
