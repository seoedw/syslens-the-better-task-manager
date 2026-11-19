'use strict';
// SysLens's own identity on the taskbar. Its window is an Edge app window, which Edge labels as
// one of its own ("MSEdge.127.0.0.1_/..."), so pinning it pinned Edge, with an address that
// stops working the next time SysLens starts. Giving the window SysLens's AppUserModelID and a
// relaunch command (the same command as the SysLens shortcut) makes the taskbar pin SysLens
// itself; giving the Start menu and desktop shortcuts the same ID makes a pinned or started
// SysLens and its open window share one taskbar button.
// https://learn.microsoft.com/windows/win32/shell/appids

const fs = require('fs');
const path = require('path');
const koffi = require('koffi');

const APP_ID = 'seoedw.SysLens';
const APP_NAME = 'SysLens';

const ole32 = koffi.load('ole32.dll');
const shell32 = koffi.load('shell32.dll');
const api = {
  CoInitializeEx: ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 coinit)'),
  CoCreateInstance: ole32.func('int32 __stdcall CoCreateInstance(void *clsid, void *outer, uint32 ctx, void *iid, _Out_ void **ppv)'),
  PropVariantClear: ole32.func('int32 __stdcall PropVariantClear(void *pv)'),
  SHGetPropertyStoreForWindow: shell32.func('int32 __stdcall SHGetPropertyStoreForWindow(intptr_t hwnd, void *iid, _Out_ void **ppv)'),
};

// COM methods are called through each object's table of function pointers.
const PV_STR = koffi.struct('SL_PROPVARIANT_STR', { vt: 'uint16', r1: 'uint16', r2: 'uint16', r3: 'uint16', str: 'const char16_t *', pad: 'uint64' });
const P = {
  QueryInterface: koffi.proto('int32 __stdcall SL_QueryInterface(void *self, void *iid, _Out_ void **ppv)'),
  Release: koffi.proto('uint32 __stdcall SL_Release(void *self)'),
  GetValue: koffi.proto('int32 __stdcall SL_GetValue(void *self, void *key, void *pv)'),
  SetValue: koffi.proto('int32 __stdcall SL_SetValue(void *self, void *key, SL_PROPVARIANT_STR *pv)'),
  Commit: koffi.proto('int32 __stdcall SL_Commit(void *self)'),
  Load: koffi.proto('int32 __stdcall SL_Load(void *self, const char16_t *file, uint32 mode)'),
  Save: koffi.proto('int32 __stdcall SL_Save(void *self, const char16_t *file, int remember)'),
};
// Places in each interface's table (IUnknown's three methods come first).
const IUNKNOWN = { QueryInterface: 0, Release: 2 };
const IPROPERTYSTORE = { GetValue: 5, SetValue: 6, Commit: 7 };
const IPERSISTFILE = { Load: 5, Save: 6 };

function guid(s) {
  const h = s.replace(/[{}-]/g, '');
  const b = Buffer.alloc(16);
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0);
  b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4);
  b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6);
  Buffer.from(h.slice(16), 'hex').copy(b, 8);
  return b;
}
const IID_IPropertyStore = guid('886d8eeb-8cf2-4446-8d02-cdba1dbdcf99');
const IID_IPersistFile = guid('0000010b-0000-0000-c000-000000000046');
const IID_IShellLinkW = guid('000214f9-0000-0000-c000-000000000046');
const CLSID_ShellLink = guid('00021401-0000-0000-c000-000000000046');

function appUserModelKey(pid) {
  const b = Buffer.alloc(20);
  guid('9f4c2855-9f79-4b39-a8d0-e1d42de1d5f3').copy(b, 0);
  b.writeUInt32LE(pid, 16);
  return b;
}
const KEY = {
  id: appUserModelKey(5),
  relaunchCommand: appUserModelKey(2),
  relaunchIcon: appUserModelKey(3),
  relaunchName: appUserModelKey(4),
};

const call = (obj, index, proto, ...args) => koffi.call(koffi.decode(koffi.decode(obj, 'void *'), index * 8, 'void *'), proto, obj, ...args);
const release = (obj) => {
  if (obj) call(obj, IUNKNOWN.Release, P.Release);
};

let comReady = false;
function initCom() {
  if (!comReady) {
    api.CoInitializeEx(null, 2 /* COINIT_APARTMENTTHREADED */); // S_FALSE or a mode clash is fine too
    comReady = true;
  }
}

function getString(store, key) {
  const pv = Buffer.alloc(24);
  if (call(store, IPROPERTYSTORE.GetValue, P.GetValue, key, pv) !== 0) return null;
  try {
    return pv.readUInt16LE(0) === 31 /* VT_LPWSTR */ ? koffi.decode(pv, 8, 'const char16_t *') : null;
  } finally {
    api.PropVariantClear(pv);
  }
}

