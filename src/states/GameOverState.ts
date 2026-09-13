import type { Game } from '../core/Game';
import type { Screen } from '../core/sm';
import { HUD_TEXT } from '../core/palette';

export function makeGameOver(ctx: Game): Screen {
  const { text, score, hiScore: hi, audio } = ctx;
  const message = text.show('GAME OVER', ctx.rendering.hudAnchor, { color: HUD_TEXT, visible: false });

  return {
    select() {
      ctx.change(hi.beaten(score.value) ? 'name' : 'intro');
    },
    enter() {
      audio.activate(); // RunState.exit() deactivated it; the sting needs it back
      audio.playSFX('over');
      text.setText(message, `GAME OVER  ${score.value}`);
      text.setVisible(message, true);
    },
    exit() {
      audio.deactivate();
      text.setVisible(message, false);
    },
  };
}
