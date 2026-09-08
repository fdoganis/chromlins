// The decoy: the Actor capsule (shown in cream) + a twisted horn, blush cheeks,
// black eyes, and a rainbow mane. `decoy = true` — a tap never removes it and an
// unhit sink isn't a miss (Actors / RunState handle that). MANE_SIM in
// game.config picks the mane physics: 'spring' (default, 14 short tube strands
// on cheap angular springs) or 'chain' (opt-in follow-the-leader rope).
import {
  Mesh, MeshPhongMaterial, MeshBasicMaterial, CylinderGeometry, SphereGeometry,
  TubeGeometry, CatmullRomCurve3, Vector3, MathUtils, type Object3D,
} from 'three';
import { RAINBOW } from '../core/palette';
import { MANE_SIM } from '../game.config';
import { Actor, BODY_HALF_m } from './Actor';
import { BLACK_EYE_MAT } from './Chromlin';

const PINK = 0xd8899b;
const pinkMat = new MeshPhongMaterial({ color: PINK });
const maneMat = RAINBOW.map((c) => new MeshBasicMaterial({ color: c, toneMapped: false })); // vivid, like the arcs
const eyeGeo = new SphereGeometry(0.012, 8, 6);
const cheekGeo = new SphereGeometry(0.010, 6, 5);

type ManeUpdate = (dt: number, ySpeed: number, t: number) => void;

// ---- mane 'spring' shapes: two shared tube curves, root at origin ----
const MANE_TUB_SEG = 10;
const MANE_RAD_SEG = 5;
const BACK_CURVE = new CatmullRomCurve3([
  new Vector3(0, 0, 0), new Vector3(0, 0.03, -0.015), new Vector3(0, 0.035, -0.06),
  new Vector3(0, 0.005, -0.10), new Vector3(0, -0.05, -0.125),
]);
const FRONT_CURVE = new CatmullRomCurve3([
  new Vector3(0, 0, 0), new Vector3(0, 0.018, 0.02), new Vector3(0, 0.03, 0.045), new Vector3(0, 0.024, 0.062),
]);

// THREE.TubeGeometry has one constant radius; run its sweep then (once) pull each
// ring's vertices toward that ring's centre by 1 - taper*u — a real per-vertex
// taper (taper = 1 → a point), not a scaled mesh.
function taperedTube(curve: CatmullRomCurve3, rootR: number, taper: number): TubeGeometry {
  const g = new TubeGeometry(curve, MANE_TUB_SEG, rootR, MANE_RAD_SEG, false);
  const p = g.attributes.position;
  const c = new Vector3();
  for (let i = 0; i <= MANE_TUB_SEG; i++) {
    curve.getPointAt(i / MANE_TUB_SEG, c);
    const f = 1 - taper * (i / MANE_TUB_SEG);
    for (let j = 0; j <= MANE_RAD_SEG; j++) {
      const vi = (MANE_RAD_SEG + 1) * i + j;
      p.setXYZ(vi, c.x + (p.getX(vi) - c.x) * f, c.y + (p.getY(vi) - c.y) * f, c.z + (p.getZ(vi) - c.z) * f);
    }
  }
  p.needsUpdate = true;
  return g;
}

// ---- mane 'chain' rope ----
const CHAIN = { segs: 5, segLen: 0.024, follow: 0.35, relax: 0.08, lag: 0.18, grav: 0.06, taper: 0.78, idle: 0.05 };
const _tgt = new Vector3();
const _dir = new Vector3();
const _up = new Vector3(0, 1, 0);
const _look = new Vector3();

type Spring = { mesh: Object3D; baseX: number; phase: number; ang: number; vel: number };
type Strand = { root: Vector3; rest: Vector3; phase: number; pts: Vector3[]; segs: Mesh[] };

function twistedHornGeo(h: number, baseR: number, turns: number): CylinderGeometry {
  const g = new CylinderGeometry(0.001, baseR, h, 6, 8);
  const pos = g.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = turns * Math.PI * 2 * (v.y / h + 0.5);
    const c = Math.cos(a), s = Math.sin(a);
    pos.setXYZ(i, v.x * c - v.z * s, v.y, v.x * s + v.z * c);
  }
  g.computeVertexNormals();
  return g;
}

