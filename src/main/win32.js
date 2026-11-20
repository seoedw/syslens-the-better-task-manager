'use strict';
// Thin bindings to the Win32 / NT APIs SysLens needs, via koffi (no native build step).
// Every struct is read from a plain Node Buffer at documented x64 offsets.

const koffi = require('koffi');

const kernel32 = koffi.load('kernel32.dll');
const ntdll = koffi.load('ntdll.dll');
const pdh = koffi.load('pdh.dll');
const version = koffi.load('version.dll');
const shell32 = koffi.load('shell32.dll');
const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const advapi32 = koffi.load('advapi32.dll');
const iphlpapi = koffi.load('iphlpapi.dll');
const wtsapi32 = koffi.load('wtsapi32.dll');

koffi.proto('int __stdcall WNDENUMPROC(intptr_t hwnd, intptr_t lparam)');

const api = {
  // ntdll
  NtQuerySystemInformation: ntdll.func('int32 __stdcall NtQuerySystemInformation(int32 cls, void *buf, uint32 len, _Out_ uint32 *ret)'),
  NtQueryInformationProcess: ntdll.func('int32 __stdcall NtQueryInformationProcess(intptr_t h, int32 cls, void *buf, uint32 len, _Out_ uint32 *ret)'),

  // kernel32: processes
  OpenProcess: kernel32.func('intptr_t __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)'),
  CloseHandle: kernel32.func('int __stdcall CloseHandle(intptr_t h)'),
  CreateFileW: kernel32.func('intptr_t __stdcall CreateFileW(const char16_t *name, uint32 access, uint32 share, void *sa, uint32 disposition, uint32 flags, intptr_t template)'),
  GetCompressedFileSizeW: kernel32.func('uint32 __stdcall GetCompressedFileSizeW(const char16_t *name, _Out_ uint32 *high)'),
  QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(intptr_t h, uint32 flags, void *buf, _Inout_ uint32 *size)'),
  TerminateProcess: kernel32.func('int __stdcall TerminateProcess(intptr_t h, uint32 code)'),
  GetPriorityClass: kernel32.func('uint32 __stdcall GetPriorityClass(intptr_t h)'),
  GetLastError: kernel32.func('uint32 __stdcall GetLastError()'),
  IsWow64Process2: kernel32.func('int __stdcall IsWow64Process2(intptr_t h, _Out_ uint16 *processMachine, _Out_ uint16 *nativeMachine)'),
  GetSystemPowerStatus: kernel32.func('int __stdcall GetSystemPowerStatus(void *status)'),
  SetPriorityClass: kernel32.func('int __stdcall SetPriorityClass(intptr_t h, uint32 cls)'),
  SetProcessInformation: kernel32.func('int __stdcall SetProcessInformation(intptr_t h, int cls, void *info, uint32 size)'),
  NtSuspendProcess: ntdll.func('int32 __stdcall NtSuspendProcess(intptr_t h)'),
  NtResumeProcess: ntdll.func('int32 __stdcall NtResumeProcess(intptr_t h)'),

  // user32: bringing the SysLens window forward, keeping it on top
  ShowWindow: user32.func('int __stdcall ShowWindow(intptr_t hwnd, int cmd)'),
  IsIconic: user32.func('int __stdcall IsIconic(intptr_t hwnd)'),
  SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(intptr_t hwnd)'),
  SetWindowPos: user32.func('int __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32 flags)'),
  keybd_event: user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr_t extra)'),
  PostMessageW: user32.func('int __stdcall PostMessageW(intptr_t hwnd, uint32 msg, uintptr_t wparam, intptr_t lparam)'),
  LockWorkStation: user32.func('int __stdcall LockWorkStation()'),
  IsZoomed: user32.func('int __stdcall IsZoomed(intptr_t hwnd)'),
  SetThreadDpiAwarenessContext: user32.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t ctx)'),
  GetDpiForSystem: user32.func('uint32 __stdcall GetDpiForSystem()'),
  GetWindowRect: user32.func('int __stdcall GetWindowRect(intptr_t hwnd, _Out_ void *rect)'),
  MonitorFromPoint: user32.func('intptr_t __stdcall MonitorFromPoint(int64 pt, uint32 flags)'),
  GetMonitorInfoW: user32.func('int __stdcall GetMonitorInfoW(intptr_t monitor, _Inout_ void *info)'),

  // wtsapi32: signed-in sessions (Task Manager's Users tab)
  WTSEnumerateSessionsW: wtsapi32.func('int __stdcall WTSEnumerateSessionsW(intptr_t server, uint32 reserved, uint32 version, _Out_ void **info, _Out_ uint32 *count)'),
  WTSQuerySessionInformationW: wtsapi32.func('int __stdcall WTSQuerySessionInformationW(intptr_t server, uint32 session, int infoClass, _Out_ void **buf, _Out_ uint32 *bytes)'),
  WTSFreeMemory: wtsapi32.func('void __stdcall WTSFreeMemory(void *mem)'),
  WTSDisconnectSession: wtsapi32.func('int __stdcall WTSDisconnectSession(intptr_t server, uint32 session, int wait)'),
  WTSLogoffSession: wtsapi32.func('int __stdcall WTSLogoffSession(intptr_t server, uint32 session, int wait)'),

  // advapi32: process tokens
  OpenProcessToken: advapi32.func('int __stdcall OpenProcessToken(intptr_t h, uint32 access, _Out_ intptr_t *token)'),
  GetTokenInformation: advapi32.func('int __stdcall GetTokenInformation(intptr_t token, int cls, void *buf, uint32 len, _Out_ uint32 *ret)'),
  LookupAccountSidW: advapi32.func('int __stdcall LookupAccountSidW(const char16_t *system, intptr_t sid, void *name, _Inout_ uint32 *nameLen, void *domain, _Inout_ uint32 *domainLen, _Out_ int *use)'),

  // iphlpapi: TCP/UDP endpoints with their owning process
  GetExtendedTcpTable: iphlpapi.func('uint32 __stdcall GetExtendedTcpTable(void *table, _Inout_ uint32 *size, int order, uint32 af, int cls, uint32 reserved)'),
  GetExtendedUdpTable: iphlpapi.func('uint32 __stdcall GetExtendedUdpTable(void *table, _Inout_ uint32 *size, int order, uint32 af, int cls, uint32 reserved)'),

  // kernel32: memory / system
  GlobalMemoryStatusEx: kernel32.func('int __stdcall GlobalMemoryStatusEx(void *buf)'),
  GetPhysicallyInstalledSystemMemory: kernel32.func('int __stdcall GetPhysicallyInstalledSystemMemory(_Out_ uint64 *kb)'),
  K32GetPerformanceInfo: kernel32.func('int __stdcall K32GetPerformanceInfo(void *buf, uint32 cb)'),
  GetTickCount64: kernel32.func('uint64 __stdcall GetTickCount64()'),

  // kernel32: storage
  GetLogicalDrives: kernel32.func('uint32 __stdcall GetLogicalDrives()'),
  GetDriveTypeW: kernel32.func('uint32 __stdcall GetDriveTypeW(const char16_t *root)'),
  GetDiskFreeSpaceExW: kernel32.func('int __stdcall GetDiskFreeSpaceExW(const char16_t *dir, _Out_ uint64 *availToCaller, _Out_ uint64 *total, _Out_ uint64 *totalFree)'),
  GetVolumeInformationW: kernel32.func('int __stdcall GetVolumeInformationW(const char16_t *root, void *name, uint32 nameLen, _Out_ uint32 *serial, _Out_ uint32 *maxComp, _Out_ uint32 *flags, void *fs, uint32 fsLen)'),
  FindFirstFileExW: kernel32.func('intptr_t __stdcall FindFirstFileExW(const char16_t *name, int level, void *data, int op, void *filter, uint32 flags)'),
  FindNextFileW: kernel32.func('int __stdcall FindNextFileW(intptr_t h, void *data)'),
  FindClose: kernel32.func('int __stdcall FindClose(intptr_t h)'),

  // version.dll
  GetFileVersionInfoSizeW: version.func('uint32 __stdcall GetFileVersionInfoSizeW(const char16_t *file, void *handle)'),
  GetFileVersionInfoW: version.func('int __stdcall GetFileVersionInfoW(const char16_t *file, uint32 handle, uint32 len, void *data)'),
  VerQueryValueW: version.func('int __stdcall VerQueryValueW(void *block, const char16_t *sub, _Out_ uintptr_t *ptr, _Out_ uint32 *len)'),

  // shell32
  SHQueryRecycleBinW: shell32.func('int32 __stdcall SHQueryRecycleBinW(const char16_t *root, void *info)'),
  IsUserAnAdmin: shell32.func('int __stdcall IsUserAnAdmin()'),

  // user32 / dwm
  EnumWindows: user32.func('int __stdcall EnumWindows(WNDENUMPROC *cb, intptr_t lparam)'),
  GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32 *pid)'),
  IsWindowVisible: user32.func('int __stdcall IsWindowVisible(intptr_t hwnd)'),
  GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32 cmd)'),
  GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, void *buf, int max)'),
  DwmGetWindowAttribute: dwmapi.func('int32 __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, _Out_ uint32 *val, uint32 cb)'),

  // pdh
  PdhOpenQueryW: pdh.func('uint32 __stdcall PdhOpenQueryW(const char16_t *src, uintptr_t user, _Out_ intptr_t *query)'),
  PdhAddEnglishCounterW: pdh.func('uint32 __stdcall PdhAddEnglishCounterW(intptr_t query, const char16_t *path, uintptr_t user, _Out_ intptr_t *counter)'),
  PdhCollectQueryData: pdh.func('uint32 __stdcall PdhCollectQueryData(intptr_t query)'),
  PdhGetFormattedCounterValue: pdh.func('uint32 __stdcall PdhGetFormattedCounterValue(intptr_t counter, uint32 fmt, void *type, void *value)'),
  PdhGetFormattedCounterArrayW: pdh.func('uint32 __stdcall PdhGetFormattedCounterArrayW(intptr_t counter, uint32 fmt, _Inout_ uint32 *size, _Out_ uint32 *count, void *items)'),
  PdhCloseQuery: pdh.func('uint32 __stdcall PdhCloseQuery(intptr_t query)'),
};

