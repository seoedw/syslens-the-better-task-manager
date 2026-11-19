'use strict';
/* global U, App, syslens */

// Startup apps: everything that starts with Windows, whether it's on, and what it costs now.
const StartupView = (() => {
  let root;
  let data = null;
  let loading = false;
  const st = { filter: 'enabled', q: '' };

  function init(el) {
    root = el;
    root.innerHTML = `
      <div class="summary" id="su-sum"><div class="loading">Reading startup entries…</div></div>
      <div class="page-actions">
        <div class="search"><svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.38A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg><input id="su-q" placeholder="Filter by name, publisher or command" spellcheck="false" /></div>
        <div class="seg" id="su-filter">
          <button data-f="enabled">Starts with Windows</button>
          <button data-f="disabled">Turned off</button>
          <button data-f="all">All</button>
        </div>
        <span class="spacer"></span>
        <button class="btn sm" data-settings="startup">Startup settings</button>
        <button class="btn sm" id="su-refresh">Refresh</button>
      </div>
      <div class="list-wrap"><table class="list-table" id="su-table"></table></div>`;
    root.addEventListener('click', (e) => {
      const f = e.target.closest('[data-f]');
      if (f) {
        st.filter = f.dataset.f;
        render();
      }
      const s = e.target.closest('[data-settings]');
      if (s) syslens.openSettings(s.dataset.settings);
      if (e.target.closest('#su-refresh')) load(true);
      const loc = e.target.closest('[data-loc]');
      if (loc) syslens.showItem(loc.dataset.loc);
      const g = e.target.closest('[data-group]');
      if (g) App.go('processes', { group: g.dataset.group });
    });
    U.$('#su-q').addEventListener('input', (e) => {
      st.q = e.target.value.trim().toLowerCase();
      render();
    });
  }

  async function load(refresh = false) {
    if (loading) return;
    loading = true;
    try {
      data = await syslens.startup(refresh);
    } catch {
      data = data || { list: [] };
    }
    loading = false;
    App.setCount('navStartupCount', data.list.filter((x) => x.enabled).length);
    render();
  }

  function show(opts = {}) {
    if (opts.q != null) {
      st.q = String(opts.q).toLowerCase();
      st.filter = 'all';
      U.$('#su-q').value = opts.q;
    }
    if (!data) load(false);
    else render();
  }

  /** The running app group for a startup entry: matched by exe path, or package for Store apps. */
  function runningGroup(item, groups) {
    if (item.exe) {
      const k = item.exe.toLowerCase();
      return groups.find((g) => g.path && g.path.toLowerCase() === k) || null;
    }
    if (item.pkg) {
      const k = item.pkg.toLowerCase();
      return groups.find((g) => g.path && g.path.toLowerCase().includes(`\\${k}_`)) || null;
    }
    return null;
  }

  function render() {
    if (!root || !data) return;
    U.$$('#su-filter button').forEach((b) => b.classList.toggle('on', b.dataset.f === st.filter));
    const groups = (App.snap && App.snap.groups) || [];
    const items = data.list.map((it) => ({ ...it, run: runningGroup(it, groups) }));
    const enabled = items.filter((x) => x.enabled);
    const running = enabled.filter((x) => x.run);
    const seen = new Set();
    const cost = running.reduce((sum, x) => (seen.has(x.run.key) ? sum : (seen.add(x.run.key), sum + x.run.priv)), 0);
    U.$('#su-sum').innerHTML = `
      <div class="sum"><div class="v">${enabled.length} <small>of ${items.length}</small></div><div class="k">start with Windows</div></div>
      <div class="sum"><div class="v">${running.length}</div><div class="k">of those are running now</div></div>
      <div class="sum"><div class="v">${U.bytes(cost)}</div><div class="k">memory they use right now</div></div>
      <div class="sum"><div class="v">${items.length - enabled.length}</div><div class="k">turned off</div></div>
      <div class="note">SysLens shows these read-only. To stop something from starting with Windows, use <button class="link" data-settings="startup">Settings › Apps › Startup</button> or the app’s own settings. Scheduled tasks that run at sign-in are listed too, since they start apps the same way.</div>`;

    let list = items.filter((x) => (st.filter === 'enabled' ? x.enabled : st.filter === 'disabled' ? !x.enabled : true));
    if (st.q) list = list.filter((x) => `${x.name} ${x.publisher} ${x.description} ${x.command} ${x.where}`.toLowerCase().includes(st.q));
    list.sort((a, b) => Number(!!b.run) - Number(!!a.run) || (b.run ? b.run.priv : 0) - (a.run ? a.run.priv : 0) || a.name.localeCompare(b.name));
    // Entries registered under an ID ("GoogleChromeAutoLaunch_CAF4…", "electron.app.Notion") read
    // better by the program's own name, with the entry name underneath.
    const opaque = (n) => /[0-9a-f]{12,}/i.test(n) || /^[a-z0-9]+(\.[a-z0-9]+){2,}$/i.test(n) || /^[A-Za-z0-9]+_[A-Za-z0-9_]+$/.test(n);
    const rows = list
      .map((x) => {
        const title = opaque(x.name) && x.description ? x.description : x.name;
        const sub = [x.publisher, title !== x.name ? x.name : x.description && x.description !== x.name ? x.description : ''].filter(Boolean).join(' · ');
        const loc = x.exe || x.file;
        return `<tr class="hov${x.enabled ? '' : ' dim'}">
          <td><div class="appcell">${U.icon(x.exe || null)}<div class="two-line"><span class="nm">${U.esc(title)}</span><span class="sub">${U.esc(sub || '—')}</span></div></div></td>
          <td>${x.enabled ? U.status(x.policy ? 'On (set by policy)' : 'On', 'ok') : U.status('Off', 'off')}</td>
          <td class="r">${x.run ? `<button class="link" data-group="${U.esc(x.run.key)}">${U.bytes(x.run.priv)}</button>${x.run.count > 1 ? ` <span class="faint">· ${x.run.count}</span>` : ''}` : '<span class="faint">Not running</span>'}</td>
          <td class="faint ellipsis">${U.esc(x.where)}</td>
          <td class="ellipsis" data-tip="${U.esc(x.command)}"><span class="mono faint">${U.esc(x.command)}</span></td>
          <td class="r">${loc ? `<button class="btn sm" data-loc="${U.esc(loc)}">Show</button>` : ''}</td></tr>`;
      })
      .join('');
    U.$('#su-table').innerHTML = `<thead><tr><th style="width:30%">Name</th><th style="width:118px">Status</th><th class="r" style="width:120px">Running now</th><th style="width:19%">Starts from</th><th>Command</th><th style="width:64px"></th></tr></thead><tbody>${
      rows || `<tr><td colspan="6" class="empty">${loading ? 'Reading…' : 'Nothing here.'}</td></tr>`
    }</tbody>`;
  }

  return {
    init,
    // Re-render now and then so "Running now" stays current, without rebuilding every second.
    render: (() => {
      let last = 0;
      return () => {
        if (Date.now() - last > 5000) {
          last = Date.now();
          render();
        }
      };
    })(),
    show,
    load,
    get data() {
      return data;
    },
    title: 'Startup apps',
  };
})();
