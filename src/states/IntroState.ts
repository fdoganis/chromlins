// Between AnchorState and RunState. Resets the run, then shows a 'START' prompt
// and waits for a tap. Reached on boot (via AnchorState) and from GameOver /
// Win / NameEntry on a replay — the board is already placed, so a replay never
// re-runs AnchorState.
import type { Game } from '../core/Game';
import type { Screen } from '../core/sm';
import { HUD_TEXT } from '../core/palette';

export function makeIntro(ctx: Game): Screen {
  const { score, level, text } = ctx;
  const title = text.show('START', ctx.rendering.hudAnchor, { color: HUD_TEXT, visible: false });

  return {
    enter() { score.reset(); level.reset(); text.setVisible(title, true); },
    exit() { text.setVisible(title, false); },
    select() { ctx.change('run'); },
  };
}
