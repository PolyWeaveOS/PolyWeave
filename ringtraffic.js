'use strict';
// =====================================================================
//  Shared traffic for a multiplayer room (server side).
//  Loaded by trafficserver.js into the same context as js/core.js, js/zones.js and js/traffic.js,
//  so the cars drive with exactly the single-player traffic code. This adds:
//  - the loop circuit: positions wrap around the lap (0 <= s < L)
//  - traffic lives around EVERY player in the room (single player's window, around each of them);
//    cars are only ever added / removed where no player can see it happen
//  - neighbour lookups by binary search (a busy room has a few hundred cars)
//  - a spatial index (cars bucketed every 25 m round the lap): spawning, spacing and snapshots only look
//    at the cars nearby (12 players spread round the lap means ~1300 cars)
// =====================================================================
const RING_CELL = 25;
class RingTraffic extends Traffic {
  constructor() {
    super({ add() {}, remove() {} });
    this.L = ROAD.loop.L; this.nextId = 1; this.byId = new Map(); this.players = []; this.tick = 0;
  }
  // (fast path first: almost every position is already on this lap, and % on decimals is slow)
  w(s) { const L = this.L; return s >= 0 && s < L ? s : ((s % L) + L) % L; }
  wd(a, b) {                                                 // signed a - b around the lap
    const L = this.L, h = L / 2; let x = a - b;
    if (x > -h && x <= h) return x;
    x %= L; if (x > h) x -= L; else if (x < -h) x += L; return x;
  }
  remove(i) { const c = this.cars[i]; this.byId.delete(c.id); this.cars.splice(i, 1); if (this.gridOn) this.gridDel(c); }
  maintain() {}                                   // (replaced by maintainRing)
  seen(s) { for (const p of this.players) { const o = this.wd(s, p.s); if (o > -70 && o < 600) return true; } return false; }

