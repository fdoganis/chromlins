// Beat the hi-score -> sign your initials by whacking them, whack-a-mole style.
// Three letter cylinders rise one at a time from the middle row of holes, each
// with a voxel char on top that auto-cycles the HUD charset. Whack a cycling one
// to freeze its char (it recolours to its "locked" rainbow shade and the next
// slot rises); whack a locked one to unfreeze it (recolours back, resumes
// cycling). A violet OK cylinder rises once all three are locked and sinks again
// if you unlock one. Whack OK -> every cylinder bursts (standard hit explosion),
// HiScore.submit, -> Intro (or straight into level 13 if you signed "13K").
//
// Reuses the gameplay loop: World's Actors for the rising bodies, the same
// ray/proximity hit query, the same Sparkles burst.
import { Ray, Vector3 } from 'three';
import { State } from '../core/State';
import { SelectCommand } from '../commands/SelectCommand';
import { IntroState } from './IntroState';
import { RunState } from './RunState';
import { RAINBOW } from '../core/palette';
import type { ClassOf } from '../types/ClassOf';
import type { Ctx } from '../core/Ctx';
import type { World } from '../world/World';
import type { RenderingManager } from '../rendering/RenderingManager';
import type { TextManager } from '../text/TextManager';
import type { TextHandle } from '../text/ITextEngine';
import type { Score } from '../core/Score';
import type { Level } from '../core/Level';
import type { HiScore } from '../core/HiScore';

// The whole 'light' glyph set — same as the HUD, nothing extra to ship.
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -+';
const STEP_S = 0.28;                       // seconds per cycled character — slow enough to read + aim a whack
const HOLES = [0, 1, 4, 5];               // middle row, left -> right: slots A/B/C, then OK
const PAIR = [[0, 1], [2, 3], [4, 5]];    // per slot: [cycling, locked] RAINBOW indices — red<->orange, yellow<->green, blue<->indigo
const OK_TAG = 3;
const OK_HEX = RAINBOW[6];                // violet
const L13_NAME = '13K';                   // sign this to unlock level 13
const EXIT_BEAT_S = 1.6;                  // hold on the explosion + message before Intro

const _o = new Vector3();
const _d = new Vector3();
const _ray = new Ray();

type Slot = { id: number; label: TextHandle; char: string; locked: boolean };

export class NameEntryState extends State {
  #sm: Ctx;
  #world: World;
  #text: TextManager;
  #render: RenderingManager;
  #score: Score;
  #level: Level;
  #hi: HiScore;

  #slots: Slot[] = [];
  #okId = -1;
  #okLabel: TextHandle | undefined;
  #prompt!: TextHandle;
  #t = 0;
  #exitIn = -1;               // >= 0 once OK is confirmed: seconds until we leave
  #next: ClassOf<State> = IntroState; // where the beat leads — Run (level 13) on "13K"

  constructor(ctx: Ctx) {
    super();
    this.#sm = ctx;
    this.#world = ctx.world;
    this.#text = ctx.text;
    this.#render = ctx.render;
    this.#score = ctx.score;
    this.#level = ctx.level;
    this.#hi = ctx.hiScore;
    this.on(SelectCommand, this.#onSelect);
  }

  #char(): string { return CHARS[Math.floor(this.#t / STEP_S) % CHARS.length]; }

  override enter() {
    this.#t = 0;
    this.#exitIn = -1;
    this.#next = IntroState;
    this.#slots = [];
    this.#okId = -1;
    this.#prompt = this.#text.show('NEW HI', this.#render.hudAnchor, { color: '#ffcc33' });
    this.#raiseSlot(0);
  }

  #raiseSlot(i: number): void {
    const id = this.#world.spawnAtHole(HOLES[i], RAINBOW[PAIR[i][0]], Infinity, i);
    if (id < 0) return;
    const label = this.#text.show(this.#char(), this.#actorAnchor(id), { color: '#ffffff' }); // readable on any rainbow body
    this.#slots.push({ id, label, char: this.#char(), locked: false });
  }

  #raiseOk(): void {
    this.#okId = this.#world.spawnAtHole(HOLES[3], OK_HEX, Infinity, OK_TAG);
    if (this.#okId < 0) return;
    this.#okLabel = this.#text.show('OK', this.#actorAnchor(this.#okId), { color: '#ffffff' });
  }

