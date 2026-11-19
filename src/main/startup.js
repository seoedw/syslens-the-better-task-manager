'use strict';
// What starts with Windows: Run keys, Startup folders, Store apps' startup tasks and scheduled
// tasks that run at logon or boot, with the enabled/disabled state Windows keeps for each
// (the same switches as Settings > Apps > Startup).

const path = require('path');
const w = require('./win32');
const { runPowerShellJson } = require('./powershell');
const { exeOf } = require('./services');
const { friendlyStoreName } = require('./storage');

const SCRIPT = `
$out = [ordered]@{ run = @(); folder = @(); packaged = @(); tasks = @() }
function Approved($key, $name) {
  try { $v = (Get-ItemProperty -LiteralPath $key -Name $name -ErrorAction Stop).$name; if ($v -and $v.Length -ge 1) { return [int]$v[0] } } catch {}
  return -1
}
$runKeys = @(
  @{ hive = 'user'; path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; approved = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' },
  @{ hive = 'machine'; path = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; approved = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' },
  @{ hive = 'machine32'; path = 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; approved = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32' }
)
foreach ($k in $runKeys) {
  $p = Get-ItemProperty -LiteralPath $k.path -ErrorAction SilentlyContinue
  if (-not $p) { continue }
  foreach ($prop in $p.PSObject.Properties) {
    if ($prop.Name -match '^PS(Path|ParentPath|ChildName|Drive|Provider)$') { continue }
    $out.run += [pscustomobject]@{ name = [string]$prop.Name; cmd = [string]$prop.Value; hive = $k.hive; state = (Approved $k.approved $prop.Name) }
  }
}
$sh = New-Object -ComObject WScript.Shell
$folders = @(
  @{ scope = 'user'; dir = [Environment]::GetFolderPath('Startup'); approved = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder' },
  @{ scope = 'all users'; dir = [Environment]::GetFolderPath('CommonStartup'); approved = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder' }
)
foreach ($f in $folders) {
  if (-not $f.dir -or -not (Test-Path -LiteralPath $f.dir)) { continue }
  Get-ChildItem -LiteralPath $f.dir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object {
    $target = ''; $targs = ''
    if ($_.Extension -eq '.lnk') { try { $l = $sh.CreateShortcut($_.FullName); $target = [string]$l.TargetPath; $targs = [string]$l.Arguments } catch {} }
    $out.folder += [pscustomobject]@{ name = $_.BaseName; file = $_.FullName; target = $target; args = $targs; scope = $f.scope; state = (Approved $f.approved $_.Name) }
  }
}
$base = 'HKCU:\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\SystemAppData'
Get-ChildItem -LiteralPath $base -ErrorAction SilentlyContinue | ForEach-Object {
  $pkg = $_.PSChildName
  Get-ChildItem -LiteralPath $_.PSPath -ErrorAction SilentlyContinue | ForEach-Object {
    $st = (Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue).State
    if ($null -ne $st) { $out.packaged += [pscustomobject]@{ pkg = $pkg; task = $_.PSChildName; state = [int]$st } }
  }
}
try {
  Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskPath -notlike '\\Microsoft\\*' } | ForEach-Object {
    $t = $_
    $trig = @($t.Triggers | ForEach-Object { $_.CimClass.CimClassName })
    $kind = if ($trig -match 'Logon') { 'logon' } elseif ($trig -match 'Boot') { 'boot' } else { $null }
    if ($kind) {
      $a = @($t.Actions | Where-Object { $_.Execute } | Select-Object -First 1)
      $out.tasks += [pscustomobject]@{ name = [string]$t.TaskName; folder = [string]$t.TaskPath; exe = [string]$a.Execute; args = [string]$a.Arguments; state = [string]$t.State; trigger = $kind; author = [string]$t.Author }
    }
  }
} catch {}
$out | ConvertTo-Json -Depth 4 -Compress
`;

const expand = (s) => (s || '').replace(/%([^%]+)%/g, (all, name) => process.env[name] || all);

// Turning an entry on or off the way Task Manager and Settings do: a StartupApproved flag for
// Run keys and Startup folders (first byte 2 = on, 3 = off, then when it was turned off), the
// State value for Store apps (2 = on, 1 = off by the user), or the scheduled task itself.
const TOGGLE = `
$kind = $env:SL_KIND; $on = $env:SL_ON -eq '1'
try {
  if ($kind -eq 'approved') {
    $key = $env:SL_KEY
    if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force -ErrorAction Stop | Out-Null }
    $bytes = New-Object byte[] 12
    if ($on) { $bytes[0] = 2 } else { $bytes[0] = 3; [BitConverter]::GetBytes([DateTime]::UtcNow.ToFileTimeUtc()).CopyTo($bytes, 4) }
    New-ItemProperty -LiteralPath $key -Name $env:SL_NAME -PropertyType Binary -Value $bytes -Force -ErrorAction Stop | Out-Null
  } elseif ($kind -eq 'pkg') {
    Set-ItemProperty -LiteralPath $env:SL_KEY -Name State -Value $(if ($on) { 2 } else { 1 }) -Type DWord -ErrorAction Stop
  } elseif ($kind -eq 'task') {
    $t = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskPath -eq $env:SL_TPATH -and $_.TaskName -eq $env:SL_NAME })
    if (-not $t.Count) { throw 'That scheduled task no longer exists.' }
    if ($on) { $t | Enable-ScheduledTask -ErrorAction Stop | Out-Null } else { $t | Disable-ScheduledTask -ErrorAction Stop | Out-Null }
  }
  ConvertTo-Json -Compress @{ ok = $true }
} catch { ConvertTo-Json -Compress @{ ok = $false; error = [string]$_.Exception.Message } }
`;
const APPROVED = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';
const APPROVED_KEYS = {
  user: `HKCU:\\${APPROVED}\\Run`,
  machine: `HKLM:\\${APPROVED}\\Run`,
  machine32: `HKLM:\\${APPROVED}\\Run32`,
  'folder:user': `HKCU:\\${APPROVED}\\StartupFolder`,
  'folder:all users': `HKLM:\\${APPROVED}\\StartupFolder`,
};
const PKG_BASE = 'HKCU:\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\SystemAppData';

