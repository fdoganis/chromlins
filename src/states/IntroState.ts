// The wordless opening cinematic (replaces the old "TAP TO START" card). Reached
// after AnchorState the first time, and straight from GameOver / Win / NameEntry
// on a replay (the board is already placed). A SelectCommand skips it.
//
// Beats: the rainbow draws in L→R · a cream unicorn bobs at the crown · then, one
// colour at a time (staggered), a pair of eyes rises from a hole, the matching
// arc bursts, the burst converges onto the eyes, that arc drains and a coloured
// body fades in around the eyes with a flash — the spirit has taken the colour.
// When all seven are gone the unicorn drops into the last hole → RunState.
//
// Everything here is re-choreographed existing parts: Rainbow, Sparkles (explode
// + converge), dressGhost / dressUnicorn, the shared capsule geo, Timeline.
import { Mesh, MeshPhongMaterial, Color, Vector3, MathUtils } from 'three';
import type { BufferGeometry } from 'three';
import { State } from '../core/State';
import type { ITransition } from '../core/StateMachine';
import { SelectCommand } from '../commands/SelectCommand';
import { RunState } from './RunState';
import type { Score } from '../core/Score';
import type { Level } from '../core/Level';
import type { World } from '../world/World';
import type { AudioManager } from '../audio/AudioManager';
import type { RenderingManager } from '../rendering/RenderingManager';
import { Timeline } from '../animation/Timeline';
import type { Beat } from '../animation/Timeline';
import { easeOutCubic } from '../animation/Easing';
import { RAINBOW } from '../core/palette';
import { CAPSULE_GEO, BODY_HALF_m } from '../world/Actors';
import { dressGhost } from '../world/ghostEyes';
import { dressUnicorn } from '../world/unicorn';

const ARCS = RAINBOW.length;
const CREAM = 0xf3ead7;

const REVEAL_S = 1.2;         // rainbow sweeps in over this
const STEAL_START_S = 3.0;    // first colour is taken at this time
const STEAL_STEP_S = 0.55;    // stagger between colours
const RISE_S = 0.35;          // an eye rig rising out of its hole
const CAP_GROW_S = 0.4;       // the coloured body fading in
const FLASH_S = 0.45;         // absorb-flash duration
const OUTRO_LEAD_S = 0.7;     // gap after the last steal before the unicorn drops
const DROP_S = 0.7;
const END_S = STEAL_START_S + ARCS * STEAL_STEP_S + OUTRO_LEAD_S + DROP_S + 0.6;

const HIDDEN_Y_m = -0.16;     // eye rig / unicorn tucked below the rim
const PEEK_Y_m = -0.02;
const CROWN_Y_m = 0.30;       // unicorn bob height, near the rainbow crown
const CROWN_Z_m = -0.34;

const _v = new Vector3();
const _cam = new Vector3();

type EyeRig = {
  rig: Mesh<BufferGeometry, MeshPhongMaterial>;
  tick: (d: number, ySpeed: number, camPos: Vector3) => void;
  col: Color;
  riseAt: number;
  capAt: number;
};

export class IntroState extends State {
  #sm: ITransition;
  #world: World;
  #audio: AudioManager;
  #render: RenderingManager;
  #score: Score;
  #level: Level;

  #uni: Mesh<BufferGeometry, MeshPhongMaterial>;
  #uniTick: (d: number, ySpeed: number, camPos: Vector3) => void;
  #eyes: EyeRig[] = [];
  #tl: Timeline | null = null;
  #outroAt = Infinity;
  #done = false;

