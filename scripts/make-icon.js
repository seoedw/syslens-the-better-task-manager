'use strict';
// Draws the SysLens logo (a flat Windows-blue tile with three bars, the same mark as in the
// app's sidebar) into assets/icon.png and assets/icon.ico.
// No dependencies: a 4x4 supersampled rasterizer plus the app's own PNG encoder.

const fs = require('fs');
const path = require('path');
const { encodePng } = require('../src/main/png');

const SIZE = 256;
const SS = 4;
const S = SIZE / 32; // drawn on a 32x32 grid
const TILE = [0x00, 0x67, 0xc0]; // Windows 11's default accent blue
const BAR = [0xff, 0xff, 0xff];

function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

// The sidebar mark is drawn on a 20x20 grid; here it fills 30 of 32 units.
const k = 1.5;
const tile = [1 * S, 1 * S, 30 * S, 30 * S, 6.75 * S];
const bars = [
  [4.6, 10, 2.6, 5.6],
  [8.7, 4.6, 2.6, 11],
  [12.8, 7.6, 2.6, 8],
].map(([x, y, w, h]) => [(1 + x * k) * S, (1 + y * k) * S, w * k * S, h * k * S, 1.5 * S]);

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
    const a = tileCov / (SS * SS);
    const mix = tileCov ? barCov / tileCov : 0;
    const o = (y * SIZE + x) * 4;
    for (let i = 0; i < 3; i++) rgba[o + i] = Math.round(TILE[i] * (1 - mix) + BAR[i] * mix);
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
