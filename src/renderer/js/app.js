'use strict';
/* global U, syslens, Palette, Overview, Processes, MemoryView, Performance, NetworkView, Storage, StartupView, ServicesView, HistoryView, SystemView */

const App = (() => {
  const views = {
    overview: Overview,
    processes: Processes,
    performance: Performance,
    memory: MemoryView,
    network: NetworkView,
    storage: Storage,
    startup: StartupView,
    services: ServicesView,
    history: HistoryView,
    system: SystemView,
  };
  const ORDER = Object.keys(views); // Ctrl+1 … Ctrl+9, Ctrl+0
  const api = { snap: null, current: null, go, setCount, setTheme: applyTheme, setSpeed, togglePrivacy, elevate };
  let themeSource = 'system';
  let speed = 1000;
  let info = null;

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : v;
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* storage unavailable */
      }
    },
  };

  // Per-process rows are only streamed while a page that lists processes is on screen.
  const NEEDS_PROCS = new Set(['processes', 'services', 'network']);
  function renewNeeds() {
    if (document.hidden || !NEEDS_PROCS.has(api.current)) return;
    syslens.need({ procs: true }).catch(() => {});
  }
  setInterval(renewNeeds, 10000);

  function go(name, opts = {}) {
    if (!views[name]) name = 'overview';
    api.current = name;
    U.$$('#nav .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    U.$$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    U.$('#viewTitle').textContent = views[name].title;
    store.set('view', name);
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
    const el = document.getElementById(id);
    if (el) el.textContent = n == null ? '' : String(n);
  }

  function topStats(s) {
    const mem = s.mem;
    const disk = [...s.disks].sort((a, b) => b.active - a.active)[0];
    const gpu = s.gpus[0];
    const item = (color, label, value, tip) => `<span${tip ? ` data-tip="${U.esc(tip)}"` : ''}><i class="dot" style="background:var(${color})"></i>${label} <b>${value}</b></span>`;
    const b = s.battery;
    const html = [
      item('--c-cpu', 'CPU', `${s.cpu.total.toFixed(0)}%`),
      item('--c-mem', 'Memory', `${(mem.inUse / U.GB).toFixed(1)} / ${(mem.total / U.GB).toFixed(1)} GB`),
      disk ? item('--c-disk', 'Disk', `${disk.active.toFixed(0)}%`) : '',
      gpu ? item('--c-gpu', 'GPU', `${gpu.util.toFixed(0)}%`) : '',
      s.power && s.power.socket != null ? item('--c-power', 'Power', U.watts(s.power.socket), 'Processor package power (CPU, GPU and NPU), from the firmware energy meters') : '',
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
      ? '<span class="badge-admin">● Running as administrator</span><div class="faint" style="margin-top:3px">All processes and folders are visible.</div>'
      : '<div style="margin-bottom:7px">Some details need administrator rights.</div><button class="btn sm" id="btnElevate" style="width:100%">Run as administrator</button>';
  }

  async function elevate() {
    const r = await syslens.elevate().catch(() => null);
    if (r && r.ok) U.toast('Switching to administrator mode. This window reconnects in a moment.', 'info', 6000);
    else U.toast((r && r.error) || 'Could not restart as administrator.', 'warn');
  }

  // ---- theme and accent ----
  function setThemeAttr(effective) {
    document.documentElement.dataset.theme = effective;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = effective === 'dark' ? '#1c1c1c' : '#eeeeee';
    applyAccent();
  }

  // Windows' accent palette (8 shades): "light 2" reads well on dark, "dark 1" on light.
  // Grey accents are skipped: they would make links and selections invisible.
  let accentHex = '';
  function applyAccent(hex = accentHex) {
    accentHex = hex || '';
    const root = document.documentElement.style;
    const shades = (accentHex.match(/.{8}/g) || []).map((c) => c.slice(0, 6));
    const pick = shades.length >= 5 ? (document.documentElement.dataset.theme === 'light' ? shades[4] : shades[1]) : null;
    const rgb = pick ? [0, 2, 4].map((i) => parseInt(pick.slice(i, i + 2), 16)) : null;
    const colorful = rgb && Math.max(...rgb) - Math.min(...rgb) > 40;
    if (!colorful) {
      ['--accent', '--accent-soft', '--accent-text'].forEach((v) => root.removeProperty(v));
      return;
    }
    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    root.setProperty('--accent', `#${pick}`);
    root.setProperty('--accent-soft', `rgba(${rgb.join(', ')}, 0.13)`);
    root.setProperty('--accent-text', lum > 0.55 ? '#111111' : '#ffffff');
  }

  // ---- privacy ----
  // bridge.js masks the user and PC names in everything it receives, from the first byte, so
  // switching reloads the page: every page then re-reads its data with the new setting.
  function setPrivacy(on) {
    if (on && !info) return; // the names to hide aren't known yet
    store.set('privacy', on ? '1' : '0');
    if (on && info) store.set('privacy-names', JSON.stringify({ user: info.user, host: info.host }));
    if (on !== syslens.privacyActive()) location.reload();
  }
  function togglePrivacy() {
    setPrivacy(!syslens.privacyActive());
  }

  // ---- connection banner ----
  // Appears when the live connection drops and counts down to the next retry (bridge.js retries
  // every few seconds on its own). After 20 s it also says what to do if SysLens was closed.
  let offlineSince = 0;
  let retryAt = 0;
  let showTimer = null;
  let tickTimer = null;
  let linkLost = false; // the server doesn't accept this window's token any more
  let handingOff = false; // switching to the administrator instance

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
      head = handingOff ? 'Switching to administrator mode.' : long ? 'SysLens isn’t responding.' : 'Connection lost.';
      countdown = secs ? `Retrying in ${secs}s…` : 'Reconnecting…';
      setText(hint, 'If SysLens was closed, open it again from the desktop or Start menu.');
      hint.hidden = !long;
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
        // The server may have restarted with its defaults: re-apply this window's settings.
        syslens.setVisible(!document.hidden).catch(() => {});
        syslens.setInterval(speed).catch(() => {});
        if (handingOff) U.toast('Reconnected as administrator.', 'good');
        else if (Date.now() - offlineSince > 3000) U.toast('Reconnected to SysLens.', 'good', 2500);
      }
      offlineSince = 0;
      linkLost = false;
      handingOff = false;
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

  // ---- speed ----
  function setSpeedUi(ms) {
    U.$$('#speed button').forEach((b) => b.classList.toggle('on', Number(b.dataset.ms) === ms));
  }

  async function setSpeed(ms) {
    speed = ms;
    setSpeedUi(ms);
    store.set('interval', String(ms));
    await syslens.setInterval(ms).catch(() => {});
  }

  async function applyTheme(source) {
    themeSource = source;
    store.set('theme', source);
    U.$$('#theme button').forEach((b) => b.classList.toggle('on', b.dataset.theme === source));
    setThemeAttr(await syslens.setTheme(source));
    if (api.snap && views[api.current]) views[api.current].render(api.snap);
  }

  function onSnapshot(s) {
    if (!s) return;
    api.snap = s;
    topStats(s);
    renderAdmin(s.admin);
    if (s.sys && s.sys.accent !== accentHex) applyAccent(s.sys.accent);
    setCount('navProcCount', s.totals.processes);
    const view = views[api.current];
    if (!view) return;
    try {
      view.render(s);
    } catch (err) {
      console.error(err);
    }
  }

  function start() {
    for (const [name, view] of Object.entries(views)) view.init(document.getElementById(`view-${name}`));

    U.$('#nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) go(b.dataset.view);
    });
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-go]');
      if (g) go(g.dataset.go, g.dataset.sort ? { sort: g.dataset.sort } : {});
      if (e.target.closest('#btnElevate')) elevate();
    });
    U.$('#speed').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ms]');
      if (b) setSpeed(Number(b.dataset.ms));
    });
    U.$('#theme').addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme]');
      if (b) applyTheme(b.dataset.theme);
    });
    U.$('#privacy').addEventListener('change', (e) => setPrivacy(e.target.checked));
    const privateNow = syslens.privacyActive();
    document.documentElement.dataset.privacy = privateNow ? 'on' : 'off';
    U.$('#privacy').checked = privateNow;
    U.$('#topSearch').addEventListener('click', () => Palette.open());
    syslens.onTheme((effective) => {
      if (themeSource === 'system') setThemeAttr(effective);
      if (api.snap && views[api.current]) views[api.current].render(api.snap);
    });
    syslens.onConnection(onConnection);
    syslens.onRetry(onRetry);
    U.$('#offlineRetry').addEventListener('click', () => syslens.reconnect());
    syslens.onAuthFailed(() => {
      linkLost = true;
      renderOffline();
      U.$('#offline').classList.add('show');
    });
    syslens.onHandoff(() => {
      adminShown = null;
      handingOff = true;
    });
    document.addEventListener('visibilitychange', () => {
      syslens.setVisible(!document.hidden).catch(() => {});
      renewNeeds();
    });
    document.addEventListener('keydown', (e) => {
      if (document.querySelector('.modal-backdrop') || Palette.isOpen) return;
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        Palette.open();
        return;
      }
      if (e.ctrlKey && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        go(ORDER[(Number(e.key) + 9) % 10]);
        return;
      }
      const view = views[api.current];
      if (view && view.onKey) view.onKey(e);
    });

    syslens.onSnapshot(onSnapshot);
    applyTheme(store.get('theme', 'system'));
    const interval = Number(store.get('interval', '1000'));
    setSpeed(Number.isFinite(interval) ? interval : 1000);

    syslens
      .info()
      .then((i) => {
        info = i;
        U.$('#appVer').textContent = `v${i.version}`;
        // ?privacy=1 (used for README screenshots) turns it on like the switch does.
        if (new URLSearchParams(location.search).get('privacy') === '1' && !syslens.privacyActive()) setPrivacy(true);
      })
      .catch(() => {});

    const params = new URLSearchParams(location.search);
    const scan = params.get('scan');
    const first = params.get('view') || (scan ? 'storage' : store.get('view', 'overview'));
    syslens
      .snapshot()
      .catch(() => null)
      .then((s) => {
        if (s) onSnapshot(s);
        go(first, scan ? { scan } : {});
      });
  }

  start();
  return api;
})();
