import { test, expect } from './fixtures';

// Non-visual smoke: the app boots clean and actually renders + animates.
// No pixel baseline, no injected globals — reads console/pageerror + the canvas.
test('boots, renders, and animates', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });

  // ?run skips Intro/Placing and drops the board in front of the camera, so the
  // running state renders on plain desktop without WebXR.
  await page.goto('/?run');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();

  const box = await canvas.boundingBox();
  expect(box, 'canvas has a layout box').not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // Two captures ~2s apart must differ — something (an actor) is moving.
  const a = await canvas.screenshot();
  await page.waitForTimeout(2000);
  const b = await canvas.screenshot();
  expect(Buffer.compare(a, b), 'canvas changed over 2s').not.toBe(0);

  expect(problems, 'no page errors').toEqual([]);
});

// Space is the keyboard fallback for "select": in the running state it collects a
// random actor. Spamming it long enough collects all 7 colors → WinState (a
// valid, static end screen), so this only checks the path stays healthy under
// heavy repeats (a real "was collected / did win" assertion needs IWER — see GNOMES.md).
test('repeated Space collects stay healthy through a win', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  await page.goto('/?run');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(2500); // let a few actors rise

  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1000);

  expect(problems, 'no page errors from Space collects / the win transition').toEqual([]);
  await expect(page.locator('canvas')).toBeVisible();
});
