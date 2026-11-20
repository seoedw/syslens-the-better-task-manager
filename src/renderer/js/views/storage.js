'use strict';
/* global U, Treemap, App, syslens */

const Storage = (() => {
  let root;
  let body;
  const st = {
    tab: 'overview',
    loaded: false,
    drives: null,
    hogs: null,
    apps: null,
    scanning: false,
    scanRoot: null,
    started: 0,
    progress: null,
    summary: null,
    error: null,
    listing: null,
    top: null,
    types: null,
    appsQ: '',
    appsSort: { key: 'size', dir: -1 },
  };

  const DRIVE_ICON = '<svg viewBox="0 0 24 24"><path d="M5 4h14a1 1 0 0 1 1 1v5H4V5a1 1 0 0 1 1-1zm-1 8h16v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm12 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM16 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>';
  const FOLDER = '<svg viewBox="0 0 24 24" width="16" height="16" style="flex:none"><path fill="#e8b84a" d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const FILE = '<svg viewBox="0 0 24 24" width="16" height="16" style="flex:none"><path fill="#8a95a8" d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V8h4.5z"/></svg>';
  const INFO = '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z"/></svg>';

  // How protected a folder is for you (from the server: win32.folderAccess). The shield is the
  // one Windows and the Tools page use for "needs administrator".
  const SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/></svg>';
  function guardTip(access) {
    const admin = App.snap && App.snap.admin;
    if (access === 'locked') {
      return admin
        ? 'Locked: Windows keeps this folder to itself, so even as administrator SysLens can’t look inside or measure it.'
        : 'Locked: only administrators can open this folder, so SysLens can’t look inside or measure it. Run as administrator to include it.';
    }
    if (access === 'protected') {
      return admin
        ? 'Protected: Windows owns this folder. Even as administrator you can look inside but not change or delete what’s in it.'
        : 'Protected: you can look inside, but only administrators can add, change or delete what’s in it. Windows and installed programs keep their files in folders like this.';
    }
    return 'Yours: you can add, change and delete what’s in this folder.';
  }
  function guard(access, withYours = false) {
    if (access === 'locked') return `<span class="guard locked" data-tip="${U.esc(guardTip(access))}">${SHIELD}Locked</span>`;
    if (access === 'protected') return `<span class="guard protected" data-tip="${U.esc(guardTip(access))}">${SHIELD}Protected</span>`;
    if (access === 'open' && withYours) return `<span class="guard open" data-tip="${U.esc(guardTip(access))}">Yours</span>`;
    return '';
  }
  /** What the marks mean, with how many of each are in this folder. */
  function guardLegend(items) {
    const dirs = items.filter((i) => i.dir && i.access);
    if (!dirs.length) return '';
    const n = (a) => dirs.filter((i) => i.access === a).length;
    const counts = [n('locked') && `${U.num(n('locked'))} locked`, n('protected') && `${U.num(n('protected'))} protected`, n('open') && `${U.num(n('open'))} yours`].filter(Boolean).join(', ');
    return `<div class="guard-legend">
      <span>${guard('locked')} only administrators can open it</span>
      <span>${guard('protected')} you can look, only administrators can change it</span>
      <span>No shield: yours to change</span>
      <span class="faint">Folders here: ${counts}</span></div>`;
  }

  const CATS = [
    ['Videos', '#e0609a', 'mp4 mkv mov avi wmv webm m4v mpg mpeg ts m2ts flv 3gp'],
    ['Pictures', '#e88a3a', 'jpg jpeg png gif heic heif webp bmp tif tiff raw cr2 cr3 nef arw dng psd svg ico'],
    ['Music & audio', '#c9a63a', 'mp3 flac wav m4a aac ogg wma opus aiff'],
    ['Documents', '#5bb85b', 'pdf doc docx xls xlsx ppt pptx txt md rtf odt ods csv epub one'],
    ['Archives', '#8b6ff0', 'zip rar 7z tar gz tgz bz2 xz zst cab'],
    ['Disk images & VMs', '#4fb3d9', 'iso img vhd vhdx vmdk vdi qcow2 wim esd avhdx vmem vmsn vmss nvram'],
    ['Installers', '#d9644f', 'msi msix msixbundle appx appxbundle msp nupkg dl_'],
    ['Programs & libraries', '#4f8ff7', 'exe dll sys ocx mui node so pyd asar pri cat mo ttf ttc otf woff woff2 xml manifest'],
    ['Game data', '#2fb3a0', 'pak vpk bundle assets resource ress upk uasset uexp ucas utoc bnk bank wem bk2 bik bsa ba2 forge big rpf minizip mca rbxm rbxl mun unity3d'],
    ['AI models', '#e35d8c', 'onnx gguf safetensors ckpt pt pth ggml tflite'],
    ['Developer files', '#b06fd6', 'js mjs cjs ts tsx jsx map json py pyc java class jar cs cpp c h hpp go rs lib obj pdb ipch o a wasm'],
    ['Caches & databases', '#8a95a8', 'db sqlite sqlite3 ldb log tmp cache etl blob idx pack nvph dat bin'],
  ].map(([name, color, exts]) => ({ name, color, exts: new Set(exts.split(' ')) }));

  function categoryOf(ext) {
    if (!ext) return { name: 'No extension', color: '#5b6779' };
    return CATS.find((c) => c.exts.has(ext)) || { name: 'Other', color: '#3f4856' };
  }

  function init(el) {
    root = el;
    root.innerHTML = `
      <div class="tabs" id="sg-tabs">
        <button class="tab" data-tab="overview">Overview</button>
        <button class="tab" data-tab="explore">Explore folders</button>
        <button class="tab" data-tab="files">Largest files</button>
        <button class="tab" data-tab="types">File types</button>
        <button class="tab" data-tab="apps">Installed apps</button>
      </div>
      <div id="sg-body"></div>`;
    body = U.$('#sg-body', root);

    root.addEventListener('click', onClick);
    root.addEventListener('input', (e) => {
      if (e.target.id === 'sg-apps-q') {
        st.appsQ = e.target.value.trim().toLowerCase();
        renderAppsTable();
      }
    });

    syslens.storage.onProgress((p) => {
      st.progress = p;
      if (st.tab === 'explore') updateProgress();
    });
    syslens.storage.onDone(async (m) => {
      st.scanning = false;
      if (m.error) {
        st.error = m.error;
        st.summary = null;
      } else {
        st.error = null;
        st.summary = m.summary;
        await loadScanResults();
      }
      if (['explore', 'files', 'types'].includes(st.tab)) render();
      if (m.summary) U.toast(`Scan finished: ${U.bytes(m.summary.size)} in ${U.num(m.summary.files)} files.`, 'good');
    });
    syslens.storage.onApps((a) => {
      st.apps = a;
      if (st.tab === 'apps') renderApps();
    });
    syslens.storage.onHogs((h) => {
      st.hogs = h;
      if (st.tab === 'overview') renderHogs();
    });
  }

  async function onClick(e) {
    const t = (sel) => e.target.closest(sel);
    let el;
    if ((el = t('[data-tab]'))) {
      st.tab = el.dataset.tab;
      if (st.tab === 'apps' && !st.apps) st.apps = await syslens.storage.apps(false);
      render();
    } else if ((el = t('[data-scan]'))) {
      startScan(el.dataset.scan);
    } else if (t('[data-pickscan]')) {
      const p = await syslens.storage.pickFolder();
      if (p) startScan(p);
    } else if (t('[data-cancel]')) {
      await syslens.storage.cancel();
      st.scanning = false;
      render();
    } else if ((el = t('[data-cd]'))) {
      cd(el.dataset.cd);
    } else if ((el = t('[data-open]'))) {
      e.stopPropagation();
      const ok = await syslens.openFolder(el.dataset.open);
      if (!ok) syslens.showItem(el.dataset.open);
    } else if ((el = t('[data-show]'))) {
      e.stopPropagation();
      syslens.showItem(el.dataset.show);
    } else if ((el = t('[data-settings]'))) {
      syslens.openSettings(el.dataset.settings);
    } else if (t('[data-rehogs]')) {
      st.hogs = await syslens.storage.hogs(true);
      renderHogs();
    } else if (t('[data-reapps]')) {
      st.apps = await syslens.storage.apps(true);
      renderApps();
    } else if ((el = t('[data-asort]'))) {
      const key = el.dataset.asort;
      st.appsSort = st.appsSort.key === key ? { key, dir: -st.appsSort.dir } : { key, dir: key === 'name' ? 1 : -1 };
      renderAppsTable();
    } else if (t('[data-elevate]')) {
      syslens.elevate();
    }
  }

  async function startScan(rootPath) {
    st.expired = null;
    st.scanning = true;
    st.scanRoot = rootPath;
    st.started = Date.now();
    st.progress = null;
    st.summary = null;
    st.error = null;
    st.listing = null;
    st.tab = 'explore';
    await syslens.storage.scan(rootPath);
    render();
  }

  async function loadScanResults() {
    const [listing, top, types] = await Promise.all([syslens.storage.children(null), syslens.storage.top(), syslens.storage.types()]);
    st.listing = listing;
    st.top = top;
    st.types = types;
  }

  async function cd(p) {
    const listing = await syslens.storage.children(p).catch(() => null);
    if (listing) {
      st.listing = listing;
      renderExplore();
      body.scrollTop = 0;
      root.scrollTop = 0;
    } else if (st.summary) {
      // The scan results were freed after sitting unused (see StorageService.release).
      st.expired = { root: st.summary.root };
      st.summary = null;
      st.listing = null;
      renderExplore();
    }
  }

  // ---------- overview ----------
  function driveCard(d) {
    if (!d.ready) return `<div class="card drive"><div class="top"><div class="ico">${DRIVE_ICON}</div><div><div class="name">${U.esc(d.letter)}</div><div class="meta">${U.esc(d.type)} · not ready</div></div></div></div>`;
    const usedPct = (d.used / d.total) * 100;
    const sys = (App.snap && App.snap.sys) || {};
    const disk = Object.values(sys.disks || {}).find((x) => (x.letters || []).includes(d.letter));
    const meta = [d.fs, d.type, disk && [disk.media, disk.bus].filter((x) => x && x !== 'Unspecified').join(' ')].filter(Boolean).join(' · ');
    return `<div class="card drive">
      <div class="top"><div class="ico">${DRIVE_ICON}</div><div style="min-width:0"><div class="name">${U.esc(d.label || 'Local Disk')} (${U.esc(d.letter)})</div><div class="meta">${U.esc(meta)}</div></div></div>
      <div class="bar"><i class="${usedPct > 90 ? 'full' : ''}" style="width:${usedPct.toFixed(1)}%"></i></div>
      <div class="nums"><span><b style="color:var(--text)">${U.bytes(d.used)}</b> used (${usedPct.toFixed(0)}%)</span><span>${U.bytes(d.free)} free of ${U.bytes(d.total)}</span></div>
      <div class="actions"><button class="btn sm primary" data-scan="${U.esc(d.root)}">Find what's using space</button><button class="btn sm" data-open="${U.esc(d.root)}">Open</button></div>
    </div>`;
  }

  function renderOverview() {
    body.innerHTML = `
      <div class="drives" id="sg-drives">${st.drives ? st.drives.map(driveCard).join('') : '<div class="card"><div class="empty">Reading drives…</div></div>'}</div>
      <div class="card">
        <div class="card-title">Where space usually goes <span class="sub">well-known folders and files, measured just now</span>
          <span class="right" style="display:flex;gap:8px"><button class="btn sm" data-settings="storage">Windows cleanup settings</button><button class="btn sm ghost" data-rehogs>Measure again</button></span></div>
        <div id="sg-hogs"></div>
      </div>`;
    renderHogs();
  }

  function renderHogs() {
    const box = U.$('#sg-hogs');
    if (!box) return;
    const h = st.hogs;
    if (!h || !h.list.length) {
      box.innerHTML = '<div class="empty">Measuring…</div>';
      return;
    }
    const list = h.list.filter((x) => x.exists || x.pending);
    const max = Math.max(1, ...list.map((x) => x.bytes));
    const cats = [...new Set(list.map((x) => x.category))];
    const order = ['Cleanable', 'Your files', 'Browsers', 'System', 'Games', 'Virtual machines', 'Developer'];
    cats.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const rows = [];
    for (const cat of cats) {
      const items = list.filter((x) => x.category === cat).sort((a, b) => b.bytes - a.bytes);
      const total = items.reduce((s, x) => s + x.bytes, 0);
      rows.push(`<tr><td colspan="4" class="hog-cat">${U.esc(cat)} · ${U.bytes(total)}</td></tr>`);
      for (const x of items) {
        const size = x.pending ? '<span class="faint">measuring…</span>' : x.unreadable ? guard('locked') : U.bytes(x.bytes);
        const openPath = x.paths && x.paths[0];
        rows.push(`<tr>
          <td><div class="nm">${U.esc(x.name)}</div><div class="tip">${U.esc(x.tip || '')}</div></td>
          <td style="width:28%">${x.pending || x.unreadable ? '' : U.minibar(x.bytes / max)}</td>
          <td class="r" style="width:110px;font-weight:600">${size}</td>
          <td class="r" style="width:96px">${openPath ? `<button class="btn sm" data-open="${U.esc(openPath)}">Open</button>` : ''}</td></tr>`);
      }
    }
    const status = h.status === 'loading' ? '<div class="faint" style="margin-bottom:8px">Measuring folders… sizes fill in as they finish.</div>' : '';
    box.innerHTML = `${status}<table class="list-table">${rows.join('')}</table>`;
  }

  // ---------- explore ----------
  function scanHero() {
    const drives = (st.drives || []).filter((d) => d.ready);
    return `<div class="card scan-hero">
      <svg viewBox="0 0 24 24" width="42" height="42"><path fill="var(--accent)" d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" opacity=".25"/><path fill="var(--accent)" d="M15.5 10a3.5 3.5 0 0 1 2.9 5.46l2.3 2.3-1.06 1.06-2.3-2.3A3.5 3.5 0 1 1 15.5 10zm0 1.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
      <h3>See exactly what is filling your disk</h3>
      <p>SysLens reads every folder (read-only — nothing is changed or deleted) and shows the biggest folders and files as a map you can click into. A whole drive usually takes under a minute.</p>
      ${st.expired ? `<div class="notice" style="margin:6px 0 0">${INFO}<div>The results of your last scan (${U.esc(st.expired.root)}) were cleared after 15 minutes unused, to give the memory back. Scan again to see them.</div></div>` : ''}
      ${st.error ? `<div class="notice warn" style="margin:6px 0 0">${INFO}<div>${U.esc(st.error)}</div></div>` : ''}
      <div class="row">${drives.map((d) => `<button class="btn primary" data-scan="${U.esc(d.root)}">Scan ${U.esc(d.letter)} ${d.label ? `(${U.esc(d.label)})` : ''}</button>`).join('')}<button class="btn" data-pickscan>Choose a folder…</button></div>
    </div>`;
  }

  function progressHero() {
    return `<div class="card scan-hero">
      <h3>Scanning ${U.esc(st.scanRoot || '')}</h3>
      <p id="sg-p-text">Starting…</p>
      <div class="progress" id="sg-p-bar"><i style="width:0%"></i></div>
      <div class="scan-path" id="sg-p-path">&nbsp;</div>
      <div class="row"><button class="btn" data-cancel>Cancel</button></div>
    </div>`;
  }

  function updateProgress() {
    const p = st.progress;
    if (!U.$('#sg-p-text')) {
      if (st.scanning) renderExplore();
      return;
    }
    if (!p) return;
    const elapsed = U.dur(Date.now() - st.started);
    U.$('#sg-p-text').innerHTML = `<b>${U.num(p.files)}</b> files · <b>${U.bytes(p.bytes)}</b> · ${U.num(p.dirs)} folders · ${elapsed}`;
    const drive = (st.drives || []).find((d) => d.ready && st.scanRoot && st.scanRoot.toUpperCase() === d.root.toUpperCase());
    const bar = U.$('#sg-p-bar');
    if (drive) {
      bar.classList.remove('indeterminate');
      bar.firstElementChild.style.width = `${Math.min(99, (p.bytes / drive.used) * 100).toFixed(1)}%`;
    } else {
      bar.classList.add('indeterminate');
    }
    U.$('#sg-p-path').textContent = p.current || '';
  }

  function summaryNotice() {
    const s = st.summary;
    if (!s) return '';
    const parts = [`Scanned <b>${U.esc(s.root)}</b>: <b>${U.bytes(s.size)}</b> on disk in ${U.num(s.files)} files and ${U.num(s.dirs)} folders (${U.dur(s.took)}).`];
    if (s.shrunkFiles > 0) {
      parts.push(`Sizes are what files really take on disk: ${U.num(s.shrunkFiles)} sparse or compressed file${s.shrunkFiles === 1 ? '' : 's'} (virtual machine disks, game images and the like) say they're <b>${U.bytes(s.shrunkBytes)}</b> bigger than the space they use, and that isn't counted.`);
    }
    const drive = (st.drives || []).find((d) => d.ready && d.root.toUpperCase() === s.root.toUpperCase());
    if (drive && drive.used > s.size) {
      parts.push(`<b>${U.bytes(drive.used - s.size)}</b> of used space isn't visible to a folder scan — restore points and shadow copies (System Volume Information), NTFS metadata${s.denied ? ' and the protected folders below' : ''}.`);
    }
    if (s.denied) {
      const admin = App.snap && App.snap.admin;
      parts.push(`${U.num(s.denied)} locked folder${s.denied === 1 ? '' : 's'} (marked with a shield) couldn't be read${admin ? '' : ' — <button class="link" data-elevate>run as administrator</button> to include them'}.`);
    }
    if (s.cloudBytes > 0) parts.push(`${U.bytes(s.cloudBytes)} of online-only OneDrive files don't use disk space and aren't counted.`);
    if (/^[a-z]:\\$/i.test(s.root)) parts.push('Sizes inside Windows\\WinSxS count hard-linked files more than once, so that folder looks bigger than it really is.');
    return `<div class="notice">${INFO}<div>${parts.join(' ')}</div></div>`;
  }

  function renderExplore() {
    if (st.scanning) {
      body.innerHTML = progressHero();
      updateProgress();
      return;
    }
    if (!st.summary || !st.listing) {
      body.innerHTML = scanHero();
      return;
    }
    const L = st.listing;
    const crumbs = L.crumbs.map((c) => `<button data-cd="${U.esc(c.path)}">${U.esc(c.name)}</button>`).join('<span class="sep">›</span>');
    const max = Math.max(1, ...L.items.map((i) => i.size));
    const rows = L.items
      .map((it) => {
        const share = L.size ? it.size / L.size : 0;
        const nameCell = `<div style="display:flex;align-items:center;gap:8px;min-width:0">${it.dir ? FOLDER : FILE}<span class="nm" style="overflow:hidden;text-overflow:ellipsis">${U.esc(it.name)}</span>${
          it.dir ? guard(it.access || (it.denied ? 'locked' : null)) : ''
        }</div>`;
        const info = it.dir ? `${U.num(it.files)} files` : it.aggregate ? `${U.num(it.files)} files` : it.mtime ? U.day(it.mtime) : '';
        const action = it.dir ? `<button class="btn sm" data-open="${U.esc(it.path)}">Open</button>` : it.aggregate ? '' : `<button class="btn sm" data-show="${U.esc(it.path)}">Show</button>`;
        return `<tr class="${it.dir ? 'click' : ''}" ${it.dir ? `data-cd="${U.esc(it.path)}"` : ''} ${it.aggregate ? '' : `data-path="${U.esc(it.path)}" data-kind="${it.dir ? 'dir' : 'file'}" data-name="${U.esc(it.name)}"`}>
          <td>${nameCell}</td>
          <td class="r" style="width:96px;font-weight:600">${sizeHtml(it)}</td>
          <td style="width:22%"><div class="sizebar">${U.minibar(it.size / max)}<span class="faint tabular" style="width:44px;text-align:right">${(share * 100).toFixed(1)}%</span></div></td>
          <td class="r faint" style="width:120px">${info}</td>
          <td class="r" style="width:80px">${action}</td></tr>`;
      })
      .join('');
    body.innerHTML = `
      ${summaryNotice()}
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div class="crumbs" style="margin:0">${crumbs}</div>
        ${guard(L.access, true)}
        <span class="faint">${U.bytes(L.size)} · ${U.num(L.files)} files</span>
        <span style="margin-left:auto;display:flex;gap:8px">
          <button class="btn sm" data-open="${U.esc(L.path)}">Open in Explorer</button>
          <button class="btn sm" data-scan="${U.esc(st.summary.root)}">Rescan</button>
          <button class="btn sm" data-pickscan>Scan another folder…</button></span>
      </div>
      <div class="card" style="padding:10px;margin-bottom:14px"><div class="treemap" id="sg-tm"></div></div>
      ${guardLegend(L.items)}
      <div class="card" style="padding:4px 8px">
        <table class="list-table"><thead><tr><th>Name</th><th class="r" style="width:96px" data-tip="What it takes on your drive">On disk</th><th style="width:22%">Share of this folder</th><th class="r" style="width:120px">Files / modified</th><th style="width:80px"></th></tr></thead><tbody>${rows}</tbody></table>
        ${L.more ? `<div class="faint" style="padding:10px">…and ${U.num(L.more)} smaller items</div>` : ''}
      </div>`;
    requestAnimationFrame(() => {
      const tm = U.$('#sg-tm');
      if (tm) Treemap.render(tm, L.items, { onOpen: (it) => cd(it.path) });
    });
  }

  /**
   * A size on disk, with the file's own length under it when that's more: sparse files (virtual
   * machine disks, game and emulator images) and compressed ones take less space than they say.
   */
  function sizeHtml(it) {
    if (!(it.length > it.size)) return U.bytes(it.size);
    const tip = `This file says it’s ${U.bytes(it.length)}, but only ${U.bytes(it.size)} of it is actually stored on disk: it’s a sparse or compressed file, and the empty parts take no space. Virtual machine disks and game images are often like this. Deleting it frees ${U.bytes(it.size)}.`;
    return `<span data-tip="${U.esc(tip)}">${U.bytes(it.size)}<span class="size-of">of ${U.bytes(it.length)}</span></span>`;
  }

  // ---------- largest files ----------
  function renderFiles() {
    if (!st.top) {
      body.innerHTML = st.scanning ? progressHero() : scanHero();
      if (st.scanning) updateProgress();
      return;
    }
    const max = Math.max(1, ...st.top.map((f) => f.size));
    body.innerHTML = `
      ${summaryNotice()}
      <div class="card" style="padding:4px 8px"><table class="list-table">
        <thead><tr><th style="width:34%">File</th><th>Folder</th><th class="r" style="width:96px" data-tip="What the file takes on your drive">On disk</th><th style="width:16%"></th><th class="r" style="width:120px">Modified</th><th style="width:72px"></th></tr></thead>
        <tbody>${st.top
          .slice(0, 200)
          .map((f) => {
            const dir = f.path.slice(0, f.path.length - f.name.length - 1);
            return `<tr data-path="${U.esc(f.path)}" data-kind="file" data-name="${U.esc(f.name)}"><td><div style="display:flex;gap:8px;align-items:center;min-width:0">${FILE}<span class="nm" style="overflow:hidden;text-overflow:ellipsis" data-tip="${U.esc(f.path)}">${U.esc(f.name)}</span></div></td>
              <td class="sub" data-tip="${U.esc(dir)}">${U.esc(dir)}</td>
              <td class="r" style="font-weight:600">${sizeHtml(f)}</td><td>${U.minibar(f.size / max)}</td>
              <td class="r faint">${U.day(f.mtime)}</td><td class="r"><button class="btn sm" data-show="${U.esc(f.path)}">Show</button></td></tr>`;
          })
          .join('')}</tbody></table></div>`;
  }

  // ---------- file types ----------
  function renderTypes() {
    if (!st.types) {
      body.innerHTML = st.scanning ? progressHero() : scanHero();
      if (st.scanning) updateProgress();
      return;
    }
    const cats = new Map();
    let total = 0;
    for (const t of st.types) {
      const c = categoryOf(t.ext);
      const e = cats.get(c.name) || { name: c.name, color: c.color, bytes: 0, count: 0, exts: [] };
      e.bytes += t.bytes;
      e.count += t.count;
      e.exts.push(t);
      cats.set(c.name, e);
      total += t.bytes;
    }
    const list = [...cats.values()].sort((a, b) => b.bytes - a.bytes);
    const stack = `<div class="stack lg">${list
      .filter((c) => c.bytes > 0)
      .map((c) => `<div style="flex:${((c.bytes / total) * 1000).toFixed(3)} 1 0;background:${c.color}" class="dark-label" data-tip="${U.esc(`${c.name}\n${U.bytes(c.bytes)} · ${((c.bytes / total) * 100).toFixed(1)}%`)}">${c.bytes / total > 0.08 ? U.esc(c.name) : ''}</div>`)
      .join('')}</div>`;
    const max = Math.max(1, ...list.map((c) => c.bytes));
    const catRows = list
      .map(
        (c) => `<tr><td><div style="display:flex;align-items:center;gap:9px"><i class="legend-dot" style="background:${c.color}"></i><span class="nm">${U.esc(c.name)}</span></div>
          <div class="sub" style="padding-left:19px">${U.esc(
            c.exts
              .slice(0, 6)
              .map((e) => (e.ext ? `.${e.ext}` : '(none)'))
              .join('  '),
          )}</div></td>
          <td style="width:30%">${U.minibar(c.bytes / max, c.color)}</td>
          <td class="r" style="width:110px;font-weight:600">${U.bytes(c.bytes)}</td><td class="r faint" style="width:120px">${U.num(c.count)} files</td></tr>`,
      )
      .join('');
    const top = st.types.slice(0, 40);
    const tmax = Math.max(1, ...top.map((t) => t.bytes));
    const extRows = top
      .map((t) => {
        const c = categoryOf(t.ext);
        return `<tr><td class="nm">${t.ext ? `.${U.esc(t.ext)}` : '<span class="faint">(no extension)</span>'}</td><td class="sub">${U.esc(c.name)}</td><td style="width:30%">${U.minibar(t.bytes / tmax, c.color)}</td><td class="r" style="width:110px;font-weight:600">${U.bytes(t.bytes)}</td><td class="r faint" style="width:120px">${U.num(t.count)} files</td></tr>`;
      })
      .join('');
    body.innerHTML = `
      ${summaryNotice()}
      <div class="card" style="margin-bottom:14px"><div class="card-title">By kind of file</div>${stack}<table class="list-table" style="margin-top:12px">${catRows}</table></div>
      <div class="card" style="padding:12px 8px 4px"><div class="card-title" style="padding:0 10px">Top extensions</div><table class="list-table">${extRows}</table></div>`;
  }

  // ---------- apps ----------
  function appSize(a) {
    return a.measured != null ? a.measured : a.estimated || 0;
  }

  function renderApps() {
    if (!U.$('#sg-apps-table')) {
      body.innerHTML = `
        <div class="toolbar" style="padding:0 0 12px">
          <div class="search"><svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.38A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg><input id="sg-apps-q" placeholder="Search apps or publishers" spellcheck="false" value="${U.esc(st.appsQ)}"></div>
          <span class="faint" id="sg-apps-status"></span>
          <div class="spacer"></div>
          <button class="btn sm" data-settings="apps">Uninstall apps in Settings</button>
          <button class="btn sm ghost" data-reapps>Refresh</button>
        </div>
        <div class="card" style="padding:4px 8px"><table class="list-table" id="sg-apps-table"></table></div>`;
    }
    renderAppsTable();
  }

  function renderAppsTable() {
    const table = U.$('#sg-apps-table');
    if (!table) return;
    const a = st.apps || { status: 'loading', list: [] };
    const status = U.$('#sg-apps-status');
    const total = a.list.reduce((s, x) => s + appSize(x) + (x.data || 0), 0);
    if (status) {
      status.textContent =
        a.status === 'loading' ? 'Reading installed apps…' : a.status === 'measuring' ? `Measuring install folders… ${a.list.length} apps` : `${a.list.length} apps · ${U.bytes(total)} total`;
    }
    if (!a.list.length) {
      table.innerHTML = `<tr><td><div class="empty">${a.status === 'done' ? 'No apps found.' : 'Reading installed apps…'}</div></td></tr>`;
      return;
    }
    const q = st.appsQ;
    const { key, dir } = st.appsSort;
    const val = { name: (x) => x.name.toLowerCase(), size: (x) => appSize(x) + (x.data || 0), installed: (x) => x.installed || '', source: (x) => x.source };
    const list = a.list
      .filter((x) => !q || x.name.toLowerCase().includes(q) || (x.publisher || '').toLowerCase().includes(q))
      .sort((x, y) => (val[key](x) < val[key](y) ? -dir : val[key](x) > val[key](y) ? dir : 0));
    const max = Math.max(1, ...list.map((x) => appSize(x) + (x.data || 0)));
    const th = (k, label, cls = '', style = '') => `<th class="sortable ${cls} ${key === k ? 'sorted' : ''}" data-asort="${k}" style="${style}">${label}${key === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    const rows = list
      .map((x) => {
        const size = appSize(x);
        let sizeText;
        let tip;
        if (x.measured != null) {
          sizeText = U.bytes(size);
          tip = 'Measured size of the install folder';
          if (x.containsOthers) tip += `\nExcludes ${x.containsOthers} other app${x.containsOthers === 1 ? '' : 's'} installed inside this folder`;
          if (x.sharedWith) tip += `\nShares its folder with ${x.sharedWith} other entr${x.sharedWith === 1 ? 'y' : 'ies'}`;
        } else if (x.estimated) {
          sizeText = `≈ ${U.bytes(size)}`;
          tip = x.unreadable ? 'Install folder needs admin rights; showing the installer’s own estimate' : 'Estimate reported by the installer';
        } else {
          sizeText = a.status === 'done' ? '—' : '…';
          tip = 'No size information';
        }
        if (x.data) tip += `\nPlus ${U.bytes(x.data)} of app data`;
        const loc = x.location || '';
        return `<tr ${loc ? `data-path="${U.esc(loc)}" data-kind="dir"` : ''} data-name="${U.esc(x.name)}">
          <td><div class="nm" style="overflow:hidden;text-overflow:ellipsis">${U.esc(x.name)}</div><div class="sub">${U.esc([x.publisher, x.version].filter(Boolean).join(' · '))}</div></td>
          <td class="r" style="font-weight:600" data-tip="${U.esc(tip)}">${sizeText}${x.data ? `<div class="sub">+${U.bytes(x.data)} data</div>` : ''}</td>
          <td>${U.minibar((size + (x.data || 0)) / max)}</td>
          <td class="faint">${U.esc(x.installed || '—')}</td>
          <td class="faint">${U.esc(x.source)}</td>
          <td class="sub" data-tip="${U.esc(loc)}">${U.esc(loc)}</td>
          <td class="r">${loc ? `<button class="btn sm" data-open="${U.esc(loc)}">Open</button>` : ''}</td></tr>`;
      })
      .join('');
    table.innerHTML = `<thead><tr>${th('name', 'App', '', 'width:28%')}${th('size', 'Size', 'r', 'width:110px')}<th style="width:12%"></th>${th('installed', 'Installed', '', 'width:100px')}${th('source', 'Type', '', 'width:96px')}<th>Location</th><th style="width:72px"></th></tr></thead><tbody>${rows}</tbody>`;
  }

  // ---------- shell ----------
  function render() {
    if (!root) return;
    U.$$('#sg-tabs .tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab));
    if (st.tab === 'overview') renderOverview();
    else if (st.tab === 'explore') renderExplore();
    else if (st.tab === 'files') renderFiles();
    else if (st.tab === 'types') renderTypes();
    else if (st.tab === 'apps') {
      body.innerHTML = '';
      renderApps();
    }
  }

  async function show(opts = {}) {
    if (opts.tab) st.tab = opts.tab;
    render();
    const [drives, hogs, state] = await Promise.all([syslens.storage.drives(), syslens.storage.hogs(false), syslens.storage.state()]);
    st.drives = drives;
    st.hogs = hogs;
    if (!st.loaded && state.scan && state.scan.summary) {
      st.summary = state.scan.summary;
      await loadScanResults();
    }
    if (state.scan && state.scan.expired && !st.scanning) {
      st.expired = state.scan.expired;
      st.summary = null;
      st.listing = null;
    }
    if (!st.loaded && state.scan && state.scan.running) {
      st.scanning = true;
      st.scanRoot = state.scan.root;
      st.started = state.scan.started || Date.now();
    }
    st.loaded = true;
    if (opts.scan) {
      startScan(opts.scan);
      return;
    }
    render();
  }

  return { init, render: () => {}, show, title: 'Storage' };
})();
