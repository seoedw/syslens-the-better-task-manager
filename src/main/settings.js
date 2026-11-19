'use strict';
// Preferences, kept in %LOCALAPPDATA%\SysLens\settings.json. They live with the server rather
// than in the window, so they survive restarts and port changes and carry over to the
// administrator window (which has a browser profile of its own). Every value is checked
// against a rule; anything unknown or malformed is dropped.
//
// Background pictures you upload live in %LOCALAPPDATA%\SysLens\backgrounds: each one as a
// JPEG (at most 2560 px wide) plus a small thumbnail for the gallery in Settings.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./log');

const FILE = path.join(DATA_DIR, 'settings.json');
const LEGACY_BACKGROUND = path.join(DATA_DIR, 'background.jpg'); // 1.3 kept a single picture
const BG_DIR = path.join(DATA_DIR, 'backgrounds');
const MAX_PICTURES = 12;
const PAGES = ['overview', 'performance', 'processes', 'memory', 'network', 'storage', 'startup', 'services', 'history', 'system', 'users', 'devices', 'tools'];
const COLUMNS = ['status', 'pid', 'cpu', 'priv', 'gpu', 'gpuMem', 'io', 'handles', 'threads', 'priority', 'started', 'publisher'];
const PICTURE_ID = /^[a-f0-9]{12}$/;

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
  backgroundImage: (v) => v === '' || PICTURE_ID.test(v),
  backgroundFit: oneOf('fill', 'fit'),
  backgroundBlur: bool,
  backgroundVersion: intIn(0, 1e9),
  navOrder: pageList,
  navHidden: (v) => pageList(v) && v.length < PAGES.length,
  startPage: (v) => v === 'last' || PAGES.includes(v),
  lastPage: (v) => PAGES.includes(v) || v === 'settings',
  windowStart: oneOf('default', 'last', 'maximized', 'fullscreen'),
  // A function key on its own, or Ctrl and/or Alt (plus Shift) with a key: a lone letter would
  // fire while you type.
  fullscreenKey: (v) =>
    v === '' || /^(Ctrl\+)?(Alt\+)?(Shift\+)?F([1-9]|1[0-2])$/.test(v) || (/^(Ctrl\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|Enter|Home|End)$/.test(v) && /^(Ctrl|Alt)\+/.test(v)),
  interval: oneOf(500, 1000, 2000, 5000),
  alwaysOnTop: bool,
  minimizeOnSwitch: bool,
  startWithWindows: bool,
  hotkey: (v) => v === '' || /^(Ctrl\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|F([1-9]|1[0-2])|Home|End|Insert)$/.test(v),
  confirmEnd: bool,
  confirmEco: bool,
  notify: bool,
  processView: oneOf('grouped', 'flat', 'tree'),
  hiddenColumns: columnList,
  heat: bool,
  fullAccount: bool,
  privacy: bool,
  hideNetwork: bool,
  resolveHosts: bool,
  latency: bool,
  lastVersion: (v) => typeof v === 'string' && v.length < 32,
  port: intIn(1024, 65535),
};

const DEFAULTS = {
  theme: 'auto',
  accent: 'windows',
  density: 'compact',
  textSize: 100,
  background: 'none',
  backgroundStrength: 60,
  backgroundImage: '',
  backgroundFit: 'fill',
  backgroundBlur: false,
  backgroundVersion: 0,
  navOrder: PAGES,
  navHidden: [],
  startPage: 'overview',
  lastPage: 'overview',
  windowStart: 'default',
  fullscreenKey: 'F11',
  interval: 1000,
  alwaysOnTop: false,
  minimizeOnSwitch: false,
  startWithWindows: false,
  hotkey: 'Ctrl+Alt+Shift+S',
  confirmEnd: true,
  confirmEco: true,
  notify: false,
  processView: 'grouped',
  hiddenColumns: ['priority', 'started', 'publisher'],
  heat: true,
  fullAccount: false,
  privacy: false,
  hideNetwork: true,
  resolveHosts: true,
  latency: false,
  lastVersion: '',
  port: 0,
};

function clean(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input)) {
    if (Object.prototype.hasOwnProperty.call(RULES, k) && RULES[k](v)) out[k] = v;
  }
  return out;
}

