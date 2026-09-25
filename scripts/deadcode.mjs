// Reports class members in src/ that nothing reachable ever calls.
//
//   npm run deadcode
//
// Why this exists rather than trusting the compiler: Closure ADVANCED *would*
// drop unreachable members on its own, but scripts/pack.mjs deliberately hands
// it an externs file protecting every property name from renaming, because
// renaming fights roadroller (a measured -370 B in favour of protecting). A
// protected name is one Closure must assume an outside caller might use, so it
// keeps it. We traded automatic dead-member elimination for compression; this
// script pays part of that back by finding the candidates to delete by hand.
//
// Why it uses the TypeScript type checker and not a regex or an AST name scan:
// name matching cannot tell OUR dead `Game.dispose()` from three.js's very
// much alive `geometry.dispose()`. Both are "dispose". Every name-based
// approach (including the tempting one of just unprotecting unread names in
// pack.mjs's externs, which are matched by name with no notion of which class
// owns them) reports the whole dispose chain as live and misses the single
// biggest win available. The checker resolves each call to the actual declared
// symbol, so the two never get confused.
//
// It also does a reachability fixpoint, not just "is it referenced once":
// World.dispose() *was* referenced, but only by Game.dispose(), which nothing
// called. Both are dead. The loop below keeps removing until it settles, so a
// dead root drags its whole subtree out with it.
//
// Caveats before deleting anything it lists:
//   - Methods reached only through a dynamic/indexed dispatch can look dead.
//   - "bytes" is raw source length, NOT packed size. Packed savings run far
//     smaller and non-linearly. Always confirm with `npm run pack`.
import ts from 'typescript';
import { relative } from 'node:path';

const cwd = process.cwd();
const cfgPath = ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json');
if (!cfgPath) { console.error('deadcode: no tsconfig.json found'); process.exit(1); }
const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, cwd);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

const inSrc = (sf) => !sf.isDeclarationFile && !sf.fileName.includes('node_modules') && sf.fileName.includes(`${cwd}/src/`);

