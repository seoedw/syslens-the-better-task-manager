'use strict';
// SysLens backend. Samples the system, serves the UI on 127.0.0.1 behind a per-run token,
// streams live data to it, and opens it in an app window (Edge/Chrome --app mode).
// launcher.js normally starts this and restarts it if it ever crashes or hangs.
//
//   node src/main/launcher.js             normal start (brings a running SysLens to the front)
//   node src/main/server.js --no-window   server only; prints the URL instead of opening a window (dev)
//   --debug                               also log to the console (the log file is always written)

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Monitor } = require('./monitor');
const { loadSystemInfo } = require('./sysinfo');
const { StorageService } = require('./storage');
const { NetworkService } = require('./network');
const { ServicesService } = require('./services');
const { StartupService } = require('./startup');
const { HistoryService } = require('./history');
const { MachineService } = require('./machine');
const { Settings } = require('./settings');
const { DevicesService } = require('./devices');
const { redactAdapters, redactConnections } = require('./network');
const { INSTANCE_FILE, readInstance, showExisting } = require('./instance');
const { iconDataUrl } = require('./icons');
const w = require('./win32');
const shellx = require('./shell');
const { createLogger, DATA_DIR, LOG_FILE } = require('./log');
const pkg = require('../../package.json');
const os = require('os');

function parseArgs(list) {
  const out = {};
  for (const a of list) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));
