'use strict';
// Process sampling via NtQuerySystemInformation(SystemProcessInformation): one syscall returns
// every process with private working set, CPU times, I/O counters, handles and threads.

const fs = require('fs');
const os = require('os');
const path = require('path');
const w = require('./win32');
const { knowledge } = require('./knowledge');

const SYSTEM_PROCESS_INFORMATION = 5;
const SYSTEM_ROOT = process.env.SystemRoot || 'C:\\Windows';
const WINDOWS_DIR = `${SYSTEM_ROOT.toLowerCase()}\\`;
const SYSTEM32 = path.join(SYSTEM_ROOT, 'System32');
const SELF_PROFILE_MARK = '\\syslens\\browser'; // the app window's dedicated browser profile
const EPOCH_DIFF_MS = 11644473600000n;

const SPECIAL = {
  system: { display: 'System', desc: 'NT kernel & system' },
  registry: { display: 'Registry', desc: 'Registry hives held in memory' },
  'memory compression': { display: 'Memory Compression', desc: 'Windows compressed-memory store' },
  'secure system': { display: 'Secure System', desc: 'Virtualization-based security (VBS)' },
  interrupts: { display: 'Interrupts', desc: 'Hardware interrupts' },
};

// Ending these takes Windows down (or is impossible), so SysLens refuses.
const CRITICAL = new Set([
  'system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe',
  'lsass.exe', 'lsaiso.exe', 'memory compression', 'secure system', 'fontdrvhost.exe',
]);

// Helper processes that are better attributed to the app hosting them.
const HOSTED = new Set(['msedgewebview2.exe']);

function processRole(exe, cmd) {
  if (!cmd) return null;
  if (exe === 'svchost.exe') {
    const s = /\s-s\s+(\S+)/.exec(cmd);
    if (s) return `Service: ${s[1]}`;
    const k = /\s-k\s+(\S+)/.exec(cmd);
    return k ? `Service group: ${k[1]}` : null;
  }
  const m = /--type=([\w-]+)/.exec(cmd);
  if (!m) return null;
  const t = m[1];
  if (t === 'renderer') return /--extension-process/.test(cmd) ? 'Extension' : 'Renderer (tab or page)';
  if (t === 'gpu-process') return 'GPU process';
  if (t === 'crashpad-handler') return 'Crash reporter';
  if (t === 'broker') return 'Broker';
  if (t === 'utility') {
    const s = /--utility-sub-type=([\w.]+)/.exec(cmd);
    const sub = s ? s[1] : '';
    if (/NetworkService/i.test(sub)) return 'Network service';
    if (/StorageService/i.test(sub)) return 'Storage service';
    if (/AudioService/i.test(sub)) return 'Audio service';
    if (/VideoCapture/i.test(sub)) return 'Video capture service';
    if (/data_decoder/i.test(sub)) return 'Data decoder';
    if (/on_device_model|optimization_guide/i.test(sub)) return 'On-device AI model';
    if (/unzip|file_util/i.test(sub)) return 'File utility';
    return sub ? `Utility (${sub.split('.')[0]})` : 'Utility';
  }
  return t;
}

function titleCaseExe(name) {
  const base = name.replace(/\.exe$/i, '');
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : name;
}

class ProcessMonitor {
  constructor() {
    this.buf = Buffer.alloc(2 * 1024 * 1024);
    this.ncpu = os.cpus().length || 1;
    this.prev = new Map(); // pid -> previous counters
    this.meta = new Map(); // `${pid}:${createTime}` -> meta
    this.ver = new Map(); // lower-case path -> version info | null
    this.windows = new Map();
    this.windowsAt = 0;
    this.current = new Map(); // pid -> process record (latest sample)
    this.selfPids = new Set([process.pid]); // SysLens's own Node processes (server, launcher)
    this.selfBrowsers = []; // pids of the app window's main browser process (not its helpers)
  }

