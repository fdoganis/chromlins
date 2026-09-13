import { InputSource } from './InputSource';
import type { Command } from '../core/Command';
import type { Group } from 'three';
import type { XRBindableEvent } from '../types/XRTypes';

export class SpatialInputSource extends InputSource {
  #node: Group;
  #handlers: Partial<Record<XRBindableEvent, () => void>> = {};

  constructor(node: Group) {
    super();
    this.#node = node;
  }

  get node(): Group { return this.#node; }

  bind(event: XRBindableEvent, command: Command) {
    const prev = this.#handlers[event];
    if (prev) this.#node.removeEventListener(event, prev);
    const handler = () => {
      if (this.enabled) this.queue.push(command);
    };
    this.#handlers[event] = handler;
    this.#node.addEventListener(event, handler);
  }

  // Deliberately no 'disconnected' handler dropping queued commands. A
  // handheld-AR tap is a transient input source: it connects, fires select and
  // disconnects again inside the one touch, before the next frame drains the
  // queue, so clearing on disconnect silently ate every phone-AR tap. A select
  // that already fired is a finished action; the source going away afterwards
  // doesn't retract it. InputManager clears on session end instead, which is
  // the case that guard was actually worth keeping.
  dispose() {
    for (const event of Object.keys(this.#handlers) as XRBindableEvent[])
      this.#node.removeEventListener(event, this.#handlers[event]!);
  }
}