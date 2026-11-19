'use strict';
// Network details: every TCP/UDP endpoint with its owning process (GetExtendedTcpTable /
// GetExtendedUdpTable, the same source as TCPView and Resource Monitor), host names for the
// remote ends, and adapter details (addresses, gateway, DNS, Wi-Fi link).

const os = require('os');
const { Resolver } = require('dns').promises;
const { execFile } = require('child_process');
const w = require('./win32');
const { runPowerShellJson } = require('./powershell');

const AF_INET = 2;
const AF_INET6 = 23;
const TCP_STATES = [null, 'Closed', 'Listening', 'SYN sent', 'SYN received', 'Established', 'FIN wait 1', 'FIN wait 2', 'Close wait', 'Closing', 'Last ACK', 'Time wait', 'Delete TCB'];

// Well-known ports, so a row reads "443 (HTTPS)" rather than a bare number.
const SERVICES = {
  20: 'FTP data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 68: 'DHCP', 80: 'HTTP', 110: 'POP3',
  123: 'NTP', 135: 'RPC', 137: 'NetBIOS', 138: 'NetBIOS', 139: 'NetBIOS', 143: 'IMAP', 161: 'SNMP', 389: 'LDAP', 443: 'HTTPS',
  445: 'SMB', 465: 'SMTPS', 500: 'IPsec', 587: 'SMTP', 853: 'DNS over TLS', 993: 'IMAPS', 995: 'POP3S', 1080: 'SOCKS',
  1433: 'SQL Server', 1900: 'SSDP', 2049: 'NFS', 3000: 'Dev server', 3306: 'MySQL', 3389: 'Remote Desktop', 3478: 'STUN',
  4500: 'IPsec NAT-T', 5040: 'CDP', 5050: 'Dev server', 5173: 'Vite', 5222: 'XMPP', 5228: 'Google Play', 5353: 'mDNS',
  5355: 'LLMNR', 5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 7680: 'Delivery Optimization', 8000: 'Dev server',
  8080: 'HTTP alt', 8443: 'HTTPS alt', 9000: 'Dev server', 11434: 'Ollama', 27017: 'MongoDB', 27036: 'Steam',
};

