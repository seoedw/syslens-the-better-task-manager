'use strict';
// What happened on this PC, from the Windows event logs: start-ups and shut-downs, sleep and
// wake (with the wake source), standby, power source changes, app crashes and hangs, blue
// screens, crashed services, Windows updates and installs. Also rebuilds an on / sleep / off
// timeline for the chart on the History page.

const { runPowerShellJson } = require('./powershell');

const DAYS = 7;

const SCRIPT = (days) => `
$since = (Get-Date).AddDays(-${days})
$want = @{
  'Microsoft-Windows-Kernel-General' = @(12, 13)
  'Microsoft-Windows-Kernel-Power' = @(41, 42, 105, 506, 507)
  'Microsoft-Windows-Power-Troubleshooter' = @(1)
  'User32' = @(1074)
  'EventLog' = @(6008)
  'Microsoft-Windows-WindowsUpdateClient' = @(19, 20)
  'Service Control Manager' = @(7031, 7034)
  'Microsoft-Windows-WER-SystemErrorReporting' = @(1001)
  'Application Error' = @(1000)
  'Application Hang' = @(1002)
  'MsiInstaller' = @(11707, 11724)
}
$events = @()
$events += @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = $since; ProviderName = @('Microsoft-Windows-Kernel-General','Microsoft-Windows-Kernel-Power','Microsoft-Windows-Power-Troubleshooter','User32','EventLog','Microsoft-Windows-WindowsUpdateClient','Service Control Manager','Microsoft-Windows-WER-SystemErrorReporting') } -MaxEvents 6000 -ErrorAction SilentlyContinue)
$events += @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $since; ProviderName = @('Application Error','Application Hang','MsiInstaller') } -MaxEvents 3000 -ErrorAction SilentlyContinue)
@($events | Where-Object { $want[$_.ProviderName] -contains $_.Id } | ForEach-Object {
  $e = $_
  $ws = ''
  if ($e.ProviderName -eq 'Microsoft-Windows-Power-Troubleshooter') { try { if ($e.Message -match 'Wake Source:\\s*(.+)') { $ws = $Matches[1].Trim() } } catch {} }
  if ($e.ProviderName -eq 'Microsoft-Windows-Kernel-Power' -and $e.Id -eq 42) { try { if ($e.Message -match 'Sleep Reason:\\s*(.+)') { $ws = $Matches[1].Trim() } } catch {} }
  [pscustomobject]@{
    t = [int64](($e.TimeCreated.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds)
    p = $e.ProviderName
    i = $e.Id
    v = @($e.Properties | Select-Object -First 14 | ForEach-Object { $x = $_.Value; if ($x -is [datetime]) { $x.ToUniversalTime().ToString('o') } else { $s = [string]$x; if ($s.Length -gt 300) { $s.Substring(0, 300) } else { $s } } })
    w = $ws
  }
}) | ConvertTo-Json -Depth 3 -Compress
`;

const SLEEP_REASONS = {
  0: 'power button or lid',
  1: 'thermal zone',
  2: 'low battery',
  3: 'an app requested it',
  4: 'a kernel request',
  5: 'hibernate after sleep',
  6: 'hibernate after sleep',
  7: 'idle timeout',
  9: 'hibernate after sleep',
};

