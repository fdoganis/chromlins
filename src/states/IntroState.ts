// Between AnchorState and RunState. Resets the run, then either plays the opening
// cinematic (CINEMATIC === 'full') or hands straight to RunState. Reached on boot
// (via AnchorState) and from GameOver / Win / NameEntry on a replay.
//
// The cinematic lives in ./Cinematic and is only referenced inside the folded
// `if (CINEMATIC === 'full')` branches, so a 'none' build tree-shakes it — and
// its Timeline / dressGhost / dressUnicorn use — out entirely.
import { State } from '../core/State';
import type { Ctx } from '../core/Ctx';
import { SelectCommand } from '../commands/SelectCommand';
import { RunState } from './RunState';
import { CINEMATIC } from '../game.config';
import { Cinematic } from './Cinematic';
import type { Score } from '../core/Score';
import type { Level } from '../core/Level';

export class IntroState extends State {
  #sm: Ctx;
  #score: Score;
  #level: Level;
  #cine: Cinematic | null = null;
  #bounce = false;

  constructor(ctx: Ctx) {
    super();
    this.#sm = ctx;
    this.#score = ctx.score;
    this.#level = ctx.level;
    if (CINEMATIC === 'full') {
      this.#cine = new Cinematic(ctx, () => ctx.change(RunState));
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
