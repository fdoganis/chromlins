import type { Command } from '../core/Command';

export abstract class InputSource {
  enabled: boolean = true;
  queue: Command[] = []; // queue containing the commands to execute, will be processed by InputManager

  poll() { } // needed for non event-based implementations

  dispose() { } // overridden by sources that actually hold something to release (SpatialInputSource)
}