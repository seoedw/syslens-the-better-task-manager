'use strict';
/* global U */

// Right-click menus, styled after Windows 11's: icons, separators, check marks, submenus,
// keyboard support (arrows, Enter, Esc, Shift+F10 / the Menu key on a selected row).
//
// Items: { label, icon?, kbd?, danger?, disabled?, checked?, hint?, run?, sub?: [items] } or '-'.
const Menu = (() => {
  let rootEl = null;
  let stack = []; // open panels: [{ el, items, sel }]
  let onCloseCb = null;

  const ICONS = {
    end: '<path d="M6 6l12 12M18 6L6 18"/>',
    tree: '<path d="M5 4v6h6"/><path d="M5 10v8h6"/><rect x="11" y="7" width="8" height="6" rx="1.5"/><rect x="11" y="15" width="8" height="6" rx="1.5"/>',
    leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19c3-4 6-6 9-8"/>',
    pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/>',
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    window: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9h17"/>',
    service: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
    restart: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/>',
    start: '<path d="M7 5l12 7-12 7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    power: '<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    hide: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.2 9.5 6-.4.8-1.3 2-2.6 3.2M6.6 7.6C4.6 8.9 3.2 10.8 2.5 12c1 1.8 4.5 6 9.5 6 1.5 0 2.9-.4 4.1-1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
    pin: '<path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/>',
  };

  const icon = (name) => (name ? `<svg class="mi-ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>` : '<span class="mi-ico"></span>');

  function panelHtml(items) {
    return items
      .map((it, i) => {
        if (it === '-') return '<div class="mi-sep" role="separator"></div>';
        const cls = ['mi', it.danger ? 'danger' : '', it.disabled ? 'disabled' : '', it.sub ? 'has-sub' : ''].join(' ');
        const lead = it.checked != null ? `<span class="mi-check">${it.checked ? '✓' : ''}</span>` : icon(it.icon);
        const tail = it.sub ? '<span class="mi-arrow">›</span>' : it.kbd ? `<span class="mi-kbd">${U.esc(it.kbd)}</span>` : it.hint ? `<span class="mi-kbd">${U.esc(it.hint)}</span>` : '';
        return `<div class="${cls}" role="menuitem" data-i="${i}" ${it.disabled ? 'aria-disabled="true"' : ''} ${it.tip ? `data-tip="${U.esc(it.tip)}"` : ''}>${lead}<span class="mi-label">${U.esc(it.label)}</span>${tail}</div>`;
      })
      .join('');
  }

  function place(el, x, y, alignRight = null) {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (alignRight != null && left + r.width > vw - 6) left = alignRight - r.width; // submenu: flip to the left
    if (left + r.width > vw - 6) left = Math.max(6, vw - r.width - 6);
    if (top + r.height > vh - 6) top = Math.max(6, vh - r.height - 6);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function openPanel(items, x, y, level, alignRight) {
    // Close deeper panels first.
    while (stack.length > level) stack.pop().el.remove();
    const el = document.createElement('div');
    el.className = 'menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = panelHtml(items);
    rootEl.appendChild(el);
    place(el, x, y, alignRight);
    const panel = { el, items, sel: -1 };
    stack.push(panel);
    el.addEventListener('mouseover', (e) => {
      const mi = e.target.closest('.mi');
      if (!mi) return;
      const i = Number(mi.dataset.i);
      highlight(panel, i);
      clearTimeout(panel.subTimer);
      const it = items[i];
      if (it.sub && !it.disabled) panel.subTimer = setTimeout(() => openSub(panel, i), 180);
      else panel.subTimer = setTimeout(() => {
        while (stack.length > stack.indexOf(panel) + 1) stack.pop().el.remove();
      }, 220);
    });
    el.addEventListener('click', (e) => {
      const mi = e.target.closest('.mi');
      if (!mi) return;
      activate(panel, Number(mi.dataset.i));
    });
    return panel;
  }

  function highlight(panel, i) {
    panel.sel = i;
    panel.el.querySelectorAll('.mi').forEach((m) => m.classList.toggle('on', Number(m.dataset.i) === i));
  }

  function openSub(panel, i) {
    const it = panel.items[i];
    const row = panel.el.querySelector(`.mi[data-i="${i}"]`);
    if (!it || !it.sub || !row) return null;
    const r = row.getBoundingClientRect();
    const sub = openPanel(it.sub, r.right - 2, r.top - 4, stack.indexOf(panel) + 1, r.left + 2);
    return sub;
  }

  function activate(panel, i) {
    const it = panel.items[i];
    if (!it || it === '-' || it.disabled) return;
    if (it.sub) {
      const sub = openSub(panel, i);
      if (sub) highlight(sub, firstEnabled(sub.items, -1, 1));
      return;
    }
    close();
    if (it.run) {
      try {
        const r = it.run();
        if (r && typeof r.catch === 'function') r.catch((err) => U.toast(String((err && err.message) || err), 'bad'));
      } catch (err) {
        U.toast(String((err && err.message) || err), 'bad');
      }
    }
  }

  function firstEnabled(items, from, dir) {
    const n = items.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + dir * k + n * 2) % n;
      const it = items[i];
      if (it !== '-' && !it.disabled) return i;
    }
    return -1;
  }

  function onKey(e) {
    if (!rootEl) return;
    const panel = stack[stack.length - 1];
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === 'Escape') {
      stop();
      if (stack.length > 1) stack.pop().el.remove();
      else close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      stop();
      highlight(panel, firstEnabled(panel.items, panel.sel, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'ArrowRight') {
      stop();
      const it = panel.items[panel.sel];
      if (it && it.sub) {
        const sub = openSub(panel, panel.sel);
        if (sub) highlight(sub, firstEnabled(sub.items, -1, 1));
      }
    } else if (e.key === 'ArrowLeft') {
      stop();
      if (stack.length > 1) stack.pop().el.remove();
    } else if (e.key === 'Enter' || e.key === ' ') {
      stop();
      if (panel.sel >= 0) activate(panel, panel.sel);
    } else if (e.key === 'Tab') {
      stop();
    }
  }

  function onOutside(e) {
    if (rootEl && !e.target.closest('.menu')) close();
  }

  function close() {
    if (!rootEl) return;
    rootEl.innerHTML = '';
    rootEl = null;
    stack = [];
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onOutside, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', close, true);
    const cb = onCloseCb;
    onCloseCb = null;
    if (cb) cb();
  }

  /** Open at (x, y). With keyboard=true the first item is highlighted. */
  function open(x, y, items, { keyboard = false, onClose = null } = {}) {
    close();
    const list = items.filter((it, i, arr) => it && !(it === '-' && (i === 0 || arr[i - 1] === '-' || i === arr.length - 1)));
    if (!list.length) return;
    rootEl = document.getElementById('menuRoot');
    onCloseCb = onClose;
    const panel = openPanel(list, x, y, 0);
    if (keyboard) highlight(panel, firstEnabled(list, -1, 1));
    document.addEventListener('keydown', onKey, true);
    // Registered after this event finishes, so the click that opened the menu doesn't close it.
    setTimeout(() => {
      if (!rootEl) return;
      document.addEventListener('mousedown', onOutside, true);
      window.addEventListener('blur', close);
      window.addEventListener('resize', close);
      document.addEventListener('scroll', close, true);
    }, 0);
  }

  /** Open for a contextmenu event, or at an element (keyboard). */
  function openAt(e, items) {
    if (e && e.type === 'contextmenu' && (e.clientX || e.clientY)) {
      e.preventDefault();
      open(e.clientX, e.clientY, items);
      return;
    }
    if (e && e.preventDefault) e.preventDefault();
    const el = e && e.target && e.target.getBoundingClientRect ? e.target : null;
    const r = el ? el.getBoundingClientRect() : { left: 200, bottom: 200 };
    open(r.left + 24, r.bottom - 4, items, { keyboard: true });
  }

  return {
    open,
    openAt,
    close,
    get isOpen() {
      return !!rootEl;
    },
  };
})();
