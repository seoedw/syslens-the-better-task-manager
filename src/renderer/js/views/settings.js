'use strict';
/* global U, App, syslens, Actions */

// Settings: how SysLens looks and behaves. Everything Task Manager's settings page has
// (start page, update speed, always on top, minimize on use, theme, confirmations) and more.
const SettingsView = (() => {
  let root;
  let painted = '';
  let capturing = false;

  const THEMES = [
    ['auto', 'Auto', 'Follows Windows'],
    ['light', 'Light', ''],
    ['dark', 'Dark', ''],
    ['black', 'Black', 'Pure black, for OLED screens'],
  ];
  const ACCENTS = ['#4cc2ff', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#40c8e0', '#8e8e93'];
  const BACKGROUNDS = [
    ['none', 'None'],
    ['aurora', 'Aurora'],
    ['dusk', 'Dusk'],
    ['mesh', 'Mesh'],
    ['dots', 'Dots'],
    ['grid', 'Grid'],
    ['image', 'Picture'],
  ];
  const COLUMNS = [
    ['status', 'Status'],
    ['pid', 'PID'],
    ['cpu', 'CPU'],
    ['priv', 'Memory'],
    ['gpu', 'GPU'],
    ['gpuMem', 'GPU memory'],
    ['io', 'Disk & I/O'],
    ['handles', 'Handles'],
    ['threads', 'Threads'],
    ['priority', 'Priority'],
    ['started', 'Started'],
    ['publisher', 'Publisher'],
  ];

  const seg = (name, value, options) =>
    `<div class="seg" data-set="${name}">${options.map(([v, label]) => `<button data-v="${U.esc(String(v))}" class="${String(v) === String(value) ? 'on' : ''}">${U.esc(label)}</button>`).join('')}</div>`;
  const toggle = (name, on, extra = '') => `<label class="switch big"><input type="checkbox" data-toggle="${name}" ${on ? 'checked' : ''} ${extra}></label>`;
  const row = (title, desc, control, cls = '') => `<div class="set-row ${cls}"><div class="set-text"><div class="set-title">${title}</div>${desc ? `<div class="set-desc">${desc}</div>` : ''}</div><div class="set-control">${control}</div></div>`;

  function init(el) {
    root = el;
    root.classList.add('settings-view');
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    wireDrag();
  }

  // ---------- sections ----------
  function appearance(s) {
    const themeCards = THEMES.map(
      ([v, label, sub]) => `<button class="theme-card${s.theme === v ? ' on' : ''}" data-theme-pick="${v}" title="${U.esc(sub || label)}">
        <span class="tc-preview tc-${v}"><i></i><i></i><i></i></span><span class="tc-label">${label}</span>${sub ? `<span class="tc-sub">${U.esc(sub)}</span>` : ''}</button>`,
    ).join('');
    const custom = s.accent !== 'windows' && !ACCENTS.includes(s.accent.toLowerCase());
    const swatches = `<div class="swatches">
      <button class="swatch win${s.accent === 'windows' ? ' on' : ''}" data-accent="windows" title="Windows accent color">Windows</button>
      ${ACCENTS.map((c) => `<button class="swatch${s.accent.toLowerCase() === c ? ' on' : ''}" data-accent="${c}" style="--sw:${c}" title="${c}"></button>`).join('')}
      <label class="swatch custom${custom ? ' on' : ''}" title="Pick any color" style="--sw:${custom ? s.accent : 'transparent'}"><input type="color" data-accent-custom value="${custom ? s.accent : '#4cc2ff'}">+</label>
    </div>`;
    const bgTiles = BACKGROUNDS.map(([v, label]) => `<button class="bg-tile bg-${v}${s.background === v ? ' on' : ''}" data-bg-pick="${v}"><span class="bg-swatch"></span><span>${label}</span></button>`).join('');
    return `<section class="card set-card" id="set-appearance">
      <h2>Appearance</h2>
      <div class="set-row block"><div class="set-text"><div class="set-title">Theme</div><div class="set-desc">Black uses true black backgrounds: on OLED screens those pixels switch off entirely.</div></div><div class="theme-cards">${themeCards}</div></div>
      ${row('Accent color', 'Used for selections, links, switches and the sidebar marker.', swatches, 'wrap')}
      ${row('Density', 'Compact fits more rows on screen; Comfortable gives everything more room.', seg('density', s.density, [['compact', 'Compact'], ['comfortable', 'Comfortable']]))}
      ${row('Interface size', 'Scales text and controls. Ctrl + and Ctrl − in the window zoom too.', seg('textSize', s.textSize, [[90, '90%'], [100, '100%'], [110, '110%'], [120, '120%']]))}
      <div class="set-row block"><div class="set-text"><div class="set-title">Background</div><div class="set-desc">Shows around the panels. Pick a picture of your own for something personal.</div></div>
        <div class="bg-tiles">${bgTiles}</div>
        <div class="bg-extra" ${s.background === 'none' ? 'hidden' : ''}>
          <label class="range"><span>Strength</span><input type="range" min="5" max="100" step="5" value="${s.backgroundStrength}" data-range="backgroundStrength"><b id="set-bgval">${s.backgroundStrength}%</b></label>
          <button class="btn sm" data-bg-file>Choose picture…</button>
          ${s.background === 'image' ? '<button class="btn sm" data-bg-remove>Remove picture</button>' : ''}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" id="set-bgfile" hidden>
        </div>
      </div>
    </section>`;
  }

  function pages(s) {
    const hidden = new Set(s.navHidden || []);
    const vis = App.visibleOrder();
    const list = s.navOrder
      .filter((id) => App.PAGES[id])
      .map((id) => {
        const p = App.PAGES[id];
        const i = vis.indexOf(id);
        const shown = !hidden.has(id);
        return `<div class="pg-row${shown ? '' : ' off'}" data-page="${id}" draggable="true">
          <span class="pg-handle" aria-hidden="true">⋮⋮</span>
          <svg class="pg-ico" viewBox="0 0 24 24">${p.icon}</svg>
          <span class="pg-name">${U.esc(p.title)}</span>
          <span class="pg-key">${shown && i < 10 ? `Ctrl+${(i + 1) % 10}` : shown ? '' : 'Hidden'}</span>
          <button class="btn ghost sm icon" data-move="${id}" data-d="-1" title="Move up" ${i <= 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24" class="arrow-ico"><path d="M6 15l6-6 6 6"/></svg></button>
          <button class="btn ghost sm icon" data-move="${id}" data-d="1" title="Move down" ${!shown || i >= vis.length - 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24" class="arrow-ico"><path d="M6 9l6 6 6-6"/></svg></button>
          <label class="switch" title="${shown ? 'Shown in the sidebar' : 'Hidden from the sidebar'}"><input type="checkbox" data-show-page="${id}" ${shown ? 'checked' : ''} ${shown && vis.length <= 1 ? 'disabled' : ''}></label>
        </div>`;
      })
      .join('');
    const startOptions = [...s.navOrder.filter((id) => App.PAGES[id]).map((id) => [id, App.PAGES[id].title]), ['last', 'The last page I used']];
    return `<section class="card set-card" id="set-pages">
      <h2>Pages</h2>
      <div class="set-desc" style="margin-bottom:10px">Drag pages into the order you like (here or in the sidebar), or right-click one in the sidebar. Hidden pages are still a Ctrl+K search away. Ctrl+1 … Ctrl+0 follow this order.</div>
      <div class="pg-list" id="set-pglist">${list}</div>
      <div class="set-row">
        <div class="set-text"><div class="set-title">Start page</div><div class="set-desc">What SysLens shows when it opens.</div></div>
        <div class="set-control"><select class="select" data-select="startPage">${startOptions.map(([v, label]) => `<option value="${v}" ${s.startPage === v ? 'selected' : ''}>${U.esc(label)}</option>`).join('')}</select>
          <button class="btn sm" data-reset-order>Reset order</button></div>
      </div>
    </section>`;
  }

  function behavior(s) {
    const hk = s.hotkey;
    return `<section class="card set-card" id="set-behavior">
      <h2>Behavior</h2>
      ${row('Update speed', 'How often the numbers refresh. Slower uses a little less processor time; SysLens slows down by itself while minimized.', seg('interval', s.interval, [[500, '0.5 s'], [1000, '1 s'], [2000, '2 s'], [5000, '5 s']]))}
      ${row('Always on top', 'Keep the SysLens window above other windows.', toggle('alwaysOnTop', s.alwaysOnTop))}
      ${row('Minimize when switching to an app', '“Switch to” in a right-click menu brings the app forward and tucks SysLens away.', toggle('minimizeOnSwitch', s.minimizeOnSwitch))}
      ${row('Start SysLens when I sign in', 'Opens the window when Windows starts.', toggle('startWithWindows', s.startWithWindows))}
      ${row(
        'Keyboard shortcut to open SysLens',
        'Works from anywhere in Windows, through SysLens’s desktop and Start menu shortcuts. Ctrl+Alt+Shift+S is free on almost every PC (Fn keys never reach Windows, so they can’t be used).',
        `<span class="hotkey${capturing ? ' capturing' : ''}" id="set-hotkey">${capturing ? 'Press the keys…' : hk ? U.keys(hk) : '<span class="faint">Off</span>'}</span>
         <button class="btn sm" data-hotkey-change>${capturing ? 'Cancel' : 'Change'}</button>${hk && !capturing ? '<button class="btn sm" data-hotkey-off>Turn off</button>' : ''}`,
      )}
      ${row('Ask before ending tasks', 'Confirm before End task, End process tree and High priority.', toggle('confirmEnd', s.confirmEnd))}
      ${row('Ask before efficiency mode', 'Explain efficiency mode before turning it on.', toggle('confirmEco', s.confirmEco))}
    </section>`;
  }

  function processes(s) {
    const hidden = new Set(s.hiddenColumns || []);
    const cols = COLUMNS.map(([k, label]) => `<label class="check col"><input type="checkbox" data-col="${k}" ${hidden.has(k) ? '' : 'checked'}> ${label}</label>`).join('');
    return `<section class="card set-card" id="set-processes">
      <h2>Processes</h2>
      ${row('Default view', 'How the Processes page lists things when SysLens opens.', seg('processView', s.processView, [['grouped', 'By app'], ['flat', 'All processes'], ['tree', 'Tree']]))}
      <div class="set-row block"><div class="set-text"><div class="set-title">Columns</div><div class="set-desc">Name is always shown. Right-click the column headers to change these too.</div></div><div class="col-grid">${cols}</div></div>
      ${row('Heat shading', 'Tint busy cells amber, like Task Manager.', toggle('heat', s.heat))}
      ${row('Show full account names', 'Show the account a process runs as with its domain (PC\\name instead of name).', toggle('fullAccount', s.fullAccount))}
    </section>`;
  }

  function privacy(s) {
    const target = (App.info && App.info.latencyTarget) || 'Cloudflare (1.1.1.1)';
    return `<section class="card set-card" id="set-privacy">
      <h2>Privacy and network</h2>
      ${row('Hide personal info', 'Replaces your user name and PC name everywhere and blurs network names, addresses and serial numbers, for screenshots you want to share. The window reloads.', toggle('privacy', syslens.privacyActive()))}
      ${row('Look up host names', 'Show names like “github.com” for connections instead of bare addresses. Uses your normal DNS server.', toggle('resolveHosts', s.resolveHosts))}
      ${row('Measure internet latency', `Times a connection to ${U.esc(target)} every 5 seconds while SysLens is open (no data is sent) and shows it as “Ping”. Off by default.`, toggle('latency', s.latency))}
    </section>`;
  }

  function about() {
    const i = App.info || {};
    const admin = App.snap && App.snap.admin;
    return `<section class="card set-card" id="set-about">
      <h2>About SysLens</h2>
      ${U.props([
        ['Version', `${U.esc(i.version || '')} <button class="link" data-whatsnew>What’s new</button>`],
        ['Running as', admin ? 'Administrator' : 'Standard user <button class="link" data-elevate>Restart as administrator</button>'],
        ['Runtime', `Node.js ${U.esc(i.node || '')}${i.portable ? ' (bundled)' : ''} · Microsoft Edge app window`],
        ['App folder', `<span class="mono">${U.esc(i.appDir || '')}</span>`],
        ['Settings and log', `<span class="mono">${U.esc(i.dataDir || '')}</span> <button class="link" data-open-data>Open</button>`],
      ])}
      <div class="set-buttons">
        <button class="btn sm" data-shortcuts>Keyboard shortcuts</button>
        <button class="btn sm" data-report>Copy system report</button>
        <button class="btn sm" data-changelog>Changelog</button>
        <button class="btn sm" data-log>Open the log</button>
        <span class="spacer"></span>
        <button class="btn sm danger" data-reset-all>Reset all settings</button>
      </div>
      <div class="set-sub">Windows tools</div>
      <div class="set-buttons">
        <button class="btn sm" data-tool="taskmgr">Task Manager</button>
        <button class="btn sm" data-tool="resmon">Resource Monitor</button>
        <button class="btn sm" data-tool="services">Services</button>
        <button class="btn sm" data-tool="startup">Startup apps settings</button>
        <button class="btn sm" data-tool="apps">Installed apps</button>
      </div>
    </section>`;
  }

  function paint() {
    if (!root || !App.settings) return;
    const s = App.settings;
    const sig = JSON.stringify([s, capturing, App.snap && App.snap.admin, syslens.privacyActive()]);
    if (sig === painted) return;
    painted = sig;
    const scroll = root.scrollTop;
    root.innerHTML = `<div class="settings">
      <div class="set-toc">${[
        ['appearance', 'Appearance'],
        ['pages', 'Pages'],
        ['behavior', 'Behavior'],
        ['processes', 'Processes'],
        ['privacy', 'Privacy'],
        ['about', 'About'],
      ]
        .map(([id, label]) => `<button class="chip" data-jump="${id}">${label}</button>`)
        .join('')}</div>
      ${appearance(s)}${pages(s)}${behavior(s)}${processes(s)}${privacy(s)}${about()}</div>`;
    root.scrollTop = scroll;
  }

  // ---------- events ----------
  function onClick(e) {
    const t = (sel) => e.target.closest(sel);
    let el;
    if ((el = t('[data-jump]'))) {
      const sec = U.$(`#set-${el.dataset.jump}`);
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if ((el = t('.seg[data-set] button'))) {
      const name = el.parentElement.dataset.set;
      const raw = el.dataset.v;
      const v = /^\d+$/.test(raw) ? Number(raw) : raw;
      if (name === 'interval') App.setSpeed(v).then(() => App.saveSettings({ interval: v }));
      else App.saveSettings({ [name]: v });
    } else if ((el = t('[data-theme-pick]'))) {
      App.saveSettings({ theme: el.dataset.themePick });
    } else if ((el = t('[data-accent]'))) {
      App.saveSettings({ accent: el.dataset.accent });
    } else if ((el = t('[data-bg-pick]'))) {
      const v = el.dataset.bgPick;
      if (v === 'image' && App.settings.background !== 'image' && !App.settings.backgroundVersion) U.$('#set-bgfile').click();
      else App.saveSettings({ background: v });
    } else if (t('[data-bg-file]')) {
      U.$('#set-bgfile').click();
    } else if (t('[data-bg-remove]')) {
      syslens.settings.background(null).then(() => App.saveSettings({ background: 'none' }));
    } else if ((el = t('[data-move]'))) {
      App.movePage(el.dataset.move, Number(el.dataset.d));
    } else if (t('[data-reset-order]')) {
      App.saveSettings({ navOrder: App.DEFAULT_ORDER, navHidden: [] });
    } else if (t('[data-hotkey-change]')) {
      setCapture(!capturing);
    } else if (t('[data-hotkey-off]')) {
      applyHotkey('');
    } else if (t('[data-whatsnew]')) {
      Actions.changelog(App.info && App.info.version);
    } else if (t('[data-changelog]')) {
      Actions.changelog(null);
    } else if (t('[data-shortcuts]')) {
      Actions.shortcuts();
    } else if (t('[data-report]')) {
      Actions.copyReport();
    } else if (t('[data-log]')) {
      syslens.openLog();
    } else if (t('[data-open-data]')) {
      syslens.openData();
    } else if ((el = t('[data-tool]'))) {
      syslens.openSettings(el.dataset.tool);
    } else if (t('[data-reset-all]')) {
      resetAll();
    } else if (t('[data-elevate]')) {
      App.elevate();
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.dataset.toggle) {
      const k = el.dataset.toggle;
      if (k === 'privacy') App.setPrivacy(el.checked);
      else App.saveSettings({ [k]: el.checked });
    } else if (el.dataset.showPage) {
      const id = el.dataset.showPage;
      const hidden = new Set(App.settings.navHidden || []);
      if (el.checked) hidden.delete(id);
      else hidden.add(id);
      App.saveSettings({ navHidden: App.settings.navOrder.filter((p) => hidden.has(p)) });
    } else if (el.dataset.col) {
      const hidden = new Set(App.settings.hiddenColumns || []);
      if (el.checked) hidden.delete(el.dataset.col);
      else hidden.add(el.dataset.col);
      App.saveSettings({ hiddenColumns: [...hidden] });
    } else if (el.dataset.select) {
      App.saveSettings({ [el.dataset.select]: el.value });
    } else if (el.matches('[data-accent-custom]')) {
      App.saveSettings({ accent: el.value.toLowerCase() });
    } else if (el.id === 'set-bgfile' && el.files && el.files[0]) {
      usePicture(el.files[0]);
    } else if (el.dataset.range) {
      App.saveSettings({ [el.dataset.range]: Number(el.value) });
    }
  }

  function onInput(e) {
    const el = e.target;
    if (el.dataset.range === 'backgroundStrength') {
      // Live preview while dragging; saved on release (change).
      document.documentElement.style.setProperty('--bg-strength', String(Number(el.value) / 100));
      const v = U.$('#set-bgval');
      if (v) v.textContent = `${el.value}%`;
    }
  }

  // ---------- background picture ----------
  /** Shrink the picture to at most 2560 px wide and store it as a JPEG. */
  function usePicture(file) {
    if (file.size > 40 * 1024 * 1024) return U.toast('That picture is too big (over 40 MB).', 'warn');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      const scale = Math.min(1, 2560 / img.naturalWidth, 1600 / img.naturalHeight);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const data = c.toDataURL('image/jpeg', 0.86);
      c.width = 0;
      c.height = 0;
      const saved = await syslens.settings.background(data).catch(() => null);
      if (!saved || saved.error) return U.toast((saved && saved.error) || 'Couldn’t use that picture.', 'bad');
      App.saveSettings({ background: 'image', backgroundVersion: saved.backgroundVersion });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      U.toast('That file isn’t a picture SysLens can read.', 'warn');
    };
    img.src = url;
  }

  // ---------- keyboard shortcut ----------
  const KEY_OK = /^([A-Z0-9]|F([1-9]|1[0-2])|Home|End|Insert)$/;

  function setCapture(on) {
    capturing = on;
    painted = '';
    paint();
    if (on) document.addEventListener('keydown', onCaptureKey, true);
    else document.removeEventListener('keydown', onCaptureKey, true);
  }

  function onCaptureKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return setCapture(false);
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    let key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key;
    if (/^f\d+$/i.test(key)) key = key.toUpperCase();
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
    const strong = mods.length >= 2 || (mods.length === 1 && /^F\d+$/.test(key) && mods[0] !== 'Shift');
    if (!KEY_OK.test(key) || !strong) {
      U.toast('Use at least two of Ctrl, Alt and Shift with a letter, number or F-key (for example Ctrl+Alt+Shift+S).', 'warn', 5000);
      return;
    }
    setCapture(false);
    applyHotkey([...mods, key].join('+'));
  }

  async function applyHotkey(combo) {
    const r = await syslens.setHotkey(combo).catch(() => null);
    if (r && r.ok) {
      App.settings.hotkey = combo;
      painted = '';
      paint();
      U.toast(combo ? `${combo} now opens SysLens from anywhere.` : 'The keyboard shortcut is off.', 'good');
    } else {
      U.toast((r && r.error) || 'Couldn’t change the shortcut.', 'bad', 8000);
    }
  }

  async function resetAll() {
    const ok = await U.confirm({
      title: 'Reset all settings?',
      body: 'Theme, colors, background, page order and every other setting go back to how SysLens comes. Your background picture is removed.',
      confirmLabel: 'Reset everything',
      danger: true,
    });
    if (!ok) return;
    await syslens.settings.reset().catch(() => null);
    location.reload();
  }

  // ---------- reordering pages by dragging ----------
  let dragId = null;
  function wireDrag() {
    root.addEventListener('dragstart', (e) => {
      const r = e.target.closest('.pg-row');
      if (!r) return;
      dragId = r.dataset.page;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
      requestAnimationFrame(() => r.classList.add('dragging'));
    });
    root.addEventListener('dragover', (e) => {
      if (!dragId) return;
      const r = e.target.closest('.pg-row');
      if (!r) return;
      e.preventDefault();
      U.$$('.pg-row', root).forEach((x) => x !== r && x.classList.remove('drop-before', 'drop-after'));
      if (r.dataset.page === dragId) return;
      const box = r.getBoundingClientRect();
      const before = e.clientY < box.top + box.height / 2;
      r.classList.toggle('drop-before', before);
      r.classList.toggle('drop-after', !before);
    });
    root.addEventListener('drop', (e) => {
      const r = e.target.closest('.pg-row');
      const id = dragId;
      dragId = null;
      if (!r || !id) return;
      e.preventDefault();
      const before = r.classList.contains('drop-before');
      U.$$('.pg-row', root).forEach((x) => x.classList.remove('drop-before', 'drop-after', 'dragging'));
      if (r.dataset.page === id) return;
      const full = App.settings.navOrder.filter((x) => x !== id);
      full.splice(full.indexOf(r.dataset.page) + (before ? 0 : 1), 0, id);
      App.saveSettings({ navOrder: full });
    });
    root.addEventListener('dragend', () => {
      dragId = null;
      U.$$('.pg-row', root).forEach((x) => x.classList.remove('drop-before', 'drop-after', 'dragging'));
    });
  }

  function show(opts = {}) {
    painted = '';
    paint();
    if (opts.section) {
      requestAnimationFrame(() => {
        const sec = U.$(`#set-${opts.section}`);
        if (sec) sec.scrollIntoView({ block: 'start' });
      });
    }
  }

  function hide() {
    if (capturing) setCapture(false);
    painted = '';
    if (root) root.innerHTML = '';
  }

  return { init, render: paint, show, hide, title: 'Settings' };
})();
