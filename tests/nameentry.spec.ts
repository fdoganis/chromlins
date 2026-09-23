import { test, expect } from './fixtures';

// ?name jumps straight into NameEntryState (dev-only, folds out of prod). Space
// is the keyboard "select": NameEntryState routes it to the first cycling slot,
// else OK. Four presses = lock A, lock B, lock C (raises OK), whack OK -> burst
// every cylinder, submit, brief beat, -> Intro. This checks the whole
// lock/lock/lock/confirm path stays healthy and renders; a real "the letters
// read / the colours stepped" assertion wants a device or IWER.
test('name entry: whack three letters + OK, no errors, stays alive', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  await page.goto('/?name');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(600); // let the first slot rise

  const rising = await canvas.screenshot();

  await page.keyboard.press('Space'); // lock A -> B rises (not locator('body').press — canvas fails its hit-test)
  await page.waitForTimeout(400);
  const afterFirstLock = await canvas.screenshot();
  expect(Buffer.compare(rising, afterFirstLock), 'locking a slot changed the scene').not.toBe(0);

  for (let i = 0; i < 3; i++) { // lock B, lock C (raises OK), whack OK
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(2500); // through the explosion + exit beat -> Intro

  const settled = await canvas.screenshot();
  expect(Buffer.compare(afterFirstLock, settled), 'the burst + transition changed the scene').not.toBe(0);

  expect(problems, 'no page errors through lock/lock/lock/OK/burst/transition').toEqual([]);
});
