import { test, expect } from './fixtures';
import * as path from 'node:path';

// tests/hand-occlusion-scene.spec.ts proves the same mechanism against a
// real decoy's horn, but that couples the test to that mesh's tiny size and
// exact look. This test is the simpler, content-independent version: a
// plain cyan cube we insert ourselves, at a position and camera framing we
// fully control, with no dependency on any actor's geometry, color, or the
// current game state. Either test failing points at the same thing
// (HandOccluder not doing its job) — this one is just easier to read and
// far less fiddly to keep passing if the game's content changes.
//
// No new source hooks needed: `three`'s Mesh/BoxGeometry/MeshBasicMaterial
// classes aren't exposed as globals, but real instances of exactly those
// classes already exist in the live scene (built unconditionally in World's
// constructor, before any board is even placed) — reflecting off
// `.constructor` gets the real classes with zero source changes. Two
// mistakes found the hard way, both worth keeping in mind for any similar
// reflection: Sparkles' Box+Basic pair lives on an InstancedMesh, whose
// constructor takes a 3rd (count) argument a plain Mesh's doesn't — grab the
// Mesh class from a plain (non-instanced) mesh instead, or you silently
// build a malformed zero-instance mesh that renders nothing. And the
// renderer's NeutralToneMapping compresses a flat material color unless it
// opts out with `toneMapped: false`, same as this project's own Sparkles/
// Rainbow materials already do for exactly this reason.
//
// Read-only probe: three.js hands its Scene to `__THREE_DEVTOOLS__` on
// construction (same convention as tests/mobile-ar.spec.ts / tests/pinch.spec.ts).

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const CUBE_POS = { x: 0, y: 0.3, z: -0.5 };
// Measured, not guessed: at 0.15m, no hand position got residual coverage
// below ~45% — the emulated 'relaxed' hand pose is only about as big as a
// real adult hand, so a target that size is close to the hand's own limit to
// fully cover regardless of placement. 0.08m (roughly one game actor's own
// body diameter) is the realistic size for "a hand should be able to hide
// this," and converges to ~22% residual with the right offset below.
const CUBE_SIZE = 0.08;
// Cyan: deliberately NOT in RAINBOW (src/core/palette.ts) or any other color
// this game uses — pure green collided with a naturally-spawned gnome and
// silently measured the wrong object, found by re-running twice and seeing
// the "cube" jump to a different screen position each time.
const CUBE_COLOR = 0x00ffff;
const CUBE_RGB = { r: 0, g: 255, b: 255 };
const TOLERANCE = 40;
const CAMERA = { position: { x: 0, y: 0.3, z: -0.2 }, target: CUBE_POS }; // 0.3m away, looking straight at the cube — look_at guarantees it lands at image center
// Measured directly (a debug script logged the real min/max of matching
// pixels across the full canvas), not guessed — canvas is 1000x760.
const CLIP = { x: 470, y: 335, width: 80, height: 90 };

test('emulated hand hides a plain cyan test cube placed directly in front of the camera', async ({ page }, testInfo) => {
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

  // `?run` (not a plain page load): before the board is placed, look_at's
  // headset position never actually reaches the render camera (confirmed
  // separately — the pre-placement view stays on its own framing regardless
  // of what look_at is told), so this needs the same proven path the other
  // XR specs use.
  await page.goto('/?run');
  await page.waitForTimeout(1200);

  await page.getByRole('button', { name: /start xr/i }).click();
  await page.waitForFunction(async () => {
    // @ts-expect-error test handle
    return (await window.__xr.remote.dispatch('get_session_status', {})).sessionActive;
  }, undefined, { timeout: 10_000 });
  await page.waitForTimeout(500);

  const cubeAdded = await page.evaluate(({ pos, size, color }) => {
    const w = window as any;
    let BoxGeom: any, BasicMat: any, MeshClass: any;
    w.__scene.traverse((o: any) => {
      if (!MeshClass && o.isMesh && !o.isInstancedMesh) MeshClass = o.constructor;
      if (!BoxGeom && o.geometry?.type === 'BoxGeometry' && o.material?.isMeshBasicMaterial) {
        BoxGeom = o.geometry.constructor;
        BasicMat = o.material.constructor;
      }
    });
    if (!MeshClass || !BoxGeom) return false;
    const cube = new MeshClass(new BoxGeom(size, size, size), new BasicMat({ color, toneMapped: false }));
    cube.position.set(pos.x, pos.y, pos.z);
    w.__scene.add(cube);
    return true;
  }, { pos: CUBE_POS, size: CUBE_SIZE, color: CUBE_COLOR });
  expect(cubeAdded, 'plain test cube constructed via reflected three classes and added to the scene').toBe(true);

  await page.evaluate(async ({ cam, up }) => {
    const w = window as any;
    await w.__xr.remote.dispatch('look_at', { device: 'headset', position: cam.position, target: cam.target });
    await w.__xr.remote.dispatch('set_input_mode', { mode: 'hand' });
    await w.__xr.remote.dispatch('set_connected', { device: 'hand-right', connected: true });
    await w.__xr.remote.dispatch('set_transform', { device: 'hand-right', position: { x: 2, y: 2, z: 2 }, orientation: up });
  }, { cam: CAMERA, up: IDENTITY });
  await page.waitForTimeout(400);

  async function countMatching(label: string): Promise<number> {
    const png = await page.screenshot({ clip: CLIP });
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
    }), { b64: png.toString('base64'), target: CUBE_RGB, tol: TOLERANCE, w: CLIP.width, h: CLIP.height });
  }

  const before = await countMatching('1. cube visible, before the hand moves in');
  expect(before, 'cube is visible (cyan pixels found) before the hand moves in').toBeGreaterThan(500);

  // Teleport the hand to the cube. Offset found by sweeping a grid of
  // candidates and measuring the real residual for each, rather than
  // guessing a direction from the horn test's own (different-shaped,
  // different-size target) offset.
  await page.evaluate(async ({ pos, up }) => {
    const w = window as any;
    await w.__xr.remote.dispatch('set_transform', {
      device: 'hand-right',
      position: { x: pos.x, y: pos.y, z: pos.z - 0.02 },
      orientation: up,
    });
  }, { pos: CUBE_POS, up: IDENTITY });
  await page.waitForTimeout(400);

  const after = await countMatching('2. cube mostly hidden, hand covering it');
  expect(after, 'cube is hidden (cyan pixels mostly gone) once the hand covers it').toBeLessThan(before * 0.4);
  expect(problems, 'no page errors').toEqual([]);
});
