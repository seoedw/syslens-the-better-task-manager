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

const INSTANCE_FILE = path.join(DATA_DIR, 'instance.json');

function readInstance() {
  try {
    return JSON.parse(fs.readFileSync(INSTANCE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** True when a running SysLens took care of showing its window. */
function showExisting() {
  const info = readInstance();
  if (!info || !Number.isInteger(info.port) || info.port <= 0 || info.port > 65535) return Promise.resolve(false);
  return new Promise((resolve) => {
    // The custom header keeps web pages from triggering this (they can't send it without
    // a CORS preflight, which SysLens never approves).
    const req = http.request(
      { host: '127.0.0.1', port: info.port, path: '/api/focus', method: 'POST', headers: { 'X-SysLens-Focus': '1', 'Content-Length': 0 }, timeout: 2500 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          if (body.length < 4096) body += c;
        });
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            resolve(res.statusCode === 200 && !!(j && j.app === 'syslens' && j.ok));
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

module.exports = { INSTANCE_FILE, readInstance, showExisting };
