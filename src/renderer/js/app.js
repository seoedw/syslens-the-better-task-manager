'use strict';
/* global U, syslens, Overview, Processes, MemoryView, Performance, Storage */

const App = (() => {
  const views = { overview: Overview, processes: Processes, memory: MemoryView, performance: Performance, storage: Storage };
  const api = { snap: null, go, current: null };
  let themeSource = 'system';

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

  function go(name, opts = {}) {
    if (!views[name]) name = 'overview';
    api.current = name;
    U.$$('#nav .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    U.$$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    U.$('#viewTitle').textContent = views[name].title;
    store.set('view', name);
    try {
      if (views[name].show) views[name].show(opts);
      if (api.snap) views[name].render(api.snap);
    } catch (err) {
      console.error(err);
    }
  }

  function topStats(s) {
    const mem = s.mem;
    const disk = [...s.disks].sort((a, b) => b.active - a.active)[0];
    const gpu = s.gpus[0];
    const item = (color, label, value) => `<span><i class="dot" style="background:var(${color})"></i>${label} <b>${value}</b></span>`;
    const html = [
      item('--c-cpu', 'CPU', `${s.cpu.total.toFixed(0)}%`),
      item('--c-mem', 'Memory', `${(mem.inUse / U.GB).toFixed(1)} / ${(mem.total / U.GB).toFixed(1)} GB`),
      disk ? item('--c-disk', 'Disk', `${disk.active.toFixed(0)}%`) : '',
      gpu ? item('--c-gpu', 'GPU', `${gpu.util.toFixed(0)}%`) : '',
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
      ? '<span class="badge-admin">● Running as administrator</span><div class="faint" style="margin-top:4px">All processes and folders are visible.</div>'
      : '<div style="margin-bottom:8px">Some system details and protected folders need admin rights.</div><button class="btn sm" id="btnElevate" style="width:100%;justify-content:center">Run as administrator</button>';
  }

  async function elevate() {
    const r = await syslens.elevate().catch(() => null);
    if (r && r.ok) U.toast('Switching to administrator mode — this window reconnects in a moment.', 'info', 6000);
    else U.toast((r && r.error) || 'Could not restart as administrator.', 'warn');
  }

  function setThemeAttr(effective) {
    document.documentElement.dataset.theme = effective;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = effective === 'dark' ? '#0c0f13' : '#f3f4f6';
  }

  let offlineTimer = null;
  function onConnection(up) {
    const banner = U.$('#offline');
    clearTimeout(offlineTimer);
    if (up) banner.classList.remove('show');
    else offlineTimer = setTimeout(() => banner.classList.add('show'), 1200);
  }

  function setSpeedUi(ms) {
    U.$$('#speed button').forEach((b) => b.classList.toggle('on', Number(b.dataset.ms) === ms));
  }

  async function setSpeed(ms) {
    await syslens.setInterval(ms);
    setSpeedUi(ms);
    store.set('interval', String(ms));
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
    const count = U.$('#navProcCount');
    const n = String(s.totals.processes);
    if (count.textContent !== n) count.textContent = n;
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
    syslens.onTheme((effective) => {
      if (themeSource === 'system') setThemeAttr(effective);
      if (api.snap && views[api.current]) views[api.current].render(api.snap);
    });
    syslens.onConnection(onConnection);
    syslens.onAuthFailed(() => {
      U.$('#offline').textContent = 'This page has to be opened by SysLens itself — start SysLens from its shortcut.';
      U.$('#offline').classList.add('show');
    });
    syslens.onHandoff(() => {
      adminShown = null;
      U.toast('Reconnected as administrator.', 'good');
    });
    document.addEventListener('visibilitychange', () => {
      syslens.setVisible(!document.hidden).catch(() => {});
    });
    document.addEventListener('keydown', (e) => {
      if (document.querySelector('.modal-backdrop')) return;
      if (e.ctrlKey && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        go(Object.keys(views)[Number(e.key) - 1]);
        return;
      }
      const view = views[api.current];
      if (view && view.onKey) view.onKey(e);
    });

    syslens.onSnapshot(onSnapshot);
    applyTheme(store.get('theme', 'system'));
    const interval = Number(store.get('interval', '1000'));
    setSpeed(Number.isFinite(interval) ? interval : 1000).catch(() => {});

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