const STATUS_INFO_LENGTH_MISMATCH = 0xC0000004;
const STATUS_BUFFER_OVERFLOW = 0x80000005;
const STATUS_BUFFER_TOO_SMALL = 0xC0000023;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

/** Address of a Buffer's first byte, as a BigInt. */
function addressOf(buf) {
  return BigInt(koffi.address(buf));
}

/** Read a NUL-terminated UTF-16 string starting at byte offset `off`. */
function readWStr(buf, off, maxBytes = buf.length - off) {
  const end = Math.min(buf.length - 1, off + maxBytes);
  let i = off;
  while (i < end && (buf[i] !== 0 || buf[i + 1] !== 0)) i += 2;
  return buf.toString('utf16le', off, i);
}

/** Convert a pointer that points inside `buf` into an offset (or -1). */
function ptrOffset(ptr, base, buf) {
  if (!ptr) return -1;
  const off = Number(BigInt(ptr) - base);
  return off >= 0 && off < buf.length ? off : -1;
}

function openProcess(pid, access = PROCESS_QUERY_LIMITED_INFORMATION) {
  const h = api.OpenProcess(access, 0, pid);
  return h ? h : 0;
}

const pathBuf = Buffer.alloc(32768 * 2);
function processImagePath(h) {
  const size = [32767];
  if (!api.QueryFullProcessImageNameW(h, 0, pathBuf, size)) return null;
  return pathBuf.toString('utf16le', 0, size[0] * 2);
}

