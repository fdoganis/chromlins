// A colour spirit: the Actor capsule + a pair of googly Pac-Man eyes on a face
// that yaws toward the player; each pupil springs toward the player's head for
// eye contact, with a rise/sink kick so it jiggles.
import { Mesh, MeshPhongMaterial, CapsuleGeometry, SphereGeometry, Object3D, Vector3, MathUtils } from 'three';
import { Actor } from './Actor';

const eyeGeo = new CapsuleGeometry(0.011, 0.012, 3, 8);
const pupilGeo = new SphereGeometry(0.0065, 8, 6);
const whiteMat = new MeshPhongMaterial({ color: 0xffffff });
// void black, but wet: a bright specular so it always has a glint. Shared with Unicorn.
export const BLACK_EYE_MAT = new MeshPhongMaterial({ color: 0x050505, specular: 0xffffff, shininess: 320 });

const _cam = new Vector3();

type Eye = { pupil: Object3D; x: number; y: number; vx: number; vy: number };

export class Chromlin extends Actor {
  // Config, on the class. ?tweak binds a lil-gui folder to it. yawMax/range/
  // spring/damp/kick are read every frame; the rest at build time.
  static tune = {
    yawMax: 0.8,     // how far the face can turn toward the player
    range: 0.006,    // how far the pupil can roam on the eyeball
    spring: 120,     // pull toward the target — higher = snappier
    damp: 0.78,      // <1 leaves some overshoot → the googly jiggle
    kick: 0.03,      // rise/sink acceleration → pupil impulse
    faceYFrac: 0.55, // face height as a fraction of the body half-height
    whiteX: 0.014,
    whiteZ: 0.043,
  };

  #face: Object3D;
  #eyes: Eye[] = [];
  #prevYSpeed = 0;

  constructor(root: Object3D) {
    super(root);
    const k = Chromlin.tune;
    this.#face = new Object3D();
    this.#face.position.set(0, 0.10 * k.faceYFrac, 0); // 0.10 = Actor half-height
    this.mesh.add(this.#face);
    for (const sx of [-1, 1]) {
      const white = new Mesh(eyeGeo, whiteMat);
      white.position.set(sx * k.whiteX, 0, k.whiteZ);
      this.#face.add(white);
      const pupil = new Mesh(pupilGeo, BLACK_EYE_MAT);
      pupil.position.z = 0.006;
      white.add(pupil);
      this.#eyes.push({ pupil, x: 0, y: 0, vx: 0, vy: 0 });
    }
  }

  override animate(delta: number, ySpeed: number, camPos: Vector3): void {
    const k = Chromlin.tune;
    this.mesh.worldToLocal(_cam.copy(camPos));
    this.#face.rotation.y = MathUtils.clamp(Math.atan2(_cam.x, _cam.z), -k.yawMax, k.yawMax);
    this.#face.updateMatrixWorld();

    this.#face.worldToLocal(_cam.copy(camPos)); // player head in the turned face's frame
    const d = _cam.length() || 1;
    const tx = MathUtils.clamp((_cam.x / d) * 0.02, -k.range, k.range);
    const ty = MathUtils.clamp((_cam.y / d) * 0.02, -k.range, k.range);

    const kick = (ySpeed - this.#prevYSpeed) * k.kick; // pop up → pupils lag down, then spring back
    this.#prevYSpeed = ySpeed;

    for (const e of this.#eyes) {
      e.vx = (e.vx + (tx - e.x) * k.spring * delta) * k.damp;
      e.vy = (e.vy + (ty - e.y - kick) * k.spring * delta) * k.damp;
      e.x += e.vx * delta;
      e.y += e.vy * delta;
      e.pupil.position.x = e.x;
      e.pupil.position.y = e.y;
    }
  }
}

export function disposeChromlinAssets(): void {
  for (const g of [eyeGeo, pupilGeo]) g.dispose();
  for (const m of [whiteMat, BLACK_EYE_MAT]) m.dispose();
}
