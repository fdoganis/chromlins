import { defineConfig, devices } from '@playwright/test';

// One chromium project, one smoke spec. Playwright boots `npm run dev` itself.
// Nothing here is bundled — @playwright/test and monocart-reporter are
// devDependencies only.
export default defineConfig({
  testDir: './tests',
  // tests/unit/ is plain node:test (see npm run test:unit), not a Playwright
  // spec — it has no @playwright/test import and would fail if collected here.
  testIgnore: ['**/unit/**'],
  globalSetup: './tests/global-warmup.ts',
  // The two IWER specs each drive a full WebXR-emulated render loop + a long
  // screenshot sweep. Run in parallel they oversubscribe the CPU and starve
  // each other into timeouts, so the 4-test suite runs serially — deterministic
  // beats fast here, and CI (2-core + retries) effectively serializes anyway.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Every spec imports test/expect from tests/fixtures.ts, not
  // '@playwright/test' directly — that file's automatic per-test fixture is
  // what actually collects the coverage this reporter turns into a report;
  // the reporter alone does nothing without it. Browsable, per-test-attributed
  // line coverage, merged across the whole suite, in monocart-report/index.html
  // — replaces the old one-off scripts/coverage.mjs (a single hand-driven
  // flow, no per-test breakdown, no clickable lines).
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['monocart-reporter', {
      name: 'chromlins e2e coverage',
      outputFile: './monocart-report/index.html',
      coverage: {
        // monocart resolves each Vite-served .ts module's OWN inline sourcemap
        // and calls this with `sourcemap.sources[0]`, which Vite's dev server
        // sets to the bare filename ("Game.ts"), never a path. A path-shaped
        // filter (e.g. matching "/src/") silently matches nothing and drops
        // every real file, confirmed by logging what actually arrives here.
        // The only non-game entries seen this way are vite's own client/env
        // shims and pre-bundled three.js; excluding those by name is the only
        // real signal available, since there's no directory to filter on.
        sourceFilter: (sourcePath: string) =>
          sourcePath !== 'client' &&
          !sourcePath.endsWith('.mjs') &&
          !sourcePath.startsWith('three'),
      },
    }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1000, height: 760 } }
    }
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});
