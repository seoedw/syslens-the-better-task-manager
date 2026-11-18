'use strict';
// Storage service: drives, full folder scans, installed apps and well-known space hogs.
// Heavy work runs in two worker threads so the UI and the process sampler never stall.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Worker } = require('worker_threads');
const { recycleBin } = require('../win32');
const { runPowerShellJson } = require('../powershell');

const APPS_SCRIPT = `
$keys = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
$win32 = @(foreach ($k in $keys) {
  Get-ItemProperty $k | Where-Object { $_.DisplayName -and $_.SystemComponent -ne 1 -and -not $_.ParentKeyName -and -not $_.ReleaseType } | ForEach-Object {
    [pscustomobject]@{ n = [string]$_.DisplayName; v = [string]$_.DisplayVersion; p = [string]$_.Publisher; d = [string]$_.InstallDate;
      l = [string]$_.InstallLocation; s = [int64]$_.EstimatedSize; i = [string]$_.DisplayIcon; k = [string]$_.PSChildName }
  }
})
$store = @(Get-AppxPackage | Where-Object { -not $_.IsFramework -and -not $_.IsResourcePackage -and $_.SignatureKind -ne 'System' } | ForEach-Object {
  [pscustomobject]@{ n = [string]$_.Name; v = [string]$_.Version; p = [string]$_.Publisher; l = [string]$_.InstallLocation; f = [string]$_.PackageFamilyName; k = [string]$_.PackageFullName }
})
[pscustomobject]@{ win32 = $win32; store = $store } | ConvertTo-Json -Depth 3 -Compress
`;

const env = process.env;
const SYSTEM_DRIVE = env.SystemDrive || 'C:';
const WINDIR = env.SystemRoot || 'C:\\Windows';
const LOCAL = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAMING = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const HOME = os.homedir();

// Folders too generic to measure as "an app's install folder".
const GENERIC = new Set(
  [
    `${SYSTEM_DRIVE}\\`,
    WINDIR,
    path.join(WINDIR, 'System32'),
    path.join(WINDIR, 'SysWOW64'),
    path.join(WINDIR, 'Installer'),
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.ProgramData,
    LOCAL,
    ROAMING,
    path.join(LOCAL, 'Programs'),
    HOME,
  ]
    .filter(Boolean)
    .map((p) => p.toLowerCase().replace(/\\+$/, '')),
);