/** The bytes of a JPEG data URL, or null when it isn't one (or is out of the size range). */
function jpegBytes(dataUrl, min, max) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) return null;
  const bytes = Buffer.from(m[1], 'base64');
  // JPEG files start with FF D8 FF; anything else is refused.
  if (bytes.length < min || bytes.length > max || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return bytes;
}

const picturePath = (id, thumb = false) => path.join(BG_DIR, `${id}${thumb ? '.thumb' : ''}.jpg`);

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
    this.migratePicture();
  }

  /** 1.3's single background.jpg becomes the first picture in the gallery. */
  migratePicture() {
    try {
      if (!fs.existsSync(LEGACY_BACKGROUND)) return;
      fs.mkdirSync(BG_DIR, { recursive: true });
      const id = crypto.randomBytes(6).toString('hex');
      fs.renameSync(LEGACY_BACKGROUND, picturePath(id));
      if (this.values.background === 'image' && !this.values.backgroundImage) {
        this.values.backgroundImage = id;
        this.save();
      }
    } catch {
      /* leave it where it is */
    }
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
    if ('backgroundImage' in ok && ok.backgroundImage && !fs.existsSync(picturePath(ok.backgroundImage))) delete ok.backgroundImage;
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

  /** Everything back to how SysLens comes. Uploaded pictures stay in the gallery. */
  reset() {
    const keep = { lastVersion: this.values.lastVersion };
    const before = this.values;
    this.values = { ...DEFAULTS, ...keep };
    this.save();
    const changed = {};
    for (const k of Object.keys(DEFAULTS)) if (JSON.stringify(before[k]) !== JSON.stringify(this.values[k])) changed[k] = this.values[k];
    for (const fn of this.listeners) {
      try {
        fn(changed, this.values);
      } catch {
        /* ignore */
      }
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

  // ---------- your pictures ----------
  pictures() {
    try {
      return fs
        .readdirSync(BG_DIR)
        .filter((f) => /^[a-f0-9]{12}\.jpg$/.test(f))
        .map((f) => {
          const id = f.slice(0, 12);
          const st = fs.statSync(picturePath(id));
          return { id, at: st.mtimeMs, size: st.size, thumb: fs.existsSync(picturePath(id, true)) };
        })
        .sort((a, b) => b.at - a.at);
    } catch {
      return [];
    }
  }

  /** Add an uploaded picture (and its thumbnail) and show it. */
  addPicture(dataUrl, thumbUrl) {
    const bytes = jpegBytes(dataUrl, 1024, 8 * 1024 * 1024);
    if (!bytes) return { error: 'That isn’t a picture SysLens can use' };
    const thumb = thumbUrl ? jpegBytes(thumbUrl, 128, 256 * 1024) : null;
    if (this.pictures().length >= MAX_PICTURES) return { error: `You can keep up to ${MAX_PICTURES} pictures. Remove one first.` };
    fs.mkdirSync(BG_DIR, { recursive: true });
    const id = crypto.randomBytes(6).toString('hex');
    fs.writeFileSync(picturePath(id), bytes);
    if (thumb) fs.writeFileSync(picturePath(id, true), thumb);
    const settings = this.set({ background: 'image', backgroundImage: id });
    return { id, settings, pictures: this.pictures() };
  }

  removePicture(id) {
    if (typeof id !== 'string' || !PICTURE_ID.test(id)) return { error: 'Unknown picture' };
    for (const thumb of [false, true]) {
      try {
        fs.unlinkSync(picturePath(id, thumb));
      } catch {
        /* already gone */
      }
    }
    const left = this.pictures();
    let settings = this.get();
    if (this.values.backgroundImage === id) {
      settings = left.length ? this.set({ backgroundImage: left[0].id }) : this.set({ backgroundImage: '', background: this.values.background === 'image' ? 'none' : this.values.background });
    }
    return { settings, pictures: left };
  }

  /** The file for a picture (or its thumbnail, falling back to the picture). */
  pictureFile(id, thumb) {
    if (typeof id !== 'string' || !PICTURE_ID.test(id)) return null;
    if (thumb && fs.existsSync(picturePath(id, true))) return picturePath(id, true);
    return fs.existsSync(picturePath(id)) ? picturePath(id) : null;
  }
}

module.exports = { Settings, PAGES, COLUMNS };
