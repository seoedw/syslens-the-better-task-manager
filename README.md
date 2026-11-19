# SysLens

A better Task Manager for Windows. See every process, **exactly where your RAM goes**, and what is filling your disk, in plain language.

Task Manager tells you memory is 78% used, but its process list only adds up to about half of that. SysLens accounts for every byte: apps, compressed memory, graphics memory borrowed from RAM, driver memory, file cache, and hardware-reserved memory. It also tells you which of those you can do something about.

## Features

**Overview**
- Live CPU, memory, disk, network and GPU meters
- A breakdown of where your RAM is going, with each category explained
- Automatic findings, for example: two browsers open at once, a driver leaking memory, the commit charge near its limit, a long time since the last restart, an app leaking handles, or dev servers left running

**Processes**
- Grouped by app, with every helper process inside its group. WebView2 helpers are attributed to the app that started them (Outlook, Widgets, Claude…) instead of one big "WebView2" bucket.
- Three views: by app, all processes, or a process tree (who started what)
- Browser and Electron processes labeled by role: tab or page, extension, GPU process, network service…
- svchost entries show which Windows service they host
- Columns for CPU, memory (private working set, the same number Task Manager shows), GPU, GPU memory, disk and I/O, handles and threads, with heat-map shading
- A details panel with a plain-language explanation of common processes, the full path, command line, parent chain, child processes and open windows
- **End task** with a confirmation that shows how much memory you'll get back. Critical Windows processes are protected.
- Keyboard shortcuts: `Ctrl+F` search, `↑/↓` select, `Enter` expand, `Del` end task, `Esc` clear, `Ctrl+1…5` switch pages

**Memory**
- Every byte of installed RAM in one bar, plus a table explaining each category and what to do about it
- Memory history, commit charge versus its limit, page file, hard faults
- Apps ranked by private memory, working set or commit

**Performance**
- CPU (total and every logical processor), memory, each disk (active time, read/write, response time), each network adapter, and each GPU (every engine, plus shared and dedicated memory)

**Storage**
- Drives with SSD/HDD and bus type
- "Where space usually goes": Recycle Bin, temporary files, Downloads, Windows Update cache, hibernation and page files, browser profiles, developer caches (npm, pip, NuGet, Gradle, Cargo), WSL and Docker disks, Steam, Epic and Xbox games, OneDrive
- **Explore folders**: a fast, read-only full-disk scan with a clickable treemap and a sortable list. Several threads scan in parallel; a whole drive usually takes under a minute.
- Largest files, a breakdown by file type, and installed apps with their real measured folder size. Apps installed inside another app's folder (for example Steam games) aren't counted twice.

SysLens never deletes anything. Storage pages show you where space goes and open the folder for you.

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org) 20 or newer
- Microsoft Edge (built into Windows) or Google Chrome, used as the app window

## Run it

```bash
git clone https://github.com/seoedw/syslens.git
cd syslens
npm install
npm start
```

SysLens opens in its own window. Close the window and SysLens exits.

To open it like any other app, add shortcuts on the desktop and in the Start menu:

```bash
npm run shortcut
```

Clone it somewhere permanent first (Documents is fine), because the shortcuts point into that folder. Double-clicking **`SysLens.cmd`** also works.

**If the connection drops.** The window reconnects by itself. It tries again after 1, 2 and 3 seconds, then every 5 seconds, even while minimized, and shows a **Retry now** button. Sleep, a network change or a busy PC no longer stops SysLens. The server keeps running for as long as its window is open, and a small launcher restarts the server if it ever crashes, on the same address, so the window picks up where it left off. What happened is written to `%LOCALAPPDATA%\SysLens\syslens.log`.

**Administrator mode.** Without admin rights, Windows hides some details: the paths and command lines of system services, and a few protected folders. Click **Run as administrator** in the sidebar and the same window reconnects with full access.

## How it works

SysLens reads the same Windows sources Task Manager and Process Explorer use, called directly through [koffi](https://koffi.dev) (no native build step):

| Data | Source |
|---|---|
| Processes, private working set, CPU time, I/O, handles, threads | `NtQuerySystemInformation(SystemProcessInformation)`: one system call for every process |
| Paths, command lines, versions, icons | `QueryFullProcessImageName`, `NtQueryInformationProcess`, `GetFileVersionInfo`, `PrivateExtractIcons` |
| Memory lists, kernel pools, file cache, commit | Performance counters (PDH): `\Memory\*` |
| GPU usage and GPU memory per process and adapter | PDH: `\GPU Engine(*)`, `\GPU Process Memory(*)`, `\GPU Adapter Memory(*)` |
| CPU, disks, network | PDH: `\Processor Information(*)`, `\PhysicalDisk(*)`, `\Network Interface(*)` |
| Folder sizes | `FindFirstFileExW` with large fetch, on a pool of worker threads |

The backend is plain Node.js. It serves the UI on `127.0.0.1` and opens it in an Edge/Chrome `--app` window. That design keeps SysLens working on PCs with **Smart App Control**, which blocks unsigned executables such as a self-built Electron app.

**Security**
- The server listens on `127.0.0.1` only, on a random port.
- Every API call needs a random per-run token. The page receives it in the URL fragment, which is never sent over the network.
- Requests whose `Host` header isn't the local address are rejected, which blocks DNS-rebinding attacks. Non-JSON posts are rejected, which blocks cross-site form posts. No CORS headers are sent.
- Before ending a process, SysLens checks that the PID still belongs to the same process instance.
- An elevated instance never writes its token to disk.

## Project layout

```
src/main/        backend (Node.js)
  launcher.js      starts the server and restarts it if it crashes or hangs
  server.js        HTTP server, live event stream, window and lifecycle
  log.js           the log file
  monitor.js       sampling loop, history, memory accounting
  processes.js     process table, grouping, details, end task
  pdh.js           performance counters
  win32.js         Win32/NT bindings
  insights.js      plain-language findings
  knowledge.js     "What is this?" process explanations
  storage/         drives, parallel folder scanner, apps, space hogs
src/renderer/    UI (plain HTML/CSS/JS, no build step)
scripts/         selftest, icon generator, shortcut installer
```

`npm run selftest` prints what the collectors see, without the UI.

## Notes and limits

- Per-process *network* usage needs kernel tracing (ETW) and isn't shown. Disk & I/O includes file, network and device I/O, like Process Explorer.
- Folders inside `C:\Windows\WinSxS` use hard links, so a folder scan counts some files more than once.
- Part of a drive's used space is invisible to any folder scan: restore points, shadow copies and NTFS metadata. SysLens shows how much.
- Per-process GPU memory includes surfaces shared with other apps (the desktop compositor maps every window), so those rows can add up to more than the total.
