'use strict';
// Performance Data Helper (PDH) wrapper: the same counters Task Manager and perfmon read.

const { api, addressOf, readWStr, ptrOffset } = require('./win32');

const PDH_FMT_DOUBLE = 0x00000200;
const PDH_FMT_NOCAP100 = 0x00008000;
const PDH_MORE_DATA = 0x800007d2;
const FMT = PDH_FMT_DOUBLE | PDH_FMT_NOCAP100;
const ITEM_SIZE = 24; // PDH_FMT_COUNTERVALUE_ITEM_W on x64

class PdhQuery {
  constructor() {
    const q = [0];
    const st = api.PdhOpenQueryW(null, 0, q);
    if (st !== 0) throw new Error(`PdhOpenQuery failed: 0x${(st >>> 0).toString(16)}`);
    this.query = q[0];
    this.counters = new Map();
    this.missing = [];
    this.valueBuf = Buffer.alloc(16);
    this.arrayBuf = Buffer.alloc(256 * 1024);
  }

  /** Add an English counter path. Missing counters (e.g. no GPU driver support) are skipped. */
  add(key, path) {
    const c = [0];
    const st = api.PdhAddEnglishCounterW(this.query, path, 0, c);
    if (st === 0) this.counters.set(key, c[0]);
    else this.missing.push(path);
    return st === 0;
  }

  has(key) {
    return this.counters.has(key);
  }

  collect() {
    return api.PdhCollectQueryData(this.query) === 0;
  }

  /** Single-instance counter value, or null when not available yet. */
  value(key) {
    const h = this.counters.get(key);
    if (!h) return null;
    const st = api.PdhGetFormattedCounterValue(h, FMT, null, this.valueBuf);
    if (st !== 0) return null;
    const cstatus = this.valueBuf.readUInt32LE(0);
    if (cstatus !== 0 && cstatus !== 1) return null;
    return this.valueBuf.readDoubleLE(8);
  }

  /** All instances of a wildcard counter: [{ name, value }]. */
  array(key) {
    const h = this.counters.get(key);
    if (!h) return [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const size = [0];
      const count = [0];
      let st = api.PdhGetFormattedCounterArrayW(h, FMT, size, count, null) >>> 0;
      if (st === 0) return [];
      if (st !== PDH_MORE_DATA) return [];
      if (this.arrayBuf.length < size[0]) this.arrayBuf = Buffer.alloc(Math.ceil(size[0] * 1.5));
      size[0] = this.arrayBuf.length;
      st = api.PdhGetFormattedCounterArrayW(h, FMT, size, count, this.arrayBuf) >>> 0;
      if (st === PDH_MORE_DATA) continue;
      if (st !== 0) return [];
      const buf = this.arrayBuf;
      const base = addressOf(buf);
      const out = [];
      for (let i = 0; i < count[0]; i++) {
        const o = i * ITEM_SIZE;
        const cstatus = buf.readUInt32LE(o + 8);
        if (cstatus !== 0 && cstatus !== 1) continue;
        const nameOff = ptrOffset(buf.readBigUInt64LE(o), base, buf);
        out.push({ name: nameOff >= 0 ? readWStr(buf, nameOff, 1024) : '', value: buf.readDoubleLE(o + 16) });
      }
      return out;
    }
    return [];
  }

  close() {
    if (this.query) api.PdhCloseQuery(this.query);
    this.query = 0;
  }
}

module.exports = { PdhQuery };
