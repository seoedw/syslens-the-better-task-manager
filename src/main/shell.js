'use strict';
// Windows shell helpers: Explorer, Settings, folder picker, and the app window (a Chromium
// browser in --app mode, which is signed and trusted even under Smart App Control).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { runPowerShellJson } = require('./powershell');

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
};

function isSafePath(p) {
  return typeof p === 'string' && p.length < 32768 && path.isAbsolute(p) && !p.includes('"') && !/[\r\n\0]/.test(p);
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
  else launch('explorer.exe', [SETTINGS_PAGES[page]]);
  return true;
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

// Measured on a Ryzen laptop: these cut the window from ~400 MB to ~170 MB. Software
// rendering replaces a GPU process holding ~170 MB (the UI is light enough for the CPU), and
// Edge's built-in extensions (seven ~12 MB processes), spare renderer and background update
// checks are left out. They only apply when the window's browser process starts.
const LEAN_FLAGS = [
  '--disable-gpu',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-features=SpareRendererForSitePerProcess',
];

/**
 * Open the UI in its own app window. A dedicated browser profile makes it a separate
 * browser process, so the returned child exits when the window is closed.
 */
function openAppWindow(url, profileDir) {
  const exe = findBrowser();
  if (!exe) {
    launch('explorer.exe', [url]); // default browser, as a normal tab
    return null;
  }
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(
    exe,
    [
      `--app=${url}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--window-size=1400,900',
      ...LEAN_FLAGS,
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.on('error', () => {});
  return child;
}

module.exports = { showItem, openFolder, openSettings, pickFolder, findBrowser, openAppWindow, isSafePath };
