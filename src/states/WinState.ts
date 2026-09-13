import type { Game } from '../core/Game';
import type { Screen } from '../core/sm';
import { LEVEL_COUNT, l13Unlocked } from '../core/levels';
import { RAINBOW } from '../core/palette';

// Between-levels screen. Reached when every rainbow color is complete before the
// timer runs out (RunState has already advanced the Level). Tap → next level;
// after level 7 → the hidden L13 if unlocked, else name entry / Intro; after
// L13 → "RAINBOW RESTORED" → Intro. (The full wordless finale is still §5.3/§6.)
export function makeWin(ctx: Game): Screen {
  const { text, score, level, hiScore: hi, audio } = ctx;
  const message = text.show('YOU WIN', ctx.rendering.hudAnchor, { color: '#00ff88', visible: false });

  return {
    select() {
      const v = level.value;
      if (v <= LEVEL_COUNT) { ctx.change('run'); return; }   // 1..7 → next level
      if (v === 13) { ctx.change('intro'); return; }             // L13 cleared
      if (l13Unlocked()) { level.set(13); ctx.change('run'); return; } // cleared L7, L13 available
      ctx.change(hi.beaten(score.value) ? 'name' : 'intro');
    },

    enter() {
      audio.activate(); // RunState.exit() deactivated it; the sting needs it back
      audio.playSFX('win');
      const v = level.value;
      const inRun = v <= LEVEL_COUNT;
      const msg =
        inRun ? `LEVEL ${v}` :
        v === 13 ? `RAINBOW RESTORED  ${score.value}` :
        l13Unlocked() ? 'LEVEL 13' :
        `YOU WIN  ${score.value}`;
      // each level's card in its own rainbow color, red→violet; L13 in gold
      text.setText(message, msg);
      text.recolor(message, inRun ? RAINBOW[v - 1] : v === 13 || l13Unlocked() ? '#FFD700' : '#00FF88');
      text.setVisible(message, true);
    },
    exit() {
      audio.deactivate();
      text.setVisible(message, false);
    },
  };
}
