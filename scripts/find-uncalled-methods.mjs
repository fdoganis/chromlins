// Heuristic dead-method finder: this is exactly the manual check that found
// the whole dispose() chain, automated. For every `methodName(` definition
// in src/, checks whether `.methodName(` appears ANYWHERE else in src/ or
// tests/. Zero other occurrences -> flagged as a candidate.
//
//   node scripts/find-uncalled-methods.mjs
//
// This is TEXT matching, not type-aware — real, stated limitations, not a
// guarantee either way:
//   - FALSE POSITIVES: a method required only to satisfy an interface
//     (e.g. ITextEngine's members) can be "uncalled" by this check and still
//     be load-bearing for type-checking or a future implementation.
//   - FALSE NEGATIVES: two unrelated classes with a same-named method (e.g.
//     two different `update(delta)`s) look identical to this scan — if
//     EITHER is called anywhere, BOTH read as "called", even if one
//     specific class's version never actually runs. Small, cohesive files
//     make this less likely to hide something; a big shared vocabulary
//     (`update`, `dispose`, `reset`) makes it more likely.
// `npm run deadcode` (scripts/deadcode.mjs) has neither problem — it uses
// the TypeScript checker already in devDependencies for `tsc`, no new
// dependency — but costs a full program build to run. This script stays for
// a zero-setup, instant first pass.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['src', 'tests'];
// Excludes get/set: a getter/setter is accessed as `obj.name`, never
// `obj.name(...)` — this tool only searches for call-site parentheses, so
// every getter/setter would otherwise show up as a false "uncalled"
// candidate (confirmed: an earlier version of this script flagged 10
// getters and zero real methods on this exact codebase). Detecting real
// property-access call sites reliably needs type information this plain
// text scan doesn't have — a job for `knip`/`ts-morph`, not this script.
const DEF = /^\s*(?:override\s+|static\s+|async\s+)*([A-Za-z_$#][\w$]*)\s*\([^;{]*\)\s*(?::\s*[^{;]+)?\s*\{/;
const GETSET = /^\s*(?:override\s+|static\s+)*(?:get|set)\s+[A-Za-z_$#]/;
const SKIP_NAMES = new Set(['constructor', 'if', 'for', 'while', 'switch', 'catch', 'function']);

function collectFiles(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectFiles(p, out);
    else if (/\.(ts|mjs|js)$/.test(name)) out.push(p);
  }
}

const files = [];
for (const root of ROOTS) collectFiles(root, files);

const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
const allText = [...sources.values()].join('\n');

const defs = []; // { name, file, line }
for (const [file, text] of sources) {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (GETSET.test(line)) return;
    const m = line.match(DEF);
    if (!m) return;
    const name = m[1].replace(/^#/, '');
    if (SKIP_NAMES.has(name)) return;
    defs.push({ name, file, line: i + 1 });
  });
}

// Group by name: a method is a candidate only if NO ".name(" call site
// exists anywhere, and it isn't itself called as a bare function (rare here,
// but a free function like disposeUnicornAssets() matters too).
const byName = new Map();
for (const d of defs) {
  if (!byName.has(d.name)) byName.set(d.name, []);
  byName.get(d.name).push(d);
}

const callRe = (name) => new RegExp(`[.#]${name}\\s*\\(|\\b${name}\\s*\\(`, 'g');
const candidates = [];
for (const [name, sites] of byName) {
  const calls = (allText.match(callRe(name)) ?? []).length;
  // Every definition line itself matches `name(`, so subtract those.
  if (calls <= sites.length) candidates.push({ name, sites });
}

candidates.sort((a, b) => a.name.localeCompare(b.name));
if (!candidates.length) {
  console.log('No candidates found.');
} else {
  console.log(`${candidates.length} candidate(s) — methods/functions with no call site found anywhere in src/ or tests/:\n`);
  for (const c of candidates) {
    for (const s of c.sites) console.log(`  ${c.name}()  ${relative('.', s.file)}:${s.line}`);
  }
  console.log('\nVerify each by hand before deleting — see the limitations in this script\'s own header comment.');
}
