'use strict';
// A small append-only log at %LOCALAPPDATA%\SysLens\syslens.log (rotated at 1 MB), so problems
// such as a lost connection can be looked into after the fact.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { inspect } = require('util');

const DATA_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'SysLens');
const LOG_FILE = path.join(DATA_DIR, 'syslens.log');
const MAX_SIZE = 1024 * 1024;

const stamp = () => new Date().toLocaleString('sv-SE'); // local time, e.g. 2026-11-18 18:27:10

function format(part) {
  if (part instanceof Error) return part.stack || part.message;
  if (typeof part === 'string') return part;
  return inspect(part, { depth: 3, breakLength: Infinity });
}

/** Returns log(...parts). `echo` also prints each line to the console. */
function createLogger(tag, { echo = false } = {}) {
  let dirReady = false;
  return (...parts) => {
    const line = `${stamp()} ${tag}[${process.pid}] ${parts.map(format).join(' ')}\n`;
    if (echo) process.stdout.write(line);
    try {
      if (!dirReady) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        dirReady = true;
      }
      try {
        if (fs.statSync(LOG_FILE).size > MAX_SIZE) fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
      } catch {
        /* no log yet */
      }
      fs.appendFileSync(LOG_FILE, line);
    } catch {
      /* logging must never break SysLens */
    }
  };
}

module.exports = { createLogger, DATA_DIR, LOG_FILE };
