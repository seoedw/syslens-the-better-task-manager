'use strict';
/* global U, App, Charts, syslens */

// Network: the active connection, every adapter, and which app is talking to what.
const NetworkView = (() => {
  let root;
  let timer = null;
  let adapters = null;
  let conns = [];
  let connsAt = 0;
  const st = { filter: 'established', q: '', local: false, sort: { key: 'app', dir: 1 } };
  const isLoopback = (ip) => /^127\.|^::1$|^::ffff:127\./.test(ip || '');

  const ICONS = {
    'Wi-Fi': '<path d="M12 19.5h.01"/><path d="M8.6 16a5 5 0 0 1 6.8 0"/><path d="M5.3 12.6a9.6 9.6 0 0 1 13.4 0"/><path d="M2 9.2a14.4 14.4 0 0 1 20 0"/>',
    Ethernet: '<rect x="6" y="9" width="12" height="9" rx="1.5"/><path d="M9 9V6h6v3"/><path d="M9.5 18v-3M12 18v-3M14.5 18v-3"/>',
    Bluetooth: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
    Virtual: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M8 12h8"/>',
    Other: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>',
  };

  function init(el) {
    root = el;
    root.innerHTML = `
      <div class="summary" id="nw-sum"><div class="loading">Reading network adapters…</div></div>
      <div class="ov-row two">
        <div class="card chart-card">
          <div class="card-title">Throughput <span class="sub" id="nw-chart-sub"></span><span class="right chart-legend" style="margin:0">
            <span><i class="legend-dot" style="background:var(--c-net)"></i>Received</span>
            <span><i class="legend-dot" style="background:var(--c-cpu)"></i>Sent</span></span></div>
          <canvas id="nw-chart" style="height:150px"></canvas>
          <div class="axis-note"><span id="nw-axis"></span><span>now</span></div>
        </div>
        <div class="card">
          <div class="card-title">Listening ports <span class="sub">apps waiting for connections</span></div>
          <div id="nw-listen" style="max-height:186px;overflow:auto"></div>
        </div>
      </div>
      <div class="section-title">Adapters <span class="sub" id="nw-ad-sub"></span><span class="right" style="display:flex;gap:6px"><button class="btn sm" data-settings="network">Network settings</button><button class="btn sm" id="nw-ad-refresh">Refresh</button></span></div>
      <div class="adapters" id="nw-adapters"></div>
      <div class="section-title">Connections <span class="sub" id="nw-conn-sub"></span></div>
      <div class="page-actions">
        <div class="search"><svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.38A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg><input id="nw-q" placeholder="Filter by app, address, host or port" spellcheck="false" /></div>
        <div class="seg" id="nw-filter">
          <button data-f="established">Established</button>
          <button data-f="listening">Listening</button>
          <button data-f="all">All</button>
        </div>
        <label class="switch" data-tip="Apps talking to other apps on this PC (127.0.0.1). Usually internal plumbing, so hidden by default."><input type="checkbox" id="nw-local" /> Show connections within this PC</label>
        <span class="spacer"></span>
        <span class="faint" id="nw-conn-when"></span>
      </div>
      <div class="list-wrap" style="max-height:560px"><table class="list-table" id="nw-table"></table></div>`;

    root.addEventListener('click', (e) => {
      const f = e.target.closest('[data-f]');
      if (f) {
        st.filter = f.dataset.f;
        renderConns();
      }
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const key = th.dataset.sort;
        st.sort = st.sort.key === key ? { key, dir: -st.sort.dir } : { key, dir: 1 };
        renderConns();
      }
      const s = e.target.closest('[data-settings]');
      if (s) syslens.openSettings(s.dataset.settings);
      if (e.target.closest('#nw-ad-refresh')) loadAdapters(true);
      if (e.target.closest('[data-latency-on]')) App.saveSettings({ latency: true }).then(() => U.toast('Latency is measured every 5 seconds from now on. Turn it off in Settings.', 'good'));
      const app = e.target.closest('[data-pid]');
      if (app && App.snap) {
        const p = (App.snap.procs || []).find((x) => x.pid === Number(app.dataset.pid));
        if (p) App.go('processes', { group: p.group });
      }
    });
    U.$('#nw-q').addEventListener('input', (e) => {
      st.q = e.target.value.trim().toLowerCase();
      renderConns();
    });
    U.$('#nw-local').addEventListener('change', (e) => {
      st.local = e.target.checked;
      renderConns();
    });
  }

  async function loadAdapters(refresh = false) {
    try {
      adapters = await syslens.adapters(refresh);
    } catch {
      adapters = { list: [] };
    }
    renderAdapters();
    if (App.snap) renderSummary(App.snap);
  }

  async function poll() {
    clearTimeout(timer);
    if (App.current !== 'network' || document.hidden) {
      timer = setTimeout(poll, 3000);
      return;
    }
    try {
      conns = await syslens.connections();
      connsAt = Date.now();
      renderConns();
      renderListening();
    } catch {
      /* try again shortly */
    }
    timer = setTimeout(poll, 3000);
  }

  function show() {
    if (!adapters) loadAdapters(false);
    poll();
  }

  // ---------- summary + chart ----------
  function primary() {
    const list = (adapters && adapters.list) || [];
    return list.find((a) => a.up && a.gateway.length && !a.virtual) || list.find((a) => a.up && a.gateway.length) || list.find((a) => a.up && !a.virtual) || null;
  }

  function bars(signal) {
    const n = signal >= 80 ? 4 : signal >= 60 ? 3 : signal >= 35 ? 2 : 1;
    return `<span class="signal">${[4, 7, 10, 12].map((h, i) => `<i style="height:${h}px" class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  }

  function renderSummary(s) {
    const a = primary();
    const net = (s.nets || [])[0];
    const est = conns.filter((c) => c.state === 'Established').length;
    const lis = conns.filter((c) => c.state === 'Listening').length;
    const sums = [];
    if (a) {
      sums.push(`<div class="sum"><div class="v">${a.wifi ? `${bars(a.wifi.signal)}${U.pii(a.wifi.ssid)}` : U.esc(a.name)}</div><div class="k">${a.wifi ? `Wi-Fi · ${a.wifi.signal}% signal · ${U.esc([a.wifi.band, a.wifi.standard].filter(Boolean).join(' · '))}` : `${U.esc(a.type)} · ${a.speed ? U.bits(a.speed / 8) : ''}`}</div></div>`);
      sums.push(`<div class="sum"><div class="v">${a.ipv4.length ? U.pii(a.ipv4[0].split('/')[0]) : '—'}</div><div class="k">IPv4 address${a.dhcp ? ' (DHCP)' : ''}</div></div>`);
      sums.push(`<div class="sum"><div class="v">${a.gateway.length ? U.pii(a.gateway[0]) : '—'}</div><div class="k">Gateway (router)</div></div>`);
    } else if (adapters) {
      sums.push('<div class="sum"><div class="v">Offline</div><div class="k">No connected adapter</div></div>');
    }
    if (net) {
      sums.push(`<div class="sum"><div class="v" id="nw-down">${U.bits(net.recv)}</div><div class="k">Download now</div></div>`);
      sums.push(`<div class="sum"><div class="v" id="nw-up">${U.bits(net.sent)}</div><div class="k">Upload now</div></div>`);
    }
    sums.push(`<div class="sum"><div class="v">${connsAt ? U.num(est) : '—'}</div><div class="k">Connections open${connsAt ? ` · ${U.num(lis)} listening` : ''}</div></div>`);
    if (s.latency) sums.push(`<div class="sum"><div class="v">${s.latency.ms == null ? 'Lost' : `${Math.round(s.latency.ms)} <small>ms</small>`}</div><div class="k">Internet latency · ${U.esc(s.latency.target)}</div></div>`);
    else if (App.settings && !App.settings.latency) sums.push('<div class="sum"><div class="v"><button class="link" data-latency-on>Measure</button></div><div class="k">Internet latency (off)</div></div>');
    const html = sums.join('');
    const el = U.$('#nw-sum');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function renderChart(s) {
    const net = (s.nets || [])[0];
    const sub = U.$('#nw-chart-sub');
    if (!net) {
      sub.textContent = 'no active adapter';
      return;
    }
    const recv = s.hist[`${net.key}.recv`] || [];
    const sent = s.hist[`${net.key}.sent`] || [];
    const max = Charts.line(U.$('#nw-chart'), {
      series: [
        { data: recv.map((v) => (v == null ? null : v * 8)), color: '--c-net' },
        { data: sent.map((v) => (v == null ? null : v * 8)), color: '--c-cpu', fillAlpha: 0.08 },
      ],
      minMax: 64 * 1000,
    });
    const span = Math.round((s.hist.cpu.length * s.interval) / 1000);
    sub.textContent = net.label;
    U.$('#nw-axis').textContent = `${span >= 120 ? `${Math.round(span / 60)} minutes` : `${span} seconds`} ago · scale ${U.bits(max / 8)}`;
  }

  // ---------- adapters ----------
  function renderAdapters() {
    const list = (adapters && adapters.list) || [];
    U.$('#nw-ad-sub').textContent = list.length ? `${list.filter((a) => a.up).length} connected of ${list.length}` : '';
    U.$('#nw-adapters').innerHTML = list.length
      ? list
          .map((a) => {
            const w = a.wifi;
            return `<div class="card adapter${a.up ? '' : ' down'}">
              <div class="head"><div class="ico"><svg viewBox="0 0 24 24">${ICONS[a.type] || ICONS.Other}</svg></div>
                <div style="min-width:0"><div class="nm">${U.esc(a.name)}</div><div class="ds ellipsis">${U.esc(a.description)}</div></div>
                <span class="right" style="margin-left:auto">${U.status(a.status, a.up ? 'ok' : 'off')}</span></div>
              ${U.props([
                w && ['Network', `${bars(w.signal)}${U.pii(w.ssid)} <span class="sub">${w.signal}%</span>`],
                w && ['Wi-Fi', U.esc([w.band, w.channel && `channel ${w.channel}`, w.standard || w.radio].filter(Boolean).join(' · '))],
                w && (w.rx || w.tx) && ['Link rate', `${w.rx} Mbps down · ${w.tx} Mbps up`],
                !w && a.speed > 0 && ['Link speed', U.bits(a.speed / 8)],
                a.ipv4.length && ['IPv4', a.ipv4.map((x) => U.pii(x)).join('<br>')],
                a.ipv6.length && ['IPv6', a.ipv6.slice(0, 2).map((x) => `<span class="mono">${U.pii(x)}</span>`).join('<br>')],
                a.gateway.length && ['Gateway', a.gateway.map((x) => U.pii(x)).join(', ')],
                a.dns.length && ['DNS servers', a.dns.map((x) => U.pii(x)).join(', ')],
                a.mac && ['MAC address', `<span class="mono">${U.pii(a.mac)}</span>`],
                a.up && a.dhcp != null && ['Addressing', a.dhcp ? 'Automatic (DHCP)' : 'Manual'],
                a.driver && ['Driver', U.esc(a.driver)],
              ])}
            </div>`;
          })
          .join('')
      : `<div class="loading">Reading adapters…</div>`;
  }

  // ---------- connections ----------
  function procs() {
    const map = new Map();
    for (const p of (App.snap && App.snap.procs) || []) map.set(p.pid, p);
    return map;
  }

  function appOf(c, map) {
    if (c.pid === 0) return { name: 'System Idle Process', path: null, isWindows: true };
    if (c.pid === 4) return { name: 'System', path: null, isWindows: true };
    const p = map.get(c.pid);
    return p ? { name: p.display || p.name, path: p.path, isWindows: p.isWindows, exe: p.name } : { name: `PID ${c.pid}`, path: null };
  }

  const scope = (addr) => (addr === '0.0.0.0' || addr === '::' ? 'All networks' : addr === '127.0.0.1' || addr === '::1' ? 'This PC only' : addr);

  function renderListening() {
    const map = procs();
    const seen = new Map();
    for (const c of conns) {
      if (c.state !== 'Listening') continue;
      const key = `${c.lport}|${c.pid}`;
      const cur = seen.get(key);
      if (cur) {
        if (!cur.scopes.includes(scope(c.local))) cur.scopes.push(scope(c.local));
      } else seen.set(key, { port: c.lport, pid: c.pid, service: c.service, scopes: [scope(c.local)] });
    }
    const list = [...seen.values()].sort((a, b) => a.port - b.port);
    const html = list.length
      ? `<table class="list-table"><tbody>${list
          .map((l) => {
            const app = appOf(l, map);
            const where = l.scopes.map((x) => (/^(All networks|This PC only)$/.test(x) ? U.esc(x) : U.pii(x))).join(', ');
            return `<tr class="hov" data-cpid="${l.pid}" data-port="${l.port}"><td style="width:70px" class="mono">${l.port}</td><td><div class="appcell" data-pid="${l.pid}" style="cursor:pointer">${U.icon(app.path, app.isWindows ? U.WIN_ICON : undefined)}<span class="ellipsis">${U.esc(app.name)}</span></div></td><td class="faint ellipsis" style="width:38%">${[l.service && U.esc(l.service), where].filter(Boolean).join(' · ')}</td></tr>`;
          })
          .join('')}</tbody></table>`
      : '<div class="empty">Nothing is listening.</div>';
    const el = U.$('#nw-listen');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  function renderConns() {
    U.$$('#nw-filter button').forEach((b) => b.classList.toggle('on', b.dataset.f === st.filter));
    const map = procs();
    let list = conns.filter((c) => (st.filter === 'established' ? c.state === 'Established' : st.filter === 'listening' ? c.state === 'Listening' || c.proto === 'UDP' : true));
    if (!st.local) list = list.filter((c) => !(c.remote && isLoopback(c.remote)));
    const rows = list.map((c) => ({ c, app: appOf(c, map) }));
    const q = st.q;
    const shown = q
      ? rows.filter(({ c, app }) => `${app.name} ${app.exe || ''} ${c.pid} ${c.local}:${c.lport} ${c.remote}:${c.rport} ${c.host || ''} ${c.service}`.toLowerCase().includes(q))
      : rows;
    const key = {
      app: (r) => r.app.name.toLowerCase(),
      remote: (r) => (r.c.host || r.c.remote || '').toLowerCase(),
      port: (r) => (r.c.state === 'Established' ? r.c.rport : r.c.lport),
      state: (r) => r.c.state,
      proto: (r) => r.c.proto,
    }[st.sort.key];
    shown.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * st.sort.dir || a.c.lport - b.c.lport;
    });
    const th = (k, label, cls = '', w = '') => `<th class="sortable${st.sort.key === k ? ' sorted' : ''} ${cls}" data-sort="${k}" ${w ? `style="width:${w}"` : ''}>${label}${st.sort.key === k ? (st.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
    const body = shown
      .slice(0, 600)
      .map(({ c, app }) => {
        const remote = c.proto === 'UDP' || c.state === 'Listening' ? `<span class="faint">${U.esc(scope(c.local))}</span>` : `${c.host ? `${U.esc(c.host)} <span class="faint">${U.esc(c.remote)}</span>` : U.esc(c.remote)}`;
        const portNum = c.state === 'Established' ? c.rport : c.lport;
        return `<tr class="hov" data-cpid="${c.pid}" data-host="${U.esc(c.host || '')}" data-addr="${U.esc(c.state === 'Established' ? c.remote || '' : '')}" data-port="${portNum}"><td><div class="appcell" data-pid="${c.pid}" style="cursor:pointer">${U.icon(app.path, app.isWindows ? U.WIN_ICON : undefined)}<span class="ellipsis">${U.esc(app.name)}</span></div></td>
          <td class="ellipsis" title="${U.esc(c.host || c.remote)}">${remote}</td>
          <td class="mono">${portNum}${c.service ? ` <span class="faint" style="font-family:var(--font)">${U.esc(c.service)}</span>` : ''}</td>
          <td>${c.state ? U.esc(c.state) : '<span class="faint">—</span>'}</td>
          <td class="faint">${c.proto}${c.v6 ? 'v6' : ''}</td>
          <td class="mono faint r">${c.lport}</td></tr>`;
      })
      .join('');
    U.$('#nw-table').innerHTML = `<thead><tr>${th('app', 'App', '', '26%')}${th('remote', st.filter === 'established' ? 'Remote host' : 'Address')}${th('port', 'Port', '', '150px')}${th('state', 'State', '', '110px')}${th('proto', 'Protocol', '', '80px')}<th class="r" style="width:90px">Local port</th></tr></thead><tbody>${
      body || `<tr><td colspan="6" class="empty">${connsAt ? 'No connections match.' : 'Reading connections…'}</td></tr>`
    }</tbody>`;
    U.$('#nw-conn-sub').textContent = connsAt ? `${U.num(shown.length)} shown of ${U.num(conns.length)}${shown.length > 600 ? ' (first 600)' : ''}` : '';
    U.$('#nw-conn-when').textContent = connsAt ? 'Updates every 3 seconds · host names fill in as they resolve' : '';
  }

  function render(s) {
    renderSummary(s);
    renderChart(s);
  }

  function hide() {
    const t = U.$('#nw-table');
    if (t) t.innerHTML = '';
  }

  return { init, render, show, hide, title: 'Network' };
})();
