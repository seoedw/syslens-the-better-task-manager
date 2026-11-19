'use strict';
// Everything about this PC for the System page: device and firmware, Windows, processor,
// memory modules, graphics and displays, disks and their health, battery wear, security
// (Secure Boot, TPM, BitLocker, memory integrity, Smart App Control, antivirus, firewall),
// recent updates and power settings. Two PowerShell scripts run in parallel; nothing here
// needs administrator rights.

const os = require('os');
const path = require('path');
const { runPowerShellJson } = require('./powershell');

const HARDWARE = `
$ErrorActionPreference = 'SilentlyContinue'
$r = [ordered]@{}
$cs = Get-CimInstance Win32_ComputerSystem
$csp = Get-CimInstance Win32_ComputerSystemProduct
$bios = Get-CimInstance Win32_BIOS
$board = Get-CimInstance Win32_BaseBoard
$enc = Get-CimInstance Win32_SystemEnclosure
$r.device = [ordered]@{ manufacturer = [string]$cs.Manufacturer; model = [string]$cs.Model; family = [string]$cs.SystemFamily; product = [string]$csp.Version; sku = [string]$cs.SystemSKUNumber; chassis = @($enc.ChassisTypes); pcType = [int]$cs.PCSystemType; hypervisor = [bool]$cs.HypervisorPresent
  bios = [ordered]@{ vendor = [string]$bios.Manufacturer; version = [string]$bios.SMBIOSBIOSVersion; date = if ($bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') } else { '' } }
  board = [ordered]@{ manufacturer = [string]$board.Manufacturer; product = [string]$board.Product } }
$r.device.firmware = if ($env:firmware_type -eq 'Legacy') { 'Legacy BIOS' } elseif ($env:firmware_type) { [string]$env:firmware_type } else { '' }
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$r.cpu = [ordered]@{ name = ([string]$cpu.Name).Trim(); vendor = [string]$cpu.Manufacturer; cores = [int]$cpu.NumberOfCores; threads = [int]$cpu.NumberOfLogicalProcessors; baseMHz = [int]$cpu.MaxClockSpeed; l2KB = [int]$cpu.L2CacheSize; l3KB = [int]$cpu.L3CacheSize; socket = [string]$cpu.SocketDesignation; virtualization = [bool]$cpu.VirtualizationFirmwareEnabled; family = [string]$cpu.Caption }
$arr = Get-CimInstance Win32_PhysicalMemoryArray | Select-Object -First 1
$r.memory = [ordered]@{ slots = [int]$arr.MemoryDevices; maxGB = [math]::Round([double]$arr.MaxCapacityEx / 1MB); modules = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
  [ordered]@{ slot = [string]$_.DeviceLocator; bank = [string]$_.BankLabel; manufacturer = ([string]$_.Manufacturer).Trim(); part = ([string]$_.PartNumber).Trim(); capacity = [int64]$_.Capacity; speed = [int]$_.Speed; configured = [int]$_.ConfiguredClockSpeed; type = [int]$_.SMBIOSMemoryType; form = [int]$_.FormFactor; voltage = [int]$_.ConfiguredVoltage }
}) }
$r.gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  [ordered]@{ name = [string]$_.Name; driver = [string]$_.DriverVersion; driverDate = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { '' }; vendor = [string]$_.AdapterCompatibility; ram = [int64]$_.AdapterRAM; width = [int]$_.CurrentHorizontalResolution; height = [int]$_.CurrentVerticalResolution; refresh = [int]$_.CurrentRefreshRate; bits = [int]$_.CurrentBitsPerPixel; status = [string]$_.Status }
})
$sizes = @{}; Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBasicDisplayParams | ForEach-Object { $sizes[$_.InstanceName] = @([int]$_.MaxHorizontalImageSize, [int]$_.MaxVerticalImageSize) }
$r.displays = @(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID | ForEach-Object {
  $dec = { param($a) -join [char[]]($a | Where-Object { $_ }) }
  [ordered]@{ maker = (& $dec $_.ManufacturerName); name = (& $dec $_.UserFriendlyName); product = (& $dec $_.ProductCodeID); year = [int]$_.YearOfManufacture; cm = $sizes[$_.InstanceName]; internal = ([string]$_.InstanceName -match 'DISPLAY\\\\(BOE|LGD|SDC|AUO|CMN|SHP|EDO|IVO|CSO|TMA|NCP|SAM|LEN)') }
})
$r.disks = @(Get-PhysicalDisk | ForEach-Object {
  [ordered]@{ number = [int]$_.DeviceId; model = [string]$_.FriendlyName; media = [string]$_.MediaType; bus = [string]$_.BusType; size = [int64]$_.Size; health = [string]$_.HealthStatus; status = [string](@($_.OperationalStatus) -join ', '); firmware = [string]$_.FirmwareVersion; spindle = [int64]$_.SpindleSpeed }
})
$xml = Join-Path $env:TEMP ('syslens-battery-' + [guid]::NewGuid().ToString('N') + '.xml')
try {
  powercfg /batteryreport /xml /output $xml | Out-Null
  if (Test-Path $xml) {
    [xml]$b = Get-Content -LiteralPath $xml -Raw
    $r.batteries = @($b.BatteryReport.Batteries.Battery | Where-Object { $_ } | ForEach-Object {
      [ordered]@{ id = [string]$_.Id; manufacturer = [string]$_.Manufacturer; chemistry = [string]$_.Chemistry; design = [int64]$_.DesignCapacity; full = [int64]$_.FullChargeCapacity; cycles = [int]$_.CycleCount }
    })
    Remove-Item -LiteralPath $xml -Force
  }
} catch {}
$bs = Get-CimInstance -Namespace root\\wmi -ClassName BatteryStatus | Select-Object -First 1
if ($bs) { $r.batteryLive = [ordered]@{ chargeRate = [int]$bs.ChargeRate; dischargeRate = [int]$bs.DischargeRate; remaining = [int64]$bs.RemainingCapacity; voltage = [int]$bs.Voltage; online = [bool]$bs.PowerOnline; charging = [bool]$bs.Charging } }
$tpm = [ordered]@{}
try {
  foreach ($line in (tpmtool getdeviceinformation)) {
    if ($line -match '^\\s*-?\\s*([^:]+):\\s*(.*)$') { $tpm[$Matches[1].Trim()] = $Matches[2].Trim() }
  }
} catch {}
$r.tpm = $tpm
$r | ConvertTo-Json -Depth 6 -Compress
`;

