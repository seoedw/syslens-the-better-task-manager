@echo off
rem Starts SysLens. conhost --headless runs Node without leaving a console window open.
if not exist "%~dp0node_modules\koffi" (
  echo Installing dependencies...
  pushd "%~dp0" && call npm install --no-audit --no-fund && popd
)
start "" "%SystemRoot%\System32\conhost.exe" --headless node --jitless "%~dp0src\main\launcher.js" %*
