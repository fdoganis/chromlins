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
import { Object3D, Ray, Vector3 } from 'three';
import type { Game } from '../core/Game';
import type { Screen } from '../core/sm';
import type { SelectCommand } from '../commands/SelectCommand';
import { BODY_HALF_m } from '../world/Actor';
import { RAINBOW, HUD_TEXT } from '../core/palette';
import type { TextHandle } from '../text/ITextEngine';

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

type Slot = { id: number; label: TextHandle; carrier: Object3D; char: string; locked: boolean };

export function makeNameEntry(ctx: Game): Screen {
  const { world, text, rendering: render, score, level, hiScore: hi } = ctx;

  let slots: Slot[] = [];
  let okId = -1;
  let okLabel: TextHandle | undefined;
  let okCarrier: Object3D | undefined;
  let prompt: TextHandle;
  let t = 0;
  let exitIn = -1;     // >= 0 once OK is confirmed: seconds until we leave
  let next = 'intro';  // where the beat leads — 'run' (level 13) on "13K"

  const charNow = (): string => CHARS[Math.floor(t / STEP_S) % CHARS.length];

  // A label parented straight to the actor mesh sits at the capsule's centre —
  // buried in the body. Hang it on a carrier lifted just above the capsule top;
  // the carrier rides the mesh's rise and the voxel engine billboards it.
  const labelOn = (id: number, str: string): { label: TextHandle; carrier: Object3D } => {
    const carrier = new Object3D();
    carrier.position.y = BODY_HALF_m + 0.045;
    (world.actorMesh(id) ?? render.anchor).add(carrier);
    return { label: text.show(str, carrier, { color: HUD_TEXT }), carrier };
  };

  const drop = (label: TextHandle, carrier: Object3D): void => {
    text.remove(label);
    carrier.parent?.remove(carrier);
  };

  const raiseSlot = (i: number): void => {
    const id = world.spawnAtHole(HOLES[i], RAINBOW[PAIR[i][0]], Infinity, i);
    if (id < 0) return;
    const { label, carrier } = labelOn(id, charNow());
    slots.push({ id, label, carrier, char: charNow(), locked: false });
  };

  const raiseOk = (): void => {
    okId = world.spawnAtHole(HOLES[3], OK_HEX, Infinity, OK_TAG);
    if (okId < 0) return;
    const { label, carrier } = labelOn(okId, 'OK');
    okLabel = label;
    okCarrier = carrier;
  };

  const lockedCount = (): number => {
    let n = 0;
    for (const s of slots) if (s.locked) n++;
    return n;
  };

  // Standard hit explosion at the actor's position, then remove it.
  const burst = (id: number): void => {
    const r = world.despawnActor(id);
    if (r) world.burstSparkles(r.position, r.color, 'explode');
  };

  const dropOk = (): void => {
    if (okLabel && okCarrier) drop(okLabel, okCarrier);
    okLabel = undefined;
    okCarrier = undefined;
  };

  const sinkOk = (): void => {
    burst(okId);
    dropOk();
    okId = -1;
  };

  const confirm = (): void => {
    if (slots.length < 3 || lockedCount() < 3) return;

    const name = slots.map((s) => s.char).join('');
    hi.submit(score.value, name);

    for (const s of slots) { burst(s.id); drop(s.label, s.carrier); }
    burst(okId);
    dropOk();
    slots = [];
    okId = -1;

    if (name === L13_NAME) {
      try { localStorage.setItem('chromlins.l13', '1'); } catch { /* not persisted */ }
      text.setText(prompt, '13 UNLOCKED');
      level.set(13);
      next = 'run'; // straight into the L13 run after the beat
    } else {
      text.setText(prompt, 'SAVED');
    }
    exitIn = EXIT_BEAT_S;
  };

  return {
    enter() {
      t = 0;
      exitIn = -1;
      next = 'intro';
      slots = [];
      okId = -1;
      prompt = text.show('NEW HI', render.hudAnchor, { color: HUD_TEXT });
      raiseSlot(0);
    },

    update(delta: number): void {
      world.update(delta); // ticks the actor rise + the sparkle bursts
      t += delta;

      if (exitIn >= 0) {
        exitIn -= delta;
        if (exitIn <= 0) ctx.change(next);
        return;
      }

      const c = charNow();
      for (const s of slots) {
        if (s.locked || s.char === c) continue;
        s.char = c;
        text.setText(s.label, c);
      }
    },

    select(cmd: SelectCommand): void {
      if (exitIn >= 0) return;

      _o.setFromMatrixPosition(cmd.transform.matrixWorld);
      _d.set(0, 0, -1).transformDirection(cmd.transform.matrixWorld);
      const hit = world.hitTestActor(_ray.set(_o, _d), cmd.reach || undefined);
      if (!hit) return;
      const id = hit.id;

      if (id === okId) { confirm(); return; }

      const s = slots.find((x) => x.id === id);
      if (!s) return;
      const i = slots.indexOf(s);

      if (s.locked) {
        s.locked = false;
        world.recolorActor(s.id, RAINBOW[PAIR[i][0]]);
        if (okId >= 0 && lockedCount() < 3) sinkOk(); // fewer than 3 locked -> OK goes away
      } else {
        s.locked = true;
        world.recolorActor(s.id, RAINBOW[PAIR[i][1]]);
        if (i < 2 && slots.length === i + 1) raiseSlot(i + 1);
        else if (slots.length === 3 && lockedCount() === 3 && okId < 0) raiseOk();
      }
    },

    exit(): void {
      for (const s of slots) { drop(s.label, s.carrier); world.despawnActor(s.id); }
      slots = [];
      if (okId >= 0) world.despawnActor(okId);
      okId = -1;
      dropOk();
      text.remove(prompt);
      exitIn = -1;
    },
  };
}
