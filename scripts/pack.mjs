// Fork-time packing pass for the smallest possible bundle. Run this on a game
// fork right before submission — it never touches src/, only dist/index.html
// from a normal `npm run build`. Source keeps its real `#private` fields; only
// the packed artifact loses them.
//
// Shared pipeline: a tiny Babel AST pass strips the `#` sigil from the
// ALREADY-MINIFIED build output (roadroller can't parse ES2022 private fields,
// and down-levelling the whole build to es2017 costs more than roadroller saves
// — see .doc/DECISIONS.md D3). Then the one `import{…}from"three"` is pulled out,
// the code is minified, three is re-added as a dynamic `await import("three")`
// inside an async IIFE (still resolves through the importmap, works in a classic
// <script>), and roadroller packs the lot.
//
//   npm run build && node scripts/pack.mjs && node scripts/zip.mjs
//
// Env:
//   PACK_O        roadroller search level 0|1|2 (default 1). 1 ≈ 3s; 2 is a much
//                 longer search for ~25 B — use it for the release artifact.
//   PACK_MINIFY   'terser' (default) or 'closure'. terser: compress+mangle, no
//                 extra dependency. closure: Google Closure Compiler ADVANCED
//                 structure-only (inline / DCE / devirtualise, every property
//                 protected from renaming — renaming fights roadroller), then a
//                 light terser pass for the `/^_/` former-privates. ~-460 B on
//                 the final zip vs terser (.doc/DECISIONS.md D9); needs the
//                 google-closure-compiler devDep's platform binary. Use it, with
//                 PACK_O=2, for the submission.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { transformSync } from '@babel/core';
import { minify } from 'terser';
import { Packer } from 'roadroller';

const FILE = 'dist/index.html';
const LEVEL = Number(process.env.PACK_O ?? 1);
const MODE = process.env.PACK_MINIFY ?? 'terser';

// Strip every `#private` to a plain `_name$N` property. Each class gets its own
// id so classes in an inheritance chain never end up sharing a renamed field.
function stripPrivateFields({ types: t }) {
  let nextId = 0;
  const idOf = new WeakMap();
  const classIdFor = (cls) => { if (!idOf.has(cls)) idOf.set(cls, nextId++); return idOf.get(cls); };
  const enclosingClass = (path) => path.findParent((p) => p.isClassDeclaration() || p.isClassExpression())?.node ?? null;
  return {
    visitor: {
      PrivateName(path) {
        const cls = enclosingClass(path);
        const suffix = cls ? `$${classIdFor(cls)}` : '';
        path.replaceWith(t.identifier(`_${path.node.id.name}${suffix}`));
      },
      ClassPrivateProperty(path) { path.node.type = 'ClassProperty'; },
      ClassPrivateMethod(path) { path.node.type = 'ClassMethod'; },
    },
  };
}

// PACK_MINIFY=closure: a deterministic "protect everything from renaming" list —
// a Babel AST walk of every non-computed property / object key / method name.
// (An AST walk can't miss a `.prop` a regex would, and the app is TS-strict so
// there's no `obj[dynamicName]` on anything that matters.)
function collectProtectedNames(code) {
  const names = new Set(['prototype', 'constructor']);
  transformSync(code, {
    babelrc: false, configFile: false, sourceType: 'module',
    plugins: [{
      visitor: {
        'MemberExpression|OptionalMemberExpression'(p) {
          const n = p.node;
          if (!n.computed && n.property.type === 'Identifier') names.add(n.property.name);
        },
        'ObjectProperty|ObjectMethod|ClassMethod|ClassProperty|ClassPrivateProperty|ClassPrivateMethod'(p) {
          const n = p.node;
          if (!n.computed && n.key && n.key.type === 'Identifier') names.add(n.key.name);
        },
      },
    }],
  });
  return names;
}

