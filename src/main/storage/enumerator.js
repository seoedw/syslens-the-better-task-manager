'use strict';
// Enumerator thread: lists batches of folders with FindFirstFileExW and returns per-folder
// totals. Opening a folder is slow when security software filters file access (~0.5 ms),
// so several of these run in parallel under one coordinator.

const { parentPort } = require('worker_threads');
const { api } = require('../win32');

const ATTR_DIRECTORY = 0x10;
const ATTR_REPARSE = 0x400;
const ATTR_CLOUD = 0x1000 | 0x40000 | 0x400000; // offline | recall-on-open | recall-on-data-access
const EPOCH_DIFF_MS = 11644473600000;
const BIG_PER_DIR = 12;

const data = Buffer.alloc(592);

function longPath(p) {
  if (p.startsWith('\\\\?\\')) return p;
  if (p.startsWith('\\\\')) return `\\\\?\\UNC\\${p.slice(2)}`;
  return `\\\\?\\${p}`;
}

function enumerate(dir, lite, topMin, ext, top, index) {
  const r = { ok: false, subdirs: [], ownSize: 0, ownFiles: 0, big: null, links: 0, cloudBytes: 0, cloudFiles: 0 };
  const h = api.FindFirstFileExW(`${longPath(dir)}\\*`, 1 /* FindExInfoBasic */, data, 0, null, 2 /* LARGE_FETCH */);
  if (h === -1 || h === 0) return r;
  r.ok = true;
  try {
    do {
      // Skip "." and ".."
      if (data[44] === 0x2e && data[45] === 0 && ((data[46] === 0 && data[47] === 0) || (data[46] === 0x2e && data[47] === 0 && data[48] === 0 && data[49] === 0))) continue;
      const attr = data.readUInt32LE(0);
      let end = 44;
      while (end < 564 && (data[end] !== 0 || data[end + 1] !== 0)) end += 2;
      if (attr & ATTR_DIRECTORY) {
        if (attr & ATTR_REPARSE) r.links++;
        else r.subdirs.push(data.toString('utf16le', 44, end));
        continue;
      }
      const size = data.readUInt32LE(28) * 4294967296 + data.readUInt32LE(32);
      if (attr & ATTR_CLOUD) {
        r.cloudBytes += size;
        r.cloudFiles++;
        continue;
      }
      r.ownSize += size;
      r.ownFiles++;
      if (lite) continue;
      const big = r.big || (r.big = []);
      const qualifiesBig = big.length < BIG_PER_DIR || size > big[BIG_PER_DIR - 1][1];
      const qualifiesTop = size > topMin;
      let name = null;
      if (qualifiesBig || qualifiesTop) {
        name = data.toString('utf16le', 44, end);
        const ft = data.readUInt32LE(24) * 4294967296 + data.readUInt32LE(20);
        const mtime = ft ? ft / 10000 - EPOCH_DIFF_MS : 0;
        if (qualifiesBig) {
          if (big.length < BIG_PER_DIR) big.push([name, size, mtime]);
          else big[BIG_PER_DIR - 1] = [name, size, mtime];
          big.sort((a, b) => b[1] - a[1]);
        }
        if (qualifiesTop) top.push([index, name, size, mtime]);
      }
      // Extension stats: find the last '.' in the UTF-16 name without decoding it.
      let dot = -1;
      for (let i = end - 2; i >= 46 && i >= end - 22; i -= 2) {
        if (data[i] === 0x2e && data[i + 1] === 0) {
          dot = i;
          break;
        }
      }
      const e = dot > 0 ? data.toString('utf16le', dot + 2, end).toLowerCase() : '';
      const st = ext[e];
      if (st) {
        st[0] += size;
        st[1]++;
      } else {
        ext[e] = [size, 1];
      }
    } while (api.FindNextFileW(h, data));
  } finally {
    api.FindClose(h);
  }
  return r;
}

parentPort.on('message', (msg) => {
  if (msg.type !== 'batch') return;
  const ext = {};
  const top = [];
  const results = msg.dirs.map((dir, i) => enumerate(dir, msg.lite, msg.topMin, ext, top, i));
  parentPort.postMessage({ type: 'result', results, ext, top });
});
