import { Vector3 } from 'three';
import type { XRHandSpace } from 'three';
import type { Object3D } from 'three';
import type { XRHandedness } from '../types/XRTypes';
import { InputSource } from './InputSource';
import { SelectCommand } from '../commands/SelectCommand';

// Wraps renderer.xr.getHand(n) with a poll-based "whack" detector (a pinch is
// not handled here: it arrives as a session select, see XRSelectSource). A
// table tap is the palm being driven down fast while it's close to the placed
// surface. We watch the palm centre joint for a downward strike inside that
// band. We deliberately do NOT wait for a near-stop — real hand tracking jitters
// a few mm per frame (~0.2-0.3 m/s), so "stopped" never registers on device;
// firing on the downstroke also feels more responsive.

const PALM = 'middle-finger-metacarpal'; // palm centre; present in every hand pose, less jittery than a fingertip
const SPEED_MIN_mps = 0.6;   // downward speed that counts as a strike
const BAND_LOW_m = -0.04;    // palm y vs. board surface: from 4cm below (tracking slop / surface estimate)…
const BAND_HIGH_m = 0.14;    // …to 14cm above — the metacarpal rides well over a flat slap; still rejects mid-air
const COOLDOWN_ms = 280;     // one whack per hand per this long
const WHACK_REACH_m = 0.18;  // an open palm catches a wider area than a controller point

const _palm = new Vector3();
const _surface = new Vector3();

export class HandSource extends InputSource {
  #hand: XRHandSpace;
  #handedness: XRHandedness;
  #board: Object3D;

  #prev = new Vector3();
  #prevT = 0;
  #tracking = false;
  #coolUntil = 0;

  constructor(hand: XRHandSpace, handedness: XRHandedness, board: Object3D) {
    super();
    this.#hand = hand;
    this.#handedness = handedness;
    this.#board = board;
  }

  override poll(): void {
    if (!this.enabled) return;

    const joint = this.#hand.joints[PALM];
    if (!joint) { this.#tracking = false; return; }

    const now = performance.now();
    joint.getWorldPosition(_palm);

    if (this.#tracking) {
      const dt = (now - this.#prevT) / 1000;
      if (dt > 0 && dt < 0.1) {
        const downSpeed = (this.#prev.y - _palm.y) / dt;
        const relY = _palm.y - this.#board.getWorldPosition(_surface).y;
        if (
          now >= this.#coolUntil &&
          downSpeed >= SPEED_MIN_mps &&
          relY >= BAND_LOW_m && relY <= BAND_HIGH_m
        ) {
          this.queue.push(new SelectCommand(joint, this.#handedness, WHACK_REACH_m, _palm.y));
          this.#coolUntil = now + COOLDOWN_ms;
        }
      }
    }

    this.#prev.copy(_palm);
    this.#prevT = now;
    this.#tracking = true;
  }
}