  // ---- spatial index (valid while cars aren't moving: rebuilt after every step, kept up to date by
  // spawning, removing and crash reports in between)
  gridBuild() {
    const n = Math.ceil(this.L / RING_CELL);
    if (!this.grid || this.grid.length !== n) this.grid = Array.from({ length: n }, () => []);
    for (const a of this.grid) a.length = 0;
    this.gridOn = true;
    for (const c of this.cars) this.gridAdd(c);
  }
  gridAdd(c) { const i = Math.min(this.grid.length - 1, Math.floor(this.w(c.s) / RING_CELL)); c.RING_CELL = i; this.grid[i].push(c); }
  gridDel(c) { const a = this.grid[c.RING_CELL]; if (!a) return; const k = a.indexOf(c); if (k >= 0) { a[k] = a[a.length - 1]; a.pop(); } }
  gridMove(c) { if (this.gridOn) { this.gridDel(c); this.gridAdd(c); } }
  // the cars in the cells covering [a, b] (a few just outside too: callers check exactly). The array is
  // reused by the next call: copy (filter) it if it has to survive one.
  around(a, b) {
    if (!this.gridOn) this.gridBuild();
    const out = this._near || (this._near = []), g = this.grid, n = g.length;
    out.length = 0;
    const i0 = Math.min(n - 1, Math.floor(this.w(a) / RING_CELL)), cnt = Math.min(n, Math.floor((b - a) / RING_CELL) + 2);
    for (let k = 0; k < cnt; k++) { const RING_CELL = g[(i0 + k) % n]; for (let j = 0; j < RING_CELL.length; j++) out.push(RING_CELL[j]); }
    return out;
  }
  // would a car in lane l at s line up beside cars in ALL the other lanes (a row blocking the road)?
  wallAt(l, s) {
    const near = this.around(s - 10, s + 10);
    for (let k = 0; k < ROAD.LANES; k++) {
      if (k === l) continue;
      const d = ROAD.lane(k);
      let any = false;
      for (const o of near) if (Math.abs(o.d - d) < 1.6 && Math.abs(this.wd(o.s, s)) < 10) { any = true; break; }
      if (!any) return false;
    }
    return true;
  }
  // something stopped in lane l just past b (a wreck, a stopped player): see Traffic.blockShares
  blockedPast(l, b) {
    const lc = ROAD.lane(l), half = ROAD.LW / 2 - 0.3;
    for (const o of this.around(b - 10, b + 300)) {
      if (!o.crashed) continue;
      const ds = this.wd(o.s, b);
      if (ds > -10 && ds < 300 && Math.abs(o.d - lc) < half + Traffic.widthOf(o)) return true;
    }
    for (const p of this.players) {
      const ds = this.wd(p.s, b);
      if (ds > -10 && ds < 300 && p.v < 3 && Math.abs(p.d - lc) < half + p.hw) return true;
    }
    return false;
  }

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
    if (this.wallAt(l, s)) return null;                       // (no rows of cars side by side across the whole road)
    const type = this.pickType(l), M = getModel(type.key), lc = ROAD.lane(l);
    // room to fit (the longest vehicles reach ~10 m from their centre) + the car to match speed with ahead
    let lead = null, lg = 120;
    for (const o of this.around(s - room - 30, s + Math.max(120, room + 30))) {
      if (Math.abs(o.d - lc) > 2.6) continue;
      const ds = this.wd(o.s, s);
      if (ds + o.front > M.rear - room && ds + o.rear < M.front + room) return null;
      if (ds > 0 && ds < lg) { lg = ds; lead = o; }
    }
    for (const p of this.players) if (Math.abs(p.d - lc) < 2.6 && Math.abs(this.wd(p.s, s)) < 30) return null;
    const c = new TrafficCar(type, s, l, this.scene);
    c.id = this.nextId++; c.color = c.vis.paint;
    if (lead) c.v = Math.min(c.v, lead.v);
    this.cars.push(c); this.byId.set(c.id, c);
    if (this.gridOn) this.gridAdd(c);
    return c;
  }
  // biggest empty stretch of lane l in [a, b] (keeping 60 m clear of each player); returns a random spot in it
  biggestGap(l, a, b) {
    const len = b - a, lc = ROAD.lane(l);
    const xs = [];
    for (const c of this.around(a, b)) if (Math.abs(c.d - lc) < 2.6) { const o = this.w(c.s - a); if (o < len) xs.push(o); }
    xs.sort((p, q) => p - q);
    // (only players actually on the highway need the clear space; one in the parking lot doesn't)
    const pts = [0, ...xs, len], av = this.players.filter(p => Math.abs(p.d) < ROAD.edgeR + 1).map(p => this.wd(p.s, a));
    let best = null, bl = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      let lo = pts[i], hi = pts[i + 1];
      for (const o of av) if (lo < o + 60 && hi > o - 60) { if (o - 60 - lo > hi - o - 60) hi = o - 60; else lo = o + 60; }
      if (hi - lo > bl) { bl = hi - lo; best = lo + (hi - lo) * U.rand(0.2, 0.8); }
    }
    return bl > 30 ? a + best : null;
  }
  // bring every lane in [a, b] to single player's spacing: add into the biggest gaps, remove extras
  fillBand(a, b, density, maxAdd = 6) {
    const N = this.target(density), shares = LANE_SHARE, len = b - a;
    if (len < 25) return;
    const closed = [0, 1, 2, 3].map(l => !!this.closedLaneAhead(l, a - 20, len + 40));
    const laneK = Traffic.zoneShares(this, a, b), blockK = this.blockShares(b);   // (thinner before roadworks, like single player)
    for (let l = 0; l < ROAD.LANES; l++) {
      if (closed[l]) continue;
      const spacing = (WIN_AHEAD + WIN_BACK) / Math.max(N * shares[l], 1);
      const want = len / spacing * RUN_DENSITY * laneK[l] * blockK[l];   // (fewer behind something stopped)
      const lc = ROAD.lane(l);
      const cs = this.around(a, b).filter(c => !c.crashed && Math.abs(c.d - lc) < 1.2 && this.w(c.s - a) < len);
      let guard = 0, fails = 0;
      while (cs.length < want - 0.5 && guard++ < maxAdd + 3) {
        const s = this.biggestGap(l, a, b);
        if (s === null) break;
        const c = this.spawnAt(l, s, Math.max(12, spacing * 0.35));
        if (!c) { if (++fails > 3) break; continue; }                 // (random spot: try another)
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
    // gone: outside every player's window (every other step is plenty: the window edges are out of sight)
    if (this.tick % 2 === 0) for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      let keep = false;
      for (const p of this.players) { const o = this.wd(c.s, p.s); if (o > -WIN_BACK && o < WIN_AHEAD) { keep = true; break; } }
      // (a wreck nobody is simulating any more, e.g. its player left: towed away after a while)
      if (keep && c.crashed && c.crashT > 25 && !this.ownerHere(c)) keep = false;
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
  // crashed cars: pose comes from the player who hit them (see claim())
  updateCrashed(c, dt) { c.crashT += dt; c.v = 0; }
  crash(c, s, d, ry) {
    if (!c.crashed) { c.crashed = true; c.crashT = 0; c.ind = 0; c.tgt = c.lane; c.forced = false; c.pending = undefined; }
    c.s = this.w(s); c.d = d; c.relYaw = ry; c.v = 0;
    this.gridMove(c);
  }
  // A wreck is simulated by the game of the player who hit it (its owner), who reports where it is ~20
  // times a second. Only one game may move it: reports from anyone else are ignored while the owner is
  // still here and reporting (so two players' versions never fight). Returns false if someone else owns it.
  ownerHere(c) { return !!c.owner && this.players.includes(c.owner) && this.tick - (c.claimTick || 0) < 30; }
  claim(c, a, s, d, ry) {
    if (c.crashed && c.owner !== a && this.ownerHere(c)) return false;
    c.owner = a; c.claimTick = this.tick;
    this.crash(c, s, d, ry);
    return true;
  }
  mayRelease(c, a) { return c.owner === a || !this.ownerHere(c); }
  // the player who hit it got it going again: back in `lane`, driving on at speed v
  recover(c, s, lane, v) {
    if (!c.crashed) return;
    c.crashed = false; c.crashT = 0; c.owner = null; c.s = this.w(s); c.lane = c.tgt = lane; c.d = ROAD.lane(lane);
    c.v = v; c.acc = 0; c.latV = 0; c.relYaw = 0; c.ind = 0; c.forced = false; c.blocked = false; c.pending = undefined;
    c.cool = U.rand(3, 6); c.check = 1;
    this.gridMove(c);
  }
  gone(c) { const i = this.cars.indexOf(c); if (i >= 0) this.remove(i); }

  // one simulation step for the room
  step(dt, density) {
    this.tick++;
    this.maintainRing(density, dt);
    this.gridOn = false;                                     // (cars move now)
    if (this.cars.length) this.update(dt, RingTraffic.FAR, density, null);
    for (const c of this.cars) c.s = this.w(c.s);
    this.gridBuild();                                        // (for the snapshots, and next step's spawning)
  }

  // what player p needs to draw: every car in their window, positions in THEIR lap's numbers.
  // New cars come with their model + colour; far cars (in the haze) are sent every other time.
  snapshot(p, ts) {
    const known = p.known || new Set(), now = new Set(), cars = [], add = [];
    const skipFar = this.tick % 2 === 1, base = Math.round(p.raw);
    for (const c of this.around(p.s - WIN_BACK - 10, p.s + WIN_AHEAD + 10)) {
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