/** Full command line via NtQueryInformationProcess(ProcessCommandLineInformation = 60). */
function processCommandLine(h) {
  let size = 4096;
  for (let attempt = 0; attempt < 4; attempt++) {
    const buf = Buffer.alloc(size);
    const ret = [0];
    const st = api.NtQueryInformationProcess(h, 60, buf, size, ret) >>> 0;
    if (st === 0) {
      const len = buf.readUInt16LE(0);
      const off = ptrOffset(buf.readBigUInt64LE(8), addressOf(buf), buf);
      if (!len || off < 0) return '';
      return buf.toString('utf16le', off, off + len);
    }
    if (st === STATUS_INFO_LENGTH_MISMATCH || st === STATUS_BUFFER_OVERFLOW || st === STATUS_BUFFER_TOO_SMALL) {
      size = Math.max(ret[0] + 64, size * 2);
      continue;
    }
    return null;
  }
  return null;
}

const PRIORITY = { 0x40: 'Low', 0x4000: 'Below normal', 0x20: 'Normal', 0x8000: 'Above normal', 0x80: 'High', 0x100: 'Realtime' };
function processPriority(h) {
  return PRIORITY[api.GetPriorityClass(h)] || null;
}

function hex4(n) {
  return n.toString(16).padStart(4, '0').toUpperCase();
}

