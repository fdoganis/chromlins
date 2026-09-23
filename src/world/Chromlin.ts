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
  #face: Object3D;
  #eyes: Eye[] = [];
  #prevYSpeed = 0;

  constructor(root: Object3D) {
    super(root);
    this.#face = new Object3D();
    this.#face.position.set(0, 0.10 * 0.55, 0); // 0.10 = Actor half-height, 0.55 = faceYFrac
    this.mesh.add(this.#face);
    for (const sx of [-1, 1]) {
      const white = new Mesh(eyeGeo, whiteMat);
      white.position.set(sx * 0.014, 0, 0.043); // whiteX, whiteZ
      this.#face.add(white);
      const pupil = new Mesh(pupilGeo, BLACK_EYE_MAT);
      pupil.position.z = 0.006;
      white.add(pupil);
      this.#eyes.push({ pupil, x: 0, y: 0, vx: 0, vy: 0 });
    }
  }

  override animate(delta: number, ySpeed: number, camPos: Vector3): void {
    this.mesh.worldToLocal(_cam.copy(camPos));
    this.#face.rotation.y = MathUtils.clamp(Math.atan2(_cam.x, _cam.z), -0.8, 0.8); // yawMax
    this.#face.updateMatrixWorld();

    this.#face.worldToLocal(_cam.copy(camPos)); // player head in the turned face's frame
    const d = _cam.length() || 1;
    const tx = MathUtils.clamp((_cam.x / d) * 0.02, -0.006, 0.006); // range
    const ty = MathUtils.clamp((_cam.y / d) * 0.02, -0.006, 0.006); // range

    const kick = (ySpeed - this.#prevYSpeed) * 0.03; // rise/sink pop → pupils lag then spring back
    this.#prevYSpeed = ySpeed;

    for (const e of this.#eyes) {
      e.vx = (e.vx + (tx - e.x) * 120 * delta) * 0.78; // spring, damp (<1 leaves the googly overshoot)
      e.vy = (e.vy + (ty - e.y - kick) * 120 * delta) * 0.78;
      e.x += e.vx * delta;
      e.y += e.vy * delta;
      e.pupil.position.x = e.x;
      e.pupil.position.y = e.y;
    }
  }
}

