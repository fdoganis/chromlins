// Plain Node unit test for handBones.ts's pure geometry (boneMatrix, and the
// BONES finger-segment list) — no WebXR session, no renderer, no browser
// needed: three's math/geometry classes run fine under plain Node.
// tests/hand-occlusion.spec.ts is the end-to-end companion: a real
// (IWER-emulated) hand, screenshots, and a numeric overlap measurement
// against three's own ground-truth hand model — including the ablation that
// dropped this file's earlier forearmMatrix/palmPlateMatrix functions (a
// separate box palm and a guessed forearm segment), see HAND-OCCLUSION.md.
//
//   node --experimental-strip-types --test tests/unit/hand-occluder.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Matrix4, Quaternion } from 'three';
import { boneMatrix, BONES } from '../../src/world/handBones.ts';

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

// Regression test: an earlier version of BONES's flatMap sliced BOTH ends off
// each finger chain (dropping the wrist bone AND, by mistake, the tip bone),
// so every fingertip silently had no occluder. Assert every real finger chain
// still ends at its own -tip joint, and every chain has the right bone count
// (metacarpal->proximal->[intermediate->]distal->tip: 3 bones for the
// 4-joint thumb chain, 4 for the 5-joint others), not just "some number".
test('BONES keeps every finger down to its -tip joint (no accidental truncation)', () => {
  const fingerBones = (prefix) => BONES.filter(([a, b]) => a.startsWith(prefix) || b.startsWith(prefix));
  for (const prefix of ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger']) {
    const bones = fingerBones(prefix);
    assert.strictEqual(bones.length, 4, `${prefix} should have 4 bones (metacarpal->proximal->intermediate->distal->tip), got ${bones.length}`);
    assert.ok(bones.some(([, b]) => b === `${prefix}-tip`), `${prefix} is missing its tip bone entirely`);
  }
  const thumbBones = fingerBones('thumb');
  assert.strictEqual(thumbBones.length, 3, `thumb should have 3 bones (metacarpal->proximal->distal->tip), got ${thumbBones.length}`);
  assert.ok(thumbBones.some(([, b]) => b === 'thumb-tip'), 'thumb is missing its tip bone entirely');
  assert.ok(!BONES.some(([a, b]) => a === 'wrist' || b === 'wrist'), 'wrist should not appear in BONES — HandOccluder builds the two palm spokes itself, straight from boneMatrix');
});