function ip4(b, o) {
  return `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
}

function ip6(b, o) {
  const g = [];
  for (let i = 0; i < 8; i++) g.push(((b[o + i * 2] << 8) | b[o + i * 2 + 1]).toString(16));
  // IPv4-mapped (::ffff:a.b.c.d)
  if (g.slice(0, 5).every((x) => x === '0') && g[5] === 'ffff') return `::ffff:${ip4(b, o + 12)}`;
  // Collapse the longest run of zero groups.
  let best = [-1, 0];
  for (let i = 0; i < 8; ) {
    if (g[i] !== '0') {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === '0') j++;
    if (j - i > best[1]) best = [i, j - i];
    i = j;
  }
  if (best[1] < 2) return g.join(':');
  const head = g.slice(0, best[0]).join(':');
  const tail = g.slice(best[0] + best[1]).join(':');
  return `${head}::${tail}`;
}

const port = (b, o) => (b[o] << 8) | b[o + 1];

function readEndpoints() {
  const out = [];
  let b = w.endpointTable('tcp', AF_INET);
  if (b) {
    const n = b.readUInt32LE(0);
    for (let i = 0; i < n; i++) {
      const o = 4 + i * 24;
      if (o + 24 > b.length) break;
      out.push({ proto: 'TCP', state: TCP_STATES[b.readUInt32LE(o)] || 'Unknown', local: ip4(b, o + 4), lport: port(b, o + 8), remote: ip4(b, o + 12), rport: port(b, o + 16), pid: b.readUInt32LE(o + 20), v6: false });
    }
  }
  b = w.endpointTable('tcp', AF_INET6);
  if (b) {
    const n = b.readUInt32LE(0);
    for (let i = 0; i < n; i++) {
      const o = 4 + i * 56;
      if (o + 56 > b.length) break;
      out.push({ proto: 'TCP', state: TCP_STATES[b.readUInt32LE(o + 48)] || 'Unknown', local: ip6(b, o), lport: port(b, o + 20), remote: ip6(b, o + 24), rport: port(b, o + 44), pid: b.readUInt32LE(o + 52), v6: true });
    }
  }
  b = w.endpointTable('udp', AF_INET);
  if (b) {
    const n = b.readUInt32LE(0);
    for (let i = 0; i < n; i++) {
      const o = 4 + i * 12;
      if (o + 12 > b.length) break;
      out.push({ proto: 'UDP', state: '', local: ip4(b, o), lport: port(b, o + 4), remote: '', rport: 0, pid: b.readUInt32LE(o + 8), v6: false });
    }
  }
  b = w.endpointTable('udp', AF_INET6);
  if (b) {
    const n = b.readUInt32LE(0);
    for (let i = 0; i < n; i++) {
      const o = 4 + i * 28;
      if (o + 28 > b.length) break;
      out.push({ proto: 'UDP', state: '', local: ip6(b, o), lport: port(b, o + 20), remote: '', rport: 0, pid: b.readUInt32LE(o + 24), v6: true });
    }
  }
  return out;
}

/** Private, loopback, link-local and unspecified addresses have no useful host name. */
function isPublic(ip) {
  if (!ip || ip === '0.0.0.0' || ip === '::' || ip === '::1') return false;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const m = /^(\d+)\.(\d+)\./.exec(v4);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return !(a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
  }
  return !/^(fe80|fc|fd|ff)/i.test(ip);
}

class NetworkService {
  constructor() {
    this.names = new Map(); // ip -> host name | '' (none) | null (pending)
    this.queue = [];
    this.active = 0;
    this.resolver = new Resolver({ timeout: 2500, tries: 1 });
    this.adapters = null;
    this.adaptersAt = 0;
    this.adaptersLoading = null;
  }

  resolveLater(ip) {
    if (this.names.has(ip)) return;
    if (this.names.size >= 2000) {
      // Forget the oldest names instead of growing forever (or no longer resolving new ones).
      let n = 0;
      for (const [k, v] of this.names) {
        if (v === null) continue; // still being looked up
        this.names.delete(k);
        if (++n >= 500) break;
      }
    }
    this.names.set(ip, null);
    this.queue.push(ip);
    this.pump();
  }

  pump() {
    while (this.active < 4 && this.queue.length) {
      const ip = this.queue.shift();
      this.active++;
      this.resolver
        .reverse(ip.startsWith('::ffff:') ? ip.slice(7) : ip)
        .then((names) => this.names.set(ip, (names && names[0]) || ''))
        .catch(() => this.names.set(ip, ''))
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  /** All endpoints, optionally for one process; remote host names fill in over a few seconds. */
  connections({ pid = null, resolve = true } = {}) {
    let list = readEndpoints();
    if (pid != null) list = list.filter((c) => c.pid === pid);
    for (const c of list) {
      c.service = SERVICES[c.state === 'Listening' || c.proto === 'UDP' ? c.lport : c.rport] || '';
      if (c.state === 'Established' && isPublic(c.remote)) {
        if (resolve) this.resolveLater(c.remote);
        const n = this.names.get(c.remote);
        if (n) c.host = n;
      }
    }
    return list;
  }

  /** Adapters with addresses, gateway, DNS and Wi-Fi details. Cached for 20 seconds. */
  async adapterInfo(refresh = false) {
    if (!refresh && this.adapters && Date.now() - this.adaptersAt < 20000) return this.adapters;
    if (!this.adaptersLoading) {
      this.adaptersLoading = Promise.all([runPowerShellJson(ADAPTERS_SCRIPT, 30000), wlanInterfaces()])
        .then(([raw, wifi]) => {
          this.adapters = shapeAdapters(raw, wifi);
          this.adaptersAt = Date.now();
          return this.adapters;
        })
        .finally(() => {
          this.adaptersLoading = null;
        });
    }
    return this.adaptersLoading;
  }
}

const ADAPTERS_SCRIPT = `
$ad = @(Get-CimInstance -Namespace root\\StandardCimv2 -ClassName MSFT_NetAdapter | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.Name; desc = [string]$_.InterfaceDescription; status = [int]$_.InterfaceOperationalStatus; speed = [int64]$_.Speed; mac = [string]$_.PermanentAddress; media = [int]$_.NdisPhysicalMedium; virtual = [bool]$_.Virtual; hidden = [bool]$_.Hidden; index = [int]$_.InterfaceIndex; driver = [string]$_.DriverVersionString; mtu = [int]$_.MtuSize }
})
$routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0','::/0' -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ index = [int]$_.InterfaceIndex; hop = [string]$_.NextHop; metric = [int]$_.RouteMetric } })
$dns = @(Get-DnsClientServerAddress -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses } | ForEach-Object { [pscustomobject]@{ index = [int]$_.InterfaceIndex; servers = @($_.ServerAddresses) } })
$dhcp = @(Get-NetIPInterface -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ index = [int]$_.InterfaceIndex; dhcp = ([string]$_.Dhcp -eq 'Enabled') } })
[pscustomobject]@{ adapters = $ad; routes = $routes; dns = $dns; dhcp = $dhcp } | ConvertTo-Json -Depth 4 -Compress
`;

/** "netsh wlan show interfaces": SSID, signal, band, channel, radio type and link rates. */
function wlanInterfaces() {
  return new Promise((resolve) => {
    execFile('netsh.exe', ['wlan', 'show', 'interfaces'], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const list = [];
      let cur = null;
      for (const line of stdout.split(/\r?\n/)) {
        const m = /^\s{4}([^:]+?)\s*:\s(.*)$/.exec(line);
        if (!m) continue;
        const key = m[1].trim().toLowerCase();
        const val = m[2].trim();
        if (key === 'name') {
          cur = { name: val };
          list.push(cur);
        } else if (cur) {
          if (key === 'state') cur.state = val;
          else if (key === 'ssid') cur.ssid = val;
          else if (key === 'signal') cur.signal = parseInt(val, 10);
          else if (key === 'band') cur.band = val;
          else if (key === 'channel') cur.channel = val;
          else if (key === 'radio type') cur.radio = val;
          else if (key === 'authentication') cur.auth = val;
          else if (key.startsWith('receive rate')) cur.rx = parseFloat(val);
          else if (key.startsWith('transmit rate')) cur.tx = parseFloat(val);
        }
      }
      resolve(list);
    });
  });
}

const STATUS = { 1: 'Connected', 2: 'Disconnected', 3: 'Testing', 4: 'Unknown', 5: 'Dormant', 6: 'Not present', 7: 'Disconnected' };
const WIFI_STANDARD = { '802.11ax': 'Wi-Fi 6', '802.11be': 'Wi-Fi 7', '802.11ac': 'Wi-Fi 5', '802.11n': 'Wi-Fi 4' };

function mediaType(a) {
  if (a.media === 9 || a.media === 1) return 'Wi-Fi';
  if (a.media === 14) return 'Ethernet';
  if (a.media === 10) return 'Bluetooth';
  if (a.media === 8) return 'Cellular';
  return a.virtual ? 'Virtual' : 'Other';
}

function shapeAdapters(raw, wifi) {
  const ifs = os.networkInterfaces();
  const list = [];
  for (const a of (raw && [].concat(raw.adapters || [])) || []) {
    if (a.hidden) continue;
    const addrs = (ifs[a.name] || []).filter((x) => !x.internal);
    const route = [].concat(raw.routes || []).filter((r) => r.index === a.index).sort((x, y) => x.metric - y.metric);
    const dns = [].concat(raw.dns || []).filter((d) => d.index === a.index).flatMap((d) => [].concat(d.servers || []));
    const dhcp = [].concat(raw.dhcp || []).find((d) => d.index === a.index);
    const wl = wifi.find((x) => x.name === a.name);
    const type = mediaType(a);
    list.push({
      name: a.name,
      description: a.desc,
      type,
      status: STATUS[a.status] || 'Unknown',
      up: a.status === 1,
      speed: a.speed > 0 && a.speed < 1e13 ? a.speed : 0,
      mac: (a.mac || '').replace(/(..)(?!$)/g, '$1-'),
      virtual: a.virtual,
      driver: a.driver || '',
      mtu: a.mtu || 0,
      ipv4: addrs.filter((x) => x.family === 'IPv4').map((x) => x.cidr || x.address),
      ipv6: addrs.filter((x) => x.family === 'IPv6' && !/^fe80/i.test(x.address)).map((x) => x.address),
      linkLocal: addrs.filter((x) => x.family === 'IPv6' && /^fe80/i.test(x.address)).map((x) => x.address),
      gateway: [...new Set(route.map((r) => r.hop).filter((h) => h && h !== '0.0.0.0' && h !== '::'))],
      dns: [...new Set(dns)],
      dhcp: dhcp ? dhcp.dhcp : null,
      wifi: wl && wl.ssid
        ? { ssid: wl.ssid, signal: wl.signal, band: wl.band || '', channel: wl.channel || '', radio: wl.radio || '', standard: WIFI_STANDARD[wl.radio] || '', auth: wl.auth || '', rx: wl.rx || 0, tx: wl.tx || 0 }
        : null,
    });
  }
  // Connected first, then real hardware, then by name.
  list.sort((x, y) => Number(y.up) - Number(x.up) || Number(x.virtual) - Number(y.virtual) || x.name.localeCompare(y.name));
  return { list, at: Date.now() };
}

// ---------- hiding network details ----------
// With "Hide network details" (or "Hide personal info") on, these never leave the server:
// the window can't show what it never receives, so nothing can be read from it either. Not one
// IP address goes across, not even 127.0.0.1: a port listening on every network or only for
// this PC is sent as that fact ('any' or 'pc'), which the window shows in words.
const isLoop = (ip) => /^127\.|^::1$|^::ffff:127\./.test(ip || '');
const scopeOf = (ip) => (ip === '0.0.0.0' || ip === '::' || ip === '*' ? 'any' : isLoop(ip) ? 'pc' : null);

// Addresses inside free text (command lines, window titles, startup commands, service paths).
// IPv4 first, so an IPv4 address written inside an IPv6 one (::ffff:192.168.1.5) goes whole.
// A four-part version number whose parts are all 255 or less looks exactly like an IPv4
// address and is hidden too; versions with a bigger part (most of them) are left alone.
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_TEXT = new RegExp(`(?<![\\d.])(?:${OCTET}\\.){3}${OCTET}(?!\\d|\\.\\d)`, 'g');
const HEX = '[0-9a-f]{1,4}';
const IPV6_TEXT = new RegExp(`(?<![\\w:.])(?:(?:${HEX}:){7}${HEX}|(?:${HEX}:){1,7}:(?:${HEX}(?::${HEX}){0,6})?|::${HEX}(?::${HEX}){0,6})(?:%\\w+)?(?![\\w:.])`, 'gi');
const MAC_TEXT = /(?<![\w:-])(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}(?![\w:-])/gi;
const HIDDEN_TEXT = '[address hidden]';

function scrubText(s) {
  if (typeof s !== 'string' || !s) return s;
  return s.replace(MAC_TEXT, HIDDEN_TEXT).replace(IPV4_TEXT, HIDDEN_TEXT).replace(IPV6_TEXT, HIDDEN_TEXT);
}

function redactAdapters(data) {
  if (!data || !Array.isArray(data.list)) return data;
  const hide = (arr) => (Array.isArray(arr) ? arr.map(() => null) : []);
  return {
    ...data,
    redacted: true,
    list: data.list.map((a) => ({
      ...a,
      mac: a.mac ? null : '',
      ipv4: hide(a.ipv4),
      ipv6: hide(a.ipv6),
      linkLocal: hide(a.linkLocal),
      gateway: hide(a.gateway),
      dns: hide(a.dns),
      wifi: a.wifi ? { ...a.wifi, ssid: null, auth: null } : null,
    })),
  };
}

function redactConnections(list) {
  if (!Array.isArray(list)) return list;
  return list.map((c) => ({
    ...c,
    loop: isLoop(c.remote) || (c.state === 'Listening' && isLoop(c.local)),
    remote: null,
    remoteScope: scopeOf(c.remote),
    host: null,
    local: null,
    localScope: scopeOf(c.local),
    redacted: true,
  }));
}

module.exports = { NetworkService, isPublic, redactAdapters, redactConnections, scrubText };
