@echo off
rem Starts SysLens. conhost --headless runs Node without leaving a console window open.
rem A portable copy brings its own Node.js in runtime\; otherwise Node.js 20+ must be installed.
set "SYSLENS_NODE=node"
if exist "%~dp0runtime\node.exe" set "SYSLENS_NODE=%~dp0runtime\node.exe"
if not exist "%~dp0node_modules\koffi" (
  echo Installing dependencies...
  pushd "%~dp0" && call npm install --no-audit --no-fund && popd
)
start "" "%SystemRoot%\System32\conhost.exe" --headless "%SYSLENS_NODE%" --jitless "%~dp0src\main\launcher.js" %*
