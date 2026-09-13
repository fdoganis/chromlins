// The decoy: the Actor capsule (shown in cream) + a twisted horn, blush cheeks,
// a pink muzzle, black eyes, and a rainbow mane. `decoy = true` — a tap never
// removes it and an unhit sink isn't a miss (Actors / RunState handle that).
//
// The mane is placed automatically: each strand is an S-curve "drape" that
// starts on the crown / forehead, kicks up, crests over the head and hangs down
// the back, then curls its tip back toward the body — and every sample is pushed
// out of the capsule by `margin` so nothing ends up buried. Rigid tube strands
// on cheap angular springs. Shape/motion knobs are baked to their final,
// locked literal values for this fork's byte budget — no more `Unicorn.tune`
// object; tune the look in the upstream gamma repo's groom studio instead
// (this fork doesn't carry its own copy), then re-bake the values here.
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
function sDrape(root: Vector3, yaw: number, back: boolean): Vector3[] {
  const len = back ? 0.09 : 0.06; // len : foreLen
  const seg = len / DRAPE_N;
  const H = new Vector3(0, 0, back ? -1 : 1).applyAxisAngle(_up, yaw); // fanned horizontal aim
  const abs = root.clone();                 // body-local absolute position, walked forward
  const out = [new Vector3()];              // root-relative
  let pitch = -0.8;                         // radians, + = up (lift)
  for (let i = 1; i <= DRAPE_N; i++) {
    const u = i / DRAPE_N;
    // start pitched up (lift), sweep down to -drop by the tip, one undulation (sBend) => an S
    const target = -0.8 - (-0.8 + 2) * u + 0.9 * Math.sin(u * Math.PI * 1.6); // lift, drop, sBend
    pitch += (target - pitch) * 0.6;         // smooth the corner
    _step.copy(H).multiplyScalar(Math.cos(pitch) * seg);
    _step.y += Math.sin(pitch) * seg;
    abs.add(_step);
    capsuleClamp(abs, 0.008); // margin
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
function backRoot(d: number): Vector3 {
  const t = 0.8; // backCrest
  const span = Math.max(1, 7 - 1); // backCount - 1
  const u = (d + span / 2) / span; // 0..1 along the row, front → back
  return new Vector3(
    d * 0.001 * (1 - t), // xStep
    BODY_HALF_m - t * u * 0.045, // crestDrop
    0.0085 - t * u * 0.05, // backRootZ, crestBack
  );
}
function foreRoot(d: number): Vector3 {
  return new Vector3(d * 0.001, BODY_HALF_m * 0.82, 0.005); // forehead (xStep, foreRootYFrac, foreRootZ)
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

// module-level: every Unicorn shares them.
let hornGeo = twistedHornGeo(0.075, 0.02, 2.5);
let strands: { geo: TubeGeometry; root: Vector3; yaw: number; back: boolean }[] = [];

function buildManeGeos(): void {
  for (const s of strands) s.geo.dispose();
  strands = [];
  const add = (root: Vector3, yaw: number, back: boolean) => {
    strands.push({ geo: taperedTube(sDrape(root, yaw, back), 0.015, 1), root, yaw, back }); // radius, taper
  };
  const bmid = (7 - 1) / 2; // backCount
  // as backCrest → 1 the roots line up along the back, so drop the X-fan and add
  // a constant `crestSide` yaw so the ridge falls to one side (a real horse mane)
  for (let i = 0; i < 7; i++) // backCount
    add(backRoot(i - bmid), (i - bmid) * 0 * (1 - 0.8) + -2 * 0.8, true); // backFan, backCrest, crestSide
  const fmid = (7 - 1) / 2; // foreCount
  for (let i = 0; i < 7; i++) add(foreRoot(i - fmid), (i - fmid) * 0.1, false); // foreCount, foreFan
}

export class Unicorn extends Actor {
  override decoy = true;

  #mane: ManeUpdate;
  #t = 0;

  constructor(root: Object3D) {
    super(root);
    if (!strands.length) buildManeGeos();
    const body = this.mesh;

    for (const sx of [-1, 1]) {
      const eye = new Mesh(eyeGeo, BLACK_EYE_MAT);
      eye.position.set(sx * 0.016, BODY_HALF_m * 0.5, 0.038); // eyeX, eyeYFrac, eyeZ
      body.add(eye);
      const cheek = new Mesh(cheekGeo, pinkMat);
      cheek.position.set(sx * 0.026, BODY_HALF_m * 0.35, 0.03); // cheekX, cheekYFrac, cheekZ
      cheek.scale.set(1, 1, 1); // flattened -> a painted blush spot, not a ball (cheekFlat)
      body.add(cheek);
    }
    // nose + mouth: one flattened pink sphere, centred, low on the face
    const muzzle = new Mesh(muzzleGeo, pinkMat);
    muzzle.position.set(0, BODY_HALF_m * 0.27, 0.03); // muzzleYFrac, muzzleZ
    muzzle.scale.set(1, 0.7, 1); // barely protruding, a touch squashed vertically (cheekFlat)
    body.add(muzzle);

    const horn = new Mesh(hornGeo, pinkMat);
    horn.position.set(0, BODY_HALF_m + 0.027, 0.017); // horn.posY, horn.posZ
    horn.rotation.x = 0.3; // horn.tiltX
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
}

// ---- 'spring' mane: one rigid S-tube per strand on a bounded angular spring ----
type Spring = { mesh: Object3D; phase: number; ang: number; vel: number };

function buildSpringMane(body: Object3D): ManeUpdate {
  const springs: Spring[] = strands.map((st, i) => {
    const mesh = new Mesh(st.geo, maneMat[i % maneMat.length]);
    mesh.position.copy(st.root);
    body.add(mesh);
    return { mesh, phase: i * 1.3, ang: 0, vel: 0 };
  });
  return (dt, ySpeed, t) => {
    for (const s of springs) {
      const accel = -s.ang * 80 + ySpeed * 2; // stiff, kick
      s.vel = (s.vel + accel * dt) / (1 + 20 * dt); // implicit damping — unconditionally stable (damp)
      s.ang = MathUtils.clamp(s.ang + s.vel * dt, -0.5, 0.8); // bounded so the swing never buries the tip
      s.mesh.rotation.x = -s.ang + Math.sin(t * 3 + s.phase) * 0.1; // idle
    }
  };
}

export function disposeUnicornAssets(): void {
  for (const s of strands) s.geo.dispose();
  for (const g of [hornGeo, eyeGeo, cheekGeo, muzzleGeo]) g.dispose();
  for (const m of [pinkMat, ...maneMat]) m.dispose(); // BLACK_EYE_MAT is owned by Chromlin
}
