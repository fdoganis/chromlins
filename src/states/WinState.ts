import { State } from '../core/State';
import type { Game } from '../core/Game';
import type { TextManager } from '../text/TextManager';
import type { TextHandle } from '../text/ITextEngine';
import { SelectCommand } from '../commands/SelectCommand';
import { IntroState } from './IntroState';
import { NameEntryState } from './NameEntryState';
import { RunState } from './RunState';
import type { AudioManager } from '../audio/AudioManager';
import type { Score } from '../core/Score';
import type { Level } from '../core/Level';
import type { HiScore } from '../core/HiScore';
import { LEVEL_COUNT, l13Unlocked } from '../core/levels';
import { RAINBOW } from '../core/palette';

// Between-levels screen. Reached when every rainbow color is complete before the
// timer runs out (RunState has already advanced the Level). Tap → next level;
// after level 7 → the hidden L13 if unlocked, else name entry / Intro; after
// L13 → "RAINBOW RESTORED" → Intro. (The full wordless finale is still §5.3/§6.)
export class WinState extends State {
  #ctx: Game;
  #text: TextManager;
  #score: Score;
  #level: Level;
  #hi: HiScore;
  #audio: AudioManager;
  #message: TextHandle;

  constructor(ctx: Game) {
    super();
    this.#ctx = ctx;
    this.#text = ctx.text;
    this.#score = ctx.score;
    this.#level = ctx.level;
    this.#hi = ctx.hiScore;
    this.#audio = ctx.audio;
    this.#message = ctx.text.show('YOU WIN', ctx.rendering.hudAnchor, { color: '#00ff88', visible: false });
    this.#registerHandlers();
  }

  #registerHandlers() {
    this.on(SelectCommand, this.#onSelect);
  }

  #onSelect = () => {
    const v = this.#level.value;
    if (v <= LEVEL_COUNT) { this.#ctx.change(RunState); return; }   // 1..7 → next level
    if (v === 13) { this.#ctx.change(IntroState); return; }             // L13 cleared
    if (l13Unlocked()) { this.#level.set(13); this.#ctx.change(RunState); return; } // cleared L7, L13 available
    this.#ctx.change(this.#hi.beaten(this.#score.value) ? NameEntryState : IntroState);
  };

  override enter() {
    this.#audio.activate(); // RunState.exit() deactivated it; the sting needs it back
    this.#audio.playSFX('win');
    const v = this.#level.value;
    const inRun = v <= LEVEL_COUNT;
    const msg =
      inRun ? `LEVEL ${v}` :
      v === 13 ? `RAINBOW RESTORED  ${this.#score.value}` :
      l13Unlocked() ? 'LEVEL 13' :
      `YOU WIN  ${this.#score.value}`;
    // each level's card in its own rainbow color, red→violet; L13 in gold
    this.#text.setText(this.#message, msg);
    this.#text.recolor(this.#message, inRun ? RAINBOW[v - 1] : v === 13 || l13Unlocked() ? '#FFD700' : '#00FF88');
    this.#text.setVisible(this.#message, true);
  }
  override exit() {
    this.#audio.deactivate();
    this.#text.setVisible(this.#message, false);
  }
}
