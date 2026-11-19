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

  async function invoke(channel, ...args) {
    const res = await fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SysLens-Token': token },
      body: JSON.stringify({ channel, args }),
      cache: 'no-store',
    });
    if (res.status === 403) emit('auth-failed', true);
    if (!res.ok) throw new Error(`${channel} failed (${res.status})`);
    return res.json();
  }

  // Reassemble the compact snapshot stream (see packSnapshot in server.js).
  const procMeta = new Map();
  const groupMeta = new Map();
  let hist = null;

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
    const out = { ...s, procs: rebuild(pk.pr, pk.pf, procMeta), groups: rebuild(pk.gr, pk.gf, groupMeta), hist: hist || {} };
    delete out.packed;
    delete out.histTail;
    return out;
  }

  /** A new connection starts from a full snapshot (the server may even have restarted). */
  function resetStream() {
    procMeta.clear();
    groupMeta.clear();
    hist = null;
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
      payload = JSON.parse(data.join('\n'));
    } catch {
      return;
    }
    if (event === 'snapshot') {
      // Before the first full snapshot of a connection, deltas can't be applied.
      if (!payload.hist && !hist) return;
      payload = unpack(payload);
    }
    if (event === 'handoff' && payload && payload.token) {
      // An administrator instance is taking over: switch tokens and reconnect.
      token = payload.token;
      try {
        sessionStorage.setItem(KEY, token);
      } catch {
        /* ignore */
      }
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

  const media = matchMedia('(prefers-color-scheme: dark)');
  let themeSource = 'system';
  const effectiveTheme = () => (themeSource === 'system' ? (media.matches ? 'dark' : 'light') : themeSource);
  media.addEventListener('change', () => emit('theme', effectiveTheme()));

  window.syslens = {
    onSnapshot: (cb) => on('snapshot', cb),
    onTheme: (cb) => on('theme', cb),
    onConnection: (cb) => on('connection', cb),
    onRetry: (cb) => on('retry', cb),
    onAuthFailed: (cb) => on('auth-failed', cb),
    onHandoff: (cb) => on('handoff', cb),
    reconnect: () => checkNow(),
    snapshot: () => invoke('snapshot'),
    setInterval: (ms) => invoke('interval', ms),
    setVisible: (visible) => invoke('app:visible', visible),
    details: (pid) => invoke('proc:details', pid),
    kill: (targets) => invoke('proc:kill', targets),
    icon: (path) => invoke('icon', path),
    showItem: (path) => invoke('shell:showItem', path),
    openFolder: (path) => invoke('shell:openFolder', path),
    openSettings: (page) => invoke('shell:settings', page),
    info: () => invoke('app:info'),
    elevate: () => invoke('app:elevate'),
    setTheme: async (source) => {
      themeSource = source;
      return effectiveTheme();
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
