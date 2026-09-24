import { test, expect } from './fixtures';
import * as path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

// tests/hand-occlusion.spec.ts measures IoU for exactly one hand pose
// ('relaxed'). That number (0.985) hid a real problem: it barely moves
// across poses (0.982-0.987) even though a curled pose visibly does NOT look
// like a hand in the "both visible" screenshots — a chaotic, spiky mass of
// capsule ends sticking out past the real hand's curled fingers ("point"),
// or a clear rightward offset at the fingertips ("pinch"). Aggregate IoU
// barely notices because the bad pixels are a small fraction of the ~17,000
// total silhouette, but they're there, and this is the test that shows them:
// one screenshot + one IoU number per pose, not just the open-hand case.
//
// Root cause (see HandOccluder.ts's own comment near boneMatrix / handBones.ts):
// each bone capsule is one shared UNIT CapsuleGeometry(1,1,2,6) non-uniformly
// scaled per instance by (avgRadius, length, avgRadius). That scale stretches
// the ROUNDED END CAPS along with the cylinder, since they're baked into the
// same mesh, not a separate part. Two adjacent segments at a sharp bend have
// DIFFERENT lengths, so their caps are stretched by DIFFERENT amounts and
// don't blend where they meet — that mismatch is the visible spike. This is
// not fixable by more polygon segments (that only smooths the facets, not
// the stretch) — see HAND-OCCLUSION.md's own backlog entry for the fix
// being discussed (uniformly-scaled joint spheres covering the seam).
//
// No pass/fail threshold: like hand-occlusion.spec.ts, this is a real
// measurement tool, not a tuned regression gate yet. It exists so a future
// smoothing fix has real "before" numbers AND real "before" screenshots to
// compare against, per pose — not just the one already-good case.

const OUT_DIR = 'test-results/hand-occlusion-poses';
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const POSES = ['relaxed', 'pinch', 'point'] as const;

test('IoU and screenshots across multiple hand poses (relaxed/pinch/point)', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  mkdirSync(OUT_DIR, { recursive: true });

  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  await page.addInitScript({ path: path.resolve('node_modules/iwer/build/iwer.min.js') });
  await page.addInitScript(() => {
    // @ts-expect-error injected UMD global
    const d = new window.IWER.XRDevice(window.IWER.metaQuest3);
    d.installRuntime({ forceInstall: true });
    // @ts-expect-error test handle
    window.__xr = d;
  });

  await page.goto('/?run&handdebug');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /start xr/i }).click();
  await page.waitForFunction(async () => {
    // @ts-expect-error
    return (await window.__xr.remote.dispatch('get_session_status', {})).sessionActive;
  }, undefined, { timeout: 10_000 });
  await page.waitForTimeout(500);

  await page.evaluate(async () => {
    // @ts-expect-error
    const d = window.__xr;
    await d.remote.dispatch('look_at', { device: 'headset', position: { x: 0, y: 0.6, z: 0.4 }, target: { x: 0, y: 0.1, z: -0.3 } });
    await d.remote.dispatch('set_input_mode', { mode: 'hand' });
    await d.remote.dispatch('set_connected', { device: 'hand-right', connected: true });
  });
  await page.waitForTimeout(300);

  await page.waitForFunction(() => '__handDebug' in window, undefined, { timeout: 15_000 });
  await page.waitForTimeout(1000);

  type HandDebug = { measureOverlap(): unknown; showOnly(what: 'both' | 'occluder' | 'mesh'): void };
  type Overlap = { occluderPixels: number; meshPixels: number; overlapPixels: number; iou: number };

  const results: Record<string, Overlap> = {};

  for (const pose of POSES) {
    await page.evaluate(async ({ pose, up }) => {
      // @ts-expect-error
      const d = window.__xr;
      await d.remote.dispatch('set_hand_pose', { device: 'hand-right', poseId: pose });
      await d.remote.dispatch('set_transform', { device: 'hand-right', position: { x: 0.05, y: 0.15, z: -0.3 }, orientation: up });
    }, { pose, up: IDENTITY });
    await page.waitForTimeout(400);

    await page.evaluate((w) => (window as unknown as { __handDebug: HandDebug }).__handDebug.showOnly(w), 'both' as const);
    await page.waitForTimeout(150);
    const png = await page.screenshot();
    writeFileSync(path.join(OUT_DIR, `${pose}-both.png`), png);
    await testInfo.attach(`${pose}: occluder (cyan) vs ground-truth mesh (grey)`, { body: png, contentType: 'image/png' });

    const overlap = await page.evaluate(() => (window as unknown as { __handDebug: HandDebug }).__handDebug.measureOverlap()) as Overlap;
    results[pose] = overlap;
    console.log(`POSE ${pose}:`, JSON.stringify(overlap));

    // Same loose bar as hand-occlusion.spec.ts: both masks drew something,
    // so a future change that silently breaks joint tracking for a
    // non-default pose still fails loudly. No IoU threshold — see the file
    // comment for why the aggregate number doesn't catch the real problem.
    expect(overlap.occluderPixels, `${pose}: occluder drew SOME pixels`).toBeGreaterThan(0);
    expect(overlap.meshPixels, `${pose}: ground-truth mesh drew SOME pixels`).toBeGreaterThan(0);
  }

  writeFileSync(path.join(OUT_DIR, 'overlap-by-pose.json'), JSON.stringify(results, null, 2));
  expect(problems, 'no page errors').toEqual([]);
});
