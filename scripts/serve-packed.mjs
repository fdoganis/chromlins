// Serves an already-packed zip (build/chromlins.zip by default) so it can be
// tested on a real device, headset or phone, over the same cloudflared tunnel
// used for `npm run dev`.
//
//   npm run pack                  # or PACK_EXTERNS=three npm run pack, etc.
//   npm run device-test           # this script
//   (in another terminal) npm run cloud
//   open the printed *.trycloudflare.com URL on the device
//
// Why this exists: testing a PACKED build (not `npm run dev`'s live source) on
// a real device needs the zip unzipped somewhere `http-server` can serve it,
// on port 5173 specifically, because `npm run cloud` tunnels that exact port
// (see package.json). Doing this by hand each time (unzip to a scratch dir,
// find http-server's bin, remember the port, clean up after) is exactly the
// kind of thing that's fine once and annoying the fourth time.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

const ZIP = process.argv[2] ?? 'build/chromlins.zip';
const PORT = process.env.DEVICE_TEST_PORT ?? '5173';
const DIR = '.device-test'; // gitignored; scratch, safe to wipe every run

if (!existsSync(ZIP)) {
  console.error(`serve-packed: ${ZIP} not found — run \`npm run pack\` first`);
  process.exit(1);
}

// Free the port first. A previous run of this script (or a stray `npm run
// dev`) can still be holding it, and killing by process name doesn't work
// reliably here: http-server shows up as a plain "node" process in ps/pgrep,
// not as "http-server", so `pgrep -f http-server` silently matches nothing.
// `lsof -ti` finds it by the port itself instead, which always works.
const holders = spawnSync('lsof', ['-ti', `:${PORT}`], { encoding: 'utf8' }).stdout.trim();
if (holders) {
  console.log(`serve-packed: port ${PORT} is in use (pid ${holders.split('\n').join(', ')}), freeing it`);
  spawnSync('kill', holders.split('\n'));
}

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const unzip = spawnSync('unzip', ['-o', ZIP, '-d', DIR], { encoding: 'utf8' });
if (unzip.status !== 0) {
  console.error('serve-packed: unzip failed:\n' + (unzip.stderr || unzip.stdout));
  process.exit(1);
}

console.log(`serve-packed: serving ${ZIP} from ${DIR}/ on port ${PORT}`);
console.log(`serve-packed: in another terminal, run \`npm run cloud\`, then open the printed URL on the device.`);
console.log(`serve-packed: Ctrl+C here to stop.\n`);

const server = spawn('node_modules/.bin/http-server', [DIR, '-p', PORT, '-c-1'], { stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));

// http-server binds and keeps running; if the port's already taken (a stray
// dev server, or a previous run of this script), its own error message names
// the port — `lsof -i :5173` from another terminal shows what's holding it.
process.on('SIGINT', () => { server.kill('SIGINT'); });
