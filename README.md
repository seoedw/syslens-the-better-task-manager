<div align="center">

<img src="assets/icon.png" width="84" alt="">

# SysLens — the better Task Manager

**The better Task Manager for Windows.**

Every process, where your RAM really goes, what fills your disk, what starts with Windows,
and what your PC did while you were away. In plain language, on one screen.

### **[Download SysLens Beta 1.4.5](https://github.com/seoedw/syslens-the-better-task-manager/releases/latest/download/SysLens-Beta-1.4.5-portable.zip)** (38 MB)

**It brings its own Node.js, so there's nothing else to install.** Unzip it and double-click **Install SysLens.cmd** ([step by step](#download-the-beta)).

<img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0067C0?style=flat-square&logo=windows&logoColor=white">
<img alt="Node.js 20 or newer, or the portable build" src="https://img.shields.io/badge/Node.js-20%2B%20or%20portable-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white">
<img alt="No administrator rights needed" src="https://img.shields.io/badge/admin-not%20needed-3a3a3a?style=flat-square">
<img alt="No telemetry" src="https://img.shields.io/badge/telemetry-none-3a3a3a?style=flat-square">
<img alt="Version 1.4.5 beta" src="https://img.shields.io/badge/version-1.4.5%20beta-3a3a3a?style=flat-square">
<img alt="MIT license" src="https://img.shields.io/badge/license-MIT-3a3a3a?style=flat-square">

