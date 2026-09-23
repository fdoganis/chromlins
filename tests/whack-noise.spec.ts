import { test, expect } from './fixtures';
import * as path from 'node:path';

// whack.spec drives a clean `animate_to`. This one drives the emulated hand
// through a *noisy* descent — accelerate then brake, Gaussian per-frame jitter
// (~2.5 mm, ≈ real Quest hand-tracking noise), lateral drift, a resting hold at
// the bottom — stepping set_transform every ~15 ms so HandSource.poll() samples
// a realistic velocity profile. It's the "emulate it with a hand path" answer:
// enough to prove the downstroke detector survives realistic noise without a
// device. A recorded real session (tests/tools/xr-hand-recorder.html) is still
// the ground truth for the noise *magnitudes*.

const CX = 0.28, ARM = 0.13, AZ = -0.6; // ?run gameboard layout (anchor at 0,0,-0.6)
const HOLES = [
  { x: -CX - ARM, z: AZ }, { x: -CX + ARM, z: AZ },
  { x: CX - ARM, z: AZ }, { x: CX + ARM, z: AZ },
];
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const RAINBOW_BAND = { x: 300, y: 250, width: 400, height: 120 };

test('noisy emulated hand whacks still land (downstroke detector vs. jitter)', async ({ page }) => {
  test.setTimeout(90_000);

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

  for (let round = 0; round < 3; round++) {
    for (const h of HOLES) {
      await page.evaluate(async ({ h, up }) => {
        // @ts-expect-error
        const d = window.__xr;
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        // Box-Muller gaussian
        const g = (sd: number) => sd * Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());

        const START_Y = 0.30, JIT = 0.0025;
        let dx = 0, dz = 0;
        await d.remote.dispatch('set_transform', { device: 'hand-right', position: { x: h.x, y: START_Y, z: h.z }, orientation: up });
        await sleep(30);

        const STEPS = 12;
        for (let s = 1; s <= STEPS; s++) {
          // s^0.55: first ~60% of steps cover ~80% of the drop (cruise), then it brakes
          const frac = Math.pow(s / STEPS, 0.55);
          dx += g(0.001); dz += g(0.001); // slow lateral drift
          await d.remote.dispatch('set_transform', {
            device: 'hand-right',
            position: { x: h.x + dx + g(JIT), y: START_Y * (1 - frac) + g(JIT), z: h.z + dz + g(JIT) },
            orientation: up,
          });
          await sleep(15);
        }
        // rest on the "table" — jitter only, no descent. The old detector waited
        // for this to fall under 0.06 m/s and never fired; the new one already hit.
        for (let s = 0; s < 6; s++) {
          await d.remote.dispatch('set_transform', {
            device: 'hand-right',
            position: { x: h.x + dx + g(JIT), y: g(JIT), z: h.z + dz + g(JIT) },
            orientation: up,
          });
          await sleep(15);
        }
      }, { h, up: IDENTITY });
      await page.waitForTimeout(120);
    }
  }
  await page.waitForTimeout(800);

  const after = await page.screenshot({ clip: RAINBOW_BAND });
  expect(Buffer.compare(before, after), 'rainbow band changed — noisy whacks still collected').not.toBe(0);
  expect(problems, 'no page errors').toEqual([]);
});
