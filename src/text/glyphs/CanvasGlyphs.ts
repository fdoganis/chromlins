// Rasterises the browser's own monospace font to a canvas and reads the lit
// pixels — no glyph data shipped at all. The trade-off is determinism: the same
// string renders slightly differently per OS. Selected with GLYPH_SOURCE ===
// 'canvas' (technique from Rachel Smith's confetti text, MIT).
import type { IGlyphSource, Glyphs } from './IGlyphSource';

export class CanvasGlyphs implements IGlyphSource {
  #px: number;
  #cv = document.createElement('canvas');
  #ctx = this.#cv.getContext('2d')!;

  constructor(px = 10) { this.#px = px; }

  layout(text: string): Glyphs {
    const font = `${this.#px}px monospace`;
    this.#ctx.font = font;
    const w = Math.max(1, Math.ceil(this.#ctx.measureText(text).width));
    const h = this.#px + 2;

    this.#cv.width = w;
    this.#cv.height = h;          // resizing clears the canvas and resets the ctx
    this.#ctx.font = font;
    this.#ctx.textBaseline = 'top';
    this.#ctx.fillStyle = '#fff';
    this.#ctx.fillText(text, 0, 0);

    const px = this.#ctx.getImageData(0, 0, w, h).data;
    const cells: Array<[number, number]> = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (px[(y * w + x) * 4 + 3] > 127) cells.push([x, y]);

    return { cells, width: w, height: h };
  }
}
