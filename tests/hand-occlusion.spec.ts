import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

// Compares HandOccluder's own silhouette against three.js's ground-truth
// skinned hand model (the same GLTF asset three's own XR hands examples use,
// XRHandModelFactory's 'mesh' profile, fetched from a CDN) on an emulated
// (IWER) hand in its default, realistic 'relaxed' pose — the same pose data
// tests/whack.spec.ts already relies on, here read for real per-joint
// geometry instead of just a wrist transform. Drives `?run&handdebug`
// (Game.ts + src/core/handOcclusionDebug.ts, __DEV__-only, folds away in
// production) and reads back `window.__handDebug.measureOverlap()`: an IoU
// (intersection over union) of "pixels the occluder would draw" vs "pixels
// the real hand mesh renders to". Screenshots are saved under
// test-results/hand-occlusion/ for visual inspection alongside the number.
//
// This needs network access (the CDN-hosted GLTF); CI has it, same as
// packed.spec.ts's jsdelivr three.js fetch.
//
// No fixed pass/fail threshold yet — this is the first real measurement, not
// a tuned one. It prints the numbers and asserts only that SOMETHING is
// measured (both masks non-empty), so a future change that silently breaks
// the geometry (e.g. every joint reporting invisible) still fails loudly.
// See HAND-OCCLUSION.md for the numbers this run produced and what a good
// target IoU would need to be decided against.

const OUT_DIR = 'test-results/hand-occlusion';
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

test('HandOccluder vs three.js ground-truth hand mesh: overlap measurement + screenshots', async ({ page }) => {
  test.setTimeout(60_000);
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
    // Frame the hand for a legible screenshot, roughly where a player's hand
    // would be reaching toward the board in ?run's fixed camera pose.
    await d.remote.dispatch('look_at', { device: 'headset', position: { x: 0, y: 0.6, z: 0.4 }, target: { x: 0, y: 0.1, z: -0.3 } });
    await d.remote.dispatch('set_input_mode', { mode: 'hand' });
    await d.remote.dispatch('set_connected', { device: 'hand-right', connected: true });
  });
  await page.waitForTimeout(300);

  await page.evaluate(async ({ up }) => {
    // @ts-expect-error
    const d = window.__xr;
    // IWER's default 'relaxed' hand pose (real per-joint offset matrices +
    // radii, not a stand-in) — see HAND-OCCLUSION.md for where this was
    // confirmed in IWER's own source.
    await d.remote.dispatch('set_transform', { device: 'hand-right', position: { x: 0.05, y: 0.15, z: -0.3 }, orientation: up });
  }, { up: IDENTITY });
  await page.waitForTimeout(300);

  // Wait for the ground-truth GLTF (fetched from the CDN by handOcclusionDebug
  // on the 'handdebug' flag) to actually attach — window.__handDebug only
  // exists once installHandOcclusionDebug's dynamic import resolves, and its
  // XRHandModelFactory model loads asynchronously on top of that.
  await page.waitForFunction(() => '__handDebug' in window, undefined, { timeout: 15_000 });
  await page.waitForTimeout(2000); // GLTF fetch + parse

  type HandDebug = { measureOverlap(): unknown; showOnly(what: 'both' | 'occluder' | 'mesh'): void };

  await page.evaluate((w) => (window as unknown as { __handDebug: HandDebug }).__handDebug.showOnly(w), 'mesh' as const);
  await page.waitForTimeout(150);
  writeFileSync(path.join(OUT_DIR, 'mesh-only.png'), await page.screenshot());

  await page.evaluate((w) => (window as unknown as { __handDebug: HandDebug }).__handDebug.showOnly(w), 'occluder' as const);
  await page.waitForTimeout(150);
  writeFileSync(path.join(OUT_DIR, 'occluder-only.png'), await page.screenshot());

  await page.evaluate((w) => (window as unknown as { __handDebug: HandDebug }).__handDebug.showOnly(w), 'both' as const);
  await page.waitForTimeout(150);
  writeFileSync(path.join(OUT_DIR, 'both-visible.png'), await page.screenshot());

  const overlap = await page.evaluate(() => (window as unknown as { __handDebug: HandDebug }).__handDebug.measureOverlap());
  console.log('HandOccluder vs ground-truth mesh overlap:', overlap);
  writeFileSync(path.join(OUT_DIR, 'overlap.json'), JSON.stringify(overlap, null, 2));

  const o = overlap as { occluderPixels: number; meshPixels: number; overlapPixels: number; iou: number };
  expect(o.occluderPixels, 'the occluder drew SOME pixels — a real hand pose was tracked').toBeGreaterThan(0);
  expect(o.meshPixels, 'the ground-truth mesh drew SOME pixels — the GLTF actually loaded and rendered').toBeGreaterThan(0);
  expect(problems, 'no page errors').toEqual([]);
});
