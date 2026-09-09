// scripts/font-pack.mjs <name>     name = square6 | round6 | thick8 | minogram
//
// Takes a BMFont pair (assets/fonts/<stem>/<stem>.png + .xml), extracts ONLY the 39
// glyphs the game ever draws — space + - 0-9 A-Z — thresholds each to 1 bit per
// pixel, packs H bytes per glyph (one byte per row, MSB-justified), base64s the
// lot, and writes src/text/glyphs/<name>-font.ts. Same shape as the hand-made
// light-font.ts. No deps: PNG inflate + unfilter is inline (all four atlases are
// 8-bit RGBA, non-interlaced).
//
// The source PNG/XML are never shipped — only the ~250-500 B base64 string is,
// and only for the font GLYPH_SOURCE selects (the rest tree-shake).
//
//   node scripts/font-pack.mjs square6   (or: npm run fonts  — regenerates all)
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const STEM = { square6: 'square_6x6', round6: 'round_6x6', thick8: 'thick_8x8', minogram: 'minogram_6x10' };
const name = process.argv[2];
const stem = STEM[name];
if (!stem) { console.error(`usage: node scripts/font-pack.mjs <${Object.keys(STEM).join(' | ')}>`); process.exit(1); }

// --- minimal PNG decode: 8-bit RGBA, non-interlaced -> flat RGBA buffer ---
function decodePNG(buf) {
  let p = 8; // PNG signature
  let w = 0, h = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('expected 8-bit RGBA non-interlaced PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[y * stride + i - bpp] : 0;              // left
      const b = y ? px[(y - 1) * stride + i] : 0;                     // up
      const c = y && i >= bpp ? px[(y - 1) * stride + i - bpp] : 0;   // up-left
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

const dir = `assets/fonts/${stem}`;
const xml = readFileSync(`${dir}/${stem}.xml`, 'utf8');
const { w: aw, px } = decodePNG(readFileSync(`${dir}/${stem}.png`));

// BMFont <char> rects. Attribute order is fixed in these files; the leading
// space keeps ` x="` from matching ` xadvance="`.
const rect = new Map();
for (const m of xml.matchAll(/<char id="(\d+)"\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"/g))
  rect.set(+m[1], { x: +m[2], y: +m[3], w: +m[4], h: +m[5] });

// slot order must match every *-font.ts indexOf: space, '+', '-', 0-9, A-Z
const CODES = [32, 43, 45,
  ...Array.from({ length: 10 }, (_, i) => 48 + i),
  ...Array.from({ length: 26 }, (_, i) => 65 + i)];

const GW = Math.max(...CODES.map((c) => rect.get(c)?.w ?? 0));
const GH = Math.max(...CODES.map((c) => rect.get(c)?.h ?? 0));
if (GW > 8) { console.error(`glyph width ${GW} > 8 — one byte per row can't hold it`); process.exit(1); }

// These atlases carry the glyph in the alpha channel (RGB is uniformly white).
// If a future atlas is fully opaque instead, fall back to luma vs. the most
// common (background) luma.
let alphaVaries = false;
for (let i = 3; i < px.length; i += 4) if (px[i] <= 127) { alphaVaries = true; break; }
let lit;
if (alphaVaries) {
  lit = (gx, gy) => px[(gy * aw + gx) * 4 + 3] > 127;
} else {
  const hist = new Map();
  for (let i = 0; i < px.length; i += 4) {
    const l = ((px[i] + px[i + 1] + px[i + 2]) / 3) | 0;
    hist.set(l, (hist.get(l) ?? 0) + 1);
  }
  const bg = [...hist].sort((a, b) => b[1] - a[1])[0][0];
  lit = (gx, gy) => {
    const i = (gy * aw + gx) * 4;
    return Math.abs((px[i] + px[i + 1] + px[i + 2]) / 3 - bg) > 64;
  };
}

const bytes = [];
const missing = [];
for (const code of CODES) {
  const c = rect.get(code);
  if (!c) { missing.push(code); for (let r = 0; r < GH; r++) bytes.push(0); continue; }
  for (let r = 0; r < GH; r++) {
    let byte = 0;
    for (let x = 0; x < GW; x++)
      if (r < c.h && x < c.w && lit(c.x + x, c.y + r)) byte |= 1 << (GW - 1 - x);
    bytes.push(byte);
  }
}
if (missing.length) console.warn(`  missing (blank): ${missing.map((c) => JSON.stringify(String.fromCharCode(c))).join(' ')}`);

const b64 = Buffer.from(bytes).toString('base64');
const OUT = `src/text/glyphs/${name}-font.ts`;
writeFileSync(OUT, `// Generated by scripts/font-pack.mjs from assets/fonts/${stem}.{png,xml}.
// The 39 glyphs the game draws — space + - 0-9 A-Z — at ${GW}x${GH}, ${bytes.length} bytes.
// Selected with GLYPH_SOURCE === '${name}'.
import type { BitmapFont } from './BitmapGlyphs';

const PACKED = '${b64}';

function unpack(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const ${name.toUpperCase()}_FONT: BitmapFont = {
  w: ${GW},
  h: ${GH},
  data: /*#__PURE__*/ unpack(PACKED),
  indexOf: (ch) => {
    const c = ch.charCodeAt(0);
    if (c === 0x20) return 0;
    if (c === 0x2b) return 1; // +
    if (c === 0x2d) return 2; // -
    if (c >= 0x30 && c <= 0x39) return 3 + (c - 0x30);  // 0-9  -> 3..12
    if (c >= 0x41 && c <= 0x5a) return 13 + (c - 0x41); // A-Z  -> 13..38
    return -1;
  },
};
`);
console.log(`${OUT}  ${GW}x${GH}  ${bytes.length} B raw  ${b64.length} B base64`);
