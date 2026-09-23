import { chromium } from '@playwright/test';

// tests/hand-occlusion.spec.ts is the only spec that imports anything from
// three/examples/jsm/* (XRHandModelFactory, via a dynamic import() behind the
// __DEV__-only ?handdebug flag). Vite's dev-server dependency optimizer never
// sees that subpath during its startup crawl, so it only discovers it the
// moment that dynamic import actually fires — right as another spec's page
// load (audio-loudness.spec.ts) is separately forcing Vite to pre-bundle
// 'three' for the first time. That collision makes Vite re-run its optimizer
// mid-session, which aborts the in-flight fetch for handOcclusionDebug.ts
// ("Failed to fetch dynamically imported module") and never recovers for the
// rest of that dev-server process's life (window.__handDebug never gets set,
// so hand-occlusion.spec.ts times out — confirmed this doesn't just need a
// longer timeout, it genuinely never resolves).
//
// Doing one throwaway visit to the ?handdebug page here, before the real
// suite starts, lets Vite fully discover and pre-bundle that subpath (and
// 'three' itself) up front, so no test's page load ever races a live
// re-optimize again.
export default async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/?run&handdebug');
  await page.waitForFunction(() => '__handDebug' in window, undefined, { timeout: 30_000 });
  await browser.close();
}
