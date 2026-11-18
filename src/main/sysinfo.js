'use strict';
// One-time hardware inventory: CPU, RAM modules, GPUs (with their PDH LUIDs), disks.
// Two PowerShell calls run in parallel because the storage cmdlets can take 10+ seconds.

const os = require('os');
const { runPowerShellJson } = require('./powershell');

const SCRIPT_CORE = `
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$ram = @(Get-CimInstance Win32_PhysicalMemory)
$cur = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
$gpus = @(Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\DirectX' | ForEach-Object {
  $p = Get-ItemProperty $_.PSPath
  if ($p.Description) { [pscustomobject]@{ name = [string]$p.Description; luid = [int64]$p.AdapterLuid; dedicated = [int64]$p.DedicatedVideoMemory; shared = [int64]$p.SharedSystemMemory } }
})
[pscustomobject]@{
  os = [string]$os.Caption
  build = "$($cur.CurrentBuild).$($cur.UBR)"
  displayVersion = [string]$cur.DisplayVersion
  manufacturer = [string]$cs.Manufacturer
  model = [string]$cs.Model
  cpu = ([string]$cpu.Name).Trim()
  cores = [int]$cpu.NumberOfCores
  logical = [int]$cpu.NumberOfLogicalProcessors
  maxMHz = [int]$cpu.MaxClockSpeed
  ramSpeed = [int]($ram | Select-Object -First 1).ConfiguredClockSpeed
  ramModules = $ram.Count
  gpus = $gpus
} | ConvertTo-Json -Depth 4 -Compress
`;

const SCRIPT_DISKS = `
$disks = @(Get-PhysicalDisk | ForEach-Object { [pscustomobject]@{ number = [int]$_.DeviceId; model = [string]$_.FriendlyName; media = [string]$_.MediaType; bus = [string]$_.BusType; size = [int64]$_.Size } })
$parts = @(Get-Partition | Where-Object { $_.DriveLetter } | ForEach-Object { [pscustomobject]@{ letter = [string]$_.DriveLetter; disk = [int]$_.DiskNumber } })
[pscustomobject]@{ disks = $disks; partitions = $parts } | ConvertTo-Json -Depth 4 -Compress
`;

const MEDIA = { 0: 'Unspecified', 3: 'HDD', 4: 'SSD', 5: 'SCM' };
const BUS = { 1: 'SCSI', 3: 'ATA', 6: 'Fibre Channel', 7: 'USB', 8: 'RAID', 10: 'SAS', 11: 'SATA', 12: 'SD', 13: 'MMC', 15: 'Virtual', 17: 'NVMe', 18: 'SCM', 19: 'UFS' };

function luidKey(luid) {
  const big = BigInt.asUintN(64, BigInt(luid));
  const lo = big & 0xffffffffn;
  const hi = big >> 32n;
  return `0x${hi.toString(16).padStart(8, '0')}_0x${lo.toString(16).padStart(8, '0')}`;
}

function baseInfo() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    os: `Windows ${os.release()}`,
    build: os.release(),
    displayVersion: '',
    manufacturer: '',
    model: '',
    cpu: (cpus[0] && cpus[0].model.trim()) || 'CPU',
    cores: 0,
    logical: cpus.length,
    maxMHz: (cpus[0] && cpus[0].speed) || 0,
    ramSpeed: 0,
    ramModules: 0,
    gpus: {},
    disks: {},
  };
}

/** Resolves with the full inventory; `onUpdate` fires as each half arrives. */
async function loadSystemInfo(onUpdate = () => {}) {
  const info = baseInfo();
  const core = runPowerShellJson(SCRIPT_CORE, 45000).then((raw) => {
    if (!raw) return;
    for (const k of ['os', 'build', 'displayVersion', 'manufacturer', 'model', 'cpu', 'cores', 'logical', 'maxMHz', 'ramSpeed', 'ramModules']) {
      if (raw[k]) info[k] = raw[k];
    }
    for (const g of raw.gpus || []) {
      if (g.luid == null) continue;
      info.gpus[luidKey(g.luid)] = { name: g.name, dedicatedTotal: g.dedicated || 0, sharedTotal: g.shared || 0 };
    }
    onUpdate(info);
  });
  const disks = runPowerShellJson(SCRIPT_DISKS, 90000).then((raw) => {
    if (!raw) return;
    for (const d of raw.disks || []) {
      info.disks[d.number] = {
        model: d.model,
        media: MEDIA[d.media] || d.media || '',
        bus: BUS[d.bus] || d.bus || '',
        size: d.size,
        letters: (raw.partitions || []).filter((p) => p.disk === d.number).map((p) => `${p.letter}:`),
      };
    }
    onUpdate(info);
  });
  await Promise.all([core, disks]);
  return info;
}

module.exports = { loadSystemInfo, luidKey };