/** FileDescription / CompanyName / ProductName / FileVersion from a PE's version resource. */
function fileVersionInfo(path) {
  try {
    const size = api.GetFileVersionInfoSizeW(path, null);
    if (!size) return null;
    const data = Buffer.alloc(size);
    if (!api.GetFileVersionInfoW(path, 0, size, data)) return null;
    const base = addressOf(data);
    const p = [0];
    const l = [0];
    const langs = [];
    if (api.VerQueryValueW(data, '\\VarFileInfo\\Translation', p, l) && l[0] >= 4) {
      const off = ptrOffset(p[0], base, data);
      if (off >= 0) {
        for (let i = 0; i + 4 <= l[0] && off + i + 4 <= data.length; i += 4) {
          langs.push(hex4(data.readUInt16LE(off + i)) + hex4(data.readUInt16LE(off + i + 2)));
        }
      }
    }
    langs.push('040904B0', '040904E4', '04090000', '000004B0');
    const query = (key) => {
      for (const lc of langs) {
        if (api.VerQueryValueW(data, `\\StringFileInfo\\${lc}\\${key}`, p, l) && l[0] > 0) {
          const off = ptrOffset(p[0], base, data);
          if (off < 0) continue;
          const s = readWStr(data, off, l[0] * 2).trim();
          if (s) return s;
        }
      }
      return '';
    };
    return {
      description: query('FileDescription'),
      company: query('CompanyName'),
      product: query('ProductName'),
      version: query('FileVersion') || query('ProductVersion'),
    };
  } catch {
    return null;
  }
}

function memoryStatus() {
  const b = Buffer.alloc(64);
  b.writeUInt32LE(64, 0);
  api.GlobalMemoryStatusEx(b);
  return {
    load: b.readUInt32LE(4),
    totalPhys: Number(b.readBigUInt64LE(8)),
    availPhys: Number(b.readBigUInt64LE(16)),
    totalPageFile: Number(b.readBigUInt64LE(24)),
    availPageFile: Number(b.readBigUInt64LE(32)),
  };
}

function performanceInfo() {
  const b = Buffer.alloc(104);
  b.writeUInt32LE(104, 0);
  if (!api.K32GetPerformanceInfo(b, 104)) return null;
  const page = Number(b.readBigUInt64LE(80));
  const pages = (o) => Number(b.readBigUInt64LE(o)) * page;
  return {
    commitTotal: pages(8),
    commitLimit: pages(16),
    commitPeak: pages(24),
    physicalTotal: pages(32),
    physicalAvailable: pages(40),
    systemCache: pages(48),
    kernelTotal: pages(56),
    kernelPaged: pages(64),
    kernelNonpaged: pages(72),
    pageSize: page,
    handleCount: b.readUInt32LE(88),
    processCount: b.readUInt32LE(92),
    threadCount: b.readUInt32LE(96),
  };
}

function installedMemory() {
  const kb = [0];
  if (!api.GetPhysicallyInstalledSystemMemory(kb)) return 0;
  return Number(kb[0]) * 1024;
}

/**
 * How protected a folder is for this account:
 *   'locked'    only administrators can open it (or not even them)
 *   'protected' it opens, but only administrators can add or change what's in it
 *   'open'      yours to change
 * Asks Windows to open the folder for listing, then for adding a file, and closes each handle
 * straight away: nothing is written. null when it can't be told (gone, in use, not a folder).
 */
function folderAccess(dir) {
  const tryOpen = (access) => {
    // FILE_FLAG_BACKUP_SEMANTICS is what lets CreateFile open a folder. It bypasses permissions
    // only for a process that has turned on its backup privilege, which SysLens never does.
    const h = api.CreateFileW(dir, access, 7 /* share read, write, delete */, null, 3 /* OPEN_EXISTING */, 0x02000000, 0);
    if (Number(h) === -1) return api.GetLastError();
    api.CloseHandle(h);
    return 0;
  };
  const list = tryOpen(0x0001 /* FILE_LIST_DIRECTORY */);
  if (list === 5 /* ERROR_ACCESS_DENIED */) return 'locked';
  if (list !== 0) return null;
  const add = tryOpen(0x0002 /* FILE_ADD_FILE */);
  if (add === 5) return 'protected';
  return add === 0 ? 'open' : null;
}

function recycleBin() {
  for (const cb of [24, 20]) {
    const b = Buffer.alloc(24);
    b.writeUInt32LE(cb, 0);
    const hr = api.SHQueryRecycleBinW(null, b);
    if (hr === 0) {
      const off = cb === 24 ? 8 : 4;
      return { bytes: Number(b.readBigInt64LE(off)), items: Number(b.readBigInt64LE(off + 8)) };
    }
  }
  return null;
}

