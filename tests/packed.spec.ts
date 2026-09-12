import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

// Validates the SHIPPED packed artifact, not `npm run dev`. The other e2e specs
// drive the un-minified dev bundle; this one builds a production bundle, runs it
// through the real pack pipeline (scripts/pack.mjs by default; set
// PACK_SCRIPT=scripts/pack-closure.mjs to validate the Closure spike), serves
// dist/ statically, and drives an emulated WebXR controller through an actual
// round — so "does terser/Closure + roadroller break gameplay" stops being a
// question.
//
// Prod build ⇒ __DEV__ is false ⇒ no `?run` route: the board is placed the real
// way. IWER has no @iwer/sem, so the app's `requestHitTestSource` rejects —
// AnchorState's "no usable hit-test" path — and then, like any real select on
// that path, a controller select at y=0.02 drops the board at (0,0,-0.6) — the
// same pose `?run` uses, so xr.spec's hole/rainbow constants apply verbatim.
//
// The packed page fetches three from the jsdelivr importmap URL at runtime; this
// spec needs outbound network (CI has it). Set PACKED_PREBUILT=1 to skip the
// build+pack and reuse whatever is already in dist/index.html.

const PACK_SCRIPT = process.env.PACK_SCRIPT ?? 'scripts/pack.mjs';

// ?run gameboard layout (anchor at 0,0,-0.6) — identical to tests/xr.spec.ts
const CX = 0.28, ARM = 0.13, AZ = -0.6;
const HOLES: { x: number; z: number }[] = [];
for (const cx of [-CX, CX])
  for (const [dx, dz] of [[-ARM, 0], [ARM, 0], [0, -ARM], [0, ARM]] as const)
    HOLES.push({ x: cx + dx, z: AZ + dz });

const AIM_DOWN = { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }; // local −Z → −Y
const RAINBOW_BAND = { x: 300, y: 250, width: 400, height: 120 };

let server: Server;
let baseURL: string;

test.beforeAll(async () => {
  test.setTimeout(240_000); // tsc + vite build + roadroller pack

  if (!process.env.PACKED_PREBUILT) {
    // playwright runs from the project root (like the iwer path in xr.spec.ts)
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
    execFileSync('node', [PACK_SCRIPT], { stdio: 'inherit', env: { ...process.env, PACK_O: '1' } });
  }

  const htmlBuf = readFileSync('dist/index.html');
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(htmlBuf);
  });
  await new Promise<void>((r) => server.listen(0, r));
  baseURL = `http://localhost:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

test('packed artifact: an emulated controller plays a round and fills the rainbow', async ({ page }) => {
  test.setTimeout(120_000);

  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  // 1. install IWER before the app boots
  await page.addInitScript({ path: path.resolve('node_modules/iwer/build/iwer.min.js') });
  await page.addInitScript(() => {
    // @ts-expect-error injected UMD global
    const d = new window.IWER.XRDevice(window.IWER.metaQuest3);
    d.installRuntime({ forceInstall: true });
    // @ts-expect-error test handle
    window.__xr = d;
  });

  await page.goto(baseURL + '/');
  await page.waitForTimeout(1500); // packed blob + three from jsdelivr

  // 2. start the session via the app's own button
  await page.getByRole('button', { name: /start xr/i }).click();
  await page.waitForFunction(async () => {
    // @ts-expect-error
    return (await window.__xr.remote.dispatch('get_session_status', {})).sessionActive;
  }, undefined, { timeout: 15_000 });
  await page.waitForTimeout(1500);

  // 3. head high + a controller connected so AnchorState reaches its no-hit-test
  //    path, then a select at y=0.02 places the board at (0,0,-0.6) — #onSelect
  //    subtracts 0.02, so this lands the anchor at exactly y=0, axis-aligned
  //    (x=0 and a hole behind the head ⇒ zero yaw from #faceCamera).
  await page.evaluate(async () => {
    // @ts-expect-error
    const d = window.__xr;
    await d.remote.dispatch('look_at', { device: 'headset', position: { x: 0, y: 1.5, z: 0.3 }, target: { x: 0, y: 0, z: -0.6 } });
    await d.remote.dispatch('set_input_mode', { mode: 'controller' });
    await d.remote.dispatch('set_connected', { device: 'controller-right', connected: true });
  });
  await page.waitForTimeout(1500); // reject → #noHitTest, hint shown
  await page.evaluate(async ({ aim }) => {
    // @ts-expect-error
    const d = window.__xr;
    await d.remote.dispatch('set_transform', { device: 'controller-right', position: { x: 0, y: 0.02, z: -0.6 }, orientation: aim });
    await d.remote.dispatch('set_select_value', { device: 'controller-right', value: 1 });
    await new Promise((r) => setTimeout(r, 25));
    await d.remote.dispatch('set_select_value', { device: 'controller-right', value: 0 });
  }, { aim: AIM_DOWN });
  await page.waitForTimeout(600); // #placeOnFloor → Intro (its own "START" prompt eats the loop's first select below)

  // 4. drop to the standard viewing pose (board already placed; anchor won't move)
  await page.evaluate(async () => {
    // @ts-expect-error
    const d = window.__xr;
    await d.remote.dispatch('look_at', { device: 'headset', position: { x: 0, y: 0.55, z: 0.35 }, target: { x: 0, y: 0.12, z: -0.6 } });
  });
  await page.waitForTimeout(600);

  const before = await page.screenshot({ clip: RAINBOW_BAND });

  // 5. sweep the holes, firing a ray select straight down at each
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

  expect(Buffer.compare(before, after), 'rainbow band changed — the packed build ran a real collect').not.toBe(0);
  expect(problems, 'no page errors from the packed build').toEqual([]);
});