  constructor(sm: ITransition, world: World, audio: AudioManager, render: RenderingManager, score: Score, level: Level) {
    super();
    this.#sm = sm;
    this.#world = world;
    this.#audio = audio;
    this.#render = render;
    this.#score = score;
    this.#level = level;

    const anchor = render.anchor;
    this.#uni = new Mesh(CAPSULE_GEO, new MeshPhongMaterial({ color: CREAM }));
    anchor.add(this.#uni);
    this.#uniTick = dressUnicorn(this.#uni, BODY_HALF_m).update;

    for (let i = 0; i < ARCS; i++) {
      const rig = new Mesh(CAPSULE_GEO, new MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      this.#world.holePoint(i, _v);
      rig.position.set(_v.x, HIDDEN_Y_m, _v.z);
      anchor.add(rig);
      this.#eyes.push({ rig, tick: dressGhost(rig, BODY_HALF_m).update, col: new Color(RAINBOW[i]), riseAt: Infinity, capAt: Infinity });
    }

    this.#hideAll();
    this.on(SelectCommand, this.#skip);
  }

  #hideAll(): void {
    this.#uni.visible = false;
    for (const e of this.#eyes) e.rig.visible = false;
  }

  #chirp(id: string): void {
    try { this.#audio.playSFX(id); } catch { /* audio may be unavailable */ }
  }

  #buildBeats(): Beat[] {
    const b: Beat[] = [
      { at: REVEAL_S * 0.4, fn: () => this.#chirp('spawn') },
      { at: REVEAL_S, fn: () => { for (let i = 0; i < ARCS; i++) this.#world.setRainbowFill(i, 1); } },
    ];
    for (let i = 0; i < ARCS; i++) {
      const t0 = STEAL_START_S + i * STEAL_STEP_S;
      b.push({ at: t0, fn: () => { this.#eyes[i].rig.visible = true; this.#eyes[i].riseAt = this.#tl!.time; this.#chirp('spawn'); } });
      b.push({ at: t0 + 0.22, fn: () => this.#world.burstSparkles(this.#world.rainbowArcApex(i, _v), this.#eyes[i].col, 'explode') });
      b.push({ at: t0 + 0.42, fn: () => { this.#world.burstSparkles(this.#eyes[i].rig.getWorldPosition(_v), this.#eyes[i].col, 'converge'); this.#chirp('unicorn'); } });
      b.push({ at: t0 + 0.52, fn: () => { this.#world.setRainbowFill(i, 0); this.#eyes[i].capAt = this.#tl!.time; } });
    }
    b.push({ at: STEAL_START_S + ARCS * STEAL_STEP_S + OUTRO_LEAD_S, fn: () => { this.#outroAt = this.#tl!.time; this.#chirp('over'); } });
    return b;
  }

  #skip = () => { if (!this.#done) this.#finish(); };

  #finish(): void {
    this.#done = true;
    this.#sm.change(RunState);
  }

  override enter(): void {
    this.#score.reset();
    this.#level.reset();
    this.#done = false;
    this.#outroAt = Infinity;

    this.#uni.visible = true;
    this.#uni.position.set(0, CROWN_Y_m, CROWN_Z_m);
    for (let i = 0; i < ARCS; i++) {
      const e = this.#eyes[i];
      e.rig.visible = false; // shown by its own rise beat
      this.#world.holePoint(i, _v);
      e.rig.position.set(_v.x, HIDDEN_Y_m, _v.z);
      e.rig.material.opacity = 0;
      e.rig.material.color.setRGB(1, 1, 1);
      e.rig.material.emissive.setScalar(0);
      e.riseAt = Infinity;
      e.capAt = Infinity;
      this.#world.setRainbowFill(i, 0);
    }
    this.#tl = new Timeline(this.#buildBeats());
  }

  override update(delta: number): void {
    if (this.#done || !this.#tl) return;
    this.#tl.tick(delta);
    const t = this.#tl.time;

    this.#render.camera.getWorldPosition(_cam);
    this.#world.update(delta); // keeps Sparkles ticking during the cinematic

    if (t < REVEAL_S) {
      for (let i = 0; i < ARCS; i++) this.#world.setRainbowFill(i, MathUtils.clamp((t / REVEAL_S) * ARCS - i, 0, 1));
    }

    if (t < this.#outroAt) {
      this.#uni.position.set(0, CROWN_Y_m + Math.sin(t * 5) * 0.03, CROWN_Z_m);
    } else {
      const k = MathUtils.clamp((t - this.#outroAt) / DROP_S, 0, 1);
      this.#world.holePoint(ARCS, _v); // the 8th hole
      this.#uni.position.set(
        MathUtils.lerp(0, _v.x, k),
        MathUtils.lerp(CROWN_Y_m, HIDDEN_Y_m, k * k),
        MathUtils.lerp(CROWN_Z_m, _v.z, k),
      );
      this.#uni.visible = k < 1;
    }
    this.#uniTick(delta, 0, _cam);

    for (const e of this.#eyes) {
      if (e.riseAt < Infinity) {
        const r = MathUtils.clamp((t - e.riseAt) / RISE_S, 0, 1);
        e.rig.position.y = MathUtils.lerp(HIDDEN_Y_m, PEEK_Y_m, easeOutCubic(r));
      }
      if (e.capAt < Infinity) {
        e.rig.material.opacity = MathUtils.clamp((t - e.capAt) / CAP_GROW_S, 0, 1);
        e.rig.material.color.copy(e.col);
        const d2 = t - e.capAt;
        e.rig.material.emissive.copy(e.col).multiplyScalar(d2 < FLASH_S ? (Math.sin(d2 * 46) > 0 ? 0.9 : 0.12) : 0.16);
      }
      e.tick(delta, 0, _cam);
    }

    if (t >= END_S) this.#finish();
  }

  override exit(): void {
    this.#hideAll();
    this.#tl = null;
  }
}
