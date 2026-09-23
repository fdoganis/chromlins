// Real JS coverage while driving the app, per source file — this is what
// actually caught (and could re-catch) something like the whole dispose()
// chain: a method with plenty of *call sites* in source (so
// find-uncalled-methods.mjs can't see it) but that never actually executes
// when the app runs, because nothing upstream is reachable. Coverage can't
// prove a line is *permanently* unreachable — only that this run's driven
// flow never hit it. Uses Chromium's own V8 coverage (Playwright's
// `page.coverage` API), against the Vite DEV server: each src/ file is its
// own unbundled request there, so coverage comes back already split by file,
// no sourcemap needed.
//
//   node scripts/coverage.mjs
//
// Drives: an IWER-emulated hand whack (tests/whack.spec.ts's own flow, to
// exercise HandSource/XRSelectSource/AnchorState's placement path) and a
// plain visit to ?name (NameEntryState) and ?run&uni (RunState + Unicorn).
// Not exhaustive — a real device session, win/game-over, and every audio cue
// aren't driven here; treat this as a starting point, not a full report.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const PORT = 5183; // a port of its own, so this can run alongside `npm run dev`
const BASE = `http://localhost:${PORT}`;

function waitForServer(url, timeoutMs = 20_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try { const r = await fetch(url); if (r.ok || r.status === 404) return resolve(); } catch { /* not up yet */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('dev server did not start in time'));
      setTimeout(tick, 300);
    };
    tick();
  });
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

async function driveWhack(page) {
  await page.addInitScript({ path: path.resolve('node_modules/iwer/build/iwer.min.js') });
  await page.addInitScript(() => {
    // @ts-expect-error injected UMD global
    const d = new window.IWER.XRDevice(window.IWER.metaQuest3);
    d.installRuntime({ forceInstall: true });
    // @ts-expect-error test handle
    window.__xr = d;
  });
  await page.goto(`${BASE}/?run`);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /start xr/i }).click();
  await page.waitForFunction(async () => {
    // @ts-expect-error
    return (await window.__xr.remote.dispatch('get_session_status', {})).sessionActive;
  }, undefined, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);

  await page.evaluate(async () => {
    // @ts-expect-error
    const d = window.__xr;
    await d.remote.dispatch('look_at', { device: 'headset', position: { x: 0, y: 0.55, z: 0.35 }, target: { x: 0, y: 0.12, z: -0.6 } });
    await d.remote.dispatch('set_input_mode', { mode: 'hand' });
    await d.remote.dispatch('set_connected', { device: 'hand-right', connected: true });
  });
  await page.waitForTimeout(400);

  const holes = [[-0.28, -0.6], [-0.15, -0.6], [-0.41, -0.6], [-0.28, -0.47], [-0.28, -0.73]];
  for (const [x, z] of holes) {
    await page.evaluate(async ({ x, z, up }) => {
      // @ts-expect-error
      const d = window.__xr;
      await d.remote.dispatch('set_transform', { device: 'hand-right', position: { x, y: 0.35, z }, orientation: up });
      await new Promise((r) => setTimeout(r, 40));
      await d.remote.dispatch('animate_to', { device: 'hand-right', position: { x, y: 0.0, z }, duration: 0.12 });
    }, { x, z, up: IDENTITY });
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(600);
}

async function driveDevRoutes(page) {
  for (const route of ['?run&uni', '?name', '?l13']) {
    await page.goto(`${BASE}/${route}`);
    await page.waitForTimeout(1200);
  }
}

async function main() {
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  try {
    await waitForServer(BASE);
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.coverage.startJSCoverage({ resetOnNavigation: false });

    await driveWhack(page);
    await driveDevRoutes(page);

    const entries = await page.coverage.stopJSCoverage();
    await browser.close();

    // V8's per-function ranges NEST — the whole module is itself one range
    // spanning the entire file with count>0 (the module obviously ran),
    // wrapping every other function's own, more specific range inside it.
    // A naive "mark covered if ANY overlapping range has count>0" lets that
    // one whole-file range win everywhere, hiding every real 0 underneath
    // it (confirmed directly: dispose() showed count:0 in its own range,
    // but appeared "covered" once the outer range was applied on top).
    // Fix: process ranges smallest-first, and let a byte's SMALLEST (most
    // specific/most nested) range decide it — the same precedence c8/
    // istanbul use for V8's own nested coverage ranges.
    function usedBytes(functions, total) {
      const decided = new Uint8Array(total);
      const covered = new Uint8Array(total);
      const ranges = functions.flatMap((f) => f.ranges).sort((a, b) => (a.endOffset - a.startOffset) - (b.endOffset - b.startOffset));
      for (const r of ranges) {
        for (let i = r.startOffset; i < r.endOffset; i++) {
          if (decided[i]) continue;
          decided[i] = 1;
          covered[i] = r.count > 0 ? 1 : 0;
        }
      }
      let used = 0;
      for (let i = 0; i < total; i++) used += covered[i];
      return used;
    }

    const rows = entries
      .filter((e) => e.url.includes('/src/'))
      .map((e) => {
        const total = e.source?.length ?? 0;
        const used = usedBytes(e.functions, total);
        const path = new URL(e.url).pathname.replace(/^\//, '');
        return { path, total, used, unused: total - used, pct: total ? (100 * used / total) : 0 };
      })
      .sort((a, b) => b.unused - a.unused);

    console.log('file'.padEnd(50), 'total', 'used', 'unused', '%used');
    for (const r of rows) {
      console.log(r.path.padEnd(50), String(r.total).padStart(6), String(r.used).padStart(6), String(r.unused).padStart(6), `${r.pct.toFixed(0)}%`);
    }
    const total = rows.reduce((s, r) => s + r.total, 0);
    const used = rows.reduce((s, r) => s + r.used, 0);
    console.log(`\n${rows.length} files, ${used}/${total} B used (${(100 * used / total).toFixed(1)}%) across this driven flow.`);
    console.log('0% files are the strongest dead-code candidates; partial % just means this flow didn\'t reach every branch — verify by hand, this is not proof of permanent unreachability.');
  } finally {
    server.kill();
  }
}

main();
