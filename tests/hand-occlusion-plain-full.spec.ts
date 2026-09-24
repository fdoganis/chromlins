import { test, expect } from './fixtures';
import * as path from 'node:path';

// tests/hand-occlusion-plain.spec.ts proves the hand hides MOST of a plain
// cube (a real, sizeable residual is expected and explained there — the
// emulated hand's own silhouette has small gaps and doesn't scale with an
// arbitrarily large target). This is the stricter companion: shrink the
// target enough to fit entirely within the hand's solid palm area, away from
// any inter-finger gaps, and assert TRUE ZERO matching pixels, not "mostly
// gone". Found by measuring, not guessing: 0.04m still leaked a real (not
// anti-aliasing — confirmed by re-checking at a much tighter color tolerance
// and getting the identical count) 6-pixel sliver, presumably a gap between
// fingers in the emulated 'relaxed' pose; 0.02m reached exactly 0 at every
// tolerance tried.
//
// No new source hooks needed — see hand-occlusion-plain.spec.ts's own header
// comment for the reflection technique and the two mistakes it took to get
// right (InstancedMesh vs plain Mesh constructors, toneMapped:false).

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const CUBE_POS = { x: 0, y: 0.3, z: -0.5 };
const CUBE_SIZE = 0.02;
const CUBE_COLOR = 0x00ffff; // not in RAINBOW (src/core/palette.ts) or any other color this game uses
const CUBE_RGB = { r: 0, g: 255, b: 255 };
const TOLERANCE = 40;
const CAMERA = { position: { x: 0, y: 0.3, z: -0.2 }, target: CUBE_POS }; // look_at guarantees the target lands at image center
const CLIP = { x: 470, y: 335, width: 80, height: 90 }; // measured directly against the real canvas, same as hand-occlusion-plain.spec.ts

test('emulated hand fully hides a tiny plain cyan test cube (zero matching pixels)', async ({ page }, testInfo) => {
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

  const before = await countMatching('1. tiny cube visible, before the hand moves in');
  expect(before, 'cube is visible (cyan pixels found) before the hand moves in').toBeGreaterThan(10);

  // Offset found by measuring, not guessing (see the file comment): centers
  // the tiny cube in the palm's solid mass, away from inter-finger gaps.
  await page.evaluate(async ({ pos, up }) => {
    const w = window as any;
    await w.__xr.remote.dispatch('set_transform', {
      device: 'hand-right',
      position: { x: pos.x, y: pos.y + 0.01, z: pos.z },
      orientation: up,
    });
  }, { pos: CUBE_POS, up: IDENTITY });
  await page.waitForTimeout(400);

  const after = await countMatching('2. tiny cube completely hidden, hand covering it');
  expect(after, 'cube is COMPLETELY hidden (zero cyan pixels) once the hand covers it').toBe(0);
  expect(problems, 'no page errors').toEqual([]);
});
