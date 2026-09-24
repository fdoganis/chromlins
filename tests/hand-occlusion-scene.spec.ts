import { test, expect } from './fixtures';
import * as path from 'node:path';

// tests/hand-occlusion.spec.ts checks HandOccluder in isolation: its own
// silhouette vs. three's reference hand mesh, in a debug-only scene with
// nothing else in it. That proves the SHAPE is a good hand, but never proves
// the shape actually hides anything real. This test does that: boots the
// real running game (`?run&uni`, a deterministic decoy at hole 0, held
// forever so there's no spawn-timing race), reads the decoy's real horn mesh
// out of the live scene graph (color 0xd8899b, a distinct dusty pink no
// rainbow hue or background color is close to), frames the camera to look
// straight at it, and confirms it's visible — then teleports an emulated
// hand to sit between the camera and it and confirms it VISUALLY DISAPPEARS.
//
// Only one object is checked, but the mechanism being tested is a plain
// z-buffer depth test (HandOccluder writes real depth, colorWrite:false) —
// it has no idea what's behind it, so this generalizes to any opaque scene
// geometry (actors, the rainbow arcs, a hole's own walls) without needing a
// separate test per object. What this does NOT cover: real passthrough
// compositing (desktop/IWER has no camera feed to blend against), multiple
// occluding fingers at once, or interaction with Hole.ts's own unrelated
// occluder trick (a static, different mechanism).
//
// Read-only probe: three.js hands its Scene to `__THREE_DEVTOOLS__` on
// construction; scene.children[0] is RenderingManager's anchor (same
// convention as tests/mobile-ar.spec.ts / tests/pinch.spec.ts).

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const HORN_COLOR = 0xd8899b;
// Measured, not the raw material hex: MeshPhongMaterial shades the horn under
// scene lighting, so the rendered pixels sit around (215,130,150), not the
// flat (216,137,155) source color — sampled directly from a real screenshot.
// Wide enough to catch that shading band, still far from every rainbow hue,
// the black hole rims, and the decoy's own cream body (243,234,215).
const HORN_RGB = { r: 215, g: 130, b: 150 };
const TOLERANCE = 35;
// The camera framing tests/whack.spec.ts already uses to view the whole board
// (proven to work there); hole 0's decoy lands in this fixed pixel region
// under it — measured directly, not computed, since deriving it from a
// projection matrix isn't worth it for one constant.
const CAMERA = { position: { x: 0, y: 0.55, z: 0.35 }, target: { x: 0, y: 0.12, z: -0.6 } };
const DECOY_CLIP = { x: 395, y: 365, width: 50, height: 50 };