// module-level so ?tweak's Unicorn.rebuildGeo() can swap them; every Unicorn shares them
let hornGeo = twistedHornGeo(0.075, 0.02, 2.5);
let segGeo: CylinderGeometry | null = MANE_SIM === 'chain' ? new CylinderGeometry(0.007, 0.007, 1, 5) : null;
let tubeBack: TubeGeometry | null = null;
let tubeFront: TubeGeometry | null = null;
function buildManeTubes(): void {
  tubeBack?.dispose();
  tubeFront?.dispose();
  const m = Unicorn.tune.mane;
  tubeBack = MANE_SIM === 'chain' ? null : taperedTube(BACK_CURVE, m.radius, m.taper);
  tubeFront = MANE_SIM === 'chain' ? null : taperedTube(FRONT_CURVE, m.radius, m.taper);
}

export class Unicorn extends Actor {
  static tune = {
    mane: {
      backCount: 7, frontCount: 7,
      radius: 0.006, taper: 0.85,               // tube radius at the root; tip = radius*(1-taper)
      rootY: 0.006, rootZ: -0.012,              // back-mane root, just behind the horn
      frontRootYFrac: 0.72, frontRootZ: 0.03,   // forelock root, on the forehead above the eyes
      backPitch: -0.1, frontPitch: -0.5,        // rest pitch (rad)
      yawSplay: 0.14, rollSplay: 0.12,          // fan spread across strands
      stiff: 90, damp: 9, kick: 1.0,            // damped angular spring + rise/sink impulse
      idle: 0.05,                               // idle sway amplitude
    },
    horn: { turns: 2.5, height: 0.075, baseR: 0.02, tiltX: 0.22, posY: 0.02, posZ: 0.012 },
    face: { eyeX: 0.016, eyeYFrac: 0.5, eyeZ: 0.038, cheekX: 0.026, cheekYFrac: 0.32, cheekZ: 0.033, cheekFlat: 0.55 },
  };

  override decoy = true;

  #mane: ManeUpdate;
  #t = 0;

  constructor(root: Object3D) {
    super(root);
    if (!tubeBack && MANE_SIM !== 'chain') buildManeTubes();
    const f = Unicorn.tune.face;
    const body = this.mesh;

    for (const sx of [-1, 1]) {
      const eye = new Mesh(eyeGeo, BLACK_EYE_MAT);
      eye.position.set(sx * f.eyeX, BODY_HALF_m * f.eyeYFrac, f.eyeZ);
      body.add(eye);
      const cheek = new Mesh(cheekGeo, pinkMat);
      cheek.position.set(sx * f.cheekX, BODY_HALF_m * f.cheekYFrac, f.cheekZ);
      cheek.scale.set(1, 1, f.cheekFlat); // flattened → a painted blush spot, not a ball
      body.add(cheek);
    }
    const horn = new Mesh(hornGeo, pinkMat);
    horn.position.set(0, BODY_HALF_m + Unicorn.tune.horn.posY, Unicorn.tune.horn.posZ);
    horn.rotation.x = Unicorn.tune.horn.tiltX;
    body.add(horn);

    this.#mane = MANE_SIM === 'chain' ? buildChainMane(body) : buildSpringMane(body);
  }

  override animate(delta: number, ySpeed: number, camPos: Vector3): void {
    this.#t += delta;
    // face the player (Y axis) — horn to the front, mane behind
    this.mesh.parent!.worldToLocal(_look.copy(camPos)).sub(this.mesh.position);
    this.mesh.rotation.y = Math.atan2(_look.x, _look.z);
    this.#mane(delta, ySpeed, this.#t);
  }

  // ?tweak only: rebuild the horn + mane tube geometry after a shape-knob change.
  static rebuildGeo(): void {
    if (!__DEV__) return;
    hornGeo.dispose();
    hornGeo = twistedHornGeo(Unicorn.tune.horn.height, Unicorn.tune.horn.baseR, Unicorn.tune.horn.turns);
    buildManeTubes();
  }
}

