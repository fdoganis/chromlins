// Between AnchorState and RunState. Resets the run, then either plays the opening
// cinematic (BUILD === 'deluxe') or shows a 'START' prompt and waits for a tap.
// Reached on boot (via AnchorState) and from GameOver / Win / NameEntry on a
// replay — the board is already placed, so a replay never re-runs AnchorState.
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
import { HUD_TEXT } from '../core/palette';
import type { Score } from '../core/Score';
import type { Level } from '../core/Level';
import type { TextManager } from '../text/TextManager';
import type { TextHandle } from '../text/ITextEngine';

export class IntroState extends State {
  #ctx: Game;
  #score: Score;
  #level: Level;
  #text: TextManager;
  #cine: Cinematic | null = null;
  #title: TextHandle | null = null;

  constructor(ctx: Game) {
    super();
    this.#ctx = ctx;
    this.#score = ctx.score;
    this.#level = ctx.level;
    this.#text = ctx.text;
    if (BUILD === 'deluxe') {
      this.#cine = new Cinematic(ctx, () => ctx.change(RunState));
      this.on(SelectCommand, () => this.#cine!.skip());
    } else {
      this.#title = this.#text.show('START', ctx.rendering.hudAnchor, { color: HUD_TEXT, visible: false });
      this.on(SelectCommand, () => this.#ctx.change(RunState));
    }
  }

  override enter(): void {
    this.#score.reset();
    this.#level.reset();
    if (BUILD === 'deluxe') this.#cine!.begin();
    else this.#text.setVisible(this.#title!, true);
  }

  override update(delta: number): void {
    if (BUILD === 'deluxe') this.#cine!.update(delta);
  }

  override exit(): void {
    if (BUILD === 'deluxe') this.#cine!.end();
    else this.#text.setVisible(this.#title!, false);
  }
}
