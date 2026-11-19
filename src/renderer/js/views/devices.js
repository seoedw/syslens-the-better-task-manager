'use strict';
/* global U, App, syslens, Menu, Actions */

// Devices: hardware Windows reports a problem with, every device driver with its maker, version
// and date (old drivers are a common cause of crashes and leaks), and kernel drivers in memory.
const DevicesView = (() => {
  let root;
  let data = null;
  let loading = false;
  // Windows' device class names (as Device Manager groups them).
  const CLASSES = { SYSTEM: 'System', MEDIA: 'Sound & video', NET: 'Network', HIDCLASS: 'Input (HID)', DISPLAY: 'Display', USB: 'USB', DISKDRIVE: 'Disk drive', MONITOR: 'Monitor', KEYBOARD: 'Keyboard', MOUSE: 'Mouse', BLUETOOTH: 'Bluetooth', PROCESSOR: 'Processor', COMPUTER: 'Computer', SOFTWARECOMPONENT: 'Software component', SOFTWAREDEVICE: 'Software device', BIOMETRIC: 'Biometric', CAMERA: 'Camera', IMAGE: 'Camera / scanner', AUDIOENDPOINT: 'Audio endpoint', VOLUME: 'Volume', VOLUMESNAPSHOT: 'Shadow copy', SCSIADAPTER: 'Storage controller', HDC: 'Storage controller', PRINTQUEUE: 'Printer queue', PRINTER: 'Printer', SECURITYDEVICES: 'Security device', FIRMWARE: 'Firmware', BATTERY: 'Battery', EXTENSION: 'Extension', SENSOR: 'Sensor', SMARTCARDREADER: 'Smart card reader', MEDIUMCHANGER: 'Media changer', WPD: 'Portable device', NETSERVICE: 'Network service', NETTRANS: 'Network protocol', NETCLIENT: 'Network client', UCM: 'USB-C', USBDEVICE: 'USB device', SDHOST: 'SD card reader', CDROM: 'Optical drive' };
  const kind = (c) => (c ? CLASSES[String(c).toUpperCase()] || String(c).charAt(0).toUpperCase() + String(c).slice(1).toLowerCase() : '');
  const st = { tab: null, q: '', thirdParty: false, sort: { key: 'name', dir: 1 } };

  function init(el) {
    root = el;
    root.innerHTML = `
      <div class="summary" id="dv-sum"><div class="loading">Reading devices and drivers… this takes a few seconds.</div></div>
      <div class="page-actions">
        <div class="tabs" id="dv-tabs"></div>
        <span class="spacer"></span>
        <div class="search"><svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.38A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg><input id="dv-q" placeholder="Filter by name, maker or file" spellcheck="false" /></div>
        <label class="switch" data-tip="Drivers that don't come from Microsoft"><input type="checkbox" id="dv-3p" /> Not Microsoft</label>
        <button class="btn sm" data-tool="devmgmt">Device Manager</button>
        <button class="btn sm" id="dv-refresh">Refresh</button>
      </div>
      <div class="list-wrap"><table class="list-table compact" id="dv-table"></table></div>`;
    root.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        st.tab = tab.dataset.tab;
        paint();
      }
      const th = e.target.closest('th[data-sort]');
      if (th) {
        const key = th.dataset.sort;
        st.sort = st.sort.key === key ? { key, dir: -st.sort.dir } : { key, dir: key === 'date' ? -1 : 1 };
        paint();
      }
      const tool = e.target.closest('[data-tool]');
      if (tool) syslens.openTool(tool.dataset.tool);
      if (e.target.closest('#dv-refresh')) load(true);
    });
    root.addEventListener('contextmenu', (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (!tr) return;
      const item = rows()[Number(tr.dataset.i)];
      if (item) Menu.openAt(e, menuFor(item));
    });
    U.$('#dv-q').addEventListener('input', (e) => {
      st.q = e.target.value.trim().toLowerCase();
      paint();
    });
    U.$('#dv-3p').addEventListener('change', (e) => {
      st.thirdParty = e.target.checked;
      paint();
    });
  }

  async function load(refresh = false) {
    if (loading) return;
    loading = true;
    paint();
    try {
      data = await syslens.devices(refresh);
    } catch {
      data = data || { problems: [], drivers: [], kernel: [] };
    }
    loading = false;
    if (!st.tab) st.tab = data.problems.length ? 'problems' : 'drivers';
    App.setCount('navDevicesCount', data.problems.length || null);
    paint();
  }

  function menuFor(item) {
    const name = item.display || item.name;
    return [
      { label: 'Open Device Manager', icon: 'settings', run: () => syslens.openTool('devmgmt') },
      item.file && { label: 'Open file location', icon: 'folder', run: () => syslens.showItem(item.file) },
      { label: 'Search online', icon: 'search', run: () => Actions.searchOnline(item.problem ? `${name} ${item.problem}` : item.file ? `${item.name}.sys driver` : `${name} driver ${item.provider || ''}`) },
      '-',
      { label: 'Copy name', icon: 'copy', run: () => U.copy(name, 'Name copied') },
      item.version && { label: 'Copy driver version', icon: 'copy', hint: item.version, run: () => U.copy(item.version, 'Version copied') },
      item.file && { label: 'Copy file path', icon: 'copy', run: () => U.copy(item.file, 'Path copied') },
    ].filter(Boolean);
  }

  /** The rows of the current tab, filtered and sorted. */
  function rows() {
    if (!data) return [];
    let list = st.tab === 'problems' ? data.problems : st.tab === 'kernel' ? data.kernel : data.drivers;
    if (st.thirdParty && st.tab !== 'problems') list = list.filter((x) => !x.isWindows);
    if (st.q) list = list.filter((x) => `${x.name} ${x.display || ''} ${x.provider || ''} ${x.company || ''} ${x.cls || ''} ${x.file || ''} ${x.problem || ''}`.toLowerCase().includes(st.q));
    const key = {
      name: (x) => (x.display || x.name || '').toLowerCase(),
      date: (x) => x.date || '',
      provider: (x) => (x.provider || x.company || '~').toLowerCase(),
      cls: (x) => (x.cls || '').toLowerCase(),
      state: (x) => (x.running ? 0 : 1),
    }[st.sort.key] || ((x) => x.name);
    return list.slice().sort((a, b) => {
      const x = key(a);
      const y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * st.sort.dir || String(a.name).localeCompare(String(b.name));
    });
  }

  function paint() {
    if (!root) return;
    if (!data) {
      U.$('#dv-sum').innerHTML = `<div class="loading">Reading devices and drivers… this takes a few seconds.</div>`;
      return;
    }
    const third = data.drivers.filter((d) => !d.isWindows);
    // Windows' own drivers all carry the same placeholder date (21 June 2006), so only other makers' count.
    const oldest = third.filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date))[0];
    const running3p = data.kernel.filter((k) => k.running && !k.isWindows);
    U.$('#dv-sum').innerHTML = `
      <div class="sum"><div class="v ${data.problems.length ? 'bad-text' : ''}">${data.problems.length}</div><div class="k">${data.problems.length === 1 ? 'device has a problem' : 'devices have problems'}</div></div>
      <div class="sum"><div class="v">${U.num(data.drivers.length)}</div><div class="k">device drivers installed</div></div>
      <div class="sum"><div class="v">${U.num(third.length)}</div><div class="k">of them not from Microsoft</div></div>
      <div class="sum"><div class="v">${U.num(running3p.length)}</div><div class="k">third-party kernel drivers running</div></div>
      ${oldest ? `<div class="sum"><div class="v">${U.esc(oldest.date.slice(0, 4))}</div><div class="k">oldest non-Microsoft driver (${U.esc(oldest.name)})</div></div>` : ''}
      <div class="note">Problem devices are the ones with a yellow warning in Device Manager. Third-party kernel drivers (antivirus, VPN, RGB and peripheral software) are the usual cause of driver memory leaks and blue screens; keeping them updated helps.</div>`;
    const tab = (id, label, n) => `<button class="tab${st.tab === id ? ' on' : ''}" data-tab="${id}">${label} <span class="faint">${n}</span></button>`;
    U.$('#dv-tabs').innerHTML = tab('problems', 'Problems', data.problems.length) + tab('drivers', 'Drivers', data.drivers.length) + tab('kernel', 'Kernel drivers', data.kernel.length);
    const th = (k, label, w = '', cls = '') => `<th class="sortable${st.sort.key === k ? ' sorted' : ''} ${cls}" data-sort="${k}" ${w ? `style="width:${w}"` : ''}>${label}${st.sort.key === k ? (st.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
    const list = rows();
    let head;
    let body;
    if (st.tab === 'problems') {
      head = `<tr>${th('name', 'Device', '34%')}${th('cls', 'Kind', '14%')}<th>Problem</th><th style="width:16%">Maker</th></tr>`;
      body = list
        .map((d, i) => `<tr class="hov" data-i="${i}"><td class="nm1">${U.status(d.name, 'bad')}</td><td class="faint">${U.esc(kind(d.cls))}</td><td>${U.esc(d.problem)} <span class="faint">(code ${d.code})</span></td><td class="faint ellipsis">${U.esc(d.maker)}</td></tr>`)
        .join('');
      if (!body) body = `<tr><td colspan="4" class="empty">${loading ? 'Reading…' : 'No device has a problem. Everything in Device Manager is working.'}</td></tr>`;
    } else if (st.tab === 'kernel') {
      head = `<tr>${th('name', 'Driver', '30%')}${th('state', 'State', '96px')}<th style="width:110px">Starts</th>${th('provider', 'Publisher', '20%')}<th>File</th></tr>`;
      body = list
        .map(
          (k, i) => `<tr class="hov${k.running ? '' : ' dim'}" data-i="${i}" data-tip="${U.esc([k.display, k.name, k.file].filter(Boolean).join('\n'))}"><td class="nm1">${U.esc(k.display)}</td><td>${k.running ? U.status('Running', 'ok') : U.status(k.state || 'Stopped', 'off')}</td><td class="faint">${U.esc(k.start)}</td><td class="ellipsis">${k.isWindows ? '<span class="faint">Microsoft</span>' : U.esc(k.company || 'Unknown')}</td><td class="faint ellipsis mono">${U.esc(k.file)}</td></tr>`,
        )
        .join('');
      if (!body) body = `<tr><td colspan="5" class="empty">${loading ? 'Reading…' : 'Nothing matches.'}</td></tr>`;
    } else {
      head = `<tr>${th('name', 'Device', '32%')}${th('cls', 'Kind', '12%')}${th('provider', 'Driver from', '18%')}<th style="width:130px">Version</th>${th('date', 'Date', '100px')}<th>Signed by</th></tr>`;
      body = list
        .map(
          (d, i) => `<tr class="hov" data-i="${i}"><td class="nm1">${U.esc(d.name)}</td><td class="faint">${U.esc(kind(d.cls))}</td><td class="ellipsis">${d.isWindows ? '<span class="faint">Microsoft</span>' : U.esc(d.provider || 'Unknown')}</td><td class="mono faint">${U.esc(d.version)}</td><td class="faint">${U.esc(d.date)}</td><td class="faint ellipsis">${U.esc(d.signer)}</td></tr>`,
        )
        .join('');
      if (!body) body = `<tr><td colspan="6" class="empty">${loading ? 'Reading…' : 'Nothing matches.'}</td></tr>`;
    }
    U.$('#dv-table').innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  }

  function show() {
    if (!data) load(false);
    else paint();
  }

  function hide() {
    const t = U.$('#dv-table');
    if (t) t.innerHTML = '';
  }

  return {
    init,
    show,
    hide,
    render: () => {},
    load,
    get data() {
      return data;
    },
    title: 'Devices',
  };
})();
