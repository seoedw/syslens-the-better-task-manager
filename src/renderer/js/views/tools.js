'use strict';
/* global U, App, syslens, Actions, Menu */

// Tools: quick fixes and every Windows tool worth knowing about, one click away, each with a
// line on what it's for. Only the tools listed here can be opened (the server has the same list).
const ToolsView = (() => {
  let root;

  const I = {
    fix: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z"/>',
    dns: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 2.6 14.6 0 17M12 3.5c-2.6 2.4-2.6 14.6 0 17"/>',
    restart: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/>',
    run: '<path d="M4 6.5h16v11H4z"/><path d="M7 10l2.5 2L7 14M11.5 14h4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    log: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    chart: '<path d="M3.5 20h17"/><path d="M5 16l4-5 4 3 6-8"/>',
    gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    disk: '<rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M5 13l2.5-8h9L19 13"/><path d="M16.5 16.5h.01"/>',
    broom: '<path d="M14 3l-4 9"/><path d="M6 12h8l2 8H4z"/>',
    memory: '<rect x="2.5" y="7" width="19" height="9" rx="1.5"/><path d="M6 16v3M10 16v3M14 16v3M18 16v3"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
    update: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/>',
    life: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M6 6l3.5 3.5M14.5 14.5L18 18M18 6l-3.5 3.5M9.5 14.5L6 18"/>',
    reg: '<path d="M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4z"/><path d="M15 16.5h4M17 14.5v4"/>',
    sliders: '<path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="9" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="19" cy="8" r="2"/>',
    var: '<path d="M7 4c-2 0-3 1-3 3v3c0 1-1 2-2 2 1 0 2 1 2 2v3c0 2 1 3 3 3M17 4c2 0 3 1 3 3v3c0 1 1 2 2 2-1 0-2 1-2 2v3c0 2-1 3-3 3"/>',
    window: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9h17"/>',
    term: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M12 15h5"/>',
    apps: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    power: '<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
    wifi: '<path d="M12 19.5h.01"/><path d="M8.6 16a5 5 0 0 1 6.8 0"/><path d="M5.3 12.6a9.6 9.6 0 0 1 13.4 0"/><path d="M2 9.2a14.4 14.4 0 0 1 20 0"/>',
    display: '<rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16.5V20"/>',
    sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    bt: '<path d="M7 7l10 10-5 4V3l5 4L7 17"/>',
  };

  // [id, name, what it's for, icon, needs admin]
  const SECTIONS = [
    [
      'Quick fixes',
      [
        ['@flushdns', 'Flush DNS cache', 'Forget saved web addresses: fixes sites that moved or won’t load', 'dns', true],
        ['@explorer', 'Restart Windows Explorer', 'Brings back a frozen taskbar, Start menu or desktop', 'restart'],
        ['@run', 'Run new task', 'Open any program, folder or website by name (Ctrl+N)', 'run'],
        ['@report', 'Copy system report', 'A plain-text summary of this PC, for asking someone for help', 'copy'],
        ['@lock', 'Lock this PC', 'Same as Windows+L', 'lock'],
      ],
    ],
    [
      'Look deeper',
      [
        ['devmgmt', 'Device Manager', 'Hardware and drivers, with problems flagged', 'chip'],
        ['eventvwr', 'Event Viewer', 'Every log Windows keeps, in full', 'log'],
        ['reliability', 'Reliability Monitor', 'A day-by-day stability score with every crash', 'chart'],
        ['resmon', 'Resource Monitor', 'Live disk, network and memory per process', 'gauge'],
        ['perfmon', 'Performance Monitor', 'Any performance counter, charted over time', 'chart'],
        ['msinfo32', 'System Information', 'Every hardware and software detail Windows knows', 'info'],
        ['taskschd', 'Task Scheduler', 'Everything set to run on a schedule or at events', 'clock'],
        ['services', 'Services', 'The full services console', 'gear'],
        ['compmgmt', 'Computer Management', 'Disks, users, shares, logs and services in one place', 'window'],
        ['diskmgmt', 'Disk Management', 'Partitions, drive letters and volumes', 'disk'],
      ],
    ],
    [
      'Clean up and repair',
      [
        ['cleanmgr', 'Disk Cleanup', 'Remove temporary files, update leftovers and more', 'broom'],
        ['storage', 'Storage settings', 'Storage Sense and cleanup recommendations', 'disk'],
        ['mdsched', 'Windows Memory Diagnostic', 'Test your RAM for errors at the next restart', 'memory', true],
        ['troubleshoot', 'Troubleshooters', 'Windows’ own fixers for audio, network, printing…', 'wrench'],
        ['update', 'Windows Update', 'Check for and install updates', 'update'],
        ['security', 'Windows Security', 'Virus scans, firewall and device security', 'shield'],
        ['recovery', 'Recovery', 'Reset this PC or start from a recovery drive', 'life'],
      ],
    ],
    [
      'Settings and consoles',
      [
        ['msconfig', 'System Configuration', 'Boot options and a clean start for troubleshooting', 'sliders', true],
        ['regedit', 'Registry Editor', 'Windows’ settings database. Change with care.', 'reg', true],
        ['envvars', 'Environment variables', 'PATH and other variables programs read', 'var'],
        ['sysprops', 'Advanced system settings', 'Page file, visual effects, startup and recovery', 'gear'],
        ['control', 'Control Panel', 'The classic settings', 'apps'],
        ['taskmgr', 'Task Manager', 'Windows’ own, for comparison', 'window'],
        ['terminal', 'Windows Terminal', 'Command Prompt, PowerShell and more in tabs', 'term'],
        ['cmd', 'Command Prompt', 'cmd.exe', 'term'],
        ['powershell', 'PowerShell', 'Windows PowerShell', 'term'],
        ['apps', 'Installed apps', 'Uninstall or repair apps', 'apps'],
        ['startup', 'Startup apps settings', 'Windows’ own startup switches', 'power'],
        ['network', 'Network settings', 'Wi-Fi, Ethernet, VPN and proxy', 'wifi'],
        ['power', 'Power & sleep', 'When the screen turns off and the PC sleeps', 'power'],
        ['display', 'Display', 'Resolution, scale and refresh rate', 'display'],
        ['sound', 'Sound', 'Output and input devices', 'sound'],
        ['bluetooth', 'Bluetooth & devices', 'Pair and manage devices', 'bt'],
      ],
    ],
  ];

  const svg = (name) => `<svg class="tool-ico" viewBox="0 0 24 24" aria-hidden="true">${I[name] || I.gear}</svg>`;

  function init(el) {
    root = el;
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tool]');
      if (t) open(t.dataset.tool);
    });
    root.addEventListener('contextmenu', (e) => {
      const t = e.target.closest('[data-tool]');
      if (!t) return;
      const name = t.querySelector('b').textContent;
      Menu.openAt(e, [
        { label: `Open ${name}`, icon: 'start', run: () => open(t.dataset.tool) },
        !t.dataset.tool.startsWith('@') && { label: 'Search online', icon: 'search', run: () => Actions.searchOnline(`Windows ${name}`) },
      ]);
    });
  }

  async function open(id) {
    if (id === '@flushdns') {
      const r = await syslens.flushDns();
      if (r && r.error === 'Cancelled') return;
      U.toast(r && r.ok ? 'DNS cache cleared.' : `Couldn’t clear it: ${(r && r.error) || 'no answer'}`, r && r.ok ? 'good' : 'bad');
    } else if (id === '@explorer') Actions.restartExplorer();
    else if (id === '@run') Actions.runTask();
    else if (id === '@report') Actions.copyReport();
    else if (id === '@lock') {
      const u = await syslens.users().catch(() => null);
      if (u && u.current != null) syslens.userAction(u.current, 'lock');
    } else {
      const r = await syslens.openTool(id);
      if (r && !r.ok && r.error !== 'Cancelled') U.toast(r.error || 'Couldn’t open it.', 'warn');
    }
  }

  function render() {
    if (root.childElementCount) return;
    root.innerHTML = `<div class="tools">${SECTIONS.map(
      ([title, items]) => `<section><div class="section-title">${U.esc(title)}</div><div class="tool-grid">${items
        .map(([id, name, desc, icon, admin]) => `<button class="tool" data-tool="${id}">${svg(icon)}<div class="tool-text"><b>${U.esc(name)}</b><span>${U.esc(desc)}</span></div>${admin ? `<svg class="tool-admin" viewBox="0 0 24 24" data-tip="Windows asks for administrator permission"><path d="${'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z'}"/></svg>` : ''}</button>`)
        .join('')}</div></section>`,
    ).join('')}</div>`;
  }

  return {
    init,
    show: render,
    render: () => {},
    hide: () => {
      if (root) root.innerHTML = '';
    },
    title: 'Tools',
  };
})();
