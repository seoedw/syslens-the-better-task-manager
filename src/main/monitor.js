'use strict';
// Samples everything once per interval and assembles the snapshot the UI renders.

const { EventEmitter } = require('events');
const w = require('./win32');
const { PdhQuery } = require('./pdh');
const { ProcessMonitor } = require('./processes');
const { buildInsights } = require('./insights');

const COUNTERS = {
  'cpu.total': '\\Processor Information(_Total)\\% Processor Utility',
  'cpu.cores': '\\Processor Information(*)\\% Processor Utility',
  'cpu.freq': '\\Processor Information(_Total)\\Processor Frequency',
  'cpu.perf': '\\Processor Information(_Total)\\% Processor Performance',
  'cpu.ctx': '\\System\\Context Switches/sec',
  'mem.standbyCore': '\\Memory\\Standby Cache Core Bytes',
  'mem.standbyNormal': '\\Memory\\Standby Cache Normal Priority Bytes',
  'mem.standbyReserve': '\\Memory\\Standby Cache Reserve Bytes',
  'mem.free': '\\Memory\\Free & Zero Page List Bytes',
  'mem.modified': '\\Memory\\Modified Page List Bytes',
  'mem.nonpaged': '\\Memory\\Pool Nonpaged Bytes',
  'mem.pagedResident': '\\Memory\\Pool Paged Resident Bytes',
  'mem.paged': '\\Memory\\Pool Paged Bytes',
  'mem.cacheResident': '\\Memory\\System Cache Resident Bytes',
  'mem.codeResident': '\\Memory\\System Code Resident Bytes',
  'mem.driverResident': '\\Memory\\System Driver Resident Bytes',
  'mem.committed': '\\Memory\\Committed Bytes',
  'mem.commitLimit': '\\Memory\\Commit Limit',
  'mem.pageReads': '\\Memory\\Page Reads/sec',
  'mem.pageWrites': '\\Memory\\Page Writes/sec',
  'page.usage': '\\Paging File(_Total)\\% Usage',
  'disk.idle': '\\PhysicalDisk(*)\\% Idle Time',
  'disk.read': '\\PhysicalDisk(*)\\Disk Read Bytes/sec',
  'disk.write': '\\PhysicalDisk(*)\\Disk Write Bytes/sec',
  'disk.latency': '\\PhysicalDisk(*)\\Avg. Disk sec/Transfer',
  'net.recv': '\\Network Interface(*)\\Bytes Received/sec',
  'net.sent': '\\Network Interface(*)\\Bytes Sent/sec',
  'net.bw': '\\Network Interface(*)\\Current Bandwidth',
  'gpu.engine': '\\GPU Engine(*)\\Utilization Percentage',
  'gpu.procShared': '\\GPU Process Memory(*)\\Shared Usage',
  'gpu.procDedicated': '\\GPU Process Memory(*)\\Dedicated Usage',
  'gpu.adapterShared': '\\GPU Adapter Memory(*)\\Shared Usage',
  'gpu.adapterDedicated': '\\GPU Adapter Memory(*)\\Dedicated Usage',
};

const RE_ENGINE = /^pid_(\d+)_luid_(0x[0-9a-f]+)_(0x[0-9a-f]+)_phys_(\d+)_eng_(\d+)_engtype_(.*)$/i;
const RE_PROC_MEM = /^pid_(\d+)_luid_(0x[0-9a-f]+)_(0x[0-9a-f]+)_phys_(\d+)$/i;
const RE_ADAPTER = /^luid_(0x[0-9a-f]+)_(0x[0-9a-f]+)_phys_(\d+)$/i;
const HISTORY = 120;

const adapterKey = (hi, lo) => `${hi.toLowerCase()}_${lo.toLowerCase()}`;

class History {
  constructor(len) {
    this.len = len;
    this.series = {};
  }

