import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { renderCue } from './lib/render-cue.mjs';

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

  // Logged immediately, not just collected for the final assert: a failure
  // partway through (e.g. the enter()-visibility checks below) throws before
  // that assert ever runs, and a silent runtime bug is exactly what these
  // checks exist to catch, so seeing the real console output at the point of
  // failure matters more than at the end of an already-failed test.
  const problems: string[] = [];
  page.on('pageerror', (e) => { const s = `pageerror: ${e}`; problems.push(s); console.log(s); });
  page.on('console', (m) => { if (m.type() === 'error') { const s = `console.error: ${m.text()}`; problems.push(s); console.log(s); } });

  // 1. install IWER before the app boots, and tap the real Web Audio API so
  // actual audio playback is observable from outside the packed bundle: it
  // has no debug hook of its own, and headless Chromium's audio output isn't
  // otherwise inspectable. Wrapping AudioContext.prototype.createBufferSource
  // before the app's own script runs means every SoundBox-rendered buffer
  // that actually starts playing gets logged, real duration and loop flag
  // included, which is precise enough to tell a real BGM start (long,
  // looping) from an SFX blip (short, one-shot) apart, and would have caught
  // the CUES silent-miss bug directly: a missing/renamed cue makes
  // #bufferFor throw now (see AudioManager.ts), which pageerror below
  // catches, but before that fix existed it just played nothing, which this
  // log would have shown as "audio.playBGM('music') ran, __audio stayed
  // empty" instead of requiring a live device report to notice.
  await page.addInitScript(() => {
    // @ts-expect-error test hook
    window.__audio = [];
    const Ctx = window.AudioContext;
    const origCreate = Ctx.prototype.createBufferSource;
    Ctx.prototype.createBufferSource = function (...args) {
      const src = origCreate.apply(this, args);
      const origStart = src.start.bind(src);
      src.start = (...startArgs) => {
        // @ts-expect-error test hook
        window.__audio.push({ t: performance.now(), duration: src.buffer?.duration ?? null, loop: src.loop });
        return origStart(...startArgs);
      };
      return src;
    };
  });
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
  await page.waitForTimeout(600); // #placeOnFloor → Intro

  // 4. drop to the standard viewing pose (board already placed; anchor won't move)
  await page.evaluate(async () => {
    // @ts-expect-error
    const d = window.__xr;
    await d.remote.dispatch('look_at', { device: 'headset', position: { x: 0, y: 0.55, z: 0.35 }, target: { x: 0, y: 0.12, z: -0.6 } });
  });
  await page.waitForTimeout(600);

  // 4b. Dismiss the "START" prompt and confirm RunState actually starts, not
  // just that the round eventually "worked" (the hole-sweep below would pass
  // even if this transition silently failed, see the finding below). Checked
  // by screenshot diff rather than a DOM/JS hook, since the only thing that
  // exists to check is what actually rendered.
  //
  // This check exists because of a real bug, found on a real device, that an
  // earlier, weaker version of this test did not catch: under
  // PACK_EXTERNS=three, Closure's property renaming can rewrite some of
  // Game.ts's `screens` record keys (e.g. `intro`->`Pc`, `win`->`Nc`) while
  // leaving the STRING LITERALS passed to `change('intro')` elsewhere
  // untouched. `cur` still updates (that's a plain variable assignment, nothing
  // to rename), so `screens[cur]` then looks up a key that no longer exists,
  // and `screens[cur]?.enter?.()` / `?.select?.()` / `?.update?.()` all
  // silently no-op, forever, with no error, exactly like a real device that
  // places the board and then does nothing at all, no actors, no music, no
  // error. Confirmed non-deterministic (which specific keys break varies
  // build to build), so this needs to be an always-on check, not a one-time
  // fix: see scripts/gen-record-keys.mjs for the full write-up and the
  // actual fix (protecting the screen names themselves,
  // not just Screen's method names, which turned out NOT to be the issue
  // despite being the first, plausible-but-wrong theory).
  const preDismiss = await page.screenshot();
  await page.evaluate(async ({ aim }) => {
    // @ts-expect-error
    const d = window.__xr;
    await d.remote.dispatch('set_transform', { device: 'controller-right', position: { x: 0, y: 0.4, z: -0.6 }, orientation: aim });
    await d.remote.dispatch('set_select_value', { device: 'controller-right', value: 1 });
    await new Promise((r) => setTimeout(r, 25));
    await d.remote.dispatch('set_select_value', { device: 'controller-right', value: 0 });
  }, { aim: AIM_DOWN });
  await page.waitForTimeout(600);
  const postDismiss = await page.screenshot();
  expect(Buffer.compare(preDismiss, postDismiss), `RunState never visibly started — see the comment above and scripts/gen-record-keys.mjs. Console: ${problems.join('; ') || '(none)'}`).not.toBe(0);

  // 4c. RunState.enter() calls audio.playBGM('music') as its last line, and
  // that's the one real side effect nothing else in this test can see: no
  // pixel changes, and headless Chromium doesn't play sound anywhere a
  // screenshot could catch. The tap installed in step 1 is the only way to
  // observe it. Real redline plays for tens of seconds and loops; every SFX
  // cue's rowLen caps it well under 5s (see AudioManager.ts's SFX_ROWLEN and
  // the per-cue rowLen overrides), so >5s + loop:true is specific to BGM,
  // not just "any sound played".
  const audioLog = await page.evaluate(() => (window as unknown as { __audio: { duration: number | null; loop: boolean }[] }).__audio);
  const bgm = audioLog.find((a) => a.loop && (a.duration ?? 0) > 5);
  expect(bgm, `BGM never started (audio log: ${JSON.stringify(audioLog)}). Console: ${problems.join('; ') || '(none)'}`).toBeTruthy();

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

  // 5b. World.ts plays 'spawn' every time an actor rises and 'hit' every time
  // a ray-select connects, both through playAt (PositionalAudio), unlike
  // 'win'/'over'/'tick' which go through the non-positional playSFX — a real,
  // reported difference ("hit/spawn/unicorn don't seem to make any sound")
  // this checks directly rather than assumes: with 8 rounds sweeping all 8
  // holes just completed (the rainbow band changed, proving hits landed),
  // both cues are guaranteed to have fired at least once. tests/unit/
  // cues.test.mjs already proves neither cue's DATA renders silent; this
  // proves the live PositionalAudio playback path actually reaches the
  // listener in the real packed build, which that unit test cannot. Matched
  // by exact duration (computed from the same CPlayer render, not a copied
  // number) rather than just "any two sounds played", since it's not just
  // "was there sound" that's in question — see .doc/DECISIONS.md D19.
  // 'unicorn'/'win'/'over'/'tick' aren't checked here: unicorn is a ~12%
  // per-tick roll (not guaranteed within one scripted round) and win/over/
  // tick depend on the round's outcome/timing, neither reachable
  // deterministically from this test's fixed script without flaking.
  const finalAudioLog = await page.evaluate(() => (window as unknown as { __audio: { duration: number | null; loop: boolean }[] }).__audio);
  for (const id of ['spawn', 'hit']) {
    const expected = await renderCue(id);
    const heard = finalAudioLog.some((a) => Math.abs((a.duration ?? -1) - expected.duration) < 0.001);
    expect(heard, `cue "${id}" (expected duration ${expected.duration.toFixed(3)}s) never heard live (audio log: ${JSON.stringify(finalAudioLog)})`).toBe(true);
  }

  expect(problems, 'no page errors from the packed build').toEqual([]);
});