async function closureMinify(src, aliases) {
  const plat = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
  const bin = `node_modules/google-closure-compiler-${plat}/compiler${plat === 'windows' ? '.exe' : ''}`;

  const names = collectProtectedNames(src);
  const externs = '/** @externs */\n' +
    aliases.map((a) => `var ${a};`).join('\n') + '\n' +
    'var $p;\n' + [...names].map((n) => `$p.${n};`).join('\n') + '\n';
  writeFileSync('/tmp/cc-src.js', src);
  writeFileSync('/tmp/cc-externs.js', externs);

  const cc = spawnSync(bin, [
    '--compilation_level=ADVANCED', '--language_in=ECMASCRIPT_NEXT', '--language_out=ECMASCRIPT_2021',
    '--warning_level=VERBOSE',
    // Two narrow, reviewed suppressions (NOT a blanket `*`): checkTypes is pure
    // noise on already-minified, annotation-free input; undefinedVars fires on
    // browser globals (localStorage, performance, atob…) Closure's externs don't
    // declare as bare vars — off, it treats them as externs, which is the intent.
    '--jscomp_off=checkTypes', '--jscomp_off=undefinedVars',
    '--dependency_mode=NONE', '--process_common_js_modules=false', '--assume_function_wrapper',
    '--externs=/tmp/cc-externs.js', '--js=/tmp/cc-src.js',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  if (cc.status !== 0) {
    const why = cc.error?.code === 'ENOENT'
      ? `closure binary not found (${bin}) — run \`npm i -D google-closure-compiler\`, or use PACK_MINIFY=terser`
      : (cc.stderr || cc.error?.message || '').slice(0, 8000);
    throw new Error('pack: closure failed:\n' + why);
  }

  const warns = (cc.stderr || '').trim().split('\n').filter(Boolean);
  const buckets = new Map();
  for (const l of warns) { const m = l.match(/\[(JSC_[A-Z0-9_]+)\]/); if (m) buckets.set(m[1], (buckets.get(m[1]) ?? 0) + 1); }
  writeFileSync('dist/closure-warnings.log', warns.join('\n') + '\n');
  const total = [...buckets.values()].reduce((a, b) => a + b, 0);
  console.error(`closure: ${src.length} B -> ${cc.stdout.length} B  ·  protects ${names.size} names  ·  ${total} warning(s)`);
  for (const [c, n] of [...buckets].sort((a, b) => b[1] - a[1])) console.error(`  ${String(n).padStart(4)}  ${c}`);
  if (total) console.error('  full text: dist/closure-warnings.log');

  // Only the `/^_/` former-private mangle — Closure protect-all leaves those
  // long; no compress pass (Closure already did the structural work, ~0 here).
  return (await minify(cc.stdout, {
    module: true, compress: false,
    mangle: { toplevel: true, properties: { regex: /^_/ } },
    format: { comments: false },
  })).code;
}

const html = readFileSync(FILE, 'utf8');
const tag = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/);
if (!tag) throw new Error('pack: no <script type="module"> in dist/index.html — run `npm run build` first');

const stripped = transformSync(tag[1], {
  compact: true, babelrc: false, configFile: false, sourceType: 'module',
  plugins: [stripPrivateFields],
}).code;

const THREE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*"three";?/;
const wrap = (bindings, body) => `(async()=>{const{${bindings}}=await import("three");\n${body.trim()}\n})()`;

let source;
if (MODE === 'closure') {
  // Closure rejects the bare "three" specifier — pull the import out first, hand
  // the alias locals in as externs, re-add it as a dynamic import after.
  const imp = stripped.match(THREE_IMPORT);
  if (!imp) throw new Error('pack: expected a single `import{...}from"three"` — bundle shape changed');
  const bindings = imp[1].replace(/ as /g, ':'); // `A as e` -> `A:e`
  const aliases = [...bindings.matchAll(/:([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  source = wrap(bindings, await closureMinify(stripped.replace(imp[0], ''), aliases));
} else {
  // terser keeps the import through its pass (proven byte-for-byte), then it's
  // extracted and re-added as a dynamic import.
  const minified = (await minify(stripped, {
    module: true,
    compress: { passes: 3 },
    mangle: { toplevel: true, properties: { regex: /^_/ } }, // rolldown won't rename object props; every former #private is _name$N and nothing else is _-prefixed
    format: { comments: false },
  })).code;
  const imp = minified.match(THREE_IMPORT);
  if (!imp) throw new Error('pack: expected a single `import{...}from"three"` — bundle shape changed');
  source = wrap(imp[1].replace(/ as /g, ':'), minified.replace(imp[0], ''));
}

const packer = new Packer([{ data: source, type: 'js', action: 'eval' }], {});
await packer.optimize(LEVEL);
const { firstLine, secondLine } = packer.makeDecoder();
const packed = `${firstLine}\n${secondLine}`;

writeFileSync(FILE, html.replace(tag[0], `<script>${packed}</script>`));

const pct = (100 * (1 - packed.length / tag[1].length)).toFixed(1);
console.log(`pack: ${MODE} · script ${tag[1].length} B -> ${packed.length} B  (-${pct}%, roadroller -O${LEVEL})`);
