import { InstancedMesh, MeshBasicMaterial, Matrix4, Color } from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import { ZERO_SCALE_MATRIX } from '../text/engines/voxel/constants'; // TODO: put constants in a more exposed folder

// Generic bump+free-list allocator over one InstancedMesh: 
// hands out single instance indices, 
// reclaims freed indices for reuse. 
// Backs Sparkles (fixed pool, indices held for the object's lifetime) 
// and VoxelTextEngine (many indices per label, freed together on remove).
// Same buffer-management code, different call patterns on top. 
// Callers combine indices into whatever grouping they need
// (a label's N voxels, a particle's 1 slot); 
// this class only knows single indices.
export class InstancedPool {
  #mesh: InstancedMesh;
  #material: Material;
  #free: number[] = [];
  #nextRaw = 0;
  #capacity: number;

  constructor(parent: Object3D, geometry: BufferGeometry, capacity: number, material: Material = new MeshBasicMaterial()) {
    this.#capacity = capacity;
    this.#material = material;
    this.#mesh = new InstancedMesh(geometry, this.#material, capacity);
    this.#mesh.count = 0;
    this.#mesh.frustumCulled = false;
    parent.add(this.#mesh);
  }

  get freeCount(): number { return this.#free.length + (this.#capacity - this.#nextRaw); }

  allocate(): number | null {
    if (this.#free.length) return this.#free.pop()!;
    if (this.#nextRaw >= this.#capacity) return null;
    const i = this.#nextRaw++;
    this.#mesh.count = this.#nextRaw;
    this.#mesh.setMatrixAt(i, ZERO_SCALE_MATRIX); // safe default until the caller positions it
    this.#mesh.instanceMatrix.needsUpdate = true;
    return i;
  }

  free(index: number): void {
    this.#mesh.setMatrixAt(index, ZERO_SCALE_MATRIX);
    this.#mesh.instanceMatrix.needsUpdate = true;
    this.#free.push(index);
  }

  setMatrix(index: number, m: Matrix4): void {
    this.#mesh.setMatrixAt(index, m);
    this.#mesh.instanceMatrix.needsUpdate = true;
  }

  setColor(index: number, c: Color): void {
    this.#mesh.setColorAt(index, c);
    if (this.#mesh.instanceColor) this.#mesh.instanceColor.needsUpdate = true;
  }

  // Currently unreachable (nothing tears down a whole Game instance today —
  // see .doc/DECISIONS.md), but correct to call: this geometry/material are
  // created fresh by each caller (Sparkles/VoxelTextEngine own construction),
  // never a shared module-level static, so freeing them here is safe.
  dispose(): void {
    this.#mesh.geometry.dispose();
    this.#material.dispose();
    this.#mesh.removeFromParent();
  }
}