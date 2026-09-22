// Pure hand-skeleton geometry: no InstancedPool, no scene, no WebXR session —
// only `three`'s math classes, so this is plain-Node testable
// (tests/unit/hand-occluder.test.mjs) without going through Vite's resolver
// the way the rest of src/ (extensionless imports) needs. HandOccluder.ts is
// the WebXR/rendering side that consumes this.
import { Matrix4, Quaternion, Vector3 } from 'three';

// The 25 WebXR hand joints, chained finger-by-finger — same names and order
// three.js's own XRHandPrimitiveModel uses. Finger segments only: the palm
// (PALM_JOINTS below) and the forearm (forearmMatrix below) are handled
// separately, not as a "bone" between two real joints.
const CHAINS: XRHandJoint[][] = [
  ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ['wrist', 'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  ['wrist', 'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ['wrist', 'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  ['wrist', 'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
];
export const BONES: Array<[XRHandJoint, XRHandJoint]> = CHAINS.flatMap((chain) => {
  const finger = chain.slice(1); // drop 'wrist' — that segment is the palm plate's job, not a finger bone
  return finger.slice(0, -1).map((a, i): [XRHandJoint, XRHandJoint] => [a, finger[i + 1]]);
});

// All 25 joints, wrist first, then finger-by-finger — for a debug view that
// draws every joint individually (HandOccluder's optional `debug` mode),
// distinct from BONES (segments) or PALM_JOINTS (the plate's three corners).
export const ALL_JOINTS: XRHandJoint[] = ['wrist', ...new Set(CHAINS.flatMap((c) => c.slice(1)))];

// The palm: not a "bone" between two joints, a filled plate across the three
// joints that actually bound its area. wrist->each-metacarpal spokes (the
// first version of this file) covered the palm with five thin lines radiating
// from one point, leaving real gaps between them — see HAND-OCCLUSION.md.
// This plate's edges are the index and pinky metacarpals (the width of the
// knuckle line) and the wrist (the base), the same three-point palm
// approximation https://github.com/ttktjmt/mjswan/pull/114 uses for its own
// two-capsule version of this problem.
export const PALM_JOINTS: [XRHandJoint, XRHandJoint, XRHandJoint] = ['wrist', 'index-finger-metacarpal', 'pinky-finger-metacarpal'];
export const PALM_THICKNESS_m = 0.02; // a flat guess, not derived from any joint radius — real palms aren't flat, this is the minimal shape that covers the area

// The forearm has NO joints in the WebXR Hand Input skeleton at all — the
// wrist is the proximal end of the tracked data (see
// https://github.com/immersive-web/webxr-hand-input/blob/main/explainer.md).
// This estimates one anyway, extending from the wrist along its own local +Z
// (the spec fixes -Z as "along the bone, away from the wrist" for every OTHER
// joint, so a joint's own +Z is the direction back toward the body — the
// wrist is the one joint where that direction is the forearm). The LENGTH is
// a plain guess (average adult forearm, elbow to wrist), not tracked data —
// unlike every other measurement in this file, don't trust this one's
// distance, only its direction.
export const FOREARM_LENGTH_m = 0.25;

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);
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

const _elbow = new Vector3();

// A guessed forearm segment (see FOREARM_LENGTH_m above): reuses boneMatrix
// itself, from the wrist to a virtual "elbow" point projected along the
// wrist's own +Z. Tapers slightly (0.8x) toward that virtual end, same as a
// real forearm narrows toward the wrist — cosmetic only, the taper ratio
// isn't measured either.
export function forearmMatrix(wristPos: Vector3, wristQuat: Quaternion, wristRadius: number): Matrix4 | null {
  _elbow.copy(FORWARD).applyQuaternion(wristQuat).multiplyScalar(FOREARM_LENGTH_m).add(wristPos);
  return boneMatrix(wristPos, _elbow, wristRadius, wristRadius * 0.8);
}

const _right = new Vector3();
const _normal = new Vector3();
const _fwd = new Vector3();
const _center = new Vector3();
const _plateScale = new Vector3();
const _plateQuat = new Quaternion();
const _basis = new Matrix4();
const _plateMat = new Matrix4();

// The palm plate's instance matrix: a unit (1x1x1) box, centered on the
// wrist/index-metacarpal/pinky-metacarpal centroid, oriented so local X spans
// the knuckle line (index->pinky), local Z spans wrist->knuckle-line-midpoint,
// and local Y is the palm's own normal (their cross product) — scaled so each
// axis matches the real distance it spans, plus a fixed PALM_THICKNESS_m on Y.
// null if the three points are degenerate (coincident or colinear).
export function palmPlateMatrix(wrist: Vector3, indexMc: Vector3, pinkyMc: Vector3): Matrix4 | null {
  const width = indexMc.distanceTo(pinkyMc);
  _mid.copy(indexMc).add(pinkyMc).multiplyScalar(0.5); // knuckle-line midpoint
  const depth = wrist.distanceTo(_mid);
  if (width < 1e-5 || depth < 1e-5) return null;

  _right.copy(pinkyMc).sub(indexMc).divideScalar(width);
  _fwd.copy(_mid).sub(wrist).divideScalar(depth);
  _normal.crossVectors(_right, _fwd).normalize();
  _fwd.crossVectors(_normal, _right).normalize(); // re-orthogonalize: right and the raw wrist->mid axis aren't exactly perpendicular

  _basis.makeBasis(_right, _normal, _fwd);
  _plateQuat.setFromRotationMatrix(_basis);

  _center.copy(wrist).add(indexMc).add(pinkyMc).divideScalar(3);
  _plateScale.set(width, PALM_THICKNESS_m, depth);
  return _plateMat.compose(_center, _plateQuat, _plateScale);
}
