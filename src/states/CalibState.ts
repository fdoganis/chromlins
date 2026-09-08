// Dev-only (`?calib`): guided hand-whack calibration. Reuses the gameplay scene.
// Phase 'place': rest your hand flat on the surface and pinch — the board drops
// to that height (hand tracking, not hit-test, so it works on a Quest 2 whose
// table isn't a scanned plane). Phase 'whack': a target body rises from a hole,
// you whack it, the next rises — N times, auto-paced so it advances even if the
// current thresholds are mistuned. Phase 'idle': a fixed window of NON-whack
// motion (wave, reach, rest) for false-positive data. Phase 'done': pinch to
// save, or just exit XR — either way the capture is POSTed to the dev server
// (vite.config.js /__record sink) and lands in tests/fixtures/. Every frame's
// palm / wrist / index-tip joint poses are logged, tagged by phase, target
// position stamped on hit frames. The whole class folds out of the shipped bundle.
//
// Full run guide (headset setup, tunnel, what to record): tests/tools/README.md
import { Vector3 } from 'three';
import { State } from '../core/State';
import { SelectCommand } from '../commands/SelectCommand';
import { RAINBOW } from '../core/palette';
import type { Game } from '../core/Game';
import type { World } from '../world/World';
import type { RenderingManager } from '../rendering/RenderingManager';
import type { TextManager } from '../text/TextManager';
import type { TextHandle } from '../text/ITextEngine';

const HOLES = [0, 1, 4, 5];                                  // middle row
const JOINTS = ['middle-finger-metacarpal', 'wrist', 'index-finger-tip'] as const;
const KEY = ['m', 'w', 'i'] as const;
const WHACK_TARGETS = 12;
const WHACK_WINDOW_S = 2.5;   // paced fallback advance
const IDLE_S = 15;
const PLACE_TIMEOUT_S = 12;   // in a real session: give up waiting for the pinch, keep current height
const PLACE_Z_m = -0.5;
const TARGET_HEX = RAINBOW[3]; // green — "hit this"

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

type Phase = 'place' | 'whack' | 'idle' | 'done';
type Frame = { t: number; hand: string; phase: Phase; m: number[]; w: number[]; i: number[]; r: number; hit?: number[] };

export class CalibState extends State {
  #ctx: Game;
  #world: World;
  #text: TextManager;
  #render: RenderingManager;

  #phase: Phase = 'place';
  #frames: Frame[] = [];
  #t0 = 0;
  #count = 0;
  #windowT = 0;
  #placeT = 0;
  #idleLeft = IDLE_S;
  #lastPalmY: number | null = null; // most recent metacarpal world Y — used to place the board
  #targetId = -1;
  #targetPos = new Vector3();
  #hud: TextHandle | null = null;
  #sent = false;

  constructor(ctx: Game) {
    super();
    this.#ctx = ctx;
    this.#world = ctx.world;
    this.#text = ctx.text;
    this.#render = ctx.rendering;
    this.on(SelectCommand, this.#onSelect);
  }

  override enter() {
    this.#phase = 'place';
    this.#frames = [];
    this.#t0 = performance.now();
    this.#count = 0;
    this.#windowT = 0;
    this.#placeT = 0;
    this.#idleLeft = IDLE_S;
    this.#lastPalmY = null;
    this.#sent = false;
    this.#hud = this.#text.show('HAND ON TABLE - PINCH', this.#render.timerAnchor, { color: '#ffffff' });
    this.#render.renderer.xr.addEventListener('sessionend', this.#onEnd);
  }

  #onSelect = () => {
    if (this.#phase === 'place') { this.#placeBoard(); this.#toWhack(); }
    else if (this.#phase === 'whack') this.#advance(true);
    else if (this.#phase === 'done') { void this.#send(); this.#setHud('SAVED - EXIT XR'); }
  };

  #placeBoard() {
    if (this.#lastPalmY == null) return; // no hand seen (desktop) — keep the hacked height
    this.#render.anchor.position.set(0, this.#lastPalmY - 0.02, PLACE_Z_m);
    this.#render.anchor.quaternion.identity();
  }

  #toWhack() {
    this.#phase = 'whack';
    this.#setHud('WHACK THE CUBE');
    this.#spawnTarget();
  }

  #spawnTarget() {
    const hole = HOLES[(Math.random() * HOLES.length) | 0];
    this.#targetId = this.#world.spawnAtHole(hole, TARGET_HEX, Infinity, 0);
    this.#world.actorMesh(this.#targetId)?.getWorldPosition(this.#targetPos);
  }

  #advance(hit: boolean) {
    if (this.#targetId >= 0) {
      const r = this.#world.despawnActor(this.#targetId);
      if (r) this.#world.burstSparkles(r.position, r.color, 'explode');
      this.#targetId = -1;
    }
    if (hit && this.#frames.length) {
      this.#frames[this.#frames.length - 1].hit = [r4(this.#targetPos.x), r4(this.#targetPos.y), r4(this.#targetPos.z)];
    }
    this.#count++;
    this.#windowT = 0;
    if (this.#count >= WHACK_TARGETS) {
      this.#phase = 'idle';
      this.#setHud('WAVE  REACH  REST  -  DO NOT HIT');
    } else {
      this.#setHud(`WHACK  ${this.#count}`);
      this.#spawnTarget();
    }
  }

