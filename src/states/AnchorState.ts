import { Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';
import { State } from '../core/State';
import type { Game } from '../core/Game';
import type { RenderingManager } from '../rendering/RenderingManager';
import { SelectCommand } from '../commands/SelectCommand';
import { IntroState } from './IntroState';

const FLOOR_DIST_m = 0.6; // where the board lands when placed on the floor
const DEV_SKIP_S = 8;     // dev/test only: no reticle ever → floor-place and go

const _v = new Vector3();
const _UP = new Vector3(0, 1, 0);

export class AnchorState extends State {
  #render: RenderingManager;
  #ctx: Game;
  #reticle: Mesh;
  #hitTestSource: XRHitTestSource | null | undefined;
  #requested = false;
  #noHitTest = false;  // hit-test unavailable → drop the board on the floor rather than wait forever
  #sawReticle = false; // a real pose has shown at least once → never auto-skip, the player is aiming
  #waited = 0;
  #done = false;

  constructor(ctx: Game) {
    super();
    this.#render = ctx.rendering;
    this.#ctx = ctx;
    this.#reticle = new Mesh(
      new RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2),
      new MeshBasicMaterial()
    );
    this.#reticle.matrixAutoUpdate = false;
    this.#reticle.visible = false;
    this.#render.scene.add(this.#reticle); // tracking-space-rooted, NOT under anchor
    this.on(SelectCommand, this.#onSelect);
  }

  #onSelect = () => {
    if (this.#done || !this.#reticle.visible) return;
    // Keep only the hit position. The hit-test pose's rotation about the surface
    // normal is runtime-defined — Quest yaws it ~180° from where the emulator /
    // ARCore put it, which spun the whole board (actors facing away, rainbow in
    // front). Ignore the pose orientation and face the player instead.
    this.#reticle.matrix.decompose(
      this.#render.anchor.position,
      this.#render.anchor.quaternion,
      this.#render.anchor.scale
    );
    this.#faceCamera();
    this.#advance();
  };

  // Yaw-only toward the player's head, level with the ground — so local +Z (the
  // actors' faces) points at the viewer and the rainbow sits behind the holes,
  // on every runtime.
  #faceCamera() {
    const a = this.#render.anchor;
    _v.copy(this.#render.camera.position).sub(a.position);
    a.quaternion.setFromAxisAngle(_UP, Math.atan2(_v.x, _v.z));
    a.scale.set(1, 1, 1);
  }

  // No usable hit-test: put the board on the floor, ahead, facing forward, and
  // let the player reach/aim at it. local-floor space → camera.y ≈ standing
  // height so the floor is y=0; a headset-origin space → camera.y ≈ 0 so it's
  // ~1.6 m below (per the WebXR default eye height).
  #placeOnFloor() {
    const camY = this.#render.camera.position.y;
    this.#render.anchor.position.set(0, camY > 0.8 ? 0 : camY - 1.6, -FLOOR_DIST_m);
    this.#faceCamera();
    this.#advance();
  }

  #advance() {
    this.#done = true;
    this.#ctx.change(IntroState); // the opening cinematic, then RunState
  }

  override update(delta: number, frame?: XRFrame) {
    if (this.#done) return;

    this.#waited += delta;
    if (__DEV__ && this.#waited > DEV_SKIP_S && !this.#sawReticle) { this.#placeOnFloor(); return; }

    if (!frame) return;

    const session = this.#render.renderer.xr.getSession();
    const refSpace = this.#render.renderer.xr.getReferenceSpace();
    if (!session || !refSpace) return;

    if (!this.#requested) {
      this.#requested = true;

      session.requestReferenceSpace('viewer')
        .then((viewerSpace: XRReferenceSpace) => {
          const hitTestPromise = session.requestHitTestSource?.({ space: viewerSpace });
          if (!hitTestPromise) { this.#noHitTest = true; return; }
          return Promise.resolve(hitTestPromise);
        })
        .then((source: XRHitTestSource | undefined) => { if (source) this.#hitTestSource = source; })
        .catch(() => { this.#noHitTest = true; });

      session.addEventListener('end', () => {
        this.#hitTestSource?.cancel();
        this.#hitTestSource = null;
        this.#requested = false;
      });
    }

    if (this.#noHitTest) { this.#placeOnFloor(); return; }

    if (this.#hitTestSource) {
      const hits = frame.getHitTestResults(this.#hitTestSource);
      const pose = hits.length > 0 ? hits[0].getPose(refSpace) : null;
      this.#reticle.visible = !!pose; // visible only when we have a real pose
      if (pose) { this.#sawReticle = true; this.#reticle.matrix.fromArray(pose.transform.matrix); }
    }
  }

  override enter() {
    this.#reticle.visible = false;
    this.#reticle.matrix.identity();
    this.#noHitTest = false;
    this.#sawReticle = false;
    this.#waited = 0;
    this.#done = false;
  }

  override exit() {
    this.#reticle.visible = false;
    this.#hitTestSource?.cancel();
    this.#hitTestSource = null;
    this.#requested = false;
  }
}
