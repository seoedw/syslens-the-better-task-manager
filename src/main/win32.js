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

koffi.proto('int __stdcall WNDENUMPROC(intptr_t hwnd, intptr_t lparam)');

const api = {
  // ntdll
  NtQuerySystemInformation: ntdll.func('int32 __stdcall NtQuerySystemInformation(int32 cls, void *buf, uint32 len, _Out_ uint32 *ret)'),
  NtQueryInformationProcess: ntdll.func('int32 __stdcall NtQueryInformationProcess(intptr_t h, int32 cls, void *buf, uint32 len, _Out_ uint32 *ret)'),

  // kernel32: processes
  OpenProcess: kernel32.func('intptr_t __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)'),
  CloseHandle: kernel32.func('int __stdcall CloseHandle(intptr_t h)'),
  QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(intptr_t h, uint32 flags, void *buf, _Inout_ uint32 *size)'),
  TerminateProcess: kernel32.func('int __stdcall TerminateProcess(intptr_t h, uint32 code)'),
  GetPriorityClass: kernel32.func('uint32 __stdcall GetPriorityClass(intptr_t h)'),
  GetLastError: kernel32.func('uint32 __stdcall GetLastError()'),
  IsWow64Process2: kernel32.func('int __stdcall IsWow64Process2(intptr_t h, _Out_ uint16 *processMachine, _Out_ uint16 *nativeMachine)'),
  GetSystemPowerStatus: kernel32.func('int __stdcall GetSystemPowerStatus(void *status)'),

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
  visibleWindows,
  isAdmin,
  processToken,
  processArch,
  powerStatus,
  endpointTable,
  errorText,
  STATUS_INFO_LENGTH_MISMATCH,
  PROCESS_TERMINATE,
  PROCESS_QUERY_LIMITED_INFORMATION,
};
