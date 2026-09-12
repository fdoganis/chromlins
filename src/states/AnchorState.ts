import { Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';
import { State } from '../core/State';
import type { Game } from '../core/Game';
import type { RenderingManager } from '../rendering/RenderingManager';
import type { TextManager } from '../text/TextManager';
import type { TextHandle } from '../text/ITextEngine';
import { SelectCommand } from '../commands/SelectCommand';
import { IntroState } from './IntroState';
import { HUD_TEXT } from '../core/palette';

const FLOOR_DIST_m = 0.6; // where the board lands when placed on the floor
const DEV_SKIP_S = 8;     // dev/test only: no reticle ever → floor-place and go

const _v = new Vector3();
const _UP = new Vector3(0, 1, 0);

export class AnchorState extends State {
  #render: RenderingManager;
  #ctx: Game;
  #text: TextManager;
  #hint: TextHandle;
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
    this.#text = ctx.text;
    this.#hint = ctx.text.show('TAP TO PLACE', ctx.rendering.hudAnchor, { color: HUD_TEXT, visible: false });
    this.#reticle = new Mesh(
      new RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2),
      new MeshBasicMaterial()
    );
    this.#reticle.matrixAutoUpdate = false;
    this.#reticle.visible = false;
    this.#render.scene.add(this.#reticle); // tracking-space-rooted, NOT under anchor
    this.on(SelectCommand, this.#onSelect);
  }

  // Reticle + "TAP TO PLACE" hint move together: both on only when we have a
  // real hit-test pose to aim at.
  #showReticle(v: boolean) {
    this.#reticle.visible = v;
    this.#text.setVisible(this.#hint, v);
  }

  // No hit-test source at all (VR, or an AR device that granted none): swap
  // the hint to wording that fits any select source, not just a tap.
  #setNoHitTest() {
    this.#noHitTest = true;
    this.#text.setText(this.#hint, 'REST ON TABLE - SELECT');
    this.#text.setVisible(this.#hint, true);
  }

  #onSelect = (cmd: SelectCommand) => {
    if (this.#done) return;
    if (this.#reticle.visible) {
      // Keep only the hit position. The hit-test pose's rotation about the surface
      // normal is runtime-defined — Quest yaws it ~180° from where the emulator /
      // ARCore put it, which spun the whole board (actors facing away, rainbow in
      // front). Ignore the pose orientation and face the player instead.
      this.#reticle.matrix.decompose(
        this.#render.anchor.position,
        this.#render.anchor.quaternion,
        this.#render.anchor.scale
      );
    } else if (this.#noHitTest) {
      // No hit-test source (VR, or an AR device that granted none): whatever
      // fired this select — hand pinch or controller trigger, no distinction
      // needed — is resting near the real table. Use its height, not a guess.
      this.#placeOnFloor(_v.setFromMatrixPosition(cmd.transform.matrixWorld).y - 0.02);
      return;
    } else {
      return; // no pose yet, and hit-test might still show up
    }
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

  // No usable hit-test: put the board ahead, facing forward, and let the player
  // reach/aim at it. `y`, when given, is a real measured height (see #onSelect);
  // otherwise guess the floor — local-floor space → camera.y ≈ standing height
  // so the floor is y=0, a headset-origin space → camera.y ≈ 0 so it's ~1.6 m
  // below (per the WebXR default eye height).
  #placeOnFloor(y?: number) {
    const camY = this.#render.camera.position.y;
    this.#render.anchor.position.set(0, y ?? (camY > 0.8 ? 0 : camY - 1.6), -FLOOR_DIST_m);
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
          if (!hitTestPromise) { this.#setNoHitTest(); return; }
          return Promise.resolve(hitTestPromise);
        })
        .then((source: XRHitTestSource | undefined) => { if (source) this.#hitTestSource = source; })
        .catch(() => { this.#setNoHitTest(); });

      session.addEventListener('end', () => {
        this.#hitTestSource?.cancel();
        this.#hitTestSource = null;
        this.#requested = false;
      });
    }

    if (this.#noHitTest) return; // waiting on #onSelect to place from whatever fired it

    if (this.#hitTestSource) {
      const hits = frame.getHitTestResults(this.#hitTestSource);
      const pose = hits.length > 0 ? hits[0].getPose(refSpace) : null;
      this.#showReticle(!!pose); // visible only when we have a real pose
      if (pose) { this.#sawReticle = true; this.#reticle.matrix.fromArray(pose.transform.matrix); }
    }
  }

  override enter() {
    this.#showReticle(false);
    this.#reticle.matrix.identity();
    this.#noHitTest = false;
    this.#sawReticle = false;
    this.#waited = 0;
    this.#done = false;
  }

  override exit() {
    this.#showReticle(false);
    this.#hitTestSource?.cancel();
    this.#hitTestSource = null;
    this.#requested = false;
  }
}
