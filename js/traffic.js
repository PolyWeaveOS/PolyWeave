'use strict';
// =====================================================================
//  Traffic (rewritten)
//  - Every lane has its own flow speed (left fastest); each driver drives a little above or
//    below it, so cars in a lane travel together instead of stacking into stop-and-go jams.
//  - Intelligent Driver Model for following / braking (no input lag -> no phantom jams).
//  - Lane changes: incentive + safety checks, indicators 2-4 s first, and a lateral motion
//    that is tied to forward speed (a slow car only noses over a few degrees, never 90 deg).
//  - Spawning keeps each lane evenly filled: new cars go into the biggest gap, entering where
//    the flow brings them into view (ahead if you're faster than that lane, behind if slower).
//  - Construction zones: zipper merge. Each driver has their own merge point, cars in the open
//    lane leave a gap for a merger that is ahead of them; mergers never wait on cars beside them.
//  - Crashed cars become rigid bodies that slide, spin and stop with hazards on.
// =====================================================================

// Real-car traffic from js/vehicles/*.js (see TRAFFIC_VEHICLES in models.js). Speed ranges by class:
// cars 100 +- 30, vans 95 +- 25, trucks / buses 90 +- 20 km/h. Falls back to the generic set below if none loaded.
const CLASS_SPEED = { car: [70, 130], suv: [70, 130], pickup: [70, 130], van: [70, 120], truck: [70, 110], bus: [70, 110] };
const TTYPES_REAL = TRAFFIC_VEHICLES.map(m => ({
  ...m, vmin: m.vmin ?? CLASS_SPEED[m.cls][0], vmax: m.vmax ?? CLASS_SPEED[m.cls][1],
  truck: m.truck ?? (m.cls === 'truck' || m.cls === 'bus'),
}));
const TTYPES = TTYPES_REAL.length ? TTYPES_REAL : [
  { key: 'sedan', w: 30, mass: 1550, vmin: 70, vmax: 130, amax: 1.5 },
  { key: 'hatch', w: 18, mass: 1350, vmin: 70, vmax: 130, amax: 1.5 },
  { key: 'suv', w: 24, mass: 1800, vmin: 70, vmax: 130, amax: 1.35 },
  { key: 'pickup', w: 10, mass: 2400, vmin: 70, vmax: 130, amax: 1.3 },
  { key: 'van', w: 8, mass: 2700, vmin: 70, vmax: 120, amax: 1.1 },
  { key: 'box', w: 5, mass: 7500, vmin: 70, vmax: 110, amax: 0.75, truck: true },
  { key: 'semi', w: 4, mass: 19000, vmin: 70, vmax: 110, amax: 0.5, truck: true },
];
const TCOLORS = [
  { w: 20, c: 0xf0f1ef }, { w: 17, c: 0x1b1c20 }, { w: 14, c: 0xb8bdc3 }, { w: 13, c: 0x5b6169 },
  { w: 7, c: 0x1e3966 }, { w: 7, c: 0xa61c22 }, { w: 3, c: 0x5c1920 }, { w: 3, c: 0x2e573b },
  { w: 3, c: 0x8fb2d2 }, { w: 3, c: 0xb6a786 }, { w: 3, c: 0x2c6db3 }, { w: 1, c: 0xd9861c }, { w: 2, c: 0x6d7a45 },
];
const TRUCK_COLORS = [{ w: 6, c: 0xf0f1ef }, { w: 2, c: 0xb22a25 }, { w: 2, c: 0x1f4c8a }, { w: 1, c: 0x2c2d31 }, { w: 1, c: 0x2f6b42 }];

// lane flow speeds (km/h), lane 0 = far left (fast) ... lane 3 = far right (slow); trucks keep to lanes 2-3
const LANE_KMH = [124, 110, 97, 86];
const TRUCK_LANES = 2;
const WIN_BACK = 330, WIN_AHEAD = 960;                 // traffic lives in this window around the player
const TRAFFIC_SCALE = 1.16;                              // overall traffic amount (sets the opening fill)
// The opening fill keeps the area around you clear, which packs the road ahead (100-600 m) at ~22% more
// cars than the same total spread evenly. The ongoing fill uses that same density, so traffic
// keeps looking like the first group instead of thinning out after it.
const RUN_DENSITY = 1.23;

class TrafficCar {
  constructor(type, s, lane, scene) {
    this.type = type;
    const pal = Array.isArray(type.paint) ? type.paint.map(c => ({ w: 1, c })) : type.paint === 'truck' || (!type.paint && type.truck) ? TRUCK_COLORS : TCOLORS;
    this.vis = makeVehicle(type.key, paintMat(U.weighted(pal).c), null, true);
    scene.add(this.vis.root);
    const M = this.vis.M;
    this.front = M.front; this.rear = M.rear; this.hw = M.W; this.hull = M.hull;
    this.mass = type.mass; this.Iz = type.mass * ((M.front - M.rear) ** 2 + (2 * M.W) ** 2) / 12;
    // personality
    this.pers = U.rand(-2.5, 2.5);                      // km/h above / below the lane's flow (small, so lanes don't bunch up)
    this.T = U.rand(0.9, 1.4) * (type.truck ? 1.2 : 1);  // time headway
    this.s0 = type.truck ? 4 : 2.5;                      // standstill gap
    this.bComf = type.truck ? 1.6 : 2.2;
    this.thresh = U.rand(0.15, 0.3);                     // how much better a lane must be to bother
    this.latMax = type.truck ? U.rand(0.65, 0.95) : U.rand(0.9, 1.35);   // sideways speed when changing lanes (m/s)
    this.mergeAt = type.truck ? U.rand(300, 700) : U.rand(150, 650);     // where they leave a closing lane (spread out, not all at the cones)
    this.courteous = Math.random() < 0.5;                // moves out of the lane next to roadworks to make room for mergers
    this.spreads = Math.random() < 0.75;                 // moves back into the reopened lane after roadworks
    // state
    this.s = s; this.lane = lane; this.tgt = lane; this.d = ROAD.lane(lane); this.latV = 0;
    this.v0 = this.laneV0(lane); this.v = this.v0; this.acc = 0; this.relYaw = 0;
    this.ind = 0; this.indT = 0; this.indWait = 0; this.forced = false;
    this.cool = U.rand(2, 10); this.check = U.rand(0, 1);
    this.wish = 0; this.wishT = U.rand(5, 40);
    this.crashed = false; this.body = null; this.yaw = 0; this.crashT = 0;
    this.nm = { active: false, done: false, min: 9 };
    this.x = 0; this.z = 0;
  }
  get changing() { return this.tgt !== this.lane; }
  laneV0(lane) { const t = this.type; return U.clamp(LANE_KMH[lane] * (t.truck ? 0.97 : 1) + this.pers, t.vmin, t.vmax) / 3.6; }
  // tScale < 1: the shorter gap a driver accepts for a moment when changing lanes (they then drop back)
  idm(lead, v = this.v, tScale = 1) {
    const a = this.type.amax;
    let acc = a * (1 - Math.pow(Math.max(v, 0) / Math.max(this.v0, 1), 4));
    if (lead) {
      const dv = v - lead.v;
      const ss = this.s0 + Math.max(0, v * this.T * tScale + v * dv / (2 * Math.sqrt(a * this.bComf)));
      acc -= a * Math.pow(ss / Math.max(lead.gap, 0.5), 2);
    }
    return U.clamp(acc, -8, a);
  }
}

