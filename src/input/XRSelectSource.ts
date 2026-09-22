import { Matrix4 } from 'three';
import type { WebXRManager } from 'three';
import { InputSource } from './InputSource';
import { SelectCommand } from '../commands/SelectCommand';

// Every WebXR primary action arrives as a session 'select' event carrying its
// input source and an XRFrame valid for that instant: a controller trigger, a
// Quest hand pinch, a phone screen tap, Vision Pro's gaze-and-pinch. Listen on
// the session itself, not on three.js's getController(n) groups: on Vision Pro,
// with hand tracking granted, the two persistent hands take controller slots 0
// and 1 (and never fire events), and each pinch is a `transient-pointer` listed
// after them. three.js only routes a source into a controller that already
// exists, so it silently dropped every one.
//
// Poses are read from the event's frame and copied into the command: a
// transient pointer is removed right after its select, before the next frame
// processes the queue.
export class XRSelectSource extends InputSource {
  constructor(xr: WebXRManager) {
    super();
    xr.addEventListener('sessionstart', () => {
      const session = xr.getSession()!;
      session.addEventListener('select', ({ frame, inputSource: src }) => {
        const ref = xr.getReferenceSpace()!;
        // Never drop a select for want of a pose (three.js's controller groups
        // didn't either): a reticle placement or a START tap needs no aim. An
        // unposed select aims nowhere and has no height (rest = Infinity).
        const ray = frame.getPose(src.targetRaySpace, ref);
        if (!this.enabled) return;
        // Grip where there is one: a transient pointer's target ray starts
        // between the eyes, its grip sits at the pinching fingers.
        const y = (s: XRInputSource) => frame.getPose(s.gripSpace ?? s.targetRaySpace, ref)?.transform.position.y;
        // REST ON TABLE: the lowest tracked input, this one included. One hand
        // resting on the table while the other pinches mid-air → the resting
        // palm; a controller set on the table and clicked while the other is
        // still held → that controller; nothing else tracked (one controller,
        // Vision Pro without hand tracking) → wherever this select happened.
        // Lowest rather than "the other hand": an idle hand or controller is
        // usually held above the table, rarely below it.
        let rest = y(src) ?? ray?.transform.position.y ?? Infinity;
        for (const s of session.inputSources) rest = Math.min(rest, y(s) ?? rest);
        this.queue.push(new SelectCommand(
          { matrixWorld: ray ? new Matrix4().fromArray(ray.transform.matrix) : new Matrix4() },
          src.handedness,
          0,
          rest,
        ));
      });
    });
  }
}