const APP_DIR = path.resolve(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const ASSETS = path.join(APP_DIR, 'assets');
const ADMIN = w.isAdmin();
// The administrator window gets a browser profile of its own (see shell.openAppWindow).
const PROFILE_DIR = path.join(DATA_DIR, ADMIN ? 'browser-admin' : 'browser');
const DEV = !!(argv['no-window'] || argv['keep-alive']);
const SUPERVISED = typeof process.send === 'function';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

// The server never quits just because the live stream dropped (sleep, a network change, a busy
// PC): the window reconnects on its own. It quits once the window itself is gone.
const LIFECYCLE_TICK = 2000;
const CLOSED_GRACE = 3000; // window's browser process gone and nobody connected
const STARTUP_GRACE = 30000; // a window that was just opened may take this long to show up
const BYE_GRACE = 60000; // the page said goodbye (closed or reloaded) and nothing came back
const TAB_IDLE_LIMIT = 10 * 60 * 1000; // a plain browser tab can't be watched, so allow this long
const KEEPALIVE_MS = 10000; // the page treats 30 s of silence as a dead connection
const MAX_BUFFERED = 8 * 1024 * 1024; // a page this far behind has stopped reading; drop it

const log = createLogger('server', { echo: !!(argv.debug || DEV) });
const lastLogged = new Map();
/** Log a recurring problem at most once a minute. */
function logOften(key, ...parts) {
  const now = Date.now();
  if (now - (lastLogged.get(key) || 0) < 60000) return;
  lastLogged.set(key, now);
  log(...parts);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// After a crash the launcher hands the old token back, so the open window can reconnect with it.
const inherited = process.env.SYSLENS_TOKEN;
delete process.env.SYSLENS_TOKEN; // keep it out of the browser's and PowerShell's environment
const token = inherited && /^[A-Za-z0-9_-]{20,64}$/.test(inherited) ? inherited : crypto.randomBytes(24).toString('base64url');

let port = 0;
let server = null;
let monitor = null;
let storage = null;
const settings = new Settings();
// Loaded on demand, when their page is opened.
const network = new NetworkService();
const services = new ServicesService();
const startup = new StartupService();
const history = new HistoryService();
const machine = new MachineService();
const devices = new DevicesService();
/** Network details stay on the server unless the user chose to show them. */
const hideNetwork = () => settings.get('hideNetwork') || settings.get('privacy');
let HANDLERS = {};
const clients = new Map(); // event-stream response -> { page, needsFull, leaving }
let everConnected = false;
let lastClientAt = Date.now();
let lastTickAt = Date.now();
let byeAt = 0;
let windowMode = 'none'; // 'app' (own browser profile, can be watched), 'tab' (default browser), 'none' (dev)
let windowOpenedAt = Date.now();
let shuttingDown = false;
let steppingAside = false; // an administrator instance took over

// ---------- helpers ----------
const round = (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v);

function appUrl(p, t) {
  return `http://127.0.0.1:${p}/#t=${t}`;
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function tokenOk(req) {
  return sameSecret(req.headers['x-syslens-token'], token);
}

function pageId(req) {
  const id = String(req.headers['x-syslens-page'] || '');
  return /^[\w-]{8,64}$/.test(id) ? id : '';
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  res.end(body);
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function notifyLauncher(msg) {
  if (!SUPERVISED || !process.connected) return;
  process.send(msg, () => {}); // errors (launcher gone) are ignored
}

const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data, round)}\n\n`;

function writeTo(res, chunk) {
  if (res.destroyed || res.writableEnded) return;
  if (res.writableLength > MAX_BUFFERED) {
    logOften('stalled', 'a window stopped reading the live stream; dropping it so it reconnects');
    res.destroy();
    return;
  }
  res.write(chunk);
}

function broadcast(event, data) {
  if (!clients.size) return;
  const payload = sse(event, data);
  for (const res of clients.keys()) writeTo(res, payload);
}

/** Process targets from the page: [{ pid, key }], checked and capped. */
function cleanTargets(targets) {
  if (!Array.isArray(targets)) return [];
  return targets
    .filter((t) => t && Number.isInteger(t.pid) && t.pid > 0)
    .slice(0, 500)
    .map((t) => ({ pid: t.pid, key: typeof t.key === 'string' ? t.key : null }));
}

// ---------- the app window ----------
/** SysLens's own top-level windows (its browser process's windows). */
function ownWindows() {
  const pids = new Set(monitor.procs.selfBrowsers);
  if (!pids.size) return [];
  try {
    return w.topWindows().filter((x) => pids.has(x.pid));
  } catch {
    return [];
  }
}

/**
 * Where "Task Manager size" puts the window, in screen pixels: exactly where and as big as Task
 * Manager opens on this PC (its own saved window, %LOCALAPPDATA%\Microsoft\Windows\TaskManager\
 * settings.json), or, if it never saved one, a Task Manager-like 1000 x 700 in the middle of the
 * main screen.
 */
function taskManagerBounds() {
  let r = null;
  try {
    const tm = JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'TaskManager', 'settings.json'), 'utf8'));
    const p = tm && tm.FullPosition;
    if (p && Number.isInteger(p.Left) && Number.isInteger(p.Right)) r = { x: p.Left, y: p.Top, w: p.Right - p.Left, h: p.Bottom - p.Top };
  } catch {
    /* no saved Task Manager window */
  }
  try {
    const area = r ? w.workAreaAt(r.x + 20, r.y + 20) : null;
    if (r && area && area.onScreen && r.w >= 400 && r.h >= 300) {
      // Keep it on that screen.
      r.w = Math.min(r.w, area.w);
      r.h = Math.min(r.h, area.h);
      r.x = Math.max(area.x, Math.min(r.x, area.x + area.w - r.w));
      r.y = Math.max(area.y, Math.min(r.y, area.y + area.h - r.h));
      return r;
    }
    const main = w.workAreaAt(0, 0);
    if (!main) return null;
    const scale = w.screenScale();
    const width = Math.min(Math.round(1000 * scale), main.w);
    const height = Math.min(Math.round(700 * scale), main.h);
    return { x: main.x + Math.round((main.w - width) / 2), y: main.y + Math.round((main.h - height) / 2), w: width, h: height };
  } catch {
    return null;
  }
}

let placement = null; // { bounds, until, tries }: size the window like Task Manager's once it appears

function openWindow() {
  const start = settings.get('windowStart');
  const bounds = start === 'default' ? taskManagerBounds() : null;
  let size = null;
  if (bounds) {
    // Edge takes these in device-independent pixels; the exact pixels are set once the window shows.
    const scale = w.screenScale() || 1;
    size = { x: Math.round(bounds.x / scale), y: Math.round(bounds.y / scale), w: Math.round(bounds.w / scale), h: Math.round(bounds.h / scale) };
    placement = { bounds, until: Date.now() + 20000, tries: 0 };
    placeSoon();
  }
  shellx.openAppWindow(appUrl(port, token), PROFILE_DIR, { elevated: ADMIN, start, size });
  windowOpenedAt = Date.now();
}

/**
 * Put the new window exactly where Task Manager's would be. Edge takes its starting size in whole
 * points, so at 150% or 200% it can land a pixel off (201 px is 100.5 points); this sets the exact
 * pixels once the window appears, then looks again in case Edge was still applying its own size.
 */
function placeSoon() {
  if (!placement) return;
  const win = ownWindows()[0];
  if (win) {
    const b = placement.bounds;
    const now = w.windowRect(win.hwnd);
    const exact = now && now.x === b.x && now.y === b.y && now.w === b.w && now.h === b.h;
    // Done once it's exact, if it got maximized meanwhile, or after a few tries (never fight Edge).
    if (exact || placement.tries >= 3 || w.api.IsZoomed(win.hwnd)) {
      placement = null;
      return;
    }
    w.placeWindow(win.hwnd, b);
    placement.tries++;
    setTimeout(placeSoon, 400);
    return;
  }
  if (Date.now() > placement.until) {
    placement = null;
    return;
  }
  setTimeout(placeSoon, 250);
}

/** Bring the window forward, or open one if it was closed. */
function showWindow() {
  const wins = ownWindows();
  if (wins.length) {
    w.focusWindow(wins[0].hwnd);
    return { ok: true, focused: true };
  }
  if (windowMode === 'app' && !shuttingDown && !steppingAside) {
    openWindow();
    return { ok: true, opened: true };
  }
  return { ok: false };
}

const topmostDone = new Set();
function applyTopmost() {
  const on = settings.get('alwaysOnTop');
  for (const win of ownWindows()) {
    if (on && topmostDone.has(win.hwnd)) continue;
    w.setTopmost(win.hwnd, on);
    if (on) topmostDone.add(win.hwnd);
  }
  if (!on) topmostDone.clear();
}

/** "Switch to": bring an app's window forward (optionally minimizing SysLens, as Task Manager can). */
function switchTo(pids) {
  if (!Array.isArray(pids)) return { ok: false };
  const want = new Set(pids.filter((p) => Number.isInteger(p)));
  const win = w.topWindows().find((x) => want.has(x.pid));
  if (!win) return { ok: false, error: 'It has no window to switch to' };
  const ok = w.focusWindow(win.hwnd);
  if (ok && settings.get('minimizeOnSwitch')) for (const own of ownWindows()) w.minimizeWindow(own.hwnd);
  return { ok };
}

/**
 * "Restart app": end every process of an app, wait for its main process to go, then start its
 * program again with the same arguments. What runs comes from the process itself.
 */
async function restartApp(targets, mainPid) {
  const info = Number.isInteger(mainPid) ? monitor.procs.relaunchInfo(mainPid) : null;
  if (!info) return { ok: false, error: 'This one can’t be restarted from SysLens' };
  const list = cleanTargets(targets);
  if (!list.some((t) => t.pid === mainPid)) list.push({ pid: mainPid, key: null });
  const res = monitor.procs.kill(list);
  if (!res.some((r) => r.ok)) return { ok: false, error: (res[0] && res[0].error) || 'Couldn’t end it' };
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    try {
      process.kill(mainPid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') break;
    }
  }
  await sleep(300); // single-instance apps let go of their lock a moment after exiting
  const r = await shellx.startProgram(info.path, info.args);
  return r.ok ? { ok: true, elevated: ADMIN } : r;
}

/** End Windows Explorer and make sure it comes back (Windows restarts it on its own). */
async function restartExplorer() {
  const shells = monitor.procs.explorers();
  if (!shells.length) {
    if (ADMIN) return { ok: false, error: 'Windows Explorer isn’t running' };
    execFile('explorer.exe', { windowsHide: false }, () => {});
    return { ok: true, note: 'Explorer wasn’t running, so SysLens started it.' };
  }
  const res = monitor.procs.kill(shells.map((p) => ({ pid: p.pid, key: p.key })));
  if (!res.some((r) => r.ok)) return { ok: false, error: res[0].error };
  await sleep(3000);
  monitor.procs.sample(); // a fresh look rather than a second-old one
  if (!monitor.procs.explorers().length) {
    // An elevated Explorer would run the whole desktop as administrator: leave that to Windows.
    if (ADMIN) return { ok: true, note: 'Windows will restart Explorer in a moment.' };
    execFile('explorer.exe', { windowsHide: false }, () => {});
  }
  return { ok: true };
}

// ---------- internet latency (opt-in) ----------
// One TCP handshake to Cloudflare's 1.1.1.1 every 5 s while a window is watching; it measures
// the round trip without sending any data.
const LATENCY_TARGET = { host: '1.1.1.1', port: 443, label: 'Cloudflare (1.1.1.1)' };
let latency = null; // { ms, at, lost, target }
let latencyBusy = false;

function tcpPing(host, p, timeout = 2000) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const sock = net.connect({ host, port: p });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok ? Number(process.hrtime.bigint() - t0) / 1e6 : null);
    };
    sock.setTimeout(timeout, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

async function latencyTick() {
  if (!settings.get('latency') || !clients.size || monitor.background || latencyBusy) return;
  latencyBusy = true;
  try {
    const ms = await tcpPing(LATENCY_TARGET.host, LATENCY_TARGET.port);
    latency = { ms, at: Date.now(), target: LATENCY_TARGET.label };
  } finally {
    latencyBusy = false;
  }
}

// ---------- compact snapshot stream ----------
// Static per-process/per-app details (names, paths, window titles) are sent once and again
// only when they change; each tick carries just the numbers. History is sent in full when a
// client connects, then one new point per tick, and the system inventory only when it
// changes. Per-process rows (the bulk of each tick) are left out unless a page that shows
// them is open: see 'app:need'. bridge.js reassembles the full snapshot.
const P_META = ['pid', 'ppid', 'name', 'created', 'session', 'exe', 'path', 'pathGuessed', 'role', 'access', 'priority', 'desc', 'company', 'display', 'isWindows', 'critical', 'group', 'host', 'windows', 'suspended', 'eco'];
const P_DYN = ['cpu', 'cpuTime', 'priv', 'ws', 'peakWs', 'commit', 'pagedPool', 'nonpagedPool', 'pageFaults', 'ioR', 'ioW', 'ioO', 'io', 'ioTotal', 'handles', 'threads', 'gpu', 'gpuShared', 'gpuDedicated'];
const G_META = ['name', 'exe', 'path', 'company', 'desc', 'host', 'type', 'critical', 'windows', 'hasWindows', 'suspended', 'eco'];
const G_DYN = ['count', 'pids', 'cpu', 'priv', 'ws', 'commit', 'gpu', 'gpuShared', 'gpuDedicated', 'io', 'handles', 'threads'];
const PROCS_LEASE = 20000;
let sentMeta = { procs: new Map(), groups: new Map(), sys: '' };
let procsWantedUntil = 0;

function packRows(list, metaFields, dynFields, sentMap, full) {
  const meta = {};
  const rows = new Array(list.length);
  const next = new Map();
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    let sig = '';
    for (const f of metaFields) sig += `${item[f]}\u0001`;
    if (full || sentMap.get(item.key) !== sig) {
      const m = {};
      for (const f of metaFields) m[f] = item[f];
      meta[item.key] = m;
    }
    next.set(item.key, sig);
    const row = new Array(dynFields.length + 1);
    row[0] = item.key;
    for (let j = 0; j < dynFields.length; j++) row[j + 1] = item[dynFields[j]];
    rows[i] = row;
  }
  return { meta, rows, next };
}

function packSnapshot(s, full, withProcs = true) {
  const { procs, groups, hist, sys, ...rest } = s;
  const p = full || withProcs ? packRows(procs, P_META, P_DYN, sentMeta.procs, full) : null;
  const g = packRows(groups, G_META, G_DYN, sentMeta.groups, full);
  const out = { ...rest, latency, packed: { pf: P_DYN, pm: p ? p.meta : {}, pr: p ? p.rows : null, gf: G_DYN, gm: g.meta, gr: g.rows } };
  const sysJson = JSON.stringify(sys || null);
  if (full || sysJson !== sentMeta.sys) out.sys = sys;
  if (full) {
    out.hist = hist;
  } else {
    out.histTail = {};
    for (const [k, arr] of Object.entries(hist)) out.histTail[k] = arr[arr.length - 1];
  }
  return { out, next: { procs: p ? p.next : sentMeta.procs, groups: g.next, sys: sysJson } };
}

function broadcastSnapshot(s) {
  if (!clients.size) {
    sentMeta = { procs: new Map(), groups: new Map(), sys: '' };
    return;
  }
  const { out, next } = packSnapshot(s, false, Date.now() < procsWantedUntil);
  sentMeta = next;
  const delta = sse('snapshot', out);
  let full = null;
  for (const [res, c] of clients) {
    if (c.needsFull) {
      // Connected before there was anything to send: it needs the whole picture first.
      if (!full) full = sse('snapshot', packSnapshot(s, true).out);
      c.needsFull = false;
      writeTo(res, full);
    } else {
      writeTo(res, delta);
    }
  }
}

// ---------- API ----------
function appInfo() {
  return {
    version: pkg.version,
    admin: monitor.admin,
    node: process.version,
    user: os.userInfo().username,
    host: os.hostname(),
    dataDir: DATA_DIR,
    logFile: LOG_FILE,
    appDir: APP_DIR,
    portable: path.dirname(process.execPath).toLowerCase().startsWith(APP_DIR.toLowerCase()),
    latencyTarget: LATENCY_TARGET.label,
    channel: (pkg.syslens && pkg.syslens.channel) || '',
    author: (pkg.syslens && pkg.syslens.author) || '',
    discord: (pkg.syslens && pkg.syslens.discord) || '',
    license: pkg.license || '',
    repo: 'github.com/seoedw/syslens-the-better-task-manager',
  };
}

function readChangelog() {
  try {
    return fs.readFileSync(path.join(APP_DIR, 'CHANGELOG.md'), 'utf8').slice(0, 256 * 1024);
  } catch {
    return '';
  }
}

// Lists read for a page (event logs, the hardware report, services, startup entries, adapters)
// are dropped after 10 minutes without a request; they're read again when next needed.
const lastUsed = {};
const touch = (key, value) => {
  lastUsed[key] = Date.now();
  return value;
};
function sweepCaches() {
  const idle = (key) => Date.now() - (lastUsed[key] || 0) > 10 * 60000;
  if (idle('history')) history.cache = null;
  if (idle('machine') && !machine.loading.hardware && !machine.loading.windows) {
    machine.hardware = null;
    machine.windows = null;
  }
  if (idle('services')) {
    services.cache = null;
    services.at = 0;
  }
  if (idle('startup')) startup.cache = null;
  if (idle('devices') && !devices.loading) devices.cache = null;
  if (idle('adapters')) {
    network.adapters = null;
    network.adaptersAt = 0;
  }
}

function buildHandlers() {
  return {
    snapshot: () => monitor.latest,
    interval: (ms) => {
      if (typeof ms === 'number' && Number.isFinite(ms)) {
        monitor.setInterval(ms);
        if (ms > 0) settings.set({ interval: ms });
      }
      return { interval: monitor.interval, paused: monitor.paused };
    },
    'app:visible': (visible) => {
      monitor.setBackground(!visible);
      return true;
    },
    // Pages that list individual processes renew this lease while they are on screen.
    'app:need': (what) => {
      if (what && what.procs) procsWantedUntil = Date.now() + PROCS_LEASE;
      return true;
    },
    // Everything the page needs before it shows anything: settings, and the names that
    // "Hide personal info" masks.
    'app:boot': () => ({ settings: settings.get(), info: appInfo() }),
    'app:info': () => appInfo(),
    'app:openLog': () => shellx.showItem(LOG_FILE),
    'app:openData': () => shellx.openFolder(DATA_DIR),
    'app:changelog': () => readChangelog(),
    'app:elevate': () => elevate(),
    'app:hotkey': async (combo) => {
      if (typeof combo !== 'string') return { ok: false, error: 'Not a shortcut' };
      const before = settings.get('hotkey');
      if (settings.set({ hotkey: combo }).hotkey !== combo) return { ok: false, error: 'That key combination can’t be used' };
      const r = await shellx.setHotkey(combo);
      if (!r.ok) settings.set({ hotkey: before });
      return r;
    },
    'settings:get': () => settings.get(),
    'settings:set': (patch) => settings.set(patch),
    'settings:reset': () => settings.reset(),
    'bg:list': () => settings.pictures(),
    'bg:add': (dataUrl, thumbUrl) => settings.addPicture(dataUrl, thumbUrl),
    'bg:remove': (id) => settings.removePicture(id),
    'users:list': () => {
      const own = monitor.procs.current.get(process.pid);
      return { sessions: w.sessions(), current: own ? own.session : null };
    },
    'users:action': (id, action) => {
      if (!Number.isInteger(id) || !['lock', 'disconnect', 'logoff'].includes(action)) return { ok: false, error: 'Unknown action' };
      const own = monitor.procs.current.get(process.pid);
      if (action === 'lock') return own && own.session === id ? { ok: w.lockWorkstation() } : { ok: false, error: 'Only your own session can be locked' };
      return w.sessionAction(id, action);
    },
    'devices:get': (refresh) => touch('devices', devices.all(!!refresh)),
    'devices:problems': (refresh) => devices.problems(!!refresh),
    'tool:open': (id) => shellx.openTool(id),
    'tool:flushDns': () => shellx.flushDns(),
    'shell:openLink': (id) => shellx.openLink(id),
    'machine:get': (refresh) => touch('machine', machine.get(!!refresh)),
    'net:connections': (opts) => {
      const hidden = hideNetwork();
      const list = network.connections({ pid: opts && Number.isInteger(opts.pid) ? opts.pid : null, resolve: !hidden && settings.get('resolveHosts') && !(opts && opts.resolve === false) });
      return hidden ? redactConnections(list) : list;
    },
    'net:adapters': async (refresh) => {
      const data = await touch('adapters', network.adapterInfo(!!refresh));
      return hideNetwork() ? redactAdapters(data) : data;
    },
    'services:list': (refresh) => touch('services', services.list(!!refresh)),
    'svc:control': (name, action) => touch('services', services.control(name, action)),
    'svc:startType': (name, type) => touch('services', services.setStartType(name, type)),
    'startup:list': (refresh) => touch('startup', startup.list(!!refresh)),
    'startup:toggle': (id, on) => touch('startup', startup.setEnabled(id, !!on)),
    'history:get': (refresh) => touch('history', history.get(!!refresh)),
    'proc:details': (pid) => (Number.isInteger(pid) ? monitor.procs.details(pid) : null),
    'proc:kill': (targets) => monitor.procs.kill(cleanTargets(targets)),
    'proc:killTree': (targets) => monitor.procs.killTree(cleanTargets(targets)),
    'proc:priority': (targets, level) => monitor.procs.setPriority(cleanTargets(targets), level),
    'proc:efficiency': (targets, on) => monitor.procs.setEfficiency(cleanTargets(targets), !!on),
    'proc:suspend': (targets, on) => monitor.procs.suspend(cleanTargets(targets), !!on),
    'proc:switchTo': (pids) => switchTo(pids),
    'proc:restartExplorer': () => restartExplorer(),
    'proc:restartApp': (targets, mainPid) => restartApp(targets, mainPid),
    'proc:canRestart': (pid) => !!(Number.isInteger(pid) && monitor.procs.relaunchInfo(pid)),
    'task:run': (command, admin) => shellx.runTask(command, !!admin),
    icon: (p) => (shellx.isSafePath(p) ? iconDataUrl(p) : null),
    'shell:showItem': (p) => shellx.showItem(p),
    'shell:openFolder': (p) => shellx.openFolder(p),
    'shell:settings': (page) => shellx.openSettings(page),
    'shell:search': (text) => shellx.searchOnline(text),
    'storage:drives': () => storage.drives(),
    'storage:state': () => storage.state(),
    'storage:scan': (root) => (shellx.isSafePath(root) ? storage.startScan(root) : null),
    'storage:cancel': () => storage.cancelScan(),
    'storage:children': (p) => (p == null || shellx.isSafePath(p) ? storage.children(p) : null),
    'storage:top': () => storage.topFiles(),
    'storage:types': () => storage.types(),
    'storage:apps': (refresh) => {
      storage.loadApps(!!refresh);
      return storage.apps;
    },
    'storage:hogs': (refresh) => {
      storage.loadHogs(!!refresh);
      return storage.hogs;
    },
    'storage:pickFolder': () => shellx.pickFolder(),
  };
}

async function handleCall(req, res) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, '{"error":"JSON only"}');
  let msg;
  try {
    msg = JSON.parse(await readBody(req, 12 * 1024 * 1024));
  } catch {
    return send(res, 400, '{"error":"Bad JSON"}');
  }
  const channel = msg && msg.channel;
  if (typeof channel !== 'string' || !Object.prototype.hasOwnProperty.call(HANDLERS, channel)) return send(res, 404, '{"error":"Unknown channel"}');
  try {
    const result = await HANDLERS[channel](...(Array.isArray(msg.args) ? msg.args : []));
    send(res, 200, JSON.stringify(result === undefined ? null : result, round));
  } catch (err) {
    logOften(`call:${channel}`, `${channel} failed:`, err);
    send(res, 500, JSON.stringify({ error: String((err && err.message) || err) }));
  }
}

function openEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Content-Type-Options': 'nosniff',
  });
  res.write(': connected\n\n');
  const c = { page: pageId(req), needsFull: !monitor.latest, leaving: false };
  if (monitor.latest) res.write(sse('snapshot', packSnapshot(monitor.latest, true).out));
  clients.set(res, c);
  byeAt = 0;
  clientsChanged(everConnected ? 'window reconnected' : 'window connected');
  const keepAlive = setInterval(() => writeTo(res, ': ka\n\n'), KEEPALIVE_MS);
  res.on('close', () => {
    clearInterval(keepAlive);
    if (!clients.delete(res)) return;
    if (c.leaving && !clients.size) byeAt = Date.now();
    clientsChanged(c.leaving ? 'window closed or reloading' : 'live connection dropped');
  });
}

/** The page is closing or reloading: remember that, so it isn't mistaken for a lost connection. */
function handleBye(req, res) {
  const page = pageId(req);
  let found = false;
  for (const c of clients.values()) {
    if (page && c.page === page) {
      c.leaving = true;
      found = true;
    }
  }
  // Its stream may already have closed.
  if (!found && !clients.size) byeAt = Date.now();
  send(res, 200, '{"ok":true}');
}

/** The page, with the settings that shape its first paint (theme, density…) already applied. */
function serveIndex(res) {
  fs.readFile(path.join(RENDERER, 'index.html'), 'utf8', (err, html) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const s = settings.get();
    // Every value here passed a whitelist check in settings.js.
    const attrs = ` data-pref-theme="${s.theme}" data-density="${s.density}" data-text="${s.textSize}" data-bg="${s.background}"`;
    send(res, 200, html.replace('<html lang="en">', `<html lang="en"${attrs}>`), MIME['.html']);
  });
}

function serveStatic(pathname, res) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad path', 'text/plain');
  }
  let file;
  if (rel === '/' || rel === '/index.html') return serveIndex(res);
  if (rel === '/icon.png') file = path.join(ASSETS, 'icon.png');
  else if (rel === '/favicon.ico') file = path.join(ASSETS, 'icon.ico');
  else {
    file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER + path.sep)) return send(res, 404, 'Not found', 'text/plain');
  }
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

/** A background picture (or its thumbnail). CSS can't send headers, so the token comes in the query. */
function serveBackground(url, res) {
  if (!sameSecret(url.searchParams.get('t'), token)) return send(res, 403, 'Forbidden', 'text/plain');
  const file = settings.pictureFile(url.searchParams.get('id'), url.searchParams.get('thumb') === '1');
  if (!file) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, MIME['.jpg']);
  });
}

async function onRequest(req, res) {
  // Only answer requests addressed to us by IP/localhost: blocks DNS-rebinding attacks.
  const host = req.headers.host || '';
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 421, 'Misdirected request', 'text/plain');
  let url;
  try {
    url = new URL(req.url, `http://${host}`);
  } catch {
    return send(res, 400, 'Bad request', 'text/plain');
  }
  const p = url.pathname;
  // Opening SysLens again only brings its window forward, so it needs no token (the
  // administrator instance never writes its token to disk). Web pages can't send the header.
  if (p === '/api/focus' && req.method === 'POST' && req.headers['x-syslens-focus'] === '1') {
    return send(res, 200, JSON.stringify({ app: 'syslens', ...showWindow() }));
  }
  if (p === '/api/background' && req.method === 'GET') return serveBackground(url, res);
  if (p.startsWith('/api/')) {
    if (!tokenOk(req)) return send(res, 403, '{"error":"Forbidden"}');
    if (p === '/api/ping') return send(res, 200, '{"ok":true}');
    if (p === '/api/events' && req.method === 'GET') return openEvents(req, res);
    if (p === '/api/call' && req.method === 'POST') return handleCall(req, res);
    if (p === '/api/bye' && req.method === 'POST') return handleBye(req, res);
    return send(res, 404, '{"error":"Not found"}');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
  return serveStatic(p, res);
}

// ---------- lifecycle ----------
function clientsChanged(why) {
  monitor.setBackground(clients.size === 0);
  log(`${why} (${clients.size} connected)`);
  if (clients.size) everConnected = true;
  else lastClientAt = Date.now();
}

/** Is the SysLens window (its browser process, found by its dedicated profile) still open? */
function appWindowRunning() {
  for (const pid of monitor.procs.selfBrowsers) {
    try {
      process.kill(pid, 0); // existence check only
      return true;
    } catch (err) {
      if (err.code === 'EPERM') return true;
    }
  }
  return false;
}

function lifecycleTick() {
  const now = Date.now();
  // A long gap between ticks means the PC was asleep. Nothing could reconnect while it slept,
  // so start counting again rather than treating the window as gone.
  if (now - lastTickAt > LIFECYCLE_TICK * 5 && !clients.size) lastClientAt = now;
  lastTickAt = now;
  if (clients.size && settings.get('alwaysOnTop')) applyTopmost();
  if (shuttingDown || windowMode === 'none' || clients.size) return;
  const idle = now - lastClientAt;
  if (windowMode === 'app') {
    if (byeAt && now - byeAt > BYE_GRACE) return shutdown('the window was closed');
    if (appWindowRunning()) return; // still open: it reconnects, however long that takes
    if (now - windowOpenedAt < STARTUP_GRACE) return; // a window was just opened
    if (idle > CLOSED_GRACE) shutdown(everConnected ? 'the window was closed' : 'the window never opened');
    return;
  }
  // A plain browser tab can't be watched: go by its goodbye, or a long idle limit.
  if (byeAt && now - byeAt > 10000) return shutdown('the browser tab was closed');
  if (everConnected ? idle > TAB_IDLE_LIMIT : now - windowOpenedAt > 90000) shutdown('no browser tab is connected');
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutting down:', reason);
  try {
    monitor.stop();
    storage.dispose();
  } catch {
    /* ignore */
  }
  for (const res of clients.keys()) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  try {
    const info = readInstance();
    if (info && info.pid === process.pid) fs.unlinkSync(INSTANCE_FILE);
  } catch {
    /* no instance file */
  }
  if (server) server.close();
  setTimeout(() => process.exit(0), 300).unref();
}

function writeInstance() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const info = { pid: process.pid, port, started: Date.now(), admin: monitor.admin };
  // An administrator instance's token is never written to disk: any program could read it.
  if (!monitor.admin) info.token = token;
  fs.writeFileSync(INSTANCE_FILE, JSON.stringify(info));
}

