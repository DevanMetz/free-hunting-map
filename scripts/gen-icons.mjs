// Generates the PWA icons in public/icons with no external assets.
// Usage: npm run icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [31, 46, 36];
const PIN = [232, 120, 38];
const DOT = [31, 46, 36];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shape tests in unit coordinates (0..1). `scale` shrinks the pin for maskable safe zone.
function sample(x, y, { rounded, scale }) {
  const r = 0.18;
  if (rounded) {
    const dx = Math.max(r - x, 0, x - (1 - r));
    const dy = Math.max(r - y, 0, y - (1 - r));
    if (dx * dx + dy * dy > r * r) return null;
  }
  const u = 0.5 + (x - 0.5) / scale;
  const v = 0.5 + (y - 0.5) / scale;
  const cx = 0.5, cy = 0.4, R = 0.24;
  const d = Math.hypot(u - cx, v - cy);
  if (d < 0.09) return DOT;
  if (d < R) return PIN;
  // Tapered tail of the pin down to a point at v = 0.82.
  if (v >= cy && v <= 0.82) {
    const half = R * (1 - (v - cy) / (0.82 - cy)) * 0.92;
    if (Math.abs(u - cx) < half) return PIN;
  }
  return BG;
}

function render(size, opts) {
  const ss = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, opts);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = ss * ss, i = (py * size + px) * 4;
      const cov = a / 255;
      out[i] = cov ? Math.round(r / cov) : 0;
      out[i + 1] = cov ? Math.round(g / cov) : 0;
      out[i + 2] = cov ? Math.round(b / cov) : 0;
      out[i + 3] = Math.round(a / n);
    }
  }
  return png(size, out);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', render(192, { rounded: true, scale: 1 }));
writeFileSync('public/icons/icon-512.png', render(512, { rounded: true, scale: 1 }));
writeFileSync('public/icons/maskable-512.png', render(512, { rounded: false, scale: 0.72 }));
writeFileSync('public/icons/apple-touch-icon.png', render(180, { rounded: false, scale: 0.9 }));
writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="rgb(${BG})"/><path d="M50 82 L28 44 A24 24 0 1 1 72 44 Z" fill="rgb(${PIN})"/><circle cx="50" cy="40" r="9" fill="rgb(${DOT})"/></svg>\n`,
);
console.log('icons written to public/icons');