/** Top-level, visible, uncloaked windows with a title, grouped by owning PID. */
function visibleWindows() {
  const out = new Map();
  const pid = [0];
  const cloaked = [0];
  const tbuf = Buffer.alloc(1024);
  api.EnumWindows((hwnd) => {
    try {
      if (!api.IsWindowVisible(hwnd)) return 1;
      if (api.GetWindow(hwnd, 4 /* GW_OWNER */)) return 1;
      const n = api.GetWindowTextW(hwnd, tbuf, 500);
      if (n <= 0) return 1;
      if (api.DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, cloaked, 4) === 0 && cloaked[0]) return 1;
      api.GetWindowThreadProcessId(hwnd, pid);
      const title = tbuf.toString('utf16le', 0, n * 2);
      if (title === 'Program Manager') return 1;
      const list = out.get(pid[0]) || [];
      list.push(title);
      out.set(pid[0], list);
    } catch {
      /* keep enumerating */
    }
    return 1;
  }, 0);
  return out;
}

function isAdmin() {
  try {
    return !!api.IsUserAnAdmin();
  } catch {
    return false;
  }
}

// ---------- process tokens ----------
const TOKEN_QUERY = 0x0008;
const INTEGRITY = { 0x0000: 'Untrusted', 0x1000: 'Low', 0x2000: 'Medium', 0x2100: 'Medium (plus)', 0x3000: 'High', 0x4000: 'System', 0x5000: 'Protected process' };
const sidNames = new Map();

function lookupSid(sidPtr, sidKey) {
  if (sidNames.has(sidKey)) return sidNames.get(sidKey);
  const name = Buffer.alloc(512);
  const dom = Buffer.alloc(512);
  const nl = [256];
  const dl = [256];
  const use = [0];
  let out = null;
  if (api.LookupAccountSidW(null, sidPtr, name, nl, dom, dl, use)) {
    const n = name.toString('utf16le', 0, nl[0] * 2);
    const d = dom.toString('utf16le', 0, dl[0] * 2);
    out = d ? `${d}\\${n}` : n;
  }
  sidNames.set(sidKey, out);
  return out;
}

/** User account, integrity level and elevation of a process (null when it can't be opened). */
function processToken(pid) {
  const h = openProcess(pid);
  if (!h) return null;
  const tok = [0];
  try {
    if (!api.OpenProcessToken(h, TOKEN_QUERY, tok)) return null;
    const t = tok[0];
    const out = { user: null, integrity: null, elevated: null };
    try {
      const buf = Buffer.alloc(512);
      const ret = [0];
      const base = addressOf(buf);
      if (api.GetTokenInformation(t, 1 /* TokenUser */, buf, buf.length, ret)) {
        const sidPtr = buf.readBigUInt64LE(0);
        const off = ptrOffset(sidPtr, base, buf);
        const key = off >= 0 ? buf.toString('hex', off, off + 8 + 4 * buf[off + 1]) : String(sidPtr);
        out.user = lookupSid(sidPtr, key);
      }
      if (api.GetTokenInformation(t, 20 /* TokenElevation */, buf, 4, ret)) out.elevated = buf.readUInt32LE(0) !== 0;
      if (api.GetTokenInformation(t, 25 /* TokenIntegrityLevel */, buf, buf.length, ret)) {
        const off = ptrOffset(buf.readBigUInt64LE(0), base, buf);
        if (off >= 0) {
          const n = buf[off + 1];
          const rid = n > 0 ? buf.readUInt32LE(off + 8 + 4 * (n - 1)) : 0;
          out.integrity = INTEGRITY[rid] || `0x${rid.toString(16)}`;
        }
      }
    } finally {
      api.CloseHandle(t);
    }
    return out;
  } catch {
    return null;
  } finally {
    api.CloseHandle(h);
  }
}

const MACHINES = { 0x014c: 'x86 (32-bit)', 0x8664: 'x64 (64-bit)', 0xaa64: 'ARM64', 0x01c4: 'ARM' };
function processArch(pid) {
  const h = openProcess(pid);
  if (!h) return null;
  try {
    const pm = [0];
    const nm = [0];
    if (!api.IsWow64Process2(h, pm, nm)) return null;
    return MACHINES[pm[0] || nm[0]] || null;
  } catch {
    return null;
  } finally {
    api.CloseHandle(h);
  }
}

