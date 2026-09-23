// Shared `test`/`expect` for every spec: an automatic per-test fixture starts
// V8 JS+CSS coverage before each test and feeds it into monocart-reporter's
// global coverage report on teardown (playwright.config.ts's `coverage`
// option). Every spec.ts imports test/expect from here instead of
// '@playwright/test' directly, so this applies project-wide with no change
// to any test body. Replaces the old one-off scripts/coverage.mjs (a single
// hand-driven flow, no browsable report, no per-test attribution) — every
// real e2e run now produces a real report, for free, with no extra step.
//
//   npx playwright test               # writes monocart-report/index.html
//
// Coverage is Chromium-only (page.coverage is a CDP API); this project only
// runs the one 'chromium' project, so isChromium is always true here, but
// the check is kept in case a second project is ever added.
import { test as base, expect } from '@playwright/test';
import { addCoverageReport } from 'monocart-reporter';

export const test = base.extend({
  autoCoverage: [async ({ page }, use) => {
    const isChromium = test.info().project.name === 'chromium';
    if (isChromium) {
      await Promise.all([
        page.coverage.startJSCoverage({ resetOnNavigation: false }),
        page.coverage.startCSSCoverage({ resetOnNavigation: false }),
      ]);
    }

    await use('autoCoverage');

    if (isChromium) {
      const [jsCoverage, cssCoverage] = await Promise.all([
        page.coverage.stopJSCoverage(),
        page.coverage.stopCSSCoverage(),
      ]);
      await addCoverageReport([...jsCoverage, ...cssCoverage], test.info());
    }
  }, { scope: 'test', auto: true }],
});

export { expect };
