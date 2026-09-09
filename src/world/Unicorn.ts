// The decoy: the Actor capsule (shown in cream) + a twisted horn, blush cheeks,
// a pink muzzle, black eyes, and a rainbow mane. `decoy = true` — a tap never
// removes it and an unhit sink isn't a miss (Actors / RunState handle that).
//
// The mane is placed automatically: each strand is an S-curve "drape" that
// starts on the crown / forehead, kicks up, crests over the head and hangs down
// the back, then curls its tip back toward the body — and every sample is pushed
// out of the capsule by `margin` so nothing ends up buried. MANE_SIM picks the
// physics on that rest pose: 'spring' (default — rigid tube strands on cheap
// angular springs) or 'chain' (opt-in follow-the-leader rope). Tune everything
// live in the groom studio (tests/tools/groom.html, `npm run groom`).
import {
  Mesh, MeshPhongMaterial, MeshBasicMaterial, CylinderGeometry, SphereGeometry,
  TubeGeometry, CatmullRomCurve3, Vector3, MathUtils, type Object3D,
} from 'three';
import { RAINBOW } from '../core/palette';
import { MANE_SIM } from '../game.config';
import { Actor, BODY_HALF_m, BODY_R_m } from './Actor';
import { BLACK_EYE_MAT } from './Chromlin';
import { deform } from './deform';

const PINK = 0xd8899b;
const pinkMat = new MeshPhongMaterial({ color: PINK });
const maneMat = RAINBOW.map((c) => new MeshBasicMaterial({ color: c, toneMapped: false })); // vivid, like the arcs
const eyeGeo = new SphereGeometry(0.012, 8, 6);
const cheekGeo = new SphereGeometry(0.010, 6, 5);
const muzzleGeo = new SphereGeometry(0.022, 10, 8); // ~half the body diameter; flattened on place into a snout patch

type ManeUpdate = (dt: number, ySpeed: number, t: number) => void;

// --- shared mane geometry ---------------------------------------------------
const MANE_TUB_SEG = 10;
const MANE_RAD_SEG = 5;
const DRAPE_N = 6;                       // path samples per strand
const CORE_HALF = BODY_HALF_m - BODY_R_m; // capsule mid-segment half-length (0.055)

const _up = new Vector3(0, 1, 0);
const _c = new Vector3();
const _cd = new Vector3();
const _step = new Vector3();
const _tgt = new Vector3();
const _dir = new Vector3();
const _look = new Vector3();

// Push a body-local point outward until it clears the capsule (core segment on
// Y, radius BODY_R_m) by `margin`. Analytic — cheap enough to call per rope node.
function capsuleClamp(p: Vector3, margin: number): void {
  _c.set(0, MathUtils.clamp(p.y, -CORE_HALF, CORE_HALF), 0);
  _cd.copy(p).sub(_c);
  const d = _cd.length();
  const want = BODY_R_m + margin;
  if (d < want) {
    if (d < 1e-5) _cd.set(0, 0, 1); // degenerate: shove it to the front
    p.copy(_c).addScaledVector(_cd.normalize(), want);
  }
}

// The S-curve rest path for one strand, returned root-relative (starts at the
// origin). `yaw` fans it around Y; `back` flips the drape to the rear.
function sDrape(root: Vector3, yaw: number, back: boolean, m: typeof Unicorn.tune.mane): Vector3[] {
  const len = back ? m.len : m.foreLen;
  const seg = len / DRAPE_N;
  const H = new Vector3(0, 0, back ? -1 : 1).applyAxisAngle(_up, yaw); // fanned horizontal aim
  const abs = root.clone();                 // body-local absolute position, walked forward
  const out = [new Vector3()];              // root-relative
  let pitch = m.lift;                       // radians, + = up
  for (let i = 1; i <= DRAPE_N; i++) {
    const u = i / DRAPE_N;
    // start pitched up (lift), sweep down to -drop by the tip, one undulation (sBend) => an S
    const target = m.lift - (m.lift + m.drop) * u + m.sBend * Math.sin(u * Math.PI * 1.6);
    pitch += (target - pitch) * 0.6;         // smooth the corner
    _step.copy(H).multiplyScalar(Math.cos(pitch) * seg);
    _step.y += Math.sin(pitch) * seg;
    abs.add(_step);
    capsuleClamp(abs, m.margin);
    out.push(abs.clone().sub(root));
  }
  return out;
}

