// Real, type-resolved "who references this symbol" — a companion to knip and
// find-uncalled-methods.mjs, for spot-checking a SPECIFIC finding from either
// (or anything else you're unsure about) without knip's whole-project config.
// Uses ts-morph (a TypeScript-compiler-API wrapper): this resolves through
// the real type checker, so — unlike find-uncalled-methods.mjs's plain text
// search — a getter is found correctly, and two classes with a same-named
// method are told apart correctly.
//
//   node scripts/find-references.mjs src/audio/AudioManager.ts toggle
//
// Still has the one blind spot every static tool here shares: a reference
// reached only through a computed string (CUES[id], screens[cur]) isn't
// "using the symbol" in a way the type checker can follow — the exact class
// of bug PACK_EXTERNS=three hit for real once already. A method showing zero
// references here is real evidence, not proof.
import { Project } from 'ts-morph';
import { resolve } from 'node:path';

const [, , filePath, symbolName] = process.argv;
if (!filePath || !symbolName) {
  console.error('Usage: node scripts/find-references.mjs <file> <symbolName>');
  process.exit(1);
}

const project = new Project({ tsConfigFilePath: resolve('tsconfig.json') });
const sourceFile = project.getSourceFileOrThrow(resolve(filePath));

// Search class/interface members and top-level declarations by name.
const candidates = [
  ...sourceFile.getClasses().flatMap((c) => [...c.getMethods(), ...c.getGetAccessors(), ...c.getSetAccessors(), ...c.getProperties()]),
  ...sourceFile.getFunctions(),
  ...sourceFile.getInterfaces().flatMap((i) => i.getMethods()),
].filter((d) => d.getName?.() === symbolName);

if (!candidates.length) {
  console.error(`No declaration named "${symbolName}" found in ${filePath} (classes/interfaces/top-level functions only).`);
  process.exit(1);
}

for (const decl of candidates) {
  const nameNode = decl.getNameNode?.();
  if (!nameNode) continue;
  const refs = nameNode.findReferencesAsNodes().filter((n) => n !== nameNode);
  console.log(`${symbolName} (${decl.getKindName()} at ${filePath}:${decl.getStartLineNumber()}): ${refs.length} real reference(s)`);
  for (const r of refs) {
    const sf = r.getSourceFile();
    console.log(`  ${sf.getFilePath().replace(process.cwd() + '/', '')}:${r.getStartLineNumber()}`);
  }
}
