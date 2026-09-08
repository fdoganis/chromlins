import { State } from '../core/State';
import type { Game } from '../core/Game';
import type { TextManager } from '../text/TextManager';
import type { TextHandle } from '../text/ITextEngine';
import { SelectCommand } from '../commands/SelectCommand';
import { IntroState } from './IntroState';
import { NameEntryState } from './NameEntryState';
import type { Score } from '../core/Score';
import type { HiScore } from '../core/HiScore';
import type { AudioManager } from '../audio/AudioManager';


export class GameOverState extends State {
  #ctx: Game;
  #text: TextManager;
  #score: Score;
  #hi: HiScore;
  #audio: AudioManager;
  #message: TextHandle;

  constructor(ctx: Game) {
    super();
    this.#ctx = ctx;
    this.#text = ctx.text;
    this.#score = ctx.score;
    this.#hi = ctx.hiScore;
    this.#audio = ctx.audio;
    this.#message = ctx.text.show('GAME OVER', ctx.rendering.hudAnchor, { color: '#ff3333', visible: false });
    this.#registerHandlers();
  }

  #registerHandlers() {
    this.on(SelectCommand, this.#onSelect);
  }

  #onSelect = () => {
    this.#ctx.change(this.#hi.beaten(this.#score.value) ? NameEntryState : IntroState);
  };

  override enter() {
    this.#audio.activate(); // RunState.exit() deactivated it; the sting needs it back
    this.#audio.playSFX('over');
    this.#text.setText(this.#message, `GAME OVER  ${this.#score.value}`);
    this.#text.setVisible(this.#message, true);
  }
  override exit() {
    this.#audio.deactivate();
    this.#text.setVisible(this.#message, false);
  }
}