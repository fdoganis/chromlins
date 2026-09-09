import { BoxGeometry, MeshBasicMaterial, Vector3, MathUtils, Matrix4, Quaternion, Color } from 'three';
import type { Object3D } from 'three';
import { InstancedPool } from '../rendering/InstancedPool';
import { easeOutQuint } from './Easing';
import type { Ease } from './Easing';

type Particle = {
  index: number;
  active: boolean;
  elapsed: number;
  duration: number;
  from: Vector3;
  to: Vector3;
  fromScale: number;
  toScale: number;
};

const SPREAD_m = 0.3; // meters a particle travels from / to the burst origin
const IDENTITY_QUAT = new Quaternion(); // particles never rotate // TODO: QUESTION: why not?
const WHITE = new Color(0xffffff);

export type BurstMode = 'explode' | 'converge'; // TODO: replace with a better enum?

// A fixed pool, reused for every burst, nothing allocated per spawn beyond a few per-burst scratch vectors
// Two groups, matching the reference: a larger set that takes on the
// spawning cone's own color, and a smaller fixed-color accent for glint.

// One shared InstancedPool backs every particle in both groups — allocated
// once here, held for Sparkles' whole lifetime, never freed/reallocated:
// burst() just rewrites the same indices' matrices, same fixed-pool
// behavior as before, now one draw call instead of 35 Mesh objects.

type ParticleGroup = {
  particles: Particle[];
  color: Color;         // current color for the group; matchColor groups repaint this on burst
  scale: number;
  ease: Ease;
  matchColor: boolean;           // recolor to the spawning cone each burst, or stay fixed
};

// CONST
const GROUP_A = 20, GROUP_B = 15;

// TMP
const _offset = new Vector3();
const _scattered = new Vector3();
const _pos = new Vector3();
const _scale = new Vector3();
const _mat = new Matrix4();

export class Sparkles {
  //#parent: Object3D;
  #pool: InstancedPool;
  #groups: ParticleGroup[];


  constructor(parent: Object3D) {
    this.#pool = new InstancedPool(parent, new BoxGeometry(), GROUP_A + GROUP_B, new MeshBasicMaterial({ toneMapped: false }));
    //this.#parent = parent; // TODO: QUESTION: no longer needed for anchoring? If so should this pool be better handled by World or RenderingManager? Particles seems to hold the lifecycle
    this.#groups = [
      this.#createGroup(GROUP_A, 0xffffff, 0.03, easeOutQuint, true), // cone color
      this.#createGroup(GROUP_B, 0xffe9a8, 0.015, easeOutQuint, false) // glint
    ];
  }

  #createGroup(count: number, colorHex: number, scale: number, ease: Ease, matchColor: boolean): ParticleGroup {
    const color = new Color(colorHex);
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const index = this.#pool.allocate()!; // capacity == GROUP_A+GROUP_B
      this.#pool.setColor(index, color);
      particles.push({
        index, active: false, elapsed: 0, duration: 0.5,
        from: new Vector3(), to: new Vector3(), fromScale: 0, toScale: 0,
      });
    }
    return { particles, color, scale, ease, matchColor };
  }

  burst(origin: Vector3, color: Color, mode: BurstMode = 'converge') {
    for (const group of this.#groups) {
      if (group.matchColor && !group.color.equals(color)) {
        group.color.copy(color);
        for (const p of group.particles) this.#pool.setColor(p.index, color);
      }
      for (const p of group.particles) this.#fire(p, origin, mode, group.scale);
    }
  }


  // A quick, small, colourless puff where an aimed swing hit nothing. A handful
  // of group-A particles, forced white, tight spread. Group A is matchColor, so
  // the next real burst repaints it — nothing lingers.
  spark(origin: Vector3) {
    const g = this.#groups[0];
    if (!g.color.equals(WHITE)) {
      g.color.copy(WHITE);
      for (const p of g.particles) this.#pool.setColor(p.index, WHITE);
    }
    const n = Math.min(6, g.particles.length);
    for (let i = 0; i < n; i++) this.#fire(g.particles[i], origin, 'explode', g.scale * 0.6, SPREAD_m * 0.4);
  }

  #fire(p: Particle, origin: Vector3, mode: BurstMode, scale: number, spread = SPREAD_m) {
    _offset.set(
      Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1
    ).normalize().multiplyScalar(spread * (0.5 + Math.random() * 0.5));

    _scattered.copy(origin).add(_offset);

    p.from.copy(mode === 'explode' ? origin : _scattered);
    p.to.copy(mode === 'explode' ? _scattered : origin);
    p.fromScale = mode === 'explode' ? scale : 0;
    p.toScale = mode === 'explode' ? 0 : scale;
    p.elapsed = 0;
    p.duration = 0.7 + Math.random() * 0.3;
    p.active = true;
    this.#pool.setMatrix(p.index, _mat.compose(p.from, IDENTITY_QUAT, _scale.setScalar(p.fromScale)));

  }

  update(delta: number) {
    for (const group of this.#groups)
      for (const p of group.particles) this.#advance(p, group.ease, delta);

  }

  #advance(p: Particle, ease: Ease, delta: number) {
    if (!p.active) { return; }

    p.elapsed += delta;
    const t = Math.min(p.elapsed / p.duration, 1);
    const et = ease(t);
    _pos.lerpVectors(p.from, p.to, et);
    _scale.setScalar(t >= 1 ? 0 : MathUtils.lerp(p.fromScale, p.toScale, et));
    this.#pool.setMatrix(p.index, _mat.compose(_pos, IDENTITY_QUAT, _scale));
    if (t >= 1) p.active = false;
  }

  // Kill every in-flight particle now (scale to 0). Used when the round ends so a
  // burst isn't left frozen in the air once update() stops being called.
  clear() {
    for (const group of this.#groups)
      for (const p of group.particles) {
        p.active = false;
        this.#pool.setMatrix(p.index, _mat.compose(_pos.set(0, 0, 0), IDENTITY_QUAT, _scale.setScalar(0)));
      }
  }

  dispose() {
    this.#pool.dispose();
  }
}