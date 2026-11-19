'use strict';
/* global U, App, syslens */

// System: everything about this PC in one place, like Settings > About but complete.
const SystemView = (() => {
  let root;
  let body;
  let data = null;
  let drives = null;
  let info = null;
  let timer = null;
  let painted = '';

  const LAPTOP = '<svg viewBox="0 0 92 64"><rect x="14" y="6" width="64" height="40" rx="3"/><rect x="19" y="11" width="54" height="30" rx="1"/><path d="M4 50h84l-4 6H8z"/><path d="M40 53h12"/></svg>';
  const DESKTOP = '<svg viewBox="0 0 92 64"><rect x="10" y="4" width="72" height="44" rx="3"/><rect x="15" y="9" width="62" height="34" rx="1"/><path d="M38 48l-3 10h22l-3-10"/><path d="M30 58h32"/></svg>';
  const CHEMISTRY = { LiP: 'Lithium polymer', LION: 'Lithium-ion', 'Li-I': 'Lithium-ion', NiMH: 'Nickel-metal hydride' };

  function init(el) {
    root = el;
    root.innerHTML = `
      <div class="page-actions">
        <span class="faint" id="sy-when"></span>
        <span class="spacer"></span>
        <button class="btn sm" data-settings="about">Windows About page</button>
        <button class="btn sm" id="sy-refresh">Refresh</button>
      </div>
      <div id="sy-body"><div class="loading">Reading system information…</div></div>`;
    body = U.$('#sy-body');
    root.addEventListener('click', (e) => {
      const s = e.target.closest('[data-settings]');
      if (s) syslens.openSettings(s.dataset.settings);
      if (e.target.closest('#sy-refresh')) load(true);
      if (e.target.closest('[data-openlog]')) syslens.openLog();
      const f = e.target.closest('[data-folder]');
      if (f) syslens.openFolder(f.dataset.folder);
    });
  }

  async function load(refresh = false) {
    clearTimeout(timer);
    try {
      [data, drives, info] = await Promise.all([syslens.machine(refresh), drives && !refresh ? drives : syslens.storage.drives().catch(() => null), info || syslens.info()]);
    } catch {
      body.innerHTML = '<div class="empty">Couldn’t read system information.</div>';
      return;
    }
    paint();
    if (data.pending && data.pending.length) timer = setTimeout(() => load(false), 1000);
  }

  function show() {
    if (!data) load(false);
    else paint();
  }

  const card = (title, html, actions = '') => `<div class="card"><div class="card-title">${title}${actions ? `<span class="right" style="display:flex;gap:6px">${actions}</span>` : ''}</div>${html}</div>`;
  const pending = (what) => `<div class="loading">Reading ${what}…</div>`;
  const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(n % 1024 ? 1 : 0)} MB` : `${n} KB`);
  const ghz = (mhz) => `${(mhz / 1000).toFixed(2)} GHz`;
  const ago = (iso) => (iso ? `${U.date(Date.parse(iso))} <span class="sub">(${U.ago(Date.parse(iso))})</span>` : '');

  function deviceName(hw) {
    const d = hw.device || {};
    const maker = (d.manufacturer || '').replace(/\s+(inc\.?|corporation|corp\.?|co\.?,? ltd\.?|ltd\.?)$/i, '');
    const nice = maker.length <= 6 ? maker.charAt(0) + maker.slice(1).toLowerCase() : maker;
    const model = d.model || '';
    return model.toLowerCase().startsWith(maker.toLowerCase()) ? model : `${nice} ${model}`.trim();
  }

  function head(hw, win) {
    const os = (win && win.os) || {};
    const sys = (App.snap && App.snap.sys) || {};
    const laptop = hw && /laptop|portable|notebook|convertible|detachable|tablet/i.test((hw.device && hw.device.type) || '');
    const name = hw ? deviceName(hw) : sys.model || 'This PC';
    const osLine = os.caption ? `${os.caption.replace('Microsoft ', '')} ${os.displayVersion || ''}, build ${os.build}.${os.ubr}` : sys.os || '';
    return `<div class="card sys-head">
      <div class="art">${laptop ? LAPTOP : DESKTOP}</div>
      <div style="min-width:0">
        <div class="name">${U.esc(name)}</div>
        <div class="line">${U.esc(osLine)}${hw && hw.device && hw.device.type ? ` · ${U.esc(hw.device.type)}` : ''} · ${U.pii((data.node && data.node.hostname) || '')}</div>
      </div>
      <div class="facts">
        <div><div class="k">Up time</div><div class="v" id="sy-uptime">—</div></div>
        <div><div class="k">Last started</div><div class="v">${os.lastBoot ? U.esc(U.when(Date.parse(os.lastBoot))) : '—'}</div></div>
        <div><div class="k">Windows installed</div><div class="v">${os.installDate ? U.esc(U.day(Date.parse(os.installDate))) : '—'}</div></div>
      </div>
    </div>`;
  }

  function processorCard(hw, s) {
    if (!hw) return card('Processor', pending('the processor'));
    const c = hw.cpu || {};
    const power = s && s.power;
    return card(
      'Processor',
      U.props([
        ['Model', U.esc(c.name)],
        ['Cores', `${c.cores} cores, ${c.threads} logical processors`],
        ['Base speed', c.baseMHz ? ghz(c.baseMHz) : ''],
        ['Current speed', '<span id="sy-cpu-speed">—</span>'],
        ['Cache', [c.l2KB && `L2 ${kb(c.l2KB)}`, c.l3KB && `L3 ${kb(c.l3KB)}`].filter(Boolean).join(' · ')],
        ['Socket', U.esc(c.socket || '')],
        ['Virtualization', c.virtualization ? U.status('Enabled', 'ok') : U.status('Off in firmware', 'off')],
        power && power.cpu != null && ['Power draw', '<span id="sy-cpu-power">—</span>'],
        s && s.temps && s.temps.length && ['Temperature', '<span id="sy-temp">—</span>'],
      ]),
    );
  }

  function memoryCard(hw, s) {
    if (!hw) return card('Memory', pending('memory modules'));
    const m = hw.memory || {};
    const mods = m.modules || [];
    const mem = s && s.mem;
    const first = mods[0] || {};
    const rows = mods
      .map(
        (x) => `<tr><td>${U.esc(x.slot || '—')}</td><td>${U.esc(x.manufacturer || '—')}</td><td class="mono">${U.esc(x.part || '—')}</td><td class="r">${U.bytes(x.capacity)}</td><td class="r">${x.speed ? `${x.speed} MT/s` : '—'}</td></tr>`,
      )
      .join('');
    return card(
      'Memory',
      `${U.props([
        mem && ['Installed', `${U.bytes(mem.installed)}${mem.hardwareReserved > 0 ? ` <span class="sub">(${U.bytes(mem.total)} usable, ${U.bytes(mem.hardwareReserved)} reserved by hardware)</span>` : ''}`],
        first.speed && ['Speed', `${first.speed} MT/s${first.rated && first.rated !== first.speed ? ` <span class="sub">(rated ${first.rated})</span>` : ''}`],
        (first.type || first.form) && ['Type', U.esc([first.type, first.form].filter(Boolean).join(' '))],
        ['Slots used', m.slots ? `${mods.length} of ${m.slots}` : String(mods.length)],
        m.maxGB > 0 && ['Maximum supported', `${m.maxGB} GB`],
      ])}
      ${mods.length ? `<div class="subhead" style="margin-top:12px">Modules</div><table class="list-table"><thead><tr><th>Slot</th><th>Maker</th><th>Part number</th><th class="r">Size</th><th class="r">Speed</th></tr></thead><tbody>${rows}</tbody></table>` : ''}`,
    );
  }

  function graphicsCard(hw, s) {
    if (!hw) return card('Graphics and display', pending('graphics'));
    const sysGpus = Object.values(((s && s.sys) || {}).gpus || {});
    const gpus = (hw.gpus || [])
      .map((g) => {
        const k = sysGpus.find((x) => x.name === g.name) || {};
        return `<div class="subhead">${U.esc(g.name)}</div>${U.props([
          ['Driver', `${U.esc(g.driver)}${g.driverDate ? ` <span class="sub">from ${U.esc(U.day(Date.parse(g.driverDate)))}</span>` : ''}`],
          k.dedicatedTotal > 0 && ['Dedicated memory', U.bytes(k.dedicatedTotal)],
          k.sharedTotal > 0 && ['Shared memory', `${U.bytes(k.sharedTotal)} <span class="sub">of system RAM, when needed</span>`],
          g.width > 0 && ['Output', `${g.width} × ${g.height} at ${g.refresh} Hz`],
        ])}`;
      })
      .join('');
    const displays = (hw.displays || [])
      .map((d) => `<div class="subhead">Display${d.internal ? ' (built-in)' : ''}</div>${U.props([
        ['Panel', U.esc([d.maker, d.name].filter(Boolean).join(' ') || '—')],
        d.inches > 0 && ['Size', `${d.inches}″ <span class="sub">(${d.cm[0]} × ${d.cm[1]} cm)</span>`],
        d.year > 0 && ['Made in', String(d.year)],
      ])}`)
      .join('');
    return card('Graphics and display', gpus + displays, '<button class="btn sm" data-settings="display">Display settings</button>');
  }

  function storageCard(hw) {
    if (!hw) return card('Storage', pending('disks'));
    const disks = (hw.disks || [])
      .sort((a, b) => b.size - a.size)
      .map((d) => {
        const healthy = /healthy/i.test(d.health);
        return `<div class="subhead">${U.esc(d.model)}</div>${U.props([
          ['Type', U.esc([d.bus, d.media && d.media !== 'Unspecified' ? d.media : ''].filter(Boolean).join(' '))],
          ['Capacity', U.bytes(d.size)],
          ['Health', U.status(d.health || 'Unknown', healthy ? 'ok' : d.health ? 'bad' : 'off') + (d.status && d.status !== 'OK' ? ` <span class="sub">${U.esc(d.status)}</span>` : '')],
          d.firmware && ['Firmware', U.esc(d.firmware)],
        ])}`;
      })
      .join('');
    const vols = (drives || [])
      .filter((v) => v.ready)
      .map((v) => `<div class="prop"><div class="k">${U.esc(v.letter)} ${U.esc(v.label || '')}</div><div class="v">${U.bytes(v.used)} used of ${U.bytes(v.total)} <span class="sub">· ${U.esc(v.fs || '')} · ${U.bytes(v.free)} free</span><div class="minibar" style="margin-top:5px;max-width:260px"><i style="width:${((v.used / v.total) * 100).toFixed(1)}%${v.used / v.total > 0.9 ? ';background:var(--bad)' : ''}"></i></div></div></div>`)
      .join('');
    return card('Storage', `${disks}${vols ? `<div class="subhead">Volumes</div><div class="props">${vols}</div>` : ''}`, '<button class="btn sm" data-go="storage">Open Storage</button>');
  }

  function windowsCard(win) {
    if (!win) return card('Windows', pending('Windows details'));
    const os = win.os || {};
    return card(
      'Windows',
      U.props([
        ['Edition', U.esc((os.caption || '').replace('Microsoft ', ''))],
        ['Version', U.esc(os.displayVersion || '')],
        ['OS build', `${U.esc(os.build)}.${os.ubr}`],
        ['Installed', ago(os.installDate)],
        ['Last started', ago(os.lastBoot)],
        ['Architecture', U.esc(os.arch || '')],
        ['Time zone', U.esc(os.timeZone || '')],
        ['Language', U.esc(`${os.language || ''}${os.locale ? ` (${os.locale})` : ''}`)],
      ]),
      '<button class="btn sm" data-settings="update">Update history</button>',
    );
  }

  function securityCard(hw, win) {
    if (!win) return card('Security', pending('security settings'));
    const s = win.security || {};
    const avs = (s.antivirus || [])
      .sort((a, b) => Number(b.on) - Number(a.on))
      .map((a) => {
        const passive = /defender/i.test(a.name) && s.defender && /passive/i.test(s.defender.mode || '');
        const note = a.on ? (a.current ? 'active, up to date' : 'active, definitions out of date') : passive ? 'standing by while another antivirus is active' : 'off';
        return `<div style="margin-bottom:2px">${U.status(a.name, a.on ? (a.current ? 'ok' : 'warn') : 'off')} <span class="sub">${U.esc(note)}</span></div>`;
      });
    const fw = s.firewall || [];
    const fwOn = fw.filter((p) => p.enabled).map((p) => p.name);
    const tpm = hw && hw.tpm;
    const on = (v, good = 'On') => U.status(v, v === good ? 'ok' : /off|not/i.test(v) ? 'warn' : 'info');
    return card(
      'Security',
      U.props([
        avs.length && ['Antivirus', avs.join('')],
        fw.length && ['Firewall', fwOn.length === fw.length ? U.status('On for every network type', 'ok') : U.status(fwOn.length ? `On for ${fwOn.join(', ')} only` : 'Off', 'warn')],
        ['Secure Boot', on(s.secureBoot)],
        ['TPM', tpm ? (tpm.present ? `${U.status(`TPM ${tpm.version}`, tpm.ready ? 'ok' : 'warn')} <span class="sub">${U.esc(tpm.maker)}${tpm.ready ? '' : ' · not ready'}</span>` : U.status('Not found', 'warn')) : hw ? U.status('Unknown', 'off') : '…'],
        ['BitLocker (system drive)', on(s.bitlocker)],
        ['Memory integrity', s.memoryIntegrity ? U.status('On', 'ok') : U.status('Off', 'warn')],
        ['Virtualization-based security', U.status(s.vbs, s.vbs === 'Running' ? 'ok' : 'off')],
        ['Smart App Control', U.status(s.smartAppControl, s.smartAppControl === 'On' ? 'ok' : s.smartAppControl === 'Evaluation' ? 'info' : 'off')],
        ['User Account Control', U.esc(s.uac)],
        s.defender && ['Tamper protection', s.defender.tamper ? U.status('On', 'ok') : U.status('Off', 'off')],
      ]),
      '<button class="btn sm" data-settings="security">Windows Security</button>',
    );
  }

  function batteryCard(hw, win, s) {
    const b = s && s.battery;
    const packs = (hw && hw.batteries) || [];
    if (!(b && b.hasBattery) && !packs.length) {
      return win ? card('Power', U.props([['Power plan', U.esc(win.power.plan)], ['Power mode', U.esc(win.power.mode)]]), '<button class="btn sm" data-settings="power">Power settings</button>') : '';
    }
    const p = packs[0];
    const live = hw && hw.batteryLive;
    const rate = live && (live.dischargeRate || live.chargeRate) ? `${U.watts((live.dischargeRate || live.chargeRate) / 1000)} ${live.dischargeRate ? 'out' : 'in'} <span class="sub">(when this page loaded)</span>` : '';
    return card(
      'Battery and power',
      U.props([
        ['Charge', '<span id="sy-batt">—</span>'],
        ['Time left', '<span id="sy-batt-left">—</span>'],
        p && p.health != null && [
          'Health',
          `<div class="health"><b>${p.health.toFixed(0)}%</b><div class="minibar"><i style="width:${p.health.toFixed(1)}%;background:${p.health < 70 ? 'var(--bad)' : p.health < 85 ? 'var(--warn)' : 'var(--good)'}"></i></div></div><div class="sub">Holds ${(p.full / 1000).toFixed(1)} Wh of its ${(p.design / 1000).toFixed(1)} Wh design capacity</div>`,
        ],
        p && p.cycles > 0 && ['Charge cycles', U.num(p.cycles)],
        p && ['Battery', U.esc([CHEMISTRY[p.chemistry] || p.chemistry, p.manufacturer && `made by ${p.manufacturer}`].filter(Boolean).join(', '))],
        rate && ['Charge rate', rate],
        s && s.power && s.power.socket != null && ['Processor power', '<span id="sy-power">—</span>'],
        win && ['Power mode', U.esc(win.power.mode)],
        win && win.power.plan && ['Power plan', U.esc(win.power.plan)],
      ]),
      '<button class="btn sm" data-settings="battery">Battery settings</button>',
    );
  }

  function deviceCard(hw) {
    if (!hw) return card('Device', pending('device details'));
    const d = hw.device || {};
    return card(
      'Device',
      U.props([
        ['Manufacturer', U.esc(d.manufacturer)],
        ['Model', U.esc(d.model)],
        d.modelNumber && d.modelNumber !== d.model && ['Model number', U.esc(d.modelNumber)],
        d.type && ['Type', U.esc(d.type)],
        d.firmware && ['Firmware', U.esc(d.firmware)],
        d.bios && d.bios.version && ['BIOS', `${U.esc(`${d.bios.vendor} ${d.bios.version}`)}${d.bios.date ? ` <span class="sub">from ${U.esc(U.day(Date.parse(d.bios.date)))}</span>` : ''}`],
        d.board && d.board.product && ['Motherboard', U.esc(`${d.board.manufacturer} ${d.board.product}`)],
        ['Hypervisor', d.hypervisor ? 'Running (used by Windows security features and virtual machines)' : 'Not running'],
      ]),
    );
  }

  function updatesCard(win) {
    if (!win) return '';
    const ups = win.updates || [];
    if (!ups.length) return '';
    return card(
      'Recently installed updates',
      `<table class="list-table"><tbody>${ups.map((u) => `<tr><td style="width:110px" class="mono">${U.esc(u.id)}</td><td>${U.esc(u.kind)}</td><td class="r faint">${U.esc(U.day(Date.parse(u.date)))}</td></tr>`).join('')}</tbody></table>`,
      '<button class="btn sm" data-settings="update">Update history</button>',
    );
  }

  function aboutCard() {
    if (!info) return '';
    return card(
      'About SysLens',
      U.props([
        ['Version', `${U.esc(info.version)} <span class="sub">· Node.js ${U.esc(info.node || '')}</span>`],
        ['Memory use', '<span id="sy-self">—</span>'],
        ['Mode', info.admin ? 'Administrator' : 'Standard user'],
        ['Installed in', `<span class="mono">${U.esc(info.appDir || '')}</span>`],
        ['Log file', `<span class="mono">${U.esc(info.logFile || '')}</span>`],
      ]),
      `<button class="btn sm" data-openlog>Show log</button><button class="btn sm" data-folder="${U.esc(info.appDir || '')}">Open folder</button>`,
    );
  }

  function paint() {
    if (!data) return;
    const s = App.snap;
    const hw = data.hardware && !data.hardware.error ? data.hardware : null;
    const win = data.windows && !data.windows.error ? data.windows : null;
    const html = `${head(hw, win)}
      <div class="sys-grid">
        <div class="sys-col">${processorCard(hw, s)}${memoryCard(hw, s)}${graphicsCard(hw, s)}${storageCard(hw)}</div>
        <div class="sys-col">${windowsCard(win)}${batteryCard(hw, win, s)}${securityCard(hw, win)}${deviceCard(hw)}${updatesCard(win)}${aboutCard()}</div>
      </div>`;
    if (html !== painted) {
      body.innerHTML = html;
      painted = html;
    }
    U.$('#sy-when').textContent = data.pending && data.pending.length ? 'Still reading some details…' : `Read ${U.ago(Math.min(...[data.hardware, data.windows].filter(Boolean).map((x) => x.at)))}`;
    live(s);
  }

  function set(id, html) {
    const el = document.getElementById(id);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }

  function live(s) {
    if (!s) return;
    set('sy-uptime', U.esc(U.dur(s.uptime)));
    if (s.cpu) set('sy-cpu-speed', s.cpu.speedMHz ? `${ghz(s.cpu.speedMHz)} <span class="sub">at ${s.cpu.total.toFixed(0)}% load</span>` : '—');
    const p = s.power;
    if (p) {
      set('sy-cpu-power', `${U.watts(p.cpu)}${p.package != null ? ` <span class="sub">· package ${U.watts(p.package)}</span>` : ''}${p.gpu != null ? ` <span class="sub">· GPU ${U.watts(p.gpu)}</span>` : ''}`);
      set('sy-power', `${U.watts(p.socket)} <span class="sub">CPU, GPU and NPU together</span>`);
    }
    const t = s.temps && s.temps[0];
    if (t) set('sy-temp', `${t.c.toFixed(0)} °C <span class="sub">(ACPI thermal zone ${U.esc(t.name)}${t.limit != null && t.limit < 100 ? `, throttled to ${t.limit.toFixed(0)}%` : ''})</span>`);
    const b = s.battery;
    if (b && b.hasBattery) {
      const state = b.charging ? 'charging' : b.ac ? (b.percent >= 95 ? 'plugged in, full' : 'plugged in, not charging') : 'on battery';
      set('sy-batt', `<b>${b.percent != null ? `${b.percent}%` : '—'}</b> <span class="sub">${state}${b.saver ? ', battery saver on' : ''}</span>`);
      set('sy-batt-left', b.ac ? '<span class="faint">Plugged in</span>' : b.secondsLeft ? U.span(b.secondsLeft * 1000) : 'Estimating…');
    }
    const self = (s.groups || []).find((g) => g.key === 'syslens');
    if (self) set('sy-self', `${U.bytes(self.priv)} <span class="sub">across ${self.count} processes (the window, its server and launcher)</span>`);
  }

  return { init, render: live, show, title: 'System' };
})();
