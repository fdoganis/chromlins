import { test, expect } from './fixtures';
import * as path from 'node:path';

// Not a test of shipped behavior — Hole.ts is unchanged by this file. This is
// a live comparison tool for a specific proposal on the table: replace
// Hole.ts's 5-piece occluder (brim + crown + base, all colorWrite:false,
// plus the visible pit + floor) with 2 pieces — one visible inner cylinder,
// one "tight and deep" invisible outer cylinder, no separate rim or bottom
// cap. It builds the alternative live, via reflection off classes already in
// the scene (no source changes to Hole.ts), and screenshots both states so a
// visual regression is something to look at, not just reason about.
//
// Findings so far, both real and worth keeping visible here:
//   1. "tight" must NOT mean the same radius as the visible inner cylinder
//      (HOLE_R) — that z-fights it (a diagonal tearing artifact, screenshotted
//      below). Hole.ts's own CROWN_R_m ("strictly outside the pit, no
//      z-fight") is the reason a real gap already exists between the two
//      radii; this reproduces why by doing it wrong once, on purpose.
//   2. With that same small buffer, the simplification looks clean at both a
//      normal overhead angle and a lower angle across the whole board.
//   3. NOT tested here: real device passthrough at a steep raking angle, or
//      the shadow-catcher plane's own interaction with the wide brim
//      (RenderingManager.ts's catcher stencils out only the exact hole
//      mouth — the area the wide brim covers is normally rendered by the
//      catcher, not the brim, so removing the brim might be entirely safe,
//      or might not be — this tool doesn't reach that scenario). If the
//      simplification moves forward, that's the next thing to check, ideally
//      on-device.
//
// See .doc/SIZE-AUDIT.md for the byte-savings side of this (not yet
// measured — needs its own branch per that doc's own methodology).

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const NORMAL = { position: { x: 0, y: 0.55, z: 0.35 }, target: { x: 0, y: 0.12, z: -0.6 } };
const GRAZING = { position: { x: 0, y: 0.08, z: 0.1 }, target: { x: 0, y: 0.03, z: -0.9 } };
const CLOSE_CLIP = { x: 390, y: 340, width: 120, height: 120 }; // one hole, tight, within the NORMAL frame

