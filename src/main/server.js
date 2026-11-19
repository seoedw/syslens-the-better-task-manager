'use strict';
// SysLens backend. Samples the system, serves the UI on 127.0.0.1 behind a per-run token,
// streams live data to it, and opens it in an app window (Edge/Chrome --app mode).
// launcher.js normally starts this and restarts it if it ever crashes or hangs.
//
//   node src/main/launcher.js             normal start (reuses a running instance)
//   node src/main/server.js --no-window   server only; prints the URL instead of opening a window (dev)
//   --debug                               also log to the console (the log file is always written)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Monitor } = require('./monitor');
const { loadSystemInfo } = require('./sysinfo');
const { StorageService } = require('./storage');
const { iconDataUrl } = require('./icons');
const shellx = require('./shell');
const { createLogger, DATA_DIR } = require('./log');
const pkg = require('../../package.json');

function parseArgs(list) {
  const out = {};
  for (const a of list) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));
const RENDERER = path.join(__dirname, '..', 'renderer');
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const INSTANCE_FILE = path.join(DATA_DIR, 'instance.json');
const PROFILE_DIR = path.join(DATA_DIR, 'browser');
const DEV = !!(argv['no-window'] || argv['keep-alive']);
const SUPERVISED = typeof process.send === 'function';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
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
let HANDLERS = {};
const clients = new Map(); // event-stream response -> { page, needsFull, leaving }
let everConnected = false;
let lastClientAt = Date.now();
let lastTickAt = Date.now();
let byeAt = 0;
let windowMode = 'none'; // 'app' (own browser profile, can be watched), 'tab' (default browser), 'none' (dev)
let windowOpenedAt = Date.now();
let shuttingDown = false;

// ---------- helpers ----------
const round = (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v);

function appUrl(p, t) {
  return `http://127.0.0.1:${p}/#t=${t}`;
}

