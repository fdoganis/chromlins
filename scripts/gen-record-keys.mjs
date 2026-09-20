// Finds every `Record<string, X> = { ... }` in src/ and returns its object
// literal's keys, the exact class of name that broke both the state machine
// (Game.ts's `screens`) and the audio cues (AudioManager.ts's `CUES`) under
// PACK_EXTERNS=three: Closure renamed the OBJECT LITERAL's key while leaving
// the STRING LITERAL used elsewhere to look it up (`cur`, `id`, ...)
// untouched, so the dynamic lookup silently missed and the feature just
// stopped working, no error.
//
// Quoting the keys at the definition site (Closure's own, documented signal
// that a property is exempt from renaming, confirmed in isolation: an
// unquoted `{music:...}` got renamed, the same object quoted did not) does
// NOT work in this project's actual pipeline: `npm run build`'s esbuild
// minification runs first and normalizes a quoted-but-identifier-safe key
// straight back to unquoted, before Closure, which runs inside pack.mjs
// afterward, ever sees it. Confirmed by inspecting pack.mjs's real input
// (`/tmp/cc-src.js`) after quoting the source, the quotes were already gone.
// So this has to be solved with externs, not source style, and it should be
// found automatically rather than hand-maintained: every `Record<string, X>`
// object literal with identifier/string keys, looked up anywhere via a
// computed string expression, is exactly this risk, by construction, no
// exceptions to reason about case by case, and there is no reason to wait
// for the next silent failure to find the next one.
//
//   node scripts/gen-record-keys.mjs        # human-readable
//   node scripts/gen-record-keys.mjs --json # ["intro","anchor",...] for piping in
//
// Deliberately narrow (a `const NAME: Record<string, X> = {...}` on ONE
// declaration, not e.g. an object literal passed straight into a
// Record<string,X>-typed parameter, or built via `as Record<...>`, or a
// `{[key: string]: X}` index signature written out instead of `Record<>`):
// narrow enough to explain and verify, and it already covers every real
// instance found in this codebase. Broaden it (or reroute through the
// checker's own type info instead of a syntactic `Record<...>` match) if a
// future instance doesn't take this exact shape.
import ts from 'typescript';
import { relative } from 'node:path';

// Importable (gen-three-externs.mjs calls this directly, no subprocess) as
// well as runnable standalone. `cwd` defaults to process.cwd() so both uses
// work the same from the project root.
export function findRecordKeys(cwd = process.cwd()) {
  const cfgPath = ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json');
  const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, cwd);
  const program = ts.createProgram(parsed.fileNames, parsed.options);

  const inSrc = (sf) => !sf.isDeclarationFile && !sf.fileName.includes('node_modules') && sf.fileName.includes(`${cwd}/src/`);

  const found = []; // { name, file, line, keys }

  for (const sf of program.getSourceFiles()) {
  if (!inSrc(sf)) continue;
  const visit = (node) => {
    try {
      if (
        ts.isVariableDeclaration(node) && node.type && node.initializer &&
        ts.isObjectLiteralExpression(node.initializer) &&
        ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(sf) === 'Record' &&
        node.type.typeArguments?.length === 2 && node.type.typeArguments[0].getText(sf) === 'string'
      ) {
        const keys = [];
        for (const prop of node.initializer.properties) {
          if ((ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) && !prop.computed) {
            if (ts.isIdentifier(prop.name)) keys.push(prop.name.text);
            else if (ts.isStringLiteral(prop.name)) keys.push(prop.name.text);
          }
        }
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        found.push({ name: node.name.getText(sf), file: relative(cwd, sf.fileName), line: line + 1, keys });
      }
    } catch { /* a node without full position info (rare, synthetic) — skip it, not this tool's job to fix */ }
    ts.forEachChild(node, visit);
  };
    ts.forEachChild(sf, visit);
  }
  return found;
}

// Only run as a report when invoked directly (`node gen-record-keys.mjs`),
// not when imported by gen-three-externs.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
  const found = findRecordKeys();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(found.flatMap((f) => f.keys)));
  } else {
    console.log(`gen-record-keys: ${found.length} Record<string, X> literal(s), ${found.reduce((n, f) => n + f.keys.length, 0)} key(s) total\n`);
    for (const f of found) console.log(`  ${f.name}  ${f.file}:${f.line}\n    ${f.keys.join(', ')}`);
  }
}
