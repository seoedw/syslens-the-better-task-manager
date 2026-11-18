'use strict';
// Storage coordinator thread. Hands folders to a pool of enumerator threads (enumerator.js),
// builds the size tree from their results, and answers queries about it.

const os = require('os');
const path = require('path');
const { parentPort, Worker } = require('worker_threads');
const { api, readWStr } = require('../win32');

const ATTR_DIRECTORY = 0x10;
const DRIVE_TYPES = { 2: 'Removable', 3: 'Local disk', 4: 'Network', 5: 'CD/DVD', 6: 'RAM disk' };
const POOL_SIZE = Math.max(2, Math.min(4, Math.floor(os.cpus().length / 4)));
const POOL_IDLE_MS = 20000;
const ENUMERATOR = path.join(__dirname, 'enumerator.js');

const findData = Buffer.alloc(592);
let current = { id: 0, cancelled: false };
let tree = null;

// ---------- enumerator pool ----------

let pool = null;
let idleTimer = null;

function makeSlot() {
  const slot = { w: null, busy: false, cb: null };
  const finish = (msg) => {
    const cb = slot.cb;
    slot.cb = null;
    slot.busy = false;
    if (cb) cb(msg);
  };
  const spawn = () => {
    slot.w = new Worker(ENUMERATOR);
    slot.w.on('message', finish);
    slot.w.on('error', () => {});
    slot.w.on('exit', () => {
      if (slot.cb) finish({ type: 'result', results: [], ext: {}, top: [] });
      if (pool && pool.includes(slot)) spawn();
    });
  };
  spawn();
  return slot;
}

function getPool() {
  clearTimeout(idleTimer);
  if (!pool) pool = Array.from({ length: POOL_SIZE }, makeSlot);
  return pool;
}

function releasePoolLater() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pool && pool.every((s) => !s.busy)) {
      const old = pool;
      pool = null;
      for (const s of old) s.w.terminate();
    }
  }, POOL_IDLE_MS);
}

const EMPTY = { ok: false, subdirs: [], ownSize: 0, ownFiles: 0, big: null, links: 0, cloudBytes: 0, cloudFiles: 0 };

/**
 * Walk folder trees in parallel. `visit(item, result)` handles one enumerated folder and
 * returns the child items to walk next. Work is handed out dynamically in small batches.
 */
function walk(roots, { lite, visit, merge, cancelled, topMin = () => Infinity, onDispatch }) {
  const slots = getPool();
  return new Promise((resolve) => {
    const stack = roots.slice();
    let outstanding = 0;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      releasePoolLater();
      resolve(!cancelled());
    };
    const pump = () => {
      if (cancelled()) {
        if (outstanding === 0) done();
        return;
      }
      for (const slot of slots) {
        if (slot.busy || !stack.length) continue;
        const n = Math.max(1, Math.min(48, Math.ceil(stack.length / (slots.length * 2))));
        const batch = stack.splice(stack.length - n, n);
        slot.busy = true;
        outstanding++;
        slot.cb = (msg) => {
          outstanding--;
          if (!cancelled()) {
            const results = msg.results || [];
            for (let i = 0; i < batch.length; i++) {
              const kids = visit(batch[i], results[i] || EMPTY);
              for (let k = 0; k < kids.length; k++) stack.push(kids[k]);
            }
            if (merge) merge(msg, batch);
          }
          pump();
        };
        if (onDispatch) onDispatch(batch[batch.length - 1]);
        slot.w.postMessage({ type: 'batch', dirs: batch.map((b) => b.path), lite: !!lite, topMin: topMin() });
      }
      if (!stack.length && outstanding === 0) done();
    };
    pump();
  });
}

// ---------- helpers ----------

function longPath(p) {
  if (p.startsWith('\\\\?\\')) return p;
  if (p.startsWith('\\\\')) return `\\\\?\\UNC\\${p.slice(2)}`;
  return `\\\\?\\${p}`;
}