  override update(delta: number, frame?: XRFrame) {
    this.#world.update(delta); // target rise + sparkle bursts
    if (frame) this.#record(frame);

    if (this.#phase === 'place') {
      this.#placeT += delta;
      // no XR at all → move on quickly; a real session → give time to pinch
      if ((!frame && this.#placeT > 2) || this.#placeT > PLACE_TIMEOUT_S) this.#toWhack();
    } else if (this.#phase === 'whack') {
      this.#windowT += delta;
      if (this.#windowT >= WHACK_WINDOW_S) this.#advance(false);
    } else if (this.#phase === 'idle') {
      this.#idleLeft -= delta;
      this.#setHud(`DO NOT HIT  ${Math.max(0, Math.ceil(this.#idleLeft))}`);
      if (this.#idleLeft <= 0) { this.#phase = 'done'; this.#setHud('DONE  -  PINCH TO SAVE'); }
    }
  }

  #record(frame: XRFrame) {
    const ref = this.#render.renderer.xr.getReferenceSpace();
    if (!ref) return;
    const t = Math.round(performance.now() - this.#t0);
    for (const src of frame.session.inputSources) {
      const hand = src.hand;
      if (!hand) continue;
      const rec: Frame = { t, hand: src.handedness, phase: this.#phase, m: [], w: [], i: [], r: 0 };
      let ok = true;
      for (let k = 0; k < JOINTS.length; k++) {
        const space = hand.get(JOINTS[k]);
        const pose = space ? frame.getJointPose?.(space, ref) : null;
        if (!pose) { ok = false; break; }
        const p = pose.transform.position;
        rec[KEY[k]] = [r4(p.x), r4(p.y), r4(p.z)];
        if (k === 0) { rec.r = r4(pose.radius || 0); this.#lastPalmY = p.y; }
      }
      if (ok) this.#frames.push(rec);
    }
  }

  #setHud(text: string) { if (this.#hud) this.#text.setText(this.#hud, text); }

  #onEnd = () => { void this.#send(); };

  async #send() {
    const frames = this.#frames.filter((f) => f.phase !== 'place'); // drop the placement fiddling
    if (this.#sent || !frames.length) return;
    this.#sent = true;
    const body = JSON.stringify({
      ua: navigator.userAgent,
      started: new Date(this.#t0 + performance.timeOrigin).toISOString(),
      frames,
    });
    try { await fetch('/__record?to=calib', { method: 'POST', body }); } catch { /* server gone / offline */ }
  }

  override exit() {
    void this.#send(); // backstop if we leave some other way
    this.#render.renderer.xr.removeEventListener('sessionend', this.#onEnd);
    if (this.#targetId >= 0) this.#world.despawnActor(this.#targetId);
    this.#targetId = -1;
    if (this.#hud) { this.#text.remove(this.#hud); this.#hud = null; }
  }
}