const WINDOWS = `
$ErrorActionPreference = 'SilentlyContinue'
$r = [ordered]@{}
$os = Get-CimInstance Win32_OperatingSystem
$cur = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
$r.os = [ordered]@{ caption = [string]$os.Caption; version = [string]$os.Version; displayVersion = [string]$cur.DisplayVersion; build = [string]$cur.CurrentBuild; ubr = [int]$cur.UBR; edition = [string]$cur.EditionID; arch = [string]$os.OSArchitecture
  installDate = if ($os.InstallDate) { $os.InstallDate.ToUniversalTime().ToString('o') } else { '' }; lastBoot = if ($os.LastBootUpTime) { $os.LastBootUpTime.ToUniversalTime().ToString('o') } else { '' }
  windowsDir = [string]$os.WindowsDirectory; systemDrive = [string]$os.SystemDrive; locale = (Get-Culture).Name; timeZone = (Get-TimeZone).DisplayName; language = (Get-UICulture).DisplayName; experience = [string]$cur.LCUVer }
$sec = [ordered]@{}
try { $sec.secureBoot = [int](Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecureBoot\\State' -ErrorAction Stop).UEFISecureBootEnabled } catch { $sec.secureBoot = -1 }
try { $sec.smartAppControl = [int](Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy' -ErrorAction Stop).VerifiedAndReputablePolicyState } catch { $sec.smartAppControl = -1 }
$dg = Get-CimInstance -Namespace root\\Microsoft\\Windows\\DeviceGuard -ClassName Win32_DeviceGuard
if ($dg) { $sec.vbs = [int]$dg.VirtualizationBasedSecurityStatus; $sec.running = @($dg.SecurityServicesRunning | ForEach-Object { [int]$_ }) }
try { $sec.bitlocker = [int]((New-Object -ComObject Shell.Application).NameSpace($os.SystemDrive + '\\').Self.ExtendedProperty('System.Volume.BitLockerProtection')) } catch { $sec.bitlocker = -1 }
$p = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'
$sec.uac = [ordered]@{ enabled = [int]$p.EnableLUA; consent = [int]$p.ConsentPromptBehaviorAdmin; secureDesktop = [int]$p.PromptOnSecureDesktop }
$sec.antivirus = @(Get-CimInstance -Namespace root\\SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object { [ordered]@{ name = [string]$_.displayName; state = [int]$_.productState } })
$sec.firewallProducts = @(Get-CimInstance -Namespace root\\SecurityCenter2 -ClassName FirewallProduct | ForEach-Object { [ordered]@{ name = [string]$_.displayName; state = [int]$_.productState } })
try { $m = Get-MpComputerStatus -ErrorAction Stop; $sec.defender = [ordered]@{ mode = [string]$m.AMRunningMode; realtime = [bool]$m.RealTimeProtectionEnabled; signatures = if ($m.AntivirusSignatureLastUpdated) { $m.AntivirusSignatureLastUpdated.ToUniversalTime().ToString('o') } else { '' }; tamper = [bool]$m.IsTamperProtected } } catch {}
try { $sec.firewall = @(Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object { [ordered]@{ name = [string]$_.Name; enabled = [bool]$_.Enabled } }) } catch {}
$r.security = $sec
$r.updates = @(Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 8 | ForEach-Object { [ordered]@{ id = [string]$_.HotFixID; kind = [string]$_.Description; date = $_.InstalledOn.ToString('yyyy-MM-dd') } })
$power = [ordered]@{}
try { $line = (powercfg /getactivescheme) -join ' '; if ($line -match '\\(([^)]+)\\)') { $power.plan = $Matches[1] } } catch {}
try { $ps = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes' -ErrorAction Stop; $power.overlayAc = [string]$ps.ActiveOverlayAcPowerScheme; $power.overlayDc = [string]$ps.ActiveOverlayDcPowerScheme } catch {}
$r.power = $power
$r | ConvertTo-Json -Depth 6 -Compress
`;

