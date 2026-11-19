'use strict';
/* global U, App, syslens, Actions */

// Settings: how SysLens looks and behaves. Everything Task Manager's settings page has
// (start page, update speed, always on top, minimize on use, theme, confirmations) and more.
const SettingsView = (() => {
  let root;
  let painted = '';
  let capturing = false; // 'hotkey' (open SysLens from anywhere) or 'fullscreen', while waiting for keys
  let pictures = null; // your uploaded backgrounds: [{ id, at, size, thumb }]
  let uploading = false;
  const MAX_PICTURES = 12;

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
        <div class="set-sub">Your pictures <span class="faint">· ${pictures ? pictures.length : 0} of ${MAX_PICTURES} · drop pictures here or upload them</span></div>
        <div class="pic-grid" id="set-pics">${gallery(s)}</div>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" id="set-bgfile" multiple hidden>
        <div class="bg-extra" ${s.background === 'none' ? 'hidden' : ''}>
          <label class="range"><span>Strength</span><input type="range" min="5" max="100" step="5" value="${s.backgroundStrength}" data-range="backgroundStrength"><b id="set-bgval">${s.backgroundStrength}%</b></label>
          ${s.background === 'image' ? `${seg('backgroundFit', s.backgroundFit, [['fill', 'Fill'], ['fit', 'Fit']])}<label class="check"><input type="checkbox" data-toggle="backgroundBlur" ${s.backgroundBlur ? 'checked' : ''}> Soften (blur)</label>` : ''}
        </div>
      </div>
    </section>`;
  }

  /** Thumbnails of your uploaded pictures, plus an upload tile. */
  function gallery(s) {
    if (!pictures) return '<div class="faint">Loading your pictures…</div>';
    const tiles = pictures
      .map(
        (p) => `<div class="pic${s.background === 'image' && s.backgroundImage === p.id ? ' on' : ''}" data-pic="${p.id}" title="Use this picture">
          <img src="${syslens.pictures.url(p.id, true)}" alt="" loading="lazy" draggable="false">
          <button class="pic-x" data-pic-remove="${p.id}" title="Remove this picture" aria-label="Remove">✕</button></div>`,
      )
      .join('');
    const add = pictures.length < MAX_PICTURES ? `<button class="pic add" data-bg-file${uploading ? ' disabled' : ''}><span>${uploading ? 'Adding…' : '+ Upload'}</span></button>` : '';
    return tiles + add;
  }

  async function loadPictures() {
    pictures = (await syslens.pictures.list().catch(() => [])) || [];
    painted = '';
    paint();
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
      ${row('When SysLens opens', 'Task Manager size opens SysLens exactly where and as big as Task Manager opens on this PC. Full screen hides the title bar and taskbar too.', seg('windowStart', s.windowStart, [['default', 'Task Manager size'], ['last', 'Same as last time'], ['maximized', 'Maximized'], ['fullscreen', 'Full screen']]))}
      ${row('Full screen shortcut', 'Press it in SysLens to go full screen and back (Esc also leaves). F11 is Edge’s own full screen; pick another combination if you prefer.', `<span class="hotkey${capturing === 'fullscreen' ? ' capturing' : ''}">${capturing === 'fullscreen' ? 'Press the keys…' : s.fullscreenKey ? U.keys(s.fullscreenKey) : '<span class="faint">Off</span>'}</span>
         <button class="btn sm" data-fskey-change>${capturing === 'fullscreen' ? 'Cancel' : 'Change'}</button>${s.fullscreenKey && capturing !== 'fullscreen' ? '<button class="btn sm" data-fskey-off>Turn off</button>' : ''}${s.fullscreenKey !== 'F11' && capturing !== 'fullscreen' ? '<button class="btn sm" data-fskey-reset>F11</button>' : ''}`)}
      ${row('Always on top', 'Keep the SysLens window above other windows.', toggle('alwaysOnTop', s.alwaysOnTop))}
      ${row('Minimize when switching to an app', '“Switch to” in a right-click menu brings the app forward and tucks SysLens away.', toggle('minimizeOnSwitch', s.minimizeOnSwitch))}
      ${row('Start SysLens when I sign in', 'Opens the window when Windows starts.', toggle('startWithWindows', s.startWithWindows))}
      ${row(
        'Keyboard shortcut to open SysLens',
        'Works from anywhere in Windows, through SysLens’s desktop and Start menu shortcuts. Ctrl+Alt+Shift+S is free on almost every PC (Fn keys never reach Windows, so they can’t be used).',
        `<span class="hotkey${capturing === 'hotkey' ? ' capturing' : ''}" id="set-hotkey">${capturing === 'hotkey' ? 'Press the keys…' : hk ? U.keys(hk) : '<span class="faint">Off</span>'}</span>
         <button class="btn sm" data-hotkey-change>${capturing === 'hotkey' ? 'Cancel' : 'Change'}</button>${hk && capturing !== 'hotkey' ? '<button class="btn sm" data-hotkey-off>Turn off</button>' : ''}`,
      )}
      ${row('Ask before ending tasks', 'Confirm before End task, End process tree and High priority.', toggle('confirmEnd', s.confirmEnd))}
      ${row('Ask before efficiency mode', 'Explain efficiency mode before turning it on.', toggle('confirmEco', s.confirmEco))}
      ${row('Notify me about problems', 'A Windows notification when something serious comes up (memory or a drive almost full, the battery running out…) while you’re in another app. Windows asks once whether SysLens may show notifications.', toggle('notify', s.notify))}
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
      ${row('Hide network details', 'Your Wi-Fi name, IP and MAC addresses, gateway, DNS servers and who your apps talk to are kept out of this window entirely: they never reach it, so they can’t show up on screen, in a screenshot or anywhere else in SysLens. On by default.', toggle('hideNetwork', s.hideNetwork))}
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
        ['Version', `${U.esc(i.version || '')}${i.channel ? ` <span class="tag info">${U.esc(i.channel)}</span>` : ''} <button class="link" data-whatsnew>What’s new</button>`],
        ['Running as', admin ? 'Administrator <button class="link" data-admin-info>What can I do now?</button>' : 'Standard user <button class="link" data-elevate>Restart as administrator</button>'],
        i.discord && ['Feedback', `DM <b>${U.esc(i.discord)}</b> on Discord <button class="link" data-feedback>Copy</button>`],
        i.license && ['License', `${U.esc(i.license)} <button class="link" data-link="license">Read it</button>`],
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

  /** The bottom of Settings: who made SysLens, where it lives, its license and feedback. */
  function footer() {
    const i = App.info || {};
    return `<footer class="set-footer">
      <div class="sf-brand"><svg class="brand-mark" viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" rx="4.5" fill="var(--accent)"/><g fill="var(--accent-text)"><rect x="4.6" y="10" width="2.6" height="5.6" rx="1"/><rect x="8.7" y="4.6" width="2.6" height="11" rx="1"/><rect x="12.8" y="7.6" width="2.6" height="8" rx="1"/></g></svg>
        <span>SysLens ${U.esc(i.version || '')}${i.channel ? ` ${U.esc(i.channel)}` : ''} — the better Task Manager</span></div>
      <div class="sf-line">Made by <button class="link" data-link="author">${U.esc(i.author || 'seoedw')}</button> on GitHub · <button class="link" data-link="repo">${U.esc(i.repo || 'GitHub')}</button></div>
      <div class="sf-line">${i.license ? `${U.esc(i.license)} License · ` : ''}<button class="link" data-link="releases">Releases</button>${i.discord ? ` · Feedback: DM <b>${U.esc(i.discord)}</b> on Discord` : ''}</div>
    </footer>`;
  }

  function paint() {
    if (!root || !App.settings) return;
    const s = App.settings;
    const sig = JSON.stringify([s, capturing, App.snap && App.snap.admin, syslens.privacyActive(), pictures, uploading]);
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
      ${appearance(s)}${pages(s)}${behavior(s)}${processes(s)}${privacy(s)}${about()}${footer()}</div>`;
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
      else {
        App.saveSettings({ [name]: v });
        if (name === 'windowStart') App.toggleFullscreen(v === 'fullscreen');
      }
    } else if ((el = t('[data-theme-pick]'))) {
      App.saveSettings({ theme: el.dataset.themePick });
    } else if ((el = t('[data-accent]'))) {
      App.saveSettings({ accent: el.dataset.accent });
    } else if ((el = t('[data-pic-remove]'))) {
      removePicture(el.dataset.picRemove);
    } else if ((el = t('[data-pic]'))) {
      App.saveSettings({ background: 'image', backgroundImage: el.dataset.pic });
    } else if ((el = t('[data-bg-pick]'))) {
      const v = el.dataset.bgPick;
      if (v === 'image' && !(pictures && pictures.length)) U.$('#set-bgfile').click();
      else if (v === 'image' && !App.settings.backgroundImage) App.saveSettings({ background: 'image', backgroundImage: pictures[0].id });
      else App.saveSettings({ background: v });
    } else if (t('[data-bg-file]')) {
      U.$('#set-bgfile').click();
    } else if ((el = t('[data-link]'))) {
      syslens.openLink(el.dataset.link);
    } else if (t('[data-feedback]')) {
      App.copyFeedback();
    } else if (t('[data-admin-info]')) {
      Actions.adminInfo();
    } else if ((el = t('[data-move]'))) {
      App.movePage(el.dataset.move, Number(el.dataset.d));
    } else if (t('[data-reset-order]')) {
      App.saveSettings({ navOrder: App.DEFAULT_ORDER, navHidden: [] });
    } else if (t('[data-hotkey-change]')) {
      setCapture(capturing === 'hotkey' ? false : 'hotkey');
    } else if (t('[data-fskey-change]')) {
      setCapture(capturing === 'fullscreen' ? false : 'fullscreen');
    } else if (t('[data-fskey-off]')) {
      App.saveSettings({ fullscreenKey: '' });
    } else if (t('[data-fskey-reset]')) {
      App.saveSettings({ fullscreenKey: 'F11' });
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
      else if (k === 'notify' && el.checked) askToNotify(el);
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
    } else if (el.id === 'set-bgfile' && el.files && el.files.length) {
      addPictures([...el.files]);
      el.value = '';
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

  // ---------- your pictures ----------
  /** Decode a picture file into an <img> (any format the browser reads). */
  function decode(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, done: () => URL.revokeObjectURL(url) });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('unreadable'));
      };
      img.src = url;
    });
  }

  /** A JPEG of the picture at most maxW x maxH, as a data URL. */
  function jpeg(img, maxW, maxH, quality) {
    const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', quality);
    c.width = 0;
    c.height = 0;
    return url;
  }

  async function addPictures(files) {
    const room = MAX_PICTURES - (pictures ? pictures.length : 0);
    if (room <= 0) return U.toast(`You can keep up to ${MAX_PICTURES} pictures. Remove one first.`, 'warn');
    uploading = true;
    paint();
    let added = 0;
    for (const file of files.slice(0, room)) {
      if (!/^image\//.test(file.type)) continue;
      if (file.size > 40 * 1024 * 1024) {
        U.toast(`${file.name} is too big (over 40 MB).`, 'warn');
        continue;
      }
      try {
        const { img, done } = await decode(file);
        const full = jpeg(img, 2560, 1600, 0.86);
        const thumb = jpeg(img, 320, 200, 0.8);
        done();
        const r = await syslens.pictures.add(full, thumb);
        if (!r || r.error) throw new Error((r && r.error) || 'refused');
        pictures = r.pictures;
        added++;
        App.saveSettings({ background: 'image', backgroundImage: r.id });
      } catch (err) {
        U.toast(`Couldn’t use ${file.name}: ${err.message === 'unreadable' ? 'not a picture SysLens can read' : err.message}.`, 'warn', 6000);
      }
    }
    if (files.length > room) U.toast(`Only ${room} more picture${room === 1 ? '' : 's'} fit; the gallery holds ${MAX_PICTURES}.`, 'info');
    uploading = false;
    painted = '';
    paint();
    if (added) U.toast(`${added} picture${added === 1 ? '' : 's'} added. Click one to use it.`, 'good', 3000);
  }

  async function removePicture(id) {
    const ok = await U.confirm({ title: 'Remove this picture?', body: 'It’s deleted from SysLens’s gallery. The file you uploaded it from isn’t touched.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    const r = await syslens.pictures.remove(id).catch(() => null);
    if (!r || r.error) return U.toast((r && r.error) || 'Couldn’t remove it.', 'bad');
    pictures = r.pictures;
    if (r.settings) App.saveSettings({ background: r.settings.background, backgroundImage: r.settings.backgroundImage });
    painted = '';
    paint();
  }

  /** Notifications need Windows' (the browser's) permission, asked once. */
  async function askToNotify(box) {
    if (typeof Notification === 'undefined') {
      box.checked = false;
      return U.toast('Notifications aren’t available in this window.', 'warn');
    }
    let p = Notification.permission;
    if (p === 'default') p = await Notification.requestPermission().catch(() => 'denied');
    if (p !== 'granted') {
      box.checked = false;
      return U.toast('Notifications are blocked for SysLens. Allow them from the lock icon in the window’s title bar, then try again.', 'warn', 8000);
    }
    App.saveSettings({ notify: true });
    U.toast('SysLens will notify you when something serious comes up.', 'good');
  }

  // ---------- keyboard shortcut ----------
  const KEY_OK = /^([A-Z0-9]|F([1-9]|1[0-2])|Home|End|Insert)$/;

  function setCapture(mode) {
    const on = !!mode;
    capturing = mode || false;
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
    if (capturing === 'fullscreen') {
      // In-app: a function key alone, or Ctrl/Alt with a key.
      const ok = /^F([1-9]|1[0-2])$/.test(key) || ((/^[A-Z0-9]$/.test(key) || /^(Enter|Home|End)$/.test(key)) && (e.ctrlKey || e.altKey));
      if (!ok) {
        U.toast('Use a function key (like F11), or Ctrl or Alt with a letter or number (like Ctrl+Shift+F).', 'warn', 5000);
        return;
      }
      setCapture(false);
      App.saveSettings({ fullscreenKey: [...mods, key].join('+') });
      return;
    }
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
      body: 'Theme, colors, background, page order and every other setting go back to how SysLens comes. Your uploaded pictures stay in the gallery.',
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
    root.addEventListener('dragover', (e) => {
      if (!dragId && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
        e.preventDefault();
        root.classList.add('dropping');
      }
    });
    root.addEventListener('dragleave', (e) => {
      if (e.target === root) root.classList.remove('dropping');
    });
    root.addEventListener('drop', (e) => {
      root.classList.remove('dropping');
      if (dragId || !e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      addPictures([...e.dataTransfer.files]);
    });
    root.addEventListener('dragend', () => {
      dragId = null;
      U.$$('.pg-row', root).forEach((x) => x.classList.remove('drop-before', 'drop-after', 'dragging'));
    });
  }

  function show(opts = {}) {
    painted = '';
    paint();
    loadPictures();
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
