// The complete 95-glyph LittleJS engine font (ASCII 0x20..0x7E), 8x8, 760 bytes.
// Source: https://github.com/KilledByAPixel/LittleJS engineFont.png — MIT,
// Copyright (c) 2021 Frank Force. Only shipped when GLYPH_SOURCE === 'full';
// otherwise this whole module tree-shakes out.
import type { BitmapFont } from './BitmapGlyphs';

const FIRST = 0x20;
const PACKED =
  'AAAAAAAAAAAweHgwMAAwAGxsbAAAAAAAbGz+bP5sbAAQftD+FvwQAADGzBgwZsYAOGw4dtzMdgA4MGAAAAAAABgwYGBgMBgAYDAYGBgwYAAAbDj+OGwAAAAwMPwwMAAAAAAAAAAwMDAAAAD8AAAAAAAAAAAAMDAABgwYMGDAgAB8xs7+5sZ8ADBwMDAwMPwAfMYGPGDG/gB8xgYcBsZ8ABw8bMz+DB4A/sDA/AbGfAA8YMD8xsZ8AP7GBgwYMDAAfMbGfMbGfAB8xsZ+Bgx4AAAwMAAAMDAAADAwAAAwMGAMGDBgMBgMAAAA/AAA/AAAYDAYDBgwYAB4zAwYMAAwAHzG3t7ewHwAfMbG/sbGxgD8xsb8xsb8AHzGwMDAxnwA+MzGxsbM+AD+wMD8wMD+AP7AwPzAwMAAfMbAzsbGfADGxsb+xsbGAHgwMDAwMHgAHAwMDMzMeADGxsz4zMbGAMDAwMDAwP4Axu7+1sbGxgDG5vbezsbGAHzGxsbGxnwA/MbG/MDAwAB8xsbGxs58DvzGxvzMxsYAfMbAfAbGfAD8MDAwMDAwAMbGxsbGxnwAxsbGxmw4EADGxsbW/u7GAMZsOBA4bMYAzMx4MDAwMAD+DBgwYMD+AHhgYGBgYHgAwGAwGAwGAAB4GBgYGBh4ABA4bMYAAAAAAAAAAAAA/wBwMBgAAAAAAAAAfAZ+xn4AwMD8xsbG/AAAAHzGwMZ8AAYGfsbGxn4AAAB8xv7AfAA8YGD4YGBgAAAAfsbGfgZ8wMD8xsbGxgAwAHAwMDB4ABgAOBgYGBhwwMDGzPjMxgBwMDAwMDAcAAAAbP7WxsYAAAD4zMzMzAAAAHzGxsZ8AAAA/MbG/MDAAAB+xsZ+BgcAAPzGwMDAAAAAfsB8BvwAYGD4YGBgPAAAAMbGxsZ+AAAAxsZsOBAAAADGxtb+bAAAAMZsOGzGAAAAxsbGfgZ8AAD8GDBg/AAcMDBgMDAcADAwMAAwMDAAcBgYDBgYcABw1hwAAAAAAA==';

function unpack(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const FULL_FONT: BitmapFont = {
  w: 8,
  h: 8,
  data: /*#__PURE__*/ unpack(PACKED),
  indexOf: (ch) => {
    const i = ch.charCodeAt(0) - FIRST;
    return i >= 0 && i < 95 ? i : -1;
  },
};