const base = (p) => (p || '').split('\\').pop();
const toMs = (v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

function describe(e) {
  const v = e.v || [];
  switch (`${e.p}:${e.i}`) {
    case 'Microsoft-Windows-Kernel-General:12':
      return { kind: 'boot', group: 'power', title: 'Windows started' };
    case 'Microsoft-Windows-Kernel-General:13':
      return { kind: 'shutdown', group: 'power', title: 'Windows shut down' };
    case 'Microsoft-Windows-Kernel-Power:41': {
      const bug = Number(v[0]) || 0;
      return {
        kind: 'unexpected',
        group: 'problems',
        level: 'bad',
        title: bug ? `Restarted after a crash (stop code 0x${bug.toString(16).toUpperCase()})` : 'Restarted after an unexpected shutdown',
        detail: bug ? 'Windows hit a blue screen error.' : 'Power was lost, the PC froze, or the power button was held down.',
      };
    }
    case 'Microsoft-Windows-Kernel-Power:42': {
      const reason = e.w || (SLEEP_REASONS[Number(v[2])] ? `Because of ${SLEEP_REASONS[Number(v[2])]}` : '');
      const target = Number(v[0]);
      return { kind: 'sleep', group: 'power', title: target === 5 ? 'Hibernated' : 'Went to sleep', detail: reason ? `Reason: ${reason.replace(/\.$/, '')}.` : '' };
    }
    case 'Microsoft-Windows-Kernel-Power:105':
      return { kind: 'source', group: 'power', title: /true/i.test(v[0]) ? 'Plugged in' : 'Switched to battery' };
    case 'Microsoft-Windows-Kernel-Power:506':
      return { kind: 'standby', group: 'power', title: 'Screen off, standby' };
    case 'Microsoft-Windows-Kernel-Power:507':
      return { kind: 'standby-end', group: 'power', title: 'Woke from standby' };
    case 'Microsoft-Windows-Power-Troubleshooter:1': {
      const slept = toMs(v[0]);
      const woke = toMs(v[1]);
      const source = (e.w || '').replace(/^Device\s*-\s*/i, '').trim();
      return {
        kind: 'wake',
        group: 'power',
        title: 'Woke from sleep',
        detail: source && !/^unknown/i.test(source) ? `Woken by ${source}.` : '',
        slept,
        woke,
        source,
      };
    }
    case 'User32:1074': {
      const proc = base((v[0] || '').replace(/\s*\(.*\)\s*$/, ''));
      const what = /restart/i.test(v[4] || '') ? 'Restart' : /power off|shutdown/i.test(v[4] || '') ? 'Shut down' : 'Shut down or restart';
      return { kind: 'request', group: 'power', title: `${what} requested by ${proc || 'a program'}`, detail: [v[2], v[6] ? `User: ${v[6]}` : ''].filter(Boolean).join(' · ') };
    }
    case 'EventLog:6008':
      return { kind: 'unexpected-note', group: 'problems', level: 'warn', title: 'The previous shutdown was unexpected', detail: [v[1], v[0]].filter(Boolean).join(' ') };
    case 'Microsoft-Windows-WindowsUpdateClient:19':
      return { kind: 'update', group: 'updates', level: 'good', title: `Update installed: ${v[0] || 'Windows update'}` };
    case 'Microsoft-Windows-WindowsUpdateClient:20': {
      const title = v.find((x) => /KB\d|update|definition/i.test(x || '')) || v[1] || 'Windows update';
      const code = /^-?\d+$/.test(v[0] || '') ? `0x${(Number(v[0]) >>> 0).toString(16).toUpperCase()}` : v[0] || '';
      return { kind: 'update-failed', group: 'updates', level: 'warn', title: `Update failed: ${title}`, detail: code ? `Error ${code}` : '' };
    }
    case 'Service Control Manager:7031':
    case 'Service Control Manager:7034':
      return { kind: 'service', group: 'problems', level: 'warn', title: `Service stopped unexpectedly: ${v[0] || 'unknown'}`, service: v[0] || '' };
    case 'Microsoft-Windows-WER-SystemErrorReporting:1001':
      return { kind: 'bsod', group: 'problems', level: 'bad', title: 'Blue screen', detail: v[0] ? `Stop code ${v[0]}` : '' };
    case 'Application Error:1000':
      return {
        kind: 'crash',
        group: 'problems',
        level: 'bad',
        title: `${v[0] || 'An app'} crashed`,
        detail: [v[3] && v[3] !== v[0] ? `In ${v[3]}` : '', v[6] ? `error ${/^0x/i.test(v[6]) ? v[6] : `0x${v[6]}`}` : '', v[1] ? `version ${v[1]}` : ''].filter(Boolean).join(' · '),
        app: v[0] || '',
        path: v[10] || '',
      };
    case 'Application Hang:1002':
      return { kind: 'hang', group: 'problems', level: 'warn', title: `${v[0] || 'An app'} stopped responding`, detail: v[1] ? `version ${v[1]}` : '', app: v[0] || '' };
    case 'MsiInstaller:11707':
    case 'MsiInstaller:11724': {
      const product = ((v[0] || '').match(/Product:\s*(.+?)\s*--/) || [])[1] || v[0] || 'a program';
      return { kind: e.i === 11707 ? 'install' : 'uninstall', group: 'updates', title: `${e.i === 11707 ? 'Installed' : 'Removed'}: ${product}` };
    }
    default:
      return null;
  }
}

/** Rebuild on / standby / sleep / off periods from the power events, oldest first. */
function timeline(entries, from, to) {
  const spans = [];
  let state = 'on';
  let since = from;
  const set = (next, t) => {
    if (next === state) return;
    if (t > since) spans.push({ state, from: since, to: t });
    state = next;
    since = t;
  };
  for (const e of entries) {
    switch (e.kind) {
      case 'shutdown':
        set('off', e.t);
        break;
      case 'boot':
        // An unexpected shutdown leaves no "shut down" event: count the gap as off.
        if (state === 'on' && e.prevT && e.t - e.prevT > 120000) {
          set('off', e.prevT);
        }
        set('on', e.t);
        break;
      case 'sleep':
        set('sleep', e.t);
        break;
      case 'wake':
        if (state !== 'sleep' && e.slept && e.slept >= since) set('sleep', e.slept);
        set('on', e.woke && e.woke <= e.t ? e.woke : e.t);
        break;
      case 'standby':
        if (state === 'on') set('standby', e.t);
        break;
      case 'standby-end':
        if (state === 'standby') set('on', e.t);
        break;
      default:
        break;
    }
  }
  if (to > since) spans.push({ state, from: since, to });
  return spans;
}

class HistoryService {
  constructor() {
    this.cache = null;
    this.loading = null;
  }

  async get(refresh = false) {
    if (!refresh && this.cache && Date.now() - this.cache.at < 60000) return this.cache;
    if (!this.loading) {
      this.loading = runPowerShellJson(SCRIPT(DAYS), 90000)
        .then((raw) => {
          const now = Date.now();
          const from = now - DAYS * 86400000;
          const all = [].concat(raw || []).sort((a, b) => a.t - b.t);
          const entries = [];
          let prevT = null;
          for (const e of all) {
            const d = describe(e);
            if (d) entries.push({ t: e.t, prevT, ...d });
            prevT = e.t;
          }
          const spans = timeline(entries, from, now);
          // The list shows standby only when it lasted a while; short screen-offs are noise.
          const list = [];
          let standbyAt = null;
          for (const e of entries) {
            if (e.kind === 'standby') standbyAt = e.t;
            else if (e.kind === 'standby-end') {
              if (standbyAt && e.t - standbyAt >= 15 * 60000) list.push({ t: standbyAt, kind: 'standby', group: 'power', title: 'Standby', detail: '', until: e.t });
              standbyAt = null;
            } else list.push(e);
          }
          for (const e of list) delete e.prevT;
          list.sort((a, b) => b.t - a.t);
          // The same failure repeating all day (an update retried 90 times) becomes one row.
          const merged = [];
          const seen = new Map();
          for (const e of list) {
            if (e.group === 'power') {
              merged.push(e);
              continue;
            }
            const key = `${new Date(e.t).toDateString()}|${e.kind}|${e.title}`;
            const first = seen.get(key);
            if (first) {
              first.count = (first.count || 1) + 1;
              first.since = e.t;
            } else {
              seen.set(key, e);
              merged.push(e);
            }
          }
          const count = (k) => entries.filter((e) => e.kind === k).length;
          const crashes = new Map();
          for (const e of entries) if (e.kind === 'crash' || e.kind === 'hang') crashes.set(e.app, (crashes.get(e.app) || 0) + 1);
          this.cache = {
            at: now,
            from,
            to: now,
            days: DAYS,
            spans,
            list: merged.slice(0, 1500),
            summary: {
              boots: count('boot'),
              sleeps: count('sleep'),
              wakes: count('wake'),
              unexpected: count('unexpected'),
              crashes: count('crash'),
              hangs: count('hang'),
              bsods: count('bsod'),
              updates: count('update'),
              failedUpdates: count('update-failed'),
              serviceCrashes: count('service'),
              topCrashers: [...crashes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([app, n]) => ({ app, n })),
            },
          };
          return this.cache;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }
}

module.exports = { HistoryService };
