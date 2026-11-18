'use strict';
// Draws the SysLens logo (gradient tile + three bars) into assets/icon.png and assets/icon.ico.
// No dependencies: a 4x4 supersampled rasterizer plus the app's own PNG encoder.

const fs = require('fs');
const path = require('path');
const { encodePng } = require('../src/main/png');

const SIZE = 256;
const SS = 4;
const S = SIZE / 32; // logo is designed on a 32x32 grid

function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

const tile = [2 * S, 2 * S, 28 * S, 28 * S, 8 * S];
const bars = [
  [8, 17, 3.2, 7],
  [14.4, 11, 3.2, 13],
  [20.8, 14, 3.2, 10],
].map(([x, y, w, h]) => [x * S, y * S, w * S, h * S, 1.2 * S]);

const from = [0x6a, 0xa8, 0xff];
const to = [0x9b, 0x7b, 0xff];
const rgba = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let tileCov = 0;
    let barCov = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS;
        const py = y + (sy + 0.5) / SS;
        if (inRoundRect(px, py, ...tile)) {
          tileCov++;
          if (bars.some((b) => inRoundRect(px, py, ...b))) barCov++;
        }
      }
    }
    const n = SS * SS;
    const a = tileCov / n;
    const b = (barCov / n) * 0.95;
    const t = (x + y) / (2 * SIZE);
    const base = from.map((c, i) => c + (to[i] - c) * t);
    const mix = (b / Math.max(a, 1e-9)) || 0;
    const o = (y * SIZE + x) * 4;
    for (let i = 0; i < 3; i++) rgba[o + i] = Math.round(base[i] * (1 - mix) + 255 * mix);
    rgba[o + 3] = Math.round(a * 255);
  }
}

const png = encodePng(rgba, SIZE, SIZE);

// ICO with a single 256x256 PNG entry (supported since Windows Vista).
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = 0; // 256
ico[7] = 0; // 256
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png);
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([ico, png]));
console.log(`wrote assets/icon.png (${png.length} bytes) and assets/icon.ico`);
