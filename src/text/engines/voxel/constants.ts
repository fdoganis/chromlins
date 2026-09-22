import { Vector3, Matrix4, Quaternion } from 'three';

export const UP: Readonly<Vector3> = new Vector3(0, 1, 0);
export const ZERO_SCALE_MATRIX: Readonly<Matrix4> = new Matrix4().makeScale(0, 0, 0);
export const IDENTITY_QUAT: Readonly<Quaternion> = new Quaternion(); // for a Matrix4.compose() on something that never rotates (a particle, a joint marker)