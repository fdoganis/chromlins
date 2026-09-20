// Generates a Closure externs file for everything three.js exposes, so the
// packer can stop blanket-protecting OUR property names.
//
//   node scripts/gen-three-externs.mjs > build/three.externs.js
//
// Why: pack.mjs protects every property name it finds in our source from
// Closure renaming, because renaming fights roadroller. Protection also blocks
// removal, which is why dead members like the old dispose() chain had to be
// deleted by hand (see gamma .doc/DECISIONS.md D19/D20). The way out is to tell
// Closure precisely which names are external, three.js's API, reachable from
// the CDN copy it never sees, plus the WebXR/WebAudio dictionary keys the
// browser reads, and let it rename and dead-code-eliminate the rest freely.
//
// Correctness rule: a name missing from here that three.js actually reads gets
// renamed in our call sites and silently stops working at runtime. So this errs
// heavily toward over-collecting: every member name declared anywhere in
// @types/three, not just the ones we currently use.
import ts from 'typescript';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findRecordKeys } from './gen-record-keys.mjs';

// @types/webxr is not optional: Closure's bundled browser externs predate the
// WebXR Device API, so without it `navigator.xr.isSessionSupported(...)` and
// `requestSession(...)` get renamed and the session silently never starts.
// Found the hard way, the packed artifact rendered fine and failed only at
// session start, which smoke tests don't reach.
const ROOTS = ['node_modules/@types/three', 'node_modules/@types/webxr'];

// WebXR / WebAudio / misc dictionary keys that are read by the browser or by
// three, never by bundled code, so Closure has no way to infer they matter.
// Closure's own browser externs lag the WebXR spec, hence the explicit list.
const BROWSER_KEYS = [
  'requiredFeatures', 'optionalFeatures', 'domOverlay', 'depthSensing',
  'usagePreference', 'dataFormatPreference', 'space', 'offsetRay', 'entityTypes',
  'antialias', 'alpha', 'stencil', 'depth', 'premultipliedAlpha', 'preserveDrawingBuffer',
  'powerPreference', 'failIfMajorPerformanceCaveat', 'xrCompatible', 'desynchronized',
  'willReadFrequently', 'latencyHint', 'sampleRate', 'numberOfChannels', 'length',
  'once', 'passive', 'capture', 'root',
];

// Our OWN names that need protecting too, found the hard way (a real device
// test: placement worked, then nothing, no error, no actors; then, once that
// was fixed, no music either). Two DIFFERENT risks, both real:
//
// 1. Dictionary KEYS. `Game.ts`'s `screens` and `AudioManager.ts`'s `CUES`
//    are `Record<string, X>` object literals looked up by a dynamic string
//    (`screens[cur]`, `CUES[id]`). Closure's property renaming rewrote some
//    of the object literal's own keys (`intro`->`Pc`, `music`->`Nc`, in the
//    builds actually inspected) while leaving the STRING LITERALS used to
//    look them up elsewhere untouched (`ctx.change('intro')`,
//    `audio.playBGM('music')`), so the lookup silently missed, forever, no
//    error. Confirmed non-deterministic: which keys survive varies build to
//    build, so one clean test run doesn't mean the pattern is safe.
//
//    Quoting the keys at their definition (`'intro': ...`) is Closure's own,
//    documented signal for "exempt from renaming", and was verified to work
//    in isolation: an unquoted `{music:...}` piped straight into Closure got
//    renamed, the same object quoted did not. It does NOT survive in this
//    project's actual pipeline, though: `npm run build`'s Rolldown/oxc
//    bundling step runs BEFORE Closure and silently normalizes a
//    quoted-but-identifier-safe key back to unquoted first (confirmed with
//    `compress: false` AND `mangle: false` both set, so it isn't a
//    minification choice; `tsc` alone, without Rolldown, preserves the
//    quotes fine, so it's specifically Rolldown's transform/codegen; no
//    config flag for this was found in Vite's exposed options or Oxc's own
//    docs as of this writing). So this has to be solved with externs, not
//    source style. `findRecordKeys()` (gen-record-keys.mjs) finds every
//    `Record<string, X> = {...}` in src/ via the TypeScript AST and returns
//    all their keys automatically, this is not a hand-maintained list.
//
// 2. Screen's own METHOD names (`enter`/`exit`/`select`/`update`), called
//    through `screens[cur]?.enter?.()` on a set of otherwise-disjoint object
//    literals with no shared class, the same class of risk as (1) but for
//    method names rather than dictionary keys, gen-record-keys.mjs doesn't
//    cover this shape. On inspection this did NOT actually cause either real
//    failure so far (`select`/`update` survive by accident via three.js's
//    own API using those names; `enter`/`exit` were literal and consistent
//    in the builds that broke for reason (1) instead). Kept explicit here as
//    cheap insurance rather than relying on that overlap, ~9 B for four names.
const OWN_DISPATCH_KEYS = ['enter', 'exit', 'select', 'update', ...findRecordKeys().flatMap((r) => r.keys)];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.d.ts')) files.push(p);
  }
};
for (const r of ROOTS) walk(r);

const names = new Set([...BROWSER_KEYS, ...OWN_DISPATCH_KEYS]);
for (const file of files) {
  const sf = ts.createSourceFile(file, ts.sys.readFile(file) ?? '', ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    const n = node;
    if (
      ts.isPropertySignature(n) || ts.isMethodSignature(n) ||
      ts.isPropertyDeclaration(n) || ts.isMethodDeclaration(n) ||
      ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) ||
      ts.isEnumMember(n)
    ) {
      if (n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) names.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
}

const sorted = [...names].filter((n) => /^[A-Za-z_$][\w$]*$/.test(n)).sort();
process.stderr.write(`gen-three-externs: ${files.length} .d.ts files -> ${sorted.length} protected names\n`);
process.stdout.write('/** @externs */\nvar $three;\n' + sorted.map((n) => `$three.${n};`).join('\n') + '\n');
