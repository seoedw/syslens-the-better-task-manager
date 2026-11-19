# Creates a "SysLens" shortcut in the Start menu, and on the desktop with -Desktop.
# The shortcut runs Node through conhost --headless, so no console window appears.
# It also carries SysLens's keyboard shortcut (Ctrl+Alt+Shift+S unless -Hotkey says otherwise;
# -Hotkey '' for none): Windows honours shortcut keys on desktop and Start menu shortcuts.
# A portable copy (see make-portable.ps1) uses its own Node.js from runtime\.
param([switch]$Desktop, [string]$Hotkey = 'Ctrl+Alt+Shift+S')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bundled = Join-Path $root 'runtime\node.exe'
$node = if (Test-Path -LiteralPath $bundled) { $bundled } else { (Get-Command node).Source }
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$launcher = Join-Path $root 'src\main\launcher.js'
$shell = New-Object -ComObject WScript.Shell

$folders = @([Environment]::GetFolderPath('Programs'))
if ($Desktop) { $folders += [Environment]::GetFolderPath('Desktop') }

foreach ($folder in $folders) {
  $link = $shell.CreateShortcut((Join-Path $folder 'SysLens.lnk'))
  $link.TargetPath = $conhost
  # --jitless keeps the launcher (which only waits on timers) at a few MB.
  $link.Arguments = "--headless `"$node`" --jitless `"$launcher`""
  $link.WorkingDirectory = $root
  $link.IconLocation = "$root\assets\icon.ico,0"
  $link.Description = 'SysLens, the better Task Manager'
  $link.Hotkey = $Hotkey
  $link.Save()
  # SysLens's taskbar identity, so SysLens pinned from here and its window share one button.
  & $node (Join-Path $root 'src\main\appid.js') $link.FullName | Out-Null
  Write-Output "Created $($link.FullName)$(if ($Hotkey) { " (opens with $Hotkey)" })"
}
