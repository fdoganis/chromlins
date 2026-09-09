// A packed bitmap font as an IGlyphSource. Deterministic across every
// browser/OS (no canvas, no font availability question). Every *-font.ts is
// the same class with different data + index map + cell size.
import type { IGlyphSource, Glyphs } from './IGlyphSource';

export type BitmapFont = {
  w: number;                        // glyph cell width  (bits used per row byte, <= 8)
  h: number;                        // glyph cell height (bytes per glyph)
  data: Uint8Array;                 // h bytes per glyph, one bit = one lit cell (MSB = left)
  indexOf: (ch: string) => number; // glyph slot for a character, or -1
};

export class BitmapGlyphs implements IGlyphSource {
  #font: BitmapFont;
  constructor(font: BitmapFont) { this.#font = font; }

  layout(text: string): Glyphs {
    const { w, h, data } = this.#font;
    const advance = w + 1; // one blank column between glyphs
    const cells: Array<[number, number]> = [];
    let col = 0;
    let lineTop = 0;   // y of the current line's top row
    let maxCol = 0;
    for (const ch of text) {
      if (ch === '\n') { lineTop += h + 1; col = 0; continue; } // blank row between lines
      const gi = this.#font.indexOf(ch);
      if (gi < 0) continue; // unknown glyph: skip it entirely, like the original
      const base = gi * h;
      for (let y = 0; y < h; y++) {
        const row = data[base + y];
        for (let x = 0; x < w; x++) {
          if ((row >> (w - 1 - x)) & 1) cells.push([col + x, lineTop + y]);
        }
      }
      col += advance;
      if (col > maxCol) maxCol = col;
    }
    return { cells, width: Math.max(0, maxCol - 1), height: lineTop + h };
  }
}