// --- 1. collect candidate declarations (class methods + accessors) ----------
// Keyed by DECLARATION NODE, not by symbol: getSymbolAtLocation returns
// different symbol objects at a declaration and at a reference to it, so
// symbol identity silently matches nothing. Declaration nodes are stable.
const decls = new Map(); // declaration node -> info
for (const sf of program.getSourceFiles()) {
  if (!inSrc(sf)) continue;
  const visit = (node) => {
    if ((ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.name) {
      // Only real class members. An object-literal method (our Screen state
      // objects) is reached through indexed dispatch like screens[cur].select(),
      // which the checker can't resolve to the concrete literal, so including
      // them would report every state handler as dead.
      const inClass = node.parent && (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent));
      // Skip overrides/implementations: a call on the base or interface type
      // resolves to the BASE declaration, so the override looks unreferenced.
      // Conservative, we'd rather miss a dead override than cry wolf.
      const overrides = inClass && !!checker
        .getTypeAtLocation(node.parent)
        .getBaseTypes?.()
        ?.some((b) => checker.getPropertyOfType(b, node.name.getText()));
      const implementsIface = inClass && (node.parent.heritageClauses ?? []).some((h) => h.token === ts.SyntaxKind.ImplementsKeyword);
      if (inClass && !overrides && !implementsIface && !ts.isPrivateIdentifier(node.name)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        decls.set(node, {
          name: node.name.getText(),
          file: relative(cwd, sf.fileName),
          line: line + 1,
          bytes: node.getEnd() - node.getStart(),
          kind: ts.isMethodDeclaration(node) ? 'method' : 'accessor',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

// --- 2. record every reference, tagged with the declaration it sits inside --
// enclosing === undefined means "reachable context": top level, a constructor,
// an object-literal method, a callback. Those are treated as always live.
const refs = new Map(); // declaration node -> Set(enclosing declaration node | undefined)
const enclosingDecl = (node) => {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isMethodDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) return decls.has(p) ? p : undefined;
    if (ts.isConstructorDeclaration(p)) return undefined; // runs on `new`
  }
  return undefined;
};

for (const sf of program.getSourceFiles()) {
  if (!inSrc(sf)) continue;
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isIdentifier(node)) {
      const nameNode = ts.isPropertyAccessExpression(node) ? node.name : node;
      let sym = checker.getSymbolAtLocation(nameNode);
      if (sym && sym.flags & ts.SymbolFlags.Alias) { try { sym = checker.getAliasedSymbol(sym); } catch { /* not aliased */ } }
      for (const d of sym?.declarations ?? []) {
        if (!decls.has(d)) continue;
        if (d.name === nameNode) continue; // the declaration's own name
        if (!refs.has(d)) refs.set(d, new Set());
        refs.get(d).add(enclosingDecl(node));
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
}

// --- 3. reachability fixpoint ----------------------------------------------
const dead = new Set(decls.keys());
for (;;) {
  let changed = false;
  for (const sym of [...dead]) {
    const sites = refs.get(sym);
    if (!sites) continue; // no references at all -> stays dead
    // live if referenced from a reachable context, or from a decl that is live
    const liveSite = [...sites].some((enc) => enc === undefined || !dead.has(enc));
    if (liveSite) { dead.delete(sym); changed = true; }
  }
  if (!changed) break;
}

// --- 4. report --------------------------------------------------------------
// A dead member with NO references at all can be deleted on its own: the edit
// is confined to its own file and nothing else has to change. A dead member
// that is referenced (only from other dead code) cannot: deleting it means
// also editing its callers, so it drags a multi-file cascade behind it.
// `--safe` reports only the first kind, which is what you want when the diff
// has to stay small and reviewable (e.g. shaving bytes inside an unrelated PR).
const safeOnly = process.argv.includes('--safe');
const asTree = process.argv.includes('--tree');
const annotate = (n) => {
  const info = decls.get(n);
  const refCount = refs.get(n)?.size ?? 0;
  const callers = [...(refs.get(n) ?? [])].filter(Boolean).map((c) => decls.get(c));
  return { ...info, standalone: refCount === 0, callers };
};
let rows = [...dead].map(annotate).sort((a, b) => b.bytes - a.bytes);
const cascading = rows.filter((r) => !r.standalone);
if (safeOnly) rows = rows.filter((r) => r.standalone);

// --- 4b. --tree: what each dead root unlocks -------------------------------
// Inverse of `refs`: for a dead member, which other dead members does its own
// body reference. A standalone root plus everything only it keeps alive is the
// real unit of deletion, so the subtree total is the number worth acting on,
// not the root's own size.
if (asTree) {
  const callees = new Map(); // decl -> Set(decl it references)
  for (const [target, callers] of refs)
    for (const caller of callers)
      if (caller && dead.has(caller) && dead.has(target)) {
        if (!callees.has(caller)) callees.set(caller, new Set());
        callees.get(caller).add(target);
      }

  const subtreeBytes = (node, seen = new Set()) => {
    if (seen.has(node)) return 0;
    seen.add(node);
    let n = decls.get(node).bytes;
    for (const c of callees.get(node) ?? []) n += subtreeBytes(c, seen);
    return n;
  };

  const printed = new Set();
  const draw = (node, prefix, isLast, seen) => {
    const d = decls.get(node);
    const cyc = seen.has(node);
    console.log(`${prefix}${prefix ? (isLast ? '└─ ' : '├─ ') : ''}${String(d.bytes).padStart(4)} B  ${d.name}  ${d.file}:${d.line}${cyc ? '  (already shown)' : ''}`);
    if (cyc) return;
    seen.add(node);
    printed.add(node);
    const kids = [...(callees.get(node) ?? [])].sort((a, b) => decls.get(b).bytes - decls.get(a).bytes);
    kids.forEach((k, i) => draw(k, prefix + (prefix ? (isLast ? '   ' : '│  ') : '  '), i === kids.length - 1, seen));
  };

  const roots = [...dead].filter((n) => (refs.get(n)?.size ?? 0) === 0)
    .sort((a, b) => subtreeBytes(b) - subtreeBytes(a));

  console.log(`deadcode: ${roots.length} dead root(s), each with everything only it keeps alive\n`);
  for (const r of roots) {
    const t = subtreeBytes(r);
    const own = decls.get(r).bytes;
    console.log(`ROOT  ${decls.get(r).name} @ ${decls.get(r).file}:${decls.get(r).line}`);
    console.log(`      deleting it unlocks ${t} B of raw source${t !== own ? ` (${own} B itself + ${t - own} B below)` : ' (nothing else depends on it)'}`);
    draw(r, '', true, new Set());
    console.log('');
  }
  const orphans = [...dead].filter((n) => !printed.has(n));
  if (orphans.length) {
    console.log(`Not reachable from any root (mutually referencing dead code):`);
    for (const o of orphans) console.log(`  ${String(decls.get(o).bytes).padStart(5)} B  ${decls.get(o).name}  ${decls.get(o).file}:${decls.get(o).line}`);
    console.log('');
  }
  console.log(`Raw source bytes, not packed. Confirm any deletion with \`npm run pack\`.`);
  process.exit(0);
}

if (!rows.length) {
  console.log(safeOnly ? 'deadcode: no standalone dead members' : 'deadcode: every class member in src/ is reachable');
  process.exit(0);
}
const total = rows.reduce((n, r) => n + r.bytes, 0);
const label = safeOnly ? 'standalone (no callers, delete in place)' : 'unreachable';
console.log(`deadcode: ${rows.length} ${label} member(s), ${total} B of raw source\n`);
for (const r of rows) {
  const tag = safeOnly ? '' : r.standalone ? '  [standalone]' : `  [cascades: called by ${r.callers.map((c) => `${c?.name}@${c?.file.split('/').pop()}`).join(', ')}]`;
  console.log(`  ${String(r.bytes).padStart(5)} B  ${r.name.padEnd(20)} ${r.kind.padEnd(9)} ${r.file}:${r.line}${tag}`);
}
if (safeOnly && cascading.length)
  console.log(`\n  (${cascading.length} further dead member(s) hidden: each needs its callers edited too, run without --safe)`);
console.log(`
Raw source bytes, not packed bytes: expect the packed saving to be a fraction
of this, and confirm with \`npm run pack\`. A member reached only through
dynamic dispatch can appear here wrongly, so read before deleting.`);
