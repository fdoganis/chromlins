import { Vector3 } from 'three';
import type { BufferGeometry } from 'three';

// Walk a geometry's vertices through `fn`, writing each mutated position back.
// Shared by the horn twist and the mane taper so each stays a short callback
// instead of a hand-rolled vertex loop.
export function deform(g: BufferGeometry, fn: (v: Vector3, i: number) => void): void {
  const p = g.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    fn(v, i);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
}
