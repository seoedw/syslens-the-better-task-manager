'use strict';
/* global U, App, syslens, Menu, ServicesView */

// Things you can do to processes, services and startup entries, shared by every page and
// the right-click menus; plus "Run new task", the system report, shortcuts and what's new.
const Actions = (() => {
  const PRIORITIES = [
    ['idle', 'Low'],
    ['below', 'Below normal'],
    ['normal', 'Normal'],
    ['above', 'Above normal'],
    ['high', 'High'],
  ];
  const NO_ECO = new Set(['dwm.exe', 'audiodg.exe', 'csrss.exe']);
  const NO_SUSPEND = new Set(['dwm.exe', 'svchost.exe', 'sihost.exe', 'ctfmon.exe', 'textinputhost.exe', 'conhost.exe', 'audiodg.exe', 'wudfhost.exe', 'lsm.exe']);

  const setting = (k) => (App.settings ? App.settings[k] : undefined);
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // ---------- targets ----------
  /** One shape for an app row (group) and a single process. */
  function fromGroup(g) {
    const procs = ((App.snap && App.snap.procs) || []).filter((p) => p.group === g.key);
    const live = procs.length ? procs : g.pids.map((pid) => ({ pid, key: null }));
    const prios = new Set(procs.map((p) => p.priority).filter(Boolean));
    const main = procs.length ? procs.reduce((a, b) => ((b.created || Infinity) < (a.created || Infinity) ? b : a)) : null;
    return {
      kind: 'group',
      mainPid: main ? main.pid : g.pids[0],
      key: g.key,
      name: g.name,
      exe: g.exe,
      path: g.path,
      count: g.count,
      targets: live.map((p) => ({ pid: p.pid, key: p.key })),
      pids: g.pids.slice(),
      priv: g.priv,
      critical: g.critical,
      suspended: !!g.suspended,
      eco: !!g.eco,
      priority: prios.size === 1 ? [...prios][0] : null,
      hasWindow: !!g.hasWindows,
      isSelf: g.key === 'syslens',
    };
  }

  function fromProc(p) {
    return {
      kind: 'proc',
      mainPid: p.pid,
      key: p.key,
      group: p.group,
      name: p.display || p.name,
      exe: p.exe || (p.name || '').toLowerCase(),
      path: p.pathGuessed ? null : p.path,
      count: 1,
      targets: [{ pid: p.pid, key: p.key }],
      pids: [p.pid],
      pid: p.pid,
      priv: p.priv,
      critical: p.critical,
      suspended: !!p.suspended,
      eco: !!p.eco,
      priority: p.priority || null,
      hasWindow: !!(p.windows && p.windows.length),
      isSelf: p.group === 'syslens',
    };
  }

  function needsAdminHint(results) {
    return results.some((r) => !r.ok && /Access denied/i.test(r.error || '')) && !(App.snap && App.snap.admin);
  }

  function adminToast(message) {
    U.toast(message, 'bad', 9000, App.snap && !App.snap.admin ? { label: 'Restart as administrator', run: () => App.elevate() } : null);
  }

  function report(results, okText, failText) {
    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    if (!results.length) {
      U.toast('It already exited.', 'info');
      return false;
    }
    if (!failed.length) {
      U.toast(okText(ok), 'good');
      return true;
    }
    const reasons = [...new Set(failed.map((f) => f.error))].join('; ');
    const msg = `${ok ? `${okText(ok)} ` : ''}${failText(failed.length)}: ${reasons}.`;
    if (needsAdminHint(failed)) adminToast(msg);
    else U.toast(msg, 'bad', 8000);
    return ok > 0;
  }

  // ---------- process actions ----------
  async function endTask(item, { tree = false } = {}) {
    if (item.critical) {
      U.toast(`${item.name} is a critical Windows process. Ending it would crash Windows, so SysLens won’t.`, 'warn');
      return false;
    }
    if (setting('confirmEnd') !== false) {
      const n = item.targets.length;
      const what = tree ? `${U.esc(item.name)} and every process it started` : n > 1 ? `all <b>${n}</b> processes of ${U.esc(item.name)}` : `${U.esc(item.name)} (PID ${item.pids[0]})`;
      const ok = await U.confirm({
        title: `${tree ? 'End process tree of' : 'End'} ${item.name}?`,
        body: `This ends ${what}, freeing about <b>${U.bytes(item.priv || 0)}</b>${tree ? ' or more' : ''}. Unsaved work will be lost.${item.isSelf ? '<br><br>This is SysLens itself: its window will close.' : ''}`,
        confirmLabel: tree ? 'End process tree' : n > 1 ? `End ${n} processes` : 'End task',
        danger: true,
      });
      if (!ok) return false;
    }
    const res = tree ? await syslens.killTree(item.targets) : await syslens.kill(item.targets);
    return report(
      res,
      (n) => `Ended ${plural(n, 'process', 'processes')}${tree ? '' : ` of ${item.name}`}.`,
      (n) => `${plural(n, 'process', 'processes')} couldn’t be ended`,
    );
  }

  async function setPriority(item, level, label) {
    if (level === 'high' && setting('confirmEnd') !== false) {
      const ok = await U.confirm({
        title: `Run ${item.name} at high priority?`,
        body: 'High priority lets it take processor time ahead of almost everything else. If it gets busy, other apps (and SysLens) can become slow to respond.',
        confirmLabel: 'Set to High',
      });
      if (!ok) return;
    }
    const res = await syslens.priority(item.targets, level);
    report(res, () => `${item.name} now runs at ${label.toLowerCase()} priority.`, (n) => `${plural(n, 'process', 'processes')} couldn’t be changed`);
    App.refreshSoon();
  }

  async function setEfficiency(item, on) {
    if (on && setting('confirmEco') !== false) {
      const pending = U.confirm({
        title: `Turn on efficiency mode for ${item.name}?`,
        body: `Efficiency mode lowers its priority and asks Windows to run it on the most power-efficient cores at lower clock speeds. It saves battery and keeps other apps responsive, but ${U.esc(item.name)} may run slower.
          <label class="check" style="margin-top:12px"><input type="checkbox" id="ecoNoAsk"> Don’t ask again</label>`,
        confirmLabel: 'Turn on efficiency mode',
      });
      // The dialog is gone once it answers, so note the box as it changes.
      let dontAsk = false;
      const box = document.getElementById('ecoNoAsk');
      if (box) box.addEventListener('change', () => (dontAsk = box.checked));
      const ok = await pending;
      if (!ok) return;
      if (dontAsk) App.saveSettings({ confirmEco: false });
    }
    const res = await syslens.efficiency(item.targets, on);
    report(res, () => `Efficiency mode is ${on ? 'on' : 'off'} for ${item.name}.`, (n) => `${plural(n, 'process', 'processes')} couldn’t be changed`);
    App.refreshSoon();
  }

  async function suspend(item, on) {
    if (on) {
      const ok = await U.confirm({
        title: `Suspend ${item.name}?`,
        body: `Every thread of ${U.esc(item.name)} is paused until you resume it: it uses no processor time but keeps its memory, and its windows stop responding. Use <b>Resume</b> from this menu to continue.`,
        confirmLabel: 'Suspend',
      });
      if (!ok) return;
    }
    const res = await syslens.suspend(item.targets, on);
    report(res, () => `${item.name} is ${on ? 'suspended' : 'running again'}.`, (n) => `${plural(n, 'process', 'processes')} couldn’t be ${on ? 'suspended' : 'resumed'}`);
    App.refreshSoon();
  }

  /** Windows Explorer: Task Manager offers Restart in place of End task for it. */
  const isExplorer = (item) => item && item.exe === 'explorer.exe';

  /** Apps "Restart app" can start again: desktop programs SysLens can read the command line of. */
  const restartable = (item) => !!item.path && !item.critical && !item.isSelf && !isExplorer(item) && !/\\windowsapps\\/i.test(item.path) && !/^(svchost|dwm|csrss|wininit|services|lsass|smss)\.exe$/.test(item.exe);

  async function restartApp(item) {
    const admin = App.snap && App.snap.admin;
    const ok = await U.confirm({
      title: `Restart ${item.name}?`,
      body: `${U.esc(item.name)} closes${item.count > 1 ? ` (all ${item.count} of its processes)` : ''} and opens again with the same settings it was started with. <b>Unsaved work in it will be lost.</b>${admin ? '<br><br>Because SysLens is running as administrator, it will start again as administrator.' : ''}`,
      confirmLabel: 'Restart',
      danger: true,
    });
    if (!ok) return false;
    U.toast(`Restarting ${item.name}…`, 'info', 2500);
    const r = await syslens.restartApp(item.targets, item.mainPid);
    if (r && r.ok) U.toast(`${item.name} restarted.`, 'good');
    else if (r && /denied/i.test(r.error || '')) adminToast(`Couldn’t restart ${item.name}: ${r.error}.`);
    else U.toast(`Couldn’t restart ${item.name}: ${(r && r.error) || 'no answer'}.`, 'bad', 7000);
    App.refreshSoon();
    return !!(r && r.ok);
  }

  async function switchTo(item) {
    const r = await syslens.switchTo(item.pids);
    if (!r || !r.ok) U.toast((r && r.error) || 'Couldn’t switch to it.', 'warn');
  }

  async function restartExplorer() {
    const ok = await U.confirm({
      title: 'Restart Windows Explorer?',
      body: 'The taskbar, desktop and open folder windows close and come back a few seconds later. Useful when the taskbar or Start menu stops responding.',
      confirmLabel: 'Restart Explorer',
    });
    if (!ok) return;
    const r = await syslens.restartExplorer();
    if (r && r.ok) U.toast(r.note || 'Explorer restarted.', 'good');
    else U.toast((r && r.error) || 'Couldn’t restart Explorer.', 'bad');
  }

  function searchOnline(text) {
    syslens.search(text).then((ok) => {
      if (!ok) U.toast('Nothing to search for.', 'warn');
    });
  }

  async function copyCommandLine(pid) {
    const d = await syslens.details(pid).catch(() => null);
    if (d && d.cmd) U.copy(d.cmd, 'Command line copied');
    else U.toast('The command line can’t be read without administrator rights.', 'warn');
  }

  function servicesIn(pids) {
    const data = ServicesView.data;
    if (!data) return null;
    const set = new Set(pids);
    return data.list.filter((s) => s.pid && set.has(s.pid));
  }

  /** The right-click menu for an app row or a process. */
  function processMenu(item, extra = []) {
    const noEco = item.critical || NO_ECO.has(item.exe);
    const noSuspend = item.critical || item.isSelf || NO_SUSPEND.has(item.exe);
    const explorer = item.exe === 'explorer.exe';
    const svcs = servicesIn(item.pids);
    const many = item.kind === 'group' && item.count > 1;
    return [
      item.hasWindow && { label: 'Switch to', icon: 'window', run: () => switchTo(item) },
      explorer && { label: 'Restart', icon: 'restart', kbd: 'Del', tip: 'Restarts the taskbar, Start menu and desktop; your apps stay open', run: restartExplorer },
      { label: many ? `End task (${item.count} processes)` : 'End task', icon: 'end', danger: true, disabled: item.critical, kbd: explorer ? '' : 'Del', run: () => endTask(item) },
      { label: 'End process tree', icon: 'tree', danger: true, disabled: item.critical, kbd: 'Shift+Del', run: () => endTask(item, { tree: true }) },
      restartable(item) && { label: 'Restart app', icon: 'restart', tip: 'Close it and open it again', run: () => restartApp(item) },
      '-',
      { label: 'Efficiency mode', checked: item.eco, disabled: noEco, tip: noEco ? 'Not available for this process' : 'Lower priority and power-efficient cores (EcoQoS)', run: () => setEfficiency(item, !item.eco) },
      {
        label: 'Set priority',
        icon: 'gauge',
        disabled: item.critical,
        sub: PRIORITIES.map(([level, label]) => ({ label, checked: item.priority === label, run: () => setPriority(item, level, label) })),
      },
      item.suspended
        ? { label: 'Resume', icon: 'play', run: () => suspend(item, false) }
        : { label: 'Suspend', icon: 'pause', disabled: noSuspend, tip: noSuspend ? 'Pausing this would freeze Windows or SysLens' : '', run: () => suspend(item, true) },
      '-',
      item.path && { label: 'Open file location', icon: 'folder', run: () => syslens.showItem(item.path) },
      { label: 'Search online', icon: 'search', run: () => searchOnline(item.exe && item.exe !== item.name.toLowerCase() ? `${item.exe} ${item.name}` : item.name) },
      svcs && svcs.length
        ? { label: `Go to service${svcs.length === 1 ? '' : 's'} (${svcs.length})`, icon: 'service', run: () => App.go('services', { pid: item.pids[0], pids: item.pids }) }
        : !svcs && /svchost|services/.test(item.exe) && { label: 'Go to services', icon: 'service', run: () => App.go('services', { pids: item.pids }) },
      {
        label: 'Copy',
        icon: 'copy',
        sub: [
          { label: 'Name', run: () => U.copy(item.name, 'Name copied') },
          item.exe && { label: 'Process name', hint: item.exe, run: () => U.copy(item.exe, 'Process name copied') },
          { label: many ? 'Process IDs' : 'PID', hint: many ? `${item.pids.length}` : String(item.pids[0]), run: () => U.copy(item.pids.join(', '), many ? 'Process IDs copied' : 'PID copied') },
          item.path && { label: 'File path', run: () => U.copy(item.path, 'Path copied') },
          item.kind === 'proc' && { label: 'Command line', run: () => copyCommandLine(item.pid) },
        ].filter(Boolean),
      },
      ...(extra.length ? ['-', ...extra] : []),
    ].filter(Boolean);
  }

  // ---------- services ----------
  async function serviceControl(svc, action) {
    if (action !== 'start') {
      const ok = await U.confirm({
        title: `${action === 'stop' ? 'Stop' : 'Restart'} ${svc.display}?`,
        body: `${svc.description ? `${U.esc(svc.description)}<br><br>` : ''}${action === 'stop' ? 'Features that rely on it stop working until it starts again.' : 'It stops and starts again; anything using it is interrupted briefly.'}`,
        confirmLabel: action === 'stop' ? 'Stop service' : 'Restart service',
        danger: action === 'stop',
      });
      if (!ok) return false;
    }
    const verb = { start: 'Starting', stop: 'Stopping', restart: 'Restarting' }[action];
    U.toast(`${verb} ${svc.display}…`, 'info', 2500);
    const r = await syslens.serviceControl(svc.name, action);
    if (r && r.ok) U.toast(`${svc.display} is ${String(r.state || '').toLowerCase() || 'done'}.`, 'good');
    else if (r && /administrator/i.test(r.error)) adminToast(`Couldn’t ${action} ${svc.display}: ${r.error}.`);
    else U.toast(`Couldn’t ${action} ${svc.display}: ${(r && r.error) || 'no answer'}.`, 'bad', 8000);
    return !!(r && r.ok);
  }

  const START_TYPES = [
    ['auto', 'Automatic'],
    ['delayed', 'Automatic (delayed)'],
    ['manual', 'Manual'],
    ['disabled', 'Disabled'],
  ];

  async function serviceStartType(svc, type, label) {
    if (type === 'disabled') {
      const ok = await U.confirm({
        title: `Disable ${svc.display}?`,
        body: `It won’t start at all, not even when Windows or an app asks for it. ${svc.isWindows ? 'This is a Windows service: disabling it can break Windows features.' : ''}`,
        confirmLabel: 'Disable',
        danger: true,
      });
      if (!ok) return false;
    }
    const r = await syslens.serviceStartType(svc.name, type);
    if (r && r.ok) U.toast(`${svc.display} now starts: ${label}.`, 'good');
    else if (r && /administrator/i.test(r.error)) adminToast(`Couldn’t change ${svc.display}: ${r.error}.`);
    else U.toast(`Couldn’t change ${svc.display}: ${(r && r.error) || 'no answer'}.`, 'bad', 8000);
    return !!(r && r.ok);
  }

  function serviceMenu(svc, after) {
    const done = (p) => Promise.resolve(p).then((ok) => ok && after && after());
    const proc = svc.pid && App.snap ? (App.snap.procs || []).find((p) => p.pid === svc.pid) : null;
    const current = svc.startType;
    return [
      { label: 'Start', icon: 'start', disabled: svc.running || current === 'Disabled', run: () => done(serviceControl(svc, 'start')) },
      { label: 'Stop', icon: 'stop', disabled: !svc.running, run: () => done(serviceControl(svc, 'stop')) },
      { label: 'Restart', icon: 'restart', disabled: !svc.running, run: () => done(serviceControl(svc, 'restart')) },
      '-',
      { label: 'Startup type', icon: 'power', sub: START_TYPES.map(([type, label]) => ({ label, checked: current === label, run: () => done(serviceStartType(svc, type, label)) })) },
      '-',
      svc.pid ? { label: 'Go to process', icon: 'list', run: () => (proc ? App.go('processes', { group: proc.group, pid: proc.pid }) : App.go('processes')) } : null,
      { label: 'Open Services', icon: 'service', run: () => syslens.openSettings('services') },
      { label: 'Search online', icon: 'search', run: () => searchOnline(`${svc.name} service ${svc.display}`) },
      {
        label: 'Copy',
        icon: 'copy',
        sub: [
          { label: 'Service name', hint: svc.name, run: () => U.copy(svc.name, 'Service name copied') },
          { label: 'Display name', run: () => U.copy(svc.display, 'Name copied') },
          svc.command && { label: 'Command line', run: () => U.copy(svc.command, 'Command line copied') },
        ].filter(Boolean),
      },
    ].filter(Boolean);
  }

  // ---------- startup entries ----------
  async function startupToggle(entry, on) {
    const r = await syslens.startupToggle(entry.id, on);
    if (r && r.ok) U.toast(`${entry.title || entry.name} ${on ? 'will start' : 'won’t start'} with Windows.`, 'good');
    else if (r && /administrator/i.test(r.error)) adminToast(`Couldn’t change ${entry.title || entry.name}: it’s set for all users, which needs administrator rights.`);
    else U.toast(`Couldn’t change ${entry.title || entry.name}: ${(r && r.error) || 'no answer'}.`, 'bad', 8000);
    return !!(r && r.ok);
  }

  function startupMenu(entry, after) {
    const loc = entry.exe || entry.file;
    return [
      entry.enabled
        ? { label: 'Disable', icon: 'power', disabled: !entry.toggle, tip: entry.policy ? 'Set by your organization' : '', run: () => startupToggle(entry, false).then((ok) => ok && after && after(false)) }
        : { label: 'Enable', icon: 'power', disabled: !entry.toggle, run: () => startupToggle(entry, true).then((ok) => ok && after && after(true)) },
      '-',
      entry.run && { label: 'Go to process', icon: 'list', run: () => App.go('processes', { group: entry.run.key }) },
      loc && { label: 'Open file location', icon: 'folder', run: () => syslens.showItem(loc) },
      { label: 'Search online', icon: 'search', run: () => searchOnline(`${entry.title || entry.name} startup`) },
      {
        label: 'Copy',
        icon: 'copy',
        sub: [
          { label: 'Name', run: () => U.copy(entry.title || entry.name, 'Name copied') },
          entry.command && { label: 'Command', run: () => U.copy(entry.command, 'Command copied') },
          loc && { label: 'File path', run: () => U.copy(loc, 'Path copied') },
        ].filter(Boolean),
      },
    ].filter(Boolean);
  }

  // ---------- paths (storage) ----------
  function pathMenu(p, { dir = false, name = '', open = null } = {}) {
    return [
      dir && open && { label: 'Open here', icon: 'list', run: open },
      dir ? { label: 'Open in Explorer', icon: 'folder', run: () => syslens.openFolder(p) } : { label: 'Show in Explorer', icon: 'folder', run: () => syslens.showItem(p) },
      dir && { label: 'Show in its folder', icon: 'folder', run: () => syslens.showItem(p) },
      '-',
      name && { label: 'Search online', icon: 'search', run: () => searchOnline(name) },
      { label: 'Copy path', icon: 'copy', run: () => U.copy(p, 'Path copied') },
      name && { label: 'Copy name', icon: 'copy', run: () => U.copy(name, 'Name copied') },
    ].filter(Boolean);
  }

  // ---------- run new task ----------
  const COMMON = ['cmd', 'powershell', 'notepad', 'control', 'regedit', 'msconfig', 'devmgmt.msc', 'diskmgmt.msc', 'eventvwr.msc', 'services.msc', 'resmon', 'perfmon', 'mstsc', 'explorer', '%TEMP%', 'ms-settings:'];

  function runTask() {
    const admin = App.snap && App.snap.admin;
    const m = U.modal({
      title: 'Run new task',
      body: `<p class="muted" style="margin:0 0 12px">Type the name of a program, folder, document or website, and Windows will open it.</p>
        <input class="input" id="rt-cmd" list="rt-common" placeholder="e.g. notepad, cmd, %TEMP%, https://…" spellcheck="false" autocomplete="off">
        <datalist id="rt-common">${COMMON.map((c) => `<option value="${U.esc(c)}">`).join('')}</datalist>
        <label class="check" style="margin-top:12px"><input type="checkbox" id="rt-admin" ${admin ? 'checked disabled' : ''}> Create this task with administrative privileges${admin ? ' <span class="faint">(SysLens is running as administrator)</span>' : ''}</label>
        <div class="field-error" id="rt-err"></div>
        <div class="actions"><button class="btn primary" id="rt-ok">Open</button><button class="btn" data-modal-close>Cancel</button></div>`,
    });
    const input = m.el.querySelector('#rt-cmd');
    const go = async () => {
      const cmd = input.value.trim();
      if (!cmd) return input.focus();
      m.el.querySelector('#rt-ok').disabled = true;
      const r = await syslens.runTask(cmd, m.el.querySelector('#rt-admin').checked);
      if (r && r.ok) {
        m.close();
        U.toast(`Opened ${cmd}.`, 'good', 2500);
      } else {
        m.el.querySelector('#rt-ok').disabled = false;
        m.el.querySelector('#rt-err').textContent = (r && r.error) || 'Couldn’t open it.';
        input.focus();
      }
    };
    m.el.querySelector('#rt-ok').addEventListener('click', go);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    });
    input.focus();
  }

  // ---------- system report ----------
  function systemReport() {
    const s = App.snap;
    if (!s) return '';
    const sys = s.sys || {};
    const mem = s.mem;
    const L = [];
    L.push(`SysLens ${App.info ? `v${App.info.version}` : ''} system report — ${new Date().toLocaleString()}`);
    L.push('');
    if (sys.manufacturer || sys.model) L.push(`Device:     ${[sys.manufacturer, sys.model].filter(Boolean).join(' ')}`);
    L.push(`Windows:    ${(sys.os || '').replace('Microsoft ', '')}${sys.displayVersion ? ` ${sys.displayVersion}` : ''}${sys.build ? ` (build ${sys.build})` : ''}`);
    L.push(`Processor:  ${sys.cpu || '—'}${sys.cores ? ` · ${sys.cores} cores, ${sys.logical} threads` : ''} · ${s.cpu.total.toFixed(0)}% busy`);
    L.push(`Memory:     ${U.bytes(mem.inUse)} of ${U.bytes(mem.total)} in use (${Math.round((mem.inUse / mem.total) * 100)}%), ${U.bytes(mem.available)} available, ${U.bytes(mem.committed)} of ${U.bytes(mem.commitLimit)} committed`);
    L.push(`Graphics:   ${s.gpus.map((g) => `${g.name} (${g.util.toFixed(0)}%)`).join(', ') || '—'}`);
    for (const d of s.disks) L.push(`Disk ${d.number}:     ${d.model || 'disk'}${d.letters ? ` (${d.letters})` : ''} · ${d.active.toFixed(0)}% active`);
    if (s.battery && s.battery.hasBattery) L.push(`Battery:    ${s.battery.percent}%${s.battery.charging ? ', charging' : s.battery.ac ? ', plugged in' : ', on battery'}`);
    if (s.temps && s.temps[0]) L.push(`Temp:       ${s.temps[0].c.toFixed(0)} °C`);
    L.push(`Up time:    ${U.dur(s.uptime)} · ${s.totals.processes} processes, ${s.totals.threads} threads, ${s.totals.handles} handles`);
    L.push('');
    L.push('Using the most memory:');
    s.groups
      .filter((g) => g.exe !== 'memory compression')
      .slice(0, 12)
      .forEach((g, i) => L.push(`  ${String(i + 1).padStart(2)}. ${g.name.padEnd(36).slice(0, 36)} ${U.bytes(g.priv).padStart(9)}${g.count > 1 ? `  (${g.count} processes)` : ''}`));
    L.push('');
    L.push('Using the most CPU:');
    [...s.groups]
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 5)
      .forEach((g, i) => L.push(`  ${i + 1}. ${g.name.padEnd(36).slice(0, 36)} ${g.cpu.toFixed(1).padStart(5)}%`));
    if (s.insights.length) {
      L.push('');
      L.push('Findings:');
      for (const f of s.insights) L.push(`  [${f.level}] ${f.title}. ${f.text}`);
    }
    return L.join('\n');
  }

  function copyReport() {
    const text = systemReport();
    if (!text) return U.toast('Nothing measured yet.', 'warn');
    U.copy(text, 'System report copied');
  }

  // ---------- administrator mode ----------
  const ADMIN_CAN = [
    ['See every detail of every process', 'Full paths, command lines, user accounts and integrity levels of Windows’ own processes and other users’ apps, which a normal account can’t read.'],
    ['Act on any process', 'End, suspend, or change the priority or efficiency mode of processes run by Windows services and other users.'],
    ['Control services', 'Start, stop and restart services, and change how they start.'],
    ['Change startup apps for everyone', 'Turn entries for all users on or off (the machine-wide Run keys and the all-users Startup folder).'],
    ['Scan protected folders', 'Storage measures folders a normal account can’t open, like other users’ files and parts of Windows.'],
    ['Manage other people’s sessions', 'Disconnect or sign out other users signed in to this PC (Users page).'],
    ['Start programs as administrator', 'Run new task and admin-only tools open with full rights, without another prompt.'],
  ];
  const ADMIN_NOTES = [
    'Windows asks for permission first (the User Account Control prompt).',
    'SysLens opens again in a new administrator window, and this window closes. Your settings carry over.',
    'What you change can affect the whole PC and everyone who uses it. SysLens still asks before anything risky, and still refuses to touch processes Windows can’t live without.',
    'The administrator window uses a browser profile of its own that only administrators can change, and its access key is never written to disk.',
  ];
  const adminList = () =>
    `<ul class="admin-list">${ADMIN_CAN.map(([t, d]) => `<li><b>${U.esc(t)}</b><span>${U.esc(d)}</span></li>`).join('')}</ul>`;

  /** "Are you sure?" before restarting as administrator, with everything it changes. */
  function confirmElevate() {
    return new Promise((resolve) => {
      let answered = false;
      const m = U.modal({
        title: 'Run SysLens as administrator?',
        wide: true,
        body: `<p class="muted" style="margin:0 0 10px">With administrator rights, SysLens can do more than a normal account allows:</p>
          ${adminList()}
          <div class="admin-notes"><div class="set-sub" style="margin:4px 0 6px">Good to know</div><ul>${ADMIN_NOTES.map((n) => `<li>${U.esc(n)}</li>`).join('')}</ul></div>
          <div class="actions"><button class="btn primary" id="ad-yes">Run as administrator</button><button class="btn" data-modal-close>Cancel</button></div>`,
        onClose: () => {
          if (!answered) resolve(false);
        },
      });
      m.el.querySelector('#ad-yes').addEventListener('click', () => {
        answered = true;
        m.close();
        resolve(true);
      });
      m.el.querySelector('#ad-yes').focus();
    });
  }

  /** Already administrator: what that makes possible. */
  function adminInfo() {
    U.modal({
      title: 'Running as administrator',
      wide: true,
      body: `<p class="muted" style="margin:0 0 10px">SysLens has administrator rights in this window, so you can now:</p>
        ${adminList()}
        <p class="faint" style="margin:12px 0 0">To go back to a normal window, close this one and open SysLens again from its shortcut.</p>
        <div class="actions"><button class="btn primary" data-modal-close>Got it</button></div>`,
    });
  }

  // ---------- help and what's new ----------
  function shortcuts() {
    const hk = setting('hotkey');
    const rows = [
      ['Search everything', 'Ctrl+K'],
      ['Pages, in sidebar order', 'Ctrl+1 … Ctrl+0'],
      ['Settings', 'Ctrl+,'],
      ['Run new task', 'Ctrl+N'],
      ['Copy a system report', 'Ctrl+Shift+C'],
      ['These shortcuts', '?'],
      ['Open SysLens from anywhere', hk || 'Off (set one in Settings)'],
      null,
      ['Processes: move through the list', '↑ ↓'],
      ['Open or close an app’s group', 'Enter'],
      ['Right-click menu for the selected row', 'Shift+F10'],
      ['End task', 'Delete'],
      ['End process tree', 'Shift+Delete'],
      ['Filter the list', 'Ctrl+F'],
      ['Clear the selection', 'Esc'],
    ];
    U.modal({
      title: 'Keyboard shortcuts',
      body: `<div class="shortcuts">${rows
        .map((r) => (r ? `<div class="sc-row"><span>${U.esc(r[0])}</span><span>${/[+…↑]|^\?$|^Enter$|^Delete$|^Esc$/.test(r[1]) && !/^Off/.test(r[1]) ? U.keys(r[1]) : U.esc(r[1])}</span></div>` : '<div class="sc-sep"></div>'))
        .join('')}</div>`,
    });
  }

  /** A small Markdown subset: version headings, section headings, bullets, **bold**, `code`. */
  function renderChangelog(md, only) {
    const inline = (s) =>
      U.esc(s)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
    const out = [];
    let inList = false;
    let skipping = true; // the file's introduction, before the first version
    let versions = 0;
    for (const raw of md.split(/\r?\n/)) {
      const line = raw.trimEnd();
      const ver = /^##\s+\[?([\d.]+)\]?(?:\s*[-–—]\s*(.+))?$/.exec(line);
      if (ver) {
        if (inList) out.push('</ul>');
        inList = false;
        skipping = !!only && ver[1] !== only;
        if (!skipping) {
          versions++;
          out.push(`<h4 class="cl-ver">Version ${U.esc(ver[1])}${ver[2] ? ` <span class="faint">· ${U.esc(ver[2])}</span>` : ''}</h4>`);
        }
        continue;
      }
      if (skipping || /^#\s/.test(line)) continue;
      const sec = /^###\s+(.+)$/.exec(line);
      if (sec) {
        if (inList) out.push('</ul>');
        inList = false;
        out.push(`<div class="cl-sec">${U.esc(sec[1])}</div>`);
      } else if (/^\s*[-*]\s+/.test(line)) {
        if (!inList) out.push('<ul class="cl-list">');
        inList = true;
        out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      } else if (line.trim()) {
        if (inList) out.push('</ul>');
        inList = false;
        out.push(`<p>${inline(line)}</p>`);
      }
    }
    if (inList) out.push('</ul>');
    return versions ? out.join('') : '';
  }

  async function changelog(only = null) {
    const md = await syslens.changelog().catch(() => '');
    const html = md ? renderChangelog(md, only) || renderChangelog(md) : '';
    U.modal({
      title: only ? `What’s new in SysLens ${only}` : 'Changelog',
      wide: true,
      body: `<div class="changelog">${html || '<div class="empty">The changelog isn’t available.</div>'}</div>${only ? '<div class="actions"><button class="btn" id="cl-all">Every version</button></div>' : ''}`,
    });
    const all = document.getElementById('cl-all');
    if (all) all.addEventListener('click', () => changelog(null));
  }

  return {
    fromGroup,
    fromProc,
    processMenu,
    serviceMenu,
    startupMenu,
    pathMenu,
    endTask,
    setEfficiency,
    suspend,
    switchTo,
    restartExplorer,
    searchOnline,
    runTask,
    copyReport,
    systemReport,
    shortcuts,
    changelog,
    startupToggle,
    serviceControl,
    confirmElevate,
    adminInfo,
    restartApp,
    isExplorer,
    restartable,
  };
})();
