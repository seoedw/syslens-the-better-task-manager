'use strict';
// Run a PowerShell script once and parse its JSON output. Used only for slow-changing data
// (hardware inventory, installed apps) and one-off actions, never on the sampling hot path.
// Values from the page are handed over in environment variables, never pasted into the script.

const { execFile } = require('child_process');

function runPowerShellJson(script, timeoutMs = 60000, vars = null) {
  const prelude = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ErrorActionPreference = 'SilentlyContinue'; $ProgressPreference = 'SilentlyContinue';\n";
  const env = vars ? { ...process.env, ...vars } : undefined;
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', prelude + script],
      { windowsHide: true, maxBuffer: 128 * 1024 * 1024, timeout: timeoutMs, encoding: 'utf8', env },
      (err, stdout) => {
        const text = (stdout || '').trim().replace(/^﻿/, '');
        if (!text) return resolve(null);
        try {
          resolve(JSON.parse(text));
        } catch {
          resolve(null);
        }
      },
    );
  });
}

/** Run a program (no shell) and resolve with its exit code and output. */
function run(file, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout || ''}${stderr || ''}`.trim() });
    });
  });
}

module.exports = { runPowerShellJson, run };