/**
 * Restart as administrator. The elevated copy opens a window of its own (its token never
 * passes through this non-elevated server or its window); once it is up, this one closes
 * its window and quits.
 */
function elevate() {
  if (monitor.admin) return { ok: true };
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const args = `--jitless "${path.join(__dirname, 'launcher.js')}" --elevated`;
  const command = `Start-Process -FilePath ${q(process.execPath)} -ArgumentList ${q(args)} -Verb RunAs -WindowStyle Hidden`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true }, (err) => {
      if (err) return resolve({ ok: false, error: 'Administrator access was not granted.' });
      stepAsideForAdmin();
      resolve({ ok: true });
    });
  });
}

async function stepAsideForAdmin() {
  const until = Date.now() + 45000;
  while (Date.now() < until && !shuttingDown) {
    await sleep(500);
    const info = readInstance();
    if (info && info.admin && info.pid !== process.pid) {
      steppingAside = true;
      broadcast('handoff', { admin: true });
      await sleep(2500); // let the administrator window appear first
      for (const win of ownWindows()) w.closeWindow(win.hwnd);
      setTimeout(() => shutdown('handed over to the administrator window'), 1500);
      return;
    }
  }
  if (!shuttingDown) broadcast('handoff', { failed: true });
}

function listen(p) {
  return new Promise((resolve, reject) => {
    const onError = (e) => {
      server.off('listening', onListening);
      reject(e);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(p, '127.0.0.1');
  });
}

async function listenWithRetry(p, ms) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return await listen(p);
    } catch (e) {
      if (e.code !== 'EADDRINUSE' || Date.now() > end) throw e;
      await sleep(250);
    }
  }
}

