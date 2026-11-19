'use strict';
// Devices and drivers: devices Windows reports a problem with (Device Manager's yellow
// triangles), every installed device driver with its maker, version and date, and the
// kernel drivers loaded right now. Read through CIM when the Devices page opens.

const w = require('./win32');
const { runPowerShellJson } = require('./powershell');
const { exeOf } = require('./services');

// Device Manager's problem codes (ConfigManagerErrorCode), in plain words.
const PROBLEMS = {
  1: 'Not set up correctly',
  3: 'The driver is damaged, or Windows is low on memory',
  10: 'The device can’t start',
  12: 'Not enough free resources for it',
  14: 'Needs a restart to work',
  16: 'Windows can’t find all of its resources',
  18: 'Its drivers need to be reinstalled',
  19: 'Its settings in the registry are damaged',
  21: 'Windows is removing it',
  24: 'Not present, not working, or missing drivers',
  28: 'No driver is installed',
  29: 'Turned off in the firmware (BIOS/UEFI)',
  31: 'Not working properly; Windows can’t load its drivers',
  32: 'Its driver is turned off',
  33: 'Windows can’t work out which resources it needs',
  34: 'Needs manual setup',
  35: 'The firmware has no information for it',
  37: 'Its driver failed to start',
  38: 'An earlier copy of its driver is still in memory',
  39: 'Its driver is missing or damaged',
  40: 'Its registry entry is invalid',
  41: 'Windows loaded the driver but can’t find the device',
  42: 'A duplicate device is already running',
  43: 'Windows stopped it because it reported problems',
  44: 'An app or service shut it down',
  47: 'Ready to be removed safely',
  48: 'Its driver is blocked because it has known problems',
  49: 'The system registry is too large',
  50: 'Windows can’t apply all of its properties',
  51: 'Waiting on another device to start',
  52: 'Its driver isn’t signed, so Windows won’t load it',
  53: 'Reserved for the Windows kernel debugger',
  54: 'Failed and is being reset',
};
// Not problems: turned off on purpose (22), not plugged in (45).
const NOT_PROBLEMS = new Set([0, 22, 45]);

const PROBLEMS_SCRIPT = `
@(Get-CimInstance Win32_PnPEntity -Filter "ConfigManagerErrorCode <> 0" | ForEach-Object {
  [ordered]@{ name = [string]$_.Name; cls = [string]$_.PNPClass; code = [int]$_.ConfigManagerErrorCode; maker = [string]$_.Manufacturer; id = [string]$_.PNPDeviceID; present = [bool]$_.Present }
}) | ConvertTo-Json -Compress
`;

const ALL_SCRIPT = `
$out = [ordered]@{ problems = @(); drivers = @(); kernel = @() }
$out.problems = @(Get-CimInstance Win32_PnPEntity -Filter "ConfigManagerErrorCode <> 0" | ForEach-Object {
  [ordered]@{ name = [string]$_.Name; cls = [string]$_.PNPClass; code = [int]$_.ConfigManagerErrorCode; maker = [string]$_.Manufacturer; id = [string]$_.PNPDeviceID; present = [bool]$_.Present }
})
$out.drivers = @(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName } | ForEach-Object {
  [ordered]@{ name = [string]$_.DeviceName; cls = [string]$_.DeviceClass; provider = [string]$_.DriverProviderName; version = [string]$_.DriverVersion; date = $(if ($_.DriverDate) { $_.DriverDate.ToUniversalTime().ToString('yyyy-MM-dd') } else { '' }); signer = [string]$_.Signer; inf = [string]$_.InfName; id = [string]$_.DeviceID }
})
$out.kernel = @(Get-CimInstance Win32_SystemDriver | ForEach-Object {
  [ordered]@{ name = [string]$_.Name; display = [string]$_.DisplayName; state = [string]$_.State; start = [string]$_.StartMode; path = [string]$_.PathName }
})
$out | ConvertTo-Json -Depth 4 -Compress
`;

const START = { Boot: 'Boot', System: 'System', Auto: 'Automatic', Manual: 'Manual', Disabled: 'Disabled' };

function shapeProblems(raw) {
  return []
    .concat(raw || [])
    .filter((d) => d && !NOT_PROBLEMS.has(d.code))
    .map((d) => ({ name: d.name || 'Unknown device', cls: d.cls || '', code: d.code, problem: PROBLEMS[d.code] || `Problem code ${d.code}`, maker: d.maker || '', id: d.id || '', present: d.present }));
}

class DevicesService {
  constructor() {
    this.cache = null;
    this.loading = null;
    this.problemsCache = null;
    this.problemsLoading = null;
    this.companies = new Map();
  }

  company(file) {
    if (!file) return '';
    const k = file.toLowerCase();
    if (!this.companies.has(k)) {
      const info = w.fileVersionInfo(file);
      this.companies.set(k, (info && info.company) || '');
    }
    return this.companies.get(k);
  }

  /** Just the devices with problems (quick: for Overview's findings). */
  async problems(refresh = false) {
    if (!refresh && this.problemsCache && Date.now() - this.problemsCache.at < 10 * 60000) return this.problemsCache;
    if (!this.problemsLoading) {
      this.problemsLoading = runPowerShellJson(PROBLEMS_SCRIPT, 60000)
        .then((raw) => {
          this.problemsCache = { list: shapeProblems(raw), at: Date.now() };
          return this.problemsCache;
        })
        .finally(() => {
          this.problemsLoading = null;
        });
    }
    return this.problemsLoading;
  }

  /** Everything for the Devices page (the driver list takes a few seconds to read). */
  async all(refresh = false) {
    if (!refresh && this.cache && Date.now() - this.cache.at < 5 * 60000) return this.cache;
    if (!this.loading) {
      this.loading = runPowerShellJson(ALL_SCRIPT, 120000)
        .then((raw) => {
          raw = raw || {};
          const problems = shapeProblems(raw.problems);
          const drivers = []
            .concat(raw.drivers || [])
            .filter(Boolean)
            .map((d) => ({
              name: d.name,
              cls: d.cls || '',
              provider: d.provider || '',
              version: d.version || '',
              date: d.date || '',
              signer: d.signer || '',
              inf: d.inf || '',
              isWindows: /^microsoft/i.test(d.provider || ''),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          const kernel = []
            .concat(raw.kernel || [])
            .filter(Boolean)
            .map((k) => {
              const file = exeOf(k.path);
              const company = this.company(file);
              return {
                name: k.name,
                display: k.display || k.name,
                running: k.state === 'Running',
                state: k.state || '',
                start: START[k.start] || k.start || '',
                file: file || '',
                company,
                isWindows: company ? /microsoft/i.test(company) : true,
              };
            })
            .sort((a, b) => Number(b.running) - Number(a.running) || a.display.localeCompare(b.display));
          this.cache = { problems, drivers, kernel, at: Date.now() };
          this.problemsCache = { list: problems, at: Date.now() };
          return this.cache;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }
}

module.exports = { DevicesService };
