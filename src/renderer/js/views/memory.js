'use strict';
/* global U, Charts, App */

const MemoryView = (() => {
  let root;
  let metric = 'priv';
  let lastTable = '';

  function init(el) {
    root = el;
    root.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <div class="headline" id="mv-head"></div>
        <div class="subline" id="mv-sub"></div>
        <div id="mv-stack"></div>
        <div class="stat-grid" id="mv-stats" style="margin-top:18px"></div>
      </div>
      <div class="ov-row two">
        <div class="card">
          <div class="card-title">Every byte, accounted for <span class="sub">hover a row for details</span></div>
          <table class="mem-table" id="mv-table"></table>
          <div class="faint" id="mv-note" style="font-size:11.5px;margin-top:8px"></div>
        </div>
        <div class="grid" style="align-content:start">
          <div class="card chart-card">
            <div class="card-title">Memory in use <span class="sub" id="mv-span"></span></div>
            <canvas id="mv-chart"></canvas>
            <div class="chart-legend">
              <span><i class="legend-dot" style="background:var(--c-mem)"></i>In use</span>
              <span><i class="legend-dot" style="background:var(--m-compression)"></i>Compressed</span>
              <span><i class="legend-dot" style="background:var(--m-standby)"></i>Cached</span>
            </div>
          </div>
          <div class="card">
            <div class="card-title">Commit charge</div>
            <div class="headline" id="mv-commit-head" style="font-size:18px"></div>
            <div id="mv-commit-bar" style="margin:10px 0 12px"></div>
            <div class="muted" style="font-size:12px;line-height:1.5">Memory apps have <b>reserved</b>, whether it lives in RAM or in the page file on disk. If it reaches the limit, Windows grows the page file — or apps fail with “out of memory” errors.</div>
            <div class="stat-grid" id="mv-commit-stats" style="margin-top:14px"></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Apps by memory
          <div class="seg right" id="mv-metric">
            <button data-m="priv" data-tip="RAM only this app uses (Task Manager's number)">Private</button>
            <button data-m="ws" data-tip="Private + shared memory currently in RAM (shared DLLs count once per process)">Working set</button>
            <button data-m="commit" data-tip="Private memory reserved, in RAM or the page file">Commit</button>
          </div>
        </div>
        <div id="mv-apps"></div>
      </div>`;
    U.$('#mv-metric').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (b) {
        metric = b.dataset.m;
        if (App.snap) render(App.snap);
      }
    });
    U.$('#mv-apps').addEventListener('click', (e) => {
      const row = e.target.closest('[data-group]');
      if (row) App.go('processes', { group: row.dataset.group });
    });
  }

  function set(id, html) {
    const el = document.getElementById(id);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }

  function stat(k, v, tip) {
    return `<div class="stat" ${tip ? `data-tip="${U.esc(tip)}"` : ''}><div class="k">${k}</div><div class="v">${v}</div></div>`;
  }

  function render(s) {
    const mem = s.mem;
    const segs = U.memSegments(mem);
    const total = mem.installed;

    set('mv-head', `${U.bytes(mem.inUse)} <small>in use · ${U.bytes(mem.available)} available · ${U.bytes(total)} installed</small>`);
    set(
      'mv-sub',
      mem.hardwareReserved > 0
        ? `Windows can see ${U.bytes(mem.total)}; the other ${U.bytes(mem.hardwareReserved)} is reserved by hardware before Windows starts.`
        : 'All installed memory is visible to Windows.',
    );
    set('mv-stack', U.stack(segs, total, true));
    set(
      'mv-stats',
      [
        stat('In use', U.bytes(mem.inUse), 'Total minus available'),
        stat('Available', U.bytes(mem.available), 'Cached + free: memory apps can get immediately'),
        stat('Cached', U.bytes(mem.standby), 'Standby list — file data kept in case it is needed again'),
        stat('Free', U.bytes(mem.free)),
        stat('Compressed', U.bytes(mem.compression)),
        stat('Paged pool', U.bytes(mem.pagedPoolTotal), 'Kernel paged pool, including the part currently paged out'),
        stat('Non-paged pool', U.bytes(mem.nonpaged)),
        stat('Hard faults', `${U.num(mem.hardFaults)}<small>/s</small>`, 'Reads from the page file or disk to satisfy memory access. Sustained high numbers mean RAM is too small for the workload.'),
      ].join(''),
    );

    // Breakdown table
    const used = segs.filter((x) => !x.available && x.key !== 'reserved');
    const avail = segs.filter((x) => x.available);
    const reserved = segs.filter((x) => x.key === 'reserved');
    const row = (x, cls = '') => {
      const share = x.bytes / total;
      return `<tr class="${cls}">
        <td class="sw"><i class="${x.hatch ? 'hatch' : ''}" style="background:var(${x.color})"></i></td>
        <td><div class="nm">${U.esc(x.label)}</div><div class="ds">${U.esc(x.desc)}${x.act ? ` <span class="act">${U.esc(x.act)}</span>` : ''}</div></td>
        <td class="sz">${U.bytes(x.bytes)}</td>
        <td class="pc"><div class="p">${(share * 100).toFixed(1)}%</div>${U.minibar(share / 0.5, `var(${x.color})`)}</td></tr>`;
    };
    const head = (label, bytes) => `<tr class="grp"><td colspan="4">${label} · ${U.bytes(bytes)}</td></tr>`;
    const table = [
      head('In use', mem.inUse),
      ...used.sort((a, b) => b.bytes - a.bytes).map((x) => row(x)),
      head('Available', mem.available),
      ...avail.map((x) => row(x, 'avail')),
      ...(reserved.length ? [head('Not usable by Windows', mem.hardwareReserved), ...reserved.map((x) => row(x, 'avail'))] : []),
    ].join('');
    if (table !== lastTable) {
      U.$('#mv-table').innerHTML = table;
      lastTable = table;
    }
    set('mv-note', mem.overlap > 0 ? `Measured categories overlap by ${U.bytes(mem.overlap)} (e.g. GPU memory that is also mapped into an app), so “Shared & other” shows 0.` : '');

    // Chart
    const span = Math.round((s.hist.cpu.length * s.interval) / 1000);
    set('mv-span', `last ${span >= 120 ? `${Math.round(span / 60)} minutes` : `${span} seconds`}`);
    Charts.line(U.$('#mv-chart'), {
      max: mem.total,
      series: [
        { data: s.hist['mem.inUse'], color: '--c-mem' },
        { data: s.hist['mem.compression'], color: '--m-compression', fillAlpha: 0.15 },
        { data: s.hist['mem.standby'], color: '--m-standby', fill: false, dash: [4, 3] },
      ],
    });

    // Commit
    const cpct = mem.committed / mem.commitLimit;
    set('mv-commit-head', `${U.bytes(mem.committed)} <small>of ${U.bytes(mem.commitLimit)} limit (${(cpct * 100).toFixed(0)}%)</small>`);
    set('mv-commit-bar', U.minibar(cpct, cpct > 0.85 ? 'var(--bad)' : cpct > 0.7 ? 'var(--warn)' : 'var(--c-mem)'));
    set(
      'mv-commit-stats',
      [
        stat('RAM', U.bytes(mem.total)),
        stat('Page file', U.bytes(mem.pageFile), 'Size of the page file(s) on disk'),
        stat('Page file used', U.pct(mem.pageFileUsage, 0)),
        stat('Page writes', `${U.num(mem.pageWrites)}<small>/s</small>`),
      ].join(''),
    );

    // Apps by memory
    U.$$('#mv-metric button').forEach((b) => b.classList.toggle('on', b.dataset.m === metric));
    const groups = [...s.groups].sort((a, b) => b[metric] - a[metric]).slice(0, 20);
    const max = Math.max(1, ...groups.map((g) => g[metric]));
    set(
      'mv-apps',
      groups
        .map(
          (g) => `<div class="hbar" data-group="${U.esc(g.key)}" data-tip="${U.esc(`${g.name}\n${g.count} process${g.count === 1 ? '' : 'es'}\nPrivate ${U.bytes(g.priv)} · Working set ${U.bytes(g.ws)} · Commit ${U.bytes(g.commit)}`)}">
            ${U.icon(g.path, g.type === 'windows' ? U.WIN_ICON : undefined)}
            <div class="nm">${U.esc(g.name)}${g.count > 1 ? ` <span class="faint">(${g.count})</span>` : ''}</div>
            <div class="track"><i style="width:${((g[metric] / max) * 100).toFixed(1)}%;background:var(--m-apps)"></i></div>
            <div class="v">${U.bytes(g[metric])}</div></div>`,
        )
        .join(''),
    );
  }

  return { init, render, title: 'Memory' };
})();
