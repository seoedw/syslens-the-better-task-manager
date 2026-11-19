'use strict';
// Plain-language findings about what is going on, ordered most important first.

const GB = 1024 ** 3;
const BROWSERS = new Map([
  ['chrome.exe', 'Chrome'],
  ['msedge.exe', 'Edge'],
  ['brave.exe', 'Brave'],
  ['firefox.exe', 'Firefox'],
  ['opera.exe', 'Opera'],
  ['vivaldi.exe', 'Vivaldi'],
  ['arc.exe', 'Arc'],
]);
const RANK = { bad: 0, warn: 1, info: 2 };
// Windows bookkeeping, not apps: never call these "the biggest app".
const NOT_APPS = new Set(['memory compression', 'system', 'registry', 'secure system']);

const MB = 1024 ** 2;

function gb(bytes) {
  const v = bytes / GB;
  if (v < 1) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} GB`;
}

/**
 * Memory of each sizeable app every 15 s for the last 10 minutes, to spot one that keeps
 * growing: the usual sign of a leak. About 150 apps x 41 numbers, so it costs next to nothing.
 */
class Trends {
  constructor() {
    this.at = 0;
    this.series = new Map(); // group key -> [priv…]
    this.names = new Map();
  }

  update(groups, now = Date.now()) {
    if (now - this.at < 15000) return;
    this.at = now;
    const live = new Set();
    for (const g of groups) {
      if (g.priv < 150 * MB || g.key === 'syslens' || NOT_APPS.has(g.exe)) continue;
      live.add(g.key);
      let s = this.series.get(g.key);
      if (!s) this.series.set(g.key, (s = []));
      s.push(g.priv);
      if (s.length > 41) s.shift();
      this.names.set(g.key, g.name);
    }
    for (const k of this.series.keys()) {
      if (!live.has(k)) {
        this.series.delete(k);
        this.names.delete(k);
      }
    }
  }

  /** Apps that grew a lot, almost without pause, over at least five minutes. */
  growing() {
    const out = [];
    for (const [key, s] of this.series) {
      if (s.length < 21) continue;
      const grew = s[s.length - 1] - s[0];
      let steady = 0;
      for (let i = 1; i < s.length; i++) if (s[i] >= s[i - 1] - 2 * MB) steady++;
      if (grew > 400 * MB && grew > s[0] * 0.3 && steady / (s.length - 1) > 0.85) {
        out.push({ key, name: this.names.get(key), grew, minutes: Math.round(((s.length - 1) * 15) / 60), now: s[s.length - 1] });
      }
    }
    return out.sort((a, b) => b.grew - a.grew);
  }
}

function buildInsights(s, extra = {}) {
  const out = [];
  const { mem, groups, procs } = s;
  const add = (level, title, text, link, extraFields) => out.push({ level, title, text, link: link || null, ...extraFields });

  // ---- disks ----
  for (const v of extra.volumes || []) {
    if (!v.total) continue;
    const share = v.free / v.total;
    const drive = v.root.slice(0, 2);
    if (share < 0.05 || v.free < 5 * GB) {
      add('bad', `Drive ${drive} is almost full`, `Only ${gb(v.free)} of ${gb(v.total)} is free. Windows needs free space for updates, the page file and temporary files; when it runs out, apps fail to save and updates fail.`, 'storage');
    } else if (share < 0.1 || v.free < 15 * GB) {
      add('warn', `Drive ${drive} is running low on space`, `${gb(v.free)} of ${gb(v.total)} is free. The Storage page shows what is taking the space.`, 'storage');
    }
  }

  // ---- heat and battery ----
  const throttled = (s.temps || []).find((t) => t.limit != null && t.limit < 100);
  const hot = (s.temps || []).find((t) => t.c >= 90);
  if (throttled) {
    add('warn', 'Your PC is slowing itself down to cool off', `Windows is holding the processor to ${throttled.limit.toFixed(0)}% of its speed (${throttled.c.toFixed(0)} °C). Check the vents aren’t blocked, and close heavy apps.`, 'performance');
  } else if (hot) {
    add('warn', `The processor is at ${hot.c.toFixed(0)} °C`, 'That is hot. Sustained heat makes the processor slow down and shortens battery life; make sure the vents are clear.', 'performance');
  }
  const b = s.battery;
  if (b && b.hasBattery && b.percent != null && !b.ac) {
    if (b.percent <= 10) add('bad', `Battery is at ${b.percent}%`, 'Plug in soon: Windows will hibernate or shut down when it runs out.', 'performance');
    else if (b.percent <= 20) add('warn', `Battery is at ${b.percent}%`, `About ${b.secondsLeft ? `${Math.round(b.secondsLeft / 60)} minutes` : 'a little while'} left at this rate.`, 'performance');
  }

  // ---- apps that keep growing ----
  for (const g of (extra.trends && extra.trends.growing()) || []) {
    const browser = BROWSERS.has((groups.find((x) => x.key === g.key) || {}).exe);
    add(browser ? 'info' : 'warn', `${g.name} keeps using more memory`, `It grew by ${gb(g.grew)} in the last ${g.minutes} minutes (now ${gb(g.now)}) and hasn’t let go. ${browser ? 'New tabs do this; if you haven’t opened any, a page may be leaking.' : 'That pattern usually means a memory leak; restarting the app gives it back.'}`, 'processes', { group: g.key });
  }

  const availPct = mem.available / mem.total;
  if (availPct < 0.08) {
    add('bad', 'Memory is almost full', `Only ${gb(mem.available)} is available. Windows is compressing memory and moving data to the page file on disk, which makes everything slower.`, 'memory');
  } else if (availPct < 0.18) {
    add('warn', 'Memory is getting tight', `${gb(mem.available)} of ${gb(mem.total)} is available. Closing the largest apps below gives the most back.`, 'memory');
  }

  if (mem.commitLimit > 0 && mem.committed / mem.commitLimit > 0.85) {
    add('warn', 'Commit charge is close to its limit', `${gb(mem.committed)} of ${gb(mem.commitLimit)} is committed (RAM + page file). If it reaches the limit, apps can fail with "out of memory" errors.`, 'memory');
  }

  const browsers = groups.filter((g) => BROWSERS.has(g.exe));
  const browserBytes = browsers.reduce((sum, g) => sum + g.priv, 0);
  const browserProcs = browsers.reduce((sum, g) => sum + g.count, 0);
  if (browsers.length >= 2) {
    const names = browsers.map((g) => BROWSERS.get(g.exe)).join(' and ');
    add('warn', `${browsers.length} browsers are open at once`, `${names} use ${gb(browserBytes)} together across ${browserProcs} processes. Sticking to one browser frees the most memory.`, 'processes');
  } else if (browserBytes > 3 * GB) {
    add('info', `${BROWSERS.get(browsers[0].exe)} is using ${gb(browserBytes)}`, `Each tab, extension and helper runs in its own process (${browserProcs} right now). Closing tabs you are not using frees memory.`, 'processes');
  }

  if (mem.nonpaged > 1 * GB) {
    add('warn', 'Driver memory is unusually high', `The kernel non-paged pool is ${gb(mem.nonpaged)} (normal is 0.2–0.5 GB). This usually means a driver is leaking memory — VPN, network, antivirus and RGB/peripheral drivers are the usual suspects. A restart clears it; if it climbs back, update or remove the driver.`, 'memory');
  }

  const days = s.uptime / 86400000;
  if (days >= 3) {
    add('info', `No restart for ${Math.floor(days)} days`, 'Memory held by drivers and Windows itself tends to creep up over time. A restart resets it.');
  }

  if (mem.compression > 1 * GB) {
    add('info', `${gb(mem.compression)} of memory is compressed`, 'When RAM fills up, Windows compresses memory instead of writing it to disk. It is a sign of memory pressure, not a separate problem.', 'memory');
  }

  const gpuShared = mem.parts.find((p) => p.key === 'gpu');
  if (gpuShared && gpuShared.bytes > 1.5 * GB) {
    add('info', `Graphics is borrowing ${gb(gpuShared.bytes)} of RAM`, 'Your GPU stores textures and video frames in system memory. Games, video playback and hardware-accelerated browser tabs use this; it never shows up as a process in Task Manager.', 'memory');
  }

  if (mem.hardwareReserved > 384 * 1024 ** 2) {
    add('info', `${gb(mem.hardwareReserved)} is reserved by hardware`, 'Usually set aside for the integrated GPU in the BIOS/UEFI. Windows cannot use it for anything else.', 'memory');
  }

  for (const p of procs) {
    if (p.handles > 25000 && p.exe !== 'system') {
      add('warn', `${p.display} holds ${p.handles.toLocaleString()} handles`, 'That many open handles often points to a leak in the app. Restarting it frees them.', 'processes');
    }
  }

  const node = groups.find((g) => g.exe === 'node.exe');
  if (node && node.count >= 5 && node.priv > 300 * 1024 ** 2) {
    add('info', `${node.count} Node.js processes are running`, `They use ${gb(node.priv)} together — probably dev servers or tools left running. Close their terminals if you are not using them.`, 'processes');
  }

  const hog = groups.find((g) => g.cpu > 40 && !NOT_APPS.has(g.exe));
  if (hog) {
    add('warn', `${hog.name} is using ${hog.cpu.toFixed(0)}% CPU`, 'If that is unexpected, check what it is doing or end it from the Processes page.', 'processes', { group: hog.key });
  }

  const top = groups.find((g) => !NOT_APPS.has(g.exe));
  if (top && top.priv > 0.12 * mem.total && !BROWSERS.has(top.exe)) {
    add('info', `${top.name} is the biggest memory user`, `${gb(top.priv)} across ${top.count} process${top.count === 1 ? '' : 'es'}.`, 'processes', { group: top.key });
  }

  const paused = groups.filter((g) => g.suspended && g.type !== 'windows' && g.count > 0);
  if (paused.length >= 1 && paused.some((g) => g.priv > 200 * MB)) {
    const big = paused.filter((g) => g.priv > 200 * MB);
    add('info', `${big.map((g) => g.name).slice(0, 2).join(' and ')} ${big.length === 1 ? 'is' : 'are'} paused but holding ${gb(big.reduce((n, g) => n + g.priv, 0))}`, 'Suspended apps use no processor time but keep their memory. End them if you’re not coming back to them.', 'processes', { group: big[0].key });
  }

  out.sort((a, b) => RANK[a.level] - RANK[b.level]);
  return out;
}

module.exports = { buildInsights, Trends };
