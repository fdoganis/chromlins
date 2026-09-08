// The fixed cast: seven Chromlins (one per rainbow colour, indexed by tag) plus
// one Unicorn. All eight rigs are built once in the constructor; spawn() just
// shows one and recolours it, despawn() hides it. Nothing is allocated per
// appearance. Generic: an Actor doesn't know its colour means "a stolen rainbow
// colour" — RunState owns that.
import { Raycaster, Vector3 } from 'three';
import type { Object3D, PerspectiveCamera, Ray, Color } from 'three';
import { RAINBOW } from '../core/palette';
import { Actor } from './Actor';
import { Chromlin, disposeChromlinAssets } from './Chromlin';
import { Unicorn, disposeUnicornAssets } from './Unicorn';
import type { Hole } from './Hole';

const _actorWorld = new Vector3();
const _camWorld = new Vector3();

const UNI_ID = RAINBOW.length; // 7 — the id the manager hands back for the decoy

// what a collected actor leaves behind (RunState uses `tag` for the rainbow index)
export type RemovedActor = { tag: number; color: Color; position: Vector3 };
// what a ray/proximity query found, without touching it
export type ActorHit = { id: number; tag: number; decoy: boolean; position: Vector3 };

export class Actors {
  #camera: PerspectiveCamera;
  #raycaster = new Raycaster();
  #chromlins: Chromlin[];
  #unicorn: Unicorn;
  #cast: Actor[]; // [...chromlins, unicorn] — iterated every frame

  constructor(root: Object3D, camera: PerspectiveCamera) {
    this.#camera = camera;
    this.#chromlins = RAINBOW.map(() => new Chromlin(root));
    this.#unicorn = new Unicorn(root);
    this.#cast = [...this.#chromlins, this.#unicorn];
  }

  #at(id: number): Actor { return id === UNI_ID ? this.#unicorn : this.#chromlins[id]; }
  #idOf(a: Actor): number { return a === this.#unicorn ? UNI_ID : this.#chromlins.indexOf(a as Chromlin); }

  get count(): number { let n = 0; for (const a of this.#cast) if (a.active) n++; return n; }

  activeTags(): number[] {
    const tags: number[] = [];
    for (const a of this.#cast) if (a.active) tags.push(a.tag);
    return tags;
  }

  // Show the rig for `tag` (or the decoy) at `hole` in `colorHex` for `hold`
  // seconds. Returns { id, mesh } or null if that rig is already up / the hole is
  // taken. `hold` may be Infinity — it then stays up until despawned.
  spawn(hole: Hole, colorHex: string, hold: number, tag: number, decoy = false): { id: number; mesh: Actor['mesh'] } | null {
    const a: Actor = decoy ? this.#unicorn : this.#chromlins[tag];
    if (a.active || !hole.free) return null;
    a.show(hole, colorHex, hold, tag);
    return { id: decoy ? UNI_ID : tag, mesh: a.mesh };
  }

  // Ray hit against the live rigs; falls back to the nearest rig within
  // `proximityR` of the ray origin (a hand pinch fires with the fingertip on the
  // body). Non-destructive — the caller chooses whether to despawn().
  hitTest(ray: Ray, proximityR: number): ActorHit | null {
    const meshes: Actor['mesh'][] = [];
    let near: Actor | undefined;
    let nearD = proximityR;
    for (const a of this.#cast) {
      if (!a.active) continue;
      meshes.push(a.mesh);
      const d = a.mesh.getWorldPosition(_actorWorld).distanceTo(ray.origin);
      if (d < nearD) { nearD = d; near = a; }
    }
    this.#raycaster.set(ray.origin, ray.direction);
    const hitMesh = this.#raycaster.intersectObjects(meshes, false)[0]?.object;
    const picked = hitMesh ? this.#cast.find((a) => a.mesh === hitMesh) : near;
    return picked
      ? { id: this.#idOf(picked), tag: picked.tag, decoy: picked.decoy, position: picked.position.clone() }
      : null;
  }

  meshOf(id: number): Actor['mesh'] | undefined {
    const a = this.#at(id);
    return a?.active ? a.mesh : undefined;
  }

  despawn(id: number): RemovedActor | null {
    const a = this.#at(id);
    if (!a?.active) return null;
    const removed: RemovedActor = { tag: a.tag, color: a.mesh.material.color.clone(), position: a.position.clone() };
    a.hide();
    return removed;
  }

  // Collect a random live Chromlin — keyboard fallback with no real aim. Skips
  // the decoy: a keypress should never trigger the unicorn penalty.
  despawnAny(): RemovedActor | null {
    const up = this.#chromlins.filter((c) => c.active);
    return up.length ? this.despawn(this.#idOf(up[(Math.random() * up.length) | 0])) : null;
  }

  recolor(id: number, hex: string): void { this.#at(id)?.recolor(hex); }

  // Advances every live rig. Returns the number of Chromlins that sank unhit this
  // frame (RunState breaks the streak on that); a sunk decoy isn't a miss.
  update(delta: number): number {
    let missed = 0;
    this.#camera.getWorldPosition(_camWorld);
    for (const a of this.#cast) if (a.active && a.update(delta, _camWorld) && !a.decoy) missed++;
    return missed;
  }

  clear(): void { for (const a of this.#cast) a.hide(); }

  // ?tweak only: hide every live rig so the panel / scheduler re-shows it with
  // the current knob values (spring knobs are read live; layout knobs need this).
  respawnAll(): void { if (__DEV__) this.clear(); }

  dispose(): void {
    this.clear();
    Actor.GEO.dispose();
    disposeChromlinAssets();
    disposeUnicornAssets();
  }
}
