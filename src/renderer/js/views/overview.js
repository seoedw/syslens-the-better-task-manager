'use strict';
/* global U, Charts, App */

const Overview = (() => {
  let root;

  const meter = (id, label, res) => `
    <div class="card meter" data-perf="${res}">
      <div class="meter-head"><span class="meter-label">${label}</span><span class="meter-sub" id="ov-${id}-sub"></span></div>
      <div class="meter-value" id="ov-${id}-val">—</div>
      <div class="meter-detail" id="ov-${id}-detail">&nbsp;</div>
      <canvas class="spark" id="ov-${id}-spark"></canvas>
    </div>`;

  function init(el) {
    root = el;
    root.innerHTML = `
      <div class="meters">
        ${meter('cpu', 'CPU', 'cpu')}
        ${meter('mem', 'Memory', 'mem')}
        ${meter('disk', 'Disk', 'disk')}
        ${meter('net', 'Network', 'net')}
        ${meter('gpu', 'GPU', 'gpu')}
      </div>
      <div class="ov-row two">
        <div class="card">
          <div class="card-title">Where your memory is going<button class="link right" data-go="memory">Full breakdown →</button></div>
          <div class="headline" id="ov-ram-head"></div>
          <div class="subline" id="ov-ram-sub"></div>
          <div id="ov-ram-stack"></div>
          <div id="ov-ram-legend"></div>
        </div>
        <div class="card">
          <div class="card-title">What's going on</div>
          <div class="insights" id="ov-insights"></div>
        </div>
      </div>
      <div class="ov-row halves">
        <div class="card">
          <div class="card-title">Top memory users <span class="sub">private memory, grouped by app</span><button class="link right" data-go="processes">All processes →</button></div>
          <div class="toplist" id="ov-topmem"></div>
        </div>
        <div class="card">
          <div class="card-title">Top CPU users <span class="sub">right now</span><button class="link right" data-go="processes" data-sort="cpu">All processes →</button></div>
          <div class="toplist" id="ov-topcpu"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">This PC</div>
        <div class="sysstrip" id="ov-sys"></div>
      </div>`;

    root.addEventListener('click', (e) => {
      const m = e.target.closest('[data-perf]');
      if (m) App.go('performance', { res: m.dataset.perf });
      const row = e.target.closest('[data-group]');
      if (row) App.go('processes', { group: row.dataset.group, sort: row.dataset.sortby });
    });
  }

  function set(id, html) {
    const el = document.getElementById(id);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }

  function topRows(groups, value, fmt, sortby) {
    const max = Math.max(1e-9, ...groups.map(value));
    return groups
      .map(
        (g) => `<div class="toprow" data-group="${U.esc(g.key)}" data-sortby="${sortby}" data-tip="${U.esc(`${g.name}\n${g.count} process${g.count === 1 ? '' : 'es'} · ${U.bytes(g.priv)} · ${g.cpu.toFixed(1)}% CPU`)}">
          ${U.icon(g.path, g.type === 'windows' ? U.WIN_ICON : undefined)}
          <div class="nm">${U.esc(g.name)}${g.count > 1 ? `<span class="cnt">${g.count}</span>` : ''}</div>
          ${U.minibar(value(g) / max, sortby === 'cpu' ? 'var(--c-cpu)' : 'var(--m-apps)')}
          <div class="val">${fmt(g)}</div>
        </div>`,
      )
      .join('');
  }

  function render(s) {
    const h = s.hist;
    const mem = s.mem;

    // CPU
    set('ov-cpu-val', `${s.cpu.total.toFixed(0)}<span class="unit">%</span>`);
    set('ov-cpu-sub', s.cpu.speedMHz ? `${(s.cpu.speedMHz / 1000).toFixed(2)} GHz` : '');
    set('ov-cpu-detail', `${U.num(s.totals.processes)} processes · ${U.num(s.totals.threads)} threads`);
    Charts.line(U.$('#ov-cpu-spark'), { series: [{ data: h.cpu, color: '--c-cpu' }], max: 100, grid: false });

    // Memory
    set('ov-mem-val', `${(mem.inUse / U.GB).toFixed(1)}<span class="unit">/ ${(mem.total / U.GB).toFixed(1)} GB</span>`);
    set('ov-mem-sub', `${((mem.inUse / mem.total) * 100).toFixed(0)}% used`);
    set('ov-mem-detail', `${U.bytes(mem.available)} available · ${U.bytes(mem.committed)} committed`);
    Charts.line(U.$('#ov-mem-spark'), { series: [{ data: h['mem.inUse'], color: '--c-mem' }], max: mem.total, grid: false });

    // Disk: the busiest physical disk
    const disk = [...s.disks].sort((a, b) => b.active - a.active)[0];
    if (disk) {
      set('ov-disk-val', `${disk.active.toFixed(0)}<span class="unit">%</span>`);
      set('ov-disk-sub', U.esc(`Disk ${disk.number}${disk.letters ? ` (${disk.letters})` : ''}`));
      set('ov-disk-detail', `Read ${U.rate(disk.read)} · Write ${U.rate(disk.write)}`);
      Charts.line(U.$('#ov-disk-spark'), { series: [{ data: h[`${disk.key}.active`], color: '--c-disk' }], max: 100, grid: false });
    }

    // Network: the busiest adapter
    const net = s.nets[0];
    if (net) {
      const recv = h[`${net.key}.recv`] || [];
      const sent = h[`${net.key}.sent`] || [];
      set('ov-net-val', `${U.bits(net.recv + net.sent).replace(' ', '<span class="unit">')}</span>`);
      set('ov-net-sub', U.esc(/wi-?fi|wireless|wlan/i.test(net.name) ? 'Wi-Fi' : 'Ethernet'));
      set('ov-net-detail', `↓ ${U.bits(net.recv)} · ↑ ${U.bits(net.sent)}`);
      Charts.line(U.$('#ov-net-spark'), { series: [{ data: recv.map((v, i) => (v == null ? null : v + (sent[i] || 0))), color: '--c-net' }], minMax: 16 * 1024, grid: false });
    } else {
      set('ov-net-val', '—');
      set('ov-net-detail', 'No active adapter');
    }

    // GPU
    const gpu = s.gpus[0];
    if (gpu) {
      set('ov-gpu-val', `${gpu.util.toFixed(0)}<span class="unit">%</span>`);
      set('ov-gpu-sub', U.esc(gpu.name.replace(/\(TM\)|\(R\)|Graphics/gi, '').replace(/\s+/g, ' ').trim()));
      set('ov-gpu-detail', `${U.bytes(gpu.shared + gpu.dedicated)} GPU memory in use`);
      Charts.line(U.$('#ov-gpu-spark'), { series: [{ data: h[`gpu:${gpu.key}.util`], color: '--c-gpu' }], max: 100, grid: false });
    } else {
      set('ov-gpu-val', '—');
      set('ov-gpu-detail', 'No GPU counters');
    }

    // Memory breakdown
    set('ov-ram-head', `${U.bytes(mem.inUse)} <small>in use of ${U.bytes(mem.installed)} installed</small>`);
    set(
      'ov-ram-sub',
      `${U.bytes(mem.available)} is available — ${U.bytes(mem.standby)} of that is cached files Windows can hand to apps instantly.`,
    );
    const segs = U.memSegments(mem);
    set('ov-ram-stack', U.stack(segs, mem.installed, true));
    set('ov-ram-legend', U.legend(segs.filter((x) => x.bytes > 0)));

    // Insights
    set(
      'ov-insights',
      s.insights.length
        ? s.insights
            .map(
              (i) => `<div class="insight ${i.level}">${U.LEVEL_ICONS[i.level]}<div><div class="t">${U.esc(i.title)}</div><div class="d">${U.esc(i.text)}</div>${
                i.link ? `<div class="go"><button class="link" data-go="${i.link}">Show me →</button></div>` : ''
              }</div></div>`,
            )
            .join('')
        : '<div class="insight info">' + U.LEVEL_ICONS.info + '<div><div class="t">Everything looks normal</div><div class="d">No memory pressure, runaway processes or leaks detected.</div></div></div>',
    );

    // Top lists
    // Memory Compression holds other apps' compressed pages; it's shown in the breakdown instead.
    const apps = s.groups.filter((g) => g.exe !== 'memory compression');
    set('ov-topmem', topRows(apps.slice(0, 8), (g) => g.priv, (g) => U.bytes(g.priv), 'priv'));
    const byCpu = [...s.groups].sort((a, b) => b.cpu - a.cpu).slice(0, 8);
    set('ov-topcpu', topRows(byCpu, (g) => g.cpu, (g) => `${g.cpu.toFixed(1)}%`, 'cpu'));

    // This PC
    const sys = s.sys || {};
    const gpus = s.gpus.map((g) => g.name).join(', ') || '—';
    const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v" style="font-size:13px">${v}</div></div>`;
    set(
      'ov-sys',
      [
        stat('Processor', U.esc(sys.cpu || '—')),
        stat('Cores', sys.cores ? `${sys.cores} cores · ${sys.logical} threads` : `${s.cpu.cores.length} logical`),
        stat('Memory', `${U.bytes(mem.installed)}${sys.ramSpeed ? ` · ${sys.ramSpeed} MT/s` : ''}`),
        stat('Graphics', U.esc(gpus)),
        stat('Windows', U.esc(`${(sys.os || '').replace('Microsoft ', '')}${sys.displayVersion ? ` ${sys.displayVersion}` : ''}`)),
        stat('Up time', U.dur(s.uptime)),
        stat('Handles', U.num(s.totals.handles)),
        stat('Device', U.esc([sys.manufacturer, sys.model].filter(Boolean).join(' ') || sys.hostname || '—')),
      ].join(''),
    );
  }

  return { init, render, title: 'Overview' };
})();
