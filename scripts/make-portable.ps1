# Builds dist\SysLens[-Beta]-<version>-portable: SysLens with its own copy of Node.js (the signed
# node.exe from this PC, so Smart App Control still trusts it). The folder runs on PCs without
# Node.js: double-click SysLens.cmd, or run scripts\install-shortcut.ps1 -Desktop in it for
# shortcuts. With -Zip it is also packed into a .zip next to it. -OutDir builds somewhere other
# than dist\ (useful when this folder syncs to OneDrive: the copy is about 100 MB, 40 MB zipped).
param([switch]$Zip, [string]$OutDir = '')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
# A beta build is named like its release: SysLens-Beta-1.4.0-portable.
$channel = if ($pkg.syslens -and $pkg.syslens.channel) { (Get-Culture).TextInfo.ToTitleCase($pkg.syslens.channel) } else { '' }
$name = if ($channel) { "SysLens-$channel-$($pkg.version)-portable" } else { "SysLens-$($pkg.version)-portable" }
$dist = if ($OutDir) { $OutDir } else { Join-Path $root 'dist' }
$out = Join-Path $dist $name

if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out | Out-Null

foreach ($item in 'src', 'assets', 'scripts', 'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'SysLens.cmd') {
  $from = Join-Path $root $item
  if (Test-Path -LiteralPath $from) { Copy-Item -LiteralPath $from -Destination $out -Recurse }
}

# Two double-click helpers and a short note for people who download the zip.
@'
@echo off
rem Adds SysLens to the desktop and Start menu (with the Ctrl+Alt+Shift+S shortcut), then opens it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-shortcut.ps1" -Desktop
call "%~dp0SysLens.cmd"
'@ -replace "`r?`n", "`r`n" | Set-Content -LiteralPath (Join-Path $out 'Install SysLens.cmd') -Encoding ascii -NoNewline
@"
SysLens $channel $($pkg.version) - the better Task Manager
$('=' * 60)

1. Keep this folder somewhere permanent (Documents is fine). Shortcuts point into it.
2. Double-click "Install SysLens.cmd" to add SysLens to the desktop and Start menu
   (Ctrl+Alt+Shift+S opens it from anywhere), or "SysLens.cmd" to just open it.

Nothing else to install: Node.js comes with it (runtime\node.exe).
If Windows says it protected your PC, click "More info" and "Run anyway"; or right-click
the zip before unzipping, choose Properties and tick "Unblock".

Feedback: DM $($pkg.syslens.discord) on Discord.
Made by $($pkg.syslens.author): https://github.com/seoedw/syslens-the-better-task-manager
License: $($pkg.license) (see LICENSE)
"@ | Set-Content -LiteralPath (Join-Path $out 'START HERE.txt') -Encoding utf8

# Runtime dependencies only: koffi and its prebuilt Windows binary.
$nm = Join-Path $out 'node_modules'
New-Item -ItemType Directory -Force -Path $nm | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'node_modules\koffi') -Destination $nm -Recurse
$scoped = Join-Path $root 'node_modules\@koromix'
if (Test-Path -LiteralPath $scoped) { Copy-Item -LiteralPath $scoped -Destination $nm -Recurse }

# Node.js itself.
$node = (Get-Command node).Source
$runtime = Join-Path $out 'runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Copy-Item -LiteralPath $node -Destination $runtime
$version = (& $node --version).Trim()
@"
runtime\node.exe is Node.js $version (https://nodejs.org), signed by the OpenJS Foundation.

Copyright Node.js contributors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Node.js also includes third-party code under its own licenses; the full list is at
https://github.com/nodejs/node/blob/main/LICENSE
"@ | Set-Content -LiteralPath (Join-Path $runtime 'NODE-LICENSE.txt') -Encoding utf8

$size = (Get-ChildItem -LiteralPath $out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Output ("Built {0} ({1:N0} MB, Node.js {2})" -f $out, $size, $version)

if ($Zip) {
  $zipPath = Join-Path $dist "$name.zip"
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
  Compress-Archive -Path $out -DestinationPath $zipPath -CompressionLevel Optimal
  Write-Output ("Packed {0} ({1:N0} MB)" -f $zipPath, ((Get-Item -LiteralPath $zipPath).Length / 1MB))
}