  queryRaw() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const ret = [0];
      const st = w.api.NtQuerySystemInformation(SYSTEM_PROCESS_INFORMATION, this.buf, this.buf.length, ret) >>> 0;
      if (st === 0) return;
      if (st === w.STATUS_INFO_LENGTH_MISMATCH) {
        this.buf = Buffer.alloc(Math.max(ret[0] + 512 * 1024, this.buf.length * 2));
        continue;
      }
      throw new Error(`NtQuerySystemInformation failed: 0x${st.toString(16)}`);
    }
    throw new Error('NtQuerySystemInformation: buffer kept growing');
  }

  resolveMeta(p) {
    const m = { path: null, cmd: null, access: false, priority: null, guessed: false };
    if (p.pid > 4) {
      const h = w.openProcess(p.pid);
      if (h) {
        m.access = true;
        m.path = w.processImagePath(h);
        m.cmd = w.processCommandLine(h);
        m.priority = w.processPriority(h);
        w.api.CloseHandle(h);
      }
    }
    // Protected Windows processes (dwm, csrss…) can't be opened without admin rights,
    // but they live in System32, which is enough for a name and an icon.
    if (!m.path && /\.exe$/i.test(p.name)) {
      const guess = path.join(SYSTEM32, p.name);
      if (fs.existsSync(guess)) {
        m.path = guess;
        m.guessed = true;
      }
    }
    m.role = processRole(p.name.toLowerCase(), m.cmd);
    return m;
  }

  versionFor(path, budget) {
    if (!path) return null;
    const k = path.toLowerCase();
    if (this.ver.has(k)) return this.ver.get(k);
    if (budget.left <= 0) return undefined; // not resolved yet
    budget.left--;
    const info = w.fileVersionInfo(path);
    this.ver.set(k, info);
    return info;
  }

  /** Take one sample. `gpu` maps pid -> { util, shared, dedicated }. */
  sample(gpu = new Map()) {
    this.queryRaw();
    const now = process.hrtime.bigint();
    const buf = this.buf;
    const base = w.addressOf(buf);
    const list = [];
    const seen = new Set();
    const createTimes = new Map(); // pid -> FILETIME (BigInt), kept out of the IPC payload
    let totalThreads = 0;
    let totalHandles = 0;
    let off = 0;

    if (Date.now() - this.windowsAt > 2000) {
      try {
        this.windows = w.visibleWindows();
      } catch {
        this.windows = new Map();
      }
      this.windowsAt = Date.now();
    }

    for (;;) {
      const next = buf.readUInt32LE(off);
      const pid = Number(buf.readBigUInt64LE(off + 0x50));
      const threads = buf.readUInt32LE(off + 0x04);
      const handles = buf.readUInt32LE(off + 0x60);
      totalThreads += threads;
      totalHandles += handles;
      if (pid !== 0) {
        const nameLen = buf.readUInt16LE(off + 0x38);
        const nameOff = w.ptrOffset(buf.readBigUInt64LE(off + 0x40), base, buf);
        const name = nameOff >= 0 && nameLen ? buf.toString('utf16le', nameOff, nameOff + nameLen) : '';
        const createTime = buf.readBigInt64LE(off + 0x20);
        const cpuTime = Number(buf.readBigInt64LE(off + 0x28) + buf.readBigInt64LE(off + 0x30));
        const ioRead = Number(buf.readBigInt64LE(off + 0xe8));
        const ioWrite = Number(buf.readBigInt64LE(off + 0xf0));
        const ioOther = Number(buf.readBigInt64LE(off + 0xf8));
        const key = `${pid}:${createTime}`;
        const prev = this.prev.get(pid);
        let cpu = 0;
        let rRate = 0;
        let wRate = 0;
        let oRate = 0;
        if (prev && prev.key === key) {
          const dt100ns = Number(now - prev.t) / 100;
          if (dt100ns > 0) {
            cpu = Math.min(100, Math.max(0, ((cpuTime - prev.cpu) / dt100ns / this.ncpu) * 100));
            const sec = dt100ns / 1e7;
            rRate = Math.max(0, (ioRead - prev.r) / sec);
            wRate = Math.max(0, (ioWrite - prev.w) / sec);
            oRate = Math.max(0, (ioOther - prev.o) / sec);
          }
        }
        this.prev.set(pid, { key, cpu: cpuTime, r: ioRead, w: ioWrite, o: ioOther, t: now });
        seen.add(pid);
        createTimes.set(pid, createTime);
        list.push({
          pid,
          ppid: Number(buf.readBigUInt64LE(off + 0x58)),
          name,
          key,
          created: createTime > 0n ? Number(createTime / 10000n - EPOCH_DIFF_MS) : 0,
          session: buf.readUInt32LE(off + 0x64),
          threads,
          handles,
          cpu,
          cpuTime: cpuTime / 1e7,
          priv: Number(buf.readBigUInt64LE(off + 0x08)),
          ws: Number(buf.readBigUInt64LE(off + 0x90)),
          peakWs: Number(buf.readBigUInt64LE(off + 0x88)),
          commit: Number(buf.readBigUInt64LE(off + 0xb8)),
          pagedPool: Number(buf.readBigUInt64LE(off + 0xa0)),
          nonpagedPool: Number(buf.readBigUInt64LE(off + 0xb0)),
          pageFaults: buf.readUInt32LE(off + 0x80),
          ioR: rRate,
          ioW: wRate,
          ioO: oRate,
          io: rRate + wRate + oRate,
          ioTotal: ioRead + ioWrite + ioOther,
        });
      }
      if (!next) break;
      off += next;
    }

    for (const pid of this.prev.keys()) if (!seen.has(pid)) this.prev.delete(pid);
    const alive = new Set(list.map((p) => p.key));
    for (const k of this.meta.keys()) if (!alive.has(k)) this.meta.delete(k);

    // Metadata: path + command line once per process; version info with a per-tick budget
    // (generous on the first sample so names are right from the start).
    const budget = { left: this.sampled ? 40 : 400 };
    this.sampled = true;
    this.current = new Map();
    this.createTimes = createTimes;
    const selfBrowsers = [];
    for (const p of list) {
      let m = this.meta.get(p.key);
      if (!m) {
        m = this.resolveMeta(p);
        this.meta.set(p.key, m);
      }
      const lower = p.name.toLowerCase();
      const special = SPECIAL[lower];
      const kb = knowledge(lower);
      let info = m.info;
      if (info === undefined && m.path) {
        info = this.versionFor(m.path, budget);
        if (info !== undefined) m.info = info;
      }
      p.exe = lower;
      p.path = m.path;
      p.pathGuessed = m.guessed;
      p.role = m.role;
      p.access = m.access;
      p.priority = m.priority;
      p.desc = (info && info.description) || (special && special.desc) || (kb && kb.name) || '';
      p.company = (info && info.company) || (special ? 'Microsoft Corporation' : '');
      p.display = (special && special.display) || (info && info.description) || (kb && kb.name) || titleCaseExe(p.name);
      p.windows = this.windows.get(p.pid) || null;
      p.isWindows = !!special || (m.path ? m.path.toLowerCase().startsWith(WINDOWS_DIR) : false);
      p.critical = CRITICAL.has(lower);
      // SysLens itself: its Node processes and its app window's browser processes.
      const ownBrowser = !!m.cmd && m.cmd.toLowerCase().includes(SELF_PROFILE_MARK);
      p.isSelf = this.selfPids.has(p.pid) || ownBrowser;
      if (ownBrowser && !m.cmd.includes('--type=')) selfBrowsers.push(p.pid);
      const g = gpu.get(p.pid);
      p.gpu = g ? g.util : 0;
      p.gpuShared = g ? g.shared : 0;
      p.gpuDedicated = g ? g.dedicated : 0;
      this.current.set(p.pid, p);
    }
    this.selfBrowsers = selfBrowsers;
    // The headless console host that runs SysLens's Node processes is part of SysLens too.
    for (const pid of this.selfPids) {
      const p = this.current.get(pid);
      const host = p && this.current.get(p.ppid);
      if (host && host.exe === 'conhost.exe' && this.isParent(host.pid, p.pid)) host.isSelf = true;
    }

    for (const p of list) p.group = this.groupKey(p);
    return {
      list,
      groups: this.buildGroups(list),
      totals: { processes: list.length, threads: totalThreads, handles: totalHandles },
    };
  }

  /** Walk up the parent chain (guarding against PID reuse) to find the app hosting a helper. */
  /** True when `parentPid` really is the parent of `childPid` (not a recycled PID). */
  isParent(parentPid, childPid) {
    const pc = this.createTimes.get(parentPid);
    const cc = this.createTimes.get(childPid);
    return pc !== undefined && cc !== undefined && pc <= cc;
  }

  hostOf(p) {
    let cur = p;
    for (let depth = 0; depth < 12; depth++) {
      const parent = this.current.get(cur.ppid);
      if (!parent || !this.isParent(parent.pid, cur.pid)) return null;
      if (!HOSTED.has(parent.exe)) return parent;
      cur = parent;
    }
    return null;
  }

  groupKey(p) {
    if (p.isSelf) return 'syslens';
    if (HOSTED.has(p.exe)) {
      const host = this.hostOf(p);
      p.host = host ? host.display : null;
      return `webview2|${host ? host.exe : 'unknown'}`;
    }
    return p.exe;
  }

  buildGroups(list) {
    const groups = new Map();
    for (const p of list) {
      let g = groups.get(p.group);
      if (!g) {
        g = {
          key: p.group,
          name: p.display,
          exe: p.exe,
          path: p.path,
          company: p.company,
          desc: p.desc,
          host: p.host || null,
          oldest: p.created,
          pids: [],
          count: 0,
          cpu: 0,
          priv: 0,
          ws: 0,
          commit: 0,
          gpu: 0,
          gpuShared: 0,
          gpuDedicated: 0,
          io: 0,
          handles: 0,
          threads: 0,
          windows: [],
          hasWindows: false,
          allWindowsDir: true,
          critical: false,
        };
        groups.set(p.group, g);
      }
      g.pids.push(p.pid);
      g.count++;
      g.cpu += p.cpu;
      g.priv += p.priv;
      g.ws += p.ws;
      g.commit += p.commit;
      g.gpu += p.gpu;
      g.gpuShared += p.gpuShared;
      g.gpuDedicated += p.gpuDedicated;
      g.io += p.io;
      g.handles += p.handles;
      g.threads += p.threads;
      g.critical = g.critical || p.critical;
      if (p.windows) {
        g.hasWindows = true;
        g.windows.push(...p.windows);
      }
      if (!p.isWindows) g.allWindowsDir = false;
      // The oldest process (usually the main one) names the group and provides its icon.
      if (p.created < g.oldest || (!g.path && p.path)) {
        g.oldest = p.created;
        g.name = p.display;
        g.path = p.path || g.path;
        g.company = p.company || g.company;
        g.desc = p.desc || g.desc;
      }
    }
    const out = [];
    for (const g of groups.values()) {
      if (g.key.startsWith('webview2|')) g.name = g.host ? `${g.host} · WebView2` : 'Microsoft Edge WebView2';
      if (g.key === 'syslens') {
        g.name = 'SysLens (this app)';
        g.desc = 'SysLens backend and its window';
      }
      g.gpu = Math.min(100, g.gpu);
      g.cpu = Math.min(100, g.cpu);
      g.type = g.hasWindows ? 'app' : g.allWindowsDir ? 'windows' : 'background';
      g.windows = g.windows.slice(0, 12);
      delete g.oldest;
      delete g.allWindowsDir;
      out.push(g);
    }
    out.sort((a, b) => b.priv - a.priv);
    return out;
  }

  details(pid) {
    const p = this.current.get(pid);
    if (!p) return null;
    const m = this.meta.get(p.key) || {};
    const info = m.info || (m.path ? w.fileVersionInfo(m.path) : null);
    const chain = [];
    let cur = p;
    for (let i = 0; i < 10; i++) {
      const parent = this.current.get(cur.ppid);
      if (!parent || !this.isParent(parent.pid, cur.pid)) break;
      chain.push({ pid: parent.pid, name: parent.name, display: parent.display });
      cur = parent;
    }
    const children = [];
    for (const c of this.current.values()) {
      if (c.ppid === pid && this.isParent(pid, c.pid)) children.push({ pid: c.pid, name: c.name, priv: c.priv, cpu: c.cpu });
    }
    children.sort((a, b) => b.priv - a.priv);
    const kb = knowledge(p.exe);
    return {
      ...p,
      about: kb ? kb.about : null,
      safety: p.critical ? 'critical' : kb ? kb.safety : null,
      cmd: m.cmd,
      version: info ? info.version : '',
      product: info ? info.product : '',
      parents: chain,
      children,
    };
  }

  /** End processes. Each target is { pid, key } so a recycled PID is never killed by mistake. */
  kill(targets) {
    return targets.map(({ pid, key }) => {
      const p = this.current.get(pid);
      if (!p || (key && p.key !== key)) return { pid, ok: false, error: 'Process already exited' };
      if (p.critical || pid <= 4) return { pid, ok: false, error: 'Critical Windows process — ending it would crash Windows' };
      if (pid === process.pid) return { pid, ok: false, error: 'That is SysLens itself' };
      const h = w.openProcess(pid, w.PROCESS_TERMINATE);
      if (!h) return { pid, ok: false, error: w.errorText(w.api.GetLastError()) };
      const ok = w.api.TerminateProcess(h, 1);
      const err = ok ? 0 : w.api.GetLastError();
      w.api.CloseHandle(h);
      return { pid, ok: !!ok, error: ok ? null : w.errorText(err) };
    });
  }
}

module.exports = { ProcessMonitor };
