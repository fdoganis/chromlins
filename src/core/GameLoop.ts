

import type { Game } from './Game';
import { Timer } from 'three';

const FPS = 60;
const FRAME_s = 1 / FPS;
const MAX_CATCHUP_s = 0.25; // clamp: a long stall (tab hidden, XR session start,
// permission prompt) must not dump its whole gap into one frame of catch-up —
// that would fast-forward time-based state (e.g. a round timer) to the end.

export class GameLoop {
  #game!: Game;
  #timer: Timer = new Timer();
  #elapsed: number = 0;

  constructor(game: Game) {
    this.#game = game;
    this.#timer.connect(document)

  }

  tick = (_timestamp: number, frame?: XRFrame) => {
    this.#timer.update();
    this.#elapsed = Math.min(this.#elapsed + this.#timer.getDelta(), MAX_CATCHUP_s);
    this.#game.processInput();

    while (this.#elapsed > FRAME_s) {
      this.#game.update(FRAME_s, frame);
      this.#elapsed -= FRAME_s;
    }

    this.#game.render();
  }
}

