// Bodies that emerge straight up out of a Hole, hold, then sink back down and
// despawn. Generic: an actor does not know its color means "a stolen rainbow
// color", or why it was told to appear — RunState owns all of that.
import { Mesh, MeshPhongMaterial, CapsuleGeometry, MathUtils, Raycaster, Vector3 } from 'three';
import type { Object3D, PerspectiveCamera, Ray, Color, BufferGeometry } from 'three';
import { easeOutCubic } from '../animation/Easing';
import { dressUnicorn, disposeUnicornAssets } from './unicorn';
import { dressGhost, disposeGhostAssets } from './ghostEyes';
import type { Hole } from './Hole';

const _actorWorld = new Vector3(); // scratch: actor world position for the proximity test
const _camWorld = new Vector3();

// the trim closures (unicorn mane / ghost eyes) both expose this
type Trim = { update(delta: number, ySpeed: number, camPos: Vector3): void };

// what a collected actor leaves behind: its caller-supplied `tag` (opaque here —
// RunState uses it for the rainbow index) plus color + position for effects.
export type RemovedActor = { tag: number; color: Color; position: Vector3 };

// what a ray/proximity query found, without touching it. `decoy` lets the caller
// decide whether this hit means "collect" or "penalty" (RunState: a decoy is the
// unicorn — tapping it is punished and the body stays standing).
export type ActorHit = { id: number; tag: number; decoy: boolean; position: Vector3 };

const BODY_R_m = 0.045;
const BODY_LEN_m = 0.11;                              // capsule mid-section
export const BODY_HALF_m = BODY_R_m + BODY_LEN_m / 2; // 0.10 — half the total height
// one shared body geometry — every actor, and the intro cinematic's stand-ins
export const CAPSULE_GEO = new CapsuleGeometry(BODY_R_m, BODY_LEN_m, 4, 12); // a rounded "ghost"
const HIDDEN_Y_m = -0.17; // center: the whole body is below the rim, inside the pit
const PEEK_Y_m = -0.01;   // center: ~half the body clears the rim — it stays rooted in the hole
const RISE_S = 0.25;
const SINK_S = 0.22;

type Phase = 'rising' | 'holding' | 'sinking';

type Actor = {
  id: number;
  mesh: Mesh<BufferGeometry, MeshPhongMaterial>;
  hole: Hole;
  tag: number;    // opaque caller id (RunState: rainbow color index)
  decoy: boolean; // horned; a tap never removes it and its unhit sink is not a miss
  phase: Phase;
  phaseT: number; // seconds spent in the current phase
  hold: number;   // seconds to stay up once risen
  trim: Trim;     // ghost eyes, or the unicorn's mane — animated each frame
};

export class Actors {
  #root: Object3D;
  #camera: PerspectiveCamera; // ghost eyes / pupils track the player
  #actors = new Map<number, Actor>(); // live bodies by id — inlined, single consumer
  #nextId = 0;
  #raycaster = new Raycaster();

  #geo = CAPSULE_GEO; // every body — a rounded "ghost"

  constructor(root: Object3D, camera: PerspectiveCamera) {
    this.#root = root;
    this.#camera = camera;
  }

