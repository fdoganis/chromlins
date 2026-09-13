// Packs dist/index.html into build/chromlins.zip with a Zopfli-recompressed DEFLATE
// stream — ~475 B under `zip -9` on this payload, ~12 B off native advzip, with
// no binary or postinstall download (see .doc/GNOMES.md §5.9). Fails non-zero if
// the zip is at/over the js13kGames 13,312-byte limit.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import zopfli from '@gfx/zopfli';

const SRC = 'dist/index.html';
const ENTRY = 'index.html';
const OUT = 'build/chromlins.zip';
const LIMIT = 13312;
const ITERATIONS = Number(process.env.ZIP_ITER ?? 15); // ZIP_ITER=1000 saves ~4-7 B, ~3s slower — use it for the release artifact

const body = readFileSync(SRC);
const deflated = await zopfli.deflateAsync(body, { numiterations: ITERATIONS }); // raw DEFLATE, no header
const crc = crc32(body) >>> 0;
const name = Buffer.from(ENTRY, 'latin1');

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

// method 8 = deflate; time/date left 0 so the output is byte-stable build to build
const localHeader = Buffer.concat([
  u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
  u32(crc), u32(deflated.length), u32(body.length), u16(name.length), u16(0), name,
]);
const centralHeader = Buffer.concat([
  u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
  u32(crc), u32(deflated.length), u32(body.length),
  u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), name,
]);
const centralOffset = localHeader.length + deflated.length;
const eocd = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(1), u16(1),
  u32(centralHeader.length), u32(centralOffset), u16(0),
]);

const zip = Buffer.concat([localHeader, deflated, centralHeader, eocd]);
mkdirSync('build', { recursive: true });
writeFileSync(OUT, zip);

const slack = LIMIT - zip.length;
console.log(`${OUT}  ${zip.length} B  (${slack >= 0 ? '+' : ''}${slack} vs ${LIMIT})`);
if (zip.length >= LIMIT) { console.error('*** ERROR *** : APP BUNDLE TOO BIG !!!'); process.exit(1); }