test('hole occluder: 2-piece simplification vs the current 5-piece design', async ({ page }, testInfo) => {
  test.setTimeout(60_000);

  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  await page.addInitScript(() => {
    const w = window as any;
    const devtools = new EventTarget();
    devtools.addEventListener('observe', (e: any) => { if (e.detail.isScene && !w.__scene) w.__scene = e.detail; });
    w.__THREE_DEVTOOLS__ = devtools;
  });
  await page.addInitScript({ path: path.resolve('node_modules/iwer/build/iwer.min.js') });
  await page.addInitScript(() => {
    const w = window as any;
    const d = new w.IWER.XRDevice(w.IWER.metaQuest3);
    d.installRuntime({ forceInstall: true });
    w.__xr = d;
  });
  await page.goto('/?run');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /start xr/i }).click();
  await page.waitForFunction(async () => (await (window as any).__xr.remote.dispatch('get_session_status', {})).sessionActive, undefined, { timeout: 10_000 });
  await page.waitForTimeout(500);

  async function shoot(label: string, cam: { position: any; target: any }, clip?: { x: number; y: number; width: number; height: number }) {
    await page.evaluate(async ({ cam, up }) => {
      const w = window as any;
      await w.__xr.remote.dispatch('look_at', { device: 'headset', position: cam.position, target: cam.target });
    }, { cam, up: IDENTITY });
    await page.waitForTimeout(200);
    const png = await page.screenshot(clip ? { clip } : {});
    await testInfo.attach(label, { body: png, contentType: 'image/png' });
  }

  await shoot('1. before: normal angle (current 5-piece design)', NORMAL);
  await shoot('2. before: grazing angle across the whole board', GRAZING);
  await shoot('3. before: one hole, close', NORMAL, CLOSE_CLIP);

  // Build the z-fighting reproduction FIRST (radius == HOLE_R exactly), on a
  // throwaway single extra hole position well away from the real board, so
  // it doesn't corrupt the "after" state below.
  await page.evaluate(() => {
    const w = window as any;
    let MeshClass: any, CylGeom: any, occMat: any;
    w.__scene.children[0].traverse((o: any) => {
      if (!MeshClass && o.isMesh && o.geometry?.type === 'CylinderGeometry' && o.material?.colorWrite === false) {
        MeshClass = o.constructor; CylGeom = o.geometry.constructor; occMat = o.material;
      }
    });
    const HOLE_R = 0.055; // deliberately == the visible pit's own radius
    const zfight = new MeshClass(new CylGeom(HOLE_R, HOLE_R, 0.6, 24, 1, true), occMat);
    zfight.position.set(0.7, -0.3, -0.6); // off to the side, doesn't touch the real board
    zfight.renderOrder = -10;
    zfight.userData.__zfightDemo = true; // excluded from the real hole search below
    w.__scene.children[0].add(zfight);
  });
  await shoot('4. z-fight repro: occluder radius == visible pit radius (wrong)', NORMAL, { x: 590, y: 340, width: 150, height: 150 });

  // Now the real comparison: hide the current brim/crown/base/floor for
  // every hole, keep the visible pit wall, add ONE tight-but-buffered
  // ("very tight" = Hole.ts's own CROWN_R_m, not HOLE_R) deep occluder per hole.
  const info = await page.evaluate(() => {
    const w = window as any;
    let MeshClass: any, CylGeom: any, occMat: any;
    const holePositions: { x: number; z: number }[] = [];
    const seen = new Set<string>();

    w.__scene.children[0].traverse((o: any) => {
      if (!o.isMesh || o.userData?.__zfightDemo) return;
      const g = o.geometry;
      if (g?.type === 'CylinderGeometry' && o.material?.colorWrite === false) {
        if (!MeshClass) { MeshClass = o.constructor; CylGeom = g.constructor; occMat = o.material; }
        const key = `${o.position.x.toFixed(3)},${o.position.z.toFixed(3)}`;
        if (!seen.has(key)) { seen.add(key); holePositions.push({ x: o.position.x, z: o.position.z }); }
        o.visible = false;
      } else if (g?.type === 'RingGeometry' || (g?.type === 'CircleGeometry' && o.material?.colorWrite === false)) {
        o.visible = false; // brim, base
      } else if (g?.type === 'CircleGeometry' && o.material?.color && o.material.color.getHex() < 0x202020) {
        o.visible = false; // floor (dark disc) — keep the pit's own cylindrical wall
      }
    });
    if (!MeshClass) return { ok: false };

    const HOLE_R = 0.06; // == Hole.ts's CROWN_R_m — the buffer that avoids the z-fight above
    const DEEP = 0.6; // ~2x the original PIT_DEPTH_m (0.28)
    for (const { x, z } of holePositions) {
      const occ = new MeshClass(new CylGeom(HOLE_R, HOLE_R, DEEP, 24, 1, true), occMat);
      occ.position.set(x, -DEEP / 2, z);
      occ.renderOrder = -10;
      w.__scene.children[0].add(occ);
    }
    return { ok: true, holeCount: holePositions.length };
  });
  expect(info.ok, 'found the occluder classes to reflect and at least one hole to replace').toBe(true);
  expect(info.holeCount, 'all 8 holes found and replaced').toBe(8);

  await shoot('5. after: normal angle (2-piece simplification)', NORMAL);
  await shoot('6. after: grazing angle across the whole board', GRAZING);
  await shoot('7. after: one hole, close', NORMAL, CLOSE_CLIP);

  expect(problems, 'no page errors').toEqual([]);
});
