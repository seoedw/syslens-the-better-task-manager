'use strict';
// SysLens backend. Samples the system, serves the UI on 127.0.0.1 behind a per-run token,
// streams live data to it, and opens it in an app window (Edge/Chrome --app mode).
//
//   node src/main/server.js               normal start (reuses a running instance)
//   node src/main/server.js --no-window   print the URL instead of opening a window (dev)
//   --debug                               log to the console

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Monitor } = require('./monitor');
const { loadSystemInfo } = require('./sysinfo');
const { StorageService } = require('./storage');
const { iconDataUrl } = require('./icons');
const shellx = require('./shell');
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
const DATA_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'SysLens');
const INSTANCE_FILE = path.join(DATA_DIR, 'instance.json');
const PROFILE_DIR = path.join(DATA_DIR, 'browser');
const DEV = !!(argv['no-window'] || argv['keep-alive']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const log = (...a) => {
  if (argv.debug || DEV) console.log('[syslens]', ...a);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const token = crypto.randomBytes(24).toString('base64url');
let port = 0;
let server = null;
let monitor = null;
let storage = null;
let HANDLERS = {};
const clients = new Set();
let everConnected = false;
let browserAlive = false;
let idleTimer = null;
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

function broadcast(event, data) {
  if (!clients.size) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data, round)}\n\n`;
  for (const res of clients) res.write(payload);
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
  broadcast('snapshot', out);
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
    log('call failed', channel, err);
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
  if (monitor.latest) res.write(`event: snapshot\ndata: ${JSON.stringify(packSnapshot(monitor.latest, true).out, round)}\n\n`);
  clients.add(res);
  clientsChanged();
  const keepAlive = setInterval(() => res.write(': ka\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
    clientsChanged();
  });
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
    if (p === '/api/handoff' && req.method === 'POST') return handleHandoff(req, res);
    return send(res, 404, '{"error":"Not found"}');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
  return serveStatic(p, res);
}

// ---------- lifecycle ----------
function clientsChanged() {
  monitor.setBackground(clients.size === 0);
  if (clients.size) {
    everConnected = true;
    clearTimeout(idleTimer);
    idleTimer = null;
    return;
  }
  if (DEV || shuttingDown) return;
  clearTimeout(idleTimer);
  // A reload reconnects within a second; a closed window never does.
  idleTimer = setTimeout(() => {
    if (!clients.size) shutdown('window closed');
  }, browserAlive ? 45000 : 8000);
}

function watchBrowser(child) {
  if (!child) return;
  browserAlive = true;
  child.on('exit', () => {
    browserAlive = false;
    setTimeout(() => {
      if (!clients.size && !DEV) shutdown('window closed');
    }, everConnected ? 2500 : 20000);
  });
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
  for (const res of clients) {
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
  const args = `"${path.join(__dirname, 'server.js')}" --adopt=${port} --parent-token=${token}`;
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
  if (!argv.adopt && !DEV && !argv.new && (await attachToExisting())) {
    log('opened a window on the running instance');
    return process.exit(0);
  }

  monitor = new Monitor();
  storage = new StorageService();
  HANDLERS = buildHandlers();
  loadSystemInfo((info) => monitor.setSystemInfo(info)).catch(() => {});
  monitor.on('snapshot', (s) => broadcastSnapshot(s));
  monitor.on('error', (err) => log('monitor error', err));
  storage.on('progress', (m) => broadcast('storage:progress', m));
  storage.on('done', (m) => broadcast('storage:done', m));
  storage.on('apps', (m) => broadcast('storage:apps', m));
  storage.on('hogs', (m) => broadcast('storage:hogs', m));
  storage.on('error', (err) => log('storage error', err));

  server = http.createServer((req, res) => {
    onRequest(req, res).catch((err) => send(res, 500, JSON.stringify({ error: String(err) })));
  });
  server.requestTimeout = 0;

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
  } else {
    port = await listenWithRetry(Number(argv.port) || 0, 0);
  }

  writeInstance();
  monitor.start();
  const url = appUrl(port, token);
  if (argv['no-window']) console.log(`SysLens is running at ${url}`);
  else if (!argv.adopt) watchBrowser(shellx.openAppWindow(url, PROFILE_DIR));
  log(`listening on 127.0.0.1:${port}${monitor.admin ? ' (administrator)' : ''}`);

  if (!DEV) {
    setTimeout(() => {
      if (!everConnected) shutdown('no window ever connected');
    }, 90000).unref();
  }
}

process.on('SIGINT', () => shutdown('interrupted'));
process.on('SIGTERM', () => shutdown('terminated'));
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