/** React to settings that live outside the page. */
function onSettingsChanged(changed) {
  if ('interval' in changed && !monitor.paused) monitor.setInterval(changed.interval);
  if ('alwaysOnTop' in changed) applyTopmost();
  if ('startWithWindows' in changed) {
    shellx.setAutostart(changed.startWithWindows).then((r) => {
      if (!r.ok) log('could not change start with Windows:', r.error);
    });
  }
  if ('latency' in changed && !changed.latency) latency = null;
  // Picked "Maximized" for when SysLens opens: show it now too. (Full screen is entered by the
  // window itself, which needs the click that changed the setting.)
  if (changed.windowStart === 'maximized') for (const win of ownWindows()) w.maximizeWindow(win.hwnd);
  if (changed.windowStart === 'default') {
    const b = taskManagerBounds();
    for (const win of ownWindows()) {
      if (!b) break;
      if (w.api.IsZoomed(win.hwnd)) w.api.ShowWindow(win.hwnd, 9 /* SW_RESTORE */);
      w.placeWindow(win.hwnd, b);
    }
  }
}

async function main() {
  const restarted = !!argv.restarted;
  if (!restarted && !argv.elevated && !DEV && !argv.new && (await showExisting())) {
    log('already running; brought its window to the front');
    return process.exit(0);
  }
  log(`starting SysLens ${pkg.version}${restarted ? ' again after a crash' : ''}${ADMIN ? ' as administrator' : ''}`);

  monitor = new Monitor();
  if (SUPERVISED) monitor.procs.selfPids.add(process.ppid); // the launcher belongs to SysLens too
  storage = new StorageService();
  HANDLERS = buildHandlers();
  settings.onChange(onSettingsChanged);
  monitor.interval = settings.get('interval'); // start() schedules the first sample
  loadSystemInfo((info) => monitor.setSystemInfo(info)).catch((err) => log('could not read system info:', err));
  monitor.on('snapshot', (s) => broadcastSnapshot(s));
  monitor.on('error', (err) => logOften(`monitor:${err && err.message}`, 'sampling failed:', err));
  storage.on('progress', (m) => broadcast('storage:progress', m));
  storage.on('done', (m) => broadcast('storage:done', m));
  storage.on('apps', (m) => broadcast('storage:apps', m));
  storage.on('hogs', (m) => broadcast('storage:hogs', m));
  storage.on('error', (err) => logOften(`storage:${err && err.message}`, 'storage failed:', err));

  server = http.createServer((req, res) => {
    onRequest(req, res).catch((err) => send(res, 500, JSON.stringify({ error: String(err) })));
  });
  server.requestTimeout = 0;

  let reusedPort = false;
  if (restarted && Number(argv.port)) {
    try {
      port = await listenWithRetry(Number(argv.port), 10000);
      reusedPort = true;
    } catch (err) {
      log(`port ${argv.port} is no longer free (${err.code}); opening a new window`);
      port = await listenWithRetry(0, 0);
    }
  } else if (Number(argv.port)) {
    port = await listenWithRetry(Number(argv.port), 0);
  } else {
    // The same port every time it's free, so the window keeps what the browser remembers per
    // address (notification permission, storage). Waits a moment for a closing SysLens to let go.
    const preferred = settings.get('port') || 41000 + crypto.randomInt(8000);
    try {
      port = await listenWithRetry(preferred, 3000);
    } catch {
      port = await listenWithRetry(0, 0);
    }
    if (!ADMIN && port !== settings.get('port')) settings.set({ port });
  }

  if (!DEV) writeInstance();
  notifyLauncher({ type: 'ready', port, token });
  if (SUPERVISED) {
    setInterval(() => notifyLauncher({ type: 'beat' }), 5000);
    process.on('message', (m) => {
      if (m && m.type === 'stop') shutdown('stopped');
    });
    process.on('disconnect', () => log('the launcher went away; carrying on without it'));
  }

  monitor.start();
  windowMode = DEV ? 'none' : shellx.findBrowser() ? 'app' : 'tab';
  const url = appUrl(port, token);
  if (ADMIN && windowMode === 'app') {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    await shellx.lockDownFolder(PROFILE_DIR).catch(() => {});
  }
  if (argv['no-window']) console.log(`SysLens is running at ${url}`);
  // After a crash the old window is still open, and it reconnects by itself.
  else if (!reusedPort) openWindow();
  windowOpenedAt = Date.now();
  lastClientAt = Date.now();
  setInterval(lifecycleTick, LIFECYCLE_TICK);
  setInterval(latencyTick, 5000);
  setInterval(sweepCaches, 60000);
  if (settings.get('startWithWindows') && !DEV) shellx.setAutostart(true).catch(() => {}); // keeps the path current if SysLens moved
  log(`listening on 127.0.0.1:${port}${monitor.admin ? ' as administrator' : ''}`);
}

process.on('SIGINT', () => shutdown('interrupted'));
process.on('SIGTERM', () => shutdown('terminated'));
process.on('uncaughtException', (err) => {
  log('crashed:', err);
  process.exit(1); // the launcher starts a fresh server and the window reconnects to it
});
process.on('unhandledRejection', (err) => logOften(`rejection:${err && err.message}`, 'unhandled promise rejection:', err));
main().catch((err) => {
  log('could not start:', err);
  console.error(err);
  process.exit(1);
});
