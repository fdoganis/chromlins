import { Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';
import type { Game } from '../core/Game';
import type { Screen } from '../core/sm';
import type { SelectCommand } from '../commands/SelectCommand';
import { HUD_TEXT } from '../core/palette';

const FLOOR_DIST_m = 0.6; // where the board lands when placed on the floor

const _v = new Vector3();
const _UP = new Vector3(0, 1, 0);

export function makeAnchor(ctx: Game): Screen {
  const render = ctx.rendering;
  const text = ctx.text;
  const hint = text.show('TAP TO PLACE', render.hudAnchor, { color: HUD_TEXT, visible: false });
  const reticle = new Mesh(
    new RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2),
    new MeshBasicMaterial()
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  render.scene.add(reticle); // tracking-space-rooted, NOT under anchor

  let hitTestSource: XRHitTestSource | null | undefined;
  let requested = false;
  let noHitTest = false;  // hit-test unavailable → drop the board on the floor rather than wait forever
  let sawReticle = false; // a real pose has shown at least once → never auto-skip, the player is aiming
  let waited = 0;
  let done = false;

  // Reticle + "TAP TO PLACE" hint move together: both on only when we have a
  // real hit-test pose to aim at.
  const showReticle = (v: boolean) => {
    reticle.visible = v;
    text.setVisible(hint, v);
  };

  // No hit-test source at all (VR, or an AR device that granted none): swap
  // the hint to wording that fits any select source, not just a tap.
  const setNoHitTest = () => {
    noHitTest = true;
    text.setText(hint, 'REST ON TABLE - SELECT');
    text.setVisible(hint, true);
  };

  // Yaw-only toward the player's head, level with the ground — so local +Z (the
  // actors' faces) points at the viewer and the rainbow sits behind the holes,
  // on every runtime.
  const faceCamera = () => {
    const a = render.anchor;
    _v.copy(render.camera.position).sub(a.position);
    a.quaternion.setFromAxisAngle(_UP, Math.atan2(_v.x, _v.z));
    a.scale.set(1, 1, 1);
  };

  const advance = () => { done = true; ctx.change('intro'); }; // the opening cinematic, then RunState

  // No usable hit-test: put the board ahead, facing forward, and let the player
  // reach/aim at it. `y`, when given, is a real measured height (see select());
  // otherwise guess the floor — local-floor space → camera.y ≈ standing height
  // so the floor is y=0, a headset-origin space → camera.y ≈ 0 so it's ~1.6 m
  // below (per the WebXR default eye height).
  const placeOnFloor = (y?: number) => {
    const camY = render.camera.position.y;
    render.anchor.position.set(0, y ?? (camY > 0.8 ? 0 : camY - 1.6), -FLOOR_DIST_m);
    faceCamera();
    advance();
  };

  return {
    select(cmd: SelectCommand) {
      if (done) return;
      if (reticle.visible) {
        // Keep only the hit position. The hit-test pose's rotation about the surface
        // normal is runtime-defined — Quest yaws it ~180° from where the emulator /
        // ARCore put it, which spun the whole board (actors facing away, rainbow in
        // front). Ignore the pose orientation and face the player instead.
        reticle.matrix.decompose(render.anchor.position, render.anchor.quaternion, render.anchor.scale);
      } else if (noHitTest) {
        // No hit-test source (VR, or an AR device that granted none): whatever
        // fired this select — hand pinch or controller trigger, no distinction
        // needed — is resting near the real table. Use its height, not a guess.
        placeOnFloor(_v.setFromMatrixPosition(cmd.transform.matrixWorld).y - 0.02);
        return;
      } else {
        return; // no pose yet, and hit-test might still show up
      }
      faceCamera();
      advance();
    },

    update(delta: number, frame?: XRFrame) {
      if (done) return;

      waited += delta;
      // Some ARKit-based iOS WebXR polyfills grant 'hit-test' but never actually
      // surface a pose; give up on the reticle after 8s and fall into the same
      // manual-placement path as no hit-test support at all.
      if (!noHitTest && !sawReticle && waited > 8) { setNoHitTest(); return; }

      if (!frame) return;

      const session = render.renderer.xr.getSession();
      const refSpace = render.renderer.xr.getReferenceSpace();
      if (!session || !refSpace) return;

      if (!requested) {
        requested = true;

        session.requestReferenceSpace('viewer')
          .then((viewerSpace: XRReferenceSpace) => {
            const hitTestPromise = session.requestHitTestSource?.({ space: viewerSpace });
            if (!hitTestPromise) { setNoHitTest(); return; }
            return Promise.resolve(hitTestPromise);
          })
          .then((source: XRHitTestSource | undefined) => { if (source) hitTestSource = source; })
          .catch(() => { setNoHitTest(); });

        session.addEventListener('end', () => {
          hitTestSource?.cancel();
          hitTestSource = null;
          requested = false;
        });
      }

      if (noHitTest) return; // waiting on select() to place from whatever fired it

      if (hitTestSource) {
        const hits = frame.getHitTestResults(hitTestSource);
        const pose = hits.length > 0 ? hits[0].getPose(refSpace) : null;
        showReticle(!!pose); // visible only when we have a real pose
        if (pose) { sawReticle = true; reticle.matrix.fromArray(pose.transform.matrix); }
      }
    },

    enter() {
      showReticle(false);
      reticle.matrix.identity();
      noHitTest = false;
      sawReticle = false;
      waited = 0;
      done = false;
    },

    exit() {
      showReticle(false);
      hitTestSource?.cancel();
      hitTestSource = null;
      requested = false;
    },
  };
}
