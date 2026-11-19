'use strict';

// The UI's only connection to the system: RPC calls and a live event stream to the local
// SysLens server, authenticated with the per-run token the server put in the URL fragment.
(() => {
  const KEY = 'syslens-token';
  let token = '';
  try {
    const m = /(?:^#|&)t=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (m) {
      token = m[1];
      sessionStorage.setItem(KEY, token);
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      token = sessionStorage.getItem(KEY) || '';
    }
  } catch {
    /* sessionStorage unavailable */
  }

  // Identifies this page to the server, so it can tell "window closed" from "connection lost".
  const PAGE_ID = (crypto.randomUUID && crypto.randomUUID()) || `p${Date.now()}${Math.random().toString(36).slice(2)}`;

  const listeners = new Map();
  function emit(channel, data) {
    const set = listeners.get(channel);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(data);
      } catch (err) {
        console.error(err);
      }
    }
  }
  function on(channel, cb) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(cb);
    return () => listeners.get(channel).delete(cb);
  }

  // "Hide personal info": the user name and PC name are replaced in everything that arrives,
  // before any page sees it (paths, accounts, window titles…).
  let masks = [];
  function setPrivacy(on, names = {}) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    masks = !on
      ? []
      : [
          [names.user, 'User'],
          [names.host, 'MY-PC'],
        ]
          .filter(([n]) => n && n.length >= 2)
          .map(([n, to]) => [new RegExp(`(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`, 'gi'), to]);
  }
  function unmask(text) {
    for (const [re, to] of masks) text = text.replace(re, to);
    return text;
  }

  async function invoke(channel, ...args) {
    const res = await fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SysLens-Token': token },
      body: JSON.stringify({ channel, args }),
      cache: 'no-store',
    });
    if (res.status === 403) emit('auth-failed', true);
    if (!res.ok) throw new Error(`${channel} failed (${res.status})`);
    return JSON.parse(unmask(await res.text()));
  }

  // Reassemble the compact snapshot stream (see packSnapshot in server.js).
  const procMeta = new Map();
  const groupMeta = new Map();
  let hist = null;
  let lastProcs = []; // per-process rows only come while a page that lists processes is open
  let lastSys = null; // the inventory only comes when it changes

  function rebuild(rows, fields, metaMap) {
    const live = new Set();
    const out = rows.map((row) => {
      const key = row[0];
      live.add(key);
      const o = { ...metaMap.get(key), key };
      for (let i = 0; i < fields.length; i++) o[fields[i]] = row[i + 1];
      return o;
    });
    for (const k of metaMap.keys()) if (!live.has(k)) metaMap.delete(k);
    return out;
  }

  function unpack(s) {
    if (!s || !s.packed) return s;
    const pk = s.packed;
    for (const [k, m] of Object.entries(pk.pm)) procMeta.set(k, m);
    for (const [k, m] of Object.entries(pk.gm)) groupMeta.set(k, m);
    if (s.hist) {
      hist = s.hist;
    } else if (s.histTail && hist) {
      const len = hist.cpu ? hist.cpu.length : 120;
      for (const [k, v] of Object.entries(s.histTail)) {
        let arr = hist[k];
        if (!arr) arr = hist[k] = new Array(len).fill(null);
        arr.push(v);
        if (arr.length > len) arr.shift();
      }
    }
    if (pk.pr) lastProcs = rebuild(pk.pr, pk.pf, procMeta);
    if (s.sys) lastSys = s.sys;
    const out = { ...s, sys: lastSys, procs: lastProcs, procsLive: !!pk.pr, groups: rebuild(pk.gr, pk.gf, groupMeta), hist: hist || {} };
    delete out.packed;
    delete out.histTail;
    return out;
  }

  /** A new connection starts from a full snapshot (the server may even have restarted). */
  function resetStream() {
    procMeta.clear();
    groupMeta.clear();
    hist = null;
    lastProcs = [];
    lastSys = null;
  }

  function dispatch(block) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data.push(line.slice(6));
    }
    if (!data.length) return;
    let payload;
    try {
      payload = JSON.parse(unmask(data.join('\n')));
    } catch {
      return;
    }
    if (event === 'snapshot') {
      // Before the first full snapshot of a connection, deltas can't be applied.
      if (!payload.hist && !hist) return;
      payload = unpack(payload);
    }
    emit(event, payload);
  }

  // ---------- live event stream ----------
  // Server-sent events over fetch (EventSource can't send the token header). When the stream
  // drops, try again after 1, 2 and 3 s, then every 5 s for as long as it takes. "Retry now",
  // the window coming back into view and the network coming back all retry at once.
  const RETRY_DELAYS = [1000, 2000, 3000];
  const RETRY_MS = 5000;
  const CONNECT_TIMEOUT = 10000;
  const STALL_MS = 30000; // the server sends something at least every 10 s
  let connected = null;
  let failures = 0;
  let lastData = 0;
  let open = null; // AbortController of the current attempt or stream
  let attemptAt = 0; // when the current attempt started; 0 once the stream is up
  let retryDue = 0;
  let wake = null; // ends the current wait early

  function setConnected(v) {
    if (connected === v) return;
    connected = v;
    emit('connection', v);
  }

  // A hidden window's timers can be slowed to once a minute, a worker's can't: the worker's 1 s
  // tick drives retries, the connect timeout and the stall watchdog. Page timers are the fallback.
  function tick() {
    const now = Date.now();
    if (open && attemptAt && now - attemptAt > CONNECT_TIMEOUT) open.abort();
    // A connection can die without an error (sleep, a frozen server): notice the silence.
    if (open && connected && now - lastData > STALL_MS) open.abort();
    if (wake && now >= retryDue) wake();
  }
  let fallbackTimer = null;
  const useFallbackTimer = () => {
    if (!fallbackTimer) fallbackTimer = setInterval(tick, 1000);
  };
  try {
    const ticker = new Worker('js/ticker.js');
    ticker.onmessage = tick;
    ticker.onerror = useFallbackTimer;
  } catch {
    useFallbackTimer();
  }

  function pause(ms) {
    retryDue = Date.now() + ms;
    return new Promise((resolve) => {
      const done = () => {
        if (wake !== done) return;
        wake = null;
        clearTimeout(backstop);
        resolve();
      };
      const backstop = setTimeout(done, ms + 1000); // in case the worker never ticks
      wake = done;
    });
  }

  async function stream() {
    for (;;) {
      const ctrl = new AbortController();
      open = ctrl;
      attemptAt = Date.now();
      emit('retry', { at: 0, failures });
      try {
        if (!booted) await boot(ctrl.signal);
        const res = await fetch('/api/events', {
          headers: { 'X-SysLens-Token': token, 'X-SysLens-Page': PAGE_ID },
          cache: 'no-store',
          signal: ctrl.signal,
        });
        attemptAt = 0;
        if (res.status === 403) emit('auth-failed', true);
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
        resetStream();
        failures = 0;
        lastData = Date.now();
        setConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          lastData = Date.now();
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            dispatch(buf.slice(0, idx));
            buf = buf.slice(idx + 2);
          }
        }
      } catch {
        /* retried below */
      }
      attemptAt = 0;
      ctrl.abort();
      open = null;
      setConnected(false);
      const delay = failures < RETRY_DELAYS.length ? RETRY_DELAYS[failures] : RETRY_MS;
      failures++;
      emit('retry', { at: Date.now() + delay, failures });
      await pause(delay);
    }
  }

  /** Check the connection now: retry at once if it is down, drop it if it has gone quiet. */
  function checkNow() {
    if (open && connected && Date.now() - lastData > 15000) open.abort();
    if (wake) wake();
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkNow();
  });
  window.addEventListener('focus', checkNow);
  window.addEventListener('online', checkNow);
  window.addEventListener('pageshow', checkNow);

  // Tell the server this window is closing or reloading, so it isn't taken for a lost connection.
  window.addEventListener('pagehide', () => {
    fetch('/api/bye', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-SysLens-Token': token, 'X-SysLens-Page': PAGE_ID },
      body: '{}',
    }).catch(() => {});
  });

  // Settings and the names "Hide personal info" masks come first, before any data: nothing is
  // ever shown unmasked. ?privacy=1 (used for README screenshots) forces masking on.
  const forcedPrivacy = new URLSearchParams(location.search).get('privacy') === '1';
  let booted = null;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  /** First contact: settings and names to mask. Retried by the stream loop until it works. */
  async function boot(signal) {
    const res = await fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SysLens-Token': token },
      body: JSON.stringify({ channel: 'app:boot', args: [] }),
      cache: 'no-store',
      signal,
    });
    if (res.status === 403) emit('auth-failed', true);
    if (!res.ok) throw new Error(`boot ${res.status}`);
    const text = await res.text();
    const raw = JSON.parse(text);
    if (raw.settings.privacy || forcedPrivacy) setPrivacy(true, { user: raw.info.user, host: raw.info.host });
    // The boot answer itself (folder paths, names) gets the same masking as everything else.
    booted = JSON.parse(unmask(text));
    resolveReady(booted);
  }

  window.syslens = {
    ready,
    token: () => token,
    onSnapshot: (cb) => on('snapshot', cb),
    onConnection: (cb) => on('connection', cb),
    onRetry: (cb) => on('retry', cb),
    onAuthFailed: (cb) => on('auth-failed', cb),
    onHandoff: (cb) => on('handoff', cb),
    reconnect: () => checkNow(),
    privacyActive: () => masks.length > 0,
    snapshot: () => invoke('snapshot'),
    machine: (refresh) => invoke('machine:get', !!refresh),
    connections: (opts) => invoke('net:connections', opts || {}),
    adapters: (refresh) => invoke('net:adapters', !!refresh),
    services: (refresh) => invoke('services:list', !!refresh),
    serviceControl: (name, action) => invoke('svc:control', name, action),
    serviceStartType: (name, type) => invoke('svc:startType', name, type),
    startup: (refresh) => invoke('startup:list', !!refresh),
    startupToggle: (id, on) => invoke('startup:toggle', id, !!on),
    history: (refresh) => invoke('history:get', !!refresh),
    openLog: () => invoke('app:openLog'),
    openData: () => invoke('app:openData'),
    changelog: () => invoke('app:changelog'),
    setHotkey: (combo) => invoke('app:hotkey', combo),
    setInterval: (ms) => invoke('interval', ms),
    setVisible: (visible) => invoke('app:visible', visible),
    need: (what) => invoke('app:need', what),
    details: (pid) => invoke('proc:details', pid),
    kill: (targets) => invoke('proc:kill', targets),
    killTree: (targets) => invoke('proc:killTree', targets),
    priority: (targets, level) => invoke('proc:priority', targets, level),
    efficiency: (targets, on) => invoke('proc:efficiency', targets, !!on),
    suspend: (targets, on) => invoke('proc:suspend', targets, !!on),
    switchTo: (pids) => invoke('proc:switchTo', pids),
    restartExplorer: () => invoke('proc:restartExplorer'),
    runTask: (command, admin) => invoke('task:run', command, !!admin),
    icon: (path) => invoke('icon', path),
    showItem: (path) => invoke('shell:showItem', path),
    openFolder: (path) => invoke('shell:openFolder', path),
    openSettings: (page) => invoke('shell:settings', page),
    search: (text) => invoke('shell:search', text),
    info: () => invoke('app:info'),
    elevate: () => invoke('app:elevate'),
    settings: {
      get: () => invoke('settings:get'),
      set: (patch) => invoke('settings:set', patch),
      reset: () => invoke('settings:reset'),
      background: (dataUrl) => invoke('settings:background', dataUrl),
    },
    storage: {
      drives: () => invoke('storage:drives'),
      state: () => invoke('storage:state'),
      scan: (root) => invoke('storage:scan', root),
      cancel: () => invoke('storage:cancel'),
      children: (path) => invoke('storage:children', path),
      top: () => invoke('storage:top'),
      types: () => invoke('storage:types'),
      apps: (refresh) => invoke('storage:apps', refresh),
      hogs: (refresh) => invoke('storage:hogs', refresh),
      pickFolder: () => invoke('storage:pickFolder'),
      onProgress: (cb) => on('storage:progress', cb),
      onDone: (cb) => on('storage:done', cb),
      onApps: (cb) => on('storage:apps', cb),
      onHogs: (cb) => on('storage:hogs', cb),
    },
  };

  stream();
})();