function hogDefinitions() {
  const d = (id, name, category, paths, tip) => ({ id, name, category, paths: paths.filter(Boolean), tip });
  return [
    d('temp', 'Your temporary files', 'Cleanable', [os.tmpdir()], 'Leftovers from installers and apps. Safe to clear with Storage Sense or Disk Cleanup.'),
    d('wintemp', 'Windows temporary files', 'Cleanable', [path.join(WINDIR, 'Temp')], 'Temporary files written by Windows and services.'),
    d('downloads', 'Downloads folder', 'Your files', [path.join(HOME, 'Downloads')], 'Installers and files you downloaded and may no longer need.'),
    d('wu', 'Windows Update downloads', 'Cleanable', [path.join(WINDIR, 'SoftwareDistribution', 'Download')], 'Cached update files. "Cleanup recommendations" in Settings removes them.'),
    d('do', 'Delivery Optimization cache', 'Cleanable', [path.join(WINDIR, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization')], 'Update pieces shared with other PCs. Disk Cleanup can clear it.'),
    d('winold', 'Previous Windows installation', 'Cleanable', [`${SYSTEM_DRIVE}\\Windows.old`], 'Kept after a Windows upgrade so you can roll back. Removed automatically after about 10 days, or via Cleanup recommendations.'),
    d('hiberfil', 'Hibernation file', 'System', [`${SYSTEM_DRIVE}\\hiberfil.sys`], 'Reserved for hibernate and Fast Startup. "powercfg /h off" (as admin) removes it.'),
    d('pagefile', 'Page file', 'System', [`${SYSTEM_DRIVE}\\pagefile.sys`], 'Virtual memory on disk. Windows grows it when RAM is under pressure.'),
    d('swapfile', 'Swap file', 'System', [`${SYSTEM_DRIVE}\\swapfile.sys`], 'Used to page out Store apps when memory is low.'),
    d('dumps', 'Crash dumps & error reports', 'Cleanable', [path.join(LOCAL, 'CrashDumps'), path.join(WINDIR, 'Minidump'), path.join(WINDIR, 'MEMORY.DMP'), path.join(env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'WER')], 'Diagnostics from crashed apps. Safe to delete unless you are debugging a crash.'),
    d('chrome', 'Google Chrome profile & cache', 'Browsers', [path.join(LOCAL, 'Google', 'Chrome', 'User Data')], 'History, cache, extensions and saved data. Clear the cache in Chrome settings to shrink it.'),
    d('edge', 'Microsoft Edge profile & cache', 'Browsers', [path.join(LOCAL, 'Microsoft', 'Edge', 'User Data')], 'History, cache, extensions and saved data.'),
    d('brave', 'Brave profile & cache', 'Browsers', [path.join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data')], 'History, cache, extensions and saved data.'),
    d('firefox', 'Firefox profiles & cache', 'Browsers', [path.join(LOCAL, 'Mozilla', 'Firefox', 'Profiles'), path.join(ROAMING, 'Mozilla', 'Firefox', 'Profiles')], 'History, cache and saved data.'),
    d('npm', 'npm cache', 'Developer', [path.join(LOCAL, 'npm-cache')], '"npm cache clean --force" clears it.'),
    d('yarn', 'Yarn / pnpm caches', 'Developer', [path.join(LOCAL, 'Yarn', 'Cache'), path.join(LOCAL, 'pnpm', 'store'), path.join(LOCAL, 'pnpm-cache')], 'Package caches; they re-download on demand.'),
    d('pip', 'Python pip cache', 'Developer', [path.join(LOCAL, 'pip', 'Cache')], '"pip cache purge" clears it.'),
    d('nuget', 'NuGet packages', 'Developer', [path.join(HOME, '.nuget', 'packages')], '"dotnet nuget locals all --clear" clears it.'),
    d('gradle', 'Gradle & Maven caches', 'Developer', [path.join(HOME, '.gradle'), path.join(HOME, '.m2')], 'Java build caches; they re-download on demand.'),
    d('cargo', 'Rust (cargo/rustup)', 'Developer', [path.join(HOME, '.cargo'), path.join(HOME, '.rustup')], 'Rust toolchains and crates.'),
    d('unity', 'Unity caches', 'Developer', [path.join(LOCAL, 'Unity', 'cache'), path.join(ROAMING, 'Unity', 'Asset Store-5.x')], 'Package and asset-store caches.'),
    d('docker', 'Docker Desktop data', 'Virtual machines', [path.join(LOCAL, 'Docker')], 'Images, containers and volumes. "docker system prune" frees space.'),
    d('wsl', 'WSL Linux disks', 'Virtual machines', findVhdx(), 'Each Linux distro lives in a virtual disk that grows but never shrinks on its own.'),
    d('onedrive', 'OneDrive (stored on this PC)', 'Your files', [env.OneDrive], 'Only files kept on this device count. "Free up space" in OneDrive makes them online-only.'),
    d('steam', 'Steam games', 'Games', [path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam', 'steamapps')], 'Installed Steam games.'),
    d('epic', 'Epic Games', 'Games', [path.join(env.ProgramFiles || 'C:\\Program Files', 'Epic Games')], 'Installed Epic games.'),
    d('xbox', 'Xbox / Microsoft Store games', 'Games', [`${SYSTEM_DRIVE}\\XboxGames`], 'Games installed by the Xbox app.'),
  ].filter((h) => h.paths.length > 0);
}

function findVhdx() {
  const out = [];
  const packages = path.join(LOCAL, 'Packages');
  try {
    for (const name of fs.readdirSync(packages)) {
      const p = path.join(packages, name, 'LocalState', 'ext4.vhdx');
      if (fs.existsSync(p)) out.push(p);
    }
  } catch {
    /* no packages folder */
  }
  try {
    const wsl = path.join(LOCAL, 'wsl');
    for (const name of fs.readdirSync(wsl)) {
      const p = path.join(wsl, name, 'ext4.vhdx');
      if (fs.existsSync(p)) out.push(p);
    }
  } catch {
    /* no new-style WSL folder */
  }
  return out;
}

function friendlyStoreName(name) {
  const base = name.includes('.') ? name.slice(name.indexOf('.') + 1) : name;
  return base
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\./g, ' ')
    .trim();
}

function installDir(app) {
  const candidates = [];
  if (app.l) candidates.push(app.l.replace(/^"|"$/g, ''));
  if (app.i) {
    const icon = app.i.replace(/^"|"$/g, '').replace(/,-?\d+$/, '').replace(/^"|"$/g, '');
    if (/\.(exe|ico|dll)$/i.test(icon)) candidates.push(path.dirname(icon));
  }
  for (const c of candidates) {
    const norm = path.normalize(c).replace(/\\+$/, '');
    if (!norm || !path.isAbsolute(norm)) continue;
    if (GENERIC.has(norm.toLowerCase())) continue;
    if (norm.toLowerCase().startsWith(`${WINDIR.toLowerCase()}\\`)) continue;
    if (norm.split('\\').length < 3) continue;
    return norm;
  }
  return null;
}

function formatInstallDate(d) {
  return /^\d{8}$/.test(d || '') ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
}

class StorageService extends EventEmitter {
  constructor() {
    super();
    this.workers = {};
    this.pending = new Map();
    this.req = 0;
    this.jobId = 0;
    this.scanState = { running: false, id: 0, root: null, summary: null };
    this.apps = { status: 'idle', list: [] };
    this.hogs = { status: 'idle', list: [] };
  }

  worker(kind) {
    if (this.workers[kind]) return this.workers[kind];
    const wk = new Worker(path.join(__dirname, 'worker.js'));
    wk.on('message', (msg) => this.onMessage(kind, msg));
    wk.on('error', (err) => this.emit('error', err));
    wk.on('exit', () => {
      delete this.workers[kind];
      if (kind === 'scan' && this.scanState.running) {
        this.scanState.running = false;
        this.emit('done', { id: this.scanState.id, error: 'Scanner stopped unexpectedly' });
      }
    });
    this.workers[kind] = wk;
    return wk;
  }

  request(kind, msg) {
    const req = ++this.req;
    return new Promise((resolve, reject) => {
      this.pending.set(req, { resolve, reject });
      this.worker(kind).postMessage({ ...msg, req });
    });
  }

  onMessage(kind, msg) {
    if (msg.type === 'reply') {
      const p = this.pending.get(msg.req);
      this.pending.delete(msg.req);
      if (p) (msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.data));
      return;
    }
    if (msg.type === 'progress' && msg.id === this.scanState.id) {
      this.emit('progress', msg);
    } else if (msg.type === 'scanDone' && msg.id === this.scanState.id) {
      this.scanState.running = false;
      this.scanState.summary = msg.summary || null;
      this.emit('done', msg);
    } else if (msg.type === 'measured' || msg.type === 'measureDone') {
      const job = this.measureJobs && this.measureJobs.get(msg.id);
      if (job) job(msg);
    } else if (msg.type === 'error') {
      this.emit('error', new Error(msg.error));
    }
  }

  state() {
    return { scan: this.scanState };
  }

  drives() {
    return this.request('measure', { type: 'drives' });
  }

  startScan(root) {
    const id = ++this.jobId;
    this.scanState = { running: true, id, root, summary: null, started: Date.now() };
    this.worker('scan').postMessage({ type: 'scan', id, root });
    return { id };
  }

  cancelScan() {
    if (this.workers.scan) this.workers.scan.postMessage({ type: 'cancel' });
    this.scanState.running = false;
  }

  children(p) {
    return this.workers.scan ? this.request('scan', { type: 'children', path: p }) : null;
  }

  topFiles() {
    return this.workers.scan ? this.request('scan', { type: 'top' }) : [];
  }

  types() {
    return this.workers.scan ? this.request('scan', { type: 'types' }) : [];
  }

  /** Measure many paths on the measure worker; onItem fires per path. Jobs run one at a time. */
  measureMany(items, onItem) {
    if (!this.measureJobs) this.measureJobs = new Map();
    const run = () =>
      new Promise((resolve) => {
        const id = ++this.jobId;
        this.measureJobs.set(id, (msg) => {
          if (msg.type === 'measured') onItem(msg);
          else {
            this.measureJobs.delete(id);
            resolve();
          }
        });
        this.worker('measure').postMessage({ type: 'measure', id, items });
      });
    this.measureQueue = (this.measureQueue || Promise.resolve()).then(run, run);
    return this.measureQueue;
  }

  async loadHogs(refresh = false) {
    if (this.hogs.status === 'loading' || (this.hogs.status === 'done' && !refresh)) return this.hogs;
    const defs = hogDefinitions();
    const list = defs.map((h) => ({ ...h, bytes: 0, files: 0, exists: false, unreadable: false, pending: true }));
    const rb = recycleBin();
    if (rb) list.unshift({ id: 'recycle', name: 'Recycle Bin', category: 'Cleanable', paths: [], tip: 'Deleted files keep using space until you empty the Recycle Bin.', bytes: rb.bytes, files: rb.items, exists: true, pending: false });
    this.hogs = { status: 'loading', list };
    this.emit('hogs', this.hogs);
    const items = [];
    for (const h of defs) h.paths.forEach((p, i) => items.push({ id: `${h.id}#${i}`, path: p }));
    let lastEmit = 0;
    await this.measureMany(items, (msg) => {
      const [hid] = msg.item.split('#');
      const h = list.find((x) => x.id === hid);
      if (!h) return;
      h.bytes += msg.bytes || 0;
      h.files += msg.files || 0;
      h.exists = h.exists || msg.exists;
      h.unreadable = h.unreadable || !!msg.unreadable;
      h.done = (h.done || 0) + 1;
      h.pending = h.done < h.paths.length;
      if (Date.now() - lastEmit > 300) {
        lastEmit = Date.now();
        this.emit('hogs', this.hogs);
      }
    });
    for (const h of list) h.pending = false;
    this.hogs = { status: 'done', list: list.filter((h) => h.exists), finished: Date.now() };
    this.emit('hogs', this.hogs);
    return this.hogs;
  }

  async loadApps(refresh = false) {
    if (this.apps.status === 'loading' || (this.apps.status === 'done' && !refresh)) return this.apps;
    this.apps = { status: 'loading', list: [] };
    this.emit('apps', this.apps);
    const raw = (await runPowerShellJson(APPS_SCRIPT, 120000)) || { win32: [], store: [] };
    const seen = new Set();
    const list = [];
    for (const a of [].concat(raw.win32 || [])) {
      const key = `${a.n}|${a.v}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        id: `w:${a.k}:${list.length}`,
        name: a.n,
        version: a.v || '',
        publisher: a.p || '',
        installed: formatInstallDate(a.d),
        location: installDir(a),
        estimated: a.s > 0 ? a.s * 1024 : 0,
        measured: null,
        data: null,
        source: 'Desktop app',
      });
    }
    for (const a of [].concat(raw.store || [])) {
      list.push({
        id: `s:${a.k}`,
        name: friendlyStoreName(a.n),
        version: a.v || '',
        publisher: (a.p || '').replace(/^CN=([^,]+).*$/, '$1'),
        installed: null,
        location: a.l || null,
        dataPath: a.f ? path.join(LOCAL, 'Packages', a.f) : null,
        estimated: 0,
        measured: null,
        data: null,
        source: 'Store app',
      });
    }
    this.apps = { status: 'measuring', list };
    this.emit('apps', this.apps);

    // Measure each distinct folder once; apps sharing a folder share the number.
    const byPath = new Map();
    const items = [];
    for (const a of list) {
      for (const [field, p] of [['measured', a.location], ['data', a.dataPath]]) {
        if (!p) continue;
        const k = p.toLowerCase();
        if (!byPath.has(k)) {
          byPath.set(k, []);
          items.push({ id: k, path: p });
        }
        byPath.get(k).push({ app: a, field });
      }
    }
    let lastEmit = 0;
    await this.measureMany(items, (msg) => {
      for (const { app, field } of byPath.get(msg.item) || []) {
        app[field] = msg.exists && !msg.unreadable ? msg.bytes : null;
        if (field === 'measured' && msg.unreadable) app.unreadable = true;
      }
      if (Date.now() - lastEmit > 400) {
        lastEmit = Date.now();
        this.emit('apps', this.apps);
      }
    });
    StorageService.subtractNested(list);
    this.apps = { status: 'done', list, finished: Date.now() };
    this.emit('apps', this.apps);
    return this.apps;
  }

  /**
   * An install folder can contain other apps' folders (Steam's contains every game; some
   * vendors register "C:\Program Files\Adobe" for one product). Subtract the nested apps so
   * each byte is counted once, and flag apps that share one folder.
   */
  static subtractNested(list) {
    const sizeByLoc = new Map();
    const countByLoc = new Map();
    for (const a of list) {
      if (!a.location || a.measured == null) continue;
      const k = a.location.toLowerCase();
      sizeByLoc.set(k, a.measured);
      countByLoc.set(k, (countByLoc.get(k) || 0) + 1);
    }
    const locs = [...sizeByLoc.keys()];
    const exclusive = new Map();
    for (const loc of locs) {
      const nested = locs.filter((o) => o.startsWith(`${loc}\\`));
      const outermost = nested.filter((o) => !nested.some((p) => p !== o && o.startsWith(`${p}\\`)));
      const inner = outermost.reduce((s, o) => s + sizeByLoc.get(o), 0);
      exclusive.set(loc, { bytes: Math.max(0, sizeByLoc.get(loc) - inner), nested: outermost.length });
    }
    for (const a of list) {
      if (!a.location || a.measured == null) continue;
      const k = a.location.toLowerCase();
      const ex = exclusive.get(k);
      if (ex.nested) {
        a.containsOthers = ex.nested;
        a.measured = ex.bytes;
      }
      const shared = countByLoc.get(k) - 1;
      if (shared > 0) a.sharedWith = shared;
    }
  }

  dispose() {
    for (const wk of Object.values(this.workers)) wk.terminate();
    this.workers = {};
  }
}

module.exports = { StorageService };