const CHASSIS = { 3: 'Desktop', 4: 'Desktop', 6: 'Mini tower', 7: 'Tower', 8: 'Portable', 9: 'Laptop', 10: 'Laptop', 11: 'Handheld', 13: 'All-in-one', 14: 'Laptop', 30: 'Tablet', 31: 'Convertible laptop', 32: 'Detachable', 35: 'Mini PC', 36: 'Stick PC' };
const MEMORY_TYPES = { 20: 'DDR', 21: 'DDR2', 24: 'DDR3', 26: 'DDR4', 27: 'LPDDR', 28: 'LPDDR2', 29: 'LPDDR3', 30: 'LPDDR4', 34: 'DDR5', 35: 'LPDDR5' };
const FORM_FACTORS = { 8: 'DIMM', 12: 'SO-DIMM', 0: '' };
const OVERLAYS = {
  '961cc777-2547-4f9d-8174-7d86181b8a7a': 'Best power efficiency',
  'ded574b5-45a0-4f42-8737-46345c09c238': 'Best performance',
  '3af9b8d9-7c97-431d-ad78-34a8bfea439f': 'Better performance',
  '00000000-0000-0000-0000-000000000000': 'Balanced',
  '': 'Balanced',
};
const UAC_LEVELS = { 0: 'Never notify', 2: 'Always notify', 5: 'Notify when apps make changes (default)' };
const SECURITY_SERVICES = { 1: 'Credential Guard', 2: 'Memory integrity (HVCI)', 3: 'System Guard Secure Launch', 4: 'SMM firmware protection', 7: 'Kernel-mode stack protection' };
const BITLOCKER = { 1: 'On', 2: 'Off', 3: 'Encrypting', 4: 'Decrypting', 5: 'Suspended', 6: 'On (locked)', 8: 'Waiting for activation' };
// SecurityCenter2 productState: byte 2 = on/off, byte 3 = definitions up to date.
const productOn = (state) => [0x10, 0x11].includes((state >> 8) & 0xff);
const productCurrent = (state) => (state & 0xff) === 0x00;

