'use strict';
/* global U, Charts, App, syslens, Actions, StartupView */

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
          <div class="card-title">Where your memory is going<button class="link right" data-go="memory">Full breakdown</button></div>
          <div class="headline" id="ov-ram-head"></div>
          <div class="subline" id="ov-ram-sub"></div>
          <div id="ov-ram-stack"></div>
          <div id="ov-ram-legend"></div>
          <div class="chart-caption" style="margin-top:18px"><span>In use (solid) and compressed (shaded), last 2 minutes</span><span id="ov-ram-max"></span></div>
          <div class="chart-frame"><canvas class="mid-chart" id="ov-ram-chart"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">Findings <span class="sub" id="ov-find-sub">checked every second</span></div>
          <div class="insights" id="ov-insights"></div>
        </div>
      </div>
      <div class="ov-row thirds">
        <div class="card">
          <div class="card-title">Using the most memory<button class="link right" data-go="processes">All processes</button></div>
          <div class="toplist" id="ov-topmem"></div>
        </div>
        <div class="card">
          <div class="card-title">Using the most CPU<button class="link right" data-go="processes" data-sort="cpu">All processes</button></div>
          <div class="toplist" id="ov-topcpu"></div>
        </div>
        <div class="card">
          <div class="card-title">Recent activity<button class="link right" data-go="history">History</button></div>
          <div class="events" id="ov-activity"><div class="loading">Reading the event logs…</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">This PC<button class="link right" data-go="system">Everything about it</button></div>
        <div class="sysstrip" id="ov-sys"></div>
      </div>`;

    root.addEventListener('click', (e) => {
      const m = e.target.closest('[data-perf]');
      if (m) App.go('performance', { res: m.dataset.perf });
      const row = e.target.closest('[data-group]');
      if (row) App.go('processes', { group: row.dataset.group, sort: row.dataset.sortby });
      if (e.target.closest('[data-history]')) App.go('history');
      const end = e.target.closest('[data-end-group]');
      if (end && App.snap) {
        const g = App.snap.groups.find((x) => x.key === end.dataset.endGroup);
        if (g) Actions.endTask(Actions.fromGroup(g));
      }
      const ws = e.target.closest('[data-winsettings]');
      if (ws) syslens.openSettings(ws.dataset.winsettings);
    });
  }

  // Recent activity comes from the event logs (cached by the server for a minute).
  let activity = null;
  let activityAt = 0;
  const ACTIVITY = new Set(['boot', 'shutdown', 'unexpected', 'wake', 'sleep', 'crash', 'hang', 'bsod', 'update', 'install', 'service']);
  const GLYPH = { boot: 'power', shutdown: 'power', unexpected: 'warn', wake: 'wake', sleep: 'sleep', crash: 'crash', hang: 'hang', bsod: 'crash', update: 'update', install: 'install', service: 'service' };

  let historySummary = null;
  async function loadActivity() {
    if (Date.now() - activityAt < 120000) return;
    activityAt = Date.now();
    try {
      const h = await syslens.history(false);
      activity = h.list.filter((e) => ACTIVITY.has(e.kind)).slice(0, 7);
      historySummary = h.summary ? { ...h.summary, failedUpdates: new Set(h.list.filter((e) => e.kind === 'update-failed').map((e) => e.title)).size } : null;
    } catch {
      activity = [];
    }
    renderActivity();
  }

  // Only the few facts findings need are kept, not the whole machine report.
  let machineFacts = null;
  let deviceProblems = null;
  let factsAt = 0;
  async function loadFacts() {
    if (Date.now() - factsAt < 10 * 60000) return;
    factsAt = Date.now();
    if (!StartupView.data) StartupView.load(false);
    syslens
      .deviceProblems(false)
      .then((r) => {
        deviceProblems = (r && r.list) || [];
      })
      .catch(() => {});
    try {
      let m = await syslens.machine(false);
      if (m && m.pending && m.pending.length) {
        await new Promise((r) => setTimeout(r, 20000));
        m = await syslens.machine(false);
      }
      const hw = (m && m.hardware) || {};
      const win = (m && m.windows) || {};
      const sec = win.security || {};
      const batt = (hw.batteries || []).find((b) => b.health != null);
      machineFacts = {
        batteryHealth: batt ? batt.health : null,
        antivirusOff: Array.isArray(sec.antivirus) && sec.antivirus.length > 0 && !sec.antivirus.some((a) => a.on),
        antivirusOld: Array.isArray(sec.antivirus) && sec.antivirus.some((a) => a.on && a.current === false),
        firewallOff: Array.isArray(sec.firewall) && sec.firewall.length > 0 && sec.firewall.every((x) => !x.enabled) && !(sec.firewallProducts || []).some((x) => x.on),
      };
    } catch {
      factsAt = Date.now() - 9 * 60000; // try again in a minute
    }
  }

  /** Findings from the event logs, startup list and machine report (the server adds live ones). */
  function slowFindings() {
    const out = [];
    const add = (level, title, text, extra = {}) => out.push({ level, title, text, ...extra });
    const h = historySummary;
    if (h) {
      if (h.bsods) add('bad', `Windows crashed with a blue screen ${h.bsods === 1 ? 'once' : `${h.bsods} times`} this week`, 'A blue screen is almost always a driver or hardware problem. History shows the stop code, which tells you where to start looking.', { link: 'history', linkLabel: 'Show history' });
      if (h.unexpected) add('warn', `${h.unexpected === 1 ? 'An unexpected shutdown' : `${h.unexpected} unexpected shutdowns`} this week`, 'Windows was switched off without shutting down: power loss, a held power button, or a freeze.', { link: 'history', linkLabel: 'Show history' });
      const crasher = (h.topCrashers || []).find((c) => c.n >= 3 && c.app);
      if (crasher) add('warn', `${crasher.app} crashed or froze ${crasher.n} times this week`, 'Updating or reinstalling it usually helps. History lists each time.', { link: 'history', linkLabel: 'Show history' });
      if (h.failedUpdates) add('warn', `${h.failedUpdates === 1 ? 'A Windows update' : `${h.failedUpdates} Windows updates`} failed to install`, 'Windows Update retries on its own, but repeated failures leave the PC without security fixes.', { winsettings: 'update', linkLabel: 'Windows Update' });
      if (h.serviceCrashes >= 3) add('info', `Services stopped unexpectedly ${h.serviceCrashes} times this week`, 'Usually harmless once in a while; the same service over and over points to a broken app or driver.', { link: 'history', linkLabel: 'Show history' });
    }
    const su = StartupView.data;
    if (su) {
      const on = su.list.filter((x) => x.enabled).length;
      if (on >= 12) add('info', `${on} apps start with Windows`, 'Each one slows sign-in a little and keeps running in the background. Switch off the ones you don’t need right away.', { link: 'startup', linkLabel: 'Startup apps' });
    }
    if (deviceProblems && deviceProblems.length) {
      const names = deviceProblems.slice(0, 2).map((d) => d.name).join(' and ');
      add('warn', `${deviceProblems.length === 1 ? 'A device has a problem' : `${deviceProblems.length} devices have problems`}`, `${names}${deviceProblems.length > 2 ? ' and others' : ''}: ${deviceProblems[0].problem.toLowerCase()}. Devices shows what’s wrong with each.`, { link: 'devices', linkLabel: 'Show devices' });
    }
    const m = machineFacts;
    if (m) {
      if (m.antivirusOff) add('bad', 'No antivirus is turned on', 'Windows Security reports that real-time protection is off.', { winsettings: 'security', linkLabel: 'Windows Security' });
      else if (m.antivirusOld) add('warn', 'Antivirus definitions are out of date', 'Your antivirus is on but hasn’t updated recently.', { winsettings: 'security', linkLabel: 'Windows Security' });
      if (m.firewallOff) add('bad', 'The firewall is off', 'Every Windows Firewall profile is turned off and no other firewall is on.', { winsettings: 'security', linkLabel: 'Windows Security' });
      if (m.batteryHealth != null && m.batteryHealth < 80) add(m.batteryHealth < 65 ? 'warn' : 'info', `The battery holds ${m.batteryHealth.toFixed(0)}% of its original charge`, 'Batteries wear with use. Below about 80% you’ll notice shorter battery life; System shows the details.', { link: 'system', linkLabel: 'Battery health' });
    }
    return out;
  }

  const RANK = { bad: 0, warn: 1, info: 2 };
  function findingHtml(i) {
    const buttons = [];
    if (i.group) buttons.push(`<button class="link" data-go="processes" data-group="${U.esc(i.group)}">Show</button>`);
    else if (i.link) buttons.push(`<button class="link" data-go="${i.link}">${U.esc(i.linkLabel || 'Show')}</button>`);
    if (i.winsettings) buttons.push(`<button class="link" data-winsettings="${i.winsettings}">${U.esc(i.linkLabel || 'Open')}</button>`);
    if (i.group && i.level !== 'info' && i.group !== 'syslens') buttons.push(`<button class="link danger" data-end-group="${U.esc(i.group)}">End task</button>`);
    return `<div class="insight ${i.level}"${i.group ? ` data-ctx-group="${U.esc(i.group)}"` : ''}>${U.LEVEL_ICONS[i.level]}<div><div class="t">${U.esc(i.title)}</div><div class="d">${U.esc(i.text)}</div>${buttons.length ? `<div class="go">${buttons.join('')}</div>` : ''}</div></div>`;
  }

  function renderActivity() {
    const el = U.$('#ov-activity');
    if (!el || !activity) return;
    el.innerHTML = activity.length
      ? activity
          .map(
            (e) => `<div class="event ${e.level || ''}" data-history style="grid-template-columns:18px minmax(0,1fr) auto;cursor:pointer">
              ${U.glyph(GLYPH[e.kind] || 'page', 'ev-ico')}
              <div class="what"><div class="t" title="${U.esc(e.title)}">${U.esc(e.title)}</div></div>
              <span class="count">${U.esc(U.when(e.t))}</span></div>`,
          )
          .join('')
      : '<div class="empty">Nothing notable this week.</div>';
  }

  let factsTimer = null;
  function show() {
    loadActivity();
    // The slower checks wait a little, so opening SysLens stays quick.
    clearTimeout(factsTimer);
    factsTimer = setTimeout(() => {
      if (App.current === 'overview') loadFacts();
    }, 6000);
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
    Charts.line(U.$('#ov-ram-chart'), {
      max: mem.total,
      series: [
        { data: h['mem.inUse'], color: '--c-mem' },
        { data: h['mem.compression'], color: '--m-compression', fillAlpha: 0.22, width: 1 },
      ],
    });
    set('ov-ram-max', U.bytes(mem.total));

    // Findings: live ones from the server plus the slower checks (event logs, startup, security).
    const findings = [...s.insights, ...slowFindings()].sort((a, b) => RANK[a.level] - RANK[b.level]);
    const bad = findings.filter((i) => i.level !== 'info').length;
    set('ov-find-sub', findings.length ? `${bad ? `${bad} to look at · ` : ''}${findings.length} in all` : 'checked every second');
    set(
      'ov-insights',
      findings.length
        ? findings.map(findingHtml).join('')
        : '<div class="insight info">' + U.LEVEL_ICONS.info + '<div><div class="t">Nothing needs attention</div><div class="d">No memory pressure, runaway processes, leaks, crashes, full drives or security problems right now.</div></div></div>',
    );
    loadActivity();

    // Top lists
    // Memory Compression holds other apps' compressed pages; it's shown in the breakdown instead.
    const apps = s.groups.filter((g) => g.exe !== 'memory compression');
    set('ov-topmem', topRows(apps.slice(0, 7), (g) => g.priv, (g) => U.bytes(g.priv), 'priv'));
    const byCpu = [...s.groups].sort((a, b) => b.cpu - a.cpu).slice(0, 7);
    set('ov-topcpu', topRows(byCpu, (g) => g.cpu, (g) => `${g.cpu.toFixed(1)}%`, 'cpu'));

    // This PC
    const sys = s.sys || {};
    const gpus = s.gpus.map((g) => g.name).join(', ') || '—';
    const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v" style="font-size:13px;font-weight:400">${v}</div></div>`;
    const b = s.battery;
    const t = s.temps && s.temps[0];
    const p = s.power;
    set(
      'ov-sys',
      [
        stat('Processor', U.esc(sys.cpu || '—')),
        stat('Cores', sys.cores ? `${sys.cores} cores · ${sys.logical} threads` : `${s.cpu.cores.length} logical`),
        stat('Memory', `${U.bytes(mem.installed)}${sys.ramSpeed ? ` · ${sys.ramSpeed} MT/s` : ''}`),
        stat('Graphics', U.esc(gpus)),
        stat('Windows', U.esc(`${(sys.os || '').replace('Microsoft ', '')}${sys.displayVersion ? ` ${sys.displayVersion}` : ''}`)),
        stat('Up time', U.dur(s.uptime)),
        b && b.hasBattery && b.percent != null ? stat('Battery', `${b.percent}% · ${b.charging ? 'charging' : b.ac ? 'plugged in' : b.secondsLeft ? `${U.span(b.secondsLeft * 1000)} left` : 'on battery'}`) : '',
        p && (p.system != null || p.socket != null) ? stat('Power draw', `${U.watts(p.system != null ? p.system : p.socket)}${p.cpu != null ? ` · CPU ${U.watts(p.cpu)}` : ''}`) : '',
        t ? stat('Temperature', `${t.c.toFixed(0)} °C${t.limit != null && t.limit < 100 ? ' · throttling' : ''}`) : '',
        stat('Device', U.esc([sys.manufacturer, sys.model].filter(Boolean).join(' ') || '—')),
      ].join(''),
    );
  }

  return { init, render, show, title: 'Overview' };
})();
