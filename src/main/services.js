'use strict';
// Windows services: name, state, start type, the process hosting each one, the account it
// runs as, and who made it. Read with one CIM query and cached briefly.

const path = require('path');
const w = require('./win32');
const { runPowerShellJson } = require('./powershell');

const SYSTEM_ROOT = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();

const SCRIPT = `
@(Get-CimInstance Win32_Service | ForEach-Object {
  [pscustomobject]@{ n = [string]$_.Name; d = [string]$_.DisplayName; s = [string]$_.State; m = [string]$_.StartMode; dl = [bool]$_.DelayedAutoStart; p = [int]$_.ProcessId; c = [string]$_.PathName; a = [string]$_.StartName; ds = [string]$_.Description; t = [string]$_.ServiceType }
}) | ConvertTo-Json -Compress
`;

const ACCOUNTS = {
  localsystem: 'Local System',
  'nt authority\\localservice': 'Local Service',
  'nt authority\\networkservice': 'Network Service',
  'nt authority\\system': 'Local System',
};

/** The executable a service command line runs, with environment variables expanded. */
function exeOf(cmd) {
  if (!cmd) return null;
  let s = cmd.trim();
  let exe;
  if (s.startsWith('"')) exe = s.slice(1, s.indexOf('"', 1) > 0 ? s.indexOf('"', 1) : undefined);
  else {
    const m = /^(.+?\.exe)(\s|$)/i.exec(s);
    exe = m ? m[1] : s.split(' ')[0];
  }
  exe = exe.replace(/%([^%]+)%/g, (all, name) => process.env[name] || all);
  if (/^\\SystemRoot\\/i.test(exe)) exe = path.join(process.env.SystemRoot || 'C:\\Windows', exe.slice(12));
  if (/^system32\\/i.test(exe)) exe = path.join(process.env.SystemRoot || 'C:\\Windows', exe);
  if (exe.startsWith('\\??\\')) exe = exe.slice(4);
  return exe;
}

class ServicesService {
  constructor() {
    this.cache = null;
    this.at = 0;
    this.loading = null;
    this.companies = new Map();
  }

  company(exe) {
    if (!exe) return '';
    const k = exe.toLowerCase();
    if (!this.companies.has(k)) {
      const info = w.fileVersionInfo(exe);
      this.companies.set(k, (info && info.company) || '');
    }
    return this.companies.get(k);
  }

  async list(refresh = false) {
    if (!refresh && this.cache && Date.now() - this.at < 15000) return this.cache;
    if (!this.loading) {
      this.loading = runPowerShellJson(SCRIPT, 60000)
        .then((raw) => {
          const items = [].concat(raw || []).map((s) => {
            const exe = exeOf(s.c);
            const lower = (exe || '').toLowerCase();
            // Drivers' services often live in System32 too (AMD, Realtek…): go by the file's publisher.
            const company = this.company(exe);
            const isWindows = company ? /microsoft/i.test(company) : lower.startsWith(SYSTEM_ROOT);
            const group = /svchost\.exe/i.test(lower) ? (/\s-k\s+(\S+)/i.exec(s.c) || [])[1] || '' : '';
            const startType = s.m === 'Auto' ? (s.dl ? 'Automatic (delayed)' : 'Automatic') : s.m === 'Manual' ? 'Manual' : s.m === 'Disabled' ? 'Disabled' : s.m || '';
            return {
              name: s.n,
              display: s.d || s.n,
              state: s.s,
              running: s.s === 'Running',
              startType,
              auto: s.m === 'Auto',
              pid: s.p || 0,
              command: s.c || '',
              exe,
              group,
              account: ACCOUNTS[(s.a || '').toLowerCase()] || s.a || '',
              description: s.ds || '',
              driver: /driver/i.test(s.t || ''),
              isWindows,
              company: company || (isWindows ? 'Microsoft Corporation' : ''),
            };
          });
          items.sort((a, b) => a.display.localeCompare(b.display));
          this.cache = { list: items, at: Date.now() };
          this.at = Date.now();
          return this.cache;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }
}

module.exports = { ServicesService, exeOf };
