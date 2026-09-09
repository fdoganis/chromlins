// Fork knobs. Each value is a literal const — rolldown folds `=== 'x'` at build
// time and tree-shakes the branches that aren't picked, so a game built on this
// engine edits this one file and gets a minimal bundle with no code deletion.
// (Complements the `__DEV__` vite define, which is build-mode-tied.)

// Text rendering engine:
//   'voxel'   — bitmap-font glyphs as instanced voxel cubes (the default)
//   'segment' — 16-segment retro-LED alphanumeric display; no glyph data, so a
//               'segment' fork tree-shakes VoxelTextEngine + all of glyphs/
export const TEXT_ENGINE: 'voxel' | 'segment' = 'voxel';

// Glyph source for VoxelTextEngine. The bitmap fonts all ship only the 39
// glyphs the game draws (space + - 0-9 A-Z); scripts/font-pack.mjs regenerates
// them from assets/fonts/*.{png,xml} (`npm run fonts`).
//   'light'    — 8x8, sliced from the LittleJS engine font, smallest (default)
//   'full'     — the whole 95-glyph LittleJS font
//   'square6'  — 6x6 blocky
//   'round6'   — 6x6 rounded
//   'thick8'   — 8x8 heavy
//   'minogram' — 6x10, a taller display face (+~80 B)
//   'canvas'   — rasterise the browser's monospace font, no glyph data shipped
export const GLYPH_SOURCE: 'full' | 'light' | 'square6' | 'round6' | 'thick8' | 'minogram' | 'canvas' = 'light';

// Voxel text shading:
//   'phong'  — MeshPhongMaterial lit by the scene (picks up the sky tint)
//   'matcap' — a tiny canvas-drawn matcap, baked once; screen-consistent,
//              ignores scene lights
//   'env'    — MeshStandardMaterial (metallic) + a tiny hand-drawn env map;
//              each voxel a chrome chip that glints as the head moves. Best
//              paired with VOXEL_SHAPE 'octa'.
export const VOXEL_SHADING: 'phong' | 'matcap' | 'env' = 'phong';

// Voxel primitive:
//   'box'        — BoxGeometry, the classic square "pixel" (default aesthetic)
//   'octa'       — OctahedronGeometry: varied normals, so matcap/env show real
//                  per-voxel form (a shaded gem)
//   'sphere'     — SphereGeometry: every voxel self-shades from any angle, like
//                  a dot-matrix / LED display — most legible, least blocky
//   'roundedbox' — RoundedBoxGeometry: blocky silhouette + gappy scanline look,
//                  but the rounded edges catch a raking key for per-voxel contour
export const VOXEL_SHAPE: 'box' | 'octa' | 'sphere' | 'roundedbox' = 'box';

// Build tier — the umbrella for optional content:
//   'light'  — the js13k entry. IntroState hands straight to RunState once the
//              board is placed; the wordless opening cinematic (Cinematic.ts +
//              Timeline) tree-shakes out entirely. The default.
//   'deluxe' — the "director's cut": the opening cinematic plays (rainbow draws
//              in, a unicorn bobs at the crown, seven spirits rise and steal the
//              colours, the unicorn drops into the last hole — ?intro on desktop),
//              plus room for other extras (a future mane salon, …).
export const BUILD: 'light' | 'deluxe' = 'light';

// Unicorn mane simulation:
//   'spring' — 14 short tube strands (7 back off the crown + 7 front forelock
//              above the eyes), each on a cheap damped angular spring kicked by
//              the body's rise/sink. Smaller, the default.
//   'chain'  — 7 follow-the-leader chains of tapered cone segments (gravity +
//              inertia rope). Nicer secondary motion, more code; a fork opts in.
export const MANE_SIM: 'spring' | 'chain' = 'spring';
