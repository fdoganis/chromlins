// Plain Node unit test for HandOccluder's pure per-bone math (boneMatrix) —
// no WebXR session, no renderer, no browser needed: three's math/geometry
// classes run fine under plain Node.
//
//   node --experimental-strip-types --test tests/unit/hand-occluder.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Matrix4, Quaternion } from 'three';
import { boneMatrix } from '../../src/world/handBones.ts';

const EPS = 1e-6;

test('boneMatrix places the segment at the midpoint of its two joints', () => {
  const a = new Vector3(0, 0, 0);
  const b = new Vector3(0, 0.1, 0); // straight up, 0.1m apart
  const m = boneMatrix(a, b, 0.01, 0.01);
  const pos = new Vector3();
  m.decompose(pos, new Quaternion(), new Vector3());
  assert.ok(pos.distanceTo(new Vector3(0, 0.05, 0)) < EPS, `expected midpoint (0,0.05,0), got ${pos.toArray()}`);
});

test('boneMatrix scales length to the real joint distance and radius to the average of the two', () => {
  const a = new Vector3(0, 0, 0);
  const b = new Vector3(0.03, 0, 0.04); // 3-4-5 triangle -> distance 0.05
  const m = boneMatrix(a, b, 0.006, 0.010);
  const scale = new Vector3();
  m.decompose(new Vector3(), new Quaternion(), scale);
  assert.ok(Math.abs(scale.y - 0.05) < EPS, `expected length scale 0.05, got ${scale.y}`);
  assert.ok(Math.abs(scale.x - 0.008) < EPS, `expected radius scale 0.008 (avg of 0.006/0.010), got ${scale.x}`);
  assert.ok(Math.abs(scale.x - scale.z) < EPS, `x and z scale (radius) must match (the profile is round), got ${scale.x} vs ${scale.z}`);
});

test('boneMatrix orients the shared unit shape\'s local +Y along the bone direction', () => {
  const a = new Vector3(0, 0, 0);
  const b = new Vector3(1, 0, 0); // sideways, not up — must actually rotate, not just translate
  const m = boneMatrix(a, b, 0.01, 0.01);
  const quat = new Quaternion();
  m.decompose(new Vector3(), quat, new Vector3());
  const up = new Vector3(0, 1, 0).applyQuaternion(quat);
  assert.ok(up.distanceTo(new Vector3(1, 0, 0)) < EPS, `expected local +Y to point along +X, got ${up.toArray()}`);
});

test('boneMatrix returns null for two coincident joints (nothing to draw)', () => {
  const p = new Vector3(0.1, 0.2, 0.3);
  assert.strictEqual(boneMatrix(p, p.clone(), 0.01, 0.01), null);
});
