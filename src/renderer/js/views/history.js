'use strict';
/* global U, App, syslens */

// History: what this PC did over the last week, from the Windows event logs.
const HistoryView = (() => {
  let root;
  let data = null;
  let loading = false;
  const st = { group: 'all', q: '' };
  const DAY = 86400000;

  const GLYPH = {
    boot: 'power', shutdown: 'power', request: 'power', unexpected: 'warn', 'unexpected-note': 'warn',
    sleep: 'sleep', wake: 'wake', standby: 'standby', source: 'plug',
    crash: 'crash', hang: 'hang', bsod: 'crash', service: 'service',
    update: 'update', 'update-failed': 'update', install: 'install', uninstall: 'install',
  };

  function init(el) {
    root = el;
    root.innerHTML = `
      <div class="summary" id="hi-sum"><div class="loading">Reading the Windows event logs…</div></div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-title">When this PC was on <span class="sub">last 7 days, from power events</span><button class="btn sm right" id="hi-refresh">Refresh</button></div>
        <div id="hi-timeline"></div>
        <div class="tl-legend">
          <span><i style="background:var(--tl-on)"></i>On</span>
          <span><i style="background:var(--tl-standby)"></i>Screen off (standby)</span>
          <span><i style="background:var(--tl-sleep)"></i>Asleep or hibernated</span>
          <span><i style="background:var(--card-2)"></i>Off</span>
          <span><i style="background:var(--bad);width:3px"></i>Crash or blue screen</span>
        </div>
      </div>
      <div class="page-actions">
        <div class="seg" id="hi-filter">
          <button data-g="all">Everything</button>
          <button data-g="power">Power and sleep</button>
          <button data-g="problems">Problems</button>
          <button data-g="updates">Updates and installs</button>
        </div>
        <div class="search"><svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.38A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg><input id="hi-q" placeholder="Filter events" spellcheck="false" /></div>
        <span class="spacer"></span>
        <span class="faint" id="hi-when"></span>
      </div>
      <div class="card"><div class="events" id="hi-events"></div></div>`;
    root.addEventListener('click', (e) => {
      const g = e.target.closest('[data-g]');
      if (g) {
        st.group = g.dataset.g;
        renderEvents();
      }
      if (e.target.closest('#hi-refresh')) load(true);
    });
    U.$('#hi-q').addEventListener('input', (e) => {
      st.q = e.target.value.trim().toLowerCase();
      renderEvents();
    });
  }

  async function load(refresh = false) {
    if (loading) return;
    loading = true;
    try {
      data = await syslens.history(refresh);
    } catch {
      data = data || null;
    }
    loading = false;
    paint();
  }

  function show() {
    if (!data || Date.now() - data.at > 5 * 60000) load(!!data);
    else paint();
  }

  function paint() {
    if (!data) {
      U.$('#hi-sum').innerHTML = '<div class="empty">Couldn’t read the event logs.</div>';
      return;
    }
    renderSummary();
    renderTimeline();
    renderEvents();
    U.$('#hi-when').textContent = `Read ${U.ago(data.at)}`;
  }

  function renderSummary() {
    const s = data.summary;
    const top = s.topCrashers.filter((c) => c.app).map((c) => `${c.app} (${c.n})`);
    const item = (v, k) => `<div class="sum"><div class="v">${v}</div><div class="k">${k}</div></div>`;
    U.$('#hi-sum').innerHTML = `
      ${item(s.boots, s.boots === 1 ? 'start-up' : 'start-ups')}
      ${item(s.sleeps, s.sleeps === 1 ? 'time asleep' : 'times asleep')}
      ${item(s.crashes + s.hangs, 'app crashes and freezes')}
      ${item(s.bsods + s.unexpected, 'crashes and power losses')}
      ${item(s.updates, 'updates installed')}
      ${s.failedUpdates ? item(s.failedUpdates, 'failed update attempts') : ''}
      ${top.length ? `<div class="note">Crashed or froze most: ${U.esc(top.join(', '))}.</div>` : ''}`;
  }

  function renderTimeline() {
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const marks = data.list.filter((e) => e.kind === 'bsod' || e.kind === 'unexpected' || e.kind === 'crash');
    const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span>${h === 24 ? '' : h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}</span>`).join('');
    let html = `<div></div><div class="tl-hours">${hours}</div><div class="tl-total faint">On for</div>`;
    for (let i = 0; i < 7; i++) {
      const start = today.getTime() - i * DAY;
      const end = start + DAY;
      let on = 0;
      const segs = [];
      for (const sp of data.spans) {
        const a = Math.max(sp.from, start);
        const b = Math.min(sp.to, end, now);
        if (b <= a) continue;
        if (sp.state === 'on') on += b - a;
        segs.push(`<i class="tl-seg ${sp.state}" style="left:${(((a - start) / DAY) * 100).toFixed(3)}%;width:${(((b - a) / DAY) * 100).toFixed(3)}%" data-tip="${U.esc(`${label(sp.state)}\n${U.time(a)} – ${b >= now ? 'now' : U.time(b)} (${U.span(b - a)})`)}"></i>`);
      }
      const grid = [3, 6, 9, 12, 15, 18, 21].map((h) => `<i class="grid-h" style="left:${((h / 24) * 100).toFixed(2)}%"></i>`).join('');
      const dayMarks = marks
        .filter((m) => m.t >= start && m.t < end)
        .map((m) => `<i class="tl-mark" style="left:${(((m.t - start) / DAY) * 100).toFixed(3)}%" data-tip="${U.esc(`${m.title}\n${U.time(m.t)}`)}"></i>`)
        .join('');
      const nowMark = i === 0 ? `<i class="tl-now" style="left:${(((now - start) / DAY) * 100).toFixed(3)}%" data-tip="Now"></i>` : '';
      const d = new Date(start);
      const name = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short' });
      html += `<div class="tl-day"><b>${name}</b> <span class="faint">${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>
        <div class="tl-track">${grid}${segs.join('')}${dayMarks}${nowMark}</div>
        <div class="tl-total">${on > 0 ? U.span(on) : '—'}</div>`;
    }
    U.$('#hi-timeline').innerHTML = `<div class="timeline">${html}</div>`;
  }

  const label = (s) => ({ on: 'On', standby: 'Screen off (standby)', sleep: 'Asleep or hibernated', off: 'Off' })[s] || s;

  function detail(e) {
    const parts = [];
    if (e.detail) parts.push(e.detail);
    if (e.kind === 'wake' && e.slept && e.woke && e.woke > e.slept) parts.push(`Asleep for ${U.span(e.woke - e.slept)}.`);
    if (e.kind === 'standby' && e.until) parts.push(`Screen off for ${U.span(e.until - e.t)}, until ${U.time(e.until)}.`);
    return parts.join(' ');
  }

  function renderEvents() {
    U.$$('#hi-filter button').forEach((b) => b.classList.toggle('on', b.dataset.g === st.group));
    if (!data) return;
    let list = data.list.filter((e) => st.group === 'all' || e.group === st.group);
    if (st.q) list = list.filter((e) => `${e.title} ${e.detail || ''}`.toLowerCase().includes(st.q));
    let html = '';
    let day = '';
    for (const e of list.slice(0, 400)) {
      const dn = U.dayName(e.t);
      if (dn !== day) {
        day = dn;
        html += `<div class="event-day">${U.esc(dn)}${dn === 'Today' || dn === 'Yesterday' ? ` <span class="faint" style="font-weight:400">${new Date(e.t).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</span>` : ''}</div>`;
      }
      const d = detail(e);
      html += `<div class="event ${e.level || ''}">
        <span class="time">${U.time(e.t)}</span>
        ${U.glyph(GLYPH[e.kind] || 'page', 'ev-ico')}
        <div class="what"><div class="t" title="${U.esc(e.title)}">${U.esc(e.title)}</div>${d ? `<div class="d">${U.esc(d)}</div>` : ''}</div>
        <span class="count">${e.count > 1 ? `${e.count} times${e.since ? `, since ${U.time(e.since)}` : ''}` : ''}</span>
      </div>`;
    }
    U.$('#hi-events').innerHTML = html || '<div class="empty">No events match.</div>';
  }

  return {
    init,
    render: () => {},
    show,
    load,
    get data() {
      return data;
    },
    title: 'History',
  };
})();
