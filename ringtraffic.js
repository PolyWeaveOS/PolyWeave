'use strict';
// =====================================================================
//  Shared traffic for a multiplayer room (server side).
//  Loaded by trafficserver.js into the same context as js/core.js, js/zones.js and js/traffic.js,
//  so the cars drive with exactly the single-player traffic code. This adds:
//  - the loop circuit: positions wrap around the lap (0 <= s < L)
//  - traffic lives around EVERY player in the room (single player's window, around each of them);
//    cars are only ever added / removed where no player can see it happen
//  - neighbour lookups by binary search (a busy room has a few hundred cars)
// =====================================================================
class RingTraffic extends Traffic {
  constructor() {
    super({ add() {}, remove() {} });
    this.L = ROAD.loop.L; this.nextId = 1; this.byId = new Map(); this.players = []; this.tick = 0;
  }
  w(s) { const L = this.L; return ((s % L) + L) % L; }
  wd(a, b) { const L = this.L; let x = (a - b) % L; if (x > L / 2) x -= L; else if (x < -L / 2) x += L; return x; }   // signed a - b around the lap
  remove(i) { const c = this.cars[i]; this.byId.delete(c.id); this.cars.splice(i, 1); }
  maintain() {}                                   // (replaced by maintainRing)
  seen(s) { for (const p of this.players) { const o = this.wd(s, p.s); if (o > -70 && o < 600) return true; } return false; }