/** 'C:\\' -> 'C:', 'C:\\Users\\x\\' -> 'C:\\Users\\x' */
function normalize(p) {
  let s = String(p).replace(/\//g, '\\');
  while (s.length > 2 && s.endsWith('\\')) s = s.slice(0, -1);
  return s;
}

function display(p) {
  return /^[A-Za-z]:$/.test(p) ? `${p}\\` : p;
}

function statEntry(p) {
  const h = api.FindFirstFileExW(longPath(normalize(p)), 1, findData, 0, null, 0);
  if (h === -1 || h === 0) return null;
  api.FindClose(h);
  return {
    attr: findData.readUInt32LE(0),
    size: findData.readUInt32LE(28) * 4294967296 + findData.readUInt32LE(32),
  };
}

class Dir {
  constructor(name, parent) {
    this.name = name;
    this.parent = parent;
    this.children = [];
    this.size = 0;
    this.files = 0;
    this.dirs = 0;
    this.ownSize = 0;
    this.ownFiles = 0;
    this.big = null;
    this.denied = false;
  }
}

/** Fixed-size min-heap that keeps the N largest files. */
class TopFiles {
  constructor(n) {
    this.n = n;
    this.h = [];
  }

  get min() {
    return this.h.length < this.n ? 0 : this.h[0].size;
  }

  add(item) {
    const h = this.h;
    if (h.length < this.n) {
      h.push(item);
      let i = h.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (h[p].size <= h[i].size) break;
        [h[p], h[i]] = [h[i], h[p]];
        i = p;
      }
    } else if (item.size > h[0].size) {
      h[0] = item;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && h[l].size < h[m].size) m = l;
        if (r < h.length && h[r].size < h[m].size) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
  }

  sorted() {
    return [...this.h].sort((a, b) => b.size - a.size);
  }
}

function pathOf(node) {
  const parts = [];
  for (let n = node; n; n = n.parent) parts.push(n.name);
  return parts.reverse().join('\\');
}

// ---------- full scan ----------

async function scan(id, rootArg) {
  const rootPath = normalize(rootArg);
  const root = new Dir(rootPath, null);
  const all = [root];
  const ext = new Map();
  const top = new TopFiles(300);
  const stats = { files: 0, bytes: 0, denied: 0, deniedPaths: [], cloudBytes: 0, cloudFiles: 0, links: 0 };
  const started = Date.now();
  const cancelled = () => current.cancelled || current.id !== id;
  let lastPost = 0;
  let lastDir = rootPath;
  let rootFailed = false;

  await walk([{ path: rootPath, node: root }], {
    lite: false,
    cancelled,
    topMin: () => top.min,
    onDispatch: (item) => {
      lastDir = item.path;
    },
    visit: (item, r) => {
      const node = item.node;
      if (!r.ok) {
        if (node === root) rootFailed = true;
        else {
          node.denied = true;
          stats.denied++;
          if (stats.deniedPaths.length < 50) stats.deniedPaths.push(item.path);
        }
        return [];
      }
      node.ownSize = r.ownSize;
      node.ownFiles = r.ownFiles;
      node.big = r.big;
      stats.files += r.ownFiles;
      stats.bytes += r.ownSize;
      stats.links += r.links;
      stats.cloudBytes += r.cloudBytes;
      stats.cloudFiles += r.cloudFiles;
      const kids = new Array(r.subdirs.length);
      for (let i = 0; i < r.subdirs.length; i++) {
        const child = new Dir(r.subdirs[i], node);
        node.children.push(child);
        all.push(child);
        kids[i] = { path: `${item.path}\\${r.subdirs[i]}`, node: child };
      }
      return kids;
    },
    merge: (msg, batch) => {
      for (const e of Object.keys(msg.ext)) {
        const [b, c] = msg.ext[e];
        const st = ext.get(e);
        if (st) {
          st[0] += b;
          st[1] += c;
        } else {
          ext.set(e, [b, c]);
        }
      }
      for (const [idx, name, size, mtime] of msg.top) top.add({ size, node: batch[idx].node, name, mtime });
      const now = Date.now();
      if (now - lastPost > 150) {
        lastPost = now;
        parentPort.postMessage({ type: 'progress', id, files: stats.files, bytes: stats.bytes, dirs: all.length, denied: stats.denied, current: lastDir });
      }
    },
  });

  if (cancelled()) return;
  if (rootFailed) {
    parentPort.postMessage({ type: 'scanDone', id, error: `Can't read ${display(rootPath)}` });
    return;
  }

  // Roll sizes up: discovery order puts every parent before its children.
  for (let i = all.length - 1; i >= 0; i--) {
    const d = all[i];
    d.size += d.ownSize;
    d.files += d.ownFiles;
    if (d.parent) {
      d.parent.size += d.size;
      d.parent.files += d.files;
      d.parent.dirs += d.dirs + 1;
    }
  }

  tree = { root, rootPath, ext, top, stats, took: Date.now() - started, finished: Date.now() };
  parentPort.postMessage({ type: 'scanDone', id, summary: summary() });
}

