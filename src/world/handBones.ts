// Pure hand-skeleton geometry: no InstancedPool, no scene, no WebXR session —
// only `three`'s math classes, so this is plain-Node testable
// (tests/unit/hand-occluder.test.mjs) without going through Vite's resolver
// the way the rest of src/ (extensionless imports) needs. HandOccluder.ts is
// the WebXR/rendering side that consumes this.
import { Matrix4, Quaternion, Vector3 } from 'three';

// The 25 WebXR hand joints, chained finger-by-finger — same names and order
// three.js's own XRHandPrimitiveModel uses. BONES pairs up each adjacent joint
// in a chain (a "bone"); five palm bones (wrist -> each finger's own base)
// give the palm itself some coverage without a separate palm shape.
const CHAINS: XRHandJoint[][] = [
  ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ['wrist', 'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  ['wrist', 'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ['wrist', 'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  ['wrist', 'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
];
export const BONES: Array<[XRHandJoint, XRHandJoint]> = CHAINS.flatMap((chain) => chain.slice(0, -1).map((a, i): [XRHandJoint, XRHandJoint] => [a, chain[i + 1]]));

const UP = new Vector3(0, 1, 0);
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
// call.
export function boneMatrix(a: Vector3, b: Vector3, radiusA: number, radiusB: number): Matrix4 | null {
  const length = a.distanceTo(b);
  if (length < 1e-5) return null;
  _mid.copy(a).add(b).multiplyScalar(0.5);
  _dir.copy(b).sub(a).normalize();
  _quat.setFromUnitVectors(UP, _dir);
  _scale.set((radiusA + radiusB) / 2, length, (radiusA + radiusB) / 2);
  return _mat.compose(_mid, _quat, _scale);
}
