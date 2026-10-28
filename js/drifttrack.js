'use strict';
// =====================================================================
//  Drift track (Play > Drift track - the owners only for now): free driving on a drift course (js/tracks.js
//  DRIFT_TRACKS) in your own car, no traffic, no timing, no score. Built like a Japanese mountain drift circuit:
//  a narrow-feeling ribbon of asphalt with red / white kerbs in the bends, a strip of grass, tyre walls backed by
//  steel barriers, then forest - pines and broadleaf trees right up to the barriers, bushes and rocks, and green
//  mountains all round. No grandstands.
// =====================================================================
const DT_COL = {
  asphalt: COL(0x45494f), line: COL(0xf2f2ee), kerbR: COL(0xd42a2a), kerbW: COL(0xf4f2ee), grass: COL(0x5f9a45), grass2: COL(0x67a24b),
  tyre: COL(0x1d1e22), tyre2: COL(0x2b2c31), tyreBand: COL(0xf2f2ee), rail: COL(0xbfc6cd), post: COL(0x80878f),
  checkB: COL(0x18191c), checkW: COL(0xf5f5f2), gantry: COL(0x5d636b), banner: COL(0xd42a2a),
  pine: [COL(0x2c6e45), COL(0x255f3c), COL(0x34784b)], leaf: [COL(0x4f9a3c), COL(0x5ea544), COL(0x3f8a45), COL(0x86b43f)],
  trunk: COL(0x6e4b30), bush: COL(0x3f8a45), rock: [COL(0x8d949b), COL(0x9aa0a6), COL(0x7f868d)],
  mtn: [COL(0x4f8a3d), COL(0x5a9446), COL(0x467f37)], mtnFar: COL(0x6b8aa0),
};

