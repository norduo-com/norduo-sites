// Synthetic covers at phone-like sizes (no client photos). Writes PNGs; convert with sips.
import fs from 'node:fs';
import zlib from 'node:zlib';
const out = process.argv[2];
function png(w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 3 + 1) + 1 + x * 3); }
  const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  const crc = (b) => { let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
for (const [name, w, h, noise] of [['cover-m', 1200, 800, 22]]) {
  fs.writeFileSync(`${out}/${name}.png`, png(w, h, (x, y) => {
    const n = rnd() * noise; const sky = y < h * 0.4 + h * 0.06 * Math.sin(x / (w / 7));
    return sky ? [120 + n / 3 | 0, 160 + n / 3 | 0, 210 + n / 4 | 0] : [50 + n + 20 * Math.sin(x / 30) | 0, 95 + n | 0, 45 + n / 2 | 0];
  }));
}
