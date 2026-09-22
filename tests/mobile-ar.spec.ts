import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as path from 'node:path';

// Handheld AR (Android Chrome / ARCore), emulated on IWER, which has neither a
// phone profile nor hit-test without its synthetic-environment module:
//
//  - immersive-ar with a real hit-test: `requestHitTestSource` / `getHitTestResults`
//    are stubbed to cast the viewer's forward ray onto a table plane, which is
//    all AnchorState reads (the first result's pose position)
//  - no controllers, no hands: every tap is a `screen` transient input source
//    (handedness 'none', no gripSpace) whose target ray starts at the camera and
//    goes through the touch point. Emulated as the quickest possible tap: added,
//    selectstart → select → selectend inside one frame, removed the next — so the
//    queue is drained only after the source is already gone.
//
// Read-only probe: three.js announces its Scene to `__THREE_DEVTOOLS__`;
// scene.children[0] is RenderingManager's anchor.

type V3 = { x: number; y: number; z: number };

const TABLE_Y = 0.75;
const CAM = { x: 0, y: 1.3, z: 0.25 };

async function bootPhone(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  await page.addInitScript({ path: path.resolve('node_modules/iwer/build/iwer.min.js') });
  await page.addInitScript((tableY: number) => {
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
      name: 'Android phone (emulated)',
      controllerConfig: undefined,
      supportedSessionModes: ['inline', 'immersive-ar'],
      supportedFeatures: ['viewer', 'local', 'local-floor', 'hit-test'],
    });
    d.installRuntime({ forceInstall: true });
    d.primaryInputMode = 'hand'; // no hand-tracking feature → no hand input sources at all

    // hit-test: the viewer's forward ray against the plane y = tableY
    const source = { cancel() {} };
    I.XRSession.prototype.requestHitTestSource = () => Promise.resolve(source);
    const getHits = I.XRFrame.prototype.getHitTestResults;
    I.XRFrame.prototype.getHitTestResults = function (this: any, s: any) {
      if (s !== source) return getHits.call(this, s);
      const frame = this;
      return [{
        getPose(base: any) {
          const m = frame.getViewerPose(base)?.transform.matrix;
          if (!m || m[10] <= 0) return null; // looking level or up: no table
          const t = (m[13] - tableY) / m[9]; // origin + t·(−Z column) reaches the plane
          const x = m[12] - t * m[8], z = m[14] - t * m[10];
          return { transform: { matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, tableY, z, 1]) } };
        },
      }];
    };

    // a runtime that can't pose an input in its event frame (see the second test)
    const getPose = I.XRFrame.prototype.getPose;
    I.XRFrame.prototype.getPose = function (this: any, space: any, base: any) {
      return w.__unposed?.includes(space) ? null : getPose.call(this, space, base);
    };

    const transient: any[] = [];
    const base = Object.getOwnPropertyDescriptor(I.XRDevice.prototype, 'inputSources')!.get!;
    Object.defineProperty(d, 'inputSources', { get() { return [...base.call(this), ...transient]; } });
    w.__xr = d;

    const session = () => w.__renderer.xr.getSession();
    const inFrame = (fn: (f: any) => void) =>
      new Promise<void>((r) => session().requestAnimationFrame((_t: number, f: any) => { fn(f); r(); }));

    const lookPose = (p: V3, at: V3) => {
      let zx = p.x - at.x, zy = p.y - at.y, zz = p.z - at.z;
      const zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
      const up = Math.abs(zy) > 0.99 ? [0, 0, -1] : [0, 1, 0];
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      const xl = Math.hypot(xx, xy, xz); xx /= xl; xy /= xl; xz /= xl;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([xx, xy, xz, 0, yx, yy, yz, 0, zx, zy, zz, 0, p.x, p.y, p.z, 1]);
    };

    // One screen tap from `cam` through `at`. `at: null` aims at a Chromlin
    // peeking right now (not the unicorn); resolves false if none is up.
    // `unposed`: getPose returns null for this tap's target ray.
    w.__tap = async ({ cam, at, unposed }: { cam: V3; at: V3 | null; unposed?: boolean }) => {
      if (!at) {
        const m = w.__scene.children[0].children.find((o: any) => o.geometry?.type === 'CapsuleGeometry' &&
          o.visible && o.position.y > -0.03 && o.material.color.getHexString() !== 'f3ead7');
        if (!m) return false;
        const p = m.getWorldPosition(m.position.clone());
        at = { x: p.x, y: p.y + 0.02, z: p.z };
      }
      const src = new I.XRInputSource('none', 'screen', ['generic-touchscreen'],
        new I.XRSpace(d[I.P_DEVICE].globalSpace, lookPose(cam, at!)), null, undefined, undefined);
      if (unposed) w.__unposed = [src.targetRaySpace];
      const fire = (type: string, f: any) => session().dispatchEvent(new I.XRInputSourceEvent(type, { frame: f, inputSource: src }));
      transient.push(src);
      await inFrame((f) => { // 'added' went out at this frame's start
        fire('selectstart', f);
        fire('select', f);
        fire('selectend', f);
        transient.splice(transient.indexOf(src), 1);
      });
      await inFrame(() => {}); // 'removed'
      await inFrame(() => {}); // the game loop drains the select
      return true;
    };
  }, TABLE_Y);

  await page.goto('/');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /start xr/i }).click();
  await page.waitForFunction(async () => {
    // @ts-expect-error test handle
    const s = await window.__xr.remote.dispatch('get_session_status', {});
    return s.sessionActive && s.sessionMode === 'immersive-ar';
  }, undefined, { timeout: 10_000 });
  await page.waitForTimeout(1000);
  return problems;
}

