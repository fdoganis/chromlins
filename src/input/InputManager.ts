import type { WebGLRenderer, Scene, Object3D } from 'three';
import { InputProcessor } from './InputProcessor';
import { SpatialInputSource } from './SpatialInputSource';
import { HandSource } from './HandSource';


export class InputManager {
  xrLeft: SpatialInputSource;
  xrRight: SpatialInputSource;
  handLeft: HandSource;
  handRight: HandSource;

  #processor: InputProcessor;

  // `board` is the placed-surface anchor — HandSource needs its height to tell a
  // table whack from a mid-air stop.
  constructor(renderer: WebGLRenderer, scene: Scene, board: Object3D) {
    this.#processor = new InputProcessor();

    const ctrlL = renderer.xr.getController(0);
    const ctrlR = renderer.xr.getController(1);
    const handL = renderer.xr.getHand(0);
    const handR = renderer.xr.getHand(1);
    scene.add(ctrlL, ctrlR, handL, handR);

    this.xrLeft = new SpatialInputSource(ctrlL);
    this.xrRight = new SpatialInputSource(ctrlR);
    this.handLeft = new HandSource(handL, 'left', board);
    this.handRight = new HandSource(handR, 'right', board);

    this.#processor.add(this.xrLeft);
    this.#processor.add(this.xrRight);
    this.#processor.add(this.handLeft);
    this.#processor.add(this.handRight);
  }

  get commands() { return this.#processor.commands; }
  collect() { this.#processor.collect(); }
  dispose() { this.#processor.dispose(); }
}
