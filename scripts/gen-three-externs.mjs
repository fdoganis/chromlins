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

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.d.ts')) files.push(p);
  }
};
for (const r of ROOTS) walk(r);

const names = new Set(BROWSER_KEYS);
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
