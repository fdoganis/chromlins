import { Command } from '../core/Command';
import type { ITransform } from '../types/ITransform';
import type { XRHandedness } from '../types/XRTypes';

export class SelectCommand extends Command {
  readonly transform: ITransform;
  readonly handedness: XRHandedness; // 'none' for sources with no physical hand
  readonly reach: number;            // hit radius in metres; 0 = source has no opinion, use the default

  constructor(transform: ITransform, handedness: XRHandedness = 'none', reach = 0) {
    super();
    this.transform = transform;
    this.handedness = handedness;
    this.reach = reach;
  }
}