const tap = (page: Page, cam: V3, at: V3 | null, unposed = false): Promise<boolean> =>
  // @ts-expect-error test handle
  page.evaluate((a) => window.__tap(a), { cam, at, unposed });

const SPOT = { x: 0.1, y: TABLE_Y, z: -0.45 }; // where the phone points on the table

async function aimAtSpot(page: Page) {
  await page.evaluate(async ([cam, spot]) => {
    // @ts-expect-error test handle
    await window.__xr.remote.dispatch('look_at', { device: 'headset', position: cam, target: spot });
  }, [CAM, SPOT] as const);
  await page.waitForTimeout(800);
}

const reticleUp = (page: Page) => page.evaluate(() =>
  // @ts-expect-error test handle
  !!window.__scene.children.find((o: any) => o.geometry?.type === 'RingGeometry')?.visible);

const boardPos = (page: Page) => page.evaluate(() => {
  // @ts-expect-error test handle
  const p = window.__scene.children[0].position; return { x: p.x, y: p.y, z: p.z };
});
const offSpot = (b: V3) => Math.hypot(b.x - SPOT.x, b.y - SPOT.y, b.z - SPOT.z);

test('mobile AR: hit-test reticle + screen tap places the board, then taps play a round', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = await bootPhone(page);

  await aimAtSpot(page); // phone held over the table, pointed where the board should land
  expect(await reticleUp(page), 'hit-test reticle shown on the table').toBe(true);

  await tap(page, CAM, SPOT);
  await page.waitForTimeout(300);
  const b = await boardPos(page);
  expect(offSpot(b), `board at ${JSON.stringify(b)} ≈ reticle`).toBeLessThan(0.01);
  expect(await reticleUp(page), 'reticle gone once placed').toBe(false);

  // Intro's START: one tap starts the round
  await tap(page, CAM, SPOT);
  await page.waitForTimeout(1500);

  const fills = () => page.evaluate(() => {
    // @ts-expect-error test handle
    const kids = window.__scene.children[0].children;
    return kids.filter((o: any) => o.geometry?.type === 'TorusGeometry' && o.renderOrder === 1 && o.visible).length;
  });
  let taps = 0;
  for (let tries = 0; tries < 60 && (await fills()) < 3; tries++) {
    if (await tap(page, CAM, null)) taps++;
    else await page.waitForTimeout(100);
  }
  const lit = await fills();
  test.info().annotations.push({ type: 'screen taps', description: `${lit} arcs lit in ${taps} taps` });
  expect(lit, 'screen taps on peeking Chromlins light rainbow arcs').toBeGreaterThanOrEqual(3);
  expect(problems, 'no page errors').toEqual([]);
});

test('mobile AR: a tap the runtime cannot pose still places the board on the reticle', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = await bootPhone(page);

  await aimAtSpot(page);
  expect(await reticleUp(page), 'hit-test reticle shown on the table').toBe(true);

  await tap(page, CAM, SPOT, true);
  await page.waitForTimeout(300);
  const b = await boardPos(page);
  expect(offSpot(b), `board at ${JSON.stringify(b)} ≈ reticle`).toBeLessThan(0.01);
  expect(problems, 'no page errors').toEqual([]);
});
