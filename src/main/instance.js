'use strict';
// The running SysLens, if any: %LOCALAPPDATA%\SysLens\instance.json says where it listens.
// Opening SysLens again (the shortcut, its keyboard shortcut, Start menu) just brings the open
// window to the front, or opens a new window on the running instance, instead of starting
// a second copy. Kept tiny so the launcher can do this in a fraction of a second.

const fs = require('fs');
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
async function showExisting() {
  const info = readInstance();
  if (!info || !Number.isInteger(info.port) || info.port <= 0 || info.port > 65535) return false;
  try {
    // The custom header keeps web pages from triggering this (they can't send it without
    // a CORS preflight, which SysLens never approves).
    const r = await fetch(`http://127.0.0.1:${info.port}/api/focus`, {
      method: 'POST',
      headers: { 'X-SysLens-Focus': '1' },
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j && j.app === 'syslens' && j.ok);
  } catch {
    return false;
  }
}

module.exports = { INSTANCE_FILE, readInstance, showExisting };