// ---- 'spring' mane: 14 rigid tube strands, each on a damped angular spring ----
function buildSpringMane(body: Object3D): ManeUpdate {
  const k = Unicorn.tune.mane;
  const springs: Spring[] = [];
  const bank = (geo: TubeGeometry, count: number, rootY: number, rootZ: number, xStep: number, pitch: number) => {
    const mid = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      const d = i - mid;
      const mesh = new Mesh(geo, maneMat[i % maneMat.length]);
      mesh.position.set(d * xStep, rootY, rootZ);
      mesh.rotation.set(pitch, d * k.yawSplay, d * k.rollSplay);
      body.add(mesh);
      springs.push({ mesh, baseX: pitch, phase: i * 1.3, ang: 0, vel: 0 });
    }
  };
  bank(tubeBack!, k.backCount, BODY_HALF_m + k.rootY, k.rootZ, 0.008, k.backPitch);
  bank(tubeFront!, k.frontCount, BODY_HALF_m * k.frontRootYFrac, k.frontRootZ, 0.010, k.frontPitch);

  return (dt, ySpeed, t) => {
    for (const s of springs) {
      const accel = -s.ang * k.stiff + ySpeed * k.kick;
      s.vel = (s.vel + accel * dt) / (1 + k.damp * dt); // implicit damping — unconditionally stable
      s.ang += s.vel * dt;
      s.mesh.rotation.x = s.baseX - s.ang + Math.sin(t * 3 + s.phase) * k.idle;
    }
  };
}

// ---- 'chain' mane: follow-the-leader rope of tapered cone segments ----
function makeStrand(body: Object3D, d: number, mat: MeshBasicMaterial): Strand {
  const n = CHAIN.segs;
  const root = new Vector3(d * 0.006, BODY_HALF_m + Unicorn.tune.mane.rootY, Unicorn.tune.mane.rootZ);
  const rest = new Vector3(d * 0.14, -0.7, -0.72).normalize();
  const pts = Array.from({ length: n + 1 }, (_, i) => root.clone().addScaledVector(rest, i * CHAIN.segLen));
  const segs = Array.from({ length: n }, (_, j) => {
    const m = new Mesh(segGeo!, mat);
    const s = 1 - (j / n) * CHAIN.taper;
    m.scale.set(s, CHAIN.segLen, s);
    body.add(m);
    return m;
  });
  return { root, rest, phase: d * 1.7, pts, segs };
}

function stepStrand(st: Strand, bend: number, t: number): void {
  st.pts[0].copy(st.root);
  for (let i = 1; i < st.pts.length; i++) {
    const parent = st.pts[i - 1];
    const p = st.pts[i];
    _dir.copy(p).sub(parent);
    if (_dir.lengthSq() < 1e-8) _dir.copy(st.rest);
    _dir.normalize().lerp(st.rest, CHAIN.relax);
    _dir.y -= bend + (i - 1) * CHAIN.grav;
    _dir.x += Math.sin(t * 4 + st.phase + i) * CHAIN.idle;
    _tgt.copy(parent).addScaledVector(_dir.normalize(), CHAIN.segLen);
    p.lerp(_tgt, CHAIN.follow).sub(parent).normalize().multiplyScalar(CHAIN.segLen).add(parent);
  }
  for (let j = 0; j < st.segs.length; j++) {
    const a = st.pts[j];
    _dir.copy(st.pts[j + 1]).sub(a);
    const len = _dir.length() || 1e-4;
    st.segs[j].position.copy(a).addScaledVector(_dir, 0.5);
    st.segs[j].quaternion.setFromUnitVectors(_up, _dir.divideScalar(len));
    st.segs[j].scale.y = len;
  }
}

function buildChainMane(body: Object3D): ManeUpdate {
  const mid = (maneMat.length - 1) / 2;
  const strands = maneMat.map((mat, k) => makeStrand(body, k - mid, mat));
  return (_dt, ySpeed, t) => {
    const bend = MathUtils.clamp(ySpeed * CHAIN.lag, -0.35, 0.9);
    for (const st of strands) stepStrand(st, bend, t);
  };
}

export function disposeUnicornAssets(): void {
  for (const g of [hornGeo, segGeo, tubeBack, tubeFront, eyeGeo, cheekGeo]) g?.dispose();
  for (const m of [pinkMat, ...maneMat]) m.dispose(); // BLACK_EYE_MAT is owned by Chromlin
}
