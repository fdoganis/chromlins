// Between AnchorState and RunState. Resets the run, then either plays the opening
// cinematic (CINEMATIC === 'full') or hands straight to RunState. Reached on boot
// (via AnchorState) and from GameOver / Win / NameEntry on a replay.
//
// The cinematic lives in ./Cinematic and is only referenced inside the folded
// `if (CINEMATIC === 'full')` branches, so a 'none' build tree-shakes it — and
// its Timeline / dressGhost / dressUnicorn use — out entirely.
import { State } from '../core/State';
import type { ITransition } from '../core/StateMachine';
import { SelectCommand } from '../commands/SelectCommand';
import { RunState } from './RunState';
import { CINEMATIC } from '../game.config';
import { Cinematic } from './Cinematic';
import type { Score } from '../core/Score';
import type { Level } from '../core/Level';
import type { World } from '../world/World';
import type { AudioManager } from '../audio/AudioManager';
import type { RenderingManager } from '../rendering/RenderingManager';

export class IntroState extends State {
  #sm: ITransition;
  #score: Score;
  #level: Level;
  #cine: Cinematic | null = null;
  #bounce = false;

  constructor(sm: ITransition, world: World, audio: AudioManager, render: RenderingManager, score: Score, level: Level) {
    super();
    this.#sm = sm;
    this.#score = score;
    this.#level = level;
    if (CINEMATIC === 'full') {
      this.#cine = new Cinematic(world, audio, render, () => this.#sm.change(RunState));
      this.on(SelectCommand, () => this.#cine!.skip());
    }
  }

  override enter(): void {
    this.#score.reset();
    this.#level.reset();
    if (CINEMATIC === 'full') this.#cine!.begin();
    else this.#bounce = true; // hand to RunState on the next tick (can't change state mid-enter)
  }

  override update(delta: number): void {
    if (this.#bounce) { this.#bounce = false; this.#sm.change(RunState); return; }
    if (CINEMATIC === 'full') this.#cine!.update(delta);
  }

  override exit(): void {
    if (CINEMATIC === 'full') this.#cine!.end();
  }
}
