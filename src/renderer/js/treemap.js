'use strict';
/* global U */

// Squarified treemap (Bruls et al.) rendered as absolutely-positioned divs.
const Treemap = (() => {
  const PALETTE = ['#4f8ff7', '#8b6ff0', '#2fb3a0', '#e88a3a', '#e0609a', '#5bb85b', '#c9a63a', '#4fb3d9', '#b06fd6', '#d9644f'];

  function worst(row, side) {
    let sum = 0;
    let max = -Infinity;
    let min = Infinity;
    for (const r of row) {
      sum += r;
      if (r > max) max = r;
      if (r < min) min = r;
    }
    const s2 = sum * sum;
    const w2 = side * side;
    return Math.max((w2 * max) / s2, s2 / (w2 * min));
  }

  function layout(values, x, y, w, h) {
    const total = values.reduce((a, b) => a + b, 0);
    if (!total || w <= 0 || h <= 0) return [];
    const scale = (w * h) / total;
    const areas = values.map((v) => v * scale);
    const rects = [];
    let rx = x;
    let ry = y;
    let rw = w;
    let rh = h;
    let row = [];

    const flush = () => {
      const s = row.reduce((a, b) => a + b, 0);
      if (rw >= rh) {
        const colW = s / rh;
        let cy = ry;
        for (const a of row) {
          const hh = a / colW;
          rects.push({ x: rx, y: cy, w: colW, h: hh });
          cy += hh;
        }
        rx += colW;
        rw -= colW;
      } else {
        const rowH = s / rw;
        let cx = rx;
        for (const a of row) {
          const ww = a / rowH;
          rects.push({ x: cx, y: ry, w: ww, h: rowH });
          cx += ww;
        }
        ry += rowH;
        rh -= rowH;
      }
      row = [];
    };

    let i = 0;
    while (i < areas.length) {
      const side = Math.min(rw, rh);
      const a = areas[i];
      if (row.length === 0 || worst([...row, a], side) <= worst(row, side)) {
        row.push(a);
        i++;
      } else {
        flush();
      }
    }
    if (row.length) flush();
    return rects;
  }

  /** items: [{ name, size, dir, aggregate }] sorted by size desc. */
  function render(container, items, { onOpen } = {}) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const shown = items.filter((it) => it.size > 0).slice(0, 60);
    const rest = items.filter((it) => it.size > 0).slice(60);
    if (rest.length) {
      shown.push({ name: `${rest.length} more items`, size: rest.reduce((s, it) => s + it.size, 0), aggregate: true });
    }
    const total = shown.reduce((s, it) => s + it.size, 0);
    const rects = layout(
      shown.map((it) => it.size),
      0,
      0,
      w,
      h,
    );
    let colorIdx = 0;
    container.innerHTML = rects
      .map((r, i) => {
        const it = shown[i];
        let bg;
        if (it.aggregate) bg = 'var(--m-other)';
        else if (!it.dir) bg = '#5d6b80';
        else bg = PALETTE[colorIdx++ % PALETTE.length];
        const big = r.w > 70 && r.h > 34;
        const share = total ? ((it.size / total) * 100).toFixed(1) : '0';
        const tip = `${it.name}\n${U.bytes(it.size)} · ${share}%${it.dir ? `\n${(it.files || 0).toLocaleString()} files` : ''}${it.dir ? '\nClick to open' : ''}`;
        return `<div class="tm-cell ${it.dir ? '' : 'file'}" data-i="${i}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${bg}" data-tip="${U.esc(tip)}">${
          big ? `<div class="n">${U.esc(it.name)}</div><div class="s">${U.bytes(it.size)}</div>` : ''
        }</div>`;
      })
      .join('');
    container.onclick = (e) => {
      const cell = e.target.closest('.tm-cell');
      if (!cell) return;
      const it = shown[Number(cell.dataset.i)];
      if (it && it.dir && onOpen) onOpen(it);
    };
  }

  return { render, layout };
})();
