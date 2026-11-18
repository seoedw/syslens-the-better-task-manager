'use strict';
// Runs the collectors without the UI and prints what they see. `npm run selftest`

const { Monitor } = require('../src/main/monitor');
const { loadSystemInfo } = require('../src/main/sysinfo');

const GB = (b) => `${(b / 1024 ** 3).toFixed(2)} GB`;

async function main() {
  const t0 = Date.now();
  const sys = await loadSystemInfo();
  console.log(`system info (${Date.now() - t0} ms):`, JSON.stringify({ cpu: sys.cpu, cores: sys.cores, logical: sys.logical, os: sys.os, build: sys.build, gpus: sys.gpus, disks: sys.disks }));

  const m = new Monitor();
  m.setSystemInfo(sys);
  m.pdh.collect();
  m.procs.sample();
  if (m.pdh.missing.length) console.log('missing counters:', m.pdh.missing);
  await new Promise((r) => setTimeout(r, 1000));
  const t1 = performance.now();
  const s = m.sample();
  const took = performance.now() - t1;

  console.log(`\nsample took ${took.toFixed(1)} ms · ${s.totals.processes} processes · ${s.totals.threads} threads · ${s.totals.handles} handles`);
  console.log(`CPU ${s.cpu.total.toFixed(1)}% · ${s.cpu.cores.length} logical · ${(s.cpu.speedMHz / 1000).toFixed(2)} GHz`);

  const mem = s.mem;
  console.log(`\nRAM installed ${GB(mem.installed)} · visible ${GB(mem.total)} · reserved ${GB(mem.hardwareReserved)}`);
  console.log(`in use ${GB(mem.inUse)} · available ${GB(mem.available)} (standby ${GB(mem.standby)}, free ${GB(mem.free)})`);
  for (const p of mem.parts) console.log(`  ${p.key.padEnd(12)} ${GB(p.bytes)}`);
  console.log(`  sum of parts ${GB(mem.parts.reduce((a, p) => a + p.bytes, 0))}${mem.overlap ? ` (overlap ${GB(mem.overlap)})` : ''}`);
  console.log(`commit ${GB(mem.committed)} / ${GB(mem.commitLimit)} · page file ${GB(mem.pageFile)}`);

  console.log('\ntop groups:');
  for (const g of s.groups.slice(0, 12)) {
    console.log(`  ${g.name.padEnd(42).slice(0, 42)} ${String(g.count).padStart(3)}  ${GB(g.priv).padStart(9)}  cpu ${g.cpu.toFixed(1).padStart(5)}%  gpu ${g.gpu.toFixed(1)}%  ${g.type}`);
  }
  console.log('\ngpus:', s.gpus.map((g) => `${g.name}: ${g.util.toFixed(1)}% shared ${GB(g.shared)} dedicated ${GB(g.dedicated)}`));
  console.log('disks:', s.disks.map((d) => `${d.number} ${d.letters} ${d.model} ${d.media} ${d.active.toFixed(1)}%`));
  console.log('nets:', s.nets.map((n) => `${n.label} ↓${(n.recv / 1024).toFixed(1)}K ↑${(n.sent / 1024).toFixed(1)}K`));
  console.log('\ninsights:');
  for (const i of s.insights) console.log(`  [${i.level}] ${i.title} — ${i.text}`);

  const sample = s.procs.find((p) => p.exe === 'chrome.exe' && p.role) || s.procs.find((p) => p.path);
  console.log('\nexample process:', JSON.stringify(sample));
  const det = m.procs.details(sample.pid);
  console.log('details keys:', Object.keys(det).join(', '));
  console.log('ipc-safe:', (() => { try { structuredClone(s); return true; } catch (e) { return e.message; } })());
  m.stop();
  m.pdh.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
