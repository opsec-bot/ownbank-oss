// Generates the solid-color PWA icons with a bold "ob" mark (heavy strokes so it survives iOS dark-mode dimming). Pure Node (zlib), no image library.
// Usage: node scripts/gen-icons.mjs   (writes public/icons/*.png; the PNGs are committed)
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BG = [0x7d, 0x46, 0x98]; // deep purple (icon only; the in-app accent is a brighter purple)
const FG = [0xf4, 0xee, 0xfb]; // near white

// Geometry in a 100x100 box: "o" is a ring, "b" is a stem plus a ring. Centered around x=50, y=50.
function inMark(x, y) {
  const ring = (cx, cy, R, r) => {
    const d = Math.hypot(x - cx, y - cy);
    return d <= R && d >= r;
  };
  const o = ring(30, 58, 20.25, 8.75);
  // Stem with rounded ends.
  const sx = Math.min(Math.max(x, 55.55), 55.55);
  const sy = Math.min(Math.max(y, 23.75), 66.75);
  const stem = Math.hypot(x - sx, y - sy) <= 5.75;
  const bowl = ring(70, 58, 20.25, 8.75);
  return o || stem || bowl;
}

// scale < 1 shrinks the mark toward the center (maskable icons keep the mark inside the 80% safe zone).
function render(size, scale) {
  const ss = 3; // supersampling per axis
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const ux = ((px + (sx + 0.5) / ss) / size) * 100;
          const uy = ((py + (sy + 0.5) / ss) / size) * 100;
          const mx = (ux - 50) / scale + 50 + 0; // mark is centered around x=50
          const my = (uy - 50) / scale + 50;
          if (inMark(mx, my)) hit++;
        }
      }
      const t = hit / (ss * ss);
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] * (1 - t) + FG[c] * t);
    }
  }
  return raw;
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, scale) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(render(size, scale), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = path.join(process.cwd(), "public", "icons");
fs.mkdirSync(out, { recursive: true });
const files = [
  ["icon-192.png", 192, 0.84],
  ["icon-512.png", 512, 0.84],
  ["icon-maskable-512.png", 512, 0.64],
  ["apple-touch-icon.png", 180, 0.84],
];
for (const [name, size, scale] of files) {
  fs.writeFileSync(path.join(out, name), png(size, scale));
  console.log("wrote", name);
}