  push(values) {
    for (const key of Object.keys(values)) {
      if (!this.series[key]) this.series[key] = new Array(this.len).fill(null);
    }
    for (const [key, arr] of Object.entries(this.series)) {
      const v = values[key];
      arr.push(v === undefined ? null : v);
      if (arr.length > this.len) arr.shift();
    }
  }
}

class Monitor extends EventEmitter {
  constructor() {
    super();
    this.pdh = new PdhQuery();
    for (const [key, path] of Object.entries(COUNTERS)) this.pdh.add(key, path);
    this.procs = new ProcessMonitor();
    this.history = new History(HISTORY);
    this.interval = 1000;
    this.paused = false;
    this.timer = null;
    this.sys = null;
    this.installed = w.installedMemory();
    this.admin = w.isAdmin();
    this.activeNets = new Set();
    this.latest = null;
    this.tick = 0;
  }

  setSystemInfo(sys) {
    this.sys = sys;
  }

  start() {
    this.pdh.collect();
    this.procs.sample();
    this.timer = setTimeout(() => this.loop(), 500);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  setInterval(ms) {
    this.paused = ms <= 0;
    if (ms > 0) this.interval = Math.max(250, Math.min(10000, ms));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.loop(), this.paused ? 1000 : 50);
  }

  loop() {
    const started = Date.now();
    if (!this.paused) {
      try {
        this.latest = this.sample();
        this.emit('snapshot', this.latest);
      } catch (err) {
        this.emit('error', err);
      }
    }
    // While the window is minimized, sample slowly to stay out of the way.
    const interval = this.background ? Math.max(this.interval, 5000) : this.interval;
    const wait = this.paused ? 1000 : Math.max(100, interval - (Date.now() - started));
    this.timer = setTimeout(() => this.loop(), wait);
  }

