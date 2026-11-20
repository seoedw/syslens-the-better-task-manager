# Changelog

Every SysLens release and what changed in it. SysLens shows the newest entry once after it
updates (Settings › About › What’s new shows it again).

## [1.4.5] - 2026-11-20 (Beta)

A small update. **It brings its own Node.js, so there's nothing else to install.**

### Fixed

- **Storage sizes are what files really take on disk.** Sparse files (virtual machine disks, game and emulator images) and compressed ones were counted at their full length: Google Play Games' `userdata.img` says it's 80 GB but holds 4.6 GB, so its folders looked 75 GB bigger than they are. Folder sizes, the treemap, largest files, file types, space hogs and app sizes now all use the size on disk; a file whose length is bigger shows it underneath ("4.6 GB of 80.0 GB"), and the scan summary says how much such files claim without using. The size columns are now called **On disk**.

## [1.4.4] - 2026-11-20 (Beta)

A small update. **It brings its own Node.js, so there's nothing else to install.**

### Changed

- **Back to normal mode asks first.** A "Go back to normal mode?" dialog lists everything SysLens can no longer do without administrator rights, says what happens (a normal window opens, this one closes, your settings carry over, and coming back needs Windows' permission again), and has **Back to normal mode** and **Cancel**. The sidebar button, the administrator popup and Ctrl+K search all go through it; Cancel and Esc leave you in administrator mode.

## [1.4.3] - 2026-11-19 (Beta)

A small update. **It brings its own Node.js, so there's nothing else to install.**

### Added

- **Back to normal mode.** When SysLens runs as administrator, a button under **Running as administrator** (also in that popup and in Ctrl+K search) opens SysLens in a normal window again and closes the administrator one. Your settings carry over.

### Fixed

- **Closing SysLens and quickly opening it again** brought the same copy back, because it was still shutting down. An administrator copy came back as administrator, on whatever version it started with. Now a copy whose window was just closed steps aside and a fresh SysLens starts.
- **Updates take effect when you reopen SysLens.** Opening a newer SysLens while an older one runs used to just show the old one's window; now the old one steps aside for the new version.

## [1.4.2] - 2026-11-19 (Beta)

A small update. **It brings its own Node.js, so there's nothing else to install.**

### Added

- **Shields show which folders are protected.** In Storage, every folder carries its protection: an amber **Locked** shield when only administrators can open it (SysLens can't measure inside), a blue **Protected** shield when you can look inside but only administrators can add, change or delete things (Windows, Program Files and the like), and no shield when it's yours to change. Hover a shield for what it means; the folder you're in shows its own mark, and a line above the list counts each kind. SysLens finds this out by asking Windows to open each folder, without writing anything.

### Fixed

- Long folder names in Storage were cut short even with room to spare.

## [1.4.1] - 2026-11-19 (Beta)

**It brings its own Node.js, so there's nothing else to install.** Download **SysLens Beta 1.4.1** from the Releases page.

### Added

- **Pinning SysLens pins SysLens.** Pin to taskbar used to pin Microsoft Edge (with an address that stopped working the next time SysLens started). The SysLens window now tells Windows it's SysLens, with its own name, icon and start command, and the Start menu and desktop shortcuts share its taskbar button.
- With **Hide network details** off, the Network page lists every address of every adapter, including all IPv6 addresses and the link-local one.

### Changed

- With network details hidden, not one IP address reaches the window: a connection between two apps on this PC shows **This PC**, and a port open to every network shows **All networks**. Addresses inside command lines, window titles, startup commands and service paths are hidden too.
- Turning **Hide network details** on or off reloads the window, so nothing shown before stays on any page.

### Fixed

- Turning on **Hide personal info** (or **Hide network details**) no longer sends you to the start page: you stay on the page you were on, scrolled where you were.

### Security

- A strict Content-Security-Policy on top of escaping everything shown: the window runs only SysLens's own script files (no inline code, no `eval`), can't be put in a frame, and other sites can't load anything from SysLens. Cross-origin and permissions policies too.
- Tested by feeding hostile HTML through every name, title, path, command line and description SysLens shows, on every page, details panel, menu and search: none of it turned into page content.

## [1.4.0] - 2026-11-19 (Beta)

The first beta release: download **SysLens Beta 1.4.0** from the Releases page. It brings its own Node.js, so there's nothing else to install.

### Added

- **Your own background pictures.** Upload up to 12 (or drop them onto Settings), click one to use it, and choose Fill or Fit and a softening blur.
- **Opens at Task Manager's size:** exactly where and as big as Task Manager opens on your PC (its own saved window), or a Task Manager-like 1000 × 700 if it has none. Settings › Behavior › When SysLens opens can switch to the size from last time, maximized, or **full screen**.
- **Full screen:** a button in the title bar, and a shortcut you can change in Settings (F11, Edge's own full screen, by default).
- **Users page** (like Task Manager's Users tab): who's signed in, what each session is running and using, and Lock, Switch user and Sign out.
- **Devices page:** devices Windows reports a problem with (Device Manager's yellow triangles, in plain words), every device driver with its maker, version and date, and the kernel drivers loaded right now, with third-party ones easy to pick out. Overview says when a device has a problem.
- **Tools page:** quick fixes (flush the DNS cache, restart Windows Explorer, run a task, copy a system report, lock the PC) and 30 Windows tools, each with a line on what it's for.
- **Restart, like Task Manager:** Windows Explorer's End task becomes **Restart task** (button, details panel, Delete key and right-click). Other desktop apps get **Restart app**, which closes the app and opens it again with the same settings.
- **Run as administrator asks first** and lists everything administrator mode lets you do. Once SysLens is administrator, clicking the badge shows that list again.
- **Notify me about problems** (optional): a Windows notification when something serious comes up while you're in another app.
- **Feedback:** the sidebar and Settings › About say where to send it (Discord: eward.s.asdfjkl). Click to copy the name.
- The bottom of Settings links the GitHub repository and says who made SysLens (seoedw).
- SysLens is now **MIT-licensed** (LICENSE).

### Changed

- **Network details are hidden by default and never reach the window.** That covers your Wi-Fi name, IP and MAC addresses, gateway, DNS servers and who your apps talk to. SysLens's server keeps them back, the page draws solid blocks where they would be, and nothing can be read from the screen, a screenshot or the page itself. Settings › Privacy › Hide network details shows them again.
- **Hide personal info** covers text with a solid bar instead of blurring it.
- SysLens opens on the same port each time it can, so the window keeps what it remembers per address (such as notification permission).
- The portable build is named like its release (SysLens-Beta-1.4.0-portable.zip) and adds `Install SysLens.cmd` and `START HERE.txt`.

### Fixed

- Cancel buttons in dialogs (Run new task and others) now close them; only the ✕ did before.
- Flush DNS asks for administrator permission, which Windows requires for it.
- Opening an app from another page now selects it in Processes even when that page hasn’t been shown yet.
- Driver, BIOS and graphics driver dates showed a day early in time zones west of UTC (Windows stores them in UTC); they now match Device Manager.
- SysLens opens at exactly Task Manager’s size and place on scaled screens; at 150% or 200% it could land a pixel off.

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
- The SysLens window uses less memory: its JavaScript heap and drawing caches are kept small and its graphics and networking run inside the browser process. Pages you leave give back their tables and chart buffers, and lists read for a page (event logs, the hardware report, services, startup entries) are let go after 10 minutes without use.
- Settings are kept by SysLens itself (`%LOCALAPPDATA%\SysLens\settings.json`), so they survive restarts and carry over to the administrator window.

### Fixed

- The search box’s text no longer runs under “Ctrl K”.
- **Hide personal info** now also covers window titles shown in the process list and folder paths in Settings › About.
- Host names are remembered for the 2,000 most recent addresses instead of piling up for as long as SysLens runs.

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
