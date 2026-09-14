import type { Command } from '../core/Command';
import type { InputSource } from './InputSource';

export class InputProcessor {
  #sources: InputSource[] = [];
  commands: Command[] = [];

  add(source: InputSource) { this.#sources.push(source); }

  collect() {
    this.commands.length = 0;
    for (const src of this.#sources) {
      src.poll();
      for (const cmd of src.queue) this.commands.push(cmd);
      src.queue.length = 0;
    }
  }

  // Drop anything queued but never drained, so input from one session can't
  // leak into the next one.
  clear() { for (const src of this.#sources) src.queue.length = 0; }

  dispose() { for (const src of this.#sources) src.dispose(); }
}