  // ---- neighbours (lanes sorted by s; the lap wraps around)
  buildLanes() {
    for (const L of this.lanes) L.length = 0;
    const add = o => { for (const l of Traffic.lanesOf(o.d, Traffic.widthOf(o))) this.lanes[l].push(o); };
    for (const c of this.cars) add(c);
    for (const p of this.players) add(p);
    for (const L of this.lanes) L.sort((a, b) => a.s - b.s);
  }
  leadIn(c, l) {
    const A = this.lanes[l], n = A.length; if (!n) return null;
    let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (A[m].s <= c.s) lo = m + 1; else hi = m; }
    for (let k = 0; k < n; k++) {
      const o = A[(lo + k) % n]; if (o === c) continue;
      let ds = o.s - c.s; if (ds <= 0) ds += this.L;
      return { gap: ds + o.rear - c.front, v: o.v, o };
    }
    return null;
  }
  followIn(c, l) {
    const A = this.lanes[l], n = A.length; if (!n) return null;
    let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (A[m].s < c.s) lo = m + 1; else hi = m; }
    for (let k = 1; k <= n; k++) {
      const o = A[((lo - k) % n + n) % n]; if (o === c) continue;
      let ds = c.s - o.s; if (ds < 0) ds += this.L;
      return { gap: ds + c.rear - o.front, v: o.v, o };
    }
    return null;
  }

  // ---- spawning (positions wrap)
  spawnAt(l, s, room = 14) {
    s = this.w(s);
    if (this.closedLaneAhead(l, s - 20, 150)) return null;
    const type = this.pickType(l), M = getModel(type.key);
    for (const o of this.cars) {
      if (Math.abs(o.d - ROAD.lane(l)) > 2.6) continue;
      const ds = this.wd(o.s, s);
      if (ds + o.front > M.rear - room && ds + o.rear < M.front + room) return null;
    }
    for (const p of this.players) if (Math.abs(p.d - ROAD.lane(l)) < 2.6 && Math.abs(this.wd(p.s, s)) < 30) return null;
    const c = new TrafficCar(type, s, l, this.scene);
    c.id = this.nextId++; c.color = c.vis.paint;
    let lead = null, lg = 120;
    for (const o of this.cars) { const g = this.wd(o.s, s); if (g > 0 && g < lg && Math.abs(o.d - c.d) < 2.6) { lg = g; lead = o; } }
    if (lead) c.v = Math.min(c.v, lead.v);
    this.cars.push(c); this.byId.set(c.id, c);
    return c;
  }
  // biggest empty stretch of lane l in [a, b] (keeping 60 m clear of each player); returns its middle
  biggestGap(l, a, b) {
    const len = b - a;
    const xs = [];
    for (const c of this.cars) if (Math.abs(c.d - ROAD.lane(l)) < 2.6) { const o = this.w(c.s - a); if (o < len) xs.push(o); }
    xs.sort((p, q) => p - q);
    // (only players actually on the highway need the clear space; one in the parking lot doesn't)
    const pts = [0, ...xs, len], av = this.players.filter(p => Math.abs(p.d) < ROAD.edgeR + 1).map(p => this.wd(p.s, a));
    let best = null, bl = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      let lo = pts[i], hi = pts[i + 1];
      for (const o of av) if (lo < o + 60 && hi > o - 60) { if (o - 60 - lo > hi - o - 60) hi = o - 60; else lo = o + 60; }
      if (hi - lo > bl) { bl = hi - lo; best = (lo + hi) / 2 + (hi - lo) * U.rand(-0.12, 0.12); }
    }
    return bl > 30 ? a + best : null;
  }
  // bring every lane in [a, b] to single player's spacing: add into the biggest gaps, remove extras
  fillBand(a, b, density, maxAdd = 6) {
    const N = this.target(density), shares = [0.26, 0.26, 0.25, 0.23], len = b - a;
    if (len < 25) return;
    const closed = [0, 1, 2, 3].map(l => !!this.closedLaneAhead(l, a - 20, len + 40));
    const laneK = Traffic.zoneShares(this, a, b);           // (thinner before roadworks, like single player)
    for (let l = 0; l < ROAD.LANES; l++) {
      if (closed[l]) continue;
      const spacing = (WIN_AHEAD + WIN_BACK) / Math.max(N * shares[l], 1);
      const want = len / spacing * RUN_DENSITY * laneK[l];
      const lc = ROAD.lane(l);
      const cs = this.cars.filter(c => !c.crashed && Math.abs(c.d - lc) < 1.2 && this.w(c.s - a) < len);
      let guard = 0;
      while (cs.length < want - 0.5 && guard++ < maxAdd) {
        const s = this.biggestGap(l, a, b);
        const c = s === null ? null : this.spawnAt(l, s, Math.max(12, spacing * 0.35));
        if (!c) break;
        cs.push(c);
      }
      while (cs.length > want + 1.5) {
        cs.sort((p, q) => this.w(p.s - a) - this.w(q.s - a));
        let worst = -1, wg = Infinity;
        for (let i = 0; i < cs.length; i++) {
          if (cs[i].changing) continue;
          const g = Math.min(i > 0 ? this.wd(cs[i].s, cs[i - 1].s) : Infinity, i < cs.length - 1 ? this.wd(cs[i + 1].s, cs[i].s) : Infinity);
          if (g < wg) { wg = g; worst = i; }
        }
        if (worst < 0) break;
        this.remove(this.cars.indexOf(cs[worst]));
        cs.splice(worst, 1);
      }
    }
  }
  // [a, b] minus every player's visible stretch (cars must never pop in or out where someone can see)
  hiddenParts(a, b, except) {
    let parts = [[0, b - a]];
    for (const p of this.players) {
      if (p === except) continue;
      const o = this.wd(p.s - 70, a);
      for (const vs of [o, o + this.L, o - this.L]) {
        const ve = vs + 670;
        parts = parts.flatMap(([x, y]) => (ve <= x || vs >= y) ? [[x, y]] : [[x, Math.max(x, vs)], [Math.min(y, ve), y]].filter(([u, v]) => v - u > 20));
      }
    }
    return parts.map(([x, y]) => [a + x, a + y]);
  }
  maintainRing(density, dt) {
    // gone: outside every player's window (a crash wreck is towed after 40 s, out of sight)
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      let keep = false;
      for (const p of this.players) { const o = this.wd(c.s, p.s); if (o > -WIN_BACK && o < WIN_AHEAD) { keep = true; break; } }
      if (keep && c.crashed && c.crashT > 25) keep = false;   // (a wreck nobody got going again, e.g. its player left)
      if (!keep) this.remove(i);
    }
    // a player just arrived: fill their whole window, except what other players can already see
    for (const p of this.players) if (!p.filled) {
      p.filled = true;
      for (const [a, b] of this.hiddenParts(p.s - WIN_BACK + 10, p.s + WIN_AHEAD - 10, p)) this.fillBand(a, b, density, 80);
    }
    // keep re-applying the even spacing in the stretches nobody can see
    this.bandT = (this.bandT || 0) - dt;
    if (this.bandT <= 0) {
      this.bandT = 0.4;
      for (const p of this.players) {
        for (const [a, b] of [[p.s + 600, p.s + WIN_AHEAD - 10], [p.s - WIN_BACK + 10, p.s - 70]]) {
          for (const [x, y] of this.hiddenParts(a, b)) this.fillBand(x, y, density);
        }
      }
    }
  }
  // crashed cars: pose comes from the player who hit them (see crash())
  updateCrashed(c, dt) { c.crashT += dt; c.v = 0; }
  crash(c, s, d, ry) {
    if (!c.crashed) { c.crashed = true; c.crashT = 0; c.ind = 0; c.tgt = c.lane; c.forced = false; c.pending = undefined; }
    c.s = this.w(s); c.d = d; c.relYaw = ry; c.v = 0;
  }
  // the player who hit it got it going again: back in `lane`, driving on at speed v
  recover(c, s, lane, v) {
    if (!c.crashed) return;
    c.crashed = false; c.crashT = 0; c.s = this.w(s); c.lane = c.tgt = lane; c.d = ROAD.lane(lane);
    c.v = v; c.acc = 0; c.latV = 0; c.relYaw = 0; c.ind = 0; c.forced = false; c.blocked = false; c.pending = undefined;
    c.cool = U.rand(3, 6); c.check = 1;
  }
  gone(c) { const i = this.cars.indexOf(c); if (i >= 0) this.remove(i); }

  // one simulation step for the room
  step(dt, density) {
    this.tick++;
    this.maintainRing(density, dt);
    if (this.cars.length) this.update(dt, RingTraffic.FAR, density, null);
    for (const c of this.cars) c.s = this.w(c.s);
  }

  // what player p needs to draw: every car in their window, positions in THEIR lap's numbers.
  // New cars come with their model + colour; far cars (in the haze) are sent every other time.
  snapshot(p, ts) {
    const known = p.known || new Set(), now = new Set(), cars = [], add = [];
    const skipFar = this.tick % 2 === 1, base = Math.round(p.raw);
    for (const c of this.cars) {
      const o = this.wd(c.s, p.s);
      if (o < -WIN_BACK - 10 || o > WIN_AHEAD + 10) continue;
      now.add(c.id);
      if (!known.has(c.id)) add.push([c.id, c.type.key, c.color]);
      else if (skipFar && Math.abs(o) > 350) continue;
      const ind = c.changing ? Math.sign(c.tgt - c.lane) : c.ind;
      const f = (ind < 0 ? 1 : ind > 0 ? 2 : 0) | (c.crashed || c.acc < -0.8 || c.v < 0.5 ? 4 : 0) | (c.crashed ? 8 : 0);
      cars.push([c.id, Math.round((p.raw + o - base) * 10), Math.round(c.d * 100), Math.round(c.v * 10), f, Math.round(c.relYaw * 1000)]);
    }
    const rm = []; for (const id of known) if (!now.has(id)) rm.push(id);
    p.known = now;
    return { t: 'traffic', ts, base, cars, add, rm };
  }
}
RingTraffic.FAR = { s: -1e9, d: 999, v: 0, front: 0, rear: 0, hw: 0, isPlayer: true };
