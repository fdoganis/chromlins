import { test, expect } from './fixtures';
import * as path from 'node:path';

// Drives a real emulated WebXR controller (IWER) to exercise the pointer/
// controller **ray** collect path — the one headless can't click. Injects IWER
// before the app boots; the app is unchanged.

// Gameboard hole layout in ?run world space (anchor at 0,0,-0.6).
const CX = 0.28, ARM = 0.13, AZ = -0.6;
const HOLES: { x: number; z: number }[] = [];
for (const cx of [-CX, CX])
  for (const [dx, dz] of [[-ARM, 0], [ARM, 0], [0, -ARM], [0, ARM]] as const)
    HOLES.push({ x: cx + dx, z: AZ + dz });

// controller orientation with local −Z pointing straight down (−Y)
const AIM_DOWN = { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

// rainbow band on screen (static geometry; only changes color on a collect)
const RAINBOW_BAND = { x: 300, y: 250, width: 400, height: 120 };

test('emulated controller ray selects collect actors and fill the rainbow', async ({ page }) => {
  test.setTimeout(90_000); // the IWER sweep + setup runs ~40-55s and grows with the codebase; keep generous headroom

  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  // 1. install IWER (forceInstall: Playwright's Chromium ships a hardware-less navigator.xr)
  await page.addInitScript({ path: path.resolve('node_modules/iwer/build/iwer.min.js') });
  await page.addInitScript(() => {
    // @ts-expect-error injected UMD global
    const d = new window.IWER.XRDevice(window.IWER.metaQuest3);
    d.installRuntime({ forceInstall: true });
    // @ts-expect-error test handle for the emulated device
    window.__xr = d;
  });

  await page.goto('/?run');
  await page.waitForTimeout(1200);

  // 2. start the session via the app's own button (so three.js drives the XR loop)
  await page.getByRole('button', { name: /start xr/i }).click();
  await page.waitForFunction(async () => {
    // @ts-expect-error
    return (await window.__xr.remote.dispatch('get_session_status', {})).sessionActive;
  }, undefined, { timeout: 10_000 });
  await page.waitForTimeout(1500); // three.js switches to session rAF; IWER queue starts draining

  // 3. fix the headset framing + bring up a right controller
  await page.evaluate(async () => {
    // @ts-expect-error
    const d = window.__xr;
    await d.remote.dispatch('look_at', { device: 'headset', position: { x: 0, y: 0.55, z: 0.35 }, target: { x: 0, y: 0.12, z: -0.6 } });
    await d.remote.dispatch('set_input_mode', { mode: 'controller' });
    await d.remote.dispatch('set_connected', { device: 'controller-right', connected: true });
  });
  await page.waitForTimeout(400);

  const before = await page.screenshot({ clip: RAINBOW_BAND });

  // 4. sweep the holes, firing a ray select straight down at each; enough passes
  //    that every color gets caught while it's up
  for (let round = 0; round < 8; round++) {
    for (const h of HOLES) {
      await page.evaluate(async ({ h, aim }) => {
        // @ts-expect-error
        const d = window.__xr;
        await d.remote.dispatch('set_transform', { device: 'controller-right', position: { x: h.x, y: 0.4, z: h.z }, orientation: aim });
        await d.remote.dispatch('set_select_value', { device: 'controller-right', value: 1 });
        await new Promise((r) => setTimeout(r, 25));
        await d.remote.dispatch('set_select_value', { device: 'controller-right', value: 0 });
      }, { h, aim: AIM_DOWN });
      await page.waitForTimeout(100);
    }
  }
  await page.waitForTimeout(800);

  const after = await page.screenshot({ clip: RAINBOW_BAND });

  // the rainbow band went from all-gray to colored ⇒ ray selects landed collects
  expect(Buffer.compare(before, after), 'rainbow band changed (arcs lit by ray selects)').not.toBe(0);
  expect(problems, 'no page errors').toEqual([]);
});
