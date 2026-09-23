import { test, expect } from './fixtures';
import { inflateSync } from 'node:zlib';

// Regression guard for the "mane buried in the pit" bug: the unicorn only PEEKS
// from a hole in-game, so a mane tuned as a long drape (looks great floating in
// the groom studio) can be ~90% hidden below the rim. `?uni` forces the unicorn
// peeking at hole 0; this asserts vivid rainbow mane pixels are visible above
// the rim — catches a mane that's too long, not built, or over-occluded.

// decode an 8-bit RGBA non-interlaced PNG (what Playwright screenshots are)
function decodePNG(buf: Buffer): { w: number; h: number; px: Buffer } {
  let p = 8, w = 0, h = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? px[y * stride + i - 4] : 0;
      const b = y ? px[(y - 1) * stride + i] : 0;
      const c = y && i >= 4 ? px[(y - 1) * stride + i - 4] : 0;
      let v = row[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + i] = v & 255;
    }
  }
  return { w, h, px };
}

// the mane materials are pure RAINBOW with toneMapped:false -> bright + very
// saturated. The cream body, pink muzzle/cheeks and (unlit) rainbow arc are all
// desaturated or dim, so this counts mane pixels only.
function vividPixels(px: Buffer): number {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx > 200 && mx - mn > 150) n++;
  }
  return n;
}

test('the unicorn mane stays visible above the hole rim when it peeks', async ({ page }) => {
  test.setTimeout(30_000);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  await page.goto('/?uni');
  await page.waitForTimeout(1800); // microtask spawn + rise (~0.25 s) + settle

  const shot = await page.screenshot(); // whole frame; only the mane is vivid+bright
  const { px } = decodePNG(shot);
  const vivid = vividPixels(px);

  expect(vivid, `vivid rainbow mane pixels above the rim (got ${vivid})`).toBeGreaterThan(400);
  expect(problems, 'no page errors').toEqual([]);
});
