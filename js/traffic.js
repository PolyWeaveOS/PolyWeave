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
const DRAW_DIST = 750;                                   // ...but cars further than this are tiny specks in the haze: not drawn
const TRAFFIC_SCALE = 1.16;                              // overall traffic amount (sets the opening fill)
// The opening fill keeps the area around you clear, which packs the road ahead (100-600 m) at ~22% more
// cars than the same total spread evenly. The ongoing fill uses that same density, so traffic
// keeps looking like the first group instead of thinning out after it.
const RUN_DENSITY = 1.23;
const LANE_SHARE = [0.26, 0.26, 0.25, 0.23];            // share of the cars in each lane

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
    this.pers = U.rand(-8, 8);                           // km/h above / below the lane's flow
    this.T = U.rand(0.9, 1.4) * (type.truck ? 1.2 : 1);  // time headway
    this.s0 = type.truck ? 4 : 2.5;                      // standstill gap
    this.bComf = type.truck ? 1.6 : 2.2;
    this.thresh = U.rand(0.15, 0.3);                     // how much better a lane must be to bother
    this.latMax = type.truck ? U.rand(0.85, 1.15) : U.rand(1.15, 1.6);   // sideways speed when changing lanes (m/s)
    this.mergeAt = type.truck ? U.rand(300, 700) : U.rand(150, 650);     // where they leave a closing lane (spread out, not all at the cones)
    this.courteous = Math.random() < 0.5;                // moves out of the lane next to roadworks to make room for mergers
    this.spreads = Math.random() < 0.75;                 // moves back into the reopened lane after roadworks
    this.seeAt = U.rand(110, 380);                       // how far ahead they notice something stopped / slow and move over
    // state
    this.s = s; this.lane = lane; this.tgt = lane; this.d = ROAD.lane(lane); this.latV = 0;
    this.v0 = this.laneV0(lane); this.v = this.v0; this.acc = 0; this.relYaw = 0;
    this.ind = 0; this.indT = 0; this.indWait = 0; this.forced = false;
    this.cool = U.rand(3, 24); this.check = U.rand(0, 1);
    this.wish = 0; this.wishT = U.rand(9, 75);
    this.crashed = false; this.body = null; this.yaw = 0; this.crashT = 0;
    this.nm = { active: false, done: false, min: 9 };
    this.x = 0; this.z = 0;
  }
  get changing() { return this.tgt !== this.lane; }
  laneV0(lane) { const t = this.type; return U.clamp(LANE_KMH[lane] * (t.truck ? 0.97 : 1) + this.pers, t.vmin, t.vmax) / 3.6; }
  // how much the car ahead in `lane` would hold this driver back there, judged at THAT lane's speed
  // (so a slower lane to the right isn't "worse" just for being slower: no more everyone drifting left)
  leadDrag(lead, lane) {
    if (!lead) return 0;
    const v0 = this.v0; this.v0 = this.laneV0(lane);
    // (judged with the shorter gap drivers accept for a lane change, like safeIn)
    const v = Math.min(this.v, this.v0 + 1), r = this.idm(lead, v, 0.5) - this.idm(null, v);
    this.v0 = v0; return r;
  }
  // tScale < 1: the shorter gap a driver accepts for a moment when changing lanes (they then drop back)
  // Car following is the "ACC" version of the IDM (Treiber & Kesting): plain IDM slams on the brakes
  // whenever someone slots in a bit close, even when easing off slightly is all it takes (which is why
  // drivers hardly ever found a gap to change lanes). ACC brakes only as hard as the situation needs.
  idm(lead, v = this.v, tScale = 1) {
    const a = this.type.amax;
    let acc = a * (1 - Math.pow(Math.max(v, 0) / Math.max(this.v0, 1), 4));
    if (lead) {
      const dv = v - lead.v, s = Math.max(lead.gap, 0.5);
      const ss = this.s0 + Math.max(0, v * this.T * tScale + v * dv / (2 * Math.sqrt(a * this.bComf)));
      acc -= a * Math.pow(ss / s, 2);
      // constant-acceleration heuristic: the braking that's really needed if the leader keeps its acceleration
      const al = lead.v < 0.5 ? 0 : Math.min((lead.o && lead.o.acc) || 0, a);
      let cah;
      if (al < 0 && lead.v * dv <= -2 * s * al) cah = v * v * al / (lead.v * lead.v - 2 * s * al);
      else cah = al - (dv > 0 ? dv * dv / (2 * s) : 0);
      if (acc < cah) acc = 0.01 * acc + 0.99 * (cah + this.bComf * Math.tanh((acc - cah) / this.bComf));
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
    if (i === 0) return Object.assign({ vs: 0, vd: 0, vr: 0 }, b[0]);
    const a = b[i - 1], n = b[i], dt = Math.max(n.t - a.t, 1e-3), k = U.clamp((t - a.t) / dt, 0, 1.6);
    return { s: a.s + (n.s - a.s) * k, d: a.d + (n.d - a.d) * k, v: a.v + (n.v - a.v) * k, ry: a.ry + U.wrap(n.ry - a.ry) * k, f: k < 0.5 ? a.f : n.f,
      vs: (n.s - a.s) / dt, vd: (n.d - a.d) / dt, vr: U.wrap(n.ry - a.ry) / dt };   // (how it's moving: to draw it where it is now)
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
      // A wreck a friend is simulating comes straight from that friend (same clock as their car: car and
      // wreck stay together, exactly as on their screen). Everything else comes from the server's snapshots.
      const wp = this.wreckPose && this.wreckPose.get(c.id);
      let st;
      if (wp) st = { s: wp.s, d: wp.d, ry: wp.ry, v: 0, f: 12 };
      else {
        st = this.sampleRemote(c, rt);
        if (!st) continue;
        // The snapshot is from a moment ago (server delay + the smoothing buffer). Friends' cars are drawn
        // where they are NOW, so carry the traffic forward by the same time - otherwise a friend appears to
        // drive straight through the car they're hitting (it's still ~0.2 s behind on your screen).
        const L = this.lead || 0;
        if (L) {
          if (st.f & 8) { st.s += U.clamp(st.vs, -60, 90) * L; st.d += U.clamp(st.vd, -15, 15) * L; st.ry += U.clamp(st.vr, -6, 6) * L; }
          else { st.s += st.v * L; st.d += U.clamp(st.vd, -3, 3) * L; }
        }
      }
      const pd = c.d;
      c.s = st.s; c.d = st.d; c.v = st.v; c.relYaw = st.ry;
      c.crashed = !!(st.f & 8);
      const p = ROAD.pos(c.s, c.d);
      c.x = p.x; c.z = p.z; c.yaw = ROAD.yaw(c.s) + c.relYaw;
      c.lane = ROAD.nearestLane(c.d); c.tgt = c.lane; c.latV = (c.d - pd) / Math.max(dt, 1e-4);
      const vis = c.vis;
      vis.root.visible = Math.abs(c.s - P.s) < DRAW_DIST;   // (far cars are specks in the haze: not drawn)
      if (!vis.root.visible) continue;
      vis.root.position.set(p.x, 0, p.z);
      vis.root.rotation.y = -c.yaw;
      const near = Math.abs(c.s - P.s) < 160;
      if (vis.lodNear !== near) { vis.lodNear = near; for (const w of vis.wheels) w.pivot.visible = near; }
      if (near) animateWheels(vis, c.v * dt, c.relYaw * 4);
      const ind = c.crashed ? 0 : (st.f & 3) === 1 ? -1 : (st.f & 3) === 2 ? 1 : 0;
      vis.brake.visible = near && (c.crashed || !!(st.f & 4));
      vis.indL.visible = near && blink && (c.crashed || ind < 0);
      vis.indR.visible = near && blink && (c.crashed || ind > 0);
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
    // someone from the lane on the far side is moving into the same lane right next to us
    const far = this.lanes[2 * l - c.lane];
    if (far) for (const o of far) if (o !== c && o.tgt === l && o.lane !== l && Math.abs(o.s - c.s) < 20) return false;
    const L = this.leadIn(c, l), F = this.followIn(c, l);
    // drivers accept about half their normal following distance for the move, then settle back
    // (but never less than ~0.3 s behind / ahead of anyone)
    if (L && (L.gap < minGap + 0.3 * c.v || c.idm(L, c.v, 0.45) < -bSafe)) return false;
    if (F) {
      if (F.gap < minGap + 0.3 * Math.max(F.v, 0)) return false;
      if (F.o.isPlayer) { if (F.gap < 6 + Math.max(0, F.v - c.v) * 2.6) return false; }
      else if (F.o.crashed) { if (F.gap < 4) return false; }
      else if (F.o.idm({ gap: F.gap, v: c.v }, F.o.v, 0.45) < -bSafe) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- decisions
  // the car ahead (within this driver's seeing distance) is stopped or far slower than us
  static slowAhead(c, L) { return !!L && L.gap < c.seeAt && (L.v < 3 || L.v < c.v - 6); }
  decide(c, P, cooled = true) {
    const z = this.closedLaneAhead(c.lane, c.s, c.mergeAt);
    if (z) { // our lane closes ahead: signal toward the open side and keep trying (forced)
      const nl = c.lane === 0 ? 1 : c.lane === ROAD.LANES - 1 ? c.lane - 1 : c.lane + (z.side === 0 ? 1 : -1);
      c.forced = true; c.pending = nl; c.ind = nl < c.lane ? -1 : 1; c.indT = U.rand(1, 1.8); c.indWait = 0;
      return;
    }
    const cur = this.leadIn(c, c.lane), aCur = c.idm(cur);
    // stuck behind something stopped (a crash, the player, a queue): pull out around it
    if (cur && cur.v < 2 && cur.gap < 30 && c.v < 8) {
      // signal toward a side that isn't just as stuck - a clear one if there is one - even when there's
      // no gap yet: courteous drivers in that lane see the signal and leave a gap (see "zipper" in update)
      // (no gap either side: the side where traffic is going slower, where someone can let them in)
      let pick = null, pickV = Infinity;
      for (const dir of (Math.random() < 0.5 ? [-1, 1] : [1, -1])) {
        const nl = c.lane + dir;
        if (nl < 0 || nl >= ROAD.LANES || (c.type.truck && nl < TRUCK_LANES)) continue;
        if (this.closedLaneAhead(nl, c.s - 30, 200)) continue;
        const L = this.leadIn(c, nl);
        if (L && L.v < 2 && L.gap < cur.gap + 8) continue;           // that lane is just as stuck
        if (this.safeIn(c, nl, 3, 3)) { pick = dir; break; }
        const F = this.followIn(c, nl), fv = F ? F.v : 0;
        if (fv < pickV) { pickV = fv; pick = dir; }
      }
      if (pick !== null) { c.blocked = true; c.around = true; c.forced = false; c.pending = c.lane + pick; c.ind = pick; c.indT = U.rand(0.6, 1.2); c.indWait = 0; }
      return;
    }
    if (c.v < 3) return;
    const crawl = c.v < 8;                                       // in a crawl: only into the empty road in front of something stopped
    // Something stopped or much slower ahead (a crash, a stopped player, a queue): drivers see it coming
    // and move over while still moving, each at their own distance - instead of everyone queueing up
    // and pulling out at the same spot. Takes whichever side is clearer (random if both are).
    if (!crawl && Traffic.slowAhead(c, cur)) {
      const dCur = c.leadDrag(cur, c.lane), ok = [];
      for (const dir of [-1, 1]) {
        const nl = c.lane + dir;
        if (nl < 0 || nl >= ROAD.LANES || (c.type.truck && nl < TRUCK_LANES)) continue;
        if (this.closedLaneAhead(nl, c.s - 30, 200)) continue;
        const L = this.leadIn(c, nl);
        if (L && L.gap < cur.gap + 10 && L.v < cur.v + 3) continue;   // that lane is just as blocked
        if (c.leadDrag(L, nl) < dCur + 0.2) continue;
        if (this.safeIn(c, nl, 3.5, 2.5)) ok.push(nl);
      }
      if (ok.length) {                                              // (either side, at random)
        const nl = ok[Math.floor(Math.random() * ok.length)];
        c.forced = false; c.blocked = false; c.around = true; c.pending = nl; c.ind = nl < c.lane ? -1 : 1; c.indT = U.rand(0.4, 1); c.indWait = 0; c.wish = 0;
        return;
      }
    }
    const post = this.inPostZone(c.s);
    // roadworks: the lane that just reopened (drivers spread back into it), and the lane next to a
    // closure coming up (courteous drivers move one lane further over so the mergers have room)
    let reopened = -1, awayDir = 0;
    for (const z of ZONES.near(c.s - 800, c.s + 900)) {
      if (c.s > z.end && c.s < z.end + z.taperOut + 700) reopened = z.side;
      const next = z.side === 0 ? 1 : 2;
      if (c.lane === next && z.start > c.s && z.start - c.s < 900) awayDir = z.side === 0 ? 1 : -1;
    }
    // Balanced on purpose: the lane to the left is always faster, so judging moves by "how much faster
    // could I go" pulls every car left. Lanes are judged only by how much the car ahead in them would
    // hold this driver back (at that lane's own speed), and when more than one lane would do, the side
    // is picked at random. Reasons to move: a spontaneous wish (left or right equally likely), an
    // overtake when stuck behind a slower car (then moving back over afterwards), and a wide-open lane
    // beside them. Only the open-lane move doesn't wait for the driver's cooldown (`cooled`).
    const dCur = c.leadDrag(cur, c.lane), held = c.v < c.v0 - 4 && dCur < -0.3;
    const ok = [];
    for (const dir of [-1, 1]) {
      const nl = c.lane + dir;
      if (nl < 0 || nl >= ROAD.LANES) continue;
      if (c.type.truck && nl < TRUCK_LANES) continue;
      if (this.closedLaneAhead(nl, c.s - 30, c.mergeAt + 120)) continue;   // never into a lane about to close
      const Ln = this.leadIn(c, nl), dNew = c.leadDrag(Ln, nl);
      if (Traffic.slowAhead(c, Ln)) continue;                          // never into a lane with a queue / something stopped ahead
      // the empty road in front of something stopped (a car they just went round): drivers move straight
      // back into it, so that lane doesn't stay empty while the others back up. Otherwise a lane beside
      // that's wide open is just another reason to move over (after the driver's cooldown).
      const Fn = this.followIn(c, nl), inFront = Fn && Fn.v < 3 && Fn.gap < 80;
      if (crawl && !inFront) continue;
      const open = (inFront || cooled) && cur && cur.gap < 60 && (!Ln || (Ln.gap > (inFront ? 50 : 140) && Ln.gap > cur.gap * 2.5));
      // a wish only needs room in that lane (the same test either side: the lanes to the right are slower,
      // so judging by speed made almost every wish to the right fail)
      const room = !Ln || Ln.gap > 6 + Math.max(Ln.v, 0) * 0.45;
      let why = null;
      if (!post) {
        if (open && dNew > -0.3) why = 'open';
        else if (cooled && c.wish === dir && room) why = 'wish';
        else if (cooled && held && dNew > dCur + 0.6) why = 'pass';
      } else if (cooled && held && dNew > dCur + 0.8) why = 'pass';
      if (!why && cooled && nl === reopened && c.spreads && dNew > -0.6) why = 'zone';
      if (!why && cooled && dir === awayDir && c.courteous && dNew > -0.6) why = 'zone';
      if (why && this.safeIn(c, nl, 3, 2.5)) ok.push({ nl, why });
    }
    if (!ok.length) return;
    const pick = ok[Math.floor(Math.random() * ok.length)], nl = pick.nl, dir = nl - c.lane;
    c.forced = false; c.pending = nl; c.ind = dir; c.indT = U.rand(pick.why === 'open' ? 0.6 : 1.5, pick.why === 'open' ? 1.4 : 3); c.indWait = 0; c.wish = 0;
    // after getting past a slower car, they move back over some time later (keeps both sides balanced)
    c.backT = pick.why === 'pass' ? U.rand(6, 16) : 0; c.backDir = -dir;
  }

  // (the car moving in and the one it moves in front of both accept the shorter gap for a while)
  startChange(c, l) {
    c.tgt = l; c.chg0 = c.d; c.tK = 0.45;
    const F = this.followIn(c, l);
    if (F && F.o instanceof TrafficCar) F.o.tK = Math.min(F.o.tK || 1, 0.5);
  }

  // ---------------------------------------------------------------- spawning
  pickType(lane) {
    const pool = lane < TRUCK_LANES ? TTYPES.filter(t => !t.truck) : TTYPES;
    return U.weighted(pool);
  }
  laneCount(l, P) { let n = 0; for (const c of this.cars) if (!c.crashed && c.tgt === l && c.s > P.s - WIN_BACK && c.s < P.s + WIN_AHEAD) n++; return n; }
  // biggest empty stretch in lane l inside [a, b]; returns a random spot in it (not the exact middle:
  // halving gaps put every lane's cars at the same spots, side by side - rows that block the whole road)
  biggestGap(l, a, b, avoid) {
    const xs = this.cars.filter(c => Math.abs(c.d - ROAD.lane(l)) < 2.6).map(c => c.s).filter(s => s > a && s < b).sort((p, q) => p - q);
    const pts = [a, ...xs, b];
    let best = null, bl = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      let lo = pts[i], hi = pts[i + 1];
      if (avoid && lo < avoid + 60 && hi > avoid - 60) { if (avoid - 60 - lo > hi - avoid - 60) hi = avoid - 60; else lo = avoid + 60; }
      if (hi - lo > bl) { bl = hi - lo; best = lo + (hi - lo) * U.rand(0.2, 0.8); }
    }
    return bl > 30 ? best : null;
  }
  // would a car in lane l at s line up beside cars in ALL the other lanes (a row blocking the road)?
  wallAt(l, s) {
    for (let k = 0; k < ROAD.LANES; k++) {
      if (k === l) continue;
      const d = ROAD.lane(k);
      if (!this.cars.some(o => Math.abs(o.d - d) < 1.6 && Math.abs(this.wd ? this.wd(o.s, s) : o.s - s) < 10)) return false;
    }
    return true;
  }
  // room = how much clear road the new car needs in front and behind (metres)
  spawnAt(l, s, room = 14) {
    if (this.closedLaneAhead(l, s - 20, 150)) return null;         // never in / just before a closed lane
    if (this.wallAt(l, s)) return null;
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
    const perLane = l => N * LANE_SHARE[l];
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
        let fails = 0;
        while (this.laneCount(l, P) < perLane(l) && guard++ < 600 && fails < 8) {
          const s = this.biggestGap(l, P.s - WIN_BACK + 10, P.s + WIN_AHEAD - 40, P.s);
          if (s === null) break;
          if (!this.spawnAt(l, s)) fails++;                       // (random spot: try another)
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

  // something stopped in lane l just past b (a stopped player, a wreck): drivers coming up behind it have
  // mostly moved over long before, so that lane is far emptier back there (otherwise it just keeps
  // filling a queue that the other lanes - already busy - can't take in)
  blockedPast(l, b) {
    for (const o of this.lanes[l]) {
      const ds = this.wd ? this.wd(o.s, b) : o.s - b;
      if (ds > -10 && ds < 300 && (o.crashed || (!(o instanceof TrafficCar) && o.v < 3))) return true;
    }
    return false;
  }
  // per-lane multipliers for the traffic coming up behind b: a blocked lane far emptier, and the others a bit
  // thinner too (4 lanes' worth of traffic can't squeeze into 3 without jamming all of them)
  blockShares(b) {
    const blk = [0, 1, 2, 3].map(l => this.blockedPast(l, b));
    const any = blk.some(x => x);
    return blk.map(x => x ? 0.1 : any ? 0.8 : 1);
  }
  // bring every lane in [a, b] back to its even spacing: add into the biggest gaps, remove the most crowded extras
  fillBand(P, a, b, density) {
    const N = this.target(density), shares = LANE_SHARE;
    const closed = [0, 1, 2, 3].map(l => !!this.closedLaneAhead(l, a - 20, b - a + 40));
    const laneK = Traffic.zoneShares(this, a, b), blockK = this.blockShares(b);
    for (let l = 0; l < ROAD.LANES; l++) {
      if (closed[l]) continue;                                    // roadworks: no cars in a closed lane
      const spacing = (WIN_AHEAD + WIN_BACK) / Math.max(N * shares[l], 1);
      const want = (b - a) / spacing * RUN_DENSITY * laneK[l] * blockK[l];
      const inBand = () => this.cars.filter(c => !c.crashed && Math.abs(c.d - ROAD.lane(l)) < 1.2 && c.s > a && c.s < b);
      let guard = 0, fails = 0;
      while (inBand().length < want - 0.5 && guard++ < 6) {
        const s = this.biggestGap(l, a, b);
        if (s === null) break;
        if (!this.spawnAt(l, s, Math.max(12, spacing * 0.35)) && ++fails > 2) break;
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
    const mergers = this.cars.filter(c => (c.forced || c.blocked || c.around) && c.ind && !c.changing && !c.crashed);

    for (const c of this.cars) {
      if (c.crashed) { this.updateCrashed(c, dt); continue; }

      // ---- desired speed follows the lane you're in / moving to
      c.v0 = U.damp(c.v0, c.laneV0(c.tgt), 0.25, dt);
      c.wishT -= dt;
      if (c.wishT <= 0) {
        c.wishT = U.rand(18, 66) * (this.inPostZone(c.s) ? 2 : 1);
        c.wish = Math.random() < 0.5 ? -1 : 1;
        c.wishLeft = 10;
      }
      if (c.wish && (c.wishLeft -= dt) <= 0) c.wish = 0;

      // ---- longitudinal: IDM against the leader in every lane the car occupies (+ its target lane)
      const ls = Traffic.lanesOf(c.d, c.hw); if (!ls.includes(c.tgt)) ls.push(c.tgt);
      let lead = null;
      for (const l of ls) { const L = this.leadIn(c, l); if (L && (!lead || L.gap < lead.gap)) lead = L; }
      // zipper: make room for a merger that's signalling into our lane and is AHEAD of us. A car getting
      // round something stopped gets let in by courteous drivers who can ease off gently enough
      // (one that's already stuck at a standstill only by drivers who are going slowly themselves).
      for (const o of mergers) {
        if (o === c || o.pending !== c.lane) continue;
        const g = o.s + o.rear - (c.s + c.front) - 6;               // leave ~6 m behind it
        if (o.forced ? (g < 0 || g > 45) : (!c.courteous || (o.blocked && c.v > 26) || g < 0 || g > 140 || (c.v - o.v) ** 2 / (2 * Math.max(g, 1)) > 3)) continue;
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
      // (just after a lane change the gap is short: drivers drop back to their normal distance gently)
      c.tK = Math.min(1, (c.tK || 1) + dt / 8);
      const a = c.idm(lead, c.v, c.tK);
      c.acc = U.damp(c.acc, a, a < c.acc ? 10 : 6, dt);
      c.v = Math.max(0, c.v + c.acc * dt);
      // pulling out of a queue: creep forward while angling out (until the nose is clear of the car ahead)
      if (c.changing && (c.blocked || c.forced) && lead && lead.v < 2 && lead.gap > 0.5) c.v = Math.max(c.v, Math.min(2.5, Math.max(1, (lead.gap - 0.5) * 0.9)));
      c.s += c.v * dt;

      // ---- lane-change decisions
      c.cool -= dt; c.check -= dt;
      if (c.backT > 0 && (c.backT -= dt) <= 0) { c.wish = c.backDir; c.wishLeft = 25; c.cool = 0; }   // back over after passing
      if (!c.changing && !c.ind && c.check <= 0) {
        const urgent = this.closedLaneAhead(c.lane, c.s, c.mergeAt);
        // (every check: drivers always notice something stopped ahead or a wide-open lane beside them;
        //  spontaneous moves and overtakes wait for their cooldown)
        this.decide(c, P, urgent || c.cool <= 0);
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
          } else ok = c.blocked ? this.safeIn(c, c.pending, 6, 3) : this.safeIn(c, c.pending, 3, 2.5);   // (stuck: pulls out if the car behind can brake for it)
          if (ok && (c.v > 3 || c.forced || c.blocked)) this.startChange(c, c.pending);
          // (a stuck car keeps signalling for longer, while someone makes room for it)
          else if (!c.forced && (c.indWait += dt) > (c.blocked ? 14 : 6)) { c.cool = c.blocked ? U.rand(0.5, 2) : U.rand(8, 20); c.ind = 0; c.blocked = false; c.around = false; }
        }
      }

      // ---- lateral motion: S-curve toward the target lane; sideways speed is capped by forward
      //      speed (heading never more than ~6 deg), so a slow car noses over gently instead of pivoting
      const pd = c.d;
      if (c.changing) {
        // abort early if the player suddenly appears beside us in the target lane
        const progress = Math.abs(c.d - c.chg0) / ROAD.LW;
        const beside = Q => Math.abs(Q.d - ROAD.lane(c.tgt)) < 2.3 && Q.s + Q.front > c.s + c.rear - 3 && Q.s + Q.rear < c.s + c.front + 3;
        // (...or a car from the other side started moving into the same lane alongside: the later one backs off)
        const far = this.lanes[2 * c.tgt - c.lane];
        const rival = far && far.some(o => o !== c && o.tgt === c.tgt && o.lane !== c.tgt && Math.abs(o.s - c.s) < 12 &&
          Math.abs(o.d - o.chg0) / ROAD.LW >= progress);
        if (progress < 0.4 && !c.forced && (beside(P) || (others && others.some(beside)) || rival)) {
          c.tgt = c.lane; c.ind = 0; c.cool = U.rand(3, 6); c.around = false;
        }
      }
      const err = ROAD.lane(c.tgt) - c.d;
      // (a car pulling out of a queue turns the wheel hard and noses out at walking pace, like a real driver)
      const cap = Math.min(c.latMax, (c.blocked || c.forced) && c.v < 5 ? 0.5 * c.v + 0.5 : 0.1 * c.v + 0.04);
      // S-curve: ease in, cross at a steady rate, then ease out so it arrives exactly in the lane centre
      // (a lane change takes ~3-4 s; it used to creep the last metre for seconds)
      const aLat = c.type.truck ? 0.8 : 1.2;
      const want = Math.sign(err) * Math.min(cap, Math.sqrt(2 * aLat * Math.abs(err)));
      c.latV += U.clamp(want - c.latV, -aLat * dt, aLat * dt);
      c.d += c.latV * dt;
      if (c.changing && Math.abs(err) < 0.05 && Math.abs(c.latV) < 0.2) {
        c.d = ROAD.lane(c.tgt); c.latV = 0; c.lane = c.tgt; c.ind = 0; c.forced = false; c.blocked = false;
        // (just went round something: soon ready to move back into the empty lane in front of it)
        c.cool = c.around ? U.rand(0.5, 2.5) : U.rand(9, 27) * (this.inPostZone(c.s) ? 2 : 1);
        c.around = false;
      } else if (!c.changing && Math.abs(err) < 0.02 && Math.abs(c.latV) < 0.05) { c.d = ROAD.lane(c.lane); c.latV = 0; }
      const latRate = (c.d - pd) / Math.max(dt, 1e-4);
      c.relYaw = U.damp(c.relYaw, Math.atan2(latRate, Math.max(c.v, 2)), 8, dt);

      // ---- visuals
      const p = ROAD.pos(c.s, c.d);
      c.x = p.x; c.z = p.z; c.yaw = ROAD.yaw(c.s) + c.relYaw;
      const vis = c.vis;
      vis.root.visible = Math.abs(c.s - P.s) < DRAW_DIST;   // (far cars are specks in the haze: not drawn)
      if (!vis.root.visible) continue;
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

  // the wrecks this player is simulating (cars they hit), sent with their position so friends can draw them
  // on the same clock as their car: [id, s, d, ry, along-road speed, sideways speed, spin] (speeds in m/s, rad/s)
  localWrecks() {
    const out = [];
    for (const c of this.cars) {
      if (!c.local || !c.crashed || out.length >= 6) continue;
      const ry = ROAD.yaw(c.s), b = c.body;
      let vs = c.v || 0, vd = 0, w = 0;
      if (b && !c.rec) { vs = b.vx * Math.sin(ry) - b.vz * Math.cos(ry); vd = b.vx * Math.cos(ry) + b.vz * Math.sin(ry); w = b.w; }
      out.push([c.id, +c.s.toFixed(2), +c.d.toFixed(3), +U.wrap(c.yaw - ry).toFixed(3), +vs.toFixed(2), +vd.toFixed(2), +w.toFixed(3)]);
    }
    return out.length ? out : undefined;
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
