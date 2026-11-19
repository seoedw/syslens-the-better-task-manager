'use strict';
/* global U, App, syslens, Menu */

// Users: who is signed in to this PC, what each session is running and using, and Task
// Manager's Users-tab actions (lock, switch user, sign out).
const UsersView = (() => {
  let root;
  let data = null; // { sessions, current }
  let loadedAt = 0;
  let loading = false;
  let lastPaint = 0;

  function init(el) {
    root = el;
    root.innerHTML = `
      <div class="summary" id="us-sum"><div class="loading">Reading sessions…</div></div>
      <div id="us-list"></div>`;
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-uact]');
      if (a) act(Number(a.dataset.sid), a.dataset.uact);
      const g = e.target.closest('[data-group]');
      if (g) App.go('processes', { group: g.dataset.group });
    });
    root.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('[data-sid]');
      if (!card || e.target.closest('[data-group]')) return;
      const s = data && data.sessions.find((x) => x.id === Number(card.dataset.sid));
      if (s) Menu.openAt(e, menuFor(s));
    });
  }

  async function load() {
    if (loading) return;
    loading = true;
    try {
      data = await syslens.users();
      loadedAt = Date.now();
    } catch {
      data = data || { sessions: [], current: null };
    }
    loading = false;
    paint();
  }

  const isOwn = (s) => data && s.id === data.current;
  const nameOf = (s) => (s.user ? (App.settings && App.settings.fullAccount && s.domain ? `${s.domain}\\${s.user}` : s.user) : '');

  function menuFor(s) {
    const own = isOwn(s);
    return [
      own && { label: 'Lock', icon: 'shield', kbd: 'Win+L', run: () => act(s.id, 'lock') },
      { label: own ? 'Switch user' : 'Disconnect', icon: 'window', run: () => act(s.id, 'disconnect') },
      { label: 'Sign out', icon: 'power', danger: true, run: () => act(s.id, 'logoff') },
      '-',
      s.user && { label: 'Copy user name', icon: 'copy', run: () => U.copy(nameOf(s), 'User name copied') },
    ].filter(Boolean);
  }

  async function act(id, action) {
    const s = data && data.sessions.find((x) => x.id === id);
    if (!s) return;
    const own = isOwn(s);
    const who = own ? 'your session' : `${nameOf(s) || 'this user'}’s session`;
    if (action === 'logoff') {
      const ok = await U.confirm({
        title: own ? 'Sign out?' : `Sign out ${nameOf(s) || 'this user'}?`,
        body: `Every app in ${who} closes, <b>including anything that isn’t saved</b>.${own ? ' SysLens closes too.' : ''}`,
        confirmLabel: 'Sign out',
        danger: true,
      });
      if (!ok) return;
    } else if (action === 'disconnect') {
      const ok = await U.confirm({
        title: own ? 'Switch user?' : 'Disconnect this session?',
        body: own ? 'Your apps keep running and Windows shows the sign-in screen, where someone else can sign in or you can come back.' : 'Their apps keep running; they can sign back in to carry on.',
        confirmLabel: own ? 'Switch user' : 'Disconnect',
      });
      if (!ok) return;
    }
    const r = await syslens.userAction(id, action);
    if (!r || !r.ok) {
      const denied = r && /denied/i.test(r.error || '');
      U.toast(denied && !(App.snap && App.snap.admin) ? 'Other users’ sessions need SysLens to run as administrator.' : (r && r.error) || 'Windows refused.', 'bad', 7000);
    } else {
      setTimeout(load, 1500);
    }
  }

  function initial(name) {
    const n = (name || '?').replace(/^.*\\/, '').trim();
    return U.esc((n[0] || '?').toUpperCase());
  }

  function paint() {
    if (!root || !data) return;
    lastPaint = Date.now();
    const snap = App.snap;
    const procs = (snap && snap.procs) || [];
    const groups = new Map(((snap && snap.groups) || []).map((g) => [g.key, g]));
    const bySession = new Map();
    for (const p of procs) {
      let t = bySession.get(p.session);
      if (!t) bySession.set(p.session, (t = { n: 0, cpu: 0, priv: 0, io: 0, gpu: 0, apps: new Map() }));
      t.n++;
      t.cpu += p.cpu;
      t.priv += p.priv;
      t.io += p.io;
      t.gpu = Math.max(t.gpu, p.gpu);
      const a = t.apps.get(p.group) || { key: p.group, priv: 0, cpu: 0, count: 0 };
      a.priv += p.priv;
      a.cpu += p.cpu;
      a.count++;
      t.apps.set(p.group, a);
    }
    const users = data.sessions.filter((s) => s.user);
    const services = bySession.get(0);
    const own = users.find(isOwn);
    U.$('#us-sum').innerHTML = `
      <div class="sum"><div class="v">${users.length}</div><div class="k">${users.length === 1 ? 'person signed in' : 'people signed in'}</div></div>
      ${own ? `<div class="sum"><div class="v">${U.esc(own.locked ? 'Locked' : own.state)}</div><div class="k">your session</div></div>` : ''}
      ${services ? `<div class="sum"><div class="v">${U.num(services.n)}</div><div class="k">processes run by Windows services</div></div>` : ''}
      <div class="sum"><div class="v">${U.num(procs.length)}</div><div class="k">processes in all</div></div>`;

    const card = (s) => {
      const t = bySession.get(s.id) || { n: 0, cpu: 0, priv: 0, io: 0, gpu: 0, apps: new Map() };
      const apps = [...t.apps.values()].sort((a, b) => b.priv - a.priv).slice(0, 6);
      const state = s.locked ? 'Locked' : s.state;
      const level = state === 'Active' ? 'ok' : state === 'Locked' ? 'info' : 'off';
      const mine = isOwn(s);
      return `<div class="card user-card" data-sid="${s.id}">
        <div class="user-head">
          <div class="avatar">${initial(nameOf(s))}</div>
          <div class="user-name"><div class="nm">${U.esc(nameOf(s))}${mine ? ' <span class="tag info">You</span>' : ''}</div>
            <div class="faint">${U.esc(s.station || `Session ${s.id}`)} · session ${s.id}${s.logon ? ` · signed in ${U.esc(U.when(s.logon))}` : ''}</div></div>
          <span class="user-state">${U.status(state, level)}</span>
        </div>
        <div class="user-stats">
          <div><span class="k">Processes</span><b>${U.num(t.n)}</b></div>
          <div><span class="k">CPU</span><b>${t.cpu.toFixed(1)}%</b></div>
          <div><span class="k">Memory</span><b>${U.bytes(t.priv)}</b></div>
          <div><span class="k">Disk &amp; I/O</span><b>${U.rate(t.io)}</b></div>
          <div><span class="k">GPU</span><b>${t.gpu.toFixed(0)}%</b></div>
        </div>
        ${apps.length ? `<div class="user-apps">${apps
          .map((a) => {
            const g = groups.get(a.key);
            return `<div class="toprow" data-group="${U.esc(a.key)}">${U.icon(g && g.path, g && g.type === 'windows' ? U.WIN_ICON : undefined)}<div class="nm">${U.esc(g ? g.name : a.key)}${a.count > 1 ? `<span class="cnt">${a.count}</span>` : ''}</div><div class="val">${U.bytes(a.priv)}</div></div>`;
          })
          .join('')}</div>` : ''}
        <div class="user-actions">
          ${mine ? `<button class="btn sm" data-uact="lock" data-sid="${s.id}">Lock</button>` : ''}
          <button class="btn sm" data-uact="disconnect" data-sid="${s.id}">${mine ? 'Switch user' : 'Disconnect'}</button>
          <button class="btn sm danger" data-uact="logoff" data-sid="${s.id}">Sign out</button>
        </div>
      </div>`;
    };

    const svcCard = services
      ? `<div class="card user-card system"><div class="user-head"><div class="avatar sys">${U.glyph('service', 'av-gl')}</div>
          <div class="user-name"><div class="nm">Windows services</div><div class="faint">Session 0 · runs whether or not anyone is signed in</div></div></div>
          <div class="user-stats">
            <div><span class="k">Processes</span><b>${U.num(services.n)}</b></div>
            <div><span class="k">CPU</span><b>${services.cpu.toFixed(1)}%</b></div>
            <div><span class="k">Memory</span><b>${U.bytes(services.priv)}</b></div>
            <div><span class="k">Disk &amp; I/O</span><b>${U.rate(services.io)}</b></div>
          </div></div>`
      : '';
    U.$('#us-list').innerHTML = users.length || svcCard ? `<div class="user-grid">${users.map(card).join('')}${svcCard}</div>` : '<div class="empty">No sessions found.</div>';
  }

  function show() {
    if (!data || Date.now() - loadedAt > 10000) load();
    else paint();
  }

  function hide() {
    const l = U.$('#us-list');
    if (l) l.innerHTML = '';
    lastPaint = 0;
  }

  return {
    init,
    show,
    hide,
    // Sessions change rarely: re-read every 15 s; the numbers repaint every 2 s.
    render: () => {
      if (!data) return;
      if (Date.now() - loadedAt > 15000) load();
      else if (Date.now() - lastPaint > 2000) paint();
    },
    title: 'Users',
  };
})();
