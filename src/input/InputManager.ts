import type { WebGLRenderer, Scene, Object3D } from 'three';
import { InputProcessor } from './InputProcessor';
import { XRSelectSource } from './XRSelectSource';
import { HandSource } from './HandSource';


export class InputManager {
  #processor: InputProcessor;

  // `board` is the placed-surface anchor — HandSource needs its height to tell a
  // table whack from a mid-air stop.
  constructor(renderer: WebGLRenderer, scene: Scene, board: Object3D) {
    this.#processor = new InputProcessor();

    // Selects (trigger, pinch, screen tap, gaze-and-pinch) straight from the
    // session. No getController(n), and no `pinchend` binding either: three.js
    // only moves a hand's joints, never the XRHandSpace group itself, so those
    // commands aimed from the tracking origin (a board placed on the floor, a
    // ray that hit nothing), and on Quest every pinch fired twice, the second
    // select skipping Intro's START.
    this.#processor.add(new XRSelectSource(renderer.xr));

    const handL = renderer.xr.getHand(0);
    const handR = renderer.xr.getHand(1);
    scene.add(handL, handR);
    this.#processor.add(new HandSource(handL, 'left', board));
    this.#processor.add(new HandSource(handR, 'right', board));

    // A select queued in the last frame before the session ends would never be
    // drained, and would fire on the first frame of the *next* session. Clear
    // on session end rather than on input-source disconnect: disconnect is
    // routine mid-tap for handheld AR and for Vision Pro's transient pointers.
    renderer.xr.addEventListener('sessionend', () => this.#processor.clear());
  }

  get commands() { return this.#processor.commands; }
  collect() { this.#processor.collect(); }
  dispose() { this.#processor.dispose(); }
}
