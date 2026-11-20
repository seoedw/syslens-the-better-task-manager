'use strict';
// The running SysLens, if any: %LOCALAPPDATA%\SysLens\instance.json says where it listens.
// Opening SysLens again (the shortcut, its keyboard shortcut, Start menu) just brings the open
// window to the front, or opens a new window on the running instance, instead of starting
// a second copy. Kept tiny so the launcher can do this in a fraction of a second.
//
// Uses the http module rather than fetch: the launcher runs --jitless, which turns off
// WebAssembly, and fetch's HTTP parser is WebAssembly.

const fs = require('fs');
const http = require('http');
const path = require('path');
const { DATA_DIR } = require('./log');
const { version } = require('../../package.json');

const INSTANCE_FILE = path.join(DATA_DIR, 'instance.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readInstance() {
  try {
    return JSON.parse(fs.readFileSync(INSTANCE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** Ask the running SysLens to show its window. Resolves with its answer, or null. */
function askToShow(port) {
  return new Promise((resolve) => {
    // The custom header keeps web pages from triggering this (they can't send it without
    // a CORS preflight, which SysLens never approves). The version lets an older copy, or one
    // whose window was just closed, step aside for this one instead of reopening.
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/focus', method: 'POST', headers: { 'X-SysLens-Focus': '1', 'X-SysLens-Version': version, 'Content-Length': 0 }, timeout: 2500 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          if (body.length < 4096) body += c;
        });
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            resolve(res.statusCode === 200 && j && j.app === 'syslens' ? j : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

/**
 * True when a running SysLens took care of showing its window. False when there's none, or when
 * it stepped aside (an older version, or its window was just closed): then it has gone by the
 * time this resolves, and the caller starts a fresh SysLens.
 */
async function showExisting() {
  const info = readInstance();
  if (!info || !Number.isInteger(info.port) || info.port <= 0 || info.port > 65535) return false;
  const answer = await askToShow(info.port);
  if (!answer) return false;
  if (answer.ok) return true;
  if (answer.steppingAside) {
    // It removes its instance file first and quits a moment later: wait for that, briefly.
    for (let i = 0; i < 40; i++) {
      const now = readInstance();
      if (!now || now.pid !== info.pid) break;
      await sleep(100);
    }
    await sleep(700); // and for it to let go of its port
  }
  return false;
}

module.exports = { INSTANCE_FILE, readInstance, showExisting };
