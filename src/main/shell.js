'use strict';
// Windows shell helpers: Explorer, Settings, folder picker, web search, "Run new task",
// start-with-Windows and the shortcut's keyboard shortcut, and the app window (a Chromium
// browser in --app mode, which is signed and trusted even under Smart App Control).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { runPowerShellJson, run } = require('./powershell');

const SETTINGS_PAGES = {
  storage: 'ms-settings:storagesense',
  apps: 'ms-settings:appsfeatures',
  startup: 'ms-settings:startupapps',
  power: 'ms-settings:powersleep',
  battery: 'ms-settings:batterysaver',
  network: 'ms-settings:network-status',
  wifi: 'ms-settings:network-wifi',
  update: 'ms-settings:windowsupdate-history',
  about: 'ms-settings:about',
  display: 'ms-settings:display',
  security: 'windowsdefender:',
  services: 'services.msc',
  resmon: 'resmon',
  taskmgr: 'taskmgr',
};

/**
 * An absolute local path. Network (UNC) and device paths are refused: touching \\server\share
 * makes Windows sign in to that server with your account, which can leak your password hash.
 */
function isSafePath(p) {
  return typeof p === 'string' && p.length < 32768 && path.isAbsolute(p) && /^[A-Za-z]:\\/.test(p) && !p.includes('"') && !/[\r\n\0]/.test(p);
}

function launch(exe, args, opts = {}) {
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false, ...opts });
  child.on('error', () => {});
  child.unref();
  return child;
}

function showItem(p) {
  if (!isSafePath(p)) return false;
  launch('explorer.exe', [`/select,"${p}"`], { windowsVerbatimArguments: true });
  return true;
}

function openFolder(p) {
  if (!isSafePath(p)) return false;
  try {
    // Only folders: opening arbitrary files could launch programs.
    if (!fs.statSync(p).isDirectory()) return false;
  } catch {
    return false;
  }
  launch('explorer.exe', [`"${p}"`], { windowsVerbatimArguments: true });
  return true;
}

function openSettings(page) {
  if (!Object.prototype.hasOwnProperty.call(SETTINGS_PAGES, page)) return false;
  if (page === 'services') launch('mmc.exe', ['services.msc']);
  else if (page === 'resmon') launch('resmon.exe', []);
  else if (page === 'taskmgr') launch('taskmgr.exe', []);
  else launch('explorer.exe', [SETTINGS_PAGES[page]]);
  return true;
}

// The Tools page. Only these can be opened: each id maps to a fixed program and arguments.
// Programs that need administrator rights go through Start-Process, which shows the UAC prompt.
const TOOLS = {
  devmgmt: ['mmc.exe', ['devmgmt.msc']],
  diskmgmt: ['mmc.exe', ['diskmgmt.msc']],
  compmgmt: ['mmc.exe', ['compmgmt.msc']],
  eventvwr: ['mmc.exe', ['eventvwr.msc']],
  taskschd: ['mmc.exe', ['taskschd.msc']],
  services: ['mmc.exe', ['services.msc']],
  perfmon: ['perfmon.exe', []],
  reliability: ['perfmon.exe', ['/rel']],
  resmon: ['resmon.exe', []],
  msinfo32: ['msinfo32.exe', []],
  msconfig: ['msconfig.exe', [], true],
  regedit: ['regedit.exe', [], true],
  cleanmgr: ['cleanmgr.exe', []],
  mdsched: ['mdsched.exe', [], true],
  control: ['control.exe', []],
  sysprops: ['SystemPropertiesAdvanced.exe', []],
  envvars: ['rundll32.exe', ['sysdm.cpl,EditEnvironmentVariables']],
  taskmgr: ['taskmgr.exe', []],
  cmd: ['cmd.exe', []],
  powershell: ['powershell.exe', []],
  terminal: ['wt.exe', []],
  update: ['explorer.exe', ['ms-settings:windowsupdate']],
  security: ['explorer.exe', ['windowsdefender:']],
  storage: ['explorer.exe', ['ms-settings:storagesense']],
  apps: ['explorer.exe', ['ms-settings:appsfeatures']],
  startup: ['explorer.exe', ['ms-settings:startupapps']],
  network: ['explorer.exe', ['ms-settings:network-status']],
  power: ['explorer.exe', ['ms-settings:powersleep']],
  display: ['explorer.exe', ['ms-settings:display']],
  sound: ['explorer.exe', ['ms-settings:sound']],
  bluetooth: ['explorer.exe', ['ms-settings:bluetooth']],
  troubleshoot: ['explorer.exe', ['ms-settings:troubleshoot']],
  recovery: ['explorer.exe', ['ms-settings:recovery']],
};

