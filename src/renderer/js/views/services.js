'use strict';
/* global U, App, syslens, Menu, Actions */

// Services: every Windows service, what it's doing, who made it and what it costs, with
// Start, Stop, Restart and startup type a right-click away.
const ServicesView = (() => {
  let root;
  let data = null;
  let loading = false;
  let lastPaint = 0;
  const st = { filter: 'running', q: '', sort: { key: 'name', dir: 1 }, sel: null, pids: null };

  function init(el) {
    root = el;
    root.innerHTML = `
      <div class="summary" id="sv-sum"><div class="loading">Reading services…</div></div>
      <div class="page-actions">
        <div class="search"><svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.38A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg><input id="sv-q" placeholder="Filter by name, description, publisher or PID" spellcheck="false" /></div>
        <div class="seg" id="sv-filter">
          <button data-f="running">Running</button>
          <button data-f="stopped">Stopped</button>
          <button data-f="thirdparty" data-tip="Services that don't come with Windows">Not Microsoft</button>
          <button data-f="all">All</button>
        </div>
        <span id="sv-pidchip"></span>
        <span class="spacer"></span>
        <div class="btn-group" id="sv-acts">
          <button class="btn sm" data-act="start" disabled>Start</button>
          <button class="btn sm" data-act="stop" disabled>Stop</button>
          <button class="btn sm" data-act="restart" disabled>Restart</button>
        </div>
        <button class="btn sm" data-settings="services">Open Services</button>
        <button class="btn sm" id="sv-refresh">Refresh</button>
      </div>
      <div class="list-wrap"><table class="list-table compact" id="sv-table"></table></div>`;
    root.addEventListener('click', (e) => {
      const f = e.target.closest('[data-f]');
      if (f) {
        st.filter = f.dataset.f;
        paint();
      }
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const key = th.dataset.sort;
        st.sort = st.sort.key === key ? { key, dir: -st.sort.dir } : { key, dir: key === 'mem' ? -1 : 1 };
        paint();
      }
      const s = e.target.closest('[data-settings]');
      if (s) syslens.openSettings(s.dataset.settings);
      if (e.target.closest('#sv-refresh')) load(true);
      if (e.target.closest('[data-clear-pids]')) {
        st.pids = null;
        paint();
      }
      const act = e.target.closest('[data-act]');
      if (act && st.sel) {
        const svc = find(st.sel);
        if (svc) Actions.serviceControl(svc, act.dataset.act).then((ok) => ok && load(true));
        return;
      }
      const pid = e.target.closest('[data-pid]');
      if (pid && App.snap) {
        const p = (App.snap.procs || []).find((x) => x.pid === Number(pid.dataset.pid));
        if (p) App.go('processes', { group: p.group, pid: p.pid });
        return;
      }
      const tr = e.target.closest('tr[data-svc]');
      if (tr) select(tr.dataset.svc);
    });
    root.addEventListener('contextmenu', (e) => {
      const tr = e.target.closest('tr[data-svc]');
      if (!tr) return;
      select(tr.dataset.svc);
      const svc = find(tr.dataset.svc);
      if (svc) Menu.openAt(e, Actions.serviceMenu(svc, () => load(true)));
    });
    U.$('#sv-q').addEventListener('input', (e) => {
      st.q = e.target.value.trim().toLowerCase();
      paint();
    });
  }

  const find = (name) => (data ? data.list.find((x) => x.name === name) : null);

  function select(name) {
    st.sel = name;
    U.$$('#sv-table tr[data-svc]').forEach((r) => r.classList.toggle('sel', r.dataset.svc === name));
    updateButtons();
  }

  function updateButtons() {
    const svc = st.sel ? find(st.sel) : null;
    const set = (act, on) => {
      const b = U.$(`#sv-acts [data-act="${act}"]`);
      if (b) b.disabled = !on;
    };
    set('start', svc && !svc.running && svc.startType !== 'Disabled');
    set('stop', svc && svc.running);
    set('restart', svc && svc.running);
  }

  async function load(refresh = false) {
    if (loading) return;
    loading = true;
    try {
      data = await syslens.services(refresh);
    } catch {
      data = data || { list: [] };
    }
    loading = false;
    App.setCount('navServicesCount', data.list.filter((x) => x.running).length);
    paint();
  }

  function show(opts = {}) {
    if (opts.q != null) {
      st.q = String(opts.q).toLowerCase();
      st.filter = 'all';
      U.$('#sv-q').value = opts.q;
    }
    if (opts.pids) {
      st.pids = new Set(opts.pids);
      st.filter = 'all';
      st.q = '';
      U.$('#sv-q').value = '';
    }
    // Service states change rarely; refresh when the page is opened if the list is old.
    if (!data || Date.now() - data.at > 30000) load(!!data);
    else paint();
  }

  function paint() {
    if (!root || !data) return;
    lastPaint = Date.now();
    U.$$('#sv-filter button').forEach((b) => b.classList.toggle('on', b.dataset.f === st.filter && !st.pids));
    const procs = new Map(((App.snap && App.snap.procs) || []).map((p) => [p.pid, p]));
    const all = data.list;
    const running = all.filter((x) => x.running);
    const third = all.filter((x) => !x.isWindows);
    const thirdRunning = third.filter((x) => x.running);
    // Memory of the processes hosting third-party services (each counted once).
    const pids = new Set(thirdRunning.map((x) => x.pid).filter(Boolean));
    let thirdMem = 0;
    for (const pid of pids) thirdMem += (procs.get(pid) || { priv: 0 }).priv;
    U.$('#sv-sum').innerHTML = `
      <div class="sum"><div class="v">${running.length} <small>of ${all.length}</small></div><div class="k">services running</div></div>
      <div class="sum"><div class="v">${thirdRunning.length} <small>of ${third.length}</small></div><div class="k">running services not from Microsoft</div></div>
      <div class="sum"><div class="v">${U.bytes(thirdMem)}</div><div class="k">memory those use</div></div>
      <div class="sum"><div class="v">${all.filter((x) => x.auto).length}</div><div class="k">set to start automatically</div></div>
      <div class="note">Right-click a service to start, stop or restart it, or change how it starts. Most services need SysLens to run as administrator for that.</div>`;

    U.$('#sv-pidchip').innerHTML = st.pids ? `<button class="chip on" data-clear-pids title="Show all services">In PID ${[...st.pids].slice(0, 3).join(', ')}${st.pids.size > 3 ? '…' : ''} ✕</button>` : '';
    let list = st.pids ? all.filter((x) => st.pids.has(x.pid)) : all.filter((x) => (st.filter === 'running' ? x.running : st.filter === 'stopped' ? !x.running : st.filter === 'thirdparty' ? !x.isWindows : true));
    if (st.q) list = list.filter((x) => `${x.display} ${x.name} ${x.description} ${x.company} ${x.pid || ''} ${x.group}`.toLowerCase().includes(st.q));
    const mem = (x) => (x.pid && procs.get(x.pid) ? procs.get(x.pid).priv : -1);
    const key = { name: (x) => x.display.toLowerCase(), svc: (x) => x.name.toLowerCase(), status: (x) => x.state, start: (x) => x.startType, mem, account: (x) => x.account, company: (x) => (x.company || '~').toLowerCase() }[st.sort.key];
    list.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * st.sort.dir || a.display.localeCompare(b.display);
    });
    const th = (k, label, w, cls = '') => `<th class="sortable${st.sort.key === k ? ' sorted' : ''} ${cls}" data-sort="${k}" ${w ? `style="width:${w}"` : ''}>${label}${st.sort.key === k ? (st.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
    const rows = list
      .map((x) => {
        const p = x.pid ? procs.get(x.pid) : null;
        const host = x.group ? `svchost (${x.group})` : x.exe ? x.exe.split('\\').pop() : '';
        const tip = [x.display, x.description, host && `Runs in ${host}`, x.command].filter(Boolean).join('\n\n');
        return `<tr class="hov${x.running ? '' : ' dim'}${st.sel === x.name ? ' sel' : ''}" data-svc="${U.esc(x.name)}" data-tip="${U.esc(tip)}">
          <td class="nm1">${U.esc(x.display)}</td>
          <td class="faint ellipsis">${U.esc(x.name)}</td>
          <td>${x.running ? U.status('Running', 'ok') : x.state === 'Stopped' ? U.status('Stopped', 'off') : U.status(x.state, 'warn')}</td>
          <td class="${x.startType === 'Disabled' ? 'faint' : ''}">${U.esc(x.startType)}</td>
          <td class="r">${p ? `<button class="link" data-pid="${p.pid}">${U.bytes(p.priv)}</button> <span class="faint">· ${p.pid}</span>` : x.pid ? `<span class="faint">PID ${x.pid}</span>` : '<span class="faint">—</span>'}</td>
          <td class="faint ellipsis">${U.esc(x.account)}</td>
          <td class="ellipsis">${x.isWindows ? '<span class="faint">Microsoft</span>' : U.esc(x.company || 'Unknown')}</td></tr>`;
      })
      .join('');
    U.$('#sv-table').innerHTML = `<thead><tr>${th('name', 'Service', '27%')}${th('svc', 'Name', '13%')}${th('status', 'Status', '96px')}${th('start', 'Startup type', '140px')}${th('mem', 'Memory · PID', '122px', 'r')}${th('account', 'Account', '11%')}${th('company', 'Publisher')}</tr></thead><tbody>${
      rows || `<tr><td colspan="7" class="empty">${loading ? 'Reading…' : 'Nothing matches.'}</td></tr>`
    }</tbody>`;
    if (st.sel && !find(st.sel)) st.sel = null;
    updateButtons();
  }

  function onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    if (((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') && st.sel) {
      e.preventDefault();
      const svc = find(st.sel);
      const row = U.$(`#sv-table tr[data-svc="${CSS.escape(st.sel)}"]`);
      if (svc && row) Menu.openAt({ target: row.firstElementChild }, Actions.serviceMenu(svc, () => load(true)));
    } else if ((e.ctrlKey && e.key.toLowerCase() === 'f') || e.key === '/') {
      e.preventDefault();
      U.$('#sv-q').focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = U.$$('#sv-table tr[data-svc]');
      if (!rows.length) return;
      e.preventDefault();
      const i = rows.findIndex((r) => r.dataset.svc === st.sel);
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      select(next.dataset.svc);
      next.scrollIntoView({ block: 'nearest' });
    }
  }

  function hide() {
    const t = U.$('#sv-table');
    if (t) t.innerHTML = '';
    lastPaint = 0;
  }

  return {
    init,
    render: () => {
      if (data && Date.now() - lastPaint > 5000) paint();
    },
    show,
    hide,
    load,
    onKey,
    get data() {
      return data;
    },
    title: 'Services',
  };
})();
