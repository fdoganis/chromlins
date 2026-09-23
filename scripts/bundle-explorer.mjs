// Browsable treemap of the built (minified, tree-shaken) bundle, by original
// source file — answers "what's IN the bundle", a real but DIFFERENT
// question from "what does this cost in the final shipped zip" (see the
// warning this script prints, and .doc-equivalent notes in the chat this
// came from). vite-plugin-singlefile inlines the built script straight into
// dist/index.html with no standalone .js file, so this extracts it first.
//
//   npm run build && node scripts/bundle-explorer.mjs
//
// Needs `sourcemap: true` in vite.config.js's build options at least for
// this run (this project's own default is `!isProd`, i.e. off in
// production) — rebuild with `VITE_FORCE_SOURCEMAP=1 npm run build` if
// vite.config.js is wired to read that, or temporarily flip the config.
//
// --no-border-checks is required, not optional, for this project's build: a
// heavily minified single-line bundle's last sourcemap segment has no next
// segment to bound it, which source-map-explorer's default (stricter)
// validation rejects as "column Infinity" even though the map itself is
// valid (confirmed directly: loading it with the `source-map` package and
// walking every mapping found zero invalid entries). This is a known
// single-line-bundle edge case in the tool, not a defect in this project's
// output.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const HTML = 'dist/index.html';
if (!existsSync(HTML)) throw new Error(`${HTML} not found — run \`npm run build\` first`);

const html = readFileSync(HTML, 'utf8');
const tag = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/);
if (!tag) throw new Error('no <script type="module"> found — did the build produce something else?');

const mapMatch = tag[1].match(/\/\/# sourceMappingURL=(\S+)/);
if (!mapMatch) {
  console.error('No sourcemap comment found in the built script.');
  console.error('This project builds with `sourcemap: !isProd` (vite.config.js) — off for `npm run build`.');
  console.error('Re-run with sourcemaps enabled for this one build, e.g. temporarily set `sourcemap: true`.');
  process.exit(1);
}

const mapFile = `dist/${mapMatch[1]}`;
writeFileSync('/tmp/bundle-explorer.js', tag[1].trim() + '\n');
copyFileSync(mapFile, '/tmp/bundle-explorer.js.map');

const out = 'bundle-explorer-report.html';
execFileSync('npx', ['source-map-explorer', '/tmp/bundle-explorer.js', '/tmp/bundle-explorer.js.map', '--no-border-checks', '--html', out], { stdio: 'inherit' });

console.log(`\nWritten: ${out}`);
console.log('This is the MINIFIED, TREE-SHAKEN bundle BEFORE scripts/pack.mjs (Babel/Closure/roadroller) ever touches it.');
console.log('It does NOT predict the final shipped zip size — roadroller compresses by repetition, not by file boundary.');
console.log('Confirmed this session: the 3rd-biggest file here (Unicorn.ts) was also the single biggest REAL packed-byte win,');
console.log('while removing one of several similar lines elsewhere barely moved the final zip at all. Use this to find');
console.log('candidates, then always measure the real thing with `npm run pack` + `npm run zip` before deciding anything.');
