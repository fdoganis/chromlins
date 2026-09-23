// Lists every src/ file with its raw byte size, biggest first — the "usual
// suspects" starting point for a byte hunt. Raw source size does NOT predict
// packed cost directly (minification, tree-shaking, and roadroller's
// repetition-based compression all change the ranking — see
// HAND-OCCLUSION.md's ablation table, where the 3rd-biggest raw file turned
// out to be the single biggest packed-byte win, and removing one of several
// *similar* lines of code barely mattered). Use this to find candidates,
// then measure each one for real (scripts/pack.mjs + scripts/zip.mjs), never
// decide from this list alone.
//
//   node scripts/file-sizes.mjs           top 20, src/ only
//   node scripts/file-sizes.mjs --all     every file, no limit
//   node scripts/file-sizes.mjs tests     a different root directory
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const all = args.includes('--all');
const root = args.find((a) => !a.startsWith('--')) ?? 'src';
const LIMIT = all ? Infinity : 20;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push({ path: p, bytes: st.size });
  }
}

const files = [];
walk(root, files);
files.sort((a, b) => b.bytes - a.bytes);

const shown = files.slice(0, LIMIT);
const width = Math.max(...shown.map((f) => String(f.bytes).length));
for (const f of shown) console.log(`${String(f.bytes).padStart(width)} B  ${relative('.', f.path)}`);

const total = files.reduce((sum, f) => sum + f.bytes, 0);
console.log(`\n${files.length} files, ${total} B total in ${root}/${all ? '' : ` (showing top ${LIMIT} by size)`}`);
