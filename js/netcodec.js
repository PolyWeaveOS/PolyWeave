'use strict';
// =====================================================================
//  Compact binary messages for the two things a server sends all the time (used by the game, server.js
//  and the server's traffic code alike):
//   1  traffic snapshot (server -> player, 10/s): the cars around them   ~13 bytes a car (JSON: ~28)
//   2  my state (player -> server, 20/s)                                  ~42 bytes (JSON: ~190)
//   3  a friend's state (server -> player, 20/s from every friend)        ~55 bytes
//  Everything else (rare messages) stays JSON text. Numbers are little-endian, fixed point where a
//  little rounding can't be seen: positions to the cm, angles to a fraction of a milliradian.
// =====================================================================
const NetCodec = (() => {
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const i16 = x => clamp(Math.round(x), -32768, 32767) | 0;
  const u16 = x => clamp(Math.round(x), 0, 65535) | 0;
  const fin = x => (Number.isFinite(x) ? x : 0);

  // growable write buffer (reused: nothing is allocated per message except the copy that gets sent)
  class W {
    constructor(n = 2048) { this.b = new ArrayBuffer(n); this.v = new DataView(this.b); this.u = new Uint8Array(this.b); this.o = 0; }
    need(n) {
      if (this.o + n <= this.b.byteLength) return;
      let m = this.b.byteLength * 2; while (m < this.o + n) m *= 2;
      const b = new ArrayBuffer(m); new Uint8Array(b).set(this.u.subarray(0, this.o));
      this.b = b; this.v = new DataView(b); this.u = new Uint8Array(b);
    }
    u8(x) { this.need(1); this.v.setUint8(this.o, x); this.o += 1; }
    i8(x) { this.need(1); this.v.setInt8(this.o, clamp(Math.round(x), -128, 127)); this.o += 1; }
    u16(x) { this.need(2); this.v.setUint16(this.o, u16(x), true); this.o += 2; }
    i16(x) { this.need(2); this.v.setInt16(this.o, i16(x), true); this.o += 2; }
    u32(x) { this.need(4); this.v.setUint32(this.o, clamp(Math.round(fin(x)), 0, 4294967295), true); this.o += 4; }
    f64(x) { this.need(8); this.v.setFloat64(this.o, fin(x), true); this.o += 8; }
    str(s) { s = String(s).slice(0, 255); this.u8(s.length); this.need(s.length); for (let i = 0; i < s.length; i++) this.u[this.o++] = s.charCodeAt(i) & 127; }
    done() { return this.u.slice(0, this.o); }       // (a copy: the buffer is reused for the next message)
  }
  class R {
    constructor(data) {
      const u = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      this.v = new DataView(u.buffer, u.byteOffset, u.byteLength); this.u = u; this.o = 0;
    }
    left() { return this.u.byteLength - this.o; }
    u8() { const x = this.v.getUint8(this.o); this.o += 1; return x; }
    i8() { const x = this.v.getInt8(this.o); this.o += 1; return x; }
    u16() { const x = this.v.getUint16(this.o, true); this.o += 2; return x; }
    i16() { const x = this.v.getInt16(this.o, true); this.o += 2; return x; }
    u32() { const x = this.v.getUint32(this.o, true); this.o += 4; return x; }
    f64() { const x = this.v.getFloat64(this.o, true); this.o += 8; return x; }
    str() { const n = this.u8(); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u[this.o++]); return s; }
  }
  const w = new W();
  // paint colours are 0xRRGGBB numbers (a '#rrggbb' string works too)
  const toRgb = c => { const n = typeof c === 'number' ? c : typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? parseInt(c.slice(1), 16) : 0xa6b0b8; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

  // ---- 1: traffic snapshot. cars: [id, s (dm from base), d (cm), v (dm/s), flags, relYaw (mrad)]
  function encodeTraffic(m) {
    w.o = 0;
    w.u8(1); w.f64(m.ts); w.f64(m.base);
    w.u16(m.cars.length); w.u16(m.add.length); w.u16(m.rm.length);
    // (flag 64: it's angled - most cars are driving straight down their lane, so the angle is left out)
    for (const e of m.cars) { const ry = i16(e[5]); w.u32(e[0]); w.i16(e[1]); w.i16(e[2]); w.u16(e[3]); w.u8((e[4] & 63) | (ry ? 64 : 0)); if (ry) w.i16(ry); }
    for (const [id, key, color] of m.add) { w.u32(id); w.str(key); const [r, g, b] = toRgb(color); w.u8(r); w.u8(g); w.u8(b); }
    for (const id of m.rm) w.u32(id);
    return w.done();
  }
  function decodeTraffic(r) {
    const ts = r.f64(), base = r.f64(), nc = r.u16(), na = r.u16(), nr = r.u16();
    const cars = new Array(nc), add = new Array(na), rm = new Array(nr);
    for (let i = 0; i < nc; i++) { const id = r.u32(), s = r.i16(), d = r.i16(), v = r.u16(), f = r.u8(); cars[i] = [id, s, d, v, f & 63, f & 64 ? r.i16() : 0]; }
    for (let i = 0; i < na; i++) { const id = r.u32(), key = r.str(); add[i] = [id, key, (r.u8() << 16) | (r.u8() << 8) | r.u8()]; }
    for (let i = 0; i < nr; i++) rm[i] = r.u32();
    return { t: 'traffic', ts, base, cars, add, rm };
  }

  // ---- 2 / 3: a player's state. w: wrecks they're simulating [id, s, d, ry, vs, vd, vr]
  function stateBody(st) {
    w.f64(st.t); w.f64(st.s); w.i16(fin(st.d) * 100); w.i16(fin(st.ry) * 4000); w.i16(fin(st.v) * 100); w.i8(fin(st.steer) * 127);
    w.u8(st.brake ? 1 : 0); w.u16(st.kmh); w.f64(st.score); w.u32(st.rt); w.u16(st.rtt);
    const ws = Array.isArray(st.w) ? st.w.slice(0, 8) : [];
    w.u8(ws.length);
    for (const e of ws) { w.u32(e[0]); w.f64(e[1]); w.i16(fin(e[2]) * 100); w.i16(fin(e[3]) * 4000); w.i16(fin(e[4]) * 100); w.i16(fin(e[5]) * 100); w.i16(fin(e[6]) * 1000); }
  }
  function readBody(r) {
    const st = { t: r.f64(), s: r.f64(), d: r.i16() / 100, ry: r.i16() / 4000, v: r.i16() / 100, steer: r.i8() / 127,
      brake: !!(r.u8() & 1), kmh: r.u16(), score: r.f64(), rt: r.u32(), rtt: r.u16() };
    const n = r.u8();
    if (n) { st.w = []; for (let i = 0; i < n; i++) st.w.push([r.u32(), r.f64(), r.i16() / 100, r.i16() / 4000, r.i16() / 100, r.i16() / 100, r.i16() / 1000]); }
    return st;
  }
  function encodeState(st) { w.o = 0; w.u8(2); stateBody(st); return w.done(); }
  function encodeRelay(id, st) { w.o = 0; w.u8(3); w.str(id); w.f64(st.best); stateBody(st); return w.done(); }

  // any binary message -> the same object its JSON version would be (null if it's not one of ours)
  function decode(data) {
    try {
      const r = new R(data), k = r.u8();
      if (k === 1) return decodeTraffic(r);
      if (k === 2) return { t: 'state', st: readBody(r) };
      if (k === 3) { const id = r.str(), best = r.f64(), st = readBody(r); st.best = best; return { t: 'st', id, st }; }
    } catch (e) { /* truncated / not ours */ }
    return null;
  }
  return { encodeTraffic, encodeState, encodeRelay, decode };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NetCodec;
