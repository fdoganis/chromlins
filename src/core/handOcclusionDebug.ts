// __DEV__-only comparison tool for HandOccluder, activated by `?run&handdebug`
// (see Game.ts). Loads three's own ground-truth skinned hand model
// (`XRHandModelFactory`, 'mesh' profile — the exact asset three.js's own XR
// hands examples use, fetched at runtime from a CDN, so it costs 0 shipped
// bytes) next to HandOccluder's own debug joint spheres, and exposes
// `window.__handDebug` for a Playwright test (tests/hand-occlusion.spec.ts)
// to screenshot and numerically measure overlap between them. This whole
// module is only ever imported from inside an `__DEV__ && 'handdebug' in
// query` branch, so it folds away entirely in production — see
// HAND-OCCLUSION.md for the full write-up and the measured numbers.
import { WebGLRenderTarget } from 'three';
import type { WebGLRenderer, Scene, PerspectiveCamera } from 'three';
import type { XRHandSpace } from 'three';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import type { HandOccluder } from '../world/HandOccluder';

type Overlap = { occluderPixels: number; meshPixels: number; overlapPixels: number; iou: number };

declare global {
  interface Window {
    __handDebug?: { measureOverlap(): Overlap; showOnly(what: 'both' | 'occluder' | 'mesh'): void };
  }
}

export function installHandOcclusionDebug(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  hands: XRHandSpace[],
  occluder: HandOccluder,
): void {
  const factory = new XRHandModelFactory();
  const models = hands.map((hand) => {
    const model = factory.createHandModel(hand, 'mesh');
    hand.add(model);
    return model;
  });

  const w = renderer.domElement.width;
  const h = renderer.domElement.height;
  const target = new WebGLRenderTarget(w, h);
  const buf = new Uint8Array(w * h * 4);

  // A pixel "counts" if it's not just anti-aliasing noise against the black
  // clear color — one channel comfortably above JPEG/AA-level noise.
  function maskFrom(pixels: Uint8Array): Set<number> {
    const mask = new Set<number>();
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (pixels[o] > 24 || pixels[o + 1] > 24 || pixels[o + 2] > 24) mask.add(i);
    }
    return mask;
  }

  function renderMask(): Set<number> {
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, buf);
    renderer.setRenderTarget(prevTarget);
    return maskFrom(buf);
  }

  // Renders the SAME frame twice: once showing only the occluder's own
  // silhouette (bright, so it reads as "covered"), once showing only the
  // ground-truth mesh, then reports pixel counts and their IoU (intersection
  // over union) — the accuracy/overlap number this tool exists to produce.
  window.__handDebug = {
    // Sets up the visible canvas to show just the occluder in its bright
    // debug color, just the ground-truth mesh, or both together, for a
    // screenshot — the running XR session's own animation loop renders it on
    // its next frame; distinct from measureOverlap's own off-screen
    // render-target passes.
    showOnly(what: 'both' | 'occluder' | 'mesh'): void {
      for (const m of models) m.visible = what !== 'occluder';
      occluder.setDebugMaterial(what === 'mesh' ? 'off' : 'visible');
    },
    measureOverlap(): Overlap {
      for (const m of models) m.visible = false;
      occluder.setDebugMaterial('visible');
      const occMask = renderMask();

      for (const m of models) m.visible = true;
      occluder.setDebugMaterial('off');
      const meshMask = renderMask();

      occluder.setDebugMaterial('occlude'); // restore real behavior
      for (const m of models) m.visible = true;

      let overlap = 0;
      for (const i of occMask) if (meshMask.has(i)) overlap++;
      const union = occMask.size + meshMask.size - overlap;
      return { occluderPixels: occMask.size, meshPixels: meshMask.size, overlapPixels: overlap, iou: union ? overlap / union : 0 };
    },
  };
}
