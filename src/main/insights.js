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

function gb(bytes) {
  const v = bytes / GB;
  if (v < 1) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} GB`;
}

function buildInsights(s) {
  const out = [];
  const { mem, groups, procs } = s;
  const add = (level, title, text, link) => out.push({ level, title, text, link: link || null });

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
    add('warn', `${hog.name} is using ${hog.cpu.toFixed(0)}% CPU`, 'If that is unexpected, check what it is doing or end it from the Processes page.', 'processes');
  }

  const top = groups.find((g) => !NOT_APPS.has(g.exe));
  if (top && top.priv > 0.12 * mem.total && !BROWSERS.has(top.exe)) {
    add('info', `${top.name} is the biggest memory user`, `${gb(top.priv)} across ${top.count} process${top.count === 1 ? '' : 'es'}.`, 'processes');
  }

  out.sort((a, b) => RANK[a.level] - RANK[b.level]);
  return out;
}

module.exports = { buildInsights };