class Traffic {
  constructor(scene) {
    this.scene = scene; this.cars = []; this.initDone = false; this.time = 0;
    this.lanes = [[], [], [], []]; this.laneCool = [0, 0, 0, 0];
    this._pa = []; this._pb = [];
  }

  clear() { for (const c of this.cars) this.scene.remove(c.vis.root); this.cars = []; this.initDone = false; this.byId = new Map(); this.srvOff = undefined; }
  remove(i) { const c = this.cars[i]; this.scene.remove(c.vis.root); this.cars.splice(i, 1); if (c.id !== undefined && this.byId) this.byId.delete(c.id); }

  // ---------------------------------------------------------------- online: shared traffic
  // On a server the traffic is simulated once by the server and everyone sees the same cars. This
  // side only draws them: each snapshot (~10/s) gives every nearby car's road position; cars are
  // drawn ~150 ms in the past, smoothly interpolated between snapshots. A car YOU hit is simulated
  // here (the crash physics) and its resting place is reported back so everyone sees it.
  applySnapshot(m) {
    const now = performance.now() / 1000, off = now - m.ts;
    this.srvOff = this.srvOff === undefined ? off : Math.min(off, this.srvOff + 0.0005);   // fastest delivery seen (drifts up slowly)
    if (!this.byId) this.byId = new Map();
    for (const [id, key, color] of m.add || []) {
      if (this.byId.has(id)) continue;
      const type = TTYPES.find(t => t.key === key) || TTYPES[0];
      const vis = makeVehicle(type.key, paintMat(color), null, true);
      vis.root.visible = false;
      this.scene.add(vis.root);
      const M = vis.M;
      const c = { id, type, vis, front: M.front, rear: M.rear, hw: M.W, hull: M.hull, mass: type.mass, Iz: type.mass * ((M.front - M.rear) ** 2 + (2 * M.W) ** 2) / 12,
        s: 0, d: 0, v: 0, acc: 0, relYaw: 0, lane: 0, tgt: 0, ind: 0, crashed: false, body: null, yaw: 0, crashT: 0, x: 0, z: 0,
        nm: { active: false, done: false, min: 9 }, buf: [], remote: true };
      this.byId.set(id, c); this.cars.push(c);
    }
    for (const id of m.rm || []) { const c = this.byId.get(id); if (c) c.goneAt = m.ts; }
    for (const e of m.cars) {
      const c = this.byId.get(e[0]); if (!c) continue;
      c.goneAt = undefined;
      c.buf.push({ t: m.ts, s: m.base + e[1] / 10, d: e[2] / 100, v: e[3] / 10, f: e[4], ry: e[5] / 1000 });
      if (c.buf.length > 16) c.buf.shift();
    }
  }
  sampleRemote(c, t) {
    const b = c.buf; if (!b.length) return null;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > t) i--;
    if (i === 0) return b[0];
    const a = b[i - 1], n = b[i], k = U.clamp((t - a.t) / Math.max(n.t - a.t, 1e-3), 0, 1.6);
    return { s: a.s + (n.s - a.s) * k, d: a.d + (n.d - a.d) * k, v: a.v + (n.v - a.v) * k, ry: a.ry + U.wrap(n.ry - a.ry) * k, f: k < 0.5 ? a.f : n.f };
  }
  updateRemote(dt, P) {
    const rt = performance.now() / 1000 - (this.srvOff || 0) - 0.15;
    const blink = (this.time * 1.45 % 1) < 0.55;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.goneAt !== undefined && rt >= c.goneAt && !c.local) { this.remove(i); continue; }
      if (c.local) {                                   // a car we hit: our crash physics + recovery, reported to everyone
        this.updateCrashed(c, dt);
        if (c.gone) { if (this.onGone) this.onGone(c); this.remove(i); continue; }
        if (!c.local) continue;                        // (just recovered: the server drives it again)
        c.repT = (c.repT || 0) - dt;
        if (c.repT <= 0 && this.onReport) { c.repT = 0.1; this.onReport(c); }
        continue;
      }
      const st = this.sampleRemote(c, rt);
      if (!st) continue;
      const pd = c.d;
      c.s = st.s; c.d = st.d; c.v = st.v; c.relYaw = st.ry;
      c.crashed = !!(st.f & 8);
      const p = ROAD.pos(c.s, c.d);
      c.x = p.x; c.z = p.z; c.yaw = ROAD.yaw(c.s) + c.relYaw;
      const vis = c.vis;
      vis.root.visible = true;
      vis.root.position.set(p.x, 0, p.z);
      vis.root.rotation.y = -c.yaw;
      const near = Math.abs(c.s - P.s) < 160;
      if (vis.lodNear !== near) { vis.lodNear = near; for (const w of vis.wheels) w.pivot.visible = near; }
      if (near) animateWheels(vis, c.v * dt, c.relYaw * 4);
      const ind = c.crashed ? 0 : (st.f & 3) === 1 ? -1 : (st.f & 3) === 2 ? 1 : 0;
      vis.brake.visible = near && (c.crashed || !!(st.f & 4));
      vis.indL.visible = near && blink && (c.crashed || ind < 0);
      vis.indR.visible = near && blink && (c.crashed || ind > 0);
      c.lane = ROAD.nearestLane(c.d); c.tgt = c.lane; c.latV = (c.d - pd) / Math.max(dt, 1e-4);
    }
  }

  // ---------------------------------------------------------------- lanes / neighbours
  // an agent (car, crashed car or the player) is "in" every lane its body overlaps by more than 0.3 m
  static lanesOf(d, hw) {
    const out = [];
    for (let l = 0; l < ROAD.LANES; l++) if (Math.abs(d - ROAD.lane(l)) < ROAD.LW / 2 + hw - 0.3) out.push(l);
    return out;
  }
  // sideways half-width an agent takes up: a crashed car turned across the road covers far more than its own width
  static widthOf(o) {
    if (!o.crashed) return o.hw;
    const ry = o.body ? U.wrap(o.yaw - ROAD.yaw(o.s)) : (o.relYaw || 0);
    return Math.abs(Math.sin(ry)) * (o.front - o.rear) / 2 + Math.abs(Math.cos(ry)) * o.hw;
  }
  buildLanes(P, extra) {
    for (const L of this.lanes) L.length = 0;
    const add = o => { for (const l of Traffic.lanesOf(o.d, Traffic.widthOf(o))) this.lanes[l].push(o); };
    for (const c of this.cars) add(c);
    if (P) add(P);
    if (extra) for (const o of extra) add(o);   // multiplayer: friends' cars
    for (const L of this.lanes) L.sort((a, b) => a.s - b.s);
  }
  // nearest agent ahead / behind of car c in lane l (by centre position)
  leadIn(c, l) {
    let best = null;
    for (const o of this.lanes[l]) if (o !== c && o.s > c.s && (!best || o.s < best.s)) best = o;
    return best ? { gap: best.s + best.rear - (c.s + c.front), v: best.v, o: best } : null;
  }
  followIn(c, l) {
    let best = null;
    for (const o of this.lanes[l]) if (o !== c && o.s <= c.s && (!best || o.s > best.s)) best = o;
    return best ? { gap: c.s + c.rear - (best.s + best.front), v: best.v, o: best } : null;
  }

  // ---------------------------------------------------------------- zones helpers
  inPostZone(s) { for (const z of ZONES.near(s - 560, s)) if (s > z.end - 30 && s < z.end + z.taperOut + 500) return true; return false; }
  closedLaneAhead(l, s, dist) { return ZONES.closedAhead(l, s, dist); }

  // ---------------------------------------------------------------- lane-change safety
  // can car c move into lane l right now? bSafe = how hard the new follower may have to brake
  safeIn(c, l, bSafe, minGap) {
    const L = this.leadIn(c, l), F = this.followIn(c, l);
    // drivers accept about half their normal following distance for the move, then settle back
    if (L && (L.gap < minGap || c.idm(L, c.v, 0.45) < -bSafe)) return false;
    if (F) {
      if (F.gap < minGap) return false;
      if (F.o.isPlayer) { if (F.gap < 6 + Math.max(0, F.v - c.v) * 2.6) return false; }
      else if (F.o.crashed) { if (F.gap < 4) return false; }
      else if (F.o.idm({ gap: F.gap, v: c.v }, F.o.v, 0.45) < -bSafe) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- decisions
  decide(c, P) {
    const z = this.closedLaneAhead(c.lane, c.s, c.mergeAt);
    if (z) { // our lane closes ahead: signal toward the open side and keep trying (forced)
      const nl = c.lane === 0 ? 1 : c.lane === ROAD.LANES - 1 ? c.lane - 1 : c.lane + (z.side === 0 ? 1 : -1);
      c.forced = true; c.pending = nl; c.ind = nl < c.lane ? -1 : 1; c.indT = U.rand(1, 1.8); c.indWait = 0;
      return;
    }
    const cur = this.leadIn(c, c.lane), aCur = c.idm(cur);
    // stuck behind something stopped (a crash, the player, a queue): pull out around it
    if (cur && cur.v < 2 && cur.gap < 30 && c.v < 8) {
      for (const dir of (Math.random() < 0.5 ? [-1, 1] : [1, -1])) {
        const nl = c.lane + dir;
        if (nl < 0 || nl >= ROAD.LANES || (c.type.truck && nl < TRUCK_LANES)) continue;
        if (this.closedLaneAhead(nl, c.s - 30, 200)) continue;
        const L = this.leadIn(c, nl);
        if (L && L.v < 2 && L.gap < cur.gap + 8) continue;           // that lane is just as stuck
        if (!this.safeIn(c, nl, 3, 3)) continue;
        c.blocked = true; c.forced = false; c.pending = nl; c.ind = dir; c.indT = U.rand(1, 1.6); c.indWait = 0;
        return;
      }
      return;
    }
    if (c.v < 8) return;                                         // no optional lane changes in a crawl
    const post = this.inPostZone(c.s);
    // roadworks: the lane that just reopened (drivers spread back into it), and the lane next to a
    // closure coming up (courteous drivers move one lane further over so the mergers have room)
    let reopened = -1, awayDir = 0;
    for (const z of ZONES.near(c.s - 800, c.s + 900)) {
      if (c.s > z.end && c.s < z.end + z.taperOut + 700) reopened = z.side;
      const next = z.side === 0 ? 1 : 2;
      if (c.lane === next && z.start > c.s && z.start - c.s < 900) awayDir = z.side === 0 ? 1 : -1;
    }
    let best = -1, bestGain = c.thresh;
    for (const dir of [-1, 1]) {
      const nl = c.lane + dir;
      if (nl < 0 || nl >= ROAD.LANES) continue;
      if (c.type.truck && nl < TRUCK_LANES) continue;
      if (this.closedLaneAhead(nl, c.s - 30, c.mergeAt + 120)) continue;   // never into a lane about to close
      if (!this.safeIn(c, nl, 3, 2.5)) continue;
      // Balanced on purpose: the lane to the left is always faster, so judging moves by "how much faster
      // could I go" pulled every car left over time and emptied the right lanes. Optional moves are
      // just a driver's spontaneous wish (left or right equally likely) - as long as the new lane isn't
      // clearly worse for them - plus real overtakes when someone is stuck behind a slower car.
      const aNew = c.idm(this.leadIn(c, nl)), held = c.v < c.v0 - 3 && aCur < 0;
      let gain = -1;
      if (!post) {
        if (c.wish === dir && aNew > aCur - 0.6) gain = 0.5;
        if (held && aNew > aCur + 0.4) gain = Math.max(gain, aNew - aCur);
      } else if (held && aNew > aCur + 0.8) gain = aNew - aCur;
      if (nl === reopened && c.spreads && aNew > aCur - 0.6) gain = Math.max(gain, 0.6);
      if (dir === awayDir && c.courteous && aNew > aCur - 0.6) gain = Math.max(gain, 0.45);
      if (gain > bestGain) { bestGain = gain; best = nl; }
    }
    if (best >= 0) { c.forced = false; c.pending = best; c.ind = best < c.lane ? -1 : 1; c.indT = U.rand(2, 4); c.indWait = 0; c.wish = 0; }
  }

  startChange(c, l) { c.tgt = l; c.chg0 = c.d; }

  // ---------------------------------------------------------------- spawning
  pickType(lane) {
    const pool = lane < TRUCK_LANES ? TTYPES.filter(t => !t.truck) : TTYPES;
    return U.weighted(pool);
  }
  laneCount(l, P) { let n = 0; for (const c of this.cars) if (!c.crashed && c.tgt === l && c.s > P.s - WIN_BACK && c.s < P.s + WIN_AHEAD) n++; return n; }
  // biggest empty stretch in lane l inside [a, b]; returns its middle or null
  biggestGap(l, a, b, avoid) {
    const xs = this.cars.filter(c => Math.abs(c.d - ROAD.lane(l)) < 2.6).map(c => c.s).filter(s => s > a && s < b).sort((p, q) => p - q);
    const pts = [a, ...xs, b];
    let best = null, bl = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      let lo = pts[i], hi = pts[i + 1];
      if (avoid && lo < avoid + 60 && hi > avoid - 60) { if (avoid - 60 - lo > hi - avoid - 60) hi = avoid - 60; else lo = avoid + 60; }
      if (hi - lo > bl) { bl = hi - lo; best = (lo + hi) / 2 + (hi - lo) * U.rand(-0.12, 0.12); }
    }
    return bl > 30 ? best : null;
  }
  // room = how much clear road the new car needs in front and behind (metres)
  spawnAt(l, s, room = 14) {
    if (this.closedLaneAhead(l, s - 20, 150)) return null;         // never in / just before a closed lane
    const type = this.pickType(l), M = getModel(type.key);
    for (const o of this.cars) {
      if (Math.abs(o.d - ROAD.lane(l)) > 2.6) continue;
      if (o.s + o.front > s + M.rear - room && o.s + o.rear < s + M.front + room) return null;
    }
    const c = new TrafficCar(type, s, l, this.scene);
    // don't start faster than a car close ahead in the lane
    let lead = null;
    for (const o of this.cars) { const g = o.s - s; if (g > 0 && g < 120 && Math.abs(o.d - c.d) < 2.6 && (!lead || o.s < lead.s)) lead = o; }
    if (lead) c.v = Math.min(c.v, lead.v);
    this.cars.push(c);
    return c;
  }

  // total cars in the window; tuned so 70% puts ~27 cars between just behind you and 250 m ahead
  target(density) { return Math.round((90 * density + 90 * density * density) * TRAFFIC_SCALE); }

  maintain(P, density, dt = 0) {
    const N = this.target(density);
    const perLane = l => N * [0.26, 0.26, 0.25, 0.23][l];
    // density changed: drop the farthest cars, refill evenly
    if (this.lastDensity !== undefined && density !== this.lastDensity) {
      while (this.cars.length > N) {
        let far = -1, fd = -1;
        for (let i = 0; i < this.cars.length; i++) { const ad = Math.abs(this.cars[i].s - P.s); if (ad > fd && (ad > 40 || N === 0)) { fd = ad; far = i; } }
        if (far < 0) break;
        this.remove(far);
      }
      this.initDone = false;
    }
    this.lastDensity = density;
    // leave the window -> gone (ahead they vanish in the haze, behind they're out of sight)
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const ds = this.cars[i].s - P.s;
      if (ds < -WIN_BACK || ds > WIN_AHEAD) this.remove(i);
    }
    if (!this.initDone) {
      // fill: every lane gets its share, each car into the biggest gap (even spread, nothing on top of you)
      let guard = 0;
      for (let l = 0; l < ROAD.LANES; l++) {
        while (this.laneCount(l, P) < perLane(l) && guard++ < 600) {
          const s = this.biggestGap(l, P.s - WIN_BACK + 10, P.s + WIN_AHEAD - 40, P.s);
          if (s === null || !this.spawnAt(l, s)) break;
        }
      }
      this.initDone = true;
      return;
    }
    // Running: keep re-applying the same even fill as the start, but only in the stretches you can't
    // see - far ahead in the haze and behind you - so everything that drives into view arrives in that
    // "first group" pattern. Cars you can see are never added or removed.
    this.bandT = (this.bandT || 0) - dt;
    if (this.bandT <= 0) {
      this.bandT = 0.25;
      this.fillBand(P, P.s + 600, P.s + WIN_AHEAD - 10, density);
      this.fillBand(P, P.s - WIN_BACK + 10, P.s - 70, density);
    }
  }

  // Within 1.5 km before roadworks, drivers have already spread away from the closure (like real
  // traffic): far fewer cars in the closing lane, a few fewer in the lane next to it, a few more on the
  // other side. Two full lanes squeezing into one is more than one lane can carry, so without this
  // the merge always jams. Returns a multiplier per lane for the stretch [a, b].
  static zoneShares(T, a, b) {
    const k = [1, 1, 1, 1];
    for (const side of [0, 3]) {
      if (!T.closedLaneAhead(side, a, b - a + 1500)) continue;
      const next = side === 0 ? 1 : 2, far = side === 0 ? 2 : 1;
      k[side] *= 0.35; k[next] *= 0.85; k[far] *= 1.15; k[side === 0 ? 3 : 0] *= 1.1;
    }
    return k;
  }

  // bring every lane in [a, b] back to its even spacing: add into the biggest gaps, remove the most crowded extras
  fillBand(P, a, b, density) {
    const N = this.target(density), shares = [0.26, 0.26, 0.25, 0.23];
    const closed = [0, 1, 2, 3].map(l => !!this.closedLaneAhead(l, a - 20, b - a + 40));
    const laneK = Traffic.zoneShares(this, a, b);
    for (let l = 0; l < ROAD.LANES; l++) {
      if (closed[l]) continue;                                    // roadworks: no cars in a closed lane
      const spacing = (WIN_AHEAD + WIN_BACK) / Math.max(N * shares[l], 1);
      const want = (b - a) / spacing * RUN_DENSITY * laneK[l];
      const inBand = () => this.cars.filter(c => !c.crashed && Math.abs(c.d - ROAD.lane(l)) < 1.2 && c.s > a && c.s < b);
      let guard = 0;
      while (inBand().length < want - 0.5 && guard++ < 6) {
        const s = this.biggestGap(l, a, b);
        if (s === null || !this.spawnAt(l, s, Math.max(12, spacing * 0.35))) break;
      }
      // too many: remove the car squeezed closest to its neighbours (never one that's changing lanes)
      let cs = inBand();
      while (cs.length > want + 1.5) {
        cs.sort((p, q) => p.s - q.s);
        let worst = -1, wg = Infinity;
        for (let i = 0; i < cs.length; i++) {
          if (cs[i].changing) continue;
          const g = Math.min(i > 0 ? cs[i].s - cs[i - 1].s : Infinity, i < cs.length - 1 ? cs[i + 1].s - cs[i].s : Infinity);
          if (g < wg) { wg = g; worst = i; }
        }
        if (worst < 0) break;
        this.remove(this.cars.indexOf(cs[worst]));
        cs = inBand();
      }
    }
  }


  // ---------------------------------------------------------------- per-frame update
  // P: player proxy {s,d,v,front,rear,hw,isPlayer}; others: friends' cars in multiplayer (same shape)
  update(dt, P, density, others) {
    this.time += dt;
    if (this.remote) return this.updateRemote(dt, P);
    for (let i = this.cars.length - 1; i >= 0; i--) if (this.cars[i].gone) this.remove(i);   // wrecks that couldn't get going again
    this.maintain(P, density, dt);
    this.buildLanes(P, others);
    const mergers = this.cars.filter(c => c.forced && c.ind && !c.changing && !c.crashed);

    for (const c of this.cars) {
      if (c.crashed) { this.updateCrashed(c, dt); continue; }

      // ---- desired speed follows the lane you're in / moving to
      c.v0 = U.damp(c.v0, c.laneV0(c.tgt), 0.25, dt);
      c.wishT -= dt;
      if (c.wishT <= 0) {
        c.wishT = U.rand(10, 35) * (this.inPostZone(c.s) ? 2 : 1);
        c.wish = Math.random() < 0.5 ? -1 : 1;
        c.wishLeft = 8;
      }
      if (c.wish && (c.wishLeft -= dt) <= 0) c.wish = 0;

      // ---- longitudinal: IDM against the leader in every lane the car occupies (+ its target lane)
      const ls = Traffic.lanesOf(c.d, c.hw); if (!ls.includes(c.tgt)) ls.push(c.tgt);
      let lead = null;
      for (const l of ls) { const L = this.leadIn(c, l); if (L && (!lead || L.gap < lead.gap)) lead = L; }
      // zipper: make room for a merger that's signalling into our lane and is AHEAD of us
      for (const o of mergers) {
        if (o === c || o.pending !== c.lane) continue;
        const g = o.s + o.rear - (c.s + c.front) - 6;               // leave ~6 m behind it
        if (g < 0 || g > 45) continue;
        if (!lead || g < lead.gap) lead = { gap: g, v: o.v };
      }
      // lane closure ahead: behaves like a stopped obstacle at the taper, while we're still in that lane
      if (Math.abs(c.d - ROAD.lane(c.lane)) < ROAD.LW * 0.45) {
        const zc = this.closedLaneAhead(c.lane, c.s, 260);
        if (zc && c.tgt === c.lane) {
          const zg = zc.start + zc.taper * 0.35 - (c.s + c.front);
          if (zg > -4 && (!lead || zg < lead.gap)) lead = { gap: Math.max(zg, 0.5), v: 0 };
        }
      }
      const a = c.idm(lead);
      c.acc = U.damp(c.acc, a, a < c.acc ? 10 : 6, dt);
      c.v = Math.max(0, c.v + c.acc * dt);
      // pulling out of a queue: creep forward while angling out (until the nose is clear of the car ahead)
      if (c.changing && (c.blocked || c.forced) && lead && lead.v < 2 && lead.gap > 1.2) c.v = Math.max(c.v, Math.min(2, (lead.gap - 1.2) * 0.7));
      c.s += c.v * dt;

      // ---- lane-change decisions
      c.cool -= dt; c.check -= dt;
      if (!c.changing && !c.ind && c.check <= 0) {
        const urgent = this.closedLaneAhead(c.lane, c.s, c.mergeAt);
        if (urgent || c.cool <= 0 || c.v < 2) this.decide(c, P);   // (a stopped car keeps looking for a way round)
        c.check = urgent ? 0.25 : U.rand(0.5, 1.0);
      }
      if (c.ind && !c.changing) {
        c.indT -= dt;
        if (c.indT <= 0) {
          // forced merges accept tighter gaps the closer the taper gets
          let ok;
          if (c.forced) {
            const zc = this.closedLaneAhead(c.lane, c.s, 400), dist = zc ? zc.start - c.s : 400;
            const k = U.clamp(dist / c.mergeAt, 0, 1);
            ok = this.safeIn(c, c.pending, U.lerp(6, 3.5, k), U.lerp(1.2, 2.5, k));
          } else ok = this.safeIn(c, c.pending, 3, 2.5);
          if (ok && (c.v > 3 || c.forced || c.blocked)) this.startChange(c, c.pending);
          else if (!c.forced && (c.indWait += dt) > 6) { c.cool = c.blocked ? U.rand(0.5, 2) : U.rand(3, 7); c.ind = 0; c.blocked = false; }
        }
      }

      // ---- lateral motion: S-curve toward the target lane; sideways speed is capped by forward
      //      speed (heading never more than ~6 deg), so a slow car noses over gently instead of pivoting
      const pd = c.d;
      if (c.changing) {
        // abort early if the player suddenly appears beside us in the target lane
        const progress = Math.abs(c.d - c.chg0) / ROAD.LW;
        const beside = Q => Math.abs(Q.d - ROAD.lane(c.tgt)) < 2.3 && Q.s + Q.front > c.s + c.rear - 3 && Q.s + Q.rear < c.s + c.front + 3;
        if (progress < 0.4 && !c.forced && (beside(P) || (others && others.some(beside)))) {
          c.tgt = c.lane; c.ind = 0; c.cool = U.rand(3, 6);
        }
      }
      const err = ROAD.lane(c.tgt) - c.d;
      // (a car pulling out of a queue may angle up to ~20 deg at walking pace, like a real driver)
      const cap = Math.min(c.latMax, (c.blocked || c.forced) && c.v < 5 ? 0.36 * c.v + 0.08 : 0.1 * c.v + 0.04);
      const want = U.clamp(err * 0.8, -cap, cap);
      c.latV += U.clamp(want - c.latV, -0.6 * dt, 0.6 * dt);
      c.d += c.latV * dt;
      if (c.changing && Math.abs(err) < 0.05 && Math.abs(c.latV) < 0.2) {
        c.d = ROAD.lane(c.tgt); c.latV = 0; c.lane = c.tgt; c.ind = 0; c.forced = false; c.blocked = false;
        c.cool = U.rand(5, 12) * (this.inPostZone(c.s) ? 2 : 1);
      } else if (!c.changing && Math.abs(err) < 0.02 && Math.abs(c.latV) < 0.05) { c.d = ROAD.lane(c.lane); c.latV = 0; }
      const latRate = (c.d - pd) / Math.max(dt, 1e-4);
      c.relYaw = U.damp(c.relYaw, Math.atan2(latRate, Math.max(c.v, 2)), 8, dt);

      // ---- visuals
      const p = ROAD.pos(c.s, c.d);
      c.x = p.x; c.z = p.z; c.yaw = ROAD.yaw(c.s) + c.relYaw;
      const vis = c.vis;
      vis.root.position.set(p.x, 0, p.z);
      vis.root.rotation.y = -c.yaw;
      const near = Math.abs(c.s - P.s) < 160;            // far cars skip wheels and lamp overlays
      if (vis.lodNear !== near) { vis.lodNear = near; for (const w of vis.wheels) w.pivot.visible = near; }
      if (near) animateWheels(vis, c.v * dt, c.relYaw * 4);
      vis.brake.visible = near && (c.acc < -0.8 || c.v < 0.5);
      const blink = (this.time * 1.45 % 1) < 0.55;
      const ind = c.changing ? Math.sign(c.tgt - c.lane) : c.ind;
      vis.indL.visible = near && ind < 0 && blink;
      vis.indR.visible = near && ind > 0 && blink;
    }
  }

  // ---------------------------------------------------------------- crashes
  crash(c) {
    if (this.remote && !c.local) { c.crashed = false; c.local = true; c.crashT = 0; c.vis.root.visible = true; }   // we take over this car's crash
    if (c.crashed) return;
    c.crashed = true; c.ind = 0; c.tgt = c.lane; c.forced = false;
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    c.body = { x: c.x, z: c.z, vx: c.v * sy, vz: -c.v * cy, w: 0, im: 1 / c.mass, ii: 1 / c.Iz };
    c.nm.done = true;
  }

  // ---- after a crash: once the car has stopped it straightens up and pulls back into the nearest clear
  // lane, then drives on. If it's off the road, or no lane frees up for a while, it disappears instead.
  laneClearFor(c, l, s) {
    const d = ROAD.lane(l);
    for (const o of this.cars) {
      if (o === c || Math.abs(o.d - d) > 2.8) continue;
      if (o.s > s && o.s - s < 12) return false;                                         // someone right ahead
      if (o.s <= s && s - o.s < 8 + Math.max(0, (o.v || 0) - 10) * 1.3) return false;   // someone coming too fast behind
    }
    return true;
  }
  startRecovery(c) {
    const pr = ROAD.project(c.body.x, c.body.z);
    if (pr.d < ROAD.edgeL - 0.5 || pr.d > ROAD.edgeR + 0.5) { c.rec = { fade: true, t: 0 }; return; }
    const pref = ROAD.nearestLane(pr.d);
    for (const l of [pref, pref - 1, pref + 1, pref - 2, pref + 2]) {
      if (l < 0 || l >= ROAD.LANES || !this.laneClearFor(c, l, pr.s)) continue;
      c.rec = { t: 0, T: 2.6, s: pr.s, d0: pr.d, ry0: U.wrap(c.yaw - ROAD.yaw(pr.s)), lane: l, v: 0 };
      return;
    }
    if (c.crashT > 10) c.rec = { fade: true, t: 0 };            // boxed in for too long: just disappear
  }
  recoverStep(c, dt) {
    const r = c.rec, vis = c.vis;
    r.t += dt;
    if (r.fade) {                                              // sink out of sight, then gone
      const k = Math.min(1, r.t / 1.2);
      vis.root.position.y = -1.8 * k * k;
      if (k >= 1) c.gone = true;
      return;
    }
    const k = U.smooth(0, 1, r.t / r.T);
    r.v = Math.min(17, r.v + 6.5 * dt);                       // (gets up to ~60 km/h; the lane's flow carries it on from there)
    r.s += r.v * dt;
    c.s = r.s; c.d = U.lerp(r.d0, ROAD.lane(r.lane), k); c.relYaw = r.ry0 * (1 - k); c.v = r.v;
    const p = ROAD.pos(c.s, c.d);
    c.x = p.x; c.z = p.z; c.yaw = ROAD.yaw(c.s) + c.relYaw;
    const b = c.body;                                          // (keep the physics body with it, in case it's hit again)
    b.x = c.x; b.z = c.z; b.vx = c.v * Math.sin(c.yaw); b.vz = -c.v * Math.cos(c.yaw); b.w = 0;
    vis.root.position.set(c.x, 0, c.z); vis.root.rotation.y = -c.yaw;
    animateWheels(vis, c.v * dt, 0);
    vis.brake.visible = false; vis.indL.visible = vis.indR.visible = (this.time * 1.45 % 1) < 0.55;
    if (r.t < r.T) return;
    // back to normal driving
    c.crashed = false; c.body = null; c.rec = null; c.crashT = 0;
    c.lane = c.tgt = r.lane; c.d = ROAD.lane(r.lane); c.relYaw = 0; c.latV = 0; c.acc = 0;
    c.ind = 0; c.forced = false; c.blocked = false; c.pending = undefined; c.cool = U.rand(3, 6); c.check = 1;
    c.nm = { active: false, done: true, min: 9 };
    vis.indL.visible = vis.indR.visible = false;
    if (this.remote) { c.local = false; c.buf = []; if (this.onRecover) this.onRecover(c); }
  }

  updateCrashed(c, dt) {
    if (c.rec) { this.recoverStep(c, dt); return; }
    const b = c.body;
    c.crashT += dt;
    // stopped (or long enough): try to get going again
    if ((c.crashT > 2.2 && Math.hypot(b.vx, b.vz) < 0.6 && Math.abs(b.w) < 0.15) || c.crashT > 8) {
      c.recTry = (c.recTry || 0) - dt;
      if (c.recTry <= 0) { c.recTry = 0.8; this.startRecovery(c); if (c.rec) return; }
    }
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    let fv = b.vx * sy - b.vz * cy, lv = b.vx * cy + b.vz * sy;
    const dec = (x, a) => Math.sign(x) * Math.max(0, Math.abs(x) - a * dt);
    fv = dec(fv, 4.5);           // driver brakes to a stop
    lv = dec(lv, 8.5);           // tyres scrub sideways motion
    b.vx = fv * sy + lv * cy; b.vz = -fv * cy + lv * sy;
    b.w = dec(b.w, 2.2) * Math.exp(-1.2 * dt);
    b.x += b.vx * dt; b.z += b.vz * dt; c.yaw += b.w * dt;
    this.wallCollide(c);
    const pr = ROAD.project(b.x, b.z);
    c.s = pr.s; c.d = pr.d; c.x = b.x; c.z = b.z;
    const ry = ROAD.yaw(pr.s);
    c.v = Math.max(0, b.vx * Math.sin(ry) - b.vz * Math.cos(ry));
    c.vis.root.position.set(b.x, 0, b.z);
    c.vis.root.rotation.y = -c.yaw;
    animateWheels(c.vis, fv * dt, 0);
    const blink = (this.time * 1.45 % 1) < 0.55;
    c.vis.indL.visible = c.vis.indR.visible = blink;
    c.vis.brake.visible = true;
  }

  // crashed cars vs guard rails + construction walls: solid, the car bounces off and scrubs along them
  wallCollide(c) {
    const b = c.body;
    const pts = SAT.toWorld(c.hull, b.x, b.z, c.yaw, this._pw || (this._pw = []));
    const cd = ROAD.project(b.x, b.z).d;
    for (const q of pts) {
      const pr = ROAD.project(q[0], q[1]);
      const walls = [{ sg: -1, d: ROAD.edgeL - 0.35 }];
      if (!ROAD.railOpen(1, pr.s) && (!ROAD.loop || cd < ROAD.edgeR + 0.35)) walls.push({ sg: 1, d: ROAD.edgeR + 0.35 });
      for (const z of ZONES.near(pr.s, pr.s)) {
        if (ZONES.frac(z, pr.s) <= 0) continue;
        const wd = ZONES.wallD(z, pr.s), sg = z.side === 0 ? -1 : 1;
        if ((cd - wd) * sg > 0.4) continue; // car is already inside the closure: leave it
        walls.push({ sg, d: wd, zone: true });
      }
      const ry = ROAD.yaw(pr.s);
      for (const wl of walls) {
        const pen = wl.sg > 0 ? pr.d - wl.d : wl.d - pr.d;
        if (pen <= 0 || (wl.zone && pen > 1.4)) continue; // (deep past the barrier = beyond its ends)
        const nx = wl.sg * Math.cos(ry), nz = wl.sg * Math.sin(ry);
        resolveImpulse(b, { x: q[0], z: q[1], vx: 0, vz: 0, w: 0, im: 0, ii: 0 }, { nx, nz, depth: pen + 0.02, px: q[0], pz: q[1] }, wl.zone ? 0.15 : 0.2, 0.4);
      }
    }
    c.x = b.x; c.z = b.z;
  }

  // ---- collisions: player <-> traffic, crashed <-> traffic ----
  // returns max impact normal speed with the player this frame
  collide(player, playerHull) {
    let impact = 0;
    const pb = player.toBody();
    const PA = SAT.toWorld(playerHull, pb.x, pb.z, player.visYaw, this._pa);
    let hit = false;
    for (const c of this.cars) {
      const dx = c.x - pb.x, dz = c.z - pb.z, rr = (c.front - c.rear) / 2 + 5;
      if (dx * dx + dz * dz > rr * rr + 100) continue;
      const B = SAT.toWorld(c.hull, c.x, c.z, c.yaw, this._pb);
      const col = SAT.test(PA, B);
      if (!col) continue;
      this.crash(c);
      if (c.rec) { c.rec = null; c.crashT = 0; c.vis.root.position.y = 0; }   // hit again while recovering: back to sliding
      const vn = resolveImpulse(pb, c.body, col, 0.12, 0.35);
      impact = Math.max(impact, vn);
      this.wallCollide(c); // shoved into a wall: it stops there instead of passing through
      hit = true;
      SAT.toWorld(playerHull, pb.x, pb.z, player.visYaw, PA);
    }
    if (hit) player.fromBody(pb);
    // crashed cars are solid: a sliding wreck knocks into other cars, and a car that runs into a wreck
    // crashes too. (Online: only the wrecks this player is simulating; the cars it hits are taken over
    // and reported to the server, so everyone sees the pile-up.)
    for (const a of this.cars) {
      if (!a.crashed || !a.body || a.rec || (this.remote && !a.local)) continue;
      const ab = a.body;
      const A = SAT.toWorld(a.hull, ab.x, ab.z, a.yaw, this._pa);
      for (const c of this.cars) {
        if (c === a || c.rec) continue;
        const dx = c.x - ab.x, dz = c.z - ab.z;
        if (dx * dx + dz * dz > 600) continue;
        const moving = Math.hypot(ab.vx, ab.vz) > 0.3 || Math.abs(ab.w) > 0.05;
        if (!moving && (c.crashed || c.v < 1)) continue;         // two cars at rest don't push each other
        const B = SAT.toWorld(c.hull, c.x, c.z, c.yaw, this._pb);
        const col = SAT.test(A, B);
        if (!col) continue;
        if (!c.crashed) {                                         // a light brush isn't a crash: only a real hit (> ~11 km/h)
          const cvx = c.v * Math.sin(c.yaw), cvz = -c.v * Math.cos(c.yaw);
          if ((ab.vx - cvx) * col.nx + (ab.vz - cvz) * col.nz < 3) continue;
        }
        this.crash(c);
        resolveImpulse(ab, c.body, col, 0.15, 0.35);
        this.wallCollide(c); this.wallCollide(a);
        SAT.toWorld(a.hull, ab.x, ab.z, a.yaw, A);
      }
    }
    return impact;
  }

  // smallest distance between the player's and a car's outline rectangles, in road (s, d) space
  outlineGap(P, c) {
    const quad = (s, d, ry, f, r, hw) => {
      const cs = Math.cos(ry), sn = Math.sin(ry);
      return [[f, hw], [f, -hw], [r, -hw], [r, hw]].map(([lf, lx]) => [s + lf * cs - lx * sn, d + lf * sn + lx * cs]);
    };
    const A = quad(P.s, P.d, P.ry || 0, P.front, P.rear, P.hw), B = quad(c.s, c.d, c.relYaw || 0, c.front, c.rear, c.hw);
    const ptSeg = (p, a, b) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], t = U.clamp(((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / (ux * ux + uy * uy || 1), 0, 1);
      return Math.hypot(p[0] - a[0] - ux * t, p[1] - a[1] - uy * t);
    };
    let m = Infinity;
    for (const [X, Y] of [[A, B], [B, A]]) for (const p of X) for (let i = 0; i < 4; i++) m = Math.min(m, ptSeg(p, Y[i], Y[(i + 1) % 4]));
    return m;
  }

  // near-miss detection: returns list of {gap, rel}
  nearMisses(P, kmh) {
    const out = [];
    for (const c of this.cars) {
      const n = c.nm;
      if (c.crashed) { n.active = false; continue; }
      const pf = P.s + P.front, pr = P.s + P.rear, cf = c.s + c.front, cr = c.s + c.rear;
      if (pf < cr - 2) { n.active = false; n.done = false; n.min = 9; continue; } // car is ahead of us
      // closest approach from just behind it until we're a few metres clear of its nose (real outlines),
      // so a tight diagonal cut past a corner counts too
      if (pr < cf + 3) {
        if (pf > cr - 1.5) {
          n.active = true;
          const gap = this.outlineGap(P, c);
          if (gap < n.min) n.min = gap;
        }
        continue;
      }
      if (n.active && !n.done) {
        n.done = true; n.active = false;
        if (n.min < 1.15 && n.min > -0.2 && kmh > 70 && P.v - c.v > 2) out.push({ gap: Math.max(n.min, 0), rel: (P.v - c.v) * 3.6 });
      }
    }
    return out;
  }
}