/** Battery and power source, from GetSystemPowerStatus (cheap enough to call every sample). */
function powerStatus() {
  const b = Buffer.alloc(12);
  if (!api.GetSystemPowerStatus(b)) return null;
  const flag = b[1];
  const pct = b[2];
  const life = b.readUInt32LE(4);
  const hasBattery = flag !== 128 && !(flag === 255 && pct === 255);
  return {
    ac: b[0] === 1,
    hasBattery,
    charging: hasBattery && (flag & 8) !== 0,
    percent: hasBattery && pct !== 255 ? pct : null,
    secondsLeft: hasBattery && life !== 0xffffffff ? life : null,
    saver: b[3] === 1,
  };
}

// ---------- process actions ----------
const PROCESS_SET_INFORMATION = 0x0200;
const PROCESS_SUSPEND_RESUME = 0x0800;
const PRIORITY_CLASSES = { idle: 0x40, below: 0x4000, normal: 0x20, above: 0x8000, high: 0x80 };

/** Run fn(handle) on a process opened with `access`; returns { ok, error }. */
function withProcess(pid, access, fn) {
  const h = api.OpenProcess(access, 0, pid);
  if (!h) return { ok: false, error: errorText(api.GetLastError()) };
  try {
    return fn(h);
  } finally {
    api.CloseHandle(h);
  }
}

function setPriority(pid, level) {
  const cls = PRIORITY_CLASSES[level];
  if (!cls) return { ok: false, error: 'Unknown priority' };
  return withProcess(pid, PROCESS_SET_INFORMATION, (h) => (api.SetPriorityClass(h, cls) ? { ok: true } : { ok: false, error: errorText(api.GetLastError()) }));
}

/**
 * Efficiency mode, as in Task Manager: EcoQoS (the scheduler prefers efficient cores and lower
 * clocks for it) plus idle priority. Off restores normal priority and default throttling.
 */
function setEfficiency(pid, on) {
  return withProcess(pid, PROCESS_SET_INFORMATION, (h) => {
    const state = Buffer.alloc(12);
    state.writeUInt32LE(1, 0); // PROCESS_POWER_THROTTLING_CURRENT_VERSION
    state.writeUInt32LE(on ? 1 : 0, 4); // ControlMask: EXECUTION_SPEED (0 = let Windows decide)
    state.writeUInt32LE(on ? 1 : 0, 8); // StateMask
    if (!api.SetProcessInformation(h, 4 /* ProcessPowerThrottling */, state, 12)) return { ok: false, error: errorText(api.GetLastError()) };
    api.SetPriorityClass(h, on ? PRIORITY_CLASSES.idle : PRIORITY_CLASSES.normal);
    return { ok: true };
  });
}

function suspend(pid, on) {
  return withProcess(pid, PROCESS_SUSPEND_RESUME, (h) => {
    const st = (on ? api.NtSuspendProcess(h) : api.NtResumeProcess(h)) >>> 0;
    return st === 0 ? { ok: true } : { ok: false, error: `NTSTATUS 0x${st.toString(16)}` };
  });
}

/** Restore and bring a window to the front, even from a background process. */
function focusWindow(hwnd) {
  if (api.IsIconic(hwnd)) api.ShowWindow(hwnd, 9 /* SW_RESTORE */);
  // Windows only lets the foreground app hand focus around; a synthetic Alt press makes this
  // process count as having received input, which is the documented way past that lock.
  api.keybd_event(0x12, 0, 0, 0);
  const ok = api.SetForegroundWindow(hwnd);
  api.keybd_event(0x12, 0, 2 /* KEYEVENTF_KEYUP */, 0);
  return !!ok;
}

function setTopmost(hwnd, on) {
  // HWND_TOPMOST = -1, HWND_NOTOPMOST = -2; SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
  return !!api.SetWindowPos(hwnd, on ? -1 : -2, 0, 0, 0, 0, 0x0002 | 0x0001 | 0x0010);
}

/** Ask a window to close, as its close button would (WM_CLOSE). */
function closeWindow(hwnd) {
  return !!api.PostMessageW(hwnd, 0x0010, 0, 0);
}

function minimizeWindow(hwnd) {
  return !!api.ShowWindow(hwnd, 6 /* SW_MINIMIZE */);
}

function maximizeWindow(hwnd) {
  if (api.IsZoomed(hwnd)) return true;
  return !!api.ShowWindow(hwnd, 3 /* SW_MAXIMIZE */);
}