const DriftTrack = {
  active: false, group: null, id: null,
  available: () => typeof canBike === 'function' && canBike(),

  enter(id = 'minami') {
    if (!this.available() || !Tracks.DRIFT_BY_ID[id]) return;
    if (Net.active()) { quitting = true; Net.leave(); quitting = false; }
    Race.exit();
    score.reset();
    game.mode = 'drift'; game.scored = false; game.density = 0;
    this.id = id; this.active = true;
    ROAD.setTrack(id); ZONES.setLoop(0);
    world.raceOn = true; world.reset(); zoneProps.reset();
    setWorld('grass', Settings.tod || 'day'); world.ground.material.color.set(0x5c8f40);
    traffic.clear(); traffic.remote = false;
    this.build();
    this.place(0, 0);
    closeMenu();
    hud.message(Tracks.DRIFT_BY_ID[id].name.toUpperCase());
  },
  exit() {
    if (!this.active) return;
    this.active = false; this.id = null;
    this.clear();
    world.raceOn = false;
    world.ground.material.color.set(world.th.ground);
    ROAD.setTrack(null);
  },
  place(s, d, speed = 0) {
    car.place(s, d, speed); car.tc = Settings.tc; car.manual = Settings.manual; car.hitT = 0;
    car.s = s; car.d = d; ROAD.hintS = s;
    steerCtl.key = 0; steerCtl.k1 = 0; steerCtl.wheelF = 0; steerCtl.kAl = 0; steerCtl.k1v = 0; steerCtl.kAlv = 0;
    camS.yaw = car.yaw; camS.shift = 0;
    Object.assign(proxy, { s: car.s, d: car.d, v: speed });
    warmUp();
  },
  // R: back onto the track where you are, pointing the right way, stopped
  reset() {
    const p = ROAD.project(car.x, car.z), d = U.clamp(p.d, -ROAD.LW * 1.5, ROAD.LW * 1.5);
    this.place(p.s, d, 0);
  },
  clear() {
    if (!this.group) return;
    scene.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.group = null;
  },

  build() {
    this.clear();
    const lp = ROAD.loop, G = world.G, xf = (...a) => world.xf(...a), rnd = U.rng(lp.N * 17 + 7);
    const asp = 2 * ROAD.LW, kerbW = Tracks.RUNOFF.kerb, STEP = 2, N = Math.round(lp.L / STEP);
    const P = (s, d, y) => { const p = ROAD.pos(s, d); return [p.x, y, p.z]; };
    const wD = (s, sg) => Tracks.wallAt(lp, s, sg);
    const road = new CGB(), sc = new CGB(), far = new CGB();
    const strip = (gb, s, d0, d1, y, col, len = STEP) => gb.quad(P(s, d0, y), P(s + len, d0, y), P(s + len, d1, y), P(s, d1, y), col);
    const band = (gb, s, a0, a1, b0, b1, y, col) => gb.quad(P(s, a0, y), P(s + STEP, b0, y), P(s + STEP, b1, y), P(s, a1, y), col);

    // ---- surface: asphalt, edge lines, kerbs in the bends, grass out to the tyre walls ----
    for (let i = 0; i < N; i++) {
      const s = i * STEP, k = Math.abs(ROAD.kappa(s + 1)), corner = k > 1 / 90;
      strip(road, s, -asp - 0.05, asp + 0.05, 0.03, DT_COL.asphalt);
      for (const sg of [-1, 1]) {
        const a = sg * (asp - 0.3), b = sg * (asp - 0.12);
        strip(road, s, Math.min(a, b), Math.max(a, b), 0.045, DT_COL.line);
        const k0 = sg * asp, k1 = sg * (asp + kerbW);
        if (corner) for (const h of [0, 1]) strip(road, s + h, Math.min(k0, k1), Math.max(k0, k1), 0.06, h ? DT_COL.kerbW : DT_COL.kerbR, 1);
        else strip(road, s, Math.min(k0, k1), Math.max(k0, k1), 0.032, DT_COL.asphalt);
        // grass from the kerb to the wall (two close tones, in patches)
        const w0 = wD(s, sg), w1 = wD(s + STEP, sg), gcol = (Math.floor(s / 6) + (sg > 0 ? 1 : 0)) % 2 ? DT_COL.grass : DT_COL.grass2;
        if (sg > 0) band(road, s, asp + kerbW, w0 + 6, asp + kerbW, w1 + 6, 0.025, gcol); else band(road, s, -w0 - 6, -asp - kerbW, -w1 - 6, -asp - kerbW, 0.025, gcol);
        // the barrier: a wall of stacked tyres (white band on top), a steel rail on posts just behind it
        const A = (d0, d1, y0, y1, col) => sc.quad(P(s, sg * d0, y0), P(s + STEP, sg * d1, y0), P(s + STEP, sg * d1, y1), P(s, sg * d0, y1), col);
        const tc = (i % 2) ? DT_COL.tyre : DT_COL.tyre2;
        A(w0, w1, 0, 0.62, tc); A(w0, w1, 0.62, 0.78, DT_COL.tyreBand);
        sc.quad(P(s, sg * w0, 0.78), P(s + STEP, sg * w1, 0.78), P(s + STEP, sg * (w1 + 0.7), 0.78), P(s, sg * (w0 + 0.7), 0.78), DT_COL.tyre);
        A(w0 + 0.7, w1 + 0.7, 0, 0.78, tc);
        A(w0 + 0.95, w1 + 0.95, 0.45, 0.8, DT_COL.rail);
        if (i % 2 === 0) { const q = P(s, sg * (w0 + 1.05), 0); sc.geom(G.box, xf(q[0], 0.4, q[2], 0, -ROAD.yaw(s), 0.12, 0.8, 0.12), DT_COL.post); }
      }
    }
    // ---- start / finish: chequered line and a simple gantry with a red banner ----
    for (let c = 0; c < 12; c++) for (let r = 0; r < 2; r++) {
      const d0 = -asp + c * (2 * asp / 12), d1 = d0 + 2 * asp / 12, s0 = -1 + r;
      road.quad(P(s0, d0, 0.05), P(s0 + 1, d0, 0.05), P(s0 + 1, d1, 0.05), P(s0, d1, 0.05), (c + r) % 2 ? DT_COL.checkB : DT_COL.checkW);
    }
    {
      const sG = 0, yaw = -ROAD.yaw(sG), gL = wD(sG, -1) + 1.4, gR = wD(sG, 1) + 1.4;
      for (const d of [-gL, gR]) { const q = P(sG, d, 0); sc.geom(G.box, xf(q[0], 3.4, q[2], 0, yaw, 0.5, 6.8, 0.5), DT_COL.gantry); }
      const c = P(sG, (gR - gL) / 2, 0);
      sc.geom(G.box, xf(c[0], 6.4, c[2], 0, yaw, gL + gR + 0.6, 0.5, 0.5), DT_COL.gantry);
      sc.geom(G.box, xf(c[0], 5.6, c[2], 0, yaw, gL + gR - 1, 1.2, 0.12), DT_COL.banner);
    }

    // ---- forest: trees right up to the barriers, thinning out further away; bushes and rocks ----
    // (a point is free if it's a couple of metres outside the barrier of every nearby bit of track)
    const offTrack = (x, z, gap) => {
      const cx = Math.floor(x / lp.CELL), cz = Math.floor(z / lp.CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const cell = lp.grid.get((cx + a) * 100003 + cz + b); if (!cell) continue;
        for (const j of cell) {
          const dd = Math.hypot(x - lp.X[j], z - lp.Z[j]);
          if (dd < Math.max(lp.WL[j], lp.WR[j]) + 1.2 + gap) return false;
        }
      }
      return true;
    };
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < lp.N; i++) { minX = Math.min(minX, lp.X[i]); maxX = Math.max(maxX, lp.X[i]); minZ = Math.min(minZ, lp.Z[i]); maxZ = Math.max(maxZ, lp.Z[i]); }
    const pad = 160, cx0 = (minX + maxX) / 2, cz0 = (minZ + maxZ) / 2;
    // distance to the nearest bit of track (coarse, for density)
    const nearDist = (x, z) => {
      let best = 1e9; const cx = Math.floor(x / lp.CELL), cz = Math.floor(z / lp.CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const cell = lp.grid.get((cx + a) * 100003 + cz + b); if (!cell) continue; for (let n = 0; n < cell.length; n += 4) { const j = cell[n]; const dx = x - lp.X[j], dz = z - lp.Z[j], dd = dx * dx + dz * dz; if (dd < best) best = dd; } }
      return Math.sqrt(best);   // (anything past ~75 m counts as far out)
    };
    const tree = (gb, x, z, sz) => {
      const kind = rnd();
      if (kind < 0.62) {                                  // tall mountain pine / cedar: three tiers
        const col = DT_COL.pine[Math.floor(rnd() * 3)];
        gb.geom(G.cyl5, xf(x, 1.3 * sz, z, 0, 0, 0.26 * sz, 2.6 * sz, 0.26 * sz), DT_COL.trunk, rnd);
        gb.geom(G.cone6, xf(x, 3.6 * sz, z, 0, rnd() * 3, 2.4 * sz, 4.4 * sz, 2.4 * sz), col, rnd, 0.1);
        gb.geom(G.cone6, xf(x, 5.8 * sz, z, 0, rnd() * 3, 1.8 * sz, 3.6 * sz, 1.8 * sz), col, rnd, 0.1);
        gb.geom(G.cone6, xf(x, 7.7 * sz, z, 0, rnd() * 3, 1.1 * sz, 2.6 * sz, 1.1 * sz), col, rnd, 0.1);
      } else if (kind < 0.9) {                            // broadleaf
        gb.geom(G.cyl5, xf(x, 1.3 * sz, z, 0, 0, 0.28 * sz, 2.6 * sz, 0.28 * sz), DT_COL.trunk, rnd);
        gb.geom(G.ico0, xf(x, 3.8 * sz, z, rnd(), rnd() * 3, 2.6 * sz, 2.3 * sz, 2.6 * sz), DT_COL.leaf[Math.floor(rnd() * 4)], rnd, 0.12);
      } else if (kind < 0.97) {                           // bush
        gb.geom(G.ico0, xf(x, 0.5 * sz, z, rnd(), rnd() * 3, 1.4 * sz, 1.0 * sz, 1.4 * sz), DT_COL.bush, rnd, 0.12);
      } else {                                            // rock
        gb.geom(G.dode, xf(x, 0.25 * sz, z, rnd(), rnd() * 3, 1.4 * sz, 0.9 * sz, 1.2 * sz), DT_COL.rock[Math.floor(rnd() * 3)], rnd, 0.1);
      }
    };
    let placed = 0;
    for (let x = minX - pad; x < maxX + pad; x += 7.5) for (let z = minZ - pad; z < maxZ + pad; z += 7.5) {
      const px = x + (rnd() - 0.5) * 6.5, pz = z + (rnd() - 0.5) * 6.5, dn = nearDist(px, pz);
      if (dn > 70) { if (rnd() > 0.32) continue; } else if (dn > 35) { if (rnd() > 0.7) continue; }   // (thinner further out)
      if (!offTrack(px, pz, 1.5 + rnd() * 2)) continue;
      tree(dn > 70 ? far : sc, px, pz, 0.85 + rnd() * 0.75); placed++;
    }
    // a few boulders and bushes by the barriers
    for (let i = 0; i < 160; i++) {
      const s = rnd() * lp.L, sg = rnd() < 0.5 ? -1 : 1, d = sg * (wD(s, sg) + 2 + rnd() * 5), p = P(s, d, 0);
      if (!offTrack(p[0], p[2], 0.8)) continue;
      const big = rnd() < 0.3, sz = big ? 1.2 + rnd() : 0.5 + rnd() * 0.6;
      if (rnd() < 0.5) sc.geom(G.dode, xf(p[0], sz * 0.3, p[2], rnd(), rnd() * 3, sz * 1.3, sz * 0.8, sz), DT_COL.rock[Math.floor(rnd() * 3)], rnd, 0.1);
      else sc.geom(G.ico0, xf(p[0], sz * 0.45, p[2], rnd(), rnd() * 3, sz * 1.4, sz, sz * 1.4), DT_COL.bush, rnd, 0.12);
    }
    // ---- mountains all round (the forested hills a mountain circuit sits in), then a blue range far off ----
    const rad = Math.hypot(maxX - minX, maxZ - minZ) / 2;
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * Math.PI * 2 + rnd() * 0.2, r = rad + pad + 60 + rnd() * 160, h = 60 + rnd() * 110, w = 120 + rnd() * 130;
      far.geom(G.cone6, xf(cx0 + Math.cos(a) * r, h / 2 - 2, cz0 + Math.sin(a) * r, 0, rnd() * 3, w, h, w * (0.8 + rnd() * 0.4)), DT_COL.mtn[Math.floor(rnd() * 3)], rnd, 0.06);
    }
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2 + rnd() * 0.3, r = rad + pad + 650 + rnd() * 400, h = 160 + rnd() * 200, w = 380 + rnd() * 300;
      far.geom(G.cone6, xf(cx0 + Math.cos(a) * r, h / 2 - 2, cz0 + Math.sin(a) * r, 0, rnd() * 3, w, h, w), DT_COL.mtnFar, rnd, 0.05);
    }

    const grp = new THREE.Group();
    for (const m of RaceWorld.tiles(road, world.roadMat, 250)) { m.receiveShadow = true; grp.add(m); }
    for (const m of RaceWorld.tiles(sc, world.mat, 250)) { m.castShadow = true; m.receiveShadow = true; grp.add(m); }
    for (const m of RaceWorld.tiles(far, world.mat, 900)) { m.receiveShadow = true; grp.add(m); }
    scene.add(grp);
    this.group = grp; this.trees = placed;
    return grp;
  },
};
