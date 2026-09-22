import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as path from 'node:path';

// Apple Vision Pro's input model, emulated on top of IWER (which ships no
// visionOS profile). What matters here, per WebKit's "Introducing Natural Input
// for WebXR in Apple Vision Pro":
//
//  - immersive-vr only, no hit-test → AnchorState's "REST ON TABLE - SELECT" path
//  - with hand-tracking granted, inputSources[0] and [1] are persistent
//    tracked-pointer hands, "supplied for pose information only and do not
//    trigger any events"
//  - each pinch adds a `transient-pointer` input source *after* the hands. Its
//    targetRaySpace starts between the eyes and points at what the user looks
//    at; its gripSpace sits at the pinching fingers. selectstart → select →
//    selectend, then it is removed again.
//
// The hands are real IWER hands (joints pinch, so three.js still emits its own
// joint-distance pinchstart/pinchend) with their select events switched off;
// transient pointers are spliced into the device's input source list and their
// events dispatched from inside an XR frame, like the UA does.
//
// Read-only probe: three.js announces its Scene and WebGLRenderer to
// `__THREE_DEVTOOLS__` when constructed, so the specs can read the placed board
// (scene.children[0] is RenderingManager's anchor) without touching the app.

type V3 = { x: number; y: number; z: number };

async function bootVisionPro(page: Page, url: string, handTracking: boolean) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  await page.addInitScript({ path: path.resolve('node_modules/iwer/build/iwer.min.js') });
  await page.addInitScript((handTracking: boolean) => {
    const w = window as any;
    const I = w.IWER;

    const devtools = new EventTarget();
    devtools.addEventListener('observe', (e: any) => {
      if (e.detail.isScene && !w.__scene) w.__scene = e.detail;
      if (e.detail.isWebGLRenderer) w.__renderer = e.detail;
    });
    w.__THREE_DEVTOOLS__ = devtools;

    const d = new I.XRDevice({
      ...I.metaQuest3,
      name: 'Apple Vision Pro (emulated)',
      controllerConfig: undefined,
      supportedSessionModes: ['inline', 'immersive-vr'],
      supportedFeatures: ['viewer', 'local', 'local-floor', ...(handTracking ? ['hand-tracking'] : [])],
    });
    d.installRuntime({ forceInstall: true });
    d.primaryInputMode = 'hand';
    // visionOS hands never fire select themselves
    for (const h of Object.values(d.hands) as any[])
      h.inputSource.gamepad[I.P_GAMEPAD].buttonsMap.pinch[I.P_GAMEPAD].eventTrigger = null;

    // transient pointers go after the persistent hands in inputSources
    const transient: any[] = [];
    const base = Object.getOwnPropertyDescriptor(I.XRDevice.prototype, 'inputSources')!.get!;
    Object.defineProperty(d, 'inputSources', { get() { return [...base.call(this), ...transient]; } });
    w.__xr = d;

    const session = () => w.__renderer.xr.getSession();
    const inFrame = (fn: (f: any) => void) =>
      new Promise<void>((r) => session().requestAnimationFrame((_t: number, f: any) => { fn(f); r(); }));

    // column-major pose at `p` whose −Z looks toward `at`
    const lookPose = (p: V3, at: V3) => {
      let zx = p.x - at.x, zy = p.y - at.y, zz = p.z - at.z;
      const zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
      const up = Math.abs(zy) > 0.99 ? [0, 0, -1] : [0, 1, 0];
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      const xl = Math.hypot(xx, xy, xz); xx /= xl; xy /= xl; xz /= xl;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([xx, xy, xz, 0, yx, yy, yz, 0, zx, zy, zz, 0, p.x, p.y, p.z, 1]);
    };

    // One gaze-and-pinch: `eye` → `gaze` is the target ray, `grip` the pinch
    // point. `hand`, if tracked, also closes its IWER joints (three.js then sees
    // its own pinchstart/pinchend, as on device). `gaze: null` looks at a
    // Chromlin peeking out right now (not the unicorn, whose tap takes an arc
    // back), picked in the same task the pinch starts; resolves false if none.
    w.__pinch = async ({ eye, gaze, grip, hand }: { eye: V3; gaze: V3 | null; grip: V3; hand: string | null }) => {
      if (!gaze) {
        const m = w.__scene.children[0].children.find((o: any) => o.geometry?.type === 'CapsuleGeometry' &&
          o.visible && o.position.y > -0.03 && o.material.color.getHexString() !== 'f3ead7');
        if (!m) return false;
        gaze = m.getWorldPosition(m.position.clone()) as V3;
        gaze = { x: gaze.x, y: gaze.y + 0.02, z: gaze.z };
      }
      const G = d[I.P_DEVICE].globalSpace;
      const src = new I.XRInputSource(
        hand ?? 'right', 'transient-pointer', ['generic-button'],
        new I.XRSpace(G, lookPose(eye, gaze)),
        null,
        new I.XRSpace(G, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, grip.x, grip.y, grip.z, 1])),
        undefined,
      );
      const fire = (type: string, f: any) => session().dispatchEvent(new I.XRInputSourceEvent(type, { frame: f, inputSource: src }));
      if (hand) d.remote.dispatch('set_select_value', { device: `hand-${hand}`, value: 1 });
      transient.push(src);
      await inFrame((f) => fire('selectstart', f)); // 'added' went out at this frame's start
      await inFrame(() => {});
      await inFrame((f) => {
        fire('select', f);
        fire('selectend', f);
        transient.splice(transient.indexOf(src), 1); // 'removed' goes out next frame
      });
      if (hand) d.remote.dispatch('set_select_value', { device: `hand-${hand}`, value: 0 });
      await inFrame(() => {});
      return true;
    };
  }, handTracking);

  await page.goto(url);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /start xr/i }).click();
  await page.waitForFunction(async () => {
    // @ts-expect-error test handle
    return (await window.__xr.remote.dispatch('get_session_status', {})).sessionActive;
  }, undefined, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  return problems;
}