// ---------- window placement, in real screen pixels ----------
// Node isn't DPI aware, so Windows would scale every coordinate it sees; these switch the
// calling thread to per-monitor awareness for the duration of the call.
function dpiAware(fn) {
  let prev = 0;
  try {
    prev = api.SetThreadDpiAwarenessContext(-4 /* PER_MONITOR_AWARE_V2 */);
  } catch {
    /* older Windows: unscaled is all there is */
  }
  try {
    return fn();
  } finally {
    if (prev) api.SetThreadDpiAwarenessContext(prev);
  }
}

/** The display scale (1 = 100%, 2 = 200%). */
function screenScale() {
  return dpiAware(() => (api.GetDpiForSystem() || 96) / 96);
}

/** The work area (screen minus taskbar) of the monitor at a point, or the main monitor. */
function workAreaAt(x, y) {
  return dpiAware(() => {
    const pt = (BigInt(y | 0) << 32n) | (BigInt(x | 0) & 0xffffffffn); // POINT passed by value
    const mon = api.MonitorFromPoint(pt, 0 /* MONITOR_DEFAULTTONULL */) || api.MonitorFromPoint(0n, 1 /* MONITOR_DEFAULTTOPRIMARY */);
    const info = Buffer.alloc(40);
    info.writeUInt32LE(40, 0);
    if (!mon || !api.GetMonitorInfoW(mon, info)) return null;
    const r = { x: info.readInt32LE(20), y: info.readInt32LE(24) };
    r.w = info.readInt32LE(28) - r.x;
    r.h = info.readInt32LE(32) - r.y;
    r.onScreen = !!api.MonitorFromPoint(pt, 0);
    return r;
  });
}

function windowRect(hwnd) {
  return dpiAware(() => {
    const b = Buffer.alloc(16);
    if (!api.GetWindowRect(hwnd, b)) return null;
    const x = b.readInt32LE(0);
    const y = b.readInt32LE(4);
    return { x, y, w: b.readInt32LE(8) - x, h: b.readInt32LE(12) - y };
  });
}

/** Move and size a window to exact screen pixels. */
function placeWindow(hwnd, r) {
  return dpiAware(() => !!api.SetWindowPos(hwnd, 0, r.x, r.y, r.w, r.h, 0x0004 /* NOZORDER */ | 0x0010 /* NOACTIVATE */));
}

// ---------- sessions (who is signed in) ----------
const WTS_STATES = ['Active', 'Connected', 'Connecting', 'Shadowing', 'Disconnected', 'Idle', 'Listening', 'Reset', 'Down', 'Starting'];
const FILETIME_EPOCH_MS = 11644473600000n;
const fileTimeMs = (v) => (v > 0n ? Number(v / 10000n - FILETIME_EPOCH_MS) : 0);

/** Copy `len` bytes of memory Windows allocated, so it can be freed straight away. */
function copyOut(ptr, len) {
  return Buffer.from(new Uint8Array(koffi.view(ptr, len)));
}

/** One session's user, state, lock state and times (WTSSessionInfoEx), or null. */
function sessionInfo(id) {
  const buf = [null];
  const bytes = [0];
  if (!api.WTSQuerySessionInformationW(0, id, 25 /* WTSSessionInfoEx */, buf, bytes) || !buf[0]) return null;
  try {
    if (bytes[0] < 208) return null;
    const b = copyOut(buf[0], bytes[0]);
    const wstr = (off, chars) => {
      const s = b.toString('utf16le', off, off + chars * 2);
      const nul = s.indexOf('\0');
      return nul >= 0 ? s.slice(0, nul) : s;
    };
    const flags = b.readInt32LE(16);
    return {
      id: b.readUInt32LE(8),
      state: WTS_STATES[b.readInt32LE(12)] || 'Unknown',
      locked: flags === 0 ? true : flags === 1 ? false : null,
      station: wstr(20, 33),
      user: wstr(86, 21),
      domain: wstr(128, 18),
      logon: fileTimeMs(b.readBigInt64LE(168)),
      lastInput: fileTimeMs(b.readBigInt64LE(192)),
    };
  } finally {
    api.WTSFreeMemory(buf[0]);
  }
}

