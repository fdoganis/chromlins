// The scoring + feedback side of a round, split out of RunState: the streak, the
// running Score, how many of each rainbow color are in (level N needs N each),
// the "+N" popups, and the unicorn penalty. RunState owns the spawn scheduler,
// the countdown and the transitions — it just asks Scoring "is this color done?"
// / "did this hit win the round?" and forwards misses.
import { Object3D } from 'three';
import type { Vector3 } from 'three';
import type { Game } from '../core/Game';
import type { World } from '../world/World';
import type { RemovedActor } from '../world/Actors';
import type { RenderingManager } from '../rendering/RenderingManager';
import type { Score } from '../core/Score';
import type { TextManager } from '../text/TextManager';
import type { TextHandle } from '../text/ITextEngine';
import { RAINBOW, HUD_TEXT } from '../core/palette';

const POINTS_PER_STREAK = 100; // k-th unbroken collect scores k * this
const TIME_BONUS_PER_S = 50;   // leftover seconds → points on a win
const PENALTY_PTS = 200;       // docked when the unicorn is tapped with no color to snatch back
const UNICORN_HEX = '#f3ead7'; // cream — popup color for a decoy hit

const POPUP_LIFE_S = 0.9;
const POPUP_RISE_MPS = 0.28;    // metres/s the "+N" drifts upward
const POPUP_BLINK_FROM_S = 0.5; // start the Pac-Man/DK blink here
const POPUP_BLINK_HZ = 8;

type Popup = { handle: TextHandle; obj: Object3D; t: number };

export class Scoring {
  #world: World;
  #text: TextManager;
  #render: RenderingManager;
  #score: Score;

  #streak = 0;
  #reps = 1;                                 // taps needed per color this level
  #snatchAll = false;                        // L13: a unicorn tap wipes every color
  #counts = new Uint8Array(RAINBOW.length);  // taps landed per color
  #order: number[] = [];                     // one entry per landed tap — the unicorn pops the last
  #popups: Popup[] = [];
  #label: TextHandle | null = null;

  constructor(ctx: Game) {
    this.#world = ctx.world;
    this.#text = ctx.text;
    this.#render = ctx.rendering;
    this.#score = ctx.score;
  }

  isColorDone(i: number): boolean { return this.#counts[i] >= this.#reps; }

  // A normal (non-unicorn) hit: bump the streak, score k*100, float a "+N"
  // popup, add one to this color's count and update its arc gauge. Returns true
  // when that hit completed every color (RunState then awards the time bonus).
  collect(removed: RemovedActor): boolean {
    this.#streak += 1;
    const pts = this.#streak * POINTS_PER_STREAK;
    this.#score.add(pts);
    this.#text.setText(this.#label!, String(this.#score.value));
    this.#popup(removed.position, `#${removed.color.getHexString()}`, pts);

    const tag = removed.tag;
    this.#counts[tag] += 1;
    this.#order.push(tag);
    this.#world.setRainbowFill(tag, this.#counts[tag] / this.#reps);

    return this.#counts.every((c) => c >= this.#reps);
  }

  // Tapped the decoy. Break the streak and take one tap back off the
  // most-recent color (its gauge drops); with nothing to take, dock points.
  // On L13 (snatchAll) it wipes every color instead.
  hitUnicorn(pos: Vector3): void {
    this.#streak = 0;
    if (this.#snatchAll) {
      this.#counts.fill(0);
      this.#order.length = 0;
      for (let i = 0; i < RAINBOW.length; i++) this.#world.setRainbowFill(i, 0);
      this.#popup(pos, UNICORN_HEX, -1);
      return;
    }
    const lost = this.#order.pop();
    if (lost !== undefined && this.#counts[lost] > 0) {
      this.#counts[lost] -= 1;
      this.#world.setRainbowFill(lost, this.#counts[lost] / this.#reps);
      this.#popup(pos, UNICORN_HEX, -1);
    } else {
      this.#score.add(-PENALTY_PTS);
      this.#text.setText(this.#label!, String(this.#score.value));
      this.#popup(pos, UNICORN_HEX, -PENALTY_PTS);
    }
  }

  missed(): void { this.#streak = 0; } // an actor sank unhit

  awardTimeBonus(timeLeft: number): void {
    this.#score.add(Math.max(0, Math.ceil(timeLeft)) * TIME_BONUS_PER_S);
  }

  update(delta: number): void {
    for (let i = this.#popups.length - 1; i >= 0; i--) {
      const p = this.#popups[i];
      p.t += delta;
      p.obj.position.y += POPUP_RISE_MPS * delta;
      if (p.t >= POPUP_BLINK_FROM_S) {
        this.#text.setVisible(p.handle, Math.floor(p.t * POPUP_BLINK_HZ) % 2 === 0);
      }
      if (p.t >= POPUP_LIFE_S) {
        this.#text.remove(p.handle);
        this.#render.anchor.remove(p.obj);
        this.#popups.splice(i, 1);
      }
    }
  }

  reset(reps: number, snatchAll = false): void {
    this.#reps = reps;
    this.#snatchAll = snatchAll;
    this.#streak = 0;
    this.#counts.fill(0);
    this.#order.length = 0;
    this.#label = this.#text.show(String(this.#score.value), this.#render.scoreAnchor, { color: HUD_TEXT });
  }

  teardown(): void {
    if (this.#label) { this.#text.remove(this.#label); this.#label = null; }
    for (const p of this.#popups) { this.#text.remove(p.handle); this.#render.anchor.remove(p.obj); }
    this.#popups.length = 0;
  }

  // localPos is anchor-local (same space as the sparkle burst) → parent the
  // popup's carrier Object3D under the same anchor.
  #popup(localPos: Vector3, colorHex: string, pts: number): void {
    const obj = new Object3D();
    obj.position.copy(localPos);
    this.#render.anchor.add(obj);
    const handle = this.#text.show(pts < 0 ? `${pts}` : `+${pts}`, obj, { color: colorHex });
    this.#popups.push({ handle, obj, t: 0 });
  }
}
