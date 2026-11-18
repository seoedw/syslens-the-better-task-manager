'use strict';
/* global syslens */

// Shared helpers: formatting, DOM, tooltips, dialogs, icons and memory categories.
const U = (() => {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  const TB = GB * 1024;

  function bytes(b) {
    if (b == null || Number.isNaN(b)) return '—';
    const a = Math.abs(b);
    if (a >= TB) return `${(b / TB).toFixed(a >= 10 * TB ? 1 : 2)} TB`;
    if (a >= GB) return `${(b / GB).toFixed(a >= 100 * GB ? 0 : 1)} GB`;
    if (a >= MB) return `${(b / MB).toFixed(a >= 100 * MB ? 0 : 1)} MB`;
    if (a >= KB) return `${(b / KB).toFixed(0)} KB`;
    return `${Math.round(b)} B`;
  }

  function rate(bps) {
    if (!bps || bps < 1024) return '0 KB/s';
    return `${bytes(bps)}/s`;
  }

  function bits(bytesPerSec) {
    const b = (bytesPerSec || 0) * 8;
    if (b >= 1e9) return `${(b / 1e9).toFixed(1)} Gbps`;
    if (b >= 1e6) return `${(b / 1e6).toFixed(1)} Mbps`;
    if (b >= 1e3) return `${(b / 1e3).toFixed(0)} Kbps`;
    return `${Math.round(b)} bps`;
  }

  function pct(v, d = 0) {
    return v == null ? '—' : `${v.toFixed(d)}%`;
  }

  function dur(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  function ago(t) {
    if (!t) return '—';
    const diff = Date.now() - t;
    if (diff < 60000) return 'just now';
    return `${dur(diff).split(' ').slice(0, 2).join(' ')} ago`;
  }

  function date(t) {
    if (!t) return '—';
    return new Date(t).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function day(t) {
    if (!t) return '—';
    return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function num(n) {
    return n == null ? '—' : Math.round(n).toLocaleString();
  }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /** Background tint proportional to value/max, Task-Manager style. */
  function heat(value, max) {
    const a = Math.max(0, Math.min(1, value / max));
    if (a < 0.02) return '';
    return `style="background-color: rgba(var(--heat), ${(0.06 + a * 0.32).toFixed(3)})"`;
  }

  function minibar(fraction, color) {
    const w = Math.max(0, Math.min(100, fraction * 100));
    return `<div class="minibar"><i style="width:${w.toFixed(1)}%${color ? `;background:${color}` : ''}"></i></div>`;
  }

  // ---------- tooltip ----------
  const tip = document.getElementById('tooltip');
  let tipTarget = null;
  function placeTip(e) {
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t === tipTarget) return;
    tipTarget = t;
    if (!t) {
      tip.classList.remove('show');
      return;
    }
    tip.textContent = t.getAttribute('data-tip');
    tip.classList.add('show');
    placeTip(e);
  });
  document.addEventListener('mousemove', (e) => {
    if (tipTarget) placeTip(e);
  });
  document.addEventListener('mouseleave', () => {
    tipTarget = null;
    tip.classList.remove('show');
  });

  // ---------- dialogs ----------
  function confirm({ title, body, confirmLabel = 'OK', danger = false, cancelLabel = 'Cancel' }) {
    return new Promise((resolve) => {
      const root = document.getElementById('modalRoot');
      root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3><div class="body">${body}</div>
        <div class="actions"><button class="btn" data-a="no">${esc(cancelLabel)}</button>
        <button class="btn ${danger ? 'danger solid' : 'primary'}" data-a="yes">${esc(confirmLabel)}</button></div></div></div>`;
      const close = (v) => {
        root.innerHTML = '';
        document.removeEventListener('keydown', onKey, true);
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(false);
        }
        if (e.key === 'Enter') {
          e.stopPropagation();
          close(true);
        }
      };
      document.addEventListener('keydown', onKey, true);
      root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-backdrop')) close(false);
        const a = e.target.closest('[data-a]');
        if (a) close(a.dataset.a === 'yes');
      });
      root.querySelector('[data-a="yes"]').focus();
    });
  }

  function toast(message, kind = 'info', ms = 4500) {
    const box = document.getElementById('toasts');
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ---------- icons ----------
  const DEFAULT_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" fill="#7d8899" opacity=".35"/><rect x="3" y="4" width="18" height="5" rx="2" fill="#7d8899" opacity=".6"/></svg>',
  )}`;
  const WIN_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="#4f9dff"><rect x="3" y="3" width="8.5" height="8.5" rx="1"/><rect x="12.5" y="3" width="8.5" height="8.5" rx="1"/><rect x="3" y="12.5" width="8.5" height="8.5" rx="1"/><rect x="12.5" y="12.5" width="8.5" height="8.5" rx="1"/></g></svg>',
  )}`;
  const icons = new Map();
  function iconSrc(path, fallback) {
    if (!path) return fallback || DEFAULT_ICON;
    const v = icons.get(path);
    if (v === undefined) {
      icons.set(path, null);
      syslens.icon(path).then((url) => {
        icons.set(path, url || '');
        if (!url) return;
        for (const img of document.querySelectorAll(`img[data-icon="${CSS.escape(path)}"]`)) img.src = url;
      });
      return fallback || DEFAULT_ICON;
    }
    return v || fallback || DEFAULT_ICON;
  }
  function icon(path, fallback) {
    return `<img src="${iconSrc(path, fallback)}" ${path ? `data-icon="${esc(path)}"` : ''} alt="" draggable="false">`;
  }

  const LEVEL_ICONS = {
    info: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2zm0-8h-2V7h2z"/></svg>',
    warn: '<svg class="ico" viewBox="0 0 24 24"><path d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/></svg>',
    bad: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z"/></svg>',
  };

  // ---------- memory categories ----------
  const MEM = {
    apps: {
      label: 'Apps & background processes',
      short: 'Apps',
      color: '--m-apps',
      desc: 'Private memory of every running process — the number Task Manager shows. Memory processes share (DLLs, mapped files) is counted once, under “Shared & other”.',
      act: 'Close apps you are not using; the list below shows the biggest.',
    },
    compression: {
      label: 'Compressed memory',
      short: 'Compressed',
      color: '--m-compression',
      desc: 'Pages Windows squeezed to make room instead of writing them to disk. It grows when RAM fills up — a symptom of memory pressure, not a cause.',
      act: 'Shrinks on its own as apps are closed.',
    },
    gpu: {
      label: 'Graphics (shared GPU memory)',
      short: 'Graphics',
      color: '--m-gpu',
      desc: 'System RAM the GPU borrows for textures, video frames and the desktop. Integrated GPUs rely on it completely. Never appears as a process in Task Manager.',
      act: 'Close games, video players and hardware-accelerated browser tabs.',
    },
    nonpaged: {
      label: 'Drivers (kernel non-paged pool)',
      short: 'Drivers',
      color: '--m-nonpaged',
      desc: 'Kernel memory that must stay in RAM, used mostly by drivers. Normally 0.2–0.5 GB. More than 1 GB usually means a driver is leaking — VPN, network, antivirus and RGB/peripheral drivers are common culprits.',
      act: 'A restart resets it. If it climbs again, update or remove the suspect driver.',
    },
    paged: {
      label: 'Kernel paged pool',
      short: 'Kernel',
      color: '--m-paged',
      desc: 'Kernel memory that is allowed to be paged out: registry data, file-system metadata and driver data.',
    },
    filecache: {
      label: 'Active file cache',
      short: 'File cache',
      color: '--m-filecache',
      desc: 'File data Windows is actively working with (the system cache working set).',
    },
    kernelcode: {
      label: 'Kernel & driver code',
      short: 'Code',
      color: '--m-kernelcode',
      desc: 'The program code of the Windows kernel and loaded drivers.',
    },
    modified: {
      label: 'Modified (waiting to be written)',
      short: 'Modified',
      color: '--m-modified',
      desc: 'Changed pages queued to be written to disk or the page file before the memory can be reused.',
    },
    other: {
      label: 'Shared, page tables & locked memory',
      short: 'Other',
      color: '--m-other',
      desc: 'Everything else in use: shared DLLs and memory-mapped files (counted once), page tables, memory locked by drivers, and hypervisor / virtualization-based-security overhead. Windows does not break this down further without admin tools like RAMMap.',
    },
    standby: {
      label: 'Cached (available)',
      short: 'Cache',
      color: '--m-standby',
      available: true,
      desc: 'Recently used files kept in RAM in case they are needed again. Counts as available: Windows hands it to apps instantly.',
      act: 'Nothing to do — unused RAM is wasted RAM.',
    },
    free: {
      label: 'Free',
      short: 'Free',
      color: '--m-free',
      available: true,
      desc: 'Completely unused memory.',
    },
    reserved: {
      label: 'Hardware reserved',
      short: 'Reserved',
      color: '--m-reserved',
      hatch: true,
      desc: 'Set aside by the firmware before Windows starts — mostly the integrated GPU’s dedicated memory. Windows cannot use it.',
      act: 'Sometimes adjustable in BIOS/UEFI (“UMA frame buffer size”).',
    },
  };

  function memSegments(mem) {
    const segs = mem.parts.map((p) => ({ key: p.key, bytes: p.bytes, ...MEM[p.key] }));
    segs.push({ key: 'standby', bytes: mem.standby, ...MEM.standby });
    segs.push({ key: 'free', bytes: mem.free, ...MEM.free });
    if (mem.hardwareReserved > 0) segs.push({ key: 'reserved', bytes: mem.hardwareReserved, ...MEM.reserved });
    return segs;
  }

  function stack(segs, total, large = false) {
    const cells = segs
      .filter((s) => s.bytes > 0)
      .map((s) => {
        const share = s.bytes / total;
        const label = large && share > 0.075 ? esc(s.short) : '';
        const cls = [s.hatch ? 'hatch' : '', s.key === 'free' || s.key === 'reserved' || s.key === 'other' || s.key === 'standby' ? 'dark-label' : ''].join(' ');
        return `<div class="${cls}" style="flex:${(share * 1000).toFixed(3)} 1 0;background:var(${s.color})" data-tip="${esc(s.label)}\n${bytes(s.bytes)} · ${(share * 100).toFixed(1)}% of ${bytes(total)}">${label}</div>`;
      });
    return `<div class="stack${large ? ' lg' : ''}">${cells.join('')}</div>`;
  }

  function legend(segs) {
    return `<div class="legend">${segs
      .map((s) => `<div class="legend-item" data-tip="${esc(s.desc)}"><i class="legend-dot${s.hatch ? ' hatch' : ''}" style="background:var(${s.color})"></i><span class="lbl">${esc(s.label)}</span><span class="val">${bytes(s.bytes)}</span></div>`)
      .join('')}</div>`;
  }

  return {
    KB,
    MB,
    GB,
    TB,
    bytes,
    rate,
    bits,
    pct,
    dur,
    ago,
    date,
    day,
    num,
    esc,
    $,
    $$,
    cssVar,
    heat,
    minibar,
    confirm,
    toast,
    icon,
    iconSrc,
    DEFAULT_ICON,
    WIN_ICON,
    LEVEL_ICONS,
    MEM,
    memSegments,
    stack,
    legend,
  };
})();
