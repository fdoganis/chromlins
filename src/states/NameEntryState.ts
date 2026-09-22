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
// ray/proximity hit query, the same Sparkles burst, and the run's own feedback
// on every whack (World.touch plays the standard 'hit' cue, a whiff gets the
// same puff + 'miss' cue via World.whiff, and the controller gets its pulse).
import { Object3D } from 'three';
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

type Slot = { id: number; label: TextHandle; carrier: Object3D; char: string; locked: boolean };

export function makeNameEntry(ctx: Game): Screen {
  const { world, text, haptics, rendering: render, score, level, hiScore: hi } = ctx;

  let slots: Slot[] = [];
  let ok: Slot | undefined;
  let prompt: TextHandle;
  let t = 0;
  let exitIn = -1;     // >= 0 once OK is confirmed: seconds until we leave
  let next = 'intro';  // where the beat leads — 'run' (level 13) on "13K"

  const charNow = (): string => CHARS[Math.floor(t / STEP_S) % CHARS.length];
  const lockedCount = (): number => slots.filter((s) => s.locked).length;

  // A label parented straight to the actor mesh sits at the capsule's centre —
  // buried in the body. Hang it on a carrier lifted just above the capsule top;
  // the carrier rides the mesh's rise and the voxel engine billboards it.
  const raise = (hole: number, hex: string, tag: number, str: string): Slot | undefined => {
    const id = world.spawnAtHole(hole, hex, Infinity, tag);
    if (id < 0) return;
    const carrier = new Object3D();
    carrier.position.y = BODY_HALF_m + 0.045;
    (world.actorMesh(id) ?? render.anchor).add(carrier);
    return { id, label: text.show(str, carrier, { color: HUD_TEXT }), carrier, char: str, locked: false };
  };

  const raiseSlot = (i: number): void => {
    const s = raise(HOLES[i], RAINBOW[PAIR[i][0]], i, charNow());
    if (s) slots.push(s);
  };

  // Remove a slot's actor and label; `explode` first bursts it (the standard hit explosion).
  const lower = (s: Slot, explode: boolean): void => {
    const r = world.despawnActor(s.id);
    if (explode && r) world.burstSparkles(r.position, r.color, 'explode');
    text.remove(s.label);
    s.carrier.parent?.remove(s.carrier);
  };

  const clear = (explode: boolean): void => {
    for (const s of ok ? [...slots, ok] : slots) lower(s, explode);
    slots = [];
    ok = undefined;
  };

  const confirm = (): void => {
    const name = slots.map((s) => s.char).join('');
    hi.submit(score.value, name);
    clear(true);

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
      next = 'intro';
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

      const hit = world.touch(cmd.ray, cmd.reach || undefined); // same 'hit' cue as the run
      if (!hit) { world.whiff(cmd.ray); return; }    // same whiff puff + 'miss' cue
      haptics.pulse(cmd.handedness);
      if (hit.id === ok?.id) { confirm(); return; }

      const i = slots.findIndex((x) => x.id === hit.id);
      if (i < 0) return;
      const s = slots[i];

      s.locked = !s.locked;
      world.recolorActor(s.id, RAINBOW[PAIR[i][+s.locked]]);
      if (!s.locked) {
        if (ok) { lower(ok, true); ok = undefined; } // OK is only up while all three are locked
      } else if (i < 2 && slots.length === i + 1) {
        raiseSlot(i + 1);
      } else if (!ok && lockedCount() === 3) {
        ok = raise(HOLES[3], OK_HEX, OK_TAG, 'OK');
      }
    },

    exit(): void {
      clear(false);
      text.remove(prompt);
      exitIn = -1;
    },
  };
}