/** Every session on this PC: [{ id, station, state, user, domain, locked, logon, lastInput }]. */
function sessions() {
  const info = [null];
  const count = [0];
  if (!api.WTSEnumerateSessionsW(0, 0, 1, info, count) || !info[0]) return [];
  const ids = [];
  try {
    const raw = copyOut(info[0], count[0] * 24); // WTS_SESSION_INFOW: id, station name pointer, state
    for (let i = 0; i < count[0]; i++) ids.push({ id: raw.readUInt32LE(i * 24), state: WTS_STATES[raw.readInt32LE(i * 24 + 16)] || 'Unknown' });
  } finally {
    api.WTSFreeMemory(info[0]);
  }
  return ids.map((s) => sessionInfo(s.id) || { id: s.id, state: s.state, locked: null, station: '', user: '', domain: '', logon: 0, lastInput: 0 });
}

/** Lock this PC (Windows+L). */
function lockWorkstation() {
  return !!api.LockWorkStation();
}

/** Disconnect (switch user) or sign out a session. */
function sessionAction(id, action) {
  const ok = action === 'logoff' ? api.WTSLogoffSession(0, id, 0) : api.WTSDisconnectSession(0, id, 0);
  return ok ? { ok: true } : { ok: false, error: errorText(api.GetLastError()) };
}

/** Free and total space of each fixed drive (cheap: one call per drive). */
function fixedVolumes() {
  const out = [];
  const mask = api.GetLogicalDrives();
  for (let i = 2; i < 26; i++) {
    if (!(mask & (1 << i))) continue;
    const root = `${String.fromCharCode(65 + i)}:\\`;
    if (api.GetDriveTypeW(root) !== 3 /* DRIVE_FIXED */) continue;
    const avail = [0];
    const total = [0];
    const free = [0];
    if (api.GetDiskFreeSpaceExW(root, avail, total, free)) out.push({ root, free: Number(avail[0]), total: Number(total[0]) });
  }
  return out;
}

/** Visible top-level windows with a title: [{ hwnd, pid, title }]. */
function topWindows() {
  const out = [];
  const pid = [0];
  const tbuf = Buffer.alloc(1024);
  api.EnumWindows((hwnd) => {
    try {
      if (!api.IsWindowVisible(hwnd) || api.GetWindow(hwnd, 4)) return 1;
      const n = api.GetWindowTextW(hwnd, tbuf, 500);
      if (n <= 0) return 1;
      api.GetWindowThreadProcessId(hwnd, pid);
      out.push({ hwnd, pid: pid[0], title: tbuf.toString('utf16le', 0, n * 2) });
    } catch {
      /* keep going */
    }
    return 1;
  }, 0);
  return out;
}

/** Raw GetExtendedTcpTable / GetExtendedUdpTable buffer, or null. */
function endpointTable(kind, family) {
  const fn = kind === 'tcp' ? api.GetExtendedTcpTable : api.GetExtendedUdpTable;
  const cls = kind === 'tcp' ? 5 /* TCP_TABLE_OWNER_PID_ALL */ : 1; /* UDP_TABLE_OWNER_PID */
  let size = [256 * 1024];
  for (let attempt = 0; attempt < 5; attempt++) {
    const buf = Buffer.alloc(size[0]);
    const rc = fn(buf, size, 0, family, cls, 0);
    if (rc === 0) return buf;
    if (rc !== 122 /* ERROR_INSUFFICIENT_BUFFER */) return null;
    size = [size[0] + 64 * 1024];
  }
  return null;
}

const ERRORS = { 5: 'Access denied', 87: 'Process no longer exists', 6: 'Invalid handle' };
function errorText(code) {
  return ERRORS[code] || `Windows error ${code}`;
}

module.exports = {
  koffi,
  api,
  addressOf,
  readWStr,
  ptrOffset,
  openProcess,
  processImagePath,
  processCommandLine,
  processPriority,
  fileVersionInfo,
  memoryStatus,
  performanceInfo,
  installedMemory,
  recycleBin,
  folderAccess,
  visibleWindows,
  isAdmin,
  processToken,
  processArch,
  powerStatus,
  endpointTable,
  setPriority,
  setEfficiency,
  suspend,
  focusWindow,
  setTopmost,
  closeWindow,
  minimizeWindow,
  maximizeWindow,
  screenScale,
  workAreaAt,
  windowRect,
  placeWindow,
  sessions,
  lockWorkstation,
  sessionAction,
  fixedVolumes,
  topWindows,
  errorText,
  STATUS_INFO_LENGTH_MISMATCH,
  PROCESS_TERMINATE,
  PROCESS_QUERY_LIMITED_INFORMATION,
};
