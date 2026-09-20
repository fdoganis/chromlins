import { defineConfig, devices } from '@playwright/test';

// One chromium project, one smoke spec. Playwright boots `npm run dev` itself.
// Nothing here is bundled — @playwright/test is a devDependency only.
export default defineConfig({
  testDir: './tests',
  // tests/unit/ is plain node:test (see npm run test:unit), not a Playwright
  // spec — it has no @playwright/test import and would fail if collected here.
  testIgnore: ['**/unit/**'],
  // The two IWER specs each drive a full WebXR-emulated render loop + a long
  // screenshot sweep. Run in parallel they oversubscribe the CPU and starve
  // each other into timeouts, so the 4-test suite runs serially — deterministic
  // beats fast here, and CI (2-core + retries) effectively serializes anyway.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
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
