// The 38 glyphs the game actually draws — `space + - 0-9 A-Z` — sliced from the
// full LittleJS font (see full-font.ts). 312 bytes vs 760. This is the default
// (GLYPH_SOURCE === 'light').
import type { BitmapFont } from './BitmapGlyphs';

// slot order: space, '+', '-', '0'..'9', 'A'..'Z'
const PACKED =
  'AAAAAAAAAAAAMDD8MDAAAAAAAPwAAAAAfMbO/ubGfAAwcDAwMDD8AHzGBjxgxv4AfMYGHAbGfAAcPGzM/gweAP7AwPwGxnwAPGDA/MbGfAD+xgYMGDAwAHzGxnzGxnwAfMbGfgYMeAB8xsb+xsbGAPzGxvzGxvwAfMbAwMDGfAD4zMbGxsz4AP7AwPzAwP4A/sDA/MDAwAB8xsDOxsZ8AMbGxv7GxsYAeDAwMDAweAAcDAwMzMx4AMbGzPjMxsYAwMDAwMDA/gDG7v7WxsbGAMbm9t7OxsYAfMbGxsbGfAD8xsb8wMDAAHzGxsbGznwO/MbG/MzGxgB8xsB8BsZ8APwwMDAwMDAAxsbGxsbGfADGxsbGbDgQAMbGxtb+7sYAxmw4EDhsxgDMzHgwMDAwAP4MGDBgwP4A';

function unpack(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const LIGHT_FONT: BitmapFont = {
  w: 8,
  h: 8,
  data: /*#__PURE__*/ unpack(PACKED),
  indexOf: (ch) => {
    const c = ch.charCodeAt(0);
    if (c === 0x20) return 0;
    if (c === 0x2b) return 1; // +
    if (c === 0x2d) return 2; // -
    if (c >= 0x30 && c <= 0x39) return 3 + (c - 0x30);  // 0-9  → 3..12
    if (c >= 0x41 && c <= 0x5a) return 13 + (c - 0x41); // A-Z  → 13..38
    return -1;
  },
};
