import { test, expect } from './fixtures';

// The other hand-occlusion specs drive a real IWER hand through a real
// WebXR session against real game content (a decoy's horn, or a synthetic
// cube placed in that same board), and pay for it in complexity: camera
// framing, hand-pose calibration, residual coverage from real finger gaps.
// This is the direct version: an empty scene, a plain cube, and a plain
// synthetic occluder box, no XR, no IWER, no animation loop of our own —
// just two static renders compared. It isolates the exact mechanism
// (colorWrite:false + depthWrite:true + renderOrder) from everything else,
// across the three cases that fully explain it: same renderOrder as the
// target (the original bug's exact condition), a LOWER renderOrder (drawn
// first, hides it completely), and a HIGHER one (drawn after, just as unable
// to hide it as the tied case — confirming this isn't "same vs different",
// it's strictly "before vs not before"). See HandOccluder.ts's own
// OCC_ORDER comment for why: color and depth are separate buffers, and a
// colorWrite:false draw can only ever prevent a later draw, never undo an
// earlier one.
//
// No new source hooks: reflects real Mesh/BoxGeometry/MeshBasicMaterial/
// Color classes off instances already in the live scene (see
// tests/hand-occlusion-plain.spec.ts's header for the two mistakes this
// technique took to get right elsewhere), and reuses RenderingManager's own
// documented default camera transform (0, 1.6, 3), looking down -Z.

const CAM = { x: 0, y: 1.6, z: 3 };
const CLIP = { x: 400, y: 280, width: 200, height: 200 }; // canvas is 1000x760; camera has no rotation, so its view axis lands at image center
const CYAN = { r: 0, g: 255, b: 255 };

test('a colorWrite:false occluder only hides what it draws before, on a minimal empty scene', async ({ page }, testInfo) => {
  test.setTimeout(30_000);

  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  await page.addInitScript(() => {
    const w = window as any;
    const devtools = new EventTarget();
    devtools.addEventListener('observe', (e: any) => { if (e.detail.isScene && !w.__scene) w.__scene = e.detail; });
    w.__THREE_DEVTOOLS__ = devtools;
  });
  await page.goto('/'); // no ?run, no XR session — the app's own default preview camera and animation loop are enough
  await page.waitForTimeout(800);

  // (Re)builds the scene: hides all real game content, black background, a
  // cyan cube on the camera's view axis, and an optional occluder box
  // between the camera and the cube at a given renderOrder.
  async function setup(occluderRenderOrder: number | null): Promise<void> {
    await page.evaluate(({ cam, occRO }) => {
      const w = window as any;
      const scene = w.__scene;
      let MeshClass: any, BoxGeom: any, BasicMat: any, ColorClass: any;
      scene.traverse((o: any) => {
        if (!ColorClass && o.material?.color) ColorClass = o.material.color.constructor;
        if (!MeshClass && o.isMesh && !o.isInstancedMesh) MeshClass = o.constructor;
        if (!BoxGeom && o.geometry?.type === 'BoxGeometry' && o.material?.isMeshBasicMaterial) {
          BoxGeom = o.geometry.constructor;
          BasicMat = o.material.constructor;
        }
      });
      scene.children[0].visible = false; // hide the real board/rainbow/reticle
      scene.background = new ColorClass(0, 0, 0);
      (scene.children as any[]).filter((c) => c.userData?.__test).forEach((c) => scene.remove(c));

      const cube = new MeshClass(new BoxGeom(0.3, 0.3, 0.3), new BasicMat({ color: 0x00ffff, toneMapped: false }));
      cube.position.set(cam.x, cam.y, cam.z - 3.5);
      cube.userData.__test = true;
      scene.add(cube);

      if (occRO !== null) {
        const occluder = new MeshClass(new BoxGeom(0.5, 0.5, 0.5), new BasicMat({ colorWrite: false }));
        occluder.position.set(cam.x, cam.y, cam.z - 1.5); // between the camera and the cube
        occluder.renderOrder = occRO;
        occluder.userData.__test = true;
        scene.add(occluder);
      }
    }, { cam: CAM, occRO: occluderRenderOrder });
  }

  // Also attaches the shot to this test's entry in the monocart report —
  // seeing all four cases side by side is the whole point of this test.
  async function countCyanPixels(label: string): Promise<number> {
    const png = await page.screenshot({ clip: CLIP });
    await testInfo.attach(label, { body: png, contentType: 'image/png' });
    return page.evaluate(({ b64, target, w, h }) => new Promise<number>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, w, h);
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] < 60 && data[i + 1] > target.g - 60 && data[i + 2] > target.b - 60) n++;
        }
        resolve(n);
      };
      img.src = `data:image/png;base64,${b64}`;
    }), { b64: png.toString('base64'), target: CYAN, w: CLIP.width, h: CLIP.height });
  }

  await setup(null);
  await page.waitForTimeout(150);
  const cubeAlone = await countCyanPixels('1. cube alone, no occluder');
  expect(cubeAlone, 'cube is visible with no occluder at all').toBeGreaterThan(500);

  await setup(0); // the original bug's exact condition: same renderOrder as everything else
  await page.waitForTimeout(150);
  const wrongOrder = await countCyanPixels('2. occluder at renderOrder=0 (the bug)');
  expect(wrongOrder, 'an occluder at the SAME renderOrder as its target does not hide it at all').toBe(cubeAlone);

  await setup(-10); // drawn strictly before the cube
  await page.waitForTimeout(150);
  const rightOrder = await countCyanPixels('3. occluder at renderOrder=-10 (the fix)');
  expect(rightOrder, 'an occluder drawn BEFORE its target hides it completely').toBe(0);

  await setup(10); // drawn strictly after the cube — symmetric check
  await page.waitForTimeout(150);
  const afterOrder = await countCyanPixels('4. occluder at renderOrder=+10 (drawn after)');
  expect(afterOrder, 'an occluder drawn AFTER its target does not hide it either (colorWrite:false can only prevent a draw, never undo one)').toBe(cubeAlone);

  expect(problems, 'no page errors').toEqual([]);
});