  // The label rides the actor's mesh so it lifts with the rise; the voxel engine
  // billboards it regardless.
  #actorAnchor(id: number) {
    return this.#world.actorMesh(id) ?? this.#render.anchor;
  }

  override update(delta: number): void {
    this.#world.update(delta); // ticks the actor rise + the sparkle bursts
    this.#t += delta;

    if (this.#exitIn >= 0) {
      this.#exitIn -= delta;
      if (this.#exitIn <= 0) this.#sm.change(this.#next);
      return;
    }

    const c = this.#char();
    for (const s of this.#slots) {
      if (s.locked || s.char === c) continue;
      s.char = c;
      this.#text.setText(s.label, c);
    }
  }

  #onSelect = (cmd: SelectCommand): void => {
    if (this.#exitIn >= 0) return;

    let id: number;
    if (__DEV__ && cmd.debugRandom) {
      const next = this.#slots.find((s) => !s.locked); // keyboard: act on the first cycling slot, else OK
      id = next ? next.id : this.#okId;
    } else {
      _o.setFromMatrixPosition(cmd.transform.matrixWorld);
      _d.set(0, 0, -1).transformDirection(cmd.transform.matrixWorld);
      const hit = this.#world.hitTestActor(_ray.set(_o, _d), cmd.reach || undefined);
      if (!hit) return;
      id = hit.id;
    }

    if (id === this.#okId) { this.#confirm(); return; }

    const s = this.#slots.find((x) => x.id === id);
    if (!s) return;
    const i = this.#slots.indexOf(s);

    if (s.locked) {
      s.locked = false;
      this.#world.recolorActor(s.id, RAINBOW[PAIR[i][0]]);
      if (this.#okId >= 0 && this.#lockedCount() < 3) this.#sinkOk(); // fewer than 3 locked -> OK goes away
    } else {
      s.locked = true;
      this.#world.recolorActor(s.id, RAINBOW[PAIR[i][1]]);
      if (i < 2 && this.#slots.length === i + 1) this.#raiseSlot(i + 1);
      else if (this.#slots.length === 3 && this.#lockedCount() === 3 && this.#okId < 0) this.#raiseOk();
    }
  };

  #lockedCount(): number {
    let n = 0;
    for (const s of this.#slots) if (s.locked) n++;
    return n;
  }

  #sinkOk(): void {
    this.#burst(this.#okId);
    if (this.#okLabel) { this.#text.remove(this.#okLabel); this.#okLabel = undefined; }
    this.#okId = -1;
  }

  #confirm(): void {
    if (this.#slots.length < 3 || this.#lockedCount() < 3) return;

    const name = this.#slots.map((s) => s.char).join('');
    this.#hi.submit(this.#score.value, name);

    for (const s of this.#slots) { this.#burst(s.id); this.#text.remove(s.label); }
    this.#burst(this.#okId);
    if (this.#okLabel) { this.#text.remove(this.#okLabel); this.#okLabel = undefined; }
    this.#slots = [];
    this.#okId = -1;

    if (name === L13_NAME) {
      try { localStorage.setItem('gamma.l13', '1'); } catch { /* not persisted */ }
      this.#text.setText(this.#prompt, '13 UNLOCKED');
      this.#level.set(13);
      this.#next = RunState; // straight into the L13 run after the beat
    } else {
      this.#text.setText(this.#prompt, 'SAVED');
    }
    this.#exitIn = EXIT_BEAT_S;
  }

  // Standard hit explosion at the actor's position, then remove it.
  #burst(id: number): void {
    const r = this.#world.despawnActor(id);
    if (r) this.#world.burstSparkles(r.position, r.color, 'explode');
  }

  override exit(): void {
    for (const s of this.#slots) { this.#text.remove(s.label); this.#world.despawnActor(s.id); }
    this.#slots = [];
    if (this.#okId >= 0) this.#world.despawnActor(this.#okId);
    this.#okId = -1;
    if (this.#okLabel) { this.#text.remove(this.#okLabel); this.#okLabel = undefined; }
    this.#text.remove(this.#prompt);
    this.#exitIn = -1;
  }
}
