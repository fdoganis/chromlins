// Generates a Closure externs file protecting every property/method/enum
// name declared by this project's EXTERNAL API surface: the TypeScript
// standard-library files this project's tsconfig actually turns on
// (compilerOptions.lib, e.g. `dom`), plus the type declarations for every
// real npm dependency and every ambient @types/* package. None of these
// names are safe for Closure to rename: the DOM/WebXR/WebAudio side is read
// by the BROWSER's own native code, and the three.js side is read by
// three's own published, CDN-loaded JS, which Closure never sees and can't
// rename in lockstep.
//
//   node scripts/gen-external-api-names.mjs > build/external-api.externs.js
//
// Fully generic: it does not hardcode 'three' or 'webxr' anywhere. It reads
// package.json for the actual dependency list and asks TypeScript's own
// compiler, via this project's real tsconfig.json, which files back each
// name, so adding, removing, or upgrading a dependency's types changes what
// gets protected automatically, no edit to this file required.
//
// Two dependency shapes are both handled by "walk every .d.ts the package
// resolves to": a package with its own `types`/`typings` field ships them
// alongside its code (node_modules/<dep>); a package without one is typed
// by a separate `@types/<dep>` (the DefinitelyTyped convention; three.js is
// this case, see .doc/DECISIONS.md D18 for the check that confirmed three
// ships no `.d.ts` of its own). A third shape, `@types/<name>` with no
// matching real dependency, is an AMBIENT package: it doesn't type an
// installed library, it augments the browser's own global types (this
// project's only example is @types/webxr — Closure's bundled browser
// externs predate the WebXR Device API, so without it
// `navigator.xr.isSessionSupported`/`requestSession` get renamed and the XR
// session silently never starts).
//
// What this script does NOT cover, on purpose: names from OUR OWN code that
// also need protecting under PACK_EXTERNS=three, for an unrelated reason
// (nothing external reads them; they're reached only through a computed
// string Closure can't connect back to the declaration) — that's
// scripts/gen-record-keys.mjs. See .doc/DECISIONS.md D18 for the full
// pipeline write-up: which stage (Rolldown/oxc, Babel's private-field
// strip, Closure, the post-Closure terser pass, roadroller, Zopfli) touches
// identifiers/properties/quoting, and where each kind of information gets
// lost or transformed.
import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
const deps = Object.keys(pkg.dependencies ?? {});
const typesDevDeps = Object.keys(pkg.devDependencies ?? {}).filter((d) => d.startsWith('@types/'));

// One resolved directory per external type source. A dependency with
// neither a matching @types/ package nor its own types field is skipped
// with a warning, not an error: a JS-only dependency with no type info at
// all could never be dot-accessed from this project's strict TS source
// without a compile error, so in practice this only fires on a genuine
// setup gap, worth flagging rather than silently under-protecting.
const roots = [];
for (const dep of deps) {
  const typesPkg = resolve(cwd, 'node_modules/@types', dep);
  if (existsSync(typesPkg)) { roots.push(typesPkg); continue; }
  const ownPkgJson = resolve(cwd, 'node_modules', dep, 'package.json');
  if (existsSync(ownPkgJson)) {
    const ownPkg = JSON.parse(readFileSync(ownPkgJson, 'utf8'));
    if (ownPkg.types || ownPkg.typings) { roots.push(resolve(cwd, 'node_modules', dep)); continue; }
  }
  console.error(`gen-external-api-names: no type declarations found for dependency "${dep}" (checked @types/${dep} and its own package.json "types"/"typings") — skipping`);
}
for (const typesDep of typesDevDeps) {
  const name = typesDep.slice('@types/'.length);
  if (deps.includes(name)) continue; // already covered above, via the real dependency
  roots.push(resolve(cwd, 'node_modules', typesDep)); // ambient: types a global, not a package
}

const cfgPath = ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json');
const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, cwd);
const program = ts.createProgram(parsed.fileNames, parsed.options);

// A source file is "external API surface" if it's one of the standard
// library files this tsconfig's compilerOptions.lib turned on — TypeScript's
// own call, via isSourceFileDefaultLibrary, not a hardcoded 'lib.dom.d.ts'
// path, so a future `lib` change (e.g. adding `webworker`) is picked up with
// no edit here — or it lives under one of the dependency roots resolved
// above.
const isExternal = (sf) => program.isSourceFileDefaultLibrary(sf) || roots.some((r) => sf.fileName.startsWith(r));

const names = new Set();
for (const sf of program.getSourceFiles()) {
  if (!isExternal(sf)) continue;
  const visit = (node) => {
    if (
      ts.isPropertySignature(node) || ts.isMethodSignature(node) ||
      ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
      ts.isEnumMember(node)
    ) {
      if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

const sorted = [...names].filter((n) => /^[A-Za-z_$][\w$]*$/.test(n)).sort();
process.stderr.write(`gen-external-api-names: ${roots.length} dependency type root(s) + TypeScript's own lib files -> ${sorted.length} protected names\n`);
process.stdout.write('/** @externs */\nvar $ext;\n' + sorted.map((n) => `$ext.${n};`).join('\n') + '\n');