function summary() {
  if (!tree) return null;
  const { root, rootPath, stats, took, finished } = tree;
  return {
    root: display(rootPath),
    size: root.size,
    files: root.files,
    dirs: root.dirs,
    denied: stats.denied,
    deniedPaths: stats.deniedPaths,
    cloudBytes: stats.cloudBytes,
    cloudFiles: stats.cloudFiles,
    links: stats.links,
    took,
    finished,
  };
}

function findNode(p) {
  if (!tree) return null;
  const target = normalize(p);
  const rootPath = tree.rootPath;
  if (target.toLowerCase() === rootPath.toLowerCase()) return tree.root;
  if (!target.toLowerCase().startsWith(`${rootPath.toLowerCase()}\\`)) return null;
  let node = tree.root;
  for (const seg of target.slice(rootPath.length + 1).split('\\')) {
    const low = seg.toLowerCase();
    node = node.children.find((c) => c.name.toLowerCase() === low);
    if (!node) return null;
  }
  return node;
}

function children(p) {
  const node = findNode(p || (tree && tree.rootPath));
  if (!node) return null;
  const dir = pathOf(node);
  const items = node.children.map((c) => ({ name: c.name, path: `${dir}\\${c.name}`, dir: true, size: c.size, files: c.files, dirs: c.dirs, denied: c.denied }));
  const big = node.big || [];
  let bigSize = 0;
  for (const [name, size, mtime] of big) {
    bigSize += size;
    items.push({ name, path: `${dir}\\${name}`, dir: false, size, mtime });
  }
  const restFiles = node.ownFiles - big.length;
  if (restFiles > 0) items.push({ name: `${restFiles.toLocaleString()} smaller file${restFiles === 1 ? '' : 's'}`, path: dir, dir: false, aggregate: true, size: node.ownSize - bigSize, files: restFiles });
  items.sort((a, b) => b.size - a.size);
  const crumbs = [];
  for (let n = node; n; n = n.parent) crumbs.unshift({ name: n.parent ? n.name : display(n.name), path: display(pathOf(n)) });
  return {
    path: display(dir),
    name: node.parent ? node.name : display(node.name),
    size: node.size,
    files: node.files,
    dirs: node.dirs,
    denied: node.denied,
    crumbs,
    items: items.slice(0, 500),
    more: Math.max(0, items.length - 500),
  };
}

function topFiles() {
  if (!tree) return [];
  return tree.top.sorted().map((f) => ({ name: f.name, path: `${pathOf(f.node)}\\${f.name}`, size: f.size, mtime: f.mtime }));
}

function types() {
  if (!tree) return [];
  return [...tree.ext.entries()].map(([ext, [bytes, count]]) => ({ ext, bytes, count })).sort((a, b) => b.bytes - a.bytes);
}

