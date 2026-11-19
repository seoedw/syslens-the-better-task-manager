'use strict';
/* global U, App, syslens, Menu, Actions, Charts, ServicesView */

const Processes = (() => {
  let root;
  let snap = null;
  let groupByKey = new Map();
  let procByPid = new Map();
  let order = [];
  let drawerRenderedAt = 0;
  let drawerSelKey = null;
  // Recent CPU/memory of whatever is selected, for the sparklines in the details panel.
  const trail = { key: null, cpu: [], priv: [] };
  // Network connections of the selected process, refreshed every few seconds.
  const net = { pid: null, list: null, at: 0, loading: false };

  const st = {
    mode: 'grouped',
    modeFrom: null, // the "Default view" setting the mode was last taken from
    filter: 'all',
    q: '',
    sort: { key: 'priv', dir: -1 },
    expanded: new Set(),
    collapsed: new Set(),
    sel: null, // { kind: 'group', key } | { kind: 'proc', pid }
    details: null,
    detailsPid: null,
    detailsAt: 0,
  };

  const COLS = [
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Status', width: 100, left: true, tip: 'Suspended: paused, using no processor time.\nEfficiency mode: low priority on power-efficient cores.' },
    { key: 'pid', label: 'PID', width: 70, flat: true },
    { key: 'cpu', label: 'CPU', width: 72 },
    { key: 'priv', label: 'Memory', width: 94, tip: 'Private working set — RAM only this app uses.\nSame number as Task Manager’s Memory column.' },
    { key: 'gpu', label: 'GPU', width: 62 },
    { key: 'gpuMem', label: 'GPU memory', width: 96, tip: 'Shared + dedicated GPU memory this app has mapped.\nIncludes surfaces shared with other apps (the desktop compositor maps every window), so rows can add up to more than the total.' },
    { key: 'io', label: 'Disk & I/O', width: 92, tip: 'Read + write + other I/O per second.\nIncludes file, network and device I/O.' },
    { key: 'handles', label: 'Handles', width: 76 },
    { key: 'threads', label: 'Threads', width: 70 },
    { key: 'priority', label: 'Priority', width: 104, left: true },
    { key: 'started', label: 'Running for', width: 100, tip: 'How long ago it started' },
    { key: 'publisher', label: 'Publisher', width: 160, left: true },
  ];
  const PRIO_RANK = { Low: 1, 'Below normal': 2, Normal: 3, 'Above normal': 4, High: 5, Realtime: 6 };
  const LEAF = '<svg class="st-ico" viewBox="0 0 24 24"><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19c3-4 6-6 9-8"/></svg>';
  const PAUSE = '<svg class="st-ico" viewBox="0 0 24 24"><rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/></svg>';

  /** The processes behind an app row. */
  const membersOf = (g) => g.pids.map((pid) => procByPid.get(pid)).filter(Boolean);
  function priorityOf(r) {
    if (r.pid) return r.priority || '';
    const set = new Set(membersOf(r).map((p) => p.priority).filter(Boolean));
    return set.size === 1 ? [...set][0] : set.size ? 'Mixed' : '';
  }
  function startedOf(r) {
    if (r.pid) return r.created || 0;
    let t = 0;
    for (const p of membersOf(r)) if (p.created && (!t || p.created < t)) t = p.created;
    return t;
  }

  const VAL = {
    name: (r) => (r.name && !r.pid ? r.name : r.display || r.name || '').toLowerCase(),
    status: (r) => (r.suspended ? 2 : r.eco ? 1 : 0),
    priority: (r) => PRIO_RANK[priorityOf(r)] || 0,
    started: (r) => -(startedOf(r) || 0),
    publisher: (r) => (r.company || '~').toLowerCase(),
    pid: (r) => r.pid || 0,
    cpu: (r) => r.cpu,
    priv: (r) => r.priv,
    gpu: (r) => r.gpu,
    gpuMem: (r) => r.gpuShared + r.gpuDedicated,
    io: (r) => r.io,
    handles: (r) => r.handles,
    threads: (r) => r.threads,
  };

  const FMT = {
    status: (r) => (r.suspended ? `<span class="st paused">${PAUSE}Suspended</span>` : r.eco ? `<span class="st eco" data-tip="Efficiency mode">${LEAF}Efficiency</span>` : ''),
    priority: (r) => U.esc(priorityOf(r)),
    started: (r) => {
      const t = startedOf(r);
      return t ? U.span(Date.now() - t) : '';
    },
    publisher: (r) => U.esc(r.company || ''),
    pid: (r) => (r.pid ? r.pid : ''),
    cpu: (r) => (r.cpu >= 0.05 ? `${r.cpu.toFixed(1)}%` : '0%'),
    priv: (r) => U.bytes(r.priv),
    gpu: (r) => (r.gpu >= 0.05 ? `${r.gpu.toFixed(1)}%` : '0%'),
    gpuMem: (r) => (r.gpuShared + r.gpuDedicated > 0 ? U.bytes(r.gpuShared + r.gpuDedicated) : '—'),
    io: (r) => U.rate(r.io),
    handles: (r) => U.num(r.handles),
    threads: (r) => U.num(r.threads),
  };

  const HEAT = {
    cpu: (r) => U.heat(r.cpu, 40),
    priv: (r) => U.heat(r.priv, 1.5 * U.GB),
    gpu: (r) => U.heat(r.gpu, 40),
    gpuMem: (r) => U.heat(r.gpuShared + r.gpuDedicated, U.GB),
    io: (r) => U.heat(r.io, 20 * U.MB),
  };

  function visibleCols() {
    const hidden = new Set((App.settings && App.settings.hiddenColumns) || []);
    return COLS.filter((c) => c.key === 'name' || ((!c.flat || st.mode !== 'grouped') && !hidden.has(c.key)));
  }
  const heatOn = () => !App.settings || App.settings.heat !== false;

  function init(el) {
    root = el;
    root.classList.add('fill');
    root.innerHTML = `
      <div class="proc-layout">
        <div class="proc-main">
          <div class="toolbar">
            <div class="search"><svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.38A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg>
              <input id="pr-q" placeholder="Search name, PID, path or window title" spellcheck="false" /></div>
            <div class="seg" id="pr-mode">
              <button data-mode="grouped" data-tip="One row per app, with its helper processes inside">By app</button>
              <button data-mode="flat" data-tip="Every process on its own row">All processes</button>
              <button data-mode="tree" data-tip="Processes nested under the process that started them">Tree</button>
            </div>
            <div id="pr-filters" style="display:flex;gap:6px"></div>
            <div class="spacer"></div>
            <button class="btn danger" id="pr-end" disabled title="End task (Delete)">End task</button>
            <button class="btn" id="pr-more" title="More actions">More ▾</button>
          </div>
          <div class="table-wrap" id="pr-wrap"><table class="grid-table"><colgroup id="pr-cols"></colgroup><thead id="pr-head"></thead><tbody id="pr-body"></tbody></table></div>
          <div class="status-line" id="pr-status"></div>
        </div>
        <aside class="drawer" id="pr-drawer"></aside>
      </div>`;

    U.$('#pr-q').addEventListener('input', (e) => {
      st.q = e.target.value.trim().toLowerCase();
      renderTable();
    });
    U.$('#pr-mode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      st.mode = b.dataset.mode;
      if (st.mode === 'grouped' && st.sort.key === 'pid') st.sort = { key: 'priv', dir: -1 };
      renderAll();
    });
    U.$('#pr-filters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      st.filter = b.dataset.filter;
      renderAll();
    });
    U.$('#pr-head').addEventListener('click', (e) => {
      const th = e.target.closest('[data-sort]');
      if (!th) return;
      const key = th.dataset.sort;
      st.sort = st.sort.key === key ? { key, dir: -st.sort.dir } : { key, dir: key === 'name' ? 1 : -1 };
      renderTable();
    });
    const body = U.$('#pr-body');
    body.addEventListener('click', (e) => {
      const caret = e.target.closest('[data-toggle]');
      if (caret) {
        toggle(caret.dataset.toggle);
        return;
      }
      const tr = e.target.closest('tr[data-k]');
      if (tr) select(tr.dataset.k);
    });
    body.addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr[data-k]');
      if (tr && tr.dataset.t) toggle(tr.dataset.t);
    });
    U.$('#pr-end').addEventListener('click', () => endSelected());
    U.$('#pr-more').addEventListener('click', (e) => Menu.openAt({ target: e.currentTarget }, toolbarMenu()));
    body.addEventListener('contextmenu', (e) => {
      const tr = e.target.closest('tr[data-k]');
      if (!tr) return;
      if (selKey() !== tr.dataset.k) select(tr.dataset.k);
      const item = selectedItem();
      if (item) Menu.openAt(e, Actions.processMenu(item, rowExtras()));
    });
    U.$('#pr-head').addEventListener('contextmenu', (e) => Menu.openAt(e, columnsMenu()));
    U.$('#pr-drawer').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) {
        st.sel = null;
        renderAll();
      } else if (e.target.closest('[data-end]')) {
        endSelected();
      } else if (e.target.closest('[data-actions]')) {
        const item = selectedItem();
        if (item) Menu.openAt({ target: e.target.closest('[data-actions]') }, Actions.processMenu(item, rowExtras()));
      } else if (e.target.closest('[data-loc]')) {
        syslens.showItem(e.target.closest('[data-loc]').dataset.loc);
      } else if (e.target.closest('[data-pick]')) {
        select(`p:${e.target.closest('[data-pick]').dataset.pick}`);
      }
    });
  }

  // ---------- data helpers ----------
  function reindex() {
    groupByKey = new Map(snap.groups.map((g) => [g.key, g]));
    procByPid = new Map(snap.procs.map((p) => [p.pid, p]));
  }

  function typeOf(p) {
    const g = groupByKey.get(p.group);
    return g ? g.type : 'background';
  }

  function matchProc(p, q) {
    return (
      p.name.toLowerCase().includes(q) ||
      (p.display || '').toLowerCase().includes(q) ||
      String(p.pid) === q ||
      (p.path || '').toLowerCase().includes(q) ||
      (p.role || '').toLowerCase().includes(q) ||
      (p.windows || []).some((t) => t.toLowerCase().includes(q))
    );
  }

  function matchGroup(g, q) {
    return g.name.toLowerCase().includes(q) || g.exe.includes(q) || (g.path || '').toLowerCase().includes(q);
  }

  function cmp(a, b) {
    const k = st.sort.key;
    const va = VAL[k](a);
    const vb = VAL[k](b);
    if (va < vb) return -st.sort.dir;
    if (va > vb) return st.sort.dir;
    return VAL.name(a) < VAL.name(b) ? -1 : 1;
  }

  const sorted = (list) => list.slice().sort(cmp);

  // ---------- rows ----------
  function cells(r) {
    return visibleCols()
      .filter((c) => c.key !== 'name')
      .map((c) => `<td${c.left ? ' class="l"' : ''} ${HEAT[c.key] && heatOn() ? HEAT[c.key](r) : ''}>${FMT[c.key](r)}</td>`)
      .join('');
  }

  const isSel = (k) => st.sel && selKey() === k;

  function selKey() {
    if (!st.sel) return null;
    return st.sel.kind === 'group' ? `g:${st.sel.key}` : `p:${st.sel.pid}`;
  }

  function groupRow(g, open) {
    const k = g.count === 1 ? `p:${g.pids[0]}` : `g:${g.key}`;
    const fallback = g.type === 'windows' ? U.WIN_ICON : undefined;
    return `<tr data-k="${U.esc(k)}" ${g.count > 1 ? `data-t="${U.esc(g.key)}"` : ''} class="${isSel(k) ? 'sel' : ''}">
      <td><div class="namecell"><span class="caret ${g.count > 1 ? (open ? 'open' : '') : 'none'}" data-toggle="${U.esc(g.key)}">▶</span>${U.icon(g.path, fallback)}<span class="nm">${U.esc(g.name)}</span>${
        g.count > 1 ? `<span class="cnt">(${g.count})</span>` : ''
      }</div></td>${cells(g)}</tr>`;
  }

  function childRow(p) {
    const k = `p:${p.pid}`;
    const label = p.role || (p.windows && p.windows[0]) || p.display;
    return `<tr data-k="${k}" class="child ${isSel(k) ? 'sel' : ''}"><td><div class="namecell"><span class="nm">${U.esc(label)}</span><span class="role">PID ${p.pid}</span></div></td>${cells(p)}</tr>`;
  }

  function flatRow(p, depth = null, hasKids = false, open = true) {
    const k = `p:${p.pid}`;
    const fallback = p.isWindows ? U.WIN_ICON : undefined;
    const indent = depth == null ? '' : `style="padding-left:${10 + depth * 18}px"`;
    const caret = depth == null ? '' : `<span class="caret ${hasKids ? (open ? 'open' : '') : 'none'}" data-toggle="t:${p.pid}">▶</span>`;
    const sub = p.role || (p.windows && p.windows[0]) || '';
    return `<tr data-k="${k}" ${hasKids ? `data-t="t:${p.pid}"` : ''} class="${isSel(k) ? 'sel' : ''}"><td ${indent}><div class="namecell">${caret}${U.icon(p.path, fallback)}<span class="nm">${U.esc(p.display)}</span>${
      sub ? `<span class="role">${U.esc(sub)}</span>` : ''
    }</div></td>${cells(p)}</tr>`;
  }

  function rowsGrouped(q) {
    const out = [];
    const groups = snap.groups.filter((g) => st.filter === 'all' || g.type === st.filter);
    const entries = [];
    for (const g of groups) {
      const members = g.pids.map((pid) => procByPid.get(pid)).filter(Boolean);
      const gm = !q || matchGroup(g, q);
      const mm = gm ? members : members.filter((p) => matchProc(p, q));
      if (gm || mm.length) entries.push({ g, members: mm, autoOpen: !gm });
    }
    entries.sort((a, b) => cmp(a.g, b.g));
    for (const { g, members, autoOpen } of entries) {
      const open = g.count > 1 && (st.expanded.has(g.key) || autoOpen);
      out.push(groupRow(g, open));
      order.push(g.count === 1 ? `p:${g.pids[0]}` : `g:${g.key}`);
      if (open) {
        for (const p of sorted(members)) {
          out.push(childRow(p));
          order.push(`p:${p.pid}`);
        }
      }
    }
    return out;
  }

  function rowsFlat(q) {
    const list = snap.procs.filter((p) => (st.filter === 'all' || typeOf(p) === st.filter) && (!q || matchProc(p, q)));
    return sorted(list).map((p) => {
      order.push(`p:${p.pid}`);
      return flatRow(p);
    });
  }

  function rowsTree(q) {
    const kids = new Map();
    const roots = [];
    for (const p of snap.procs) {
      const parent = procByPid.get(p.ppid);
      if (parent && parent.pid !== p.pid && parent.created <= p.created) {
        if (!kids.has(parent.pid)) kids.set(parent.pid, []);
        kids.get(parent.pid).push(p);
      } else {
        roots.push(p);
      }
    }
    const keep = new Map();
    const visible = (p) => {
      if (keep.has(p.pid)) return keep.get(p.pid);
      keep.set(p.pid, false);
      const self = (st.filter === 'all' || typeOf(p) === st.filter) && (!q || matchProc(p, q));
      const anyKid = (kids.get(p.pid) || []).map(visible).some(Boolean);
      keep.set(p.pid, self || anyKid);
      return self || anyKid;
    };
    const out = [];
    const walk = (list, depth) => {
      for (const p of sorted(list)) {
        if (!visible(p)) continue;
        const children = kids.get(p.pid) || [];
        const open = !st.collapsed.has(`t:${p.pid}`) || !!q;
        out.push(flatRow(p, depth, children.length > 0, open));
        order.push(`p:${p.pid}`);
        if (open && children.length) walk(children, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }

  // ---------- rendering ----------
  function renderAll() {
    if (!snap) return;
    U.$$('#pr-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === st.mode));
    renderFilters();
    renderTable();
    renderDrawer(true);
  }

  function renderFilters() {
    const counts = { all: snap.groups.length, app: 0, background: 0, windows: 0 };
    for (const g of snap.groups) counts[g.type]++;
    const chip = (key, label) => `<button class="chip ${st.filter === key ? 'on' : ''}" data-filter="${key}">${label}<span class="n">${counts[key]}</span></button>`;
    const html = chip('all', 'All') + chip('app', 'Apps') + chip('background', 'Background') + chip('windows', 'Windows');
    const el = U.$('#pr-filters');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function renderHead() {
    const cols = visibleCols();
    const colsHtml = cols.map((c) => `<col style="width:${c.width ? `${c.width}px` : 'auto'}">`).join('');
    const colEl = U.$('#pr-cols');
    if (colEl.innerHTML !== colsHtml) {
      colEl.innerHTML = colsHtml;
      colEl.parentElement.style.minWidth = `${cols.reduce((sum, c) => sum + (c.width || 0), 0) + 200}px`;
    }
    const gpuMax = Math.max(0, ...snap.gpus.map((g) => g.util));
    const totalIo = snap.procs.reduce((s, p) => s + p.io, 0);
    const gpuMem = snap.gpus.reduce((s, g) => s + g.shared + g.dedicated, 0);
    const pausedN = snap.groups.filter((g) => g.suspended).length;
    const ecoN = snap.groups.filter((g) => g.eco).length;
    const totals = {
      name: '',
      status: [pausedN && `${pausedN} paused`, ecoN && `${ecoN} eco`].filter(Boolean).join(' · '),
      priority: '',
      started: '',
      publisher: '',
      pid: '',
      cpu: `${snap.cpu.total.toFixed(0)}%`,
      priv: `${Math.round((snap.mem.inUse / snap.mem.total) * 100)}%`,
      gpu: `${gpuMax.toFixed(0)}%`,
      gpuMem: U.bytes(gpuMem),
      io: U.rate(totalIo),
      handles: U.num(snap.totals.handles),
      threads: U.num(snap.totals.threads),
    };
    U.$('#pr-head').innerHTML = `<tr>${cols
      .map((c) => {
        const on = st.sort.key === c.key;
        const arrow = on ? `<span class="arrow">${st.sort.dir > 0 ? '▲' : '▼'}</span>` : '';
        return `<th data-sort="${c.key}" class="${on ? 'sorted' : ''}${c.left ? ' l' : ''}" ${c.tip ? `data-tip="${U.esc(c.tip)}"` : ''}><span class="total">${totals[c.key] || '&nbsp;'}</span>${c.label}${arrow}</th>`;
      })
      .join('')}</tr>`;
  }

  function renderTable() {
    if (!snap) return;
    renderHead();
    order = [];
    const q = st.q;
    const rows = st.mode === 'grouped' ? rowsGrouped(q) : st.mode === 'flat' ? rowsFlat(q) : rowsTree(q);
    U.$('#pr-body').innerHTML = rows.length ? rows.join('') : `<tr><td colspan="${visibleCols().length}"><div class="empty">No processes match “${U.esc(st.q)}”.</div></td></tr>`;
    U.$('#pr-end').disabled = !st.sel;
    const shown = st.mode === 'grouped' ? `${rows.length} rows` : `${order.length} processes`;
    U.$('#pr-status').innerHTML = `<span><b>${U.num(snap.totals.processes)}</b> processes</span><span><b>${U.num(snap.totals.threads)}</b> threads</span><span><b>${U.num(snap.totals.handles)}</b> handles</span><span class="faint">${shown} shown</span><span class="faint" style="margin-left:auto">Memory = private working set (matches Task Manager)</span>`;
  }

  function toggle(key) {
    if (key.startsWith('t:')) {
      if (st.collapsed.has(key)) st.collapsed.delete(key);
      else st.collapsed.add(key);
    } else if (st.expanded.has(key)) {
      st.expanded.delete(key);
    } else {
      st.expanded.add(key);
    }
    renderTable();
  }

  function select(k) {
    if (!k) return;
    if (k.startsWith('g:')) st.sel = { kind: 'group', key: k.slice(2) };
    else st.sel = { kind: 'proc', pid: Number(k.slice(2)) };
    const pid = st.sel.kind === 'proc' ? st.sel.pid : (groupByKey.get(st.sel.key) || { pids: [] }).pids[0];
    if (pid != null) loadDetails(pid);
    renderTable();
    renderDrawer(true);
  }

  async function loadDetails(pid) {
    st.detailsPid = pid;
    st.details = null;
    const d = await syslens.details(pid);
    if (st.detailsPid !== pid) return;
    st.details = d;
    st.detailsAt = Date.now();
    renderDrawer(true);
  }

  function kv(rows) {
    return `<div class="kv">${rows
      .filter(Boolean)
      .map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`)
      .join('')}</div>`;
  }

  function aboutBlock(d) {
    if (st.sel && st.sel.kind === 'group' && st.sel.key === 'syslens') {
      return '<section><h4>What is this?</h4><div class="about">SysLens itself: its window (a lean Microsoft Edge app window), the server that reads the system, and the small launcher that restarts the server if it ever stops.</div></section>';
    }
    if (!d || !d.about) return '';
    return `<section><h4>What is this?</h4><div class="about">${U.esc(d.about)}</div></section>`;
  }

  function trackSelected() {
    if (!st.sel) {
      trail.key = null;
      return;
    }
    const item = st.sel.kind === 'group' ? groupByKey.get(st.sel.key) : procByPid.get(st.sel.pid);
    if (!item) return;
    const k = selKey();
    if (trail.key !== k) {
      trail.key = k;
      trail.cpu = [];
      trail.priv = [];
    }
    trail.cpu.push(item.cpu);
    trail.priv.push(item.priv);
    if (trail.cpu.length > 90) {
      trail.cpu.shift();
      trail.priv.shift();
    }
  }

  function sparksBlock() {
    return `<section><div class="sparks">
      <div class="sp"><div class="k">CPU <b id="pr-sp-cpu-v"></b></div><canvas id="pr-sp-cpu"></canvas></div>
      <div class="sp"><div class="k">Memory <b id="pr-sp-mem-v"></b></div><canvas id="pr-sp-mem"></canvas></div>
    </div></section>`;
  }

  function drawSparks() {
    const c = U.$('#pr-sp-cpu');
    if (!c || !trail.cpu.length) return;
    const pad = (arr) => (arr.length >= 2 ? arr : [arr[0], arr[0]]);
    Charts.line(c, { series: [{ data: pad(trail.cpu), color: '--c-cpu', width: 1.2 }], max: Math.max(10, ...trail.cpu) * 1.1, grid: false });
    Charts.line(U.$('#pr-sp-mem'), { series: [{ data: pad(trail.priv), color: '--c-mem', width: 1.2 }], max: Math.max(...trail.priv) * 1.15 || 1, grid: false });
    U.$('#pr-sp-cpu-v').textContent = `${trail.cpu[trail.cpu.length - 1].toFixed(1)}%`;
    U.$('#pr-sp-mem-v').textContent = U.bytes(trail.priv[trail.priv.length - 1]);
  }

  async function loadConnections(pid) {
    if (net.loading) return;
    net.loading = true;
    try {
      const list = await syslens.connections({ pid });
      if (st.sel && st.sel.kind === 'proc' && st.sel.pid === pid) {
        net.pid = pid;
        net.list = list;
        net.at = Date.now();
        renderDrawer(true);
      }
    } catch {
      /* not essential */
    }
    net.loading = false;
  }

  function connectionsBlock(pid) {
    if (net.pid !== pid || Date.now() - net.at > 5000) loadConnections(pid);
    if (net.pid !== pid || !net.list) return '';
    const list = net.list;
    if (!list.length) return '<section><h4>Network</h4><div class="faint">No open connections.</div></section>';
    const est = list.filter((c) => c.state === 'Established');
    const lis = list.filter((c) => c.state === 'Listening');
    const rows = [...est, ...lis]
      .slice(0, 8)
      .map(
        (c) => `<div class="conn-row"><span class="who" title="${U.esc(c.host || c.remote)}">${c.state === 'Listening' ? `Listening on port ${c.lport}` : U.esc(c.host || c.remote)}</span><span class="faint">${c.state === 'Listening' ? '' : `${c.rport}${c.service ? ` ${U.esc(c.service)}` : ''}`}</span></div>`,
      )
      .join('');
    return `<section><h4>Network <span class="faint">· ${est.length} connected${lis.length ? `, ${lis.length} listening` : ''}${list.length - est.length - lis.length > 0 ? `, ${list.length - est.length - lis.length} other` : ''}</span></h4>${rows}${
      est.length + lis.length > 8 ? '<div style="margin-top:4px"><button class="link" data-go="network">All connections</button></div>' : ''
    }</section>`;
  }

  function servicesBlock(pid) {
    const sv = typeof ServicesView !== 'undefined' && ServicesView.data;
    if (!sv) return '';
    const mine = sv.list.filter((x) => x.pid === pid);
    if (!mine.length) return '';
    return `<section><h4>Services in this process</h4>${mine
      .map((x) => `<div class="conn-row"><span class="who">${U.esc(x.display)}</span><span class="faint">${U.esc(x.name)}</span></div>`)
      .join('')}</section>`;
  }

  function windowsBlock(titles) {
    if (!titles || !titles.length) return '';
    return `<section><h4>Open windows</h4>${titles
      .slice(0, 8)
      .map((t) => `<div class="faint pii" style="margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" data-tip="${U.esc(t)}">${U.esc(t)}</div>`)
      .join('')}</section>`;
  }

  function memberList(procs) {
    return procs
      .slice(0, 60)
      .map(
        (p) => {
          // A window title can name a document or web page: "Hide personal info" blurs it.
          const title = !p.role && p.windows && p.windows[0];
          return `<div class="member" data-pick="${p.pid}"><span class="faint tabular">${p.pid}</span><span class="role${title ? ' pii' : ''}">${U.esc(p.role || title || p.display)}</span><span class="r">${U.bytes(p.priv)}</span></div>`;
        },
      )
      .join('');
  }

  function renderDrawer(force = false) {
    const drawer = U.$('#pr-drawer');
    if (!st.sel || !snap) {
      drawer.classList.remove('open');
      drawerSelKey = null;
      return;
    }
    // Don't clobber a text selection the user is making in the panel.
    const sel = window.getSelection();
    if (!force && sel && !sel.isCollapsed && drawer.contains(sel.anchorNode)) return;
    if (!force && drawerSelKey === selKey() && Date.now() - drawerRenderedAt < 1500) return;
    drawerRenderedAt = Date.now();
    drawerSelKey = selKey();
    drawer.classList.add('open');
    const d = st.details;
    let html;

    if (st.sel.kind === 'group') {
      const g = groupByKey.get(st.sel.key);
      if (!g) {
        drawer.innerHTML = `<div class="drawer-head"><div class="title">No longer running</div><button class="btn ghost sm x" data-close>✕</button></div>`;
        return;
      }
      const members = sorted(g.pids.map((pid) => procByPid.get(pid)).filter(Boolean)).sort((a, b) => b.priv - a.priv);
      html = `
        <div class="drawer-head">${U.icon(g.path, g.type === 'windows' ? U.WIN_ICON : undefined)}<div><div class="title">${U.esc(g.name)}</div>
          <div class="subtitle">${g.count} processes · ${U.esc(g.exe)}${g.company ? ` · ${U.esc(g.company)}` : ''}</div></div>
          <button class="btn ghost sm x" data-close title="Close">✕</button></div>
        <div class="drawer-actions"><button class="btn danger sm" data-end ${g.critical ? 'disabled' : ''}>End task (${g.count} processes)</button><button class="btn sm" data-actions>More ▾</button>${
          g.path ? `<button class="btn sm" data-loc="${U.esc(g.path)}">Open file location</button>` : ''
        }</div>
        ${sparksBlock()}
        ${aboutBlock(d)}
        <section><h4>Resources</h4>${kv([
          ['Memory (private)', U.bytes(g.priv)],
          ['Working set', `${U.bytes(g.ws)} <span class="faint">incl. shared</span>`],
          ['Commit', U.bytes(g.commit)],
          ['CPU', `${g.cpu.toFixed(1)}%`],
          ['GPU', `${g.gpu.toFixed(1)}%`],
          ['GPU memory', U.bytes(g.gpuShared + g.gpuDedicated)],
          ['I/O', U.rate(g.io)],
          ['Handles', U.num(g.handles)],
          ['Threads', U.num(g.threads)],
        ])}</section>
        ${windowsBlock(g.windows)}
        ${g.path ? `<section><h4>Location</h4><div class="codebox">${U.esc(g.path)}</div></section>` : ''}
        <section><h4>Processes <span style="text-transform:none;letter-spacing:0" class="faint">· largest first</span></h4>${memberList(members)}</section>`;
    } else {
      const p = procByPid.get(st.sel.pid);
      if (!p) {
        drawer.innerHTML = `<div class="drawer-head"><div><div class="title">Process ended</div><div class="subtitle">PID ${st.sel.pid} is no longer running.</div></div><button class="btn ghost sm x" data-close>✕</button></div>`;
        return;
      }
      if (Date.now() - st.detailsAt > 3000 && st.detailsPid === p.pid) loadDetails(p.pid);
      const kids = d && d.pid === p.pid ? d.children.map((c) => procByPid.get(c.pid)).filter(Boolean) : [];
      const parents = d && d.pid === p.pid ? d.parents : [];
      html = `
        <div class="drawer-head">${U.icon(p.path, p.isWindows ? U.WIN_ICON : undefined)}<div><div class="title">${U.esc(p.display)}</div>
          <div class="subtitle">${U.esc(p.name)} · PID ${p.pid}${p.company ? ` · ${U.esc(p.company)}` : ''}</div></div>
          <button class="btn ghost sm x" data-close title="Close">✕</button></div>
        <div class="drawer-actions"><button class="btn danger sm" data-end ${p.critical ? 'disabled' : ''}>End task</button><button class="btn sm" data-actions>More ▾</button>${
          p.path && !p.pathGuessed ? `<button class="btn sm" data-loc="${U.esc(p.path)}">Open file location</button>` : ''
        }</div>
        ${p.critical ? '<div class="notice warn"><svg viewBox="0 0 24 24"><path d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/></svg><div>Critical Windows process — ending it would crash Windows, so SysLens won’t.</div></div>' : ''}
        ${sparksBlock()}
        ${d && d.pid === p.pid ? aboutBlock(d) : ''}
        <section><h4>Resources</h4>${kv([
          ['Memory (private)', U.bytes(p.priv)],
          ['Working set', `${U.bytes(p.ws)} <span class="faint">peak ${U.bytes(p.peakWs)}</span>`],
          ['Commit', U.bytes(p.commit)],
          ['CPU', `${p.cpu.toFixed(1)}% <span class="faint">· ${U.dur(p.cpuTime * 1000)} total</span>`],
          ['GPU', `${p.gpu.toFixed(1)}%`],
          ['GPU memory', `${U.bytes(p.gpuShared)} shared · ${U.bytes(p.gpuDedicated)} dedicated`],
          ['I/O', `R ${U.rate(p.ioR)} · W ${U.rate(p.ioW)} · Other ${U.rate(p.ioO)}`],
          ['Total I/O', U.bytes(p.ioTotal)],
          ['Handles', U.num(p.handles)],
          ['Threads', U.num(p.threads)],
          ['Page faults', U.num(p.pageFaults)],
        ])}</section>
        <section><h4>Process</h4>${kv([
          p.role && ['Role', U.esc(p.role)],
          ['Started', p.created ? `${U.date(p.created)} <span class="faint">(${U.ago(p.created)})</span>` : 'At boot'],
          ['Priority', `${U.esc(p.priority || '—')}${p.eco ? ' <span class="st eco">' + LEAF + 'Efficiency mode</span>' : ''}${p.suspended ? ' <span class="st paused">' + PAUSE + 'Suspended</span>' : ''}`],
          ['Session', p.session === 0 ? '0 (services)' : String(p.session)],
          d && d.pid === p.pid && d.user && ['User', U.esc(App.settings && App.settings.fullAccount ? d.user : d.user.split('\\').pop())],
          d && d.pid === p.pid && d.integrity && ['Integrity', `${U.esc(d.integrity)}${d.elevated ? ' <span class="faint">· running as administrator</span>' : ''}`],
          d && d.pid === p.pid && d.arch && ['Architecture', U.esc(d.arch)],
          parents.length && ['Started by', parents.map((x) => `<button class="link" data-pick="${x.pid}">${U.esc(x.display)}</button>`).join(' ← ')],
          d && d.version && ['Version', U.esc(d.version)],
        ])}</section>
        ${servicesBlock(p.pid)}
        ${connectionsBlock(p.pid)}
        ${p.path ? `<section><h4>Path${p.pathGuessed ? ' <span class="faint" style="text-transform:none;letter-spacing:0">(from System32; exact path needs admin)</span>' : ''}</h4><div class="codebox">${U.esc(p.path)}</div></section>` : ''}
        ${
          d && d.pid === p.pid
            ? `<section><h4>Command line</h4><div class="codebox">${d.cmd ? U.esc(d.cmd) : `<span class="faint">${p.access ? 'Not available' : 'Needs administrator rights to read'}</span>`}</div></section>`
            : ''
        }
        ${windowsBlock(p.windows)}
        ${kids.length ? `<section><h4>Child processes</h4>${memberList(kids.sort((a, b) => b.priv - a.priv))}</section>` : ''}`;
    }
    drawer.innerHTML = html;
    drawSparks();
  }

  /** The selected row as an action target. */
  function selectedItem() {
    if (!st.sel || !snap) return null;
    if (st.sel.kind === 'group') {
      const g = groupByKey.get(st.sel.key);
      return g ? Actions.fromGroup(g) : null;
    }
    const p = procByPid.get(st.sel.pid);
    return p ? Actions.fromProc(p) : null;
  }

  function rowExtras() {
    const extra = [];
    if (st.sel && st.sel.kind === 'group') {
      const open = st.expanded.has(st.sel.key);
      extra.push({ label: open ? 'Collapse' : 'Expand', icon: 'list', kbd: 'Enter', run: () => toggle(st.sel.key) });
    }
    if (st.sel && st.sel.kind === 'proc' && st.mode !== 'tree') {
      const pid = st.sel.pid;
      extra.push({ label: 'Show in tree', icon: 'tree', run: () => showInTree(pid) });
    }
    return extra;
  }

  function showInTree(pid) {
    st.mode = 'tree';
    st.q = '';
    U.$('#pr-q').value = '';
    st.collapsed.clear();
    select(`p:${pid}`);
    renderAll();
    requestAnimationFrame(() => {
      const row = U.$(`#pr-body tr[data-k="p:${pid}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
    });
  }

  function columnsMenu() {
    const hidden = new Set((App.settings && App.settings.hiddenColumns) || []);
    const flip = (key) => {
      const next = new Set(hidden);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      App.saveSettings({ hiddenColumns: [...next] });
    };
    return [
      ...COLS.filter((c) => c.key !== 'name').map((c) => ({ label: c.label, checked: !hidden.has(c.key), hint: c.flat ? 'not in By app' : '', run: () => flip(c.key) })),
      '-',
      { label: 'Reset columns', icon: 'restart', run: () => App.saveSettings({ hiddenColumns: ['priority', 'started', 'publisher'] }) },
    ];
  }

  function toolbarMenu() {
    const groups = snap ? snap.groups.filter((g) => g.count > 1) : [];
    return [
      { label: 'Run new task…', icon: 'start', kbd: 'Ctrl+N', run: () => Actions.runTask() },
      { label: 'Restart Windows Explorer', icon: 'restart', run: () => Actions.restartExplorer() },
      '-',
      st.mode === 'grouped' && { label: 'Expand all', icon: 'down', run: () => (groups.forEach((g) => st.expanded.add(g.key)), renderTable()) },
      st.mode === 'grouped' && { label: 'Collapse all', icon: 'up', run: () => (st.expanded.clear(), renderTable()) },
      { label: 'Copy this list', icon: 'copy', tip: 'Tab-separated: pastes straight into Excel', run: copyList },
      { label: 'Columns', icon: 'list', sub: columnsMenu() },
      '-',
      { label: 'Open Task Manager', icon: 'window', run: () => syslens.openSettings('taskmgr') },
      { label: 'Open Resource Monitor', icon: 'gauge', run: () => syslens.openSettings('resmon') },
    ].filter(Boolean);
  }

  /** The rows on screen, tab-separated with a header, for pasting into a spreadsheet. */
  function copyList() {
    const cols = visibleCols();
    const lines = [cols.map((c) => c.label).join('\t')];
    const strip = (html) => String(html).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    for (const k of order) {
      const r = k.startsWith('g:') ? groupByKey.get(k.slice(2)) : procByPid.get(Number(k.slice(2)));
      if (!r) continue;
      const name = r.pid ? r.display || r.name : r.name;
      lines.push(cols.map((c) => (c.key === 'name' ? name : strip(FMT[c.key](r)))).join('\t'));
    }
    U.copy(lines.join('\n'), `${lines.length - 1} rows copied`);
  }

  async function endSelected(tree = false) {
    const item = selectedItem();
    if (!item) return;
    const done = await Actions.endTask(item, { tree });
    if (done) {
      st.sel = null;
      renderAll();
    }
  }

  function onKey(e) {
    if (e.target.tagName === 'INPUT') {
      if (e.key === 'Escape') {
        e.target.value = '';
        st.q = '';
        e.target.blur();
        renderTable();
      }
      return;
    }
    if ((e.ctrlKey && e.key.toLowerCase() === 'f') || e.key === '/') {
      e.preventDefault();
      U.$('#pr-q').focus();
    } else if (e.key === 'Delete') {
      endSelected(e.shiftKey);
    } else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault();
      const item = selectedItem();
      const row = item && U.$(`#pr-body tr[data-k="${CSS.escape(selKey())}"]`);
      if (item && row) Menu.openAt({ target: row.querySelector('.nm') || row }, Actions.processMenu(item, rowExtras()));
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && st.sel && !String(window.getSelection() || '')) {
      const item = selectedItem();
      if (item) U.copy(item.name, 'Name copied');
    } else if (e.key === 'Escape') {
      st.sel = null;
      renderAll();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = order.indexOf(selKey());
      const next = order[Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        select(next);
        const row = U.$(`#pr-body tr[data-k="${next}"]`);
        if (row) row.scrollIntoView({ block: 'nearest' });
      }
    } else if ((e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') && st.sel && st.sel.kind === 'group') {
      const open = st.expanded.has(st.sel.key);
      if (e.key === 'Enter' || (e.key === 'ArrowRight') !== open) toggle(st.sel.key);
    }
  }

  function render(s) {
    snap = s;
    const want = App.settings && App.settings.processView;
    if (want && st.modeFrom !== want) {
      st.modeFrom = want;
      st.mode = want;
      if (st.mode === 'grouped' && st.sort.key === 'pid') st.sort = { key: 'priv', dir: -1 };
    }
    reindex();
    trackSelected();
    U.$$('#pr-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === st.mode));
    renderFilters();
    renderTable();
    renderDrawer();
    drawSparks();
  }

  function show(opts = {}) {
    if (opts.sort) st.sort = { key: opts.sort, dir: -1 };
    if (opts.group && snap) {
      st.mode = 'grouped';
      st.filter = 'all';
      reindex();
      const g = groupByKey.get(opts.group);
      if (g && opts.pid && g.count > 1 && g.pids.includes(opts.pid)) {
        st.expanded.add(g.key);
        select(`p:${opts.pid}`);
      } else if (g) select(g.count === 1 ? `p:${g.pids[0]}` : `g:${g.key}`);
      requestAnimationFrame(() => {
        const row = U.$(`#pr-body tr[data-k="${CSS.escape(selKey() || '')}"]`);
        if (row) row.scrollIntoView({ block: 'center' });
      });
    }
  }

  function hide() {
    const b = U.$('#pr-body');
    if (b) b.innerHTML = '';
    const d = U.$('#pr-drawer');
    if (d) {
      d.innerHTML = '';
      drawerSelKey = null;
    }
  }

  return { init, render, show, hide, onKey, title: 'Processes' };
})();
