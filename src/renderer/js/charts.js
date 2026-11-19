'use strict';
/* global U */

// Minimal canvas line/area charts, crisp on high-DPI screens and redrawn on resize.
const Charts = (() => {
  const observer = new ResizeObserver((entries) => {
    for (const e of entries) if (e.target._chart) line(e.target, e.target._chart);
  });

  function resolve(color) {
    return color && color.startsWith('--') ? U.cssVar(color) : color || U.cssVar('--accent');
  }

  function alpha(color, a) {
    const c = color.trim();
    if (c.startsWith('#')) {
      const hex = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7);
      const n = parseInt(hex, 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }
    return c;
  }

  function niceMax(v) {
    if (!(v > 0)) return 0;
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / exp;
    const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nice * exp;
  }

  /**
   * opts: { series: [{ data, color, fill=true, width, dash }], max, minMax, grid=true }
   * Returns the y-axis maximum that was used.
   */
  function line(canvas, opts) {
    if (!canvas) return 0;
    canvas._chart = opts;
    if (!canvas._observed) {
      observer.observe(canvas);
      canvas._observed = true;
    }
    // The interface size setting scales the page (CSS zoom): draw at that resolution too.
    const dpr = (window.devicePixelRatio || 1) * U.zoom();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return 0;
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const series = opts.series.filter((s) => s && s.data);
    let max = opts.max;
    if (max == null) {
      let m = 0;
      for (const s of series) for (const v of s.data) if (v != null && v > m) m = v;
      max = niceMax(m * 1.15) || 1;
      if (opts.minMax && max < opts.minMax) max = opts.minMax;
    }

    if (opts.grid !== false) {
      ctx.strokeStyle = U.cssVar('--border');
      ctx.lineWidth = 1;
      ctx.beginPath();
      const rows = opts.gridRows || 4;
      const cols = opts.gridCols || 8;
      for (let i = 1; i < rows; i++) {
        const y = Math.round((h * i) / rows) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      for (let i = 1; i < cols; i++) {
        const x = Math.round((w * i) / cols) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      ctx.stroke();
    }

    for (const s of series) {
      const color = resolve(s.color);
      const n = s.data.length;
      if (n < 2) continue;
      const dx = w / (n - 1);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const v = s.data[i];
        if (v == null) continue;
        pts.push([i * dx, h - 1 - Math.max(0, Math.min(1, v / max)) * (h - 3)]);
      }
      if (pts.length < 2) continue;
      if (s.fill !== false) {
        // A flat translucent fill under the line, like Task Manager.
        ctx.beginPath();
        ctx.moveTo(pts[0][0], h);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        ctx.lineTo(pts[pts.length - 1][0], h);
        ctx.closePath();
        ctx.fillStyle = alpha(color, s.fillAlpha != null ? s.fillAlpha : 0.14);
        ctx.fill();
      }
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = color;
      ctx.lineWidth = s.width || 1.4;
      ctx.lineJoin = 'round';
      ctx.setLineDash(s.dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    return max;
  }

  return { line, niceMax, alpha, resolve };
})();
