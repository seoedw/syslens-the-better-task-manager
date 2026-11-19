'use strict';
/* global U, syslens, Palette, Menu, Actions, Overview, Processes, MemoryView, Performance, NetworkView, Storage, StartupView, ServicesView, HistoryView, SystemView, SettingsView, UsersView, DevicesView, ToolsView */

const App = (() => {
  // Every page, in the default sidebar order. The order and which pages show are settings.
  const PAGES = {
    overview: { title: 'Overview', view: Overview, icon: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>' },
    performance: { title: 'Performance', view: Performance, icon: '<path d="M3 20.5h18"/><path d="M4 16l4.5-5 4 3L19.5 6"/>' },
    processes: { title: 'Processes', view: Processes, count: 'navProcCount', icon: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>' },
    memory: { title: 'Memory', view: MemoryView, icon: '<rect x="2.5" y="7" width="19" height="9" rx="1.5"/><path d="M6 16v3M10 16v3M14 16v3M18 16v3"/><path d="M6.5 10.5h2.5M11 10.5h2.5M15.5 10.5h2"/>' },
    network: { title: 'Network', view: NetworkView, icon: '<path d="M12 19.5h.01"/><path d="M8.6 16a5 5 0 0 1 6.8 0"/><path d="M5.3 12.6a9.6 9.6 0 0 1 13.4 0"/><path d="M2 9.2a14.4 14.4 0 0 1 20 0"/>' },
    storage: { title: 'Storage', view: Storage, icon: '<rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M5 13l2.5-8h9L19 13"/><path d="M16.5 16.5h.01"/>' },
    startup: { title: 'Startup apps', view: StartupView, count: 'navStartupCount', icon: '<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>' },
    services: { title: 'Services', view: ServicesView, count: 'navServicesCount', icon: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>' },
    history: { title: 'History', view: HistoryView, icon: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/>' },
    system: { title: 'System', view: SystemView, icon: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>' },
    users: { title: 'Users', view: UsersView, icon: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 20a6.5 6.5 0 0 0-3-5.5"/>' },
    devices: { title: 'Devices', view: DevicesView, count: 'navDevicesCount', icon: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>' },
    tools: { title: 'Tools', view: ToolsView, icon: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z"/>' },
  };
  const DEFAULT_ORDER = Object.keys(PAGES);
  const views = { ...Object.fromEntries(Object.entries(PAGES).map(([k, p]) => [k, p.view])), settings: SettingsView };
  const titles = { ...Object.fromEntries(Object.entries(PAGES).map(([k, p]) => [k, p.title])), settings: 'Settings' };
  const root = document.documentElement;
  const media = matchMedia('(prefers-color-scheme: dark)');

  const api = {
    snap: null,
    current: null,
    settings: null,
    info: null,
    PAGES,
    DEFAULT_ORDER,
    go,
    setCount,
    setSpeed,
    setTheme: (theme) => saveSettings({ theme }),
    togglePrivacy: () => setPrivacy(!syslens.privacyActive()),
    setPrivacy,
    elevate,
    saveSettings,
    refreshSoon,
    visibleOrder,
    movePage,
    titleOf: (id) => titles[id] || id,
    toggleFullscreen: (on) => toggleFullscreen(on),
    copyFeedback: () => copyFeedback(),
  };
  const counts = {};
  let speed = 1000;
  let sysAccent = '';

  // ---------- settings ----------
  /** Apply locally at once, then save on the server (which checks every value). */
  async function saveSettings(patch) {
    const before = api.settings;
    api.settings = { ...before, ...patch };
    applySettings(patch);
    try {
      const saved = await syslens.settings.set(patch);
      if (saved && typeof saved === 'object' && !saved.error) {
        const fixed = {};
        for (const k of Object.keys(patch)) if (JSON.stringify(saved[k]) !== JSON.stringify(api.settings[k])) fixed[k] = saved[k];
        api.settings = saved;
        if (Object.keys(fixed).length) applySettings(fixed);
      }
    } catch {
      U.toast('Couldn’t save that setting.', 'bad');
    }
    return api.settings;
  }

  function applySettings(changed) {
    const s = api.settings;
    const has = (k) => Object.prototype.hasOwnProperty.call(changed, k);
    if (has('theme')) applyTheme();
    if (has('accent')) applyAccent();
    if (has('density')) root.dataset.density = s.density;
    if (has('textSize')) {
      root.dataset.text = String(s.textSize);
      window.dispatchEvent(new Event('resize')); // charts redraw at the new scale
    }
    if (has('background') || has('backgroundStrength') || has('backgroundVersion') || has('backgroundImage') || has('backgroundFit') || has('backgroundBlur')) applyBackground();
    if (has('hideNetwork') || has('privacy')) NetworkView.refresh();
    if (has('navOrder') || has('navHidden')) renderNav();
    if (has('interval')) {
      speed = s.interval;
      setSpeedUi(speed);
    }
    if (has('heat')) root.dataset.heat = s.heat ? 'on' : 'off';
    const view = views[api.current];
    if (view && api.snap && !has('lastPage')) {
      try {
        view.render(api.snap);
      } catch (err) {
        console.error(err);
      }
    }
  }

  // ---------- theme, accent, background ----------
  const effectiveTheme = (pref) => (pref === 'auto' ? (media.matches ? 'dark' : 'light') : pref);

  function applyTheme() {
    const pref = (api.settings && api.settings.theme) || 'auto';
    const eff = effectiveTheme(pref);
    root.dataset.prefTheme = pref;
    root.dataset.theme = eff;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = eff === 'light' ? '#eeeeee' : eff === 'black' ? '#000000' : '#1c1c1c';
    applyAccent();
    applyBackground();
  }

  const hexRgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));

  /**
   * Windows' accent palette (8 shades) when "Windows" is chosen: "light 2" reads well on the dark
   * themes, "dark 1" on light. Grey accents are skipped (selections would vanish).
   */
  function applyAccent() {
    const style = root.style;
    const light = root.dataset.theme === 'light';
    let hex = null;
    const choice = (api.settings && api.settings.accent) || 'windows';
    if (choice === 'windows') {
      const shades = (sysAccent.match(/.{8}/g) || []).map((c) => c.slice(0, 6));
      const pick = shades.length >= 5 ? (light ? shades[4] : shades[1]) : null;
      if (pick) {
        const rgb = hexRgb(pick);
        if (Math.max(...rgb) - Math.min(...rgb) > 40) hex = pick;
      }
    } else {
      hex = choice.slice(1);
    }
    if (!hex) {
      ['--accent', '--accent-soft', '--accent-text'].forEach((v) => style.removeProperty(v));
      return;
    }
    const rgb = hexRgb(hex);
    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    style.setProperty('--accent', `#${hex}`);
    style.setProperty('--accent-soft', `rgba(${rgb.join(', ')}, ${light ? 0.1 : 0.14})`);
    style.setProperty('--accent-text', lum > 0.55 ? '#111111' : '#ffffff');
  }

  function applyBackground() {
    const s = api.settings || {};
    const kind = s.background || 'none';
    root.dataset.bg = kind;
    root.style.setProperty('--bg-strength', String((s.backgroundStrength || 60) / 100));
    root.dataset.bgFit = s.backgroundFit || 'fill';
    root.dataset.bgBlur = s.backgroundBlur ? 'on' : 'off';
    const art = document.getElementById('backdrop');
    if (kind === 'image' && s.backgroundImage) {
      // The picture is served behind the token; CSS can only pass it in the address.
      art.style.backgroundImage = `url("${syslens.pictures.url(s.backgroundImage)}")`;
    } else {
      art.style.backgroundImage = '';
    }
  }

  media.addEventListener('change', () => {
    if (!api.settings || api.settings.theme === 'auto') applyTheme();
    const view = views[api.current];
    if (view && api.snap) view.render(api.snap);
  });

  // ---------- privacy ----------
  // bridge.js masks the user and PC names in everything it receives, from the first byte, so
  // switching reloads the page: every page then re-reads its data with the new setting.
  async function setPrivacy(on) {
    await saveSettings({ privacy: !!on });
    if (!!on !== syslens.privacyActive()) location.reload();
  }

  // ---------- sidebar ----------
  function visibleOrder() {
    const s = api.settings || {};
    const order = (s.navOrder || DEFAULT_ORDER).filter((id) => PAGES[id]);
    const hidden = new Set(s.navHidden || []);
    return order.filter((id) => !hidden.has(id));
  }

  function renderNav() {
    const nav = U.$('#nav');
    const order = visibleOrder();
    nav.innerHTML = order
      .map((id, i) => {
        const p = PAGES[id];
        const key = i < 10 ? `Ctrl+${(i + 1) % 10}` : '';
        return `<button class="nav-item${id === api.current ? ' active' : ''}" data-view="${id}" draggable="true" title="${U.esc(p.title)}${key ? ` (${key})` : ''}">
          <svg viewBox="0 0 24 24">${p.icon}</svg><span>${U.esc(p.title)}</span>${p.count ? `<span class="nav-count" id="${p.count}">${counts[p.count] != null ? counts[p.count] : ''}</span>` : ''}</button>`;
      })
      .join('');
    U.$('#navSettings').classList.toggle('active', api.current === 'settings');
  }

  /** Move a page by `delta` places among the visible pages (the hidden keep their spots). */
  function movePage(id, delta) {
    const full = [...api.settings.navOrder];
    const vis = visibleOrder();
    const i = vis.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= vis.length) return;
    const other = vis[j];
    const a = full.indexOf(id);
    const b = full.indexOf(other);
    full[a] = other;
    full[b] = id;
    saveSettings({ navOrder: full });
  }

  // Drag and drop: drop above or below another page.
  let dragId = null;
  function clearDrop() {
    U.$$('#nav .nav-item').forEach((b) => b.classList.remove('drop-before', 'drop-after', 'dragging'));
  }
  function wireNavDrag() {
    const nav = U.$('#nav');
    nav.addEventListener('dragstart', (e) => {
      const b = e.target.closest('.nav-item');
      if (!b) return;
      dragId = b.dataset.view;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
      requestAnimationFrame(() => b.classList.add('dragging'));
    });
    nav.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const b = e.target.closest('.nav-item');
      U.$$('#nav .nav-item').forEach((x) => x !== b && x.classList.remove('drop-before', 'drop-after'));
      if (!b || b.dataset.view === dragId) return;
      const r = b.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      b.classList.toggle('drop-before', before);
      b.classList.toggle('drop-after', !before);
    });
    nav.addEventListener('drop', (e) => {
      e.preventDefault();
      const b = e.target.closest('.nav-item');
      const id = dragId;
      dragId = null;
      if (!b || !id || b.dataset.view === id) return clearDrop();
      const before = b.classList.contains('drop-before');
      const full = api.settings.navOrder.filter((x) => x !== id);
      const at = full.indexOf(b.dataset.view) + (before ? 0 : 1);
      full.splice(at, 0, id);
      clearDrop();
      saveSettings({ navOrder: full });
    });
    nav.addEventListener('dragend', () => {
      dragId = null;
      clearDrop();
    });
  }

  function navMenu(id) {
    const vis = visibleOrder();
    const i = vis.indexOf(id);
    if (id === 'settings') {
      return [
        { label: 'Open Settings', icon: 'settings', kbd: 'Ctrl+,', run: () => go('settings') },
        { label: 'Reset page order', icon: 'restart', run: () => saveSettings({ navOrder: DEFAULT_ORDER, navHidden: [] }) },
      ];
    }
    return [
      { label: `Open ${titles[id]}`, icon: 'list', kbd: i < 10 ? `Ctrl+${(i + 1) % 10}` : '', run: () => go(id) },
      '-',
      { label: 'Move up', icon: 'up', disabled: i <= 0, run: () => movePage(id, -1) },
      { label: 'Move down', icon: 'down', disabled: i < 0 || i >= vis.length - 1, run: () => movePage(id, 1) },
      { label: 'Hide from sidebar', icon: 'hide', disabled: vis.length <= 1, tip: 'Still reachable with Ctrl+K and from Settings', run: () => saveSettings({ navHidden: [...(api.settings.navHidden || []), id] }) },
      '-',
      { label: 'Customize pages…', icon: 'settings', run: () => go('settings', { section: 'pages' }) },
      { label: 'Reset page order', icon: 'restart', run: () => saveSettings({ navOrder: DEFAULT_ORDER, navHidden: [] }) },
    ];
  }

  // ---------- navigation ----------
  // Per-process rows are only streamed while a page that lists processes is on screen.
  const NEEDS_PROCS = new Set(['processes', 'services', 'network', 'users']);
  function renewNeeds() {
    if (document.hidden || !NEEDS_PROCS.has(api.current)) return;
    syslens.need({ procs: true }).catch(() => {});
  }
  setInterval(renewNeeds, 10000);

  /** A page that's left gives back what it can: its view's heavy DOM and chart bitmaps. */
  function leave(name) {
    const view = views[name];
    if (view && view.hide) {
      try {
        view.hide();
      } catch (err) {
        console.error(err);
      }
    }
    const el = document.getElementById(`view-${name}`);
    if (el) {
      for (const c of el.querySelectorAll('canvas')) {
        c.width = 0;
        c.height = 0;
      }
    }
  }

  function go(name, opts = {}) {
    if (!views[name]) name = 'overview';
    const prev = api.current;
    if (prev && prev !== name) leave(prev);
    api.current = name;
    U.$$('#nav .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    U.$('#navSettings').classList.toggle('active', name === 'settings');
    U.$$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    U.$('#viewTitle').textContent = titles[name];
    if (api.settings && api.settings.startPage === 'last' && api.settings.lastPage !== name) saveSettings({ lastPage: name });
    renewNeeds();
    if (NEEDS_PROCS.has(name) && api.snap && !api.snap.procsLive) {
      // The rows on hand may be minutes old: fetch a current snapshot right away.
      syslens
        .snapshot()
        .then((s) => {
          if (s && api.current === name) onSnapshot(s);
        })
        .catch(() => {});
    }
    try {
      if (views[name].show) views[name].show(opts);
      if (api.snap) views[name].render(api.snap);
    } catch (err) {
      console.error(err);
    }
  }

  function setCount(id, n) {
    counts[id] = n;
    const el = document.getElementById(id);
    if (el) el.textContent = n == null ? '' : String(n);
  }

  /** After an action (priority, efficiency…), show its effect without waiting for the next tick. */
  let refreshTimer = null;
  function refreshSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      syslens
        .snapshot()
        .then((s) => s && onSnapshot(s))
        .catch(() => {});
    }, 700);
  }

  // ---------- top bar ----------
  function topStats(s) {
    const mem = s.mem;
    const disk = [...s.disks].sort((a, b) => b.active - a.active)[0];
    const gpu = s.gpus[0];
    const item = (color, label, value, tip) => `<span${tip ? ` data-tip="${U.esc(tip)}"` : ''}><i class="dot" style="background:var(${color})"></i>${label} <b>${value}</b></span>`;
    const b = s.battery;
    const lat = s.latency;
    const html = [
      item('--c-cpu', 'CPU', `${s.cpu.total.toFixed(0)}%`),
      item('--c-mem', 'Memory', `${(mem.inUse / U.GB).toFixed(1)} / ${(mem.total / U.GB).toFixed(1)} GB`),
      disk ? item('--c-disk', 'Disk', `${disk.active.toFixed(0)}%`) : '',
      gpu ? item('--c-gpu', 'GPU', `${gpu.util.toFixed(0)}%`) : '',
      s.power && s.power.socket != null ? item('--c-power', 'Power', U.watts(s.power.socket), 'Processor package power (CPU, GPU and NPU), from the firmware energy meters') : '',
      lat ? `<span data-tip="Internet latency: time to reach ${U.esc(lat.target)}">Ping <b>${lat.ms == null ? 'lost' : `${Math.round(lat.ms)} ms`}</b></span>` : '',
      b && b.hasBattery && b.percent != null ? `<span data-tip="${b.charging ? 'Charging' : b.ac ? 'Plugged in' : 'On battery'}">Battery <b>${b.percent}%</b>${b.charging ? ' ↑' : ''}</span>` : '',
      `<span>Up <b>${U.dur(s.uptime)}</b></span>`,
    ].join('');
    const el = U.$('#topStats');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  let adminShown = null;
  function renderAdmin(admin) {
    if (adminShown === admin) return;
    adminShown = admin;
    U.$('#admin').innerHTML = admin
      ? '<button class="badge-admin" id="btnAdminInfo" data-tip="See what administrator mode lets you do">● Running as administrator</button>'
      : '<button class="btn sm" id="btnElevate" style="width:100%" data-tip="Some details, and changing services and other users’ processes, need administrator rights.">Run as administrator</button>';
  }

  async function elevate() {
    if (api.snap && api.snap.admin) return Actions.adminInfo();
    if (!(await Actions.confirmElevate())) return;
    const r = await syslens.elevate().catch(() => null);
    if (r && r.ok) U.toast('Opening SysLens as administrator. This window closes once it’s up.', 'info', 8000);
    else U.toast((r && r.error) || 'Could not restart as administrator.', 'warn');
  }

  // ---------- connection banner ----------
  // Appears when the live connection drops and counts down to the next retry (bridge.js retries
  // every few seconds on its own). After 20 s it also says what to do if SysLens was closed.
  let offlineSince = 0;
  let retryAt = 0;
  let showTimer = null;
  let tickTimer = null;
  let linkLost = false; // the server doesn't accept this window's token any more
  let handingOff = false; // the administrator window is taking over

  const setText = (el, s) => {
    if (el.textContent !== s) el.textContent = s; // unchanged text isn't announced again
  };

  function renderOffline() {
    const hint = U.$('#offlineHint');
    let head;
    let countdown = '';
    if (linkLost) {
      head = 'This window is no longer linked to SysLens.';
      setText(hint, 'Close it and open SysLens again from the desktop or Start menu.');
      hint.hidden = false;
    } else {
      const secs = retryAt ? Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)) : 0;
      const long = Date.now() - offlineSince > 20000;
      head = handingOff ? 'SysLens moved to the administrator window.' : long ? 'SysLens isn’t responding.' : 'Connection lost.';
      countdown = handingOff ? '' : secs ? `Retrying in ${secs}s…` : 'Reconnecting…';
      setText(hint, 'If SysLens was closed, open it again from the desktop or Start menu.');
      hint.hidden = !long || handingOff;
    }
    // Screen readers get the message; the ticking countdown is hidden from them.
    setText(U.$('#offlineText'), head);
    setText(U.$('#offlineCountdown'), countdown);
  }

  function onConnection(up) {
    const banner = U.$('#offline');
    clearTimeout(showTimer);
    clearInterval(tickTimer);
    if (up) {
      banner.classList.remove('show');
      renewNeeds();
      if (offlineSince) {
        // The server may have restarted: tell it this window's state again.
        syslens.setVisible(!document.hidden).catch(() => {});
        if (speed === 0) syslens.setInterval(0).catch(() => {});
        if (Date.now() - offlineSince > 3000) U.toast('Reconnected to SysLens.', 'good', 2500);
      }
      offlineSince = 0;
      linkLost = false;
      return;
    }
    offlineSince = Date.now();
    renderOffline();
    tickTimer = setInterval(renderOffline, 1000);
    showTimer = setTimeout(() => banner.classList.add('show'), 1200);
  }

  function onRetry({ at }) {
    retryAt = at;
    if (offlineSince) renderOffline();
  }

  // ---------- speed ----------
  function setSpeedUi(ms) {
    U.$$('#speed button').forEach((b) => b.classList.toggle('on', Number(b.dataset.ms) === ms));
  }

  async function setSpeed(ms) {
    speed = ms;
    setSpeedUi(ms);
    await syslens.setInterval(ms).catch(() => {}); // the server saves it (pausing isn't saved)
    if (ms > 0 && api.settings) api.settings.interval = ms;
  }

  function onSnapshot(s) {
    if (!s) return;
    api.snap = s;
    topStats(s);
    renderAdmin(s.admin);
    if (s.sys && s.sys.accent && s.sys.accent !== sysAccent) {
      sysAccent = s.sys.accent;
      applyAccent();
    }
    setCount('navProcCount', s.totals.processes);
    checkAlerts(s);
    const view = views[api.current];
    if (!view) return;
    try {
      view.render(s);
    } catch (err) {
      console.error(err);
    }
  }

  // ---------- full screen ----------
  function toggleFullscreen(on = !document.fullscreenElement) {
    if (on) document.documentElement.requestFullscreen().catch(() => U.toast('Press F11 for full screen.', 'info', 3000));
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // ---------- feedback ----------
  function copyFeedback() {
    const name = (api.info && api.info.discord) || '';
    if (!name) return;
    U.copy(name, `Discord username ${name} copied. DM it your feedback`);
  }

  // ---------- alerts ----------
  // With "Notify me about problems" on, a serious finding that is new (or back after 30 minutes)
  // shows a Windows notification while SysLens isn't the window you're looking at.
  const alerted = new Map();
  function checkAlerts(s) {
    if (!api.settings || !api.settings.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!document.hidden && document.hasFocus()) return;
    const now = Date.now();
    for (const f of s.insights || []) {
      if (f.level !== 'bad') continue;
      if (now - (alerted.get(f.title) || 0) < 30 * 60000) continue;
      alerted.set(f.title, now);
      try {
        const n = new Notification(f.title, { body: f.text, icon: '/icon.png', tag: f.title });
        n.onclick = () => {
          window.focus();
          go(f.link || 'overview', f.group ? { group: f.group } : {});
          n.close();
        };
      } catch {
        /* notifications unavailable */
      }
    }
  }

  // ---------- right-click anywhere ----------
  function appMenu() {
    return [
      { label: 'Search…', icon: 'search', kbd: 'Ctrl+K', run: () => Palette.open() },
      { label: 'Run new task…', icon: 'start', kbd: 'Ctrl+N', run: () => Actions.runTask() },
      { label: 'Copy system report', icon: 'copy', kbd: 'Ctrl+Shift+C', run: () => Actions.copyReport() },
      '-',
      { label: speed === 0 ? 'Resume updates' : 'Pause updates', icon: speed === 0 ? 'play' : 'pause', run: () => setSpeed(speed === 0 ? (api.settings && api.settings.interval) || 1000 : 0) },
      { label: 'Always on top', checked: !!(api.settings && api.settings.alwaysOnTop), run: () => saveSettings({ alwaysOnTop: !api.settings.alwaysOnTop }) },
      { label: 'Hide personal info', checked: syslens.privacyActive(), run: () => setPrivacy(!syslens.privacyActive()) },
      '-',
      { label: document.fullscreenElement ? 'Exit full screen' : 'Full screen', icon: 'window', kbd: 'F11', run: () => toggleFullscreen() },
      { label: 'Keyboard shortcuts', icon: 'info', kbd: '?', run: () => Actions.shortcuts() },
      { label: 'Send feedback (Discord)', icon: 'copy', run: () => copyFeedback() },
      { label: 'Settings', icon: 'settings', kbd: 'Ctrl+,', run: () => go('settings') },
    ];
  }

  function onContextMenu(e) {
    if (e.defaultPrevented) return; // a page opened its own menu
    const t = e.target;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return; // keep the edit menu
    const selText = String(window.getSelection() || '').trim();
    if (selText) {
      return Menu.openAt(e, [
        { label: 'Copy', icon: 'copy', kbd: 'Ctrl+C', run: () => U.copy(selText) },
        { label: `Search online for “${selText.length > 28 ? `${selText.slice(0, 28)}…` : selText}”`, icon: 'search', run: () => Actions.searchOnline(selText) },
      ]);
    }
    const nav = t.closest('#nav .nav-item, #navSettings');
    if (nav) return Menu.openAt(e, navMenu(nav.dataset.view));
    const snap = api.snap;
    const grp = t.closest('[data-group], [data-ctx-group]');
    if (grp && snap) {
      const key = grp.dataset.group || grp.dataset.ctxGroup;
      const g = snap.groups.find((x) => x.key === key);
      if (g) return Menu.openAt(e, Actions.processMenu(Actions.fromGroup(g), [{ label: 'Show in Processes', icon: 'list', run: () => go('processes', { group: g.key }) }]));
    }
    const conn = t.closest('[data-cpid]');
    if (conn) {
      const pid = Number(conn.dataset.cpid);
      const p = snap && (snap.procs || []).find((x) => x.pid === pid);
      const host = conn.dataset.host || '';
      const addr = conn.dataset.addr || '';
      return Menu.openAt(e, [
        p && { label: `Go to ${p.display || p.name}`, icon: 'list', run: () => go('processes', { group: p.group, pid }) },
        p && { label: 'End task', icon: 'end', danger: true, disabled: p.critical, run: () => Actions.endTask(Actions.fromProc(p)) },
        '-',
        (host || addr) && { label: `Search online for ${host || addr}`, icon: 'search', run: () => Actions.searchOnline(host || addr) },
        addr && { label: 'Copy address', icon: 'copy', hint: addr, run: () => U.copy(addr, 'Address copied') },
        host && { label: 'Copy host name', icon: 'copy', run: () => U.copy(host, 'Host name copied') },
        conn.dataset.port && { label: 'Copy port', icon: 'copy', hint: conn.dataset.port, run: () => U.copy(conn.dataset.port, 'Port copied') },
      ]);
    }
    const pathEl = t.closest('[data-path]');
    if (pathEl) {
      const dir = pathEl.dataset.kind === 'dir';
      const cd = pathEl.dataset.cd;
      return Menu.openAt(e, Actions.pathMenu(pathEl.dataset.path, { dir, name: pathEl.dataset.name || '', open: cd ? () => pathEl.click() : null }));
    }
    const ev = t.closest('.event');
    if (ev) {
      const title = (ev.querySelector('.t') || {}).textContent || '';
      const detail = (ev.querySelector('.d') || {}).textContent || '';
      return Menu.openAt(e, [
        { label: 'Copy', icon: 'copy', run: () => U.copy([title, detail].filter(Boolean).join(' — ')) },
        { label: 'Search online', icon: 'search', run: () => Actions.searchOnline(title.replace(/^(Update installed|Update failed|Installed|Removed):\s*/i, '')) },
        api.current !== 'history' && { label: 'Open History', icon: 'list', run: () => go('history') },
      ]);
    }
    Menu.openAt(e, appMenu());
  }

  // ---------- keyboard ----------
  /** "Ctrl+Shift+F", "F11"… for a key event, in the form Settings stores shortcuts. */
  function comboOf(e) {
    let key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key;
    if (/^f\d+$/i.test(key)) key = key.toUpperCase();
    return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
  }

  function onKeyDown(e) {
    if (document.querySelector('.modal-backdrop') || Palette.isOpen || Menu.isOpen) return;
    // The full-screen shortcut from Settings. F11 is left to Edge, which has its own full screen.
    const fsKey = api.settings && api.settings.fullscreenKey;
    if (fsKey && fsKey !== 'F11' && comboOf(e) === fsKey) {
      e.preventDefault();
      return toggleFullscreen();
    }
    const k = e.key.toLowerCase();
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.ctrlKey && !e.shiftKey && k === 'k') {
      e.preventDefault();
      return Palette.open();
    }
    if (e.ctrlKey && /^[0-9]$/.test(e.key)) {
      e.preventDefault();
      const order = visibleOrder();
      const id = order[(Number(e.key) + 9) % 10];
      if (id) go(id);
      return;
    }
    if (e.ctrlKey && e.key === ',') {
      e.preventDefault();
      return go('settings');
    }
    if (e.ctrlKey && !e.shiftKey && k === 'n') {
      e.preventDefault();
      return Actions.runTask();
    }
    if (e.ctrlKey && e.shiftKey && k === 'c') {
      e.preventDefault();
      return Actions.copyReport();
    }
    if (!typing && (e.key === '?' || e.key === 'F1')) {
      e.preventDefault();
      return Actions.shortcuts();
    }
    const view = views[api.current];
    if (view && view.onKey) view.onKey(e);
  }

  // ---------- start ----------
  function wire() {
    for (const [name, view] of Object.entries(views)) view.init(document.getElementById(`view-${name}`));
    wireNavDrag();
    U.$('#nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) go(b.dataset.view);
    });
    U.$('#navSettings').addEventListener('click', () => go('settings'));
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-go]');
      if (g) go(g.dataset.go, g.dataset.sort ? { sort: g.dataset.sort } : g.dataset.group ? { group: g.dataset.group } : g.dataset.section ? { section: g.dataset.section } : {});
      if (e.target.closest('#btnElevate')) elevate();
      if (e.target.closest('#btnAdminInfo')) Actions.adminInfo();
      if (e.target.closest('#feedback')) copyFeedback();
    });
    U.$('#speed').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ms]');
      if (b) setSpeed(Number(b.dataset.ms));
    });
    U.$('#topSearch').addEventListener('click', () => Palette.open());
    U.$('#topRun').addEventListener('click', () => Actions.runTask());
    U.$('#topFull').addEventListener('click', () => toggleFullscreen());
    document.addEventListener('fullscreenchange', () => U.$('#topFull').classList.toggle('on', !!document.fullscreenElement));
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);
    syslens.onConnection(onConnection);
    syslens.onRetry(onRetry);
    U.$('#offlineRetry').addEventListener('click', () => syslens.reconnect());
    syslens.onAuthFailed(() => {
      linkLost = true;
      renderOffline();
      U.$('#offline').classList.add('show');
    });
    syslens.onHandoff((m) => {
      if (m && m.failed) {
        U.toast('The administrator window didn’t open. This window keeps working as before.', 'warn', 8000);
        return;
      }
      handingOff = true;
      U.toast('SysLens is now running as administrator in a new window. This one closes in a moment.', 'info', 8000);
    });
    document.addEventListener('visibilitychange', () => {
      syslens.setVisible(!document.hidden).catch(() => {});
      renewNeeds();
    });
    syslens.onSnapshot(onSnapshot);
  }

  async function start() {
    wire();
    const boot = await syslens.ready; // masks and settings are in place before any data
    api.settings = boot.settings;
    api.info = boot.info;
    U.$('#appVer').textContent = `v${boot.info.version}${boot.info.channel ? ` ${boot.info.channel}` : ''}`;
    const fb = U.$('#feedbackName');
    if (fb) fb.textContent = boot.info.discord || '';
    root.dataset.privacy = syslens.privacyActive() ? 'on' : 'off';
    root.dataset.density = api.settings.density;
    root.dataset.text = String(api.settings.textSize);
    root.dataset.heat = api.settings.heat ? 'on' : 'off';
    applyTheme();
    renderNav();
    speed = api.settings.interval;
    setSpeedUi(speed);

    const params = new URLSearchParams(location.search);
    const scan = params.get('scan');
    const s = api.settings;
    const startPage = s.startPage === 'last' ? s.lastPage : s.startPage;
    const first = params.get('view') || (scan ? 'storage' : startPage || visibleOrder()[0]);
    const snap = await syslens.snapshot().catch(() => null);
    if (snap) onSnapshot(snap);
    go(first, scan ? { scan } : params.get('section') ? { section: params.get('section') } : {});

    // A new version: say so once, with its changes a click away.
    if (s.lastVersion !== boot.info.version && !params.get('view')) {
      if (s.lastVersion) U.toast(`SysLens was updated to ${boot.info.version}.`, 'info', 14000, { label: 'What’s new', run: () => Actions.changelog(boot.info.version) });
      else U.toast('Welcome to SysLens. Right-click anything for what you can do with it, or press ? for keyboard shortcuts.', 'info', 10000);
      saveSettings({ lastVersion: boot.info.version });
    }
  }

  start().catch((err) => console.error(err));
  return api;
})();