  get count(): number { return this.#actors.size; }

  // Rainbow indices of the actors currently alive (so RunState can keep one
  // actor per color).
  activeTags(): number[] {
    const tags: number[] = [];
    for (const a of this.#actors.values()) tags.push(a.tag);
    return tags;
  }

  // Raise a body of `colorHex` from `hole`, up for `hold` seconds, carrying
  // `tag`; it sinks and despawns on its own. `decoy` swaps the body for the
  // dressed-up unicorn capsule and marks it as one that survives a tap. Returns
  // the mesh (for audio / hit-test) or null if the hole is already taken.
  // `hold` may be Infinity — the body then stays up until despawned explicitly.
  spawn(hole: Hole, colorHex: string, hold: number, tag: number, decoy = false): { id: number; mesh: Mesh<BufferGeometry, MeshPhongMaterial> } | null {
    if (!hole.free) return null;
    hole.free = false;

    // a soft self-glow: the body emits ~15% of its own color → a cheap "lit from
    // within" look that softens the shading and reads as a spirit
    const mat = new MeshPhongMaterial({ color: colorHex, shininess: 40 });
    mat.emissive.copy(mat.color).multiplyScalar(0.16);
    const mesh = new Mesh(this.#geo, mat);
    mesh.castShadow = true;
    mesh.position.set(hole.x, HIDDEN_Y_m, hole.z);
    const trim = decoy ? dressUnicorn(mesh, BODY_HALF_m) : dressGhost(mesh, BODY_HALF_m); // rides along with every rise / sink / cull
    this.#root.add(mesh);
    mesh.updateWorldMatrix(true, false); // same-frame world pose for callers

    const id = this.#nextId++;
    this.#actors.set(id, { id, mesh, hole, tag, decoy, phase: 'rising', phaseT: 0, hold, trim });
    return { id, mesh };
  }

  // Ray hit against live actors; falls back to the nearest actor within
  // `proximityR` of the ray origin (direct touch — a hand pinch fires with the
  // fingertip on the body). Returns the hit (id + tag + decoy + position), or
  // null on a miss. Non-destructive — the caller chooses whether to despawn().
  hitTest(ray: Ray, proximityR: number): ActorHit | null {
    const meshes: Mesh[] = [];
    let nearId = -1;
    let nearD = proximityR;
    for (const a of this.#actors.values()) {
      meshes.push(a.mesh);
      // ray.origin is world-space; a.mesh.position is local to the placed anchor,
      // so compare against the actor's world position (matters once the board is
      // anchored anywhere but the origin — i.e. on a real device).
      const d = a.mesh.getWorldPosition(_actorWorld).distanceTo(ray.origin);
      if (d < nearD) { nearD = d; nearId = a.id; }
    }
    this.#raycaster.set(ray.origin, ray.direction);
    const hitMesh = this.#raycaster.intersectObjects(meshes, false)[0]?.object;

    let picked: Actor | undefined;
    if (hitMesh) { for (const a of this.#actors.values()) if (a.mesh === hitMesh) { picked = a; break; } }
    else if (nearId >= 0) picked = this.#actors.get(nearId);
    return picked
      ? { id: picked.id, tag: picked.tag, decoy: picked.decoy, position: picked.mesh.position.clone() }
      : null;
  }

  // The live mesh for an id (so World can emit a positional sound from it before
  // despawn). undefined if the actor is already gone.
  meshOf(id: number): Mesh<BufferGeometry, MeshPhongMaterial> | undefined {
    return this.#actors.get(id)?.mesh;
  }

  // Remove one actor now (a collect / hit). Returns its tag + color + last position.
  despawn(id: number): RemovedActor | null {
    const a = this.#actors.get(id);
    if (!a) return null;
    const removed: RemovedActor = { tag: a.tag, color: a.mesh.material.color.clone(), position: a.mesh.position.clone() };
    this.#remove(a);
    return removed;
  }

  // Collect a random live actor (keyboard fallback — no real aim). Skips decoys:
  // the debug key should never punish the player for a keypress it didn't aim.
  despawnAny(): RemovedActor | null {
    const ids: number[] = [];
    for (const a of this.#actors.values()) if (!a.decoy) ids.push(a.id);
    return ids.length ? this.despawn(ids[(Math.random() * ids.length) | 0]) : null;
  }

  // Advances every actor. Returns the number of **misses** this frame — actors
  // that sank back down unhit (a hit removes via despawn(), not here). RunState
  // uses it to break the streak.
  update(delta: number): number {
    let missed = 0;
    this.#camera.getWorldPosition(_camWorld);
    // Deleting the current entry mid-iteration is safe for a Map (it has already
    // been yielded), so removal happens inline — no deferred `done` list.
    this.#actors.forEach((a) => {
      a.phaseT += delta;
      const prevY = a.mesh.position.y;
      let removed = false;

      if (a.phase === 'rising') {
        const k = Math.min(a.phaseT / RISE_S, 1);
        a.mesh.position.y = MathUtils.lerp(HIDDEN_Y_m, PEEK_Y_m, easeOutCubic(k));
        if (k >= 1) { a.phase = 'holding'; a.phaseT = 0; }
      } else if (a.phase === 'holding') {
        if (a.phaseT >= a.hold) { a.phase = 'sinking'; a.phaseT = 0; }
      } else {
        // TODO(polish): easeOutCubic decelerates into HIDDEN_Y, so the body
        // creeps the last ~2 frames before it despawns — reads as a small pause.
        // Switch the sink to `linear` (or an ease-in) during final UI tuning.
        const k = Math.min(a.phaseT / SINK_S, 1);
        a.mesh.position.y = MathUtils.lerp(PEEK_Y_m, HIDDEN_Y_m, easeOutCubic(k));
        if (k >= 1) { const wasDecoy = a.decoy; this.#remove(a); removed = true; if (!wasDecoy) missed++; } // ignoring a decoy is correct play — not a miss
      }

      if (!removed) a.trim.update(delta, (a.mesh.position.y - prevY) / delta, _camWorld);
    });
    return missed;
  }

  clear(): void {
    this.#actors.forEach((a) => {
      a.hole.free = true;
      this.#root.remove(a.mesh);
      a.mesh.material.dispose();
    });
    this.#actors.clear();
  }

  // ?tweak only: despawn every live body so the scheduler rebuilds them with the
  // current knob values (geometry-time knobs don't apply to bodies already up).
  respawnAll(): void {
    if (!__DEV__) return; // dead outside the ?tweak panel — body folds away in prod
    this.#actors.forEach((a) => this.#remove(a));
  }

  dispose(): void {
    this.clear();
    this.#geo.dispose();
    disposeUnicornAssets();
    disposeGhostAssets();
  }

  #remove(a: Actor): void {
    a.hole.free = true;
    this.#root.remove(a.mesh);
    a.mesh.material.dispose();
    this.#actors.delete(a.id);
  }
}
