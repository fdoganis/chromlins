// Facade over the scene pieces RunState talks to: the socket grid (Gameboard),
// the bodies that rise from it (Actors), the Rainbow gauge, and the Sparkles
// pool — all parented to the placed anchor. Adds only the non-positional cues;
// no game rules (cadence, colors, scoring) live here.
import { Color } from 'three';
import type { Object3D, Vector3, Ray, PerspectiveCamera } from 'three';

import { Gameboard } from './Gameboard';
import { Actors } from './Actors';
import type { RemovedActor, ActorHit } from './Actors';
import { Rainbow } from './Rainbow';
import { Sparkles } from '../animation/Sparkles';
import type { BurstMode } from '../animation/Sparkles';
import type { AudioManager } from '../audio/AudioManager';

const PROXIMITY_R_m = 0.08; // hand/touch fallback radius when the ray misses (actor r = 0.05)
const DECOY_PUFF = new Color(0xd8899b); // pink "ow" burst when the unicorn is wrongly tapped

export class World {
  #board: Gameboard;
  #actors: Actors;
  #rainbow: Rainbow;
  #sparkles: Sparkles;
  #audio: AudioManager;

  constructor(root: Object3D, audio: AudioManager, camera: PerspectiveCamera) {
    this.#audio = audio;
    this.#board = new Gameboard(root);
    this.#actors = new Actors(root, camera);
    this.#rainbow = new Rainbow(root);
    this.#sparkles = new Sparkles(root);
  }

  get holeCount(): number { return this.#board.holeCount; }
  // anchor-local (x, 0, z) of hole i — the intro cinematic rises its eye rigs from these
  holePoint(i: number, out: Vector3): Vector3 { const h = this.#board.holeAt(i); return out.set(h.x, 0, h.z); }
  get activeCount(): number { return this.#actors.count; }
  freeHoles(): number[] { return this.#board.freeHoles(); }
  activeTags(): number[] { return this.#actors.activeTags(); }

  setRainbowFill(i: number, fill: number): void { this.#rainbow.setFill(i, fill); }
  rainbowArcApex(i: number, out: Vector3): Vector3 { return this.#rainbow.arcApex(i, out); }

  // Raise a body of `colorHex` from `hole`, up for `hold` seconds, carrying `tag`.
  // `decoy` gives it the unicorn's pink horn and makes a tap non-destructive.
  // `hold` may be Infinity for a body that stays up until despawned explicitly.
  // Returns the new actor's id (NameEntryState tracks its cylinders), or -1.
  spawnAtHole(hole: number, colorHex: string, hold: number, tag: number, decoy = false): number {
    const spawned = this.#actors.spawn(this.#board.holeAt(hole), colorHex, hold, tag, decoy);
    if (!spawned) return -1;
    try {
      this.#audio.playAt(spawned.mesh, 'spawn'); // the pop comes from the hole
    } catch {
      // audio can fail in restricted/sandboxed contexts — the body still appears
    }
    return spawned.id;
  }

  // Non-destructive hit query (NameEntryState decides what a hit means — lock a
  // letter, revert one, or confirm — none of which despawn the way World.hit does).
  hitTestActor(ray: Ray, radius = PROXIMITY_R_m): ActorHit | null {
    return this.#actors.hitTest(ray, radius);
  }

  // A live actor's mesh (NameEntryState parents its cycling letter label to it,
  // so the label lifts with the rise). undefined once the actor is gone.
  actorMesh(id: number): Object3D | undefined {
    return this.#actors.meshOf(id);
  }

  // Repaint a live actor's body (NameEntryState: cycling colour <-> locked colour).
  recolorActor(id: number, colorHex: string): void {
    const mat = this.#actors.meshOf(id)?.material;
    if (mat) { mat.color.set(colorHex); mat.emissive.copy(mat.color).multiplyScalar(0.16); }
  }

  // Remove one actor now; returns its colour + last (anchor-local) position so the
  // caller can fire the standard explode burst there.
  despawnActor(id: number): RemovedActor | null {
    return this.#actors.despawn(id);
  }

  burstSparkles(origin: Vector3, color: Color, mode?: BurstMode): void {
    this.#sparkles.burst(origin, color, mode);
  }

  // Aim a ray at the live actors. A normal body is removed and the collect
  // effect fires. A decoy (unicorn) is left standing — only a pink puff plays —
  // and the hit is still reported so RunState can run its penalty. Returns
  // { tag, color, position } or null.
  hit(ray: Ray, radius = PROXIMITY_R_m): RemovedActor | null {
    const h = this.#actors.hitTest(ray, radius);
    if (!h) return null;
    const mesh = this.#actors.meshOf(h.id); // grab it before despawn — sound plays from the hole
    if (h.decoy) {
      this.#sparkles.burst(h.position, DECOY_PUFF, 'explode');
      if (mesh) try { this.#audio.playAt(mesh, 'unicorn'); } catch { /* audio may be unavailable */ }
      return { tag: h.tag, color: DECOY_PUFF, position: h.position };
    }
    if (mesh) try { this.#audio.playAt(mesh, 'hit'); } catch { /* audio may be unavailable */ }
    return this.#collect(this.#actors.despawn(h.id), true);
  }

  // Collect a random live actor — keyboard fallback with no real aim.
  hitRandom(): RemovedActor | null {
    return this.#collect(this.#actors.despawnAny());
  }

  // `positioned` = a positional 'hit' was already emitted (World.hit); the
  // keyboard fallback has no location so it falls back to a flat cue.
  #collect(removed: RemovedActor | null, positioned = false): RemovedActor | null {
    if (!removed) return null;
    this.#sparkles.burst(removed.position, removed.color, 'explode');
    if (!positioned) {
      try {
        this.#audio.playSFX('hit');
      } catch {
        // audio may be unavailable
      }
    }
    return removed;
  }

  // Returns the number of misses this frame — actors that sank unhit (streak-break signal).
  update(delta: number): number {
    const missed = this.#actors.update(delta);
    this.#sparkles.update(delta);
    return missed;
  }

  reset(): void {
    this.#actors.clear();
    this.#board.reset();
    this.#rainbow.reset();
    this.#sparkles.clear();
  }

  // Drop any in-flight burst without touching the board/rainbow — for round end,
  // where update() stops and a live burst would otherwise freeze on screen.
  clearSparkles(): void { this.#sparkles.clear(); }

  // ?tweak only: force every live body to respawn with the current knob values.
  respawnActors(): void { if (__DEV__) this.#actors.respawnAll(); }

  dispose(): void {
    this.#actors.dispose();
    this.#board.dispose();
    this.#rainbow.dispose();
    this.#sparkles.dispose();
  }
}