function setString(store, key, value) {
  return call(store, IPROPERTYSTORE.SetValue, P.SetValue, key, { vt: 31, r1: 0, r2: 0, r3: 0, str: value, pad: 0 }) === 0;
}

/** The command that starts SysLens the way its shortcut does: no console window. */
function relaunchCommand(appDir, nodeExe) {
  const conhost = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'conhost.exe');
  const launcher = path.join(appDir, 'src', 'main', 'launcher.js');
  return `"${conhost}" --headless "${nodeExe}" --jitless "${launcher}"`;
}

/** The ID a window shows the taskbar, or null. */
function windowAppId(hwnd) {
  initCom();
  const out = [null];
  if (api.SHGetPropertyStoreForWindow(hwnd, IID_IPropertyStore, out) !== 0 || !out[0]) return null;
  try {
    return getString(out[0], KEY.id);
  } finally {
    release(out[0]);
  }
}

/**
 * Make a window SysLens's on the taskbar: its own button, and pinning it pins SysLens (the
 * relaunch command, name and icon) instead of Edge. Returns true when it took.
 */
function tagWindow(hwnd, { appDir, nodeExe }) {
  initCom();
  const out = [null];
  if (api.SHGetPropertyStoreForWindow(hwnd, IID_IPropertyStore, out) !== 0 || !out[0]) return false;
  const store = out[0];
  try {
    // The ID first, then what pinning uses, as Windows' own apps do.
    let ok = setString(store, KEY.id, APP_ID);
    ok = setString(store, KEY.relaunchCommand, relaunchCommand(appDir, nodeExe)) && ok;
    ok = setString(store, KEY.relaunchName, APP_NAME) && ok;
    ok = setString(store, KEY.relaunchIcon, `${path.join(appDir, 'assets', 'icon.ico')},0`) && ok;
    call(store, IPROPERTYSTORE.Commit, P.Commit);
    return ok;
  } finally {
    release(store);
  }
}

/**
 * Give a SysLens shortcut (.lnk) SysLens's ID, so what starts from it (and a pin made from it)
 * groups with the SysLens window. Leaves the file alone when it already has the ID.
 * Returns 'set', 'already' or an error message.
 */
function tagShortcut(lnkPath) {
  initCom();
  const link = [null];
  if (api.CoCreateInstance(CLSID_ShellLink, null, 1 /* CLSCTX_INPROC_SERVER */, IID_IShellLinkW, link) !== 0 || !link[0]) return 'no shell link object';
  const file = [null];
  const store = [null];
  try {
    if (call(link[0], IUNKNOWN.QueryInterface, P.QueryInterface, IID_IPersistFile, file) !== 0) return 'no IPersistFile';
    if (call(file[0], IPERSISTFILE.Load, P.Load, lnkPath, 2 /* STGM_READWRITE */) !== 0) return 'could not open the shortcut';
    if (call(link[0], IUNKNOWN.QueryInterface, P.QueryInterface, IID_IPropertyStore, store) !== 0) return 'no property store';
    if (getString(store[0], KEY.id) === APP_ID) return 'already';
    if (!setString(store[0], KEY.id, APP_ID)) return 'could not set the ID';
    if (call(store[0], IPROPERTYSTORE.Commit, P.Commit) !== 0) return 'could not commit';
    if (call(file[0], IPERSISTFILE.Save, P.Save, null, 1) !== 0) return 'could not save the shortcut';
    return 'set';
  } finally {
    release(store[0]);
    release(file[0]);
    release(link[0]);
  }
}

/** The SysLens shortcuts in the Start menu and on the desktop that start this copy of SysLens. */
function ownShortcuts(appDir) {
  const launcher = path.join(appDir, 'src', 'main', 'launcher.js').toLowerCase();
  const places = [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'SysLens.lnk'),
    path.join(process.env.USERPROFILE || '', 'Desktop', 'SysLens.lnk'),
    path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop', 'SysLens.lnk'),
  ];
  return places.filter((p) => {
    try {
      // A shortcut file holds its arguments as UTF-16 text (at an even or odd offset): only
      // shortcuts that start this copy of SysLens.
      const buf = fs.readFileSync(p);
      return [buf, buf.subarray(1)].some((b) => b.toString('utf16le').toLowerCase().includes(launcher));
    } catch {
      return false;
    }
  });
}

module.exports = { APP_ID, windowAppId, tagWindow, tagShortcut, ownShortcuts, relaunchCommand };

// node src/main/appid.js <shortcut.lnk>: tag a shortcut (used by scripts/install-shortcut.ps1).
if (require.main === module) {
  for (const p of process.argv.slice(2)) console.log(`${p}: ${tagShortcut(path.resolve(p))}`);
}