test('emulated hand between the camera and a live decoy hides its horn (real scene occlusion, not just a silhouette match)', async ({ page }, testInfo) => {
  test.setTimeout(60_000);

  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  await page.addInitScript({ path: path.resolve('node_modules/iwer/build/iwer.min.js') });
  await page.addInitScript(() => {
    const w = window as any;
    const devtools = new EventTarget();
    devtools.addEventListener('observe', (e: any) => { if (e.detail.isScene && !w.__scene) w.__scene = e.detail; });
    w.__THREE_DEVTOOLS__ = devtools;
    const d = new w.IWER.XRDevice(w.IWER.metaQuest3);
    d.installRuntime({ forceInstall: true });
    w.__xr = d;
  });

  await page.goto('/?run&uni');
  await page.waitForTimeout(1200);

  await page.getByRole('button', { name: /start xr/i }).click();
  await page.waitForFunction(async () => {
    // @ts-expect-error test handle
    return (await window.__xr.remote.dispatch('get_session_status', {})).sessionActive;
  }, undefined, { timeout: 10_000 });
  await page.waitForTimeout(1500); // let ?uni's queued spawn land

  // Read the decoy's horn world position straight out of the live scene graph
  // — no hardcoded hole coordinates, so this stays correct if the board
  // layout ever changes. Object3D.traverse()/getWorldPosition() are methods
  // on the live instances already in the scene, so no `three` import needed
  // here at all.
  const hornPos = await page.evaluate((hex) => {
    const w = window as any;
    let found: { x: number; y: number; z: number } | null = null;
    w.__scene.children[0].traverse((o: any) => {
      if (!found && o.material?.color?.getHex?.() === hex) {
        const m = o.matrixWorld.elements;
        found = { x: m[12], y: m[13], z: m[14] };
      }
    });
    return found;
  }, HORN_COLOR);
  expect(hornPos, 'decoy horn found in the live scene (?uni spawned it)').not.toBeNull();
  const horn = hornPos!;

  await page.evaluate(async ({ cam, up }) => {
    const w = window as any;
    await w.__xr.remote.dispatch('look_at', { device: 'headset', position: cam.position, target: cam.target });
    await w.__xr.remote.dispatch('set_input_mode', { mode: 'hand' });
    await w.__xr.remote.dispatch('set_connected', { device: 'hand-right', connected: true });
    // Park the hand well out of frame until the "before" shot is taken.
    await w.__xr.remote.dispatch('set_transform', { device: 'hand-right', position: { x: 2, y: 2, z: 2 }, orientation: up });
  }, { cam: CAMERA, up: IDENTITY });
  await page.waitForTimeout(400);

  // The renderer has no `preserveDrawingBuffer`, so reading the live <canvas>
  // straight back via drawImage() gets an already-cleared buffer (0 pixels,
  // always) — found the hard way. page.screenshot() captures the actual
  // compositor output regardless, so decode that PNG back in-page instead.
  async function countMatching(label: string): Promise<number> {
    const png = await page.screenshot({ clip: DECOY_CLIP });
    await testInfo.attach(label, { body: png, contentType: 'image/png' });
    return page.evaluate(({ b64, target, tol, w, h }) => new Promise<number>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, w, h);
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (Math.abs(data[i] - target.r) <= tol && Math.abs(data[i + 1] - target.g) <= tol && Math.abs(data[i + 2] - target.b) <= tol) n++;
        }
        resolve(n);
      };
      img.src = `data:image/png;base64,${b64}`;
    }), { b64: png.toString('base64'), target: HORN_RGB, tol: TOLERANCE, w: DECOY_CLIP.width, h: DECOY_CLIP.height });
  }

  const before = await countMatching('1. horn visible, before the hand moves in');
  expect(before, 'horn is visible (pink pixels found) before the hand moves in').toBeGreaterThan(20);

  // Teleport the hand so it covers the horn — centering the WRIST exactly on
  // it undershoots (confirmed by making the occluder briefly visible: the
  // relaxed pose's wrist sits at the heel of the palm, so the fingers/palm
  // volume that actually does the covering sits above and toward the camera
  // from the wrist point, not straddling it).
  await page.evaluate(async ({ horn, up }) => {
    const w = window as any;
    await w.__xr.remote.dispatch('set_transform', {
      device: 'hand-right',
      position: { x: horn.x, y: horn.y + 0.07, z: horn.z + 0.05 },
      orientation: up,
    });
  }, { horn, up: IDENTITY });
  await page.waitForTimeout(400);

  const after = await countMatching('2. horn hidden, hand covering it');
  // Not near-zero: this clip also catches a sliver of anti-aliased edge
  // pixels the hand doesn't quite geometrically cover (confirmed separately,
  // with the occluder briefly made visible, that this residual matches
  // ordinary imprecise coverage, not a remaining depth bug) — 0.4 leaves a
  // wide margin below that real, measured residual while still failing hard
  // if occlusion breaks again (the original bug left ~95% of the pixels).
  expect(after, 'horn is hidden (most pink pixels gone) once the hand covers it').toBeLessThan(before * 0.4);
  expect(problems, 'no page errors').toEqual([]);
});
