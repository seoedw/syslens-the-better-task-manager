'use strict';
// Run a PowerShell script once and parse its JSON output. Used only for slow-changing data
// (hardware inventory, installed apps) — never on the sampling hot path.

const { execFile } = require('child_process');

function runPowerShellJson(script, timeoutMs = 60000) {
  const prelude = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ErrorActionPreference = 'SilentlyContinue'; $ProgressPreference = 'SilentlyContinue';\n";
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', prelude + script],
      { windowsHide: true, maxBuffer: 128 * 1024 * 1024, timeout: timeoutMs, encoding: 'utf8' },
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

module.exports = { runPowerShellJson };
