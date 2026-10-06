'use strict';
// =====================================================================
//  Construction zones: an outer lane (0 = far left, 3 = far right) is closed
//  for a few hundred metres. Deterministic per "slot" so the world, traffic
//  and collisions all agree. Roughly one zone every ~2.5-3.5 km.
// =====================================================================
const ZONES = {
  SLOT: 2600,          // one possible zone per slot
  CHANCE: 0.75,        // chance a slot has a zone
  cache: new Map(),

  // Loop circuit (online servers): zones repeat every lap; one possible zone per 2100 m slot, none
  // near the parking lot / on-ramp at the start of the lap
  loopL: 0,
  setLoop(L) { this.loopL = L || 0; this.SLOT = L ? 2100 : 2600; this.cache = new Map(); },
  loopSlot(i) {
    const NS = Math.round(this.loopL / this.SLOT), j = ((i % NS) + NS) % NS, lap = Math.floor(i / NS);
    this._base = this._base || new Map();
    if (!this._base.has(j)) {
      const r = U.rng(j * 104729 + 991);
      let z = null;
      if (r() < 0.85) {
        const side = r() < 0.5 ? 0 : 3;
        const start = j * this.SLOT + 400 + r() * (this.SLOT - 1100), len = 220 + r() * 200;
        if (start > 1000 && start + len + 40 < this.loopL - 900) z = { side, start, taper: 75, end: start + len, taperOut: 40 };
      }
      this._base.set(j, z);
    }
    const b = this._base.get(j);
    return b && { ...b, start: b.start + lap * this.loopL, end: b.end + lap * this.loopL, seed: 1e6 + i };
  },

  slot(i) {
    if (!this.cache.has(i) && this.loopL) this.cache.set(i, this.loopSlot(i));
    if (!this.cache.has(i)) {
      const r = U.rng(i * 104729 + 77);
      let z = null;
      if (i > 0 && r() < this.CHANCE) {
        const side = r() < 0.5 ? 0 : 3;
        const start = i * this.SLOT + 400 + r() * (this.SLOT - 1100);
        const len = 220 + r() * 200;
        z = { side, start, taper: 75, end: start + len, taperOut: 40, seed: i };
      }
      this.cache.set(i, z);
    }
    return this.cache.get(i);
  },

  // zones relevant to the stretch [s0, s1] (including their advance-warning area)
  near(s0, s1) {
    const out = [];
    for (let i = Math.floor((s0 - 800) / this.SLOT); i <= Math.floor((s1 + 800) / this.SLOT); i++) {
      const z = this.slot(i);
      if (z && z.end + z.taperOut > s0 - 60 && z.start - 420 < s1) out.push(z);
    }
    return out;
  },

  // 0 = lane open, 1 = fully closed, ramps through the tapers
  frac(z, s) {
    if (s < z.start || s > z.end + z.taperOut) return 0;
    if (s < z.start + z.taper) return (s - z.start) / z.taper;
    if (s <= z.end) return 1;
    return 1 - (s - z.end) / z.taperOut;
  },

  // lateral position of the closure's edge (barrier line) at s
  bound(z, s) {
    const f = this.frac(z, s);
    if (z.side === 0) { const e = ROAD.edgeL, line = -ROAD.LW; return e + (line - e) * f; }
    const e = ROAD.edgeR, line = ROAD.LW; return e + (line - e) * f;
  },

  // The solid construction wall sits WALL_OFF metres inside the closure, behind the cones
  WALL_OFF: 1.1,
  inward(z) { return z.side === 0 ? -1 : 1; },           // direction (in d) pointing into the closure
  wallD(z, s) { return this.bound(z, s) + this.inward(z) * this.WALL_OFF; },

  // cone / barrel positions for a zone: barrels through both tapers, cones along the closed stretch
  props(z) {
    if (z._props) return z._props;
    const out = [], sg = this.inward(z);
    for (let m = z.start; m < z.start + z.taper; m += 5) out.push({ s: m, d: this.bound(z, m) + sg * 0.35, kind: 'barrel' });
    for (let m = z.start + z.taper; m < z.end; m += 14) out.push({ s: m, d: sg * ROAD.LW + sg * 0.3, kind: 'cone' });
    for (let m = z.end; m < z.end + z.taperOut; m += 5) out.push({ s: m, d: this.bound(z, m) + sg * 0.35, kind: 'barrel' });
    return (z._props = out);
  },

  // a closure on this lane that is ahead of s within dist (or that s is already in)
  closedAhead(lane, s, dist) {
    for (const z of this.near(s, s + dist)) if (z.side === lane && z.end > s && z.start < s + dist) return z;
    return null;
  },
};
