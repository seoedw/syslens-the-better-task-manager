# Creates a "SysLens" shortcut in the Start menu (and on the desktop with -Desktop).
# The shortcut runs Node through conhost --headless, so no console window appears.
param([switch]$Desktop)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$shell = New-Object -ComObject WScript.Shell

$folders = @([Environment]::GetFolderPath('Programs'))
if ($Desktop) { $folders += [Environment]::GetFolderPath('Desktop') }

foreach ($folder in $folders) {
  $link = $shell.CreateShortcut((Join-Path $folder 'SysLens.lnk'))
  $link.TargetPath = $conhost
  $link.Arguments = "--headless `"$node`" `"$root\src\main\server.js`""
  $link.WorkingDirectory = $root
  $link.IconLocation = "$root\assets\icon.ico"
  $link.Description = 'SysLens - see everything your PC is doing'
  $link.Save()
  Write-Output "Created $($link.FullName)"
}
