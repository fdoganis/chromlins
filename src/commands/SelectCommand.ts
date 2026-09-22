import { Ray, Vector3 } from 'three';
import { Command } from '../core/Command';
import type { ITransform } from '../types/ITransform';
import type { XRHandedness } from '../types/XRTypes';

const _o = new Vector3();
const _d = new Vector3();
const _ray = new Ray();

export class SelectCommand extends Command {
  readonly transform: ITransform;    // aim: a ray from its world position along its local −Z
  readonly handedness: XRHandedness; // 'none' for sources with no physical hand
  readonly reach: number;            // hit radius in metres; 0 = source has no opinion, use the default
  readonly rest: number;             // world Y of the hand/controller resting on the table (AnchorState, no hit-test)

  constructor(transform: ITransform, handedness: XRHandedness, reach: number, rest: number) {
    super();
    this.transform = transform;
    this.handedness = handedness;
    this.reach = reach;
    this.rest = rest;
  }

  // The aimed ray: the source's world position, pointing along its local -Z.
  // One shared scratch Ray, so it is only valid until the next select is read.
  get ray(): Ray {
    _o.setFromMatrixPosition(this.transform.matrixWorld);
    _d.set(0, 0, -1).transformDirection(this.transform.matrixWorld);
    return _ray.set(_o, _d);
  }
}