// THREE.TubeGeometry has one constant radius; sweep it then (once) pull each
// ring's vertices toward that ring's centre by 1 - taper*u — a real per-vertex
// taper (taper = 1 -> a point), not a scaled mesh.
function taperedTube(pts: Vector3[], rootR: number, taper: number): TubeGeometry {
  const curve = new CatmullRomCurve3(pts);
  const g = new TubeGeometry(curve, MANE_TUB_SEG, rootR, MANE_RAD_SEG, false);
  const centres = Array.from({ length: MANE_TUB_SEG + 1 }, (_, i) => curve.getPointAt(i / MANE_TUB_SEG, new Vector3()));
  deform(g, (v, i) => {
    const ring = (i / (MANE_RAD_SEG + 1)) | 0;
    const c = centres[ring];
    const f = 1 - taper * (ring / MANE_TUB_SEG);
    v.set(c.x + (v.x - c.x) * f, c.y + (v.y - c.y) * f, c.z + (v.z - c.z) * f);
  });
  return g;
}

function backRoot(d: number, m: typeof Unicorn.tune.mane): Vector3 {
  return new Vector3(d * m.xStep, BODY_HALF_m, m.backRootZ);           // on the crown, just behind the horn
}
function foreRoot(d: number, m: typeof Unicorn.tune.mane): Vector3 {
  return new Vector3(d * m.xStep, BODY_HALF_m * m.foreRootYFrac, m.foreRootZ); // forehead
}

