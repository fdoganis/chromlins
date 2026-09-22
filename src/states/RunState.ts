import type { Game } from '../core/Game';
import type { Screen } from '../core/sm';
import type { SelectCommand } from '../commands/SelectCommand';
import { LEVELS, LEVEL_COUNT, L13 } from '../core/levels';
import type { LevelConfig } from '../core/levels';
import { RAINBOW, HUD_TEXT } from '../core/palette';
import { Scoring } from './Scoring';
import type { TextHandle } from '../text/ITextEngine';

const ROUND_SECONDS = 45;

// The unicorn: a decoy that must NOT be tapped. Carries a sentinel tag so it
// never collides with a rainbow index; peeks longer than a gnome (more time to
// misfire); at most one at a time. Cadence is level-scaled; its hold window is not.
const UNICORN_HEX = '#f3ead7'; // cream
const UNICORN_TAG = -1;
const UNICORN_UP_MIN_S = 1.5;
const UNICORN_UP_MAX_S = 2.5;

const TICK_FROM_S = 5;          // countdown pulse plays for the last N seconds

export function makeRun(ctx: Game): Screen {
  const { world, audio, haptics, text, rendering: render, level } = ctx;
  const scoring = new Scoring(ctx);

  let cfg: LevelConfig = LEVELS[0];
  let timeLeft = ROUND_SECONDS;
  let spawnCooldown = 0;
  let timerLabel: TextHandle | null = null;
  let lastShownSecond = -1;

  const trySpawn = () => {
    const free = world.freeHoles();
    // one actor per color at a time; a color that's done for the level never returns
    const busy = new Set(world.activeTags());
    const avail: number[] = [];
    for (let i = 0; i < RAINBOW.length; i++) {
      if (!scoring.isColorDone(i) && !busy.has(i)) avail.push(i);
    }
    if (!free.length || !avail.length || world.activeCount >= cfg.maxActive) return;

    const hole = free[(Math.random() * free.length) | 0];
    const tag = avail[(Math.random() * avail.length) | 0];
    const hold = cfg.upMin + Math.random() * (cfg.upMax - cfg.upMin);
    world.spawnAtHole(hole, RAINBOW[tag], hold, tag);
  };

  const tryUnicorn = () => {
    if (world.activeTags().includes(UNICORN_TAG)) return; // one at a time
    if (Math.random() >= cfg.unicornChance) return;
    const free = world.freeHoles();
    if (!free.length) return;
    const hole = free[(Math.random() * free.length) | 0];
    const hold = UNICORN_UP_MIN_S + Math.random() * (UNICORN_UP_MAX_S - UNICORN_UP_MIN_S);
    world.spawnAtHole(hole, UNICORN_HEX, hold, UNICORN_TAG, true);
  };

  return {
    // A select aims a ray (source world pose, −Z) at the live actors. A hit buzzes;
    // the unicorn is the penalty path, everything else goes to Scoring. Completing
    // every color → win with a leftover-time bonus, then advance the level.
    select(cmd: SelectCommand) {
      const removed = world.hit(cmd.ray, cmd.reach || undefined);
      if (!removed) {
        world.whiff(cmd.ray); // show where a swing at nothing landed
        return;
      }

      haptics.pulse(cmd.handedness);

      if (removed.tag === UNICORN_TAG) { scoring.hitUnicorn(removed.position); return; }

      if (scoring.collect(removed)) {
        scoring.awardTimeBonus(timeLeft);
        if (level.value <= LEVEL_COUNT) level.advance(); // L13 is terminal — don't step past it
        ctx.change('win');
      }
    },

    update(delta: number) {
      if (world.update(delta) > 0) scoring.missed(); // an actor sank unhit
      scoring.update(delta);

      spawnCooldown -= delta;
      if (spawnCooldown <= 0) {
        spawnCooldown = cfg.spawnEvery + Math.random() * cfg.jitter;
        trySpawn();
        if (Math.random() < 0.3) trySpawn(); // sometimes several at once
        tryUnicorn();
      }

      timeLeft -= delta;
      const seconds = Math.max(0, Math.ceil(timeLeft));
      if (seconds !== lastShownSecond) {
        lastShownSecond = seconds;
        text.setText(timerLabel!, String(seconds));
        if (seconds > 0 && seconds <= TICK_FROM_S) audio.playSFX('tick'); // final-seconds pulse
      }

      if (timeLeft <= 0) {
        ctx.change('over');
      }
    },

    enter() {
      cfg = level.value === 13 ? L13 : LEVELS[Math.min(level.value, LEVEL_COUNT) - 1];
      timeLeft = cfg.roundS ?? ROUND_SECONDS;
      lastShownSecond = -1;
      spawnCooldown = cfg.spawnEvery;
      world.reset();
      scoring.reset(cfg.reps ?? level.value, cfg.snatchAll ?? false); // level N → N taps per color; L13 → 3 + wipe-all unicorn
      timerLabel = text.show(String(Math.ceil(timeLeft)), render.timerAnchor, { color: HUD_TEXT });
      audio.activate();
      audio.playBGM('music'); // looping bed for the round only
    },

    exit() {
      audio.stopBGM();
      audio.deactivate();
      world.clearSparkles(); // else the winning hit's burst freezes on the Win screen
      world.clearActors(); // else whatever's mid-rise/hold/sink keeps its hole occupied
      scoring.teardown();
      if (timerLabel) { text.remove(timerLabel); timerLabel = null; }
    },
  };
}