[Download](#download-the-beta) · [Install](#install) · [What it shows](#what-it-shows) · [Screenshots](#screenshots) · [Shortcuts](#keyboard-shortcuts) · [FAQ](#faq) · [How it works](#how-it-works) · [Changelog](CHANGELOG.md) · [Feedback](#feedback) · [License](#license)

<img src="docs/screenshots/overview.png" alt="SysLens Overview: live CPU, memory, disk, network and GPU, where memory is going, findings, top apps and recent activity" width="100%">

</div>

## Why SysLens

Task Manager says your memory is 88% used, but its process list adds up to about half of that. SysLens accounts for every byte, explains each part in a sentence, and tells you which parts you can do something about.

It does the same for everything else it shows: which app is talking to which server, what starts with Windows and what it costs right now, what woke your PC at 3 a.m., and whether your battery is wearing out. And it does everything Task Manager does with what it finds: right-click anything to end it, pause it, slow it down, restart it or turn it off.

| You want to know | Where to look |
|---|---|
| Why is my RAM full? | **Memory**: all installed RAM, split into apps, compressed memory, graphics, drivers, cache and hardware-reserved memory |
| What is slowing my PC down right now? | **Overview** findings, then **Processes** sorted by CPU, memory or disk |
| Can I calm down an app without closing it? | **Processes** › right-click › **Efficiency mode**, **Set priority** or **Suspend** |
| Which app is using the internet, and talking to whom? | **Network**: every connection with its app and the server's host name |
| What is listening on port 3000? | **Network** › Listening ports |
| What starts with Windows, and what does it cost? | **Startup apps**: how much memory each is using now, and a switch to turn it off |
| Did my PC crash, sleep or update last night? | **History**: a week of start-ups, sleep, crashes, blue screens and updates |
| How worn out is my battery? | **System** › Battery and power |
| Are Secure Boot, BitLocker and memory integrity on? | **System** › Security |
| What is filling my disk? | **Storage**: a full-drive scan, the largest files, apps by real size |
| How much power is the processor drawing, and how hot is it? | **Performance** › Power |
| Which device or driver is causing trouble? | **Devices**: problem devices in plain words, every driver with its date and maker |
| Who else is signed in, and what are they running? | **Users** |
| Where is that Windows tool again? | **Tools**: quick fixes and 30 Windows tools, each with a line on what it's for |

## What it shows

### Overview
- Live CPU, memory, disk, network and GPU, with power draw, battery and up time in the title bar
- Where your memory is going, with every category explained
- Findings, checked every second: memory pressure, the commit limit getting close, several browsers open at once, a leaking driver, an app leaking handles, dev servers left running, an app whose memory keeps growing, drives running out of space, overheating and throttling, low battery, and paused apps holding memory
- Slower checks from the event logs and Windows Security: blue screens, unexpected shutdowns, apps that keep crashing, failed Windows updates, services that keep stopping, lots of startup apps, a worn battery, and antivirus or firewall turned off. Findings about an app have **Show** and **End task** right there.
- The apps using the most memory and CPU, and recent activity from the event logs

### Processes
- Grouped by app, with helper processes inside their app. WebView2 helpers count toward the app that started them.
- Three views: by app, all processes, and a tree of who started what
- Browser and Electron processes labeled by role (tab, extension, GPU process…), and each svchost by the service it runs
- CPU, memory (the private working set, the same number Task Manager shows), GPU, GPU memory, disk and I/O, handles and threads, with Task Manager-style shading
- A **Status** column that shows suspended apps and apps in efficiency mode, and optional **Priority**, **Running for** and **Publisher** columns. Right-click the headers to pick.
- A details panel: what the process is, live CPU and memory graphs, its user account and integrity level, 32- or 64-bit, command line, parent chain, child processes, open windows, the services inside it and its network connections
- **Right-click any row** for Switch to, End task, End process tree, Restart app, Efficiency mode, Set priority, Suspend and Resume, Open file location, Search online, Go to services and Copy. Critical Windows processes are protected.
- **Restart, like Task Manager:** for Windows Explorer, End task becomes **Restart task** (the button, the details panel, the Delete key and the menu), which brings back the taskbar, Start menu and desktop while your apps stay open. Other desktop apps get **Restart app**: it closes the app and opens it again with the same settings.
- **End task** asks first and says how much memory you'll get back. **Copy this list** pastes straight into Excel.

### Performance
- CPU (total and every logical processor), memory, each disk, each network adapter and every GPU engine
- **Power**: processor package, CPU cores, GPU and NPU in watts, power per core, temperature and thermal throttling, on PCs whose firmware reports them

### Memory
- All installed RAM in one bar, and a table explaining each part and what to do about it
- Memory over time, commit charge against its limit, page file use and hard faults
- Apps ranked by private memory, working set or commit

### Network
- **Your network details stay hidden by default**: Wi-Fi name, IP and MAC addresses, gateway, DNS servers and who your apps talk to never reach the window, so they can't show up on screen or in a screenshot. Not one IP address is sent, not even 127.0.0.1 (the page says **This PC** or **All networks** instead), and addresses inside command lines and window titles are hidden too. Turn **Hide network details** off in Settings to see every address of every adapter.
- The connection you're on: Wi-Fi name, signal, band and standard, IP address, gateway and DNS
- Throughput over the last two minutes, and every adapter with its addresses and driver
- Every TCP and UDP connection with the app that owns it and the remote server's host name. Connections inside your own PC are hidden unless you ask for them.
- Which app is listening on which port
- Optional internet latency, measured every few seconds while SysLens is open

### Storage
- Drives, and the usual space hogs: Recycle Bin, temporary files, Downloads, update caches, browser data, developer caches, WSL and Docker disks, game libraries
- A read-only full-drive scan with a clickable treemap, the largest files, a breakdown by file type, and installed apps by their measured size
- **Sizes are what's really used on disk.** Sparse files, like virtual machine disks and game images (Google Play Games' 80 GB `userdata.img` that holds 5 GB), count at the space they take, with their full length shown underneath
- **Shields show what's protected:** an amber **Locked** shield on folders only administrators can open, a blue **Protected** shield on folders you can look in but only administrators can change (Windows, Program Files), and no shield on folders that are yours to change

### Startup apps
- Everything that starts with Windows: Run keys, Startup folders, Store apps and scheduled tasks that run at sign-in
- Whether each one is on or off, who made it, and how much memory it is using right now
- A switch on every entry to turn it off or on, the same switch Task Manager and Settings use

