// The wordless opening sequence, extracted from IntroState so it stays out of a
// BUILD === 'light' build entirely (IntroState only references this module
// inside a folded `if (BUILD === 'deluxe')` branch → it tree-shakes out).
//
// Beats: the rainbow draws in L→R · a cream unicorn bobs at the crown · then, one
// colour at a time (staggered), a pair of eyes rises from a hole, the matching
// arc bursts, the burst converges onto the eyes, that arc drains and the body
// snaps in around the eyes with an absorb-flash — the spirit has taken the
// colour. When all seven are gone the unicorn drops into the last hole → done.
//
// Re-choreographs existing parts: Rainbow, Sparkles (explode + converge), the
// Chromlin / Unicorn rigs (its own instances), Timeline.
import { Color, Vector3, MathUtils } from 'three';
import type { Game } from '../core/Game';
import type { World } from '../world/World';
import type { AudioManager } from '../audio/AudioManager';
import type { RenderingManager } from '../rendering/RenderingManager';
import { Timeline } from '../animation/Timeline';
import type { Beat } from '../animation/Timeline';
import { easeOutCubic } from '../animation/Easing';
import { RAINBOW } from '../core/palette';
import { Chromlin } from '../world/Chromlin';
import { Unicorn } from '../world/Unicorn';

const ARCS = RAINBOW.length;
const CREAM = '#f3ead7';

const REVEAL_S = 1.2;         // rainbow sweeps in over this
const STEAL_START_S = 3.0;    // first colour is taken at this time
const STEAL_STEP_S = 0.55;    // stagger between colours
const RISE_S = 0.35;          // an eye rig rising out of its hole
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

type EyeRig = { c: Chromlin; col: Color; riseAt: number; capAt: number };

export class Cinematic {
  #world: World;
  #audio: AudioManager;
  #render: RenderingManager;
  #onDone: () => void;

  #uni: Unicorn;
  #eyes: EyeRig[] = [];
  #tl: Timeline | null = null;
  #outroAt = Infinity;
  #done = false;

  constructor(ctx: Game, onDone: () => void) {
    this.#world = ctx.world;
    this.#audio = ctx.audio;
    this.#render = ctx.rendering;
    this.#onDone = onDone;

    const anchor = ctx.rendering.anchor;
    this.#uni = new Unicorn(anchor);
    this.#uni.recolor(CREAM);
    for (let i = 0; i < ARCS; i++) {
      this.#eyes.push({ c: new Chromlin(anchor), col: new Color(RAINBOW[i]), riseAt: Infinity, capAt: Infinity });
    }
    this.#hide();
  }

  #hide(): void {
    this.#uni.mesh.visible = false;
    for (const e of this.#eyes) e.c.mesh.visible = false;
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
      const e = this.#eyes[i];
      b.push({ at: t0, fn: () => { e.c.mesh.visible = true; e.c.mesh.material.visible = false; e.riseAt = this.#tl!.time; this.#chirp('spawn'); } });
      b.push({ at: t0 + 0.22, fn: () => this.#world.burstSparkles(this.#world.rainbowArcApex(i, _v), e.col, 'explode') });
      b.push({ at: t0 + 0.42, fn: () => { this.#world.burstSparkles(e.c.mesh.getWorldPosition(_v), e.col, 'converge'); this.#chirp('unicorn'); } });
      b.push({ at: t0 + 0.52, fn: () => { this.#world.setRainbowFill(i, 0); e.c.mesh.material.visible = true; e.c.recolor(`#${e.col.getHexString()}`); e.capAt = this.#tl!.time; } });
    }
    b.push({ at: STEAL_START_S + ARCS * STEAL_STEP_S + OUTRO_LEAD_S, fn: () => { this.#outroAt = this.#tl!.time; this.#chirp('over'); } });
    return b;
  }

  skip(): void {
    if (!this.#done) { this.#done = true; this.#onDone(); }
  }

  begin(): void {
    this.#done = false;
    this.#outroAt = Infinity;
    this.#uni.mesh.visible = true;
    this.#uni.mesh.position.set(0, CROWN_Y_m, CROWN_Z_m);
    for (let i = 0; i < ARCS; i++) {
      const e = this.#eyes[i];
      e.c.mesh.visible = false;
      e.c.mesh.material.visible = true;
      e.c.mesh.material.emissive.setScalar(0);
      this.#world.holePoint(i, _v);
      e.c.mesh.position.set(_v.x, HIDDEN_Y_m, _v.z);
      e.riseAt = Infinity;
      e.capAt = Infinity;
      this.#world.setRainbowFill(i, 0);
    }
    this.#tl = new Timeline(this.#buildBeats());
  }

  update(delta: number): void {
    if (this.#done || !this.#tl) return;
    this.#tl.tick(delta);
    const t = this.#tl.time;

    this.#render.camera.getWorldPosition(_cam);
    this.#world.update(delta); // keeps Sparkles ticking during the cinematic

    if (t < REVEAL_S) {
      for (let i = 0; i < ARCS; i++) this.#world.setRainbowFill(i, MathUtils.clamp((t / REVEAL_S) * ARCS - i, 0, 1));
    }

    if (t < this.#outroAt) {
      this.#uni.mesh.position.set(0, CROWN_Y_m + Math.sin(t * 5) * 0.03, CROWN_Z_m);
    } else {
      const k = MathUtils.clamp((t - this.#outroAt) / DROP_S, 0, 1);
      this.#world.holePoint(ARCS, _v); // the 8th hole
      this.#uni.mesh.position.set(
        MathUtils.lerp(0, _v.x, k),
        MathUtils.lerp(CROWN_Y_m, HIDDEN_Y_m, k * k),
        MathUtils.lerp(CROWN_Z_m, _v.z, k),
      );
      this.#uni.mesh.visible = k < 1;
    }
    this.#uni.animate(delta, 0, _cam);

    for (const e of this.#eyes) {
      if (e.riseAt < Infinity) {
        const r = MathUtils.clamp((t - e.riseAt) / RISE_S, 0, 1);
        e.c.mesh.position.y = MathUtils.lerp(HIDDEN_Y_m, PEEK_Y_m, easeOutCubic(r));
      }
      if (e.capAt < Infinity) {
        const d2 = t - e.capAt;
        e.c.mesh.material.emissive.copy(e.col).multiplyScalar(d2 < FLASH_S ? (Math.sin(d2 * 46) > 0 ? 0.9 : 0.12) : 0.16);
      }
      e.c.animate(delta, 0, _cam);
    }

    if (t >= END_S) this.skip();
  }

  end(): void {
    this.#hide();
    this.#tl = null;
  }
}
