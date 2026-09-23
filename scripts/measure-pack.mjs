// The only rigorous way to know what a change costs in the FINAL packed zip
// (see the chat this came from: roadroller is a context-mixing arithmetic
// coder, not a sliding-window compressor — there is no stable, context-free
// "this source region cost this many packed bytes" the way source-map-
// explorer can show for the pre-pack bundle). This formalizes the ablation
// loop this session ran by hand about 15 times (build, pack both modes, zip,
// compare) into one command with a saved baseline, so a before/after
// comparison is one line instead of copying numbers between terminal runs.
//
// This does NOT find candidates for you — that's file-sizes.mjs, knip, or
// your own judgment about what's a safe, coherent unit to change. This only
// makes the MEASURE step fast, consistent, and hard to get subtly wrong
// (fresh build every time, same flags every time, an actual diff instead of
// eyeballing two runs).
//
//   node scripts/measure-pack.mjs baseline        # save the current state as "baseline"
//   node scripts/measure-pack.mjs check            # measure now, diff against "baseline"
//   node scripts/measure-pack.mjs check my-change   # diff against a different saved snapshot
//   node scripts/measure-pack.mjs --real check      # use the real submission settings
//                                                    # (PACK_O=2, ZIP_ITER=1000, ~25s) instead
//                                                    # of fast dev settings (PACK_O=1, ZIP_ITER=15, ~3s)
//
// Snapshots are saved to .measure-pack.json (gitignored) — this machine only,
// not meant to be shared or committed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const STORE = '.measure-pack.json';
const args = process.argv.slice(2);
const real = args.includes('--real');
const rest = args.filter((a) => !a.startsWith('--'));
const [cmd, label = 'baseline'] = rest;

if (!['baseline', 'check'].includes(cmd)) {
  console.error('Usage: node scripts/measure-pack.mjs [--real] baseline|check [label]');
  process.exit(1);
}

const packEnv = real
  ? { PACK_MINIFY: 'closure', PACK_O: '2' }
  : { PACK_MINIFY: 'closure', PACK_O: '1' };
const zipEnv = real ? { ZIP_ITER: '1000' } : { ZIP_ITER: '15' };

function run(cmdStr, env) {
  // scripts/zip.mjs exits 1 (by design) when the bundle is over budget —
  // exactly the common case while ablating something that made it worse.
  // execFileSync throws on that exit code but still captured stdout; use it
  // either way instead of letting a real, useful "over budget" run crash.
  try {
    return execFileSync('bash', ['-c', cmdStr], { env: { ...process.env, ...env }, encoding: 'utf8' });
  } catch (err) {
    if (err.stdout) return err.stdout;
    throw err;
  }
}

function measureOne(externs) {
  rmSync('build/external-api.externs.js', { force: true });
  run('npm run build', {});
  const packOut = run('node scripts/pack.mjs', { ...packEnv, PACK_EXTERNS: externs });
  const zipOut = run('node scripts/zip.mjs', zipEnv);
  const m = zipOut.match(/build\/chromlins\.zip\s+(\d+)\s*B/);
  if (!m) throw new Error(`could not parse zip size from:\n${zipOut}`);
  return Number(m[1]);
}

console.log(`Measuring (${real ? 'real submission settings, ~25s x2' : 'fast dev settings, ~3s x2'})...`);
const result = {
  default: measureOne('all'),
  aggressive: measureOne('three'),
  real,
  date: new Date().toISOString(),
};

if (cmd === 'baseline') {
  const store = existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};
  store[label] = result;
  writeFileSync(STORE, JSON.stringify(store, null, 2));
  console.log(`Saved as "${label}": default ${result.default} B, aggressive ${result.aggressive} B`);
} else {
  if (!existsSync(STORE)) { console.error(`No snapshots saved yet — run \`node scripts/measure-pack.mjs baseline\` first.`); process.exit(1); }
  const store = JSON.parse(readFileSync(STORE, 'utf8'));
  const base = store[label];
  if (!base) { console.error(`No saved snapshot named "${label}" — have: ${Object.keys(store).join(', ') || '(none)'}`); process.exit(1); }
  if (base.real !== real) console.warn(`Warning: "${label}" was measured with ${base.real ? 'real' : 'fast'} settings, this run used ${real ? 'real' : 'fast'} — sizes aren't directly comparable, re-run with matching flags.`);

  const d = (now, was) => `${now} B  (${now - was >= 0 ? '+' : ''}${now - was} B vs "${label}")`;
  console.log(`default:    ${d(result.default, base.default)}`);
  console.log(`aggressive: ${d(result.aggressive, base.aggressive)}`);
}
