import { test, expect } from './fixtures';

// ?l13 drops straight into the hidden level-13 run (dev-only, folds out of prod).
// Spamming Space collects random actors through the short 35s round; this checks
// the L13 config path — tighter cadence, reps 3, snatchAll unicorn, 35s timer —
// stays healthy and renders. snatchAll itself only fires on a random unicorn tap,
// so it's covered by not crashing here + the whack/xr specs' unicorn path.
test('level 13: hidden hard mode runs clean', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  await page.goto('/?l13');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(600);

  const a = await canvas.screenshot();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Space'); // not locator('body').press — the full-screen canvas fails its hit-test
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1000);
  const b = await canvas.screenshot();

  expect(Buffer.compare(a, b), 'scene advanced through the L13 round').not.toBe(0);
  expect(problems, 'no page errors through the L13 round').toEqual([]);
});
