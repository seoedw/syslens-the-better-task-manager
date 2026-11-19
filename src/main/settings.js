'use strict';
// Preferences, kept in %LOCALAPPDATA%\SysLens\settings.json. They live with the server rather
// than in the window, so they survive restarts and port changes and carry over to the
// administrator window (which has a browser profile of its own). Every value is checked
// against a rule; anything unknown or malformed is dropped.

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./log');

const FILE = path.join(DATA_DIR, 'settings.json');
const BACKGROUND_FILE = path.join(DATA_DIR, 'background.jpg');
const PAGES = ['overview', 'performance', 'processes', 'memory', 'network', 'storage', 'startup', 'services', 'history', 'system'];
const COLUMNS = ['status', 'pid', 'cpu', 'priv', 'gpu', 'gpuMem', 'io', 'handles', 'threads', 'priority', 'started', 'publisher'];

const oneOf = (...list) => (v) => list.includes(v);
const bool = (v) => typeof v === 'boolean';
const intIn = (lo, hi) => (v) => Number.isInteger(v) && v >= lo && v <= hi;
const pageList = (v) => Array.isArray(v) && v.length <= PAGES.length && v.every((p) => PAGES.includes(p)) && new Set(v).size === v.length;
const columnList = (v) => Array.isArray(v) && v.length <= COLUMNS.length && v.every((c) => COLUMNS.includes(c));

const RULES = {
  theme: oneOf('auto', 'light', 'dark', 'black'),
  accent: (v) => v === 'windows' || /^#[0-9a-f]{6}$/i.test(v),
  density: oneOf('compact', 'comfortable'),
  textSize: oneOf(90, 100, 110, 120),
  background: oneOf('none', 'aurora', 'dusk', 'mesh', 'dots', 'grid', 'image'),
  backgroundStrength: intIn(5, 100),
  backgroundVersion: intIn(0, 1e9),
  navOrder: pageList,
  navHidden: (v) => pageList(v) && v.length < PAGES.length,
  startPage: (v) => v === 'last' || PAGES.includes(v),
  lastPage: (v) => PAGES.includes(v) || v === 'settings',
  interval: oneOf(500, 1000, 2000, 5000),
  alwaysOnTop: bool,
  minimizeOnSwitch: bool,
  startWithWindows: bool,
  hotkey: (v) => v === '' || /^(Ctrl\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|F([1-9]|1[0-2])|Home|End|Insert)$/.test(v),
  confirmEnd: bool,
  confirmEco: bool,
  processView: oneOf('grouped', 'flat', 'tree'),
  hiddenColumns: columnList,
  heat: bool,
  fullAccount: bool,
  privacy: bool,
  resolveHosts: bool,
  latency: bool,
  lastVersion: (v) => typeof v === 'string' && v.length < 32,
};

const DEFAULTS = {
  theme: 'auto',
  accent: 'windows',
  density: 'compact',
  textSize: 100,
  background: 'none',
  backgroundStrength: 60,
  backgroundVersion: 0,
  navOrder: PAGES,
  navHidden: [],
  startPage: 'overview',
  lastPage: 'overview',
  interval: 1000,
  alwaysOnTop: false,
  minimizeOnSwitch: false,
  startWithWindows: false,
  hotkey: 'Ctrl+Alt+Shift+S',
  confirmEnd: true,
  confirmEco: true,
  processView: 'grouped',
  hiddenColumns: ['priority', 'started', 'publisher'],
  heat: true,
  fullAccount: false,
  privacy: false,
  resolveHosts: true,
  latency: false,
  lastVersion: '',
};

function clean(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input)) {
    if (Object.prototype.hasOwnProperty.call(RULES, k) && RULES[k](v)) out[k] = v;
  }
  return out;
}

class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    let existed = false;
    try {
      Object.assign(this.values, clean(JSON.parse(fs.readFileSync(FILE, 'utf8'))));
      existed = true;
    } catch {
      /* first run, or a damaged file: defaults */
    }
    // No settings yet but a window profile from before: an upgrade from 1.2 or earlier, so the
    // window says what's new rather than welcoming a new user.
    if (!existed && fs.existsSync(path.join(DATA_DIR, 'browser'))) this.values.lastVersion = '1.2';
    // Pages added in a later version go to the end of a saved order.
    const order = this.values.navOrder.filter((p) => PAGES.includes(p));
    for (const p of PAGES) if (!order.includes(p)) order.push(p);
    this.values.navOrder = order;
    this.listeners = [];
  }

  get(key) {
    return key ? this.values[key] : { ...this.values };
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  /** Merge the valid part of `patch`; returns the full settings. */
  set(patch) {
    const ok = clean(patch);
    const changed = {};
    for (const [k, v] of Object.entries(ok)) {
      if (JSON.stringify(this.values[k]) !== JSON.stringify(v)) changed[k] = v;
    }
    if (!Object.keys(changed).length) return this.get();
    Object.assign(this.values, changed);
    this.save();
    for (const fn of this.listeners) {
      try {
        fn(changed, this.values);
      } catch {
        /* a listener's problem isn't the caller's */
      }
    }
    return this.get();
  }

  reset() {
    const keep = { lastVersion: this.values.lastVersion };
    const before = this.values;
    this.values = { ...DEFAULTS, ...keep };
    this.save();
    const changed = {};
    for (const k of Object.keys(DEFAULTS)) if (JSON.stringify(before[k]) !== JSON.stringify(this.values[k])) changed[k] = this.values[k];
    for (const fn of this.listeners) fn(changed, this.values);
    try {
      fs.unlinkSync(BACKGROUND_FILE);
    } catch {
      /* none */
    }
    return this.get();
  }

  save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.values, null, 2));
      fs.renameSync(tmp, FILE);
    } catch {
      /* read-only profile: keep them for this run */
    }
  }

  /** Store a JPEG chosen in Settings as the background picture (null removes it). */
  setBackgroundImage(dataUrl) {
    if (dataUrl === null) {
      try {
        fs.unlinkSync(BACKGROUND_FILE);
      } catch {
        /* none */
      }
      return this.set({ background: this.values.background === 'image' ? 'none' : this.values.background });
    }
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
    if (!m) return { error: 'Not a JPEG picture' };
    const bytes = Buffer.from(m[1], 'base64');
    // JPEG files start with FF D8 FF; anything else is refused.
    if (bytes.length < 1024 || bytes.length > 8 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return { error: 'Not a usable picture' };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BACKGROUND_FILE, bytes);
    return this.set({ background: 'image', backgroundVersion: (this.values.backgroundVersion + 1) % 1e9 });
  }
}

module.exports = { Settings, PAGES, COLUMNS, BACKGROUND_FILE };
