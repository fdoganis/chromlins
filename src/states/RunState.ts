import { Ray, Vector3 } from 'three';
import { State } from '../core/State';
import { SelectCommand } from '../commands/SelectCommand';
import type { World } from '../world/World';
import type { AudioManager } from '../audio/AudioManager';
import type { Haptics } from '../input/XRGamepadUtils';
import type { Game } from '../core/Game';
import type { ITransform } from '../types/ITransform';
import type { RenderingManager } from '../rendering/RenderingManager';
import type { Score } from '../core/Score';
import type { Level } from '../core/Level';
import { LEVELS, LEVEL_COUNT, L13 } from '../core/levels';
import type { LevelConfig } from '../core/levels';
import { RAINBOW, HUD_TEXT } from '../core/palette';
import { GameOverState } from './GameOverState';
import { WinState } from './WinState';
import { Scoring } from './Scoring';
import { devFlags } from '../dev/flags'; // __DEV__-guarded reads only → tree-shakes in prod
import type { TextManager } from '../text/TextManager';
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

// scratch — a select fires rarely, but reuse anyway (matches the codebase style)
const _origin = new Vector3();
const _dir = new Vector3();
const _ray = new Ray();

export class RunState extends State {
  #world: World;
  #audio: AudioManager;
  #haptics: Haptics;
  #ctx: Game;
  #text: TextManager;
  #render: RenderingManager;
  #level: Level;
  #scoring: Scoring;
  #cfg: LevelConfig = LEVELS[0];
  #timeLeft = ROUND_SECONDS;
  #spawnCooldown = 0;
  #timerLabel: TextHandle | null = null;
  #lastShownSecond = -1;

  constructor(ctx: Game) {
    super();
    this.#world = ctx.world;
    this.#audio = ctx.audio;
    this.#haptics = ctx.haptics;
    this.#ctx = ctx;
    this.#text = ctx.text;
    this.#render = ctx.rendering;
    this.#level = ctx.level;
    this.#scoring = new Scoring(ctx);
    this.#registerHandlers();
  }

  #registerHandlers() {
    this.on(SelectCommand, this.#onSelect);
  }

  // A select aims a ray (source world pose, −Z) at the live actors; keyboard has
  // no aim → collect a random actor. A hit buzzes either way; the unicorn is the
  // penalty path, everything else goes to Scoring. Completing every color → win
  // with a leftover-time bonus, then advance the level.
  #onSelect = (cmd: SelectCommand) => {
    const removed = __DEV__ && cmd.debugRandom
      ? this.#world.hitRandom()
      : this.#world.hit(this.#rayFrom(cmd.transform), cmd.reach || undefined);
    if (!removed) return;

    this.#haptics.pulse(cmd.handedness);

    if (removed.tag === UNICORN_TAG) { this.#scoring.hitUnicorn(removed.position); return; }

    if (this.#scoring.collect(removed)) {
      this.#scoring.awardTimeBonus(this.#timeLeft);
      if (this.#level.value <= LEVEL_COUNT) this.#level.advance(); // L13 is terminal — don't step past it
      this.#ctx.change(WinState);
    }
  };

  #rayFrom(t: ITransform): Ray {
    _origin.setFromMatrixPosition(t.matrixWorld);
    _dir.set(0, 0, -1).transformDirection(t.matrixWorld);
    return _ray.set(_origin, _dir);
  }

  #trySpawn() {
    const free = this.#world.freeHoles();
    // one actor per color at a time; a color that's done for the level never returns
    const busy = new Set(this.#world.activeTags());
    const avail: number[] = [];
    for (let i = 0; i < RAINBOW.length; i++) {
      if (!this.#scoring.isColorDone(i) && !busy.has(i)) avail.push(i);
    }
    if (!free.length || !avail.length || this.#world.activeCount >= this.#cfg.maxActive) return;

    const hole = free[(Math.random() * free.length) | 0];
    const tag = avail[(Math.random() * avail.length) | 0];
    const hold = this.#cfg.upMin + Math.random() * (this.#cfg.upMax - this.#cfg.upMin);
    this.#world.spawnAtHole(hole, RAINBOW[tag], hold, tag);
  }

  #tryUnicorn() {
    if (this.#world.activeTags().includes(UNICORN_TAG)) return; // one at a time
    if (Math.random() >= this.#cfg.unicornChance) return;
    const free = this.#world.freeHoles();
    if (!free.length) return;
    const hole = free[(Math.random() * free.length) | 0];
    const hold = UNICORN_UP_MIN_S + Math.random() * (UNICORN_UP_MAX_S - UNICORN_UP_MIN_S);
    this.#world.spawnAtHole(hole, UNICORN_HEX, hold, UNICORN_TAG, true);
  }

  override update(delta: number) {
    if (this.#world.update(delta) > 0) this.#scoring.missed(); // an actor sank unhit
    this.#scoring.update(delta);

    this.#spawnCooldown -= delta;
    if (this.#spawnCooldown <= 0) {
      this.#spawnCooldown = this.#cfg.spawnEvery + Math.random() * this.#cfg.jitter;
      this.#trySpawn();
      if (Math.random() < 0.3) this.#trySpawn(); // sometimes several at once
      this.#tryUnicorn();
    }

    if (!(__DEV__ && devFlags.pauseTimer)) this.#timeLeft -= delta; // ?tweak can freeze the clock
    const seconds = Math.max(0, Math.ceil(this.#timeLeft));
    if (seconds !== this.#lastShownSecond) {
      this.#lastShownSecond = seconds;
      this.#text.setText(this.#timerLabel!, String(seconds));
      if (seconds > 0 && seconds <= TICK_FROM_S) this.#audio.playSFX('tick'); // final-seconds pulse
    }

    if (this.#timeLeft <= 0) {
      this.#ctx.change(GameOverState);
    }
  }

  override enter() {
    this.#cfg = this.#level.value === 13 ? L13 : LEVELS[Math.min(this.#level.value, LEVEL_COUNT) - 1];
    this.#timeLeft = this.#cfg.roundS ?? ROUND_SECONDS;
    this.#lastShownSecond = -1;
    this.#spawnCooldown = this.#cfg.spawnEvery;
    this.#world.reset();
    this.#scoring.reset(this.#cfg.reps ?? this.#level.value, this.#cfg.snatchAll ?? false); // level N → N taps per color; L13 → 3 + wipe-all unicorn
    this.#timerLabel = this.#text.show(String(Math.ceil(this.#timeLeft)), this.#render.timerAnchor, { color: HUD_TEXT });
    this.#audio.activate();
    this.#audio.playBGM('music'); // looping bed for the round only
  }

  override exit() {
    this.#audio.stopBGM();
    this.#audio.deactivate();
    this.#world.clearSparkles(); // else the winning hit's burst freezes on the Win screen
    this.#scoring.teardown();
    if (this.#timerLabel) { this.#text.remove(this.#timerLabel); this.#timerLabel = null; }
  }
}