function shapeHardware(raw) {
  if (!raw) return null;
  const d = raw.device || {};
  const chassis = [].concat(d.chassis || []).map((c) => CHASSIS[c]).find(Boolean) || (d.pcType === 2 ? 'Laptop' : '');
  const memory = raw.memory || {};
  const modules = [].concat(memory.modules || []).map((m) => ({
    slot: [m.bank, m.slot].filter((x) => x && !/^(none|unknown)$/i.test(x)).join(' · '),
    manufacturer: m.manufacturer && !/^(unknown|undefined|0+)$/i.test(m.manufacturer) ? m.manufacturer : '',
    part: m.part || '',
    capacity: m.capacity || 0,
    speed: m.configured || m.speed || 0,
    rated: m.speed || 0,
    type: MEMORY_TYPES[m.type] || '',
    form: FORM_FACTORS[m.form] || '',
    voltage: m.voltage ? m.voltage / 1000 : 0,
  }));
  const tpm = raw.tpm || {};
  const batteries = [].concat(raw.batteries || []).map((b) => ({ ...b, health: b.design > 0 && b.full > 0 ? Math.min(100, (b.full / b.design) * 100) : null }));
  return {
    device: {
      manufacturer: d.manufacturer,
      model: d.product && !/^(none|default string|to be filled)/i.test(d.product) ? d.product : d.model,
      modelNumber: d.model,
      family: d.family,
      type: chassis,
      firmware: d.firmware,
      bios: d.bios || {},
      board: d.board || {},
      hypervisor: d.hypervisor,
    },
    cpu: raw.cpu || null,
    memory: { slots: memory.slots || 0, maxGB: memory.maxGB || 0, modules },
    gpus: [].concat(raw.gpus || []),
    displays: [].concat(raw.displays || []).map((x) => ({
      ...x,
      inches: x.cm && x.cm[0] > 0 ? Math.round((Math.sqrt(x.cm[0] ** 2 + x.cm[1] ** 2) / 2.54) * 10) / 10 : 0,
    })),
    disks: [].concat(raw.disks || []),
    batteries,
    batteryLive: raw.batteryLive || null,
    tpm: tpm['TPM Present']
      ? {
          present: /true/i.test(tpm['TPM Present']),
          version: tpm['TPM Version'] || '',
          maker: tpm['TPM Manufacturer Full Name'] || tpm['TPM Manufacturer ID'] || '',
          firmware: tpm['TPM Manufacturer Version'] || '',
          ready: /true/i.test(tpm['Ready For Storage'] || tpm['Ready For Attestation'] || ''),
        }
      : null,
  };
}

function shapeWindows(raw) {
  if (!raw) return null;
  const s = raw.security || {};
  const power = raw.power || {};
  const overlay = (power.overlayAc || '').toLowerCase();
  return {
    os: raw.os || null,
    security: {
      secureBoot: s.secureBoot === 1 ? 'On' : s.secureBoot === 0 ? 'Off' : 'Not supported',
      smartAppControl: s.smartAppControl === 1 ? 'On' : s.smartAppControl === 2 ? 'Evaluation' : s.smartAppControl === 0 ? 'Off' : 'Not available',
      vbs: s.vbs === 2 ? 'Running' : s.vbs === 1 ? 'Enabled, not running' : 'Off',
      services: [].concat(s.running || []).map((x) => SECURITY_SERVICES[x]).filter(Boolean),
      memoryIntegrity: [].concat(s.running || []).includes(2),
      bitlocker: BITLOCKER[s.bitlocker] || (s.bitlocker === 0 ? 'Not supported' : 'Unknown'),
      uac: s.uac ? (s.uac.enabled === 0 ? 'Off' : UAC_LEVELS[s.uac.consent] || `Custom (${s.uac.consent})`) : 'Unknown',
      antivirus: [].concat(s.antivirus || []).map((a) => ({ name: a.name, on: productOn(a.state), current: productCurrent(a.state) })),
      firewallProducts: [].concat(s.firewallProducts || []).map((a) => ({ name: a.name, on: productOn(a.state) })),
      defender: s.defender || null,
      firewall: [].concat(s.firewall || []),
    },
    updates: [].concat(raw.updates || []),
    power: {
      plan: power.plan || '',
      mode: OVERLAYS[overlay] || (overlay ? 'Custom' : 'Balanced'),
    },
  };
}

class MachineService {
  constructor() {
    this.hardware = null;
    this.windows = null;
    this.loading = { hardware: null, windows: null };
  }

  load(part, script, shape, timeout) {
    if (!this.loading[part]) {
      this.loading[part] = runPowerShellJson(script, timeout)
        .then((raw) => {
          this[part] = { ...shape(raw), at: Date.now() };
        })
        .catch(() => {
          this[part] = { error: true, at: Date.now() };
        })
        .finally(() => {
          this.loading[part] = null;
        });
    }
    return this.loading[part];
  }

  /** Whatever is ready now; `pending` lists the parts still loading (poll again for them). */
  get(refresh = false) {
    if (refresh || !this.hardware) this.load('hardware', HARDWARE, shapeHardware, 60000);
    if (refresh || !this.windows || Date.now() - this.windows.at > 5 * 60000) this.load('windows', WINDOWS, shapeWindows, 60000);
    return {
      hardware: this.hardware,
      windows: this.windows,
      pending: Object.keys(this.loading).filter((k) => this.loading[k]),
      node: { version: process.version, hostname: os.hostname(), user: os.userInfo().username, appDir: path.resolve(__dirname, '..', '..') },
    };
  }
}

module.exports = { MachineService };