  setBackground(background) {
    const wasBackground = this.background;
    this.background = !!background;
    if (wasBackground && !this.background) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.loop(), 50);
    }
  }

  gpuSample() {
    const perPid = new Map();
    const engines = new Map();
    const adapters = new Map();
    const getPid = (pid) => {
      let p = perPid.get(pid);
      if (!p) perPid.set(pid, (p = { util: 0, shared: 0, dedicated: 0, engines: new Map() }));
      return p;
    };
    const getAdapter = (key) => {
      let a = adapters.get(key);
      if (!a) adapters.set(key, (a = { key, util: 0, types: {}, shared: 0, dedicated: 0 }));
      return a;
    };
    for (const { name, value } of this.pdh.array('gpu.engine')) {
      const m = RE_ENGINE.exec(name);
      if (!m) continue;
      const ak = adapterKey(m[2], m[3]);
      const ek = `${ak}|${m[4]}|${m[5]}`;
      let e = engines.get(ek);
      if (!e) engines.set(ek, (e = { adapter: ak, type: m[6], util: 0 }));
      e.util += value;
      const p = getPid(Number(m[1]));
      p.engines.set(ek, (p.engines.get(ek) || 0) + value);
    }
    for (const p of perPid.values()) {
      for (const v of p.engines.values()) p.util = Math.max(p.util, v);
      p.util = Math.min(100, p.util);
      delete p.engines;
    }
    for (const e of engines.values()) {
      const a = getAdapter(e.adapter);
      const util = Math.min(100, e.util);
      a.util = Math.max(a.util, util);
      a.types[e.type] = Math.max(a.types[e.type] || 0, util);
    }
    for (const [counter, field] of [['gpu.procShared', 'shared'], ['gpu.procDedicated', 'dedicated']]) {
      for (const { name, value } of this.pdh.array(counter)) {
        const m = RE_PROC_MEM.exec(name);
        if (m) getPid(Number(m[1]))[field] += value;
      }
    }
    for (const [counter, field] of [['gpu.adapterShared', 'shared'], ['gpu.adapterDedicated', 'dedicated']]) {
      for (const { name, value } of this.pdh.array(counter)) {
        const m = RE_ADAPTER.exec(name);
        if (m) getAdapter(adapterKey(m[1], m[2]))[field] += value;
      }
    }
    const known = (this.sys && this.sys.gpus) || {};
    const list = [];
    for (const a of adapters.values()) {
      const info = known[a.key];
      // Skip software/placeholder adapters that never do anything.
      if (!info && a.util < 0.5 && a.shared < 1 << 20 && a.dedicated < 1 << 20) continue;
      if (info && /Basic Render/i.test(info.name) && a.util < 0.5 && a.shared < 16 << 20) continue;
      list.push({
        key: a.key,
        name: info ? info.name : 'GPU',
        util: a.util,
        types: a.types,
        shared: a.shared,
        dedicated: a.dedicated,
        dedicatedTotal: info ? info.dedicatedTotal : 0,
        sharedTotal: info ? info.sharedTotal : 0,
      });
    }
    list.sort((x, y) => y.shared + y.dedicated - (x.shared + x.dedicated));
    return { perPid, adapters: list, sharedTotal: list.reduce((s, a) => s + a.shared, 0) };
  }

  cpuSample() {
    const cores = this.pdh
      .array('cpu.cores')
      .filter((c) => !c.name.includes('_Total'))
      .map((c) => {
        const [group, idx] = c.name.split(',').map(Number);
        return { order: group * 1000 + idx, value: Math.min(100, c.value) };
      })
      .sort((a, b) => a.order - b.order)
      .map((c) => c.value);
    const freq = this.pdh.value('cpu.freq') || 0;
    const perf = this.pdh.value('cpu.perf');
    return {
      total: Math.min(100, this.pdh.value('cpu.total') || 0),
      cores,
      baseMHz: freq,
      speedMHz: perf != null ? (freq * perf) / 100 : freq,
      contextSwitches: this.pdh.value('cpu.ctx') || 0,
    };
  }

  diskSample() {
    const byName = new Map();
    const get = (name) => {
      if (!byName.has(name)) byName.set(name, { name, active: 0, read: 0, write: 0, latency: 0 });
      return byName.get(name);
    };
    for (const { name, value } of this.pdh.array('disk.idle')) get(name).active = Math.max(0, Math.min(100, 100 - value));
    for (const { name, value } of this.pdh.array('disk.read')) get(name).read = value;
    for (const { name, value } of this.pdh.array('disk.write')) get(name).write = value;
    for (const { name, value } of this.pdh.array('disk.latency')) get(name).latency = value * 1000;
    const known = (this.sys && this.sys.disks) || {};
    return [...byName.values()]
      .filter((d) => d.name !== '_Total')
      .map((d) => {
        const [num, ...rest] = d.name.split(' ');
        const info = known[num] || {};
        const letters = rest.join(' ') || (info.letters || []).join(' ');
        return {
          ...d,
          key: `disk${num}`,
          number: Number(num),
          letters,
          model: info.model || '',
          media: info.media || '',
          bus: info.bus || '',
          size: info.size || 0,
        };
      })
      .sort((a, b) => a.number - b.number);
  }

  netSample() {
    const byName = new Map();
    const get = (name) => {
      if (!byName.has(name)) byName.set(name, { name, recv: 0, sent: 0, bandwidth: 0 });
      return byName.get(name);
    };
    for (const { name, value } of this.pdh.array('net.recv')) get(name).recv = value;
    for (const { name, value } of this.pdh.array('net.sent')) get(name).sent = value;
    for (const { name, value } of this.pdh.array('net.bw')) get(name).bandwidth = value;
    const out = [];
    for (const n of byName.values()) {
      if (n.recv + n.sent > 0) this.activeNets.add(n.name);
      // Filter instances like "Wi-Fi _2" (WFP/QoS filter copies) unless they carry traffic.
      const isCopy = /\s_\d+$/.test(n.name);
      if (this.activeNets.has(n.name) || (!isCopy && n.bandwidth > 0)) {
        out.push({ ...n, key: `net:${n.name}`, label: n.name.replace(/\[/g, '(').replace(/\]/g, ')') });
      }
    }
    return out.sort((a, b) => b.recv + b.sent - (a.recv + a.sent) || a.name.localeCompare(b.name));
  }

  memorySample(procs, gpu) {
    const ms = w.memoryStatus();
    const v = (k) => this.pdh.value(k) || 0;
    let compression = 0;
    let apps = 0;
    for (const p of procs) {
      if (p.exe === 'memory compression') compression += p.priv;
      else apps += p.priv;
    }
    const total = ms.totalPhys;
    const available = ms.availPhys;
    const inUse = total - available;
    const standby = Math.min(available, v('mem.standbyCore') + v('mem.standbyNormal') + v('mem.standbyReserve'));
    const free = Math.max(0, available - standby);
    const parts = [
      { key: 'apps', bytes: apps },
      { key: 'compression', bytes: compression },
      { key: 'gpu', bytes: gpu.sharedTotal },
      { key: 'nonpaged', bytes: v('mem.nonpaged') },
      { key: 'paged', bytes: v('mem.pagedResident') },
      { key: 'filecache', bytes: v('mem.cacheResident') },
      { key: 'kernelcode', bytes: v('mem.codeResident') + v('mem.driverResident') },
      { key: 'modified', bytes: v('mem.modified') },
    ];
    const measured = parts.reduce((s, p) => s + p.bytes, 0);
    const other = inUse - measured;
    parts.push({ key: 'other', bytes: Math.max(0, other) });
    const committed = v('mem.committed') || ms.totalPageFile - ms.availPageFile;
    const commitLimit = v('mem.commitLimit') || ms.totalPageFile;
    return {
      installed: this.installed || total,
      total,
      hardwareReserved: Math.max(0, (this.installed || total) - total),
      inUse,
      available,
      standby,
      free,
      parts,
      overlap: other < 0 ? -other : 0,
      committed,
      commitLimit,
      pageFile: Math.max(0, commitLimit - total),
      pageFileUsage: v('page.usage'),
      pagedPoolTotal: v('mem.paged'),
      nonpaged: v('mem.nonpaged'),
      compression,
      apps,
      hardFaults: v('mem.pageReads'),
      pageWrites: v('mem.pageWrites'),
      load: ms.load,
    };
  }

  sample() {
    this.pdh.collect();
    this.tick++;
    const gpu = this.gpuSample();
    const { list, groups, totals } = this.procs.sample(gpu.perPid);
    const cpu = this.cpuSample();
    const mem = this.memorySample(list, gpu);
    const disks = this.diskSample();
    const nets = this.netSample();
    const uptime = Number(w.api.GetTickCount64());

    const h = {
      cpu: cpu.total,
      'mem.inUse': mem.inUse,
      'mem.committed': mem.committed,
      'mem.standby': mem.standby,
      'mem.compression': mem.compression,
      'mem.hardFaults': mem.hardFaults,
    };
    cpu.cores.forEach((v, i) => {
      h[`core${i}`] = v;
    });
    for (const d of disks) {
      h[`${d.key}.active`] = d.active;
      h[`${d.key}.read`] = d.read;
      h[`${d.key}.write`] = d.write;
    }
    for (const n of nets) {
      h[`${n.key}.recv`] = n.recv;
      h[`${n.key}.sent`] = n.sent;
    }
    for (const g of gpu.adapters) {
      h[`gpu:${g.key}.util`] = g.util;
      h[`gpu:${g.key}.shared`] = g.shared;
      h[`gpu:${g.key}.dedicated`] = g.dedicated;
      for (const [type, v] of Object.entries(g.types)) h[`gpu:${g.key}.eng.${type}`] = v;
    }
    this.history.push(h);

    const snapshot = {
      t: Date.now(),
      interval: this.interval,
      paused: this.paused,
      uptime,
      admin: this.admin,
      sys: this.sys,
      cpu,
      mem,
      disks,
      nets,
      gpus: gpu.adapters,
      totals,
      procs: list,
      groups,
      hist: this.history.series,
    };
    snapshot.insights = buildInsights(snapshot);
    return snapshot;
  }
}

module.exports = { Monitor };
