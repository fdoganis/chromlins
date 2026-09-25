import { test, expect } from './fixtures';
import { NotEqualStencilFunc, ReplaceStencilOp } from 'three';

// Regression guard for the settled hole occluder design (see Hole.ts's own
// file comment for the two reverted alternatives this replaced, both found
// broken on real device testing): stencil-based mouth is back, BRIM_R_m is
// the new, smaller value, and every hole's geometry uses the same 32 radial
// segments.
//
// The mechanism has two halves and this guards both: the 8 mouths MARK the
// stencil buffer at each opening, and the shadow catcher READS that mark to
// skip drawing there. Counting them apart matters because three's
// `stencilWrite` is the master switch for the whole stencil state, so the
// catcher sets it too despite never writing. A plain `stencilWrite === true`
// count sees 9 meshes, not 8.

test('the settled hole design: stencil present, small brim, harmonized segments', async ({ page }) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    const w = window as any;
    const devtools = new EventTarget();
    devtools.addEventListener('observe', (e: any) => { if (e.detail.isScene && !w.__scene) w.__scene = e.detail; });
    w.__THREE_DEVTOOLS__ = devtools;
  });
  await page.goto('/?run');
  await page.waitForTimeout(1500);

  const result = await page.evaluate(({ replaceOp, notEqualFunc }) => {
    const w = window as any;
    let stencilWriters = 0;
    let stencilReaders = 0;
    let maxBrimOuterRadius = 0;
    const segmentCounts = new Set<number>();
    let holeFixtures = 0;
    w.__scene.children[0].traverse((o: any) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (m?.stencilWrite === true) {
        if (m.stencilZPass === replaceOp) stencilWriters++;
        else if (m.stencilFunc === notEqualFunc) stencilReaders++;
      }
      // Hole fixtures are the only meshes drawn before the actors, so a
      // negative renderOrder is what separates them from everything else the
      // anchor carries (bodies, rainbow, mane, sparkles, shadow catcher).
      // Without this scope the counts below pick up actor and rainbow
      // geometry, and whether they do depends on what has spawned by now.
      if (o.renderOrder >= 0) return;
      holeFixtures++;
      const p = o.geometry?.parameters ?? {};
      if (o.geometry?.type === 'RingGeometry') maxBrimOuterRadius = Math.max(maxBrimOuterRadius, p.outerRadius);
      // One per geometry class: CylinderGeometry radialSegments, CircleGeometry
      // segments, RingGeometry thetaSegments. Missing the last one is why the
      // brim's own count silently went unchecked.
      for (const key of ['radialSegments', 'segments', 'thetaSegments'])
        if (p[key] !== undefined) segmentCounts.add(p[key]);
    });
    return { stencilWriters, stencilReaders, holeFixtures, maxBrimOuterRadius, segmentCounts: [...segmentCounts] };
  }, { replaceOp: ReplaceStencilOp, notEqualFunc: NotEqualStencilFunc });

  expect(result.stencilWriters, 'one stencil-writing mouth mesh per hole, all 8 present').toBe(8);
  expect(result.stencilReaders, 'the shadow catcher reads that mark to skip the openings, exactly one').toBe(1);
  expect(result.holeFixtures, 'four fixtures per hole: brim, crown, pit, mouth').toBe(32);
  expect(result.maxBrimOuterRadius, 'brim is the new, small radius (2*OCC_R_m - HOLE_R_m = 0.065), not the old 0.13').toBeCloseTo(0.065, 3);
  expect(result.segmentCounts, 'every hole geometry uses the same 32 radial segments').toEqual([32]);
});
