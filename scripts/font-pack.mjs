// scripts/font-pack.mjs <name>   name = square6 | round6 | thick8 | minogram | monogram
//
// Extracts ONLY the 39 glyphs the game ever draws — space + - 0-9 A-Z — from a
// font atlas, thresholds each to 1 bit per pixel, packs h bytes per glyph (one
// byte per row, MSB = leftmost column), base64s it, and writes
// src/text/glyphs/<name>-font.ts in the same shape as the hand-made light-font.ts.
// No deps: PNG inflate + unfilter is inline.
//
// Two source formats:
//   bmfont — assets/fonts/<stem>/<stem>.png (8-bit RGBA) + .xml  (square/round/thick/minogram)
//   bfm    — assets/fonts/monogram/bitmap/monogram-bitmap.json   (BitFontMaker2: {char: [rowInts]})
//
// The source assets are never shipped — only the ~250-620 B base64 string, and
// only for the font GLYPH_SOURCE selects (the rest tree-shake).
//
//   node scripts/font-pack.mjs square6      (or: npm run fonts — regenerates all)
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const FONT = {
  square6: { fmt: 'bmfont', stem: 'square_6x6' },
  round6: { fmt: 'bmfont', stem: 'round_6x6' },
  thick8: { fmt: 'bmfont', stem: 'thick_8x8' },
  minogram: { fmt: 'bmfont', stem: 'minogram_6x10' },
  monogram: { fmt: 'bfm', json: 'monogram/bitmap/monogram-bitmap.json' },
};
const name = process.argv[2];
const cfg = FONT[name];
if (!cfg) { console.error(`usage: node scripts/font-pack.mjs <${Object.keys(FONT).join(' | ')}>`); process.exit(1); }

// glyph slot order — must match every *-font.ts indexOf: space, '+', '-', 0-9, A-Z
const CHARS = [' ', '+', '-', ...'0123456789', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

// --- minimal PNG decode: 8-bit RGBA, non-interlaced -> flat RGBA buffer ---
function decodePNG(buf) {
  let p = 8, w = 0, h = 0;
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
      const a = i >= bpp ? px[y * stride + i - bpp] : 0;
      const b = y ? px[(y - 1) * stride + i] : 0;
      const c = y && i >= bpp ? px[(y - 1) * stride + i - bpp] : 0;
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

// --- BMFont: crop each <char> rect from the atlas, threshold ---
function packBMFont(stem) {
  const dir = `assets/fonts/${stem}`;
  const xml = readFileSync(`${dir}/${stem}.xml`, 'utf8');
  const { w: aw, px } = decodePNG(readFileSync(`${dir}/${stem}.png`));

  const rect = new Map();
  for (const m of xml.matchAll(/<char id="(\d+)"\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"/g))
    rect.set(+m[1], { x: +m[2], y: +m[3], w: +m[4], h: +m[5] });

  const GW = Math.max(...CHARS.map((c) => rect.get(c.charCodeAt(0))?.w ?? 0));
  const GH = Math.max(...CHARS.map((c) => rect.get(c.charCodeAt(0))?.h ?? 0));

  // shape is in the alpha channel (RGB uniformly white); fall back to luma if a
  // future atlas is fully opaque.
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
    lit = (gx, gy) => { const i = (gy * aw + gx) * 4; return Math.abs((px[i] + px[i + 1] + px[i + 2]) / 3 - bg) > 64; };
  }

  const bytes = [], missing = [];
  for (const ch of CHARS) {
    const c = rect.get(ch.charCodeAt(0));
    if (!c) { missing.push(ch); for (let r = 0; r < GH; r++) bytes.push(0); continue; }
    for (let r = 0; r < GH; r++) {
      let byte = 0;
      for (let x = 0; x < GW; x++)
        if (r < c.h && x < c.w && lit(c.x + x, c.y + r)) byte |= 1 << (GW - 1 - x);
      bytes.push(byte);
    }
  }
  return { GW, GH, bytes, missing };
}

// --- BitFontMaker2 JSON: {char: [rowInt...]}, bit 0 = leftmost column ---
function packBFM(jsonPath) {
  const j = JSON.parse(readFileSync(`assets/fonts/${jsonPath}`, 'utf8'));
  const GH = j.A.length;
  let GW = 1;
  for (const ch of CHARS) for (const r of (j[ch] ?? [])) GW = Math.max(GW, 32 - Math.clz32(r || 0));

  const bytes = [], missing = [];
  for (const ch of CHARS) {
    const rows = j[ch];
    if (!rows) { missing.push(ch); for (let r = 0; r < GH; r++) bytes.push(0); continue; }
    for (let r = 0; r < GH; r++) {
      let byte = 0;
      const src = rows[r] || 0;
      for (let x = 0; x < GW; x++) if ((src >> x) & 1) byte |= 1 << (GW - 1 - x); // LSB=left -> MSB=left
      bytes.push(byte);
    }
  }
  return { GW, GH, bytes, missing };
}

const { GW, GH, bytes, missing } = cfg.fmt === 'bfm' ? packBFM(cfg.json) : packBMFont(cfg.stem);
if (GW > 8) { console.error(`glyph width ${GW} > 8 — one byte per row can't hold it`); process.exit(1); }
if (missing.length) console.warn(`  missing (blank): ${missing.map((c) => JSON.stringify(c)).join(' ')}`);

const b64 = Buffer.from(bytes).toString('base64');
const src = cfg.fmt === 'bfm' ? cfg.json : `${cfg.stem}/{png,xml}`;
const OUT = `src/text/glyphs/${name}-font.ts`;
writeFileSync(OUT, `// Generated by scripts/font-pack.mjs from assets/fonts/${src}.
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