async function openTool(id) {
  if (!Object.prototype.hasOwnProperty.call(TOOLS, id)) return { ok: false, error: 'Unknown tool' };
  const [exe, args, elevate] = TOOLS[id];
  if (elevate) {
    const r = await runPowerShellJson(
      "try { $p = @{ FilePath = $env:SL_FILE; ErrorAction = 'Stop' }; if ($env:SL_ARGS) { $p.ArgumentList = $env:SL_ARGS }; Start-Process @p; ConvertTo-Json -Compress @{ ok = $true } } catch { ConvertTo-Json -Compress @{ ok = $false; error = [string]$_.Exception.Message } }",
      30000,
      { SL_FILE: exe, SL_ARGS: args.join(' ') },
    );
    if (r && r.ok) return { ok: true };
    return { ok: false, error: r && /canceled/i.test(r.error) ? 'Cancelled' : (r && r.error) || 'Couldn’t open it' };
  }
  return new Promise((resolve) => {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', () => resolve({ ok: false, error: `${exe} isn’t available on this PC` }));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}

/**
 * Clear the DNS resolver cache (ipconfig /flushdns). Windows wants administrator rights for it,
 * so without them it asks first (the UAC prompt), as Run as administrator does.
 */
async function flushDns() {
  const r = await run('ipconfig.exe', ['/flushdns'], 20000);
  if (r.code === 0) return { ok: true };
  if (!/elevation/i.test(r.out)) return { ok: false, error: r.out || 'Windows refused' };
  const ps = await runPowerShellJson(
    "try { $p = Start-Process -FilePath 'ipconfig.exe' -ArgumentList '/flushdns' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop; ConvertTo-Json -Compress @{ ok = ($p.ExitCode -eq 0) } } catch { ConvertTo-Json -Compress @{ ok = $false; error = [string]$_.Exception.Message } }",
    120000,
  );
  if (ps && ps.ok) return { ok: true };
  return { ok: false, error: ps && /cancel/i.test(ps.error || '') ? 'Cancelled' : 'Needs administrator rights' };
}

// Links SysLens opens in the default browser. Only these.
const LINKS = {
  repo: 'https://github.com/seoedw/syslens-the-better-task-manager',
  releases: 'https://github.com/seoedw/syslens-the-better-task-manager/releases',
  license: 'https://github.com/seoedw/syslens-the-better-task-manager/blob/main/LICENSE',
  author: 'https://github.com/seoedw',
};

function openLink(id) {
  if (!Object.prototype.hasOwnProperty.call(LINKS, id)) return false;
  launch('explorer.exe', [LINKS[id]]);
  return true;
}

/** "Search online", like Task Manager: a Bing search in the default browser. */
function searchOnline(text) {
  if (typeof text !== 'string') return false;
  const q = text.replace(/[\r\n\0]/g, ' ').trim().slice(0, 200);
  if (!q) return false;
  launch('explorer.exe', [`https://www.bing.com/search?q=${encodeURIComponent(q)}`]);
  return true;
}

// "Run new task": the command line is split into program and arguments here and handed to
// Start-Process through environment variables, so nothing in it is ever run as PowerShell.
const RUN_SCRIPT = `
try {
  $p = @{ FilePath = $env:SL_FILE; ErrorAction = 'Stop' }
  if ($env:SL_ARGS) { $p.ArgumentList = $env:SL_ARGS }
  if ($env:SL_ADMIN -eq '1') { $p.Verb = 'RunAs' }
  Start-Process @p
  ConvertTo-Json -Compress @{ ok = $true }
} catch { ConvertTo-Json -Compress @{ ok = $false; error = [string]$_.Exception.Message } }
`;

function splitCommand(cmd) {
  const s = cmd.trim();
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    if (end < 0) return { file: s.slice(1), args: '' };
    return { file: s.slice(1, end), args: s.slice(end + 1).trim() };
  }
  // An unquoted path with spaces ("C:\Program Files\x\app.exe -a"): the longest prefix that exists.
  const parts = s.split(/\s+/);
  for (let i = parts.length; i > 1; i--) {
    const candidate = parts.slice(0, i).join(' ');
    if (/^[A-Za-z]:\\/.test(candidate) && fs.existsSync(candidate)) return { file: candidate, args: parts.slice(i).join(' ') };
  }
  return { file: parts[0], args: parts.slice(1).join(' ') };
}

async function runTask(command, admin) {
  if (typeof command !== 'string' || !command.trim() || command.length > 2000 || /[\r\n\0]/.test(command)) return { ok: false, error: 'Type a program, folder, document or website' };
  const { file, args } = splitCommand(command);
  if (/^\\\\/.test(file)) return { ok: false, error: 'Network paths aren’t opened from here' };
  const r = await runPowerShellJson(RUN_SCRIPT, 60000, { SL_FILE: file, SL_ARGS: args, SL_ADMIN: admin ? '1' : '0' });
  if (!r) return { ok: false, error: 'Windows didn’t answer' };
  if (r.ok) return { ok: true };
  const msg = String(r.error || '');
  if (/canceled by the user/i.test(msg)) return { ok: false, error: 'Cancelled' };
  if (/cannot find the file|cannot find/i.test(msg)) return { ok: false, error: `Windows can’t find “${file}”` };
  return { ok: false, error: msg.split('\n')[0] || 'Couldn’t start it' };
}

/** Start a program again with its own arguments, from its own folder ("Restart app"). */
async function startProgram(file, args) {
  if (!isSafePath(file)) return { ok: false, error: 'Can’t start it from here' };
  const r = await runPowerShellJson(
    "try { $p = @{ FilePath = $env:SL_FILE; WorkingDirectory = $env:SL_DIR; ErrorAction = 'Stop' }; if ($env:SL_ARGS) { $p.ArgumentList = $env:SL_ARGS }; Start-Process @p; ConvertTo-Json -Compress @{ ok = $true } } catch { ConvertTo-Json -Compress @{ ok = $false; error = [string]$_.Exception.Message } }",
    30000,
    { SL_FILE: file, SL_ARGS: args || '', SL_DIR: path.dirname(file) },
  );
  return r && r.ok ? { ok: true } : { ok: false, error: (r && r.error) || 'Windows didn’t answer' };
}

// ---------- start with Windows ----------
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'SysLens';

/** The same command the shortcuts run: conhost --headless keeps a console window from appearing. */
function launchCommand() {
  const launcher = path.join(__dirname, 'launcher.js');
  const conhost = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'conhost.exe');
  return `"${conhost}" --headless "${process.execPath}" --jitless "${launcher}"`;
}

async function setAutostart(on) {
  const r = on
    ? await run('reg.exe', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', launchCommand(), '/f'])
    : await run('reg.exe', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f']);
  // Deleting a value that isn't there is fine.
  return r.code === 0 || (!on && /unable to find/i.test(r.out)) ? { ok: true } : { ok: false, error: r.out || 'Windows refused' };
}

async function autostartEnabled() {
  const r = await run('reg.exe', ['query', RUN_KEY, '/v', RUN_VALUE]);
  return r.code === 0;
}

// ---------- the shortcut's keyboard shortcut ----------
// Windows only honours shortcut keys on shortcuts on the desktop or in the Start menu, so the
// key is set on SysLens's own shortcuts there.
const HOTKEY_SCRIPT = `
$ws = New-Object -ComObject WScript.Shell
$dirs = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
$n = 0
foreach ($d in $dirs) {
  $f = Join-Path $d 'SysLens.lnk'
  if (Test-Path -LiteralPath $f) { $l = $ws.CreateShortcut($f); $l.Hotkey = $env:SL_KEY; $l.Save(); $n++ }
}
ConvertTo-Json -Compress @{ ok = ($n -gt 0); count = $n }
`;

async function setHotkey(combo) {
  const r = await runPowerShellJson(HOTKEY_SCRIPT, 30000, { SL_KEY: combo || '' });
  if (!r) return { ok: false, error: 'Windows didn’t answer' };
  return r.ok ? { ok: true, count: r.count } : { ok: false, error: 'No SysLens shortcut on the desktop or in the Start menu. Run “npm run shortcut” to add them.' };
}

const PICK_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; StartPosition = 'CenterScreen'; Width = 1; Height = 1; Opacity = 0 }
$owner.Show(); $owner.Activate()
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Choose a folder for SysLens to scan'
$d.ShowNewFolderButton = $false
$r = $d.ShowDialog($owner)
$owner.Close()
if ($r -eq [System.Windows.Forms.DialogResult]::OK) { ConvertTo-Json -Compress @{ path = $d.SelectedPath } } else { 'null' }
`;

async function pickFolder() {
  const r = await runPowerShellJson(PICK_SCRIPT, 10 * 60 * 1000);
  return r && r.path ? r.path : null;
}

function findBrowser() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// Measured on a Ryzen laptop (fresh window, Overview page): these take the window from ~400 MB
// to ~115 MB. Software rendering, run inside the browser process, replaces a GPU process that
// held ~170 MB (the UI is light enough for the CPU); the network service runs in the browser
// process too; Edge's built-in extensions, spare renderer and background update checks are left
// out; the page's JavaScript heap is kept small (renderer ~93 MB -> ~54 MB), and so are the
// drawing caches (another ~6 MB; the UI uses two fonts and small icons). They only apply when
// the window's browser process starts.
const LEAN_FLAGS = [
  '--disable-gpu',
  '--in-process-gpu',
  '--enable-features=NetworkServiceInProcess2',
  '--js-flags=--optimize-for-size --max-semi-space-size=1',
  '--skia-font-cache-limit-mb=4',
  '--skia-resource-cache-limit-mb=8',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-features=SpareRendererForSitePerProcess',
];

/**
 * Lock the administrator window's browser profile so only administrators can change it: an
 * ordinary program could otherwise plant settings in it for the elevated browser to load.
 */
async function lockDownFolder(dir) {
  await run('icacls.exe', [dir, '/inheritance:r', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'], 15000);
}

/**
 * Open the UI in its own app window. A dedicated browser profile makes it a separate browser
 * process, so the returned child exits when the window is closed. An administrator window keeps
 * its browser elevated (--do-not-de-elevate): its address holds the administrator token, and an
 * elevated process's command line can't be read by ordinary programs.
 */
function openAppWindow(url, profileDir, opts = {}) {
  const exe = findBrowser();
  if (!exe) {
    launch('explorer.exe', [url]); // default browser, as a normal tab
    return null;
  }
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [`--app=${url}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-sync', ...LEAN_FLAGS];
  if (opts.elevated) args.push('--do-not-de-elevate');
  // Settings › Behavior › "When SysLens opens": Task Manager's size (the default), the size it
  // had last time (Edge remembers that by itself), maximized, or full screen.
  if (opts.size) args.push(`--window-position=${opts.size.x},${opts.size.y}`, `--window-size=${opts.size.w},${opts.size.h}`);
  if (opts.start === 'maximized') args.push('--start-maximized');
  else if (opts.start === 'fullscreen') args.push('--start-fullscreen');
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  return child;
}

module.exports = {
  showItem,
  openFolder,
  openSettings,
  openTool,
  flushDns,
  openLink,
  startProgram,
  TOOLS,
  searchOnline,
  runTask,
  setAutostart,
  autostartEnabled,
  setHotkey,
  pickFolder,
  findBrowser,
  openAppWindow,
  lockDownFolder,
  isSafePath,
  hostName: () => os.hostname(),
};
