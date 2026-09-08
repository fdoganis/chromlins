// Between AnchorState and RunState. Resets the run, then either plays the opening
// cinematic (BUILD === 'deluxe') or hands straight to RunState. Reached on boot
// (via AnchorState) and from GameOver / Win / NameEntry on a replay.
//
// The cinematic lives in ./Cinematic and is only referenced inside the folded
// `if (BUILD === 'deluxe')` branches, so a 'light' build tree-shakes it — and
// its Timeline / dressGhost / dressUnicorn use — out entirely.
import { State } from '../core/State';
import type { Game } from '../core/Game';
import { SelectCommand } from '../commands/SelectCommand';
import { RunState } from './RunState';
import { BUILD } from '../game.config';
import { Cinematic } from './Cinematic';
import type { Score } from '../core/Score';
import type { Level } from '../core/Level';

export class IntroState extends State {
  #ctx: Game;
  #score: Score;
  #level: Level;
  #cine: Cinematic | null = null;
  #bounce = false;

  constructor(ctx: Game) {
    super();
    this.#ctx = ctx;
    this.#score = ctx.score;
    this.#level = ctx.level;
    if (BUILD === 'deluxe') {
      this.#cine = new Cinematic(ctx, () => ctx.change(RunState));
      this.on(SelectCommand, () => this.#cine!.skip());
    }
  }

  override enter(): void {
    this.#score.reset();
    this.#level.reset();
    if (BUILD === 'deluxe') this.#cine!.begin();
    else this.#bounce = true; // hand to RunState on the next tick (can't change state mid-enter)
  }

  override update(delta: number): void {
    if (this.#bounce) { this.#bounce = false; this.#ctx.change(RunState); return; }
    if (BUILD === 'deluxe') this.#cine!.update(delta);
  }

  override exit(): void {
    if (BUILD === 'deluxe') this.#cine!.end();
  }
}
