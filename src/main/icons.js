'use strict';
// Extract a program's icon as a PNG data URL: PrivateExtractIconsW (or SHGetFileInfoW as a
// fallback) -> GetIconInfo -> GetDIBits -> PNG.

const { koffi } = require('./win32');
const { encodePng } = require('./png');

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');
const shell32 = koffi.load('shell32.dll');
const ole32 = koffi.load('ole32.dll');

const fn = {
  PrivateExtractIconsW: user32.func('uint32 __stdcall PrivateExtractIconsW(const char16_t *file, int index, int cx, int cy, _Out_ intptr_t *icon, void *ids, uint32 n, uint32 flags)'),
  SHGetFileInfoW: shell32.func('uintptr_t __stdcall SHGetFileInfoW(const char16_t *path, uint32 attrs, void *info, uint32 cb, uint32 flags)'),
  GetIconInfo: user32.func('int __stdcall GetIconInfo(intptr_t icon, void *info)'),
  DestroyIcon: user32.func('int __stdcall DestroyIcon(intptr_t icon)'),
  GetDC: user32.func('intptr_t __stdcall GetDC(intptr_t hwnd)'),
  ReleaseDC: user32.func('int __stdcall ReleaseDC(intptr_t hwnd, intptr_t hdc)'),
  GetObjectW: gdi32.func('int __stdcall GetObjectW(intptr_t h, int cb, void *out)'),
  GetDIBits: gdi32.func('int __stdcall GetDIBits(intptr_t hdc, intptr_t hbm, uint32 start, uint32 lines, void *bits, void *bmi, uint32 usage)'),
  DeleteObject: gdi32.func('int __stdcall DeleteObject(intptr_t h)'),
  CoInitializeEx: ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 coinit)'),
};

let comReady = false;
const SIZE = 32;

function iconHandle(path) {
  const out = [0];
  const n = fn.PrivateExtractIconsW(path, 0, SIZE, SIZE, out, null, 1, 0);
  if (n > 0 && n !== 0xffffffff && out[0]) return out[0];
  if (!comReady) {
    fn.CoInitializeEx(null, 2 /* COINIT_APARTMENTTHREADED */);
    comReady = true;
  }
  const info = Buffer.alloc(696); // SHFILEINFOW on x64
  if (fn.SHGetFileInfoW(path, 0, info, info.length, 0x100 /* SHGFI_ICON */)) return Number(info.readBigInt64LE(0));
  return 0;
}

function readBitmap(hdc, hbm, w, h) {
  const bmi = Buffer.alloc(44);
  bmi.writeUInt32LE(40, 0);
  bmi.writeInt32LE(w, 4);
  bmi.writeInt32LE(-h, 8); // top-down
  bmi.writeUInt16LE(1, 12);
  bmi.writeUInt16LE(32, 14);
  const px = Buffer.alloc(w * h * 4);
  return fn.GetDIBits(hdc, hbm, 0, h, px, bmi, 0) ? px : null;
}

/** PNG bytes of a file's icon, or null. */
function iconPng(path) {
  const hicon = iconHandle(path);
  if (!hicon) return null;
  const ii = Buffer.alloc(32); // ICONINFO
  let hbmMask = 0;
  let hbmColor = 0;
  try {
    if (!fn.GetIconInfo(hicon, ii)) return null;
    hbmMask = Number(ii.readBigInt64LE(16));
    hbmColor = Number(ii.readBigInt64LE(24));
    if (!hbmColor) return null; // monochrome icon
    const bm = Buffer.alloc(32); // BITMAP
    if (!fn.GetObjectW(hbmColor, 32, bm)) return null;
    const w = bm.readInt32LE(4);
    const h = bm.readInt32LE(8);
    if (w <= 0 || h <= 0 || w > 256 || h > 256) return null;
    const hdc = fn.GetDC(0);
    let color;
    let mask = null;
    try {
      color = readBitmap(hdc, hbmColor, w, h);
      if (!color) return null;
      let hasAlpha = false;
      for (let i = 3; i < color.length; i += 4) {
        if (color[i]) {
          hasAlpha = true;
          break;
        }
      }
      if (!hasAlpha && hbmMask) mask = readBitmap(hdc, hbmMask, w, h);
      const rgba = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        rgba[o] = color[o + 2];
        rgba[o + 1] = color[o + 1];
        rgba[o + 2] = color[o];
        rgba[o + 3] = hasAlpha ? color[o + 3] : mask && mask[o] ? 0 : 255;
      }
      return encodePng(rgba, w, h);
    } finally {
      fn.ReleaseDC(0, hdc);
    }
  } catch {
    return null;
  } finally {
    if (hbmColor) fn.DeleteObject(hbmColor);
    if (hbmMask) fn.DeleteObject(hbmMask);
    fn.DestroyIcon(hicon);
  }
}

const cache = new Map();
function iconDataUrl(path) {
  const key = path.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const png = iconPng(path);
  const url = png ? `data:image/png;base64,${png.toString('base64')}` : null;
  cache.set(key, url);
  return url;
}

module.exports = { iconDataUrl, iconPng };
