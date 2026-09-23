import { test, expect } from './fixtures';
import * as path from 'node:path';

// Quest-style hands (IWER) with the dev `?xr=vr` flag: the Vision Pro placement
// path (immersive-vr, no hit-test) on Quest input, where a hand pinch is a
// session select on a tracked-pointer hand. Placing the board with one must
// stop on Intro's START prompt, not skip it: a second select per pinch
// (three.js's own joint-distance `pinchend`, once bound as well) used to land on
// Intro and jump straight into the round. The board goes where the pinching
// hand is, since the other one is idle higher up.
//
// Read-only probe: three.js hands its Scene to `__THREE_DEVTOOLS__` on
// construction; scene.children[0] is RenderingManager's anchor.

test('Quest hands + ?xr=vr: one pinch places the board at the hand and waits on START', async ({ page }) => {
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

  await page.goto('/?xr=vr'); // dev flag: immersive-vr even though the Quest supports AR
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /start xr/i }).click();
  await page.waitForFunction(async () => {
    // @ts-expect-error test handle
    return (await window.__xr.remote.dispatch('get_session_status', {})).sessionActive;
  }, undefined, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  // @ts-expect-error test handle
  expect(await page.evaluate(async () => (await window.__xr.remote.dispatch('get_session_status', {})).sessionMode)).toBe('immersive-vr');

  const HAND_Y = 0.75;
  await page.evaluate(async (y) => {
    // @ts-expect-error test handle
    const d = window.__xr;
    await d.remote.dispatch('look_at', { device: 'headset', position: { x: 0, y: 1.5, z: 0.3 }, target: { x: 0, y, z: -0.6 } });
    await d.remote.dispatch('set_input_mode', { mode: 'hand' });
    await d.remote.dispatch('set_connected', { device: 'hand-right', connected: true });
    await d.remote.dispatch('set_transform', { device: 'hand-right', position: { x: 0.1, y, z: -0.4 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  }, HAND_Y);
  await page.waitForTimeout(1500); // no hit-test in VR → "REST ON TABLE - SELECT"

  await page.evaluate(async () => {
    // @ts-expect-error test handle
    const d = window.__xr;
    await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 1 });
    await new Promise((r) => setTimeout(r, 150));
    await d.remote.dispatch('set_select_value', { device: 'hand-right', value: 0 });
  });
  await page.waitForTimeout(4000); // long enough for a (wrongly) started round to raise actors

  const s = await page.evaluate(() => {
    // @ts-expect-error test handle
    const a = window.__scene.children[0];
    return {
      y: a.position.y as number,
      z: a.position.z as number,
      actorsUp: a.children.filter((o: any) => o.geometry?.type === 'CapsuleGeometry' && o.visible).length as number,
    };
  });
  expect(s.z, 'board placed ahead of the player').toBeLessThan(-0.3);
  expect(Math.abs(s.y - HAND_Y), `board height ${s.y.toFixed(3)} ≈ hand ${HAND_Y}`).toBeLessThan(0.05);
  expect(s.actorsUp, 'still on START: one pinch is one select').toBe(0);
  expect(problems, 'no page errors').toEqual([]);
});
