'use strict';
/* global U, App, syslens, ServicesView, StartupView, Actions */

// Ctrl+K: one search box for pages, running apps, services, startup entries and actions.
const Palette = (() => {
  let rootEl = null;
  let results = [];
  let sel = 0;

  const PAGES = [
    ['overview', 'Overview', 'CPU, memory, disk, network and GPU at a glance'],
    ['processes', 'Processes', 'every app and background process'],
    ['performance', 'Performance', 'charts for each core, disk, adapter and GPU'],
    ['memory', 'Memory', 'where every byte of RAM is going'],
    ['network', 'Network', 'adapters, Wi-Fi and connections per app'],
    ['storage', 'Storage', 'drives, big folders, large files, installed apps'],
    ['startup', 'Startup apps', 'what starts with Windows'],
    ['services', 'Services', 'Windows services and who made them'],
    ['history', 'History', 'start-ups, sleep, crashes and updates this week'],
    ['system', 'System', 'hardware, Windows, battery health and security'],
    ['settings', 'Settings', 'theme, colors, background, page order, shortcut and more'],
  ];

  function actions() {
    const s = App.snap || {};
    const set = App.settings || {};
    const list = [
      ['Run new task', 'start open program command run cmd ctrl+n', () => Actions.runTask()],
      ['Restart Windows Explorer', 'taskbar start menu frozen desktop explorer', () => Actions.restartExplorer()],
      ['Copy a system report', 'clipboard share help summary specs', () => Actions.copyReport()],
      ['Keyboard shortcuts', 'help keys hotkeys', () => Actions.shortcuts()],
      ['What’s new in this version', 'changelog updates release notes', () => Actions.changelog(App.info && App.info.version)],
      ['Use the black theme (OLED)', 'theme appearance dark amoled black', () => App.setTheme('black')],
      [set.alwaysOnTop ? 'Stop keeping SysLens on top' : 'Keep SysLens on top of other windows', 'always on top pin window', () => App.saveSettings({ alwaysOnTop: !set.alwaysOnTop })],
      ['Customize pages and their order', 'sidebar reorder hide pages tabs', () => App.go('settings', { section: 'pages' })],
      ['Change the background', 'wallpaper picture image appearance', () => App.go('settings', { section: 'appearance' })],
      [set.latency ? 'Stop measuring internet latency' : 'Measure internet latency', 'ping latency internet speed', () => App.saveSettings({ latency: !set.latency })],
      ['Open Task Manager', 'taskmgr windows', () => syslens.openSettings('taskmgr')],
      ['Open Resource Monitor', 'resmon windows', () => syslens.openSettings('resmon')],
      ['Scan drive C: for what is using space', 'storage scan disk folders', () => App.go('storage', { scan: 'C:\\' })],
      ['Show the largest files', 'storage big files', () => App.go('storage', { tab: 'top' })],
      ['Show installed apps by size', 'storage programs uninstall', () => App.go('storage', { tab: 'apps' })],
      [s.paused ? 'Resume live updates' : 'Pause live updates', 'freeze stop speed', () => App.setSpeed(s.paused ? 1000 : 0)],
      ['Use the dark theme', 'theme appearance', () => App.setTheme('dark')],
      ['Use the light theme', 'theme appearance', () => App.setTheme('light')],
      ['Match the Windows theme', 'theme appearance auto system', () => App.setTheme('auto')],
      ['Hide personal info (for screenshots)', 'privacy screenshot blur user name', () => App.togglePrivacy()],
      ['Show the SysLens log', 'log debug troubleshoot', () => syslens.openLog()],
      ['Open Windows Settings: Startup apps', 'settings', () => syslens.openSettings('startup')],
      ['Open Windows Settings: Storage', 'settings storage sense cleanup', () => syslens.openSettings('storage')],
      ['Open Windows Settings: Installed apps', 'settings uninstall programs', () => syslens.openSettings('apps')],
      ['Open Windows Settings: Power and battery', 'settings sleep battery', () => syslens.openSettings('battery')],
      ['Open Windows Settings: Update history', 'settings windows update', () => syslens.openSettings('update')],
      ['Open Windows Security', 'antivirus defender firewall', () => syslens.openSettings('security')],
      ['Open the Services console', 'services.msc mmc', () => syslens.openSettings('services')],
    ];
    if (!s.admin) list.push(['Run as administrator', 'elevate admin uac', () => App.elevate()]);
    return list.map(([name, words, run]) => ({ kind: 'Actions', glyph: 'action', name, words, run }));
  }

  function candidates() {
    // Pages in the order the sidebar shows them (hidden ones included: this is how to reach them).
    const order = [...((App.settings && App.settings.navOrder) || []), 'settings'];
    const pages = PAGES.slice().sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    const out = pages.map(([id, name, desc]) => ({ kind: 'Pages', glyph: 'page', name, desc, words: desc, run: () => App.go(id) }));
    const s = App.snap;
    if (s) {
      for (const g of s.groups || []) {
        out.push({
          kind: 'Running now',
          icon: g.path,
          win: g.type === 'windows',
          name: g.name,
          desc: `${U.bytes(g.priv)}${g.count > 1 ? ` · ${g.count} processes` : ''}`,
          words: `${g.exe} ${g.desc || ''} ${g.company || ''}`,
          weight: g.priv,
          run: () => App.go('processes', { group: g.key }),
        });
      }
    }
    const sv = ServicesView.data;
    if (sv) {
      for (const x of sv.list) {
        out.push({ kind: 'Services', glyph: 'service', name: x.display, desc: x.running ? 'Running' : x.state, words: `${x.name} ${x.description} ${x.company}`, run: () => App.go('services', { q: x.display }) });
      }
    }
    const su = StartupView.data;
    if (su) {
      for (const x of su.list) {
        out.push({ kind: 'Startup apps', icon: x.exe, name: x.name, desc: x.enabled ? 'Starts with Windows' : 'Turned off', words: `${x.publisher} ${x.command}`, run: () => App.go('startup', { q: x.name }) });
      }
    }
    return out.concat(actions());
  }

  function score(item, q) {
    const name = item.name.toLowerCase();
    if (name === q) return 100;
    if (name.startsWith(q)) return 80;
    if (name.split(/[\s()._-]+/).some((w) => w.startsWith(q))) return 60;
    if (name.includes(q)) return 40;
    if ((item.words || '').toLowerCase().includes(q)) return 20;
    return 0;
  }

  const ORDER = ['Pages', 'Running now', 'Services', 'Startup apps', 'Actions'];

  function search(q) {
    q = q.trim().toLowerCase();
    const all = candidates();
    if (!q) return all.filter((x) => x.kind === 'Pages' || (x.kind === 'Actions' && /^(Run new task|Scan drive|Pause|Resume|Copy a system)/i.test(x.name)));
    const scored = all.map((x) => ({ x, s: score(x, q) })).filter((r) => r.s > 0);
    scored.sort((a, b) => b.s - a.s || (b.x.weight || 0) - (a.x.weight || 0));
    const per = new Map();
    const out = [];
    for (const { x } of scored) {
      const n = per.get(x.kind) || 0;
      if (n >= 6) continue;
      per.set(x.kind, n + 1);
      out.push(x);
    }
    return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  }

  function paint() {
    const list = rootEl.querySelector('.pal-list');
    if (!results.length) {
      list.innerHTML = '<div class="pal-empty">Nothing found. Try an app name, a service, a page or an action like “scan”.</div>';
      return;
    }
    let html = '';
    let kind = '';
    results.forEach((r, i) => {
      if (r.kind !== kind) {
        kind = r.kind;
        html += `<div class="pal-group">${U.esc(kind)}</div>`;
      }
      const lead = r.icon !== undefined ? U.icon(r.icon || null, r.win ? U.WIN_ICON : undefined) : U.glyph(r.glyph);
      html += `<div class="pal-item${i === sel ? ' on' : ''}" data-i="${i}">${lead}<span class="nm">${U.esc(r.name)}</span>${r.desc ? `<span class="ds">${U.esc(r.desc)}</span>` : ''}</div>`;
    });
    list.innerHTML = html;
    const on = list.querySelector('.pal-item.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function update() {
    results = search(rootEl.querySelector('input').value);
    sel = 0;
    paint();
  }

  function close() {
    if (!rootEl) return;
    U.$('#paletteRoot').innerHTML = '';
    rootEl = null;
    document.removeEventListener('keydown', onKey, true);
  }

  function run(i) {
    const r = results[i];
    close();
    if (r) r.run();
  }

  function onKey(e) {
    if (!rootEl) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!results.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      paint();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      run(sel);
    }
  }

  function open() {
    if (rootEl) return;
    // Lists that load on demand: start them now so their entries can be searched.
    if (!ServicesView.data) ServicesView.load();
    if (!StartupView.data) StartupView.load();
    U.$('#paletteRoot').innerHTML = `<div class="palette-backdrop"><div class="palette" role="dialog" aria-label="Search">
      <div class="in"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/></svg><input placeholder="Search apps, services, startup entries, pages and actions" spellcheck="false" /><kbd>Esc</kbd></div>
      <div class="pal-list"></div>
      <div class="pal-foot"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span></div></div></div>`;
    rootEl = U.$('#paletteRoot .palette-backdrop');
    const input = rootEl.querySelector('input');
    input.addEventListener('input', update);
    rootEl.addEventListener('mousedown', (e) => {
      if (e.target === rootEl) close();
    });
    rootEl.addEventListener('click', (e) => {
      const it = e.target.closest('[data-i]');
      if (it) run(Number(it.dataset.i));
    });
    rootEl.addEventListener('mousemove', (e) => {
      const it = e.target.closest('[data-i]');
      if (it && Number(it.dataset.i) !== sel) {
        sel = Number(it.dataset.i);
        rootEl.querySelectorAll('.pal-item').forEach((el) => el.classList.toggle('on', Number(el.dataset.i) === sel));
      }
    });
    document.addEventListener('keydown', onKey, true);
    update();
    input.focus();
  }

  return { open, close, get isOpen() {
    return !!rootEl;
  } };
})();
