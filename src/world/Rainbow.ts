// The rainbow the colors were stolen from: seven half-torus arcs standing over
// the board, in real order — RAINBOW[0] (red) outermost, violet innermost. Each
// ring is an Apple-Watch-style gauge: a dim desaturated **track** always shows
// the ring's identity, and a full-colour **fill** arc sweeps thetaLength = π·fill
// over it (fill = count / N for the level). All seven full = round won.
import { Mesh, MeshBasicMaterial, TorusGeometry, Color } from 'three';
import type { Object3D, Vector3 } from 'three';
import { RAINBOW } from '../core/palette';

const ARCS = RAINBOW.length;
const INNER_R_m = 0.40;   // outer arc foot lands ~12cm clear of the ±0.41 hole field
const GAP_m = 0.022;      // radial spacing between rings
const TRACK_TUBE_m = 0.012;
const FILL_TUBE_m = 0.015; // fatter, so the fill covers the track where present
const RADIAL_SEG = 8;
const TUBULAR_SEG = 44;
const Y_OFF_m = 0.13;     // float the whole arc well above the table, clear of the holes
const Z_OFF_m = -0.35;    // set well behind the back hole row so it reads as "over and behind"
const TRACK_S = 0.2;      // an unlit track: same hue, near-flat saturation/lightness
const TRACK_L = 0.52;
const EMPTY = 1e-4;       // ~zero sweep for an unfilled arc

const _hsl = { h: 0, s: 0, l: 0 };
const _target = RAINBOW.map((hex) => new Color(hex));
const _track = _target.map((c) => (c.getHSL(_hsl), new Color().setHSL(_hsl.h, TRACK_S, TRACK_L)));

export class Rainbow {
  #root: Object3D;
  #fills: Mesh<TorusGeometry, MeshBasicMaterial>[] = [];
  #tracks: Mesh<TorusGeometry, MeshBasicMaterial>[] = [];
  #radii: number[] = [];

  constructor(root: Object3D) {
    this.#root = root;
    for (let i = 0; i < ARCS; i++) {
      const r = INNER_R_m + (ARCS - 1 - i) * GAP_m;
      this.#radii.push(r);

      // TorusGeometry arc = PI → upper half; the sweep starts at the +X foot.
      const track = new Mesh(
        new TorusGeometry(r, TRACK_TUBE_m, RADIAL_SEG, TUBULAR_SEG, Math.PI),
        new MeshBasicMaterial({ color: _track[i], toneMapped: false }),
      );
      track.position.set(0, Y_OFF_m, Z_OFF_m);
      this.#root.add(track);
      this.#tracks.push(track);

      const fill = new Mesh(
        new TorusGeometry(r, FILL_TUBE_m, RADIAL_SEG, TUBULAR_SEG, EMPTY),
        new MeshBasicMaterial({ color: _target[i], toneMapped: false }),
      );
      fill.position.set(0, Y_OFF_m, Z_OFF_m);
      fill.renderOrder = 1;
      fill.visible = false;
      this.#root.add(fill);
      this.#fills.push(fill);
    }
  }

  // fill 0..1 — regrow the coloured arc to thetaLength = π·fill and offset it so
  // it hugs the LEFT foot and sweeps rightward (clockwise as seen). Fires only
  // on a collect / unicorn snatch, so rebuilding the little geometry is cheap.
  setFill(i: number, fill: number): void {
    const arc = this.#fills[i];
    if (!arc) return;
    const f = Math.min(1, Math.max(0, fill));
    arc.visible = f > 0;
    arc.rotation.z = Math.PI * (1 - f); // arc [0, πf] shifted to [π(1-f), π] = left side, growing right
    arc.geometry.dispose();
    arc.geometry = new TorusGeometry(this.#radii[i], FILL_TUBE_m, RADIAL_SEG, TUBULAR_SEG, Math.PI * f || EMPTY);
  }

  reset(): void {
    for (let i = 0; i < ARCS; i++) this.setFill(i, 0);
  }

  // Currently unreachable (nothing tears down a whole Game instance today),
  // but correct: every arc's geometry/material is created fresh in this
  // instance's own constructor, never a shared static, so freeing them here
  // is safe.
  dispose(): void {
    for (const arc of [...this.#tracks, ...this.#fills]) {
      this.#root.remove(arc);
      arc.geometry.dispose();
      arc.material.dispose();
    }
  }
}
