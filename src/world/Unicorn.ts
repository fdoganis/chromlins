// The decoy: the Actor capsule (shown in cream) + a twisted horn, blush cheeks,
// a pink muzzle, black eyes, and a rainbow mane. `decoy = true` — a tap never
// removes it and an unhit sink isn't a miss (Actors / RunState handle that).
//
// The mane is placed automatically: each strand is an S-curve "drape" that
// starts on the crown / forehead, kicks up, crests over the head and hangs down
// the back, then curls its tip back toward the body — and every sample is pushed
// out of the capsule by `margin` so nothing ends up buried. Rigid tube strands
// on cheap angular springs. Tune everything live in the groom studio
// (tests/tools/groom.html, `npm run groom`).
import {
  Mesh, MeshPhongMaterial, MeshBasicMaterial, CylinderGeometry, SphereGeometry,
  TubeGeometry, CatmullRomCurve3, Vector3, MathUtils, type Object3D,
} from 'three';
import { RAINBOW } from '../core/palette';
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

// backCrest 0: all roots on the crown, fanned across X (a topknot). backCrest 1:
// roots march down the neck crest — x≈0, Y from the crown toward the nape, Z
// toward the back of the head — a horse mane running along the back. crestDrop /
// crestBack size that ridge; only in play when backCrest > 0.
function backRoot(d: number, m: typeof Unicorn.tune.mane): Vector3 {
  const t = m.backCrest;
  const span = Math.max(1, m.backCount - 1);
  const u = (d + span / 2) / span; // 0..1 along the row, front → back
  return new Vector3(
    d * m.xStep * (1 - t),
    BODY_HALF_m - t * u * m.crestDrop,
    m.backRootZ - t * u * m.crestBack,
  );
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

// module-level so groom's Unicorn.rebuildGeo() can swap them; every Unicorn
// shares them.
let hornGeo = twistedHornGeo(0.075, 0.02, 2.5);
let strands: { geo: TubeGeometry; root: Vector3; yaw: number; back: boolean }[] = [];

function buildManeGeos(): void {
  for (const s of strands) s.geo.dispose();
  strands = [];
  const m = Unicorn.tune.mane;
  const add = (root: Vector3, yaw: number, back: boolean) => {
    strands.push({ geo: taperedTube(sDrape(root, yaw, back, m), m.radius, m.taper), root, yaw, back });
  };
  const bmid = (m.backCount - 1) / 2;
  // as backCrest → 1 the roots line up along the back, so drop the X-fan and add
  // a constant `crestSide` yaw so the ridge falls to one side (a real horse mane)
  for (let i = 0; i < m.backCount; i++)
    add(backRoot(i - bmid, m), (i - bmid) * m.backFan * (1 - m.backCrest) + m.crestSide * m.backCrest, true);
  const fmid = (m.foreCount - 1) / 2;
  for (let i = 0; i < m.foreCount; i++) add(foreRoot(i - fmid, m), (i - fmid) * m.foreFan, false);
}

export class Unicorn extends Actor {
  // Config, on the class. groom binds lil-gui folders to mane / horn / face.
  static tune = {
    "mane": {
      "backCount": 7,
      "foreCount": 7,
      "radius": 0.015,
      "taper": 1,
      "len": 0.09,
      "foreLen": 0.06,
      "lift": -0.8,
      "drop": 2,
      "sBend": 0.9,
      "backFan": 0,
      "foreFan": 0.1,
      "xStep": 0.001,
      "backCrest": 0.8,
      "crestDrop": 0.045,
      "crestBack": 0.05,
      "crestSide": -2,
      "backRootZ": 0.0085,
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
      "cheekYFrac": 0.35,
      "cheekZ": 0.03,
      "cheekFlat": 1,
      "muzzleYFrac": 0.27,
      "muzzleZ": 0.03
    }
  }
    ;

  override decoy = true;

  #mane: ManeUpdate;
  #t = 0;

  constructor(root: Object3D) {
    super(root);
    if (!strands.length) buildManeGeos();
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

    this.#mane = buildSpringMane(body);
  }

  override animate(delta: number, ySpeed: number, camPos: Vector3): void {
    this.#t += delta;
    // face the player (Y axis) — horn to the front, mane behind
    this.mesh.parent!.worldToLocal(_look.copy(camPos)).sub(this.mesh.position);
    this.mesh.rotation.y = Math.atan2(_look.x, _look.z);
    this.#mane(delta, ySpeed, this.#t);
  }

  // groom only: rebuild the horn + all strand geometry after a shape knob.
  static rebuildGeo(): void {
    if (!__DEV__) return;
    hornGeo.dispose();
    hornGeo = twistedHornGeo(Unicorn.tune.horn.height, Unicorn.tune.horn.baseR, Unicorn.tune.horn.turns);
    buildManeGeos();
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

export function disposeUnicornAssets(): void {
  for (const s of strands) s.geo.dispose();
  for (const g of [hornGeo, eyeGeo, cheekGeo, muzzleGeo]) g.dispose();
  for (const m of [pinkMat, ...maneMat]) m.dispose(); // BLACK_EYE_MAT is owned by Chromlin
}