const xr = (page: Page, method: string, params: object) =>
  // @ts-expect-error test handle
  page.evaluate(([m, p]) => window.__xr.remote.dispatch(m, p), [method, params] as const);

const pinch = (page: Page, hand: 'left' | 'right' | null, eye: V3, gaze: V3 | null, grip: V3): Promise<boolean> =>
  // @ts-expect-error test handle
  page.evaluate((a) => window.__pinch(a), { eye, gaze, grip, hand });

const boardPos = (page: Page) =>
  // @ts-expect-error test handle
  page.evaluate(() => { const p = window.__scene.children[0].position; return { x: p.x, y: p.y, z: p.z }; });

const EYE = { x: 0, y: 1.6, z: 0 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

test('Vision Pro: left hand resting on the table + right pinch places the board at table height', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = await bootVisionPro(page, '/', true);

  const TABLE_Y = 0.74;
  await xr(page, 'look_at', { device: 'headset', position: EYE, target: { x: 0, y: TABLE_Y, z: -0.5 } });
  await xr(page, 'set_connected', { device: 'hand-left', connected: true });
  await xr(page, 'set_connected', { device: 'hand-right', connected: true });
  await xr(page, 'set_transform', { device: 'hand-left', position: { x: -0.18, y: TABLE_Y, z: -0.4 }, orientation: IDENTITY });
  const RIGHT = { x: 0.22, y: 1.12, z: -0.3 }; // pinching mid-air, ~40 cm over the table
  await xr(page, 'set_transform', { device: 'hand-right', position: RIGHT, orientation: IDENTITY });
  // hit-test rejected → "REST ON TABLE - SELECT". Also sit well past
  // AnchorState's 8 s no-reticle timeout (counted from page load): nothing but a
  // select may place the board (older dev builds floor-placed it there), and a
  // select must still work afterwards.
  await page.waitForTimeout(8000);

  expect((await boardPos(page)).z, 'not placed before any select, even past 8 s').toBe(0);

  await pinch(page, 'right', EYE, { x: 0, y: TABLE_Y, z: -0.5 }, RIGHT);
  await page.waitForTimeout(400);

  const b = await boardPos(page);
  expect(b.z, 'board placed ahead of the player').toBeLessThan(-0.3);
  // the resting palm, not the pinching hand (1.12) nor the floor (0)
  expect(b.y, `board height ${b.y.toFixed(3)} ≈ table ${TABLE_Y}`).toBeGreaterThan(TABLE_Y - 0.05);
  expect(b.y).toBeLessThan(TABLE_Y + 0.05);
  expect(problems, 'no page errors').toEqual([]);
});