### Services
- Every Windows service with its state, startup type, the process hosting it and that process's memory, the account it runs as, and its publisher, one compact line each
- A **Not Microsoft** filter, so third-party services are easy to spot
- **Start**, **Stop**, **Restart** and **Startup type**, from the buttons or a right-click (most services need administrator rights for that)

### History
- A seven-day chart of when the PC was on, in standby, asleep or off, with crashes marked
- Start-ups, shutdowns and who asked for each restart; sleep and wake, with what woke the PC; app crashes and freezes; blue screens; crashed services; Windows updates and installs. Repeats fold into one line.

### System
- Device, firmware and BIOS; Windows edition and build, install date and last start
- Processor with caches and live speed, memory modules, graphics driver, display, disks and their health
- Battery health (the charge it can still hold against its design capacity), charge cycles, power mode and plan
- Security at a glance: antivirus, firewall, Secure Boot, TPM, BitLocker, memory integrity, Smart App Control and UAC
- Recent updates, and how much memory SysLens itself is using

### Users
- Like Task Manager's Users tab: who is signed in, each session's state, and how many processes, how much CPU, memory, disk and GPU each one uses, with its biggest apps
- **Lock**, **Switch user** and **Sign out** (sign out asks first), and the same for other people's sessions as administrator

### Devices
- Devices Windows reports a problem with (Device Manager's yellow triangles), with the problem in plain words
- Every device driver with its maker, version, date and signer; the kernel drivers loaded right now with their publisher and file. Third-party drivers (the usual cause of driver memory leaks and blue screens) are one filter away.

### Tools
- Quick fixes: flush the DNS cache, restart Windows Explorer, run a task, copy a system report, lock the PC
- Thirty Windows tools a click away, each with a line on what it's for: Device Manager, Event Viewer, Reliability Monitor, Resource Monitor, Disk Cleanup, Memory Diagnostic, Registry Editor, System Configuration and more. The ones that need administrator rights are marked.

### Settings
- **Theme**: Auto (follows Windows), Light, Dark, or **Black** with true black for OLED screens
- **Accent color**: your Windows accent, ten others, or any color you pick
- **Density** (compact or comfortable) and **interface size** (90 to 120%)
- **Background**: Aurora, Dusk, Mesh, Dots, Grid, or **your own pictures**: upload up to 12 (or drop them onto Settings), click one to use it, with Fill or Fit, a softening blur and a strength slider
- **When SysLens opens**: at **Task Manager's size** (exactly where and as big as Task Manager opens on your PC) by default, or the size from last time, maximized, or full screen
- **Full screen shortcut**: F11 (Edge's own full screen) by default, or any combination you pick; there's also a full-screen button in the title bar
- **Pages**: drag them into any order (here or right in the sidebar), hide the ones you don't use, pick the start page
- Everything Task Manager's settings page has: start page, update speed, always on top, minimize when switching to an app, and theme. Plus start with Windows, the keyboard shortcut that opens SysLens, confirmations, notifications about problems, process columns, heat shading, full account names, privacy, network details and latency.
- At the bottom: the version, who made SysLens, the GitHub repository, the license and where to send feedback

### Everywhere
- **Right-click** works on almost everything: processes, services, startup entries, connections, files and folders, events, the sidebar, and anywhere else for quick actions
- **Ctrl+K** searches pages, running apps, services, startup entries and actions
- **Ctrl+Alt+Shift+S** opens SysLens from anywhere in Windows; opening it while it runs brings the window forward
- **Run new task** (Ctrl+N), **Restart Windows Explorer**, and **Copy system report** (Ctrl+Shift+C), a plain-text summary of your PC for asking someone for help
- Light, dark and black themes, and your Windows accent color when it's a color
- **Hide personal info** replaces your user and PC names and covers window titles and hardware IDs with solid bars, for screenshots you want to share
- **Notify me about problems** (optional): a Windows notification when something serious comes up while you're in another app
- Reconnects by itself after sleep, and restarts its own server if it ever crashes
- Shows what changed after each update; the full list is in [CHANGELOG.md](CHANGELOG.md)

SysLens never deletes anything. Storage shows where the space went and opens the folder for you. It only changes something when you ask it to (ending, pausing or reprioritizing a process, starting or stopping a service, turning a startup entry on or off), and it asks first for anything that could lose work.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/processes.png" alt="Processes grouped by app, with the details panel open"><br><sub><b>Processes.</b> Grouped by app, with a details panel for whatever you select.</sub></td>
    <td width="50%"><img src="docs/screenshots/menu.png" alt="The right-click menu on a process, with Set priority open"><br><sub><b>Right-click.</b> End task, end process tree, efficiency mode, priority, suspend and more.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/settings.png" alt="The Settings page"><br><sub><b>Settings.</b> Themes, colors, backgrounds, page order and everything Task Manager's settings have.</sub></td>
    <td><img src="docs/screenshots/overview-black.png" alt="Overview in the black theme"><br><sub><b>Black theme.</b> True black for OLED screens.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/users.png" alt="The Users page"><br><sub><b>Users.</b> Who is signed in and what each session uses.</sub></td>
    <td><img src="docs/screenshots/devices.png" alt="The Devices page"><br><sub><b>Devices.</b> Problem devices, every driver and the kernel drivers in memory.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/tools.png" alt="The Tools page"><br><sub><b>Tools.</b> Quick fixes and every Windows tool worth knowing.</sub></td>
    <td><img src="docs/screenshots/admin.png" alt="The Run as administrator confirmation"><br><sub><b>Run as administrator</b> asks first and lists what it lets you do.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/memory.png" alt="The Memory page"><br><sub><b>Memory.</b> Every byte of RAM accounted for and explained.</sub></td>
    <td><img src="docs/screenshots/network.png" alt="The Network page with network details hidden"><br><sub><b>Network.</b> Adapters, listening ports and connections per app, with your network details hidden.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/history.png" alt="The History page"><br><sub><b>History.</b> When the PC was on, asleep or off this week, and what happened.</sub></td>
    <td><img src="docs/screenshots/startup.png" alt="The Startup apps page"><br><sub><b>Startup apps.</b> What starts with Windows, what it costs, and a switch for each.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/system.png" alt="The System page"><br><sub><b>System.</b> Hardware, Windows, battery health and security in one place.</sub></td>
    <td><img src="docs/screenshots/services.png" alt="The Services page"><br><sub><b>Services.</b> Who made each service, what it costs, and start, stop or restart it.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/power.png" alt="Performance, Power"><br><sub><b>Performance › Power.</b> Watts per component and per core, and temperature.</sub></td>
    <td><img src="docs/screenshots/performance.png" alt="Performance, CPU"><br><sub><b>Performance › CPU.</b> Every logical processor, Task Manager style.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/storage.png" alt="The Storage page"><br><sub><b>Storage.</b> Drives and the places space usually goes.</sub></td>
    <td><img src="docs/screenshots/search.png" alt="Ctrl+K search"><br><sub><b>Ctrl+K.</b> One search for apps, services, startup entries, pages and actions.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/background.png" alt="Processes with one of your own pictures as the background"><br><sub><b>Backgrounds.</b> Your own pictures, or Aurora, Dusk, Mesh, Dots and Grid.</sub></td>
    <td><img src="docs/screenshots/overview-light.png" alt="Overview in the light theme"><br><sub><b>Light theme.</b> Follows Windows, or pick one.</sub></td>
  </tr>
</table>

<sub>Taken on a Lenovo Legion 5 laptop with <b>Hide personal info</b> turned on.</sub>

## Download the beta

**[Download SysLens Beta 1.4.5](https://github.com/seoedw/syslens-the-better-task-manager/releases/latest/download/SysLens-Beta-1.4.5-portable.zip)** (`SysLens-Beta-1.4.5-portable.zip`, 38 MB), or pick it from **[Releases](https://github.com/seoedw/syslens-the-better-task-manager/releases)**. **It brings its own Node.js, so there's nothing else to install.**

1. Right-click the zip, choose **Properties**, tick **Unblock** if it's there, and click OK. (Windows marks downloaded files; this keeps it from asking about each one.)
2. Unzip it somewhere permanent, such as Documents.
3. Double-click **Install SysLens.cmd**. It adds SysLens to the desktop and Start menu with the **Ctrl+Alt+Shift+S** shortcut, and opens it. Or double-click **SysLens.cmd** to just open it.
4. Want it on the taskbar? Right-click SysLens's taskbar button and choose **Pin to taskbar**: that pins SysLens itself, with its own icon.

There's no .exe on purpose: Windows' Smart App Control blocks any program that isn't signed with a code-signing certificate from a trusted provider (a paid, identity-checked certificate; a home-made one doesn't count), and SmartScreen warns about unsigned ones everywhere else. SysLens runs on Node.js and Microsoft Edge, which are signed, so it works even with Smart App Control on.

## Install

**You need**
- Windows 10 or 11 (64-bit)
- [Node.js](https://nodejs.org) 20 or newer, unless you use the portable build below
- Microsoft Edge (built into Windows) or Google Chrome, which SysLens uses as its window

**Get it**

```bash
git clone https://github.com/seoedw/syslens-the-better-task-manager.git SysLens
cd SysLens
npm install
npm run shortcut
```

`npm run shortcut` adds SysLens to your desktop and Start menu, so you can open it like any other app, and gives it the keyboard shortcut **Ctrl+Alt+Shift+S** (change it in Settings). Clone it somewhere permanent first (Documents is fine), because the shortcuts point into that folder.

<details>
<summary>On a PC without Node.js: the portable build</summary>

On a PC that has Node.js, run `npm run portable`. It builds `dist\SysLens-1.3.0-portable.zip`: SysLens with its own copy of Node.js (the signed `node.exe` from your PC, so Smart App Control still trusts it). On the other PC, unzip it somewhere permanent and double-click `SysLens.cmd`, or run `scripts\install-shortcut.ps1 -Desktop` in that folder for the shortcuts. Nothing else to install.

</details>

<details>
<summary>Other ways to start it</summary>

- Double-click `SysLens.cmd` in the folder. It installs the dependencies the first time.
- From a terminal: `npm start`.
- For development: `npm run dev` runs the server without a window and prints its address.

</details>

<details>
<summary>Update or uninstall</summary>

**Update:** run `git pull` in the folder, then reopen SysLens. It shows what changed the first time it opens.

**Uninstall:** turn off **Start SysLens when I sign in** in Settings if you turned it on, then delete the folder, the two SysLens shortcuts (desktop and Start menu), and `%LOCALAPPDATA%\SysLens`, which holds your settings, the window's browser profiles and the log.

</details>

**Run as administrator.** Without admin rights, Windows hides a few things (the full paths and command lines of some system processes, and a few protected folders) and won't let you start or stop most services or change other users' processes. Click **Run as administrator** in the sidebar: SysLens first lists everything administrator mode lets you do and asks you to confirm, then opens again as administrator in a new window, and the old one closes. Once it's administrator, clicking **Running as administrator** shows that list again, and **Back to normal mode** (right under it, in that list, or in Ctrl+K search) asks first, listing what stops working, then opens SysLens in a normal window again and closes the administrator one.

**Updates take effect when you reopen SysLens.** If a newer SysLens is opened while an older one is still running (or one whose window you just closed), the old one steps aside and the new version starts.

## Keyboard shortcuts

| Keys | What it does |
|---|---|
| `Ctrl` + `Alt` + `Shift` + `S` | Open SysLens from anywhere in Windows (change it in Settings) |
| `Ctrl` + `K` | Search everything |
| `Ctrl` + `1` … `Ctrl` + `0` | Go to the pages in your sidebar order (by default Overview, Performance, Processes, Memory, Network, Storage, Startup apps, Services, History, System) |
| `Ctrl` + `,` | Settings |
| `Ctrl` + `N` | Run new task |
| `Ctrl` + `Shift` + `C` | Copy a system report |
| `F11` | Full screen (change the shortcut in Settings) |
| `?` | Show the keyboard shortcuts |
| `Ctrl` + `F` or `/` | Search the process list |
| `↑` `↓` | Move through processes or services |
| `Enter`, `←` `→` | Expand or collapse an app |
| `Shift` + `F10` or the Menu key | Right-click menu for the selected row |
| `Del` | End the selected task (asks first); for Windows Explorer, restart it |
| `Shift` + `Del` | End the selected process and everything it started |
| `Ctrl` + `C` | Copy the selected process's name |
| `Esc` | Clear the search, or close the details panel |

## FAQ

### Why doesn't Task Manager add up?
Task Manager's process list counts each app's private memory. The rest of "in use" belongs to no process: compressed pages, RAM borrowed by the graphics chip, memory used by drivers, the file cache, and memory the firmware reserves before Windows starts. SysLens measures each of those and shows them side by side, so the parts add up to the total.

### Does SysLens change anything on my PC?
Only when you ask it to. Ending, suspending or changing the priority or efficiency mode of a process, starting or stopping a service, changing its startup type, and turning a startup entry on or off are all things you pick from a button or a right-click, and anything that could lose work asks first. Critical Windows processes are protected. SysLens never deletes files.

### Can someone see my network details in a screenshot?
No. **Hide network details** is on unless you turn it off: SysLens's server keeps your Wi-Fi name, IP and MAC addresses, gateway, DNS servers and the addresses your apps connect to out of the window entirely, and draws solid blocks in their place. Since the page never receives them, they can't be read from the screen, a screenshot, a copy or the page itself.

### Does it send data anywhere?
No. The server listens on `127.0.0.1` only, and nothing leaves your PC. It looks up the host names of servers your apps connect to through the DNS server you already use (you can turn that off), and **Search online** opens a web search in your browser when you ask for one. If you turn on **Measure internet latency**, it opens a connection to Cloudflare's 1.1.1.1 every 5 seconds without sending anything.

### How much memory does SysLens use?
About 180 MB in all on the laptop in the screenshots (1.3), a minute after opening: about 127 MB for the window, 39 MB for the server and 14 MB for the small launcher that restarts it if it ever crashes (the first version used 562 MB). **System › About SysLens** shows the live number. The window is a Microsoft Edge app window with software rendering inside its main process, no extensions or background services, and small JavaScript and drawing caches. That saves about 270 MB compared with a normal Edge window. Pages you leave give back their tables and chart buffers, and lists read for a page are let go after 10 idle minutes. A bigger window (or a maximized one on a high-resolution screen) needs a little more for its drawing buffers.

### Why Node.js and an Edge window instead of a normal .exe?
Windows' Smart App Control blocks unsigned programs, and a self-built desktop app is unsigned. Node.js and Edge are signed, so SysLens runs on PCs with Smart App Control turned on. The portable build (and the Beta download) carries its own signed copy of Node.js, so it needs nothing installed at all.

### Which apps does Task Manager restart instead of ending?
Windows Explorer. Task Manager turns its End task into Restart (Restart task in Windows 11), because Explorer is the taskbar, Start menu and desktop, and is meant to be restarted rather than left closed. SysLens does the same, and also offers **Restart app** for other desktop apps.

### Can the shortcut use the Fn key?
No. The Fn key is handled inside the keyboard itself and never reaches Windows, so no app can use it. SysLens uses **Ctrl+Alt+Shift+S**, a combination nothing else on a typical PC claims; pick another in **Settings › Behavior**.

### Where are my settings kept?
In `%LOCALAPPDATA%\SysLens\settings.json`, so they survive restarts and carry over to the administrator window. **Settings › About › Reset all settings** puts everything back.

### Why are power or temperature missing on my PC?
Power comes from energy meters that some processors expose to Windows (common on recent AMD and Intel laptops). Temperature comes from the ACPI thermal zone. If your PC doesn't report them, SysLens leaves those parts out instead of guessing.

### The window says "Connection lost"
It reconnects by itself after 1, 2 and 3 seconds, then every 5 seconds, even while minimized. **Retry now** tries straight away. A small launcher restarts the server if it ever crashes, on the same address, so the window carries on where it was. What happened is written to `%LOCALAPPDATA%\SysLens\syslens.log` (**Settings › About › Open the log**).

## How it works

SysLens reads the same sources Task Manager, Process Explorer and Resource Monitor use, mostly by calling Windows directly through [koffi](https://koffi.dev), with no native build step:

| Data | Source |
|---|---|
| Processes, private memory, CPU time, I/O, handles, threads, suspended state | `NtQuerySystemInformation(SystemProcessInformation)`: one call for every process and thread |
| Paths, command lines, versions, icons, user, integrity, architecture | `QueryFullProcessImageName`, `NtQueryInformationProcess`, `GetFileVersionInfo`, `PrivateExtractIcons`, process tokens, `IsWow64Process2` |
| Memory lists, kernel pools, file cache, commit | Performance counters (PDH): `\Memory\*` |
| GPU use and GPU memory per process and adapter | PDH: `\GPU Engine(*)`, `\GPU Process Memory(*)`, `\GPU Adapter Memory(*)` |
| CPU, disks, network | PDH: `\Processor Information(*)`, `\PhysicalDisk(*)`, `\Network Interface(*)` |
| Power, temperature, battery | PDH: `\Energy Meter(*)`, `\Thermal Zone Information(*)`; `GetSystemPowerStatus`; the battery report |
| Connections per app | `GetExtendedTcpTable` and `GetExtendedUdpTable` (the source TCPView uses); host names by reverse DNS |
| Folder sizes | `FindFirstFileExW` with large fetch, on a pool of worker threads |
| Startup apps, services, adapters, hardware, security | The registry, Task Scheduler and CIM, read through PowerShell when their page opens |
| History | The System and Application event logs |
| Devices and drivers | CIM: `Win32_PnPEntity` (problem codes), `Win32_PnPSignedDriver`, `Win32_SystemDriver` |

| Action | How |
|---|---|
| End task, End process tree | `TerminateProcess`, children first, each checked against the process it was when you clicked |
| Priority, efficiency mode | `SetPriorityClass`; `SetProcessInformation(ProcessPowerThrottling)` (EcoQoS), as Task Manager does |
| Suspend and resume | `NtSuspendProcess` and `NtResumeProcess` |
| Switch to, always on top | `SetForegroundWindow`, `SetWindowPos` |
| Services | `Start-Service`, `Stop-Service` and `Restart-Service`; `sc.exe config` for the startup type |
| Startup apps | The `StartupApproved` flags Task Manager and Settings use; the Store app's own startup state; `Enable-ScheduledTask` |
| Restart app | Ends the app's processes, then starts its program again with the arguments read from its own command line |
| Users | `WTSEnumerateSessions`, `WTSQuerySessionInformation`; `LockWorkStation`, `WTSDisconnectSession`, `WTSLogoffSession` |

The backend is plain Node.js. A small launcher starts the server and restarts it if it crashes or stops responding. The server serves the UI on `127.0.0.1`, opens it in an Edge (or Chrome) `--app` window with its own profile, and keeps running only while that window is open.

**Security**
- Listens on `127.0.0.1` only. Every request needs a random per-run token, which the window receives in the URL fragment, so it never crosses the network.
- Rejects requests whose `Host` isn't the local address (DNS rebinding) and anything that isn't JSON (cross-site form posts). Sends no CORS headers, and the page can't be framed by another site.
- Checks that a PID still belongs to the same process before acting on it.
- An administrator instance never writes its token to disk or hands it to the window that was already open: it opens its own elevated window, with a browser profile only administrators can change.
- Refuses network (UNC) paths, so SysLens never makes Windows sign in to another computer with your account.
- With **Hide network details** on (the default), network addresses and names are removed on the server, before anything is sent to the window.
- Background pictures are checked to be JPEGs and served only with the session token; only the tools and links on fixed lists can be opened.
- Service and startup changes accept only names from SysLens's own lists, and values from the page reach PowerShell as data (environment variables), never as code.
- Everything shown is escaped, and a strict Content-Security-Policy backs that up: the window runs only SysLens's own script files (no inline code, no `eval`), can't be put in a frame, and other sites can't load anything from SysLens. Each release is tested by feeding hostile HTML through every name, title, path and description SysLens shows; none of it may turn into page content.
- The window is an Edge app window with Edge's normal sandbox and security on, and it never goes to the internet: links open in your default browser.
- What SysLens can't protect against: a program already running in your account can do anything you can, including change SysLens's files. Run as administrator runs those same files with full rights, so only use it on a PC you trust.

<details>
<summary>Project layout</summary>

```
src/main/            backend (Node.js)
  launcher.js          starts the server and restarts it if it crashes or hangs
  instance.js          finds a running SysLens and brings its window forward
  server.js            HTTP server, live event stream, window and lifecycle
  settings.js          preferences, checked and saved in settings.json
  monitor.js           sampling loop, history, memory accounting, power and temperature
  processes.js         process table, grouping, details, end task, priority, efficiency, suspend
  network.js           connections per app, host names, adapters and Wi-Fi
  startup.js           everything that starts with Windows, and turning it on or off
  services.js          Windows services: list, start, stop, startup type
  history.js           the week's events and the on/sleep/off timeline
  machine.js           hardware, Windows, battery and security for the System page
  shell.js             Explorer, web search, Run new task, start with Windows, the app window
  appid.js             SysLens's own taskbar identity, so pinning pins SysLens and not Edge
  pdh.js, win32.js     performance counters and Windows API bindings
  insights.js          findings
  knowledge.js         "What is this?" explanations
  devices.js           devices with problems, drivers and kernel drivers
  storage/             drives, parallel folder scanner, apps, space hogs
src/renderer/        UI (plain HTML, CSS and JavaScript, no build step)
  js/menu.js           right-click menus
  js/actions.js        what the menus do, Run new task, system report, changelog
  js/views/            one file per page, including users, devices, tools and settings
scripts/             self-test, icon, shortcuts, portable build
docs/screenshots/    the images in this README
CHANGELOG.md         what changed in each version
LICENSE              MIT
```

`npm run selftest` prints what the collectors see, without the UI.

</details>

## Feedback

Found a bug, or have an idea? **DM `eward.s.asdfjkl` on Discord.** The same name is in SysLens's sidebar and in Settings › About (click it to copy).

## License

[MIT](LICENSE). Made by [seoedw](https://github.com/seoedw).

## Known limits

- Per-process network *speed* needs kernel tracing (ETW) and isn't shown. Connections per app are.
- Folders inside `C:\Windows\WinSxS` use hard links, so a folder scan counts some files more than once.
- Part of a drive's used space is invisible to any folder scan: restore points, shadow copies and NTFS metadata. SysLens shows how much.
- Per-process GPU memory includes surfaces shared with other apps, so those rows can add up to more than the total.
- CPU temperature on most desktops needs a kernel driver, which SysLens doesn't install.
- The keyboard shortcut works through SysLens's desktop and Start menu shortcuts, so it needs one of them to exist (`npm run shortcut`).

## Thanks

SysLens builds on ideas from Windows Task Manager, Sysinternals Process Explorer, TCPView and RAMMap, and WizTree. It calls Windows through [koffi](https://koffi.dev) by Niels Martignène. This README takes its shape from [Stats](https://github.com/exelban/stats), [btop](https://github.com/aristocratos/btop), [bottom](https://github.com/ClementTsang/bottom), [NeoHtop](https://github.com/Abdenasser/neohtop) and [PowerToys](https://github.com/microsoft/PowerToys).
