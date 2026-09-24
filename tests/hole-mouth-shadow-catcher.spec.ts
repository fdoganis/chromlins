import { test, expect } from './fixtures';

// Regression guard for the settled hole occluder design (see Hole.ts's own
// file comment for the two reverted alternatives this replaced, both found
// broken on real device testing): stencil-based mouth is back, and
// BRIM_R_m is the new, smaller value.

test('the settled hole design: stencil present, small brim', async ({ page }) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    const w = window as any;
    const devtools = new EventTarget();
    devtools.addEventListener('observe', (e: any) => { if (e.detail.isScene && !w.__scene) w.__scene = e.detail; });
    w.__THREE_DEVTOOLS__ = devtools;
  });
  await page.goto('/?run');
  await page.waitForTimeout(1500);

  const result = await page.evaluate(() => {
    const w = window as any;
    let stencilWriters = 0;
    let maxBrimOuterRadius = 0;
    w.__scene.children[0].traverse((o: any) => {
      if (!o.isMesh) return;
      if (o.material?.stencilWrite === true) stencilWriters++;
      if (o.geometry?.type === 'RingGeometry') maxBrimOuterRadius = Math.max(maxBrimOuterRadius, o.geometry.parameters.outerRadius);
    });
    return { stencilWriters, maxBrimOuterRadius };
  });

  expect(result.stencilWriters, 'one stencil-writing mouth mesh per hole, all 8 present').toBe(8);
  expect(result.maxBrimOuterRadius, 'brim is the new, small radius (2*OCC_R_m - HOLE_R_m = 0.065), not the old 0.13').toBeCloseTo(0.065, 3);
});
