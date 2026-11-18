'use strict';
/* global U, Charts, App */

const Performance = (() => {
  let root;
  let current = 'cpu';
  let listSig = '';
  let builtFor = '';

  const netKind = (name) => {
    if (/wi-?fi|wireless|wlan|802\.11/i.test(name)) return 'Wi-Fi';
    if (/bluetooth/i.test(name)) return 'Bluetooth';
    if (/warp|wireguard|vpn|tap-|tun\b|openvpn|zerotier|tailscale/i.test(name)) return 'VPN';
    if (/vethernet|hyper-v/i.test(name)) return 'vEthernet';
    return 'Ethernet';
  };
  const shortGpu = (n) => n.replace(/\(TM\)|\(R\)|Graphics|Corporation/gi, '').replace(/\s+/g, ' ').trim();
  const engineName = (t) => t.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

  function init(el) {
    root = el;
    root.classList.add('fill');
    root.innerHTML = `<div class="perf"><div class="perf-list" id="pf-list"></div><div class="perf-main" id="pf-main-wrap"></div></div>`;
    U.$('#pf-list').addEventListener('click', (e) => {
      const item = e.target.closest('[data-res]');
      if (!item) return;
      current = item.dataset.res;
      builtFor = '';
      if (App.snap) render(App.snap);
    });
  }

  function resources(s) {
    const h = s.hist;
    const mem = s.mem;
    const list = [
      { id: 'cpu', title: 'CPU', sub: `${s.cpu.total.toFixed(0)}%  ${(s.cpu.speedMHz / 1000).toFixed(2)} GHz`, data: h.cpu, max: 100, color: '--c-cpu' },
      { id: 'mem', title: 'Memory', sub: `${(mem.inUse / U.GB).toFixed(1)}/${(mem.total / U.GB).toFixed(1)} GB (${((mem.inUse / mem.total) * 100).toFixed(0)}%)`, data: h['mem.inUse'], max: mem.total, color: '--c-mem' },
    ];
    for (const d of s.disks) {
      list.push({ id: `disk:${d.key}`, title: `Disk ${d.number}${d.letters ? ` (${d.letters})` : ''}`, sub: `${d.media || 'Disk'} ${d.bus ? `(${d.bus}) ` : ''} ${d.active.toFixed(0)}%`, data: h[`${d.key}.active`], max: 100, color: '--c-disk' });
    }
    for (const n of s.nets) {
      const r = h[`${n.key}.recv`] || [];
      const t = h[`${n.key}.sent`] || [];
      list.push({ id: `net:${n.name}`, title: netKind(n.name), sub: `↓ ${U.bits(n.recv)}  ↑ ${U.bits(n.sent)}`, data: r.map((v, i) => (v == null ? null : v + (t[i] || 0))), minMax: 16 * 1024, color: '--c-net' });
    }
    s.gpus.forEach((g, i) => {
      list.push({ id: `gpu:${g.key}`, title: `GPU ${i}`, sub: `${shortGpu(g.name)}  ${g.util.toFixed(0)}%`, data: h[`gpu:${g.key}.util`], max: 100, color: '--c-gpu' });
    });
    return list;
  }

  function renderList(list) {
    const sig = list.map((r) => r.id).join('|');
    const box = U.$('#pf-list');
    if (sig !== listSig) {
      listSig = sig;
      box.innerHTML = list
        .map((r) => `<div class="perf-item" data-res="${U.esc(r.id)}"><canvas></canvas><div style="min-width:0"><div class="t">${U.esc(r.title)}</div><div class="s"></div></div></div>`)
        .join('');
    }
    if (!list.some((r) => r.id === current)) current = 'cpu';
    for (const r of list) {
      const item = box.querySelector(`[data-res="${CSS.escape(r.id)}"]`);
      if (!item) continue;
      item.classList.toggle('on', r.id === current);
      const sub = item.querySelector('.s');
      if (sub.textContent !== r.sub) sub.textContent = r.sub;
      Charts.line(item.querySelector('canvas'), { series: [{ data: r.data, color: r.color, width: 1.2 }], max: r.max, minMax: r.minMax, grid: false });
    }
  }

  const stat = (k, v, tip) => `<div class="stat" ${tip ? `data-tip="${U.esc(tip)}"` : ''}><div class="k">${k}</div><div class="v">${v}</div></div>`;

  function set(id, html) {
    const el = document.getElementById(id);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }

  function caption(id, left, right = '') {
    return `<div class="chart-caption"><span>${left} · <span id="${id}-span"></span></span><span id="${id}-max">${right}</span></div>`;
  }

  function spanText(s) {
    const sec = Math.round((s.hist.cpu.length * s.interval) / 1000);
    return sec >= 120 ? `${Math.round(sec / 60)} minutes` : `${sec} seconds`;
  }

  // ---------- panels ----------
  function buildCpu(s) {
    const sys = s.sys || {};
    return `
      <div class="perf-title"><h2>CPU</h2><div class="model">${U.esc(sys.cpu || '')}</div></div>
      ${caption('pf-a', '% utilization', '100%')}
      <div class="chart-frame"><canvas class="big-chart" id="pf-a"></canvas></div>
      <div class="stat-grid" id="pf-stats" style="margin:18px 0 22px"></div>
      <div class="card-title">Logical processors <span class="sub">${s.cpu.cores.length}</span></div>
      <div class="cores">${s.cpu.cores.map((_, i) => `<div class="core"><canvas id="pf-core-${i}"></canvas><span class="lbl" id="pf-core-l-${i}">CPU ${i}</span></div>`).join('')}</div>`;
  }

  function updateCpu(s) {
    const sys = s.sys || {};
    Charts.line(U.$('#pf-a'), { series: [{ data: s.hist.cpu, color: '--c-cpu' }], max: 100 });
    set(
      'pf-stats',
      [
        stat('Utilization', `${s.cpu.total.toFixed(0)}%`),
        stat('Speed', `${(s.cpu.speedMHz / 1000).toFixed(2)} <small>GHz</small>`),
        stat('Base speed', `${((s.cpu.baseMHz || sys.maxMHz || 0) / 1000).toFixed(2)} <small>GHz</small>`),
        stat('Cores', sys.cores ? `${sys.cores} <small>· ${sys.logical} logical</small>` : `${s.cpu.cores.length} <small>logical</small>`),
        stat('Processes', U.num(s.totals.processes)),
        stat('Threads', U.num(s.totals.threads)),
        stat('Handles', U.num(s.totals.handles)),
        stat('Context switches', `${U.num(s.cpu.contextSwitches)}<small>/s</small>`),
        stat('Up time', U.dur(s.uptime)),
      ].join(''),
    );
    s.cpu.cores.forEach((v, i) => {
      Charts.line(U.$(`#pf-core-${i}`), { series: [{ data: s.hist[`core${i}`] || [], color: '--c-cpu', width: 1.2 }], max: 100, gridRows: 2, gridCols: 4 });
      set(`pf-core-l-${i}`, `CPU ${i} · ${v.toFixed(0)}%`);
    });
  }

  function buildMem(s) {
    const sys = s.sys || {};
    return `
      <div class="perf-title"><h2>Memory</h2><div class="model">${U.bytes(s.mem.installed)}${sys.ramSpeed ? ` · ${sys.ramSpeed} MT/s` : ''}${sys.ramModules ? ` · ${sys.ramModules} module${sys.ramModules === 1 ? '' : 's'}` : ''}</div></div>
      ${caption('pf-a', 'Memory in use', U.bytes(s.mem.total))}
      <div class="chart-frame"><canvas class="big-chart" id="pf-a"></canvas></div>
      <div class="card-title" style="margin-top:18px">Composition <span class="sub">hover for details · full breakdown on the Memory page</span></div>
      <div id="pf-stack"></div>
      <div class="stat-grid" id="pf-stats" style="margin-top:18px"></div>`;
  }

  function updateMem(s) {
    const mem = s.mem;
    Charts.line(U.$('#pf-a'), { series: [{ data: s.hist['mem.inUse'], color: '--c-mem' }, { data: s.hist['mem.committed'], color: '--c-mem', fill: false, dash: [4, 4], width: 1 }], max: Math.max(mem.total, ...s.hist['mem.committed'].filter((x) => x != null)) });
    set('pf-a-max', `${U.bytes(Math.max(mem.total, ...s.hist['mem.committed'].filter((x) => x != null)))} · dashed = committed`);
    set('pf-stack', U.stack(U.memSegments(mem), mem.installed, true));
    set(
      'pf-stats',
      [
        stat('In use', `${U.bytes(mem.inUse)} <small>(${U.bytes(mem.compression)} compressed)</small>`),
        stat('Available', U.bytes(mem.available)),
        stat('Committed', `${U.bytes(mem.committed)} <small>/ ${U.bytes(mem.commitLimit)}</small>`),
        stat('Cached', U.bytes(mem.standby)),
        stat('Paged pool', U.bytes(mem.pagedPoolTotal)),
        stat('Non-paged pool', U.bytes(mem.nonpaged)),
        stat('Hard faults', `${U.num(mem.hardFaults)}<small>/s</small>`),
        stat('Hardware reserved', U.bytes(mem.hardwareReserved)),
      ].join(''),
    );
  }

  function buildDisk(s, d) {
    return `
      <div class="perf-title"><h2>Disk ${d.number}${d.letters ? ` (${U.esc(d.letters)})` : ''}</h2><div class="model">${U.esc(d.model || '')}<br><span class="faint">${U.esc([d.media, d.bus].filter(Boolean).join(' · '))}</span></div></div>
      ${caption('pf-a', 'Active time', '100%')}
      <div class="chart-frame"><canvas class="big-chart" id="pf-a"></canvas></div>
      <div style="margin-top:16px">${caption('pf-b', 'Transfer rate — read (solid) and write (dashed)')}</div>
      <div class="chart-frame"><canvas class="mid-chart" id="pf-b"></canvas></div>
      <div class="stat-grid" id="pf-stats" style="margin-top:18px"></div>`;
  }

  function updateDisk(s, d) {
    Charts.line(U.$('#pf-a'), { series: [{ data: s.hist[`${d.key}.active`], color: '--c-disk' }], max: 100 });
    const max = Charts.line(U.$('#pf-b'), {
      series: [
        { data: s.hist[`${d.key}.read`], color: '--c-read' },
        { data: s.hist[`${d.key}.write`], color: '--c-write', dash: [4, 3], fillAlpha: 0.12 },
      ],
      minMax: 1024 * 1024,
    });
    set('pf-b-max', `${U.bytes(max)}/s`);
    set(
      'pf-stats',
      [
        stat('Active time', `${d.active.toFixed(0)}%`),
        stat('Avg response', `${d.latency.toFixed(1)} <small>ms</small>`),
        stat('Read speed', U.rate(d.read)),
        stat('Write speed', U.rate(d.write)),
        stat('Capacity', d.size ? U.bytes(d.size) : '—'),
        stat('Type', U.esc([d.media, d.bus].filter(Boolean).join(' · ') || '—')),
      ].join(''),
    );
  }

  function buildNet(s, n) {
    return `
      <div class="perf-title"><h2>${netKind(n.name)}</h2><div class="model">${U.esc(n.label)}</div></div>
      ${caption('pf-a', 'Throughput — receive (solid) and send (dashed)')}
      <div class="chart-frame"><canvas class="big-chart" id="pf-a"></canvas></div>
      <div class="stat-grid" id="pf-stats" style="margin-top:18px"></div>`;
  }

  function updateNet(s, n) {
    const max = Charts.line(U.$('#pf-a'), {
      series: [
        { data: s.hist[`${n.key}.recv`], color: '--c-net' },
        { data: s.hist[`${n.key}.sent`], color: '--c-cpu', dash: [4, 3], fillAlpha: 0.12 },
      ],
      minMax: 64 * 1024,
    });
    set('pf-a-max', U.bits(max));
    set(
      'pf-stats',
      [stat('Receive', U.bits(n.recv)), stat('Send', U.bits(n.sent)), stat('Link speed', n.bandwidth ? U.bits(n.bandwidth / 8) : '—'), stat('Received', `${U.rate(n.recv)}`), stat('Sent', `${U.rate(n.sent)}`)].join(''),
    );
  }

  function buildGpu(s, g, idx) {
    return `
      <div class="perf-title"><h2>GPU ${idx}</h2><div class="model">${U.esc(g.name)}</div></div>
      ${caption('pf-a', 'Utilization (busiest engine)', '100%')}
      <div class="chart-frame"><canvas class="big-chart" id="pf-a"></canvas></div>
      <div class="card-title" style="margin-top:18px">Engines</div>
      <div class="engines" id="pf-engines"></div>
      <div class="ov-row halves" style="margin-top:18px">
        <div>${caption('pf-b', 'Shared GPU memory (system RAM)')}<div class="chart-frame"><canvas class="mid-chart" id="pf-b"></canvas></div></div>
        <div>${caption('pf-c', 'Dedicated GPU memory')}<div class="chart-frame"><canvas class="mid-chart" id="pf-c"></canvas></div></div>
      </div>
      <div class="stat-grid" id="pf-stats" style="margin-top:4px"></div>`;
  }

  function updateGpu(s, g) {
    const h = s.hist;
    Charts.line(U.$('#pf-a'), { series: [{ data: h[`gpu:${g.key}.util`], color: '--c-gpu' }], max: 100 });
    const types = Object.entries(g.types)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([t]) => t)
      .sort();
    const box = U.$('#pf-engines');
    const sig = types.join('|');
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.innerHTML = types
        .map((t, i) => `<div><div class="chart-caption"><span>${U.esc(engineName(t))}</span><span id="pf-eng-v-${i}"></span></div><div class="chart-frame"><canvas id="pf-eng-${i}" style="width:100%;height:70px;display:block"></canvas></div></div>`)
        .join('');
    }
    types.forEach((t, i) => {
      Charts.line(U.$(`#pf-eng-${i}`), { series: [{ data: h[`gpu:${g.key}.eng.${t}`] || [], color: '--c-gpu', width: 1.2 }], max: 100, gridRows: 2, gridCols: 4 });
      set(`pf-eng-v-${i}`, `${(g.types[t] || 0).toFixed(0)}%`);
    });
    Charts.line(U.$('#pf-b'), { series: [{ data: h[`gpu:${g.key}.shared`], color: '--m-gpu' }], max: g.sharedTotal || undefined, minMax: 256 * U.MB });
    Charts.line(U.$('#pf-c'), { series: [{ data: h[`gpu:${g.key}.dedicated`], color: '--c-gpu' }], max: g.dedicatedTotal || undefined, minMax: 256 * U.MB });
    set('pf-b-max', g.sharedTotal ? U.bytes(g.sharedTotal) : '');
    set('pf-c-max', g.dedicatedTotal ? U.bytes(g.dedicatedTotal) : '');
    set(
      'pf-stats',
      [
        stat('Utilization', `${g.util.toFixed(0)}%`),
        stat('Shared memory', `${U.bytes(g.shared)}${g.sharedTotal ? ` <small>/ ${U.bytes(g.sharedTotal)}</small>` : ''}`, 'System RAM used by the GPU'),
        stat('Dedicated memory', `${U.bytes(g.dedicated)}${g.dedicatedTotal ? ` <small>/ ${U.bytes(g.dedicatedTotal)}</small>` : ''}`, 'For integrated GPUs this is carved out of RAM by the firmware'),
      ].join(''),
    );
  }

  function render(s) {
    if (!root) return;
    const list = resources(s);
    renderList(list);
    const main = U.$('#pf-main-wrap');
    const kind = current.split(':')[0];
    let target = null;
    let idx = 0;
    if (kind === 'disk') target = s.disks.find((d) => `disk:${d.key}` === current);
    if (kind === 'net') target = s.nets.find((n) => `net:${n.name}` === current);
    if (kind === 'gpu') {
      idx = s.gpus.findIndex((g) => `gpu:${g.key}` === current);
      target = s.gpus[idx];
    }
    if (kind !== 'cpu' && kind !== 'mem' && !target) {
      current = 'cpu';
      return render(s);
    }
    const sig = `${current}|${kind === 'cpu' ? s.cpu.cores.length : ''}`;
    if (builtFor !== sig) {
      builtFor = sig;
      main.innerHTML = kind === 'cpu' ? buildCpu(s) : kind === 'mem' ? buildMem(s) : kind === 'disk' ? buildDisk(s, target) : kind === 'net' ? buildNet(s, target) : buildGpu(s, target, idx);
    }
    for (const el of main.querySelectorAll('[id$="-span"]')) if (el.textContent !== spanText(s)) el.textContent = spanText(s);
    if (kind === 'cpu') updateCpu(s);
    else if (kind === 'mem') updateMem(s);
    else if (kind === 'disk') updateDisk(s, target);
    else if (kind === 'net') updateNet(s, target);
    else updateGpu(s, target);
  }

  function show(opts = {}) {
    if (!opts.res || !App.snap) return;
    const s = App.snap;
    if (opts.res === 'disk') {
      const d = [...s.disks].sort((a, b) => b.active - a.active)[0];
      if (d) current = `disk:${d.key}`;
    } else if (opts.res === 'net') {
      if (s.nets[0]) current = `net:${s.nets[0].name}`;
    } else if (opts.res === 'gpu') {
      if (s.gpus[0]) current = `gpu:${s.gpus[0].key}`;
    } else {
      current = opts.res;
    }
    builtFor = '';
  }

  return { init, render, show, title: 'Performance' };
})();