test('Vision Pro without hand tracking: a pinch at the desired level places the board there', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = await bootVisionPro(page, '/', false);

  const LEVEL_Y = 0.9;
  await xr(page, 'look_at', { device: 'headset', position: EYE, target: { x: 0, y: LEVEL_Y, z: -0.5 } });
  await page.waitForTimeout(1500);

  await pinch(page, null, EYE, { x: 0, y: LEVEL_Y, z: -0.5 }, { x: 0.1, y: LEVEL_Y, z: -0.35 });
  await page.waitForTimeout(400);

  const b = await boardPos(page);
  expect(b.z, 'board placed ahead of the player').toBeLessThan(-0.3);
  expect(b.y, `board height ${b.y.toFixed(3)} ≈ pinch ${LEVEL_Y}`).toBeGreaterThan(LEVEL_Y - 0.05);
  expect(b.y).toBeLessThan(LEVEL_Y + 0.05);
  expect(problems, 'no page errors').toEqual([]);
});

test('Vision Pro: gaze-and-pinch at a distance collects actors', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = await bootVisionPro(page, '/?run', true);

  const HEAD = { x: 0, y: 0.55, z: 0.35 };
  await xr(page, 'look_at', { device: 'headset', position: HEAD, target: { x: 0, y: 0.12, z: -0.6 } });
  await xr(page, 'set_connected', { device: 'hand-left', connected: true });
  await xr(page, 'set_connected', { device: 'hand-right', connected: true });
  // hands near the body, ~1 m from the actors and above HandSource's whack
  // band (board + 14 cm): only the gaze ray can reach one
  await xr(page, 'set_transform', { device: 'hand-left', position: { x: -0.2, y: 0.35, z: 0.25 }, orientation: IDENTITY });
  const RIGHT = { x: 0.2, y: 0.35, z: 0.25 };
  await xr(page, 'set_transform', { device: 'hand-right', position: RIGHT, orientation: IDENTITY });
  await page.waitForTimeout(400);

  // lit rainbow arcs: only a collect lights one (level 1: one tap per colour)
  const fills = () => page.evaluate(() => {
    // @ts-expect-error test handle
    const kids = window.__scene.children[0].children;
    return kids.filter((o: any) => o.geometry?.type === 'TorusGeometry' && o.renderOrder === 1 && o.visible).length;
  });
  expect(await fills(), 'rainbow starts empty').toBe(0);

  // look at whichever Chromlin is peeking and pinch, until three are collected
  let pinches = 0;
  for (let tries = 0; tries < 60 && (await fills()) < 3; tries++) {
    if (await pinch(page, 'right', HEAD, null, RIGHT)) pinches++;
    else await page.waitForTimeout(100);
  }

  const lit = await fills();
  test.info().annotations.push({ type: 'gaze pinches', description: `${lit} arcs lit in ${pinches} pinches` });
  expect(lit, 'gaze-and-pinch collects light rainbow arcs').toBeGreaterThanOrEqual(3);
  expect(problems, 'no page errors').toEqual([]);
});