function twistedHornGeo(h: number, baseR: number, turns: number): CylinderGeometry {
  const g = new CylinderGeometry(0.001, baseR, h, 6, 8);
  deform(g, (v) => {
    const a = turns * Math.PI * 2 * (v.y / h + 0.5);
    const c = Math.cos(a), s = Math.sin(a);
    v.set(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
  });
  g.computeVertexNormals();
  return g;
}

// module-level so ?tweak / groom's Unicorn.rebuildGeo() can swap them; every
// Unicorn shares them.
let hornGeo = twistedHornGeo(0.075, 0.02, 2.5);
let segGeo: CylinderGeometry | null = MANE_SIM === 'chain' ? new CylinderGeometry(0.007, 0.007, 1, 5) : null;
let strands: { geo: TubeGeometry; root: Vector3; yaw: number; back: boolean }[] = [];

function buildManeGeos(): void {
  for (const s of strands) s.geo.dispose();
  strands = [];
  const m = Unicorn.tune.mane;
  const add = (root: Vector3, yaw: number, back: boolean) => {
    strands.push({ geo: taperedTube(sDrape(root, yaw, back, m), m.radius, m.taper), root, yaw, back });
  };
  const bmid = (m.backCount - 1) / 2;
  for (let i = 0; i < m.backCount; i++) add(backRoot(i - bmid, m), (i - bmid) * m.backFan, true);
  const fmid = (m.foreCount - 1) / 2;
  for (let i = 0; i < m.foreCount; i++) add(foreRoot(i - fmid, m), (i - fmid) * m.foreFan, false);
}

export class Unicorn extends Actor {
  // Config, on the class. groom / ?tweak bind lil-gui folders to mane / horn / face.
  static tune = {
    "mane": {
      "backCount": 7,
      "foreCount": 7,
      "radius": 0.018,
      "taper": 1,
      "len": 0.2,
      "foreLen": 0.07,
      "lift": -0.8,
      "drop": 2,
      "sBend": 0.5,
      "backFan": -0.25,
      "foreFan": 0.25,
      "xStep": 0.002,
      "backRootZ": 0.008,
      "foreRootYFrac": 0.82,
      "foreRootZ": 0.005,
      "margin": 0.008,
      "stiff": 80,
      "damp": 20,
      "kick": 2,
      "idle": 0.1
    },
    "horn": {
      "turns": 2.5,
      "height": 0.075,
      "baseR": 0.02,
      "tiltX": 0.3,
      "posY": 0.027,
      "posZ": 0.017
    },
    "face": {
      "eyeX": 0.016,
      "eyeYFrac": 0.5,
      "eyeZ": 0.038,
      "cheekX": 0.026,
      "cheekYFrac": 0.32,
      "cheekZ": 0.033,
      "cheekFlat": 0.6,
      "muzzleYFrac": 0.18,
      "muzzleZ": 0.04
    }
  };

  override decoy = true;

  #mane: ManeUpdate;
  #t = 0;

  constructor(root: Object3D) {
    super(root);
    if (!strands.length && MANE_SIM !== 'chain') buildManeGeos();
    const f = Unicorn.tune.face;
    const body = this.mesh;

    for (const sx of [-1, 1]) {
      const eye = new Mesh(eyeGeo, BLACK_EYE_MAT);
      eye.position.set(sx * f.eyeX, BODY_HALF_m * f.eyeYFrac, f.eyeZ);
      body.add(eye);
      const cheek = new Mesh(cheekGeo, pinkMat);
      cheek.position.set(sx * f.cheekX, BODY_HALF_m * f.cheekYFrac, f.cheekZ);
      cheek.scale.set(1, 1, f.cheekFlat); // flattened -> a painted blush spot, not a ball
      body.add(cheek);
    }
    // nose + mouth: one flattened pink sphere, centred, low on the face
    const muzzle = new Mesh(muzzleGeo, pinkMat);
    muzzle.position.set(0, BODY_HALF_m * f.muzzleYFrac, f.muzzleZ);
    muzzle.scale.set(1, 0.7, f.cheekFlat); // barely protruding, a touch squashed vertically
    body.add(muzzle);

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

  // groom / ?tweak only: rebuild the horn + all strand geometry after a shape knob.
  static rebuildGeo(): void {
    if (!__DEV__) return;
    hornGeo.dispose();
    hornGeo = twistedHornGeo(Unicorn.tune.horn.height, Unicorn.tune.horn.baseR, Unicorn.tune.horn.turns);
    if (MANE_SIM !== 'chain') buildManeGeos();
  }
}

// ---- 'spring' mane: one rigid S-tube per strand on a bounded angular spring ----
type Spring = { mesh: Object3D; phase: number; ang: number; vel: number };

function buildSpringMane(body: Object3D): ManeUpdate {
  const k = Unicorn.tune.mane;
  const springs: Spring[] = strands.map((st, i) => {
    const mesh = new Mesh(st.geo, maneMat[i % maneMat.length]);
    mesh.position.copy(st.root);
    body.add(mesh);
    return { mesh, phase: i * 1.3, ang: 0, vel: 0 };
  });
  return (dt, ySpeed, t) => {
    for (const s of springs) {
      const accel = -s.ang * k.stiff + ySpeed * k.kick;
      s.vel = (s.vel + accel * dt) / (1 + k.damp * dt); // implicit damping — unconditionally stable
      s.ang = MathUtils.clamp(s.ang + s.vel * dt, -0.5, 0.8); // bounded so the swing never buries the tip
      s.mesh.rotation.x = -s.ang + Math.sin(t * 3 + s.phase) * k.idle;
    }
  };
}

// ---- 'chain' mane: follow-the-leader rope seeded on the S drape ----
const CHAIN = { follow: 0.35, relax: 0.10, lag: 0.18, grav: 0.05, taper: 0.78, idle: 0.05 };

type Strand = { root: Vector3; rest: Vector3[]; segLen: number; phase: number; pts: Vector3[]; segMeshes: Mesh[] };

function makeStrand(body: Object3D, d: number, mat: MeshBasicMaterial): Strand {
  const m = Unicorn.tune.mane;
  const root = backRoot(d, m);
  const pts = sDrape(root, d * m.backFan, true, m).map((v) => v.add(root)); // body-local absolute
  const rest = pts.map((_, i) => (i === 0 ? new Vector3() : pts[i].clone().sub(pts[i - 1]).normalize())); // per-segment S tangent
  const segLen = m.len / DRAPE_N;
  const segMeshes = Array.from({ length: DRAPE_N }, (_, j) => {
    const mm = new Mesh(segGeo!, mat);
    const s = 1 - (j / DRAPE_N) * CHAIN.taper;
    mm.scale.set(s, 1, s);
    body.add(mm);
    return mm;
  });
  return { root, rest, segLen, phase: d * 1.7, pts, segMeshes };
}

function stepStrand(st: Strand, bend: number, t: number): void {
  const margin = Unicorn.tune.mane.margin;
  st.pts[0].copy(st.root);
  for (let i = 1; i < st.pts.length; i++) {
    const parent = st.pts[i - 1];
    const p = st.pts[i];
    _dir.copy(p).sub(parent);
    if (_dir.lengthSq() < 1e-8) _dir.copy(st.rest[i]);
    _dir.normalize().lerp(st.rest[i], CHAIN.relax); // relax toward this segment's S tangent
    _dir.y -= bend + (i - 1) * CHAIN.grav;
    _dir.x += Math.sin(t * 4 + st.phase + i) * CHAIN.idle;
    _tgt.copy(parent).addScaledVector(_dir.normalize(), st.segLen);
    p.lerp(_tgt, CHAIN.follow).sub(parent).normalize().multiplyScalar(st.segLen).add(parent);
    capsuleClamp(p, margin); // never let a node sink into the body
  }
  for (let j = 0; j < st.segMeshes.length; j++) {
    const a = st.pts[j];
    _dir.copy(st.pts[j + 1]).sub(a);
    const len = _dir.length() || 1e-4;
    st.segMeshes[j].position.copy(a).addScaledVector(_dir, 0.5);
    st.segMeshes[j].quaternion.setFromUnitVectors(_up, _dir.divideScalar(len));
    st.segMeshes[j].scale.y = len;
  }
}

function buildChainMane(body: Object3D): ManeUpdate {
  const mid = (maneMat.length - 1) / 2;
  const rope = maneMat.map((mat, k) => makeStrand(body, k - mid, mat));
  return (_dt, ySpeed, t) => {
    const bend = MathUtils.clamp(ySpeed * CHAIN.lag, -0.35, 0.9);
    for (const st of rope) stepStrand(st, bend, t);
  };
}

export function disposeUnicornAssets(): void {
  for (const s of strands) s.geo.dispose();
  for (const g of [hornGeo, segGeo, eyeGeo, cheekGeo, muzzleGeo]) g?.dispose();
  for (const m of [pinkMat, ...maneMat]) m.dispose(); // BLACK_EYE_MAT is owned by Chromlin
}

// Merge a base64'd Unicorn.tune subset (from the groom studio's "share URL")
// into the live tune. Call BEFORE the first `new Unicorn()`. DEV only — the
// `?u=` route in Game.ts is `__DEV__`-guarded, so this tree-shakes in prod.
export function applyTuneShare(b64: string): void {
  try {
    const t = JSON.parse(atob(b64)) as Partial<typeof Unicorn.tune>;
    for (const k of ['mane', 'horn', 'face'] as const) if (t[k]) Object.assign(Unicorn.tune[k], t[k]);
  } catch { /* not a valid share string — ignore */ }
}
