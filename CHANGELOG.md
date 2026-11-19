# Changelog

Every SysLens release and what changed in it. SysLens shows the newest entry once after it
updates (Settings › About › What’s new shows it again).

## [1.3.0] - 2026-11-18

### Added

- **Right-click menus everywhere.** Processes: Switch to, End task, End process tree, Efficiency mode, Set priority, Suspend and Resume, Open file location, Search online, Go to services, Copy. Services: Start, Stop, Restart, Startup type, Go to process. Startup apps: Enable or Disable. Connections, files and folders, History events and the sidebar have menus too, and right-clicking anywhere else gives quick actions.
- **Settings page** (Ctrl+,) with everything Task Manager’s has and more: theme, accent color, density, interface size, background, page order, start page, update speed, always on top, minimize when switching to an app, start with Windows, the keyboard shortcut, confirmations, process columns, heat shading, account names, privacy and latency.
- **Black theme** for OLED screens: true black backgrounds next to Auto, Light and Dark.
- **Backgrounds**: Aurora, Dusk, Mesh, Dots, Grid or a picture of your own, with a strength slider.
- **Reorder pages** by dragging them in the sidebar or in Settings, hide the ones you don’t use, and reset the order any time. Ctrl+1 … Ctrl+0 follow your order.
- Turn **startup apps** on and off right in SysLens, with the same switch Task Manager uses.
- **Start, stop and restart services** and change their startup type.
- A **Status** column (Suspended, Efficiency mode) and optional Priority, Running for and Publisher columns. Right-click the column headers to choose.
- **Run new task** (Ctrl+N), **Restart Windows Explorer**, **Copy system report** (Ctrl+Shift+C) for sharing or asking for help, a keyboard shortcut list (?) and **What’s new** after each update.
- **Ctrl+Alt+Shift+S opens SysLens from anywhere** (change or turn it off in Settings). Opening SysLens while it runs now brings its window to the front instead of starting a second copy.
- **More findings on Overview**: drives running out of space, overheating and throttling, low battery, apps whose memory keeps growing (a likely leak), paused apps holding memory, blue screens, unexpected shutdowns, apps that keep crashing, failed Windows updates, services that keep stopping, lots of startup apps, worn batteries, and antivirus or firewall turned off. Findings about an app have Show and End task buttons.
- Optional **internet latency** (“Ping”) in the top bar and on the Network page. Off until you turn it on.
- A **portable build** with its own Node.js (`npm run portable`), so other PCs don’t need Node.js installed.

### Changed

- New default page order: Overview, Performance, Processes, Memory, Network, Storage, Startup apps, Services, History, System.
- A compact layout by default, with tighter rows and spacing (Comfortable brings back the roomier one). Services use one line per service.
- The SysLens window uses about 40% less memory: its JavaScript heap is kept small and its graphics and networking run inside the browser process. Pages you leave give back their tables and chart buffers.
- Settings are kept by SysLens itself (`%LOCALAPPDATA%\SysLens\settings.json`), so they survive restarts and carry over to the administrator window.

### Fixed

- The search box’s text no longer runs under “Ctrl K”.

### Security

- **Run as administrator** no longer hands the administrator key to the window that was already open: the elevated SysLens opens a window of its own, with a browser profile only administrators can change, so other programs can’t get administrator access through SysLens.
- Network (UNC) paths are refused for icons, file details and Explorer, so SysLens never makes Windows sign in to another computer with your account.
- Service and startup changes only accept names from SysLens’s own lists, and values from the page reach PowerShell as data, never as code.
- The page refuses to be shown inside another page (clickjacking), and the background picture is only served with the session key.

## [1.2.0] - 2026-11-18

### Added

- Five new pages: **Network** (Wi-Fi, adapters, every connection per app with host names, listening ports), **Startup apps** (with what each one costs right now), **Services** (publisher, account, memory), **History** (a 7-day on, sleep and off chart, crashes, blue screens, updates, wake sources) and **System** (hardware, memory modules, battery health, security, updates).
- Power draw and temperature on Performance; user, integrity level, architecture, connections and sparklines in the process details panel.
- Ctrl+K search, Ctrl+1 … Ctrl+0 page shortcuts, and **Hide personal info** for screenshots.
- A README with screenshots, and a flat app icon.

### Changed

- **Memory use cut by about 60%** (562 MB to about 220 MB measured): a leaner Edge window, a smaller server heap, a `--jitless` launcher, and per-process data streamed only while a page shows it.
- Restyled after Windows 11’s own tools: neutral greys, the Windows accent color, hairline borders and Task Manager’s amber heat shading.
- The repository is now “syslens - the better task manager”.

## [1.1.0] - 2026-11-18

### Added

- **Reconnects on its own** after 1, 2 and 3 seconds, then every 5 seconds, with a countdown and a Retry now button. Sleep, network changes and busy moments no longer leave it stuck on “Reconnecting”.
- A launcher that restarts the server if it crashes or stops responding; the window reconnects to it.
- A desktop shortcut, so SysLens opens like a normal app.

### Changed

- SysLens moved to the Documents folder.

### Fixed

- Screen readers no longer announce the reconnect countdown every second.

## [1.0.0] - 2026-11-18

### Added

- First release: every process grouped by app, with CPU, memory, GPU, disk and handles; **where your RAM really goes** (the breakdown Task Manager doesn’t show: compressed memory, GPU-shared memory, drivers, file cache, hardware reserved); and **Storage**, with a folder scan, treemap, largest files and installed apps by size.