class StartupService {
  constructor() {
    this.cache = null;
    this.loading = null;
    this.info = new Map();
  }

  fileInfo(exe) {
    if (!exe) return null;
    const k = exe.toLowerCase();
    if (!this.info.has(k)) this.info.set(k, w.fileVersionInfo(exe));
    return this.info.get(k);
  }

  item(base) {
    const info = this.fileInfo(base.exe);
    return {
      ...base,
      publisher: (info && info.company) || base.publisher || '',
      description: (info && info.description) || '',
    };
  }

  async list(refresh = false) {
    if (!refresh && this.cache && Date.now() - this.cache.at < 30000) return this.cache;
    if (!this.loading) {
      this.loading = runPowerShellJson(SCRIPT, 90000)
        .then((raw) => {
          raw = raw || {};
          const items = [];
          // StartupApproved: odd first byte = disabled; missing = enabled.
          const approved = (state) => state < 0 || (state & 1) === 0;
          for (const r of [].concat(raw.run || [])) {
            items.push(
              this.item({
                id: `run:${r.hive}:${r.name}`,
                name: r.name,
                kind: 'Registry',
                where: r.hive === 'user' ? 'Run key (this user)' : r.hive === 'machine32' ? 'Run key (all users, 32-bit)' : 'Run key (all users)',
                command: r.cmd,
                exe: exeOf(expand(r.cmd)),
                enabled: approved(r.state),
                machine: r.hive !== 'user',
                toggle: { kind: 'approved', key: APPROVED_KEYS[r.hive], name: r.name },
              }),
            );
          }
          for (const f of [].concat(raw.folder || [])) {
            const target = expand(f.target);
            items.push(
              this.item({
                id: `folder:${f.file}`,
                name: f.name,
                kind: 'Startup folder',
                where: `Startup folder (${f.scope})`,
                command: target ? `${target}${f.args ? ` ${f.args}` : ''}` : f.file,
                exe: target && /\.exe$/i.test(target) ? target : null,
                file: f.file,
                enabled: approved(f.state),
                machine: f.scope !== 'user',
                toggle: { kind: 'approved', key: APPROVED_KEYS[`folder:${f.scope}`], name: path.basename(f.file) },
              }),
            );
          }
          for (const p of [].concat(raw.packaged || [])) {
            const name = friendlyStoreName(p.pkg.replace(/_[a-z0-9]{13}$/i, ''));
            items.push({
              id: `pkg:${p.pkg}:${p.task}`,
              name,
              kind: 'Store app',
              where: 'Store app startup task',
              command: `${p.pkg} › ${p.task}`,
              exe: null,
              pkg: p.pkg.replace(/_[a-z0-9]{13}$/i, ''),
              enabled: p.state === 2 || p.state === 4,
              publisher: '',
              description: '',
              policy: p.state === 3 || p.state === 4,
              toggle: p.state === 3 || p.state === 4 ? null : { kind: 'pkg', key: `${PKG_BASE}\\${p.pkg}\\${p.task}` },
            });
          }
          for (const t of [].concat(raw.tasks || [])) {
            const exe = expand(t.exe).replace(/^"|"$/g, '');
            items.push(
              this.item({
                id: `task:${t.folder}${t.name}`,
                name: t.name,
                kind: 'Scheduled task',
                where: `Scheduled task, ${t.trigger === 'boot' ? 'at startup' : 'at sign-in'}${t.folder && t.folder !== '\\' ? ` (${t.folder})` : ''}`,
                command: `${exe}${t.args ? ` ${t.args}` : ''}`,
                exe: path.isAbsolute(exe) ? exe : null,
                enabled: t.state !== 'Disabled',
                publisher: t.author || '',
                toggle: { kind: 'task', tpath: t.folder, name: t.name },
              }),
            );
          }
          items.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
          this.cache = { list: items, at: Date.now() };
          return this.cache;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  /** Turn one entry on or off. Only entries from the current list can be changed. */
  async setEnabled(id, on) {
    if (typeof id !== 'string') return { ok: false, error: 'Unknown entry' };
    const data = await this.list(false);
    const item = data.list.find((x) => x.id === id);
    if (!item) return { ok: false, error: 'That entry no longer exists' };
    if (!item.toggle) return { ok: false, error: item.policy ? 'Set by your organization’s policy' : 'Can’t be changed here' };
    const t = item.toggle;
    const vars = { SL_KIND: t.kind, SL_ON: on ? '1' : '0', SL_KEY: t.key || '', SL_NAME: t.name || '', SL_TPATH: t.tpath || '' };
    const r = await runPowerShellJson(TOGGLE, 60000, vars);
    this.cache = null; // re-read on the next request
    if (!r) return { ok: false, error: 'Windows didn’t answer' };
    if (r.ok) return { ok: true };
    const denied = /not allowed|denied|unauthorized/i.test(r.error || '');
    return { ok: false, error: denied ? 'Needs administrator rights' : String(r.error || 'Windows refused').trim() };
  }
}

module.exports = { StartupService };
