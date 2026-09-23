import { test, expect } from './fixtures';
import * as path from 'node:path';

// Drives an emulated WebXR hand (IWER) to exercise the HandSource "whack"
// detector — no hardware. The palm is teleported above a hole, then animated
// straight down and stopped dead: a fast descent followed by an abrupt halt at
// table height is exactly what HandSource.poll() looks for. The app is unchanged.
//
// If IWER's hand-joint emulation ever stops tracking the tracked-input transform
// through to the joint spaces, this test can't land a hit; the fallback is a
// unit test that feeds HandSource a scripted trajectory directly.

const CX = 0.28, ARM = 0.13, AZ = -0.6; // ?run gameboard layout (anchor at 0,0,-0.6)
const HOLES: { x: number; z: number }[] = [];
for (const cx of [-CX, CX])
  for (const [dx, dz] of [[-ARM, 0], [ARM, 0], [0, -ARM], [0, ARM]] as const)
    HOLES.push({ x: cx + dx, z: AZ + dz });

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const RAINBOW_BAND = { x: 300, y: 250, width: 400, height: 120 };

test('emulated hand whack on the table collects actors and fills the rainbow', async ({ page }) => {
  test.setTimeout(60_000);

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

  await page.goto('/?run');
  await page.waitForTimeout(1200);

  await page.getByRole('button', { name: /start xr/i }).click();
  await page.waitForFunction(async () => {
    // @ts-expect-error
    return (await window.__xr.remote.dispatch('get_session_status', {})).sessionActive;
  }, undefined, { timeout: 10_000 });
  await page.waitForTimeout(1500);

  await page.evaluate(async () => {
    // @ts-expect-error
    const d = window.__xr;
    await d.remote.dispatch('look_at', { device: 'headset', position: { x: 0, y: 0.55, z: 0.35 }, target: { x: 0, y: 0.12, z: -0.6 } });
    await d.remote.dispatch('set_input_mode', { mode: 'hand' });
    await d.remote.dispatch('set_connected', { device: 'hand-right', connected: true });
  });
  await page.waitForTimeout(400);

  const before = await page.screenshot({ clip: RAINBOW_BAND });

  for (let round = 0; round < 6; round++) {
    for (const h of HOLES) {
      await page.evaluate(async ({ h, up }) => {
        // @ts-expect-error
        const d = window.__xr;
        // lift the palm well above the hole, then slam it down to table height
        await d.remote.dispatch('set_transform', { device: 'hand-right', position: { x: h.x, y: 0.35, z: h.z }, orientation: up });
        await new Promise((r) => setTimeout(r, 40));
        await d.remote.dispatch('animate_to', { device: 'hand-right', position: { x: h.x, y: 0.0, z: h.z }, duration: 0.12 });
      }, { h, up: IDENTITY });
      await page.waitForTimeout(160); // let the abrupt stop register in a poll()
    }
  }
  await page.waitForTimeout(800);

  const after = await page.screenshot({ clip: RAINBOW_BAND });

  expect(Buffer.compare(before, after), 'rainbow band changed (arcs lit by hand whacks)').not.toBe(0);
  expect(problems, 'no page errors').toEqual([]);
});