// ---------- measuring individual paths ----------

async function sizeOf(p, id) {
  const r = { bytes: 0, files: 0, denied: 0, cloudBytes: 0 };
  const cancelled = () => current.cancelled || current.id !== id;
  await walk([{ path: normalize(p) }], {
    lite: true,
    cancelled,
    visit: (item, res) => {
      if (!res.ok) {
        r.denied++;
        return [];
      }
      r.bytes += res.ownSize;
      r.files += res.ownFiles;
      r.cloudBytes += res.cloudBytes;
      return res.subdirs.map((n) => ({ path: `${item.path}\\${n}` }));
    },
  });
  return cancelled() ? null : r;
}

async function measure(id, items) {
  for (const it of items) {
    if (current.cancelled || current.id !== id) return;
    let result;
    const st = statEntry(it.path);
    if (!st) {
      result = { exists: false, bytes: 0, files: 0 };
    } else if (!(st.attr & ATTR_DIRECTORY)) {
      result = { exists: true, bytes: st.size, files: 1 };
    } else {
      const r = await sizeOf(it.path, id);
      if (!r) return;
      // A folder we couldn't open at all reads as "needs admin" rather than 0 bytes.
      result = { exists: true, ...r, unreadable: r.denied > 0 && r.files === 0 && r.bytes === 0 };
    }
    parentPort.postMessage({ type: 'measured', id, item: it.id, ...result });
  }
  parentPort.postMessage({ type: 'measureDone', id });
}

function drives() {
  const mask = api.GetLogicalDrives();
  const out = [];
  for (let i = 0; i < 26; i++) {
    if (!(mask & (1 << i))) continue;
    const letter = String.fromCharCode(65 + i);
    const root = `${letter}:\\`;
    const type = api.GetDriveTypeW(root);
    const drive = { letter: `${letter}:`, root, type: DRIVE_TYPES[type] || 'Drive', ready: false };
    const avail = [0];
    const total = [0];
    const free = [0];
    if (api.GetDiskFreeSpaceExW(root, avail, total, free)) {
      const nameBuf = Buffer.alloc(522);
      const fsBuf = Buffer.alloc(522);
      api.GetVolumeInformationW(root, nameBuf, 261, [0], [0], [0], fsBuf, 261);
      drive.ready = true;
      drive.label = readWStr(nameBuf, 0);
      drive.fs = readWStr(fsBuf, 0);
      drive.total = Number(total[0]);
      drive.free = Number(free[0]);
      drive.used = drive.total - drive.free;
    }
    out.push(drive);
  }
  return out;
}

parentPort.on('message', async (msg) => {
  try {
    switch (msg.type) {
      case 'scan':
        current = { id: msg.id, cancelled: false };
        tree = null;
        await scan(msg.id, msg.root);
        break;
      case 'measure':
        current = { id: msg.id, cancelled: false };
        await measure(msg.id, msg.items);
        break;
      case 'cancel':
        current.cancelled = true;
        break;
      case 'children':
        parentPort.postMessage({ type: 'reply', req: msg.req, data: children(msg.path) });
        break;
      case 'top':
        parentPort.postMessage({ type: 'reply', req: msg.req, data: topFiles() });
        break;
      case 'types':
        parentPort.postMessage({ type: 'reply', req: msg.req, data: types() });
        break;
      case 'summary':
        parentPort.postMessage({ type: 'reply', req: msg.req, data: summary() });
        break;
      case 'drives':
        parentPort.postMessage({ type: 'reply', req: msg.req, data: drives() });
        break;
      default:
        break;
    }
  } catch (err) {
    if (msg.req) parentPort.postMessage({ type: 'reply', req: msg.req, error: String(err && err.message) });
    else parentPort.postMessage({ type: 'error', id: msg.id, error: String(err && err.stack) });
  }
});
