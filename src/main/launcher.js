'use strict';
// Starts the SysLens server and keeps it running. If the server crashes or stops responding,
// the launcher starts it again on the same port with the same token, so an open SysLens window
// reconnects by itself. When the server quits normally (its window was closed), so does this.
//
//   node src/main/launcher.js [--debug] [...]   flags are passed on to server.js

const { fork } = require('child_process');
const path = require('path');
const { createLogger } = require('./log');

const SERVER = path.join(__dirname, 'server.js');
const ARGS = process.argv.slice(2);
const KEEP_ON_RESTART = /^--(debug|no-window|keep-alive)$/;
const MAX_RESTARTS = 5; // within RESTART_WINDOW; past that, something is badly wrong
const RESTART_WINDOW = 3 * 60 * 1000;
const HANG_LIMIT = 60 * 1000; // no heartbeat for this long = the server is stuck
const CHECK_MS = 5000;

const log = createLogger('launcher', { echo: ARGS.includes('--debug') });

let child = null;
let state = null; // { port, token } once the server is listening
let lastBeat = Date.now();
let lastCheck = Date.now();
let stopping = false;
const restarts = [];

function start() {
  const env = { ...process.env };
  let args = ARGS;
  if (state) {
    // A restart: same port and token, so the window that is already open can reconnect.
    env.SYSLENS_TOKEN = state.token;
    args = ['--restarted', `--port=${state.port}`, ...ARGS.filter((a) => KEEP_ON_RESTART.test(a))];
  }
  child = fork(SERVER, args, { env, stdio: 'inherit' });
  lastBeat = Date.now();
  child.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    lastBeat = Date.now();
    if (m.type === 'ready' && Number.isInteger(m.port) && typeof m.token === 'string') state = { port: m.port, token: m.token };
  });
  child.on('error', (err) => log('server process error:', err));
  child.on('exit', onExit);
}

function onExit(code, signal) {
  child = null;
  if (stopping || code === 0) process.exit(0);
  const shown = code == null ? signal : code > 255 ? `0x${(code >>> 0).toString(16).toUpperCase()}` : code;
  log(`server stopped unexpectedly (exit code ${shown})`);
  const now = Date.now();
  while (restarts.length && now - restarts[0] > RESTART_WINDOW) restarts.shift();
  if (restarts.length >= MAX_RESTARTS) {
    log(`server failed ${restarts.length + 1} times in a few minutes; giving up`);
    process.exit(1);
  }
  restarts.push(now);
  log('restarting the server');
  setTimeout(start, 1000);
}

setInterval(() => {
  const now = Date.now();
  // A long gap between checks means the PC was asleep: that is not a hang.
  if (now - lastCheck > CHECK_MS * 3) lastBeat = now;
  lastCheck = now;
  if (child && state && now - lastBeat > HANG_LIMIT) {
    log(`server has not responded for ${Math.round((now - lastBeat) / 1000)} s; restarting it`);
    lastBeat = now;
    child.kill(); // reported as an unexpected exit, which restarts it
  }
}, CHECK_MS);

function stop() {
  if (stopping) return;
  stopping = true;
  if (!child) process.exit(0);
  try {
    child.send({ type: 'stop' });
  } catch {
    /* already gone */
  }
  setTimeout(() => {
    if (child) child.kill();
    process.exit(0);
  }, 3000).unref();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop);
process.on('uncaughtException', (err) => {
  log('launcher crashed:', err);
  process.exit(1);
});

start();