function tokenOk(req) {
  const got = Buffer.from(String(req.headers['x-syslens-token'] || ''));
  const want = Buffer.from(token);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
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

// ---------- compact snapshot stream ----------
// Static per-process/per-app details (names, paths, descriptions) are sent once and again
// only when they change; each tick carries just the numbers. History is sent in full when a
// client connects, then one new point per tick. bridge.js reassembles the full snapshot.
const P_META = ['pid', 'ppid', 'name', 'created', 'session', 'exe', 'path', 'pathGuessed', 'role', 'access', 'priority', 'desc', 'company', 'display', 'isWindows', 'critical', 'group', 'host'];
const P_DYN = ['cpu', 'cpuTime', 'priv', 'ws', 'peakWs', 'commit', 'pagedPool', 'nonpagedPool', 'pageFaults', 'ioR', 'ioW', 'ioO', 'io', 'ioTotal', 'handles', 'threads', 'gpu', 'gpuShared', 'gpuDedicated', 'windows'];
const G_META = ['name', 'exe', 'path', 'company', 'desc', 'host', 'type', 'critical'];
const G_DYN = ['count', 'pids', 'cpu', 'priv', 'ws', 'commit', 'gpu', 'gpuShared', 'gpuDedicated', 'io', 'handles', 'threads', 'windows', 'hasWindows'];
let sentMeta = { procs: new Map(), groups: new Map() };

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

function packSnapshot(s, full) {
  const { procs, groups, hist, ...rest } = s;
  const p = packRows(procs, P_META, P_DYN, sentMeta.procs, full);
  const g = packRows(groups, G_META, G_DYN, sentMeta.groups, full);
  const out = { ...rest, packed: { pf: P_DYN, pm: p.meta, pr: p.rows, gf: G_DYN, gm: g.meta, gr: g.rows } };
  if (full) {
    out.hist = hist;
  } else {
    out.histTail = {};
    for (const [k, arr] of Object.entries(hist)) out.histTail[k] = arr[arr.length - 1];
  }
  return { out, next: { procs: p.next, groups: g.next } };
}

function broadcastSnapshot(s) {
  if (!clients.size) {
    sentMeta = { procs: new Map(), groups: new Map() };
    return;
  }
  const { out, next } = packSnapshot(s, false);
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
function buildHandlers() {
  return {
    snapshot: () => monitor.latest,
    interval: (ms) => {
      if (typeof ms === 'number' && Number.isFinite(ms)) monitor.setInterval(ms);
      return { interval: monitor.interval, paused: monitor.paused };
    },
    'app:visible': (visible) => {
      monitor.setBackground(!visible);
      return true;
    },
    'app:info': () => ({ version: pkg.version, admin: monitor.admin }),
    'app:elevate': () => elevate(),
    'proc:details': (pid) => (Number.isInteger(pid) ? monitor.procs.details(pid) : null),
    'proc:kill': (targets) => {
      if (!Array.isArray(targets)) return [];
      const clean = targets
        .filter((t) => t && Number.isInteger(t.pid))
        .slice(0, 500)
        .map((t) => ({ pid: t.pid, key: typeof t.key === 'string' ? t.key : null }));
      return monitor.procs.kill(clean);
    },
    icon: (p) => (shellx.isSafePath(p) ? iconDataUrl(p) : null),
    'shell:showItem': (p) => shellx.showItem(p),
    'shell:openFolder': (p) => shellx.openFolder(p),
    'shell:settings': (page) => shellx.openSettings(page),
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
    msg = JSON.parse(await readBody(req));
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

/** The elevated instance announces its token here; we pass it to the page and step aside. */
async function handleHandoff(req, res) {
  let msg;
  try {
    msg = JSON.parse(await readBody(req, 4096));
  } catch {
    return send(res, 400, '{}');
  }
  if (!msg || typeof msg.token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(msg.token)) return send(res, 400, '{}');
  send(res, 200, '{"ok":true}');
  broadcast('handoff', { token: msg.token });
  setTimeout(() => shutdown('handed off to the administrator instance'), 250);
}

function serveStatic(pathname, res) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad path', 'text/plain');
  }
  let file;
  if (rel === '/' || rel === '/index.html') file = path.join(RENDERER, 'index.html');
  else if (rel === '/icon.png') file = path.join(ASSETS, 'icon.png');
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
  if (p.startsWith('/api/')) {
    if (!tokenOk(req)) return send(res, 403, '{"error":"Forbidden"}');
    if (p === '/api/ping') return send(res, 200, '{"ok":true}');
    if (p === '/api/events' && req.method === 'GET') return openEvents(req, res);
    if (p === '/api/call' && req.method === 'POST') return handleCall(req, res);
    if (p === '/api/bye' && req.method === 'POST') return handleBye(req, res);
    if (p === '/api/handoff' && req.method === 'POST') return handleHandoff(req, res);
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
  if (shuttingDown || windowMode === 'none' || clients.size) return;
  const idle = now - lastClientAt;
  if (windowMode === 'app') {
    if (byeAt && now - byeAt > BYE_GRACE) return shutdown('the window was closed');
    if (appWindowRunning()) return; // still open: it reconnects, however long that takes
    if (!everConnected && now - windowOpenedAt < STARTUP_GRACE) return;
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
    const info = JSON.parse(fs.readFileSync(INSTANCE_FILE, 'utf8'));
    if (info.pid === process.pid) fs.unlinkSync(INSTANCE_FILE);
  } catch {
    /* no instance file */
  }
  if (server) server.close();
  setTimeout(() => process.exit(0), 300).unref();
}

function writeInstance() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const info = { pid: process.pid, port, started: Date.now(), admin: monitor.admin };
  // An elevated instance's token is never written to disk.
  if (!monitor.admin) info.token = token;
  fs.writeFileSync(INSTANCE_FILE, JSON.stringify(info));
}

async function attachToExisting() {
  let info;
  try {
    info = JSON.parse(fs.readFileSync(INSTANCE_FILE, 'utf8'));
  } catch {
    return false;
  }
  if (!info.port || !info.token) return false;
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/api/ping`, { headers: { 'X-SysLens-Token': info.token }, signal: AbortSignal.timeout(1500) });
    if (!r.ok) return false;
  } catch {
    return false;
  }
  shellx.openAppWindow(appUrl(info.port, info.token), PROFILE_DIR);
  return true;
}

/** Start an elevated copy that takes over this port; the open window reconnects to it. */
function elevate() {
  if (monitor.admin) return { ok: true };
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const args = `"${path.join(__dirname, 'launcher.js')}" --adopt=${port} --parent-token=${token}`;
  const command = `Start-Process -FilePath ${q(process.execPath)} -ArgumentList ${q(args)} -Verb RunAs -WindowStyle Hidden`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true }, (err) => {
      resolve(err ? { ok: false, error: 'Administrator access was not granted.' } : { ok: true, restarting: true });
    });
  });
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

async function main() {
  const restarted = !!argv.restarted;
  if (!restarted && !argv.adopt && !DEV && !argv.new && (await attachToExisting())) {
    log('already running; opened another window on it');
    return process.exit(0);
  }
  log(`starting SysLens ${pkg.version}${restarted ? ' again after a crash' : ''}${argv.adopt ? ' as administrator' : ''}`);

  monitor = new Monitor();
  if (SUPERVISED) monitor.procs.selfPids.add(process.ppid); // the launcher belongs to SysLens too
  storage = new StorageService();
  HANDLERS = buildHandlers();
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
  if (argv.adopt) {
    const target = Number(argv.adopt);
    try {
      await fetch(`http://127.0.0.1:${target}/api/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SysLens-Token': String(argv['parent-token'] || '') },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      /* the old instance may already be gone */
    }
    port = await listenWithRetry(target, 20000);
  } else if (restarted && Number(argv.port)) {
    try {
      port = await listenWithRetry(Number(argv.port), 10000);
      reusedPort = true;
    } catch (err) {
      log(`port ${argv.port} is no longer free (${err.code}); opening a new window`);
      port = await listenWithRetry(0, 0);
    }
  } else {
    port = await listenWithRetry(Number(argv.port) || 0, 0);
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
  if (argv['no-window']) console.log(`SysLens is running at ${url}`);
  // After a crash the old window is still open, and it reconnects by itself.
  else if (!argv.adopt && !reusedPort) shellx.openAppWindow(url, PROFILE_DIR);
  windowOpenedAt = Date.now();
  lastClientAt = Date.now();
  setInterval(lifecycleTick, LIFECYCLE_TICK);
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
