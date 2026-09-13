# Credits

Chromlins is built on [gamma](https://github.com/fdoganis/gamma), a WebXR
engine by the same author, MIT licensed. If you want to build your own AR
game rather than fork this one, start there instead.

## Third-party code & assets

These keep their own original license regardless of this repo's own terms
(see `LICENSE`).

- **Font rendering technique** (`src/text/glyphs/CanvasGlyphs.ts`), rasterizes
  the browser's own monospace font to a canvas and reads the lit pixels, no
  glyph data shipped. Technique from Rachel Smith's CodePen, MIT.
  https://codepen.io/rachsmith/pen/LpZbmZ

- **SoundBox / CPlayer** (`src/audio/engines/soundbox/player-small.js`), the
  audio synthesis engine every sound cue renders through. zlib License,
  Copyright (c) 2011-2013 Marcus Geelnard. http://sb.bitsnbites.eu/

- **"redline"**, the background music, and the four SoundBox instrument
  presets it lends the short SFX cues, is the author's own composition.
