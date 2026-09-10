import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Standalone build of the unicorn groom studio (tests/tools/groom.html), for
// GitHub Pages alongside the game — one self-contained file at dist/groom.html,
// served at /gamma/groom.html. It imports src/, which uses the `__DEV__` define:
// forced true here, the editor needs the DEV-only Unicorn.rebuildGeo() to
// rebuild geometry on every knob change. three / lil-gui / OrbitControls are
// bundled and inlined (a design tool, not a budgeted artifact).
//
//   npm run build:groom   ->  dist/groom.html   (adds to dist/, doesn't wipe it)
//   npm run build:pages   ->  game + editor, both under dist/
export default defineConfig({
  root: 'tests/tools',
  base: './',
  define: { __DEV__: 'true' },
  resolve: { alias: { 'three/addons': 'three/examples/jsm' } },
  plugins: [glsl(), viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: resolve(process.cwd(), 'dist'),
    emptyOutDir: false, // keep the game's dist/index.html
    rollupOptions: { input: resolve(process.cwd(), 'tests/tools/groom.html') },
  },
});
