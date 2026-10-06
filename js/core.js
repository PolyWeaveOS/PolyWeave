'use strict';
THREE.ColorManagement.legacyMode = false; // treat hex colours as sRGB (must run before any material is created)
// ---------- Shared helpers ----------
const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  damp: (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt)),
  smooth(e0, e1, x) { x = U.clamp((x - e0) / (e1 - e0), 0, 1); return x * x * (3 - 2 * x); },
  rand: (a, b) => a + Math.random() * (b - a),
  wrap(a) {
    if (!Number.isFinite(a)) return 0;                       // (never loop forever on a bad value)
    if (a > 50 || a < -50) a %= 2 * Math.PI;
    while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a;
  },
  dampAngle(a, b, k, dt) { return a + U.wrap(b - a) * (1 - Math.exp(-k * dt)); },
  weighted(list) { // [{w,...}]
    let t = 0; for (const o of list) t += o.w;
    let r = Math.random() * t;
    for (const o of list) { r -= o.w; if (r <= 0) return o; }
    return list[list.length - 1];
  },
  rng(seed) { // xorshift32, deterministic per chunk
    let s = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  },
  fmt: n => Math.round(n).toLocaleString('en-US'),
  kmh: ms => ms * 3.6,
};

// ---------- Road ----------
// Travel direction is "s" (metres along the road). World z = -(s - origin), so driving forward looks down -z.
// d is the lateral offset from the road centre line, positive to the driver's right (+x).
const ROAD = {
  LANES: 4,
  LW: 3.7,         // lane width
  SH_L: 1.4,       // left shoulder
  SH_R: 3.0,       // right shoulder
  origin: 0,
  cx(s) { return 80 * Math.sin(s / 1100) + 45 * Math.sin(s / 310 + 1.3) + 10 * Math.sin(s / 170 + 0.4); },
  dcx(s) { return 80 / 1100 * Math.cos(s / 1100) + 45 / 310 * Math.cos(s / 310 + 1.3) + 10 / 170 * Math.cos(s / 170 + 0.4); },
  ddcx(s) { return -80 / 1210000 * Math.sin(s / 1100) - 45 / 96100 * Math.sin(s / 310 + 1.3) - 10 / 28900 * Math.sin(s / 170 + 0.4); },
  yaw(s) { return this.loop ? this.loopYaw(s) : Math.atan(this.dcx(s)); },
  kappa(s) {
    if (this.loop) return this.loopSample(this.loop.K, s);
    const c = this.dcx(s); return this.ddcx(s) / Math.pow(1 + c * c, 1.5);
  },
  lane(i) { return (i - 1.5) * this.LW; },
  get edgeL() { return -2 * this.LW - this.SH_L; },
  get edgeR() { return 2 * this.LW + this.SH_R; },
  pos(s, d, out) {
    out = out || {};
    if (this.loop) {
      const th = this.loopYaw(s), X = this.loop.X, Z = this.loop.Z;
      const f = this.wrapS(s) / this.loop.STEP, i = Math.floor(f) % this.loop.N, t = f - Math.floor(f), j = (i + 1) % this.loop.N;
      out.x = X[i] + (X[j] - X[i]) * t + d * Math.cos(th);
      out.z = Z[i] + (Z[j] - Z[i]) * t + d * Math.sin(th);
      return out;
    }
    const c = this.dcx(s), n = Math.sqrt(1 + c * c);
    out.x = this.cx(s) + d / n;
    out.z = -(s - this.origin) + d * c / n;
    return out;
  },
  // hint: a road position near the answer; on the loop circuit s keeps counting up lap after lap,
  // so the result is the copy of s closest to the hint (defaults to the player's position)
  project(x, z, out, hint) {
    if (this.loop) return this.loopProject(x, z, out, hint ?? this.hintS);
    let s = this.origin - z, d = 0;
    for (let i = 0; i < 3; i++) {
      const c = this.dcx(s), n = Math.sqrt(1 + c * c);
      const dx = x - this.cx(s), dz = z + (s - this.origin);
      s += (dx * c - dz) / (n * n);
      if (i === 2) d = (dx + dz * c) / n;
    }
    const c = this.dcx(s), n = Math.sqrt(1 + c * c);
    d = ((x - this.cx(s)) + (z + (s - this.origin)) * c) / n;
    out = out || {}; out.s = s; out.d = d; return out;
  },
  nearestLane(d) { return U.clamp(Math.round(d / this.LW + 1.5), 0, this.LANES - 1); },
};

// ---------- Loop circuit (online servers) ----------
// A closed 25.2 km highway that drives like the endless single-player road: the same kind of gentle
// wiggles (lateral offset 80 / 32 / 10 m; the middle one a bit softer so it doesn't stack with the
// circle into long bends), laid along a huge circle so the overall right turn (4 km radius) is
// spread too thin to notice. Tightest bend ~1 km radius, longest noticeable bend ~600 m. Road positions s keep counting up lap after lap; the
// shape repeats every LOOP.L metres. Built the same way in the browser and on the server, so both
// agree exactly. The parking lot / on-ramp sits on the right (infield) side around s = 0.
const LOOP = {
  L: 25200, STEP: 2,
  // lateral wiggles: [amplitude m, cycles per lap, phase] - close to the endless road's 1100 / 310 / 170 m periods
  WIG: [[80, 4, 0], [32, 13, 1.3], [10, 24, 0.4]],
  // start area layout in road coordinates (s relative to the loop start, d = metres right of the edge):
  // highway -> deceleration lane -> off-ramp (entrance) -> concrete pad -> on-ramp (exit) -> acceleration lane -> highway
  OFF0: -600, DEC1: -440, OFF_RAIL1: -380,                        // decel taper starts / off-ramp leaves the shoulder / rail closes again
  LOT_S0: -250, LOT_S1: -170, LOT_D0: 10, LOT_D1: 50,           // the concrete pad
  RAIL_OPEN0: -60, RAIL_OPEN1: 170,                               // the right guard rail is open here (on-ramp merge)
  ACC0: 0, ACC1: 120,                                              // acceleration lane (the shoulder) before the taper
  SPAWN_ROWS: [-198, -216], SPAWN_COLS: 6, SPAWN_D0: 16, SPAWN_DD: 5,   // 12 starting spots on the pad, noses toward the exit
};
Object.assign(ROAD, {
  loop: null, hintS: 0,
  wrapS(s) { const L = this.loop.L; return ((s % L) + L) % L; },
  // copy of s nearest to ref (for comparing positions across laps)
  near(s, ref) { if (!this.loop) return s; const L = this.loop.L; return s + L * Math.round((ref - s) / L); },
  loopSample(A, s) {
    const f = this.wrapS(s) / this.loop.STEP, i = Math.floor(f) % this.loop.N, t = f - Math.floor(f);
    return A[i] + (A[(i + 1) % this.loop.N] - A[i]) * t;
  },
  loopYaw(s) {
    const lp = this.loop, f = this.wrapS(s) / lp.STEP, i = Math.floor(f) % lp.N, t = f - Math.floor(f), j = (i + 1) % lp.N;
    const b = lp.TH[j] + (j === 0 ? 2 * Math.PI : 0);
    return lp.TH[i] + (b - lp.TH[i]) * t;
  },
  setLoop(on) {
    if (on && !this._loopData) this._loopData = this.makeLoop();
    this.loop = on ? this._loopData : null;
    this.origin = 0;
  },
  makeLoop() {
    const D = LOOP, L = D.L, STEP = D.STEP, M = 4 * L / STEP;
    // a circle (driven clockwise = gently turning right) with the endless road's wiggles as a sideways
    // offset, then resampled at exactly STEP metres over exactly L
    const R0 = L / (2 * Math.PI), xs = new Float64Array(M + 1), zs = new Float64Array(M + 1);
    for (let i = 0; i <= M; i++) {
      const u = i / M, a = 2 * Math.PI * u;
      let w = 0; for (const [amp, n, ph] of D.WIG) w += amp * Math.sin(2 * Math.PI * n * u + ph);
      const r = R0 - w;                                  // (+w = to the right of travel = toward the centre)
      xs[i] = -Math.cos(a) * r; zs[i] = -Math.sin(a) * r;
    }
    const cum = new Float64Array(M + 1);
    for (let i = 1; i <= M; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    const k = L / cum[M], N = L / STEP, X0 = new Float64Array(N), Z0 = new Float64Array(N);
    for (let i = 0, j = 0; i < N; i++) {
      const target = i * STEP / k;
      while (cum[j + 1] < target) j++;
      const f = (target - cum[j]) / (cum[j + 1] - cum[j]);
      X0[i] = (xs[j] + (xs[j + 1] - xs[j]) * f) * k; Z0[i] = (zs[j] + (zs[j + 1] - zs[j]) * f) * k;
    }
    // heading + smoothed curvature
    const T0 = new Float64Array(N), K0 = new Float64Array(N);
    for (let i = 0; i < N; i++) { const a = (i + N - 1) % N, b = (i + 1) % N; T0[i] = Math.atan2(X0[b] - X0[a], -(Z0[b] - Z0[a])); }
    const raw = new Float64Array(N);
    for (let i = 0; i < N; i++) raw[i] = U.wrap(T0[(i + 1) % N] - T0[i]) / STEP;
    for (let i = 0; i < N; i++) { let s = 0; for (let j = -10; j <= 10; j++) s += raw[(i + j + N) % N]; K0[i] = s / 21; }
    // start the lap (s = 0) on the straightest stretch, where the lot and on-ramp go
    let best = 0, bestK = Infinity;
    for (let i = 0; i < N; i += 10) {
      let m = 0;
      for (let j = -450 / STEP; j <= 350 / STEP; j += 5) m = Math.max(m, Math.abs(K0[(i + j + N) % N]));
      if (m < bestK) { bestK = m; best = i; }
    }
    const X = new Float64Array(N), Z = new Float64Array(N), TH = new Float64Array(N), K = new Float64Array(N);
    for (let i = 0; i < N; i++) { const o = (i + best) % N; X[i] = X0[o]; Z[i] = Z0[o]; K[i] = K0[o]; TH[i] = T0[o]; }
    for (let i = 1; i < N; i++) TH[i] = TH[i - 1] + U.wrap(TH[i] - TH[i - 1]);   // unwrap: +2 pi over the lap
    // spatial grid of samples for fast "where on the road am I" lookups
    const CELL = 50, grid = new Map();
    for (let i = 0; i < N; i++) {
      const key = Math.floor(X[i] / CELL) * 100003 + Math.floor(Z[i] / CELL);
      let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push(i);
    }
    return { L, STEP, N, X, Z, TH, K, grid, CELL };
  },
  loopProject(x, z, out, hint) {
    const lp = this.loop, C = lp.CELL, cx = Math.floor(x / C), cz = Math.floor(z / C);
    let bi = -1, bd = Infinity;
    for (let r = 1; r <= 12 && bi < 0; r += r < 3 ? 1 : 3) {
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
        const cell = lp.grid.get((cx + a) * 100003 + cz + b); if (!cell) continue;
        for (const i of cell) { const dx = lp.X[i] - x, dz = lp.Z[i] - z, d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; bi = i; } }
      }
    }
    if (bi < 0) bi = 0;
    // refine on the two segments around the nearest sample
    let bu = bi * lp.STEP, bdd = Infinity;
    for (const i of [(bi + lp.N - 1) % lp.N, bi]) {
      const j = (i + 1) % lp.N, ux = lp.X[j] - lp.X[i], uz = lp.Z[j] - lp.Z[i];
      const t = U.clamp(((x - lp.X[i]) * ux + (z - lp.Z[i]) * uz) / (ux * ux + uz * uz), 0, 1);
      const px = lp.X[i] + ux * t - x, pz = lp.Z[i] + uz * t - z, d2 = px * px + pz * pz;
      if (d2 < bdd) { bdd = d2; bu = (i + t) * lp.STEP; }
    }
    const th = this.loopYaw(bu), c = this.pos(bu, 0);
    out = out || {};
    out.d = (x - c.x) * Math.cos(th) + (z - c.z) * Math.sin(th);
    out.s = this.near(bu, Number.isFinite(hint) ? hint : bu);
    return out;
  },
  // ---- the start area (loop only): parking lot -> on-ramp -> acceleration lane -> highway ----
  // s offset from the nearest lap start (negative = before it)
  lotS(s) { if (!this.loop) return 1e9; const L = this.loop.L, w = this.wrapS(s); return w > L / 2 ? w - L : w; },
  // the acceleration / deceleration lane: one full lane width beside the right lane (centre d)
  auxD() { return this.lane(3) + this.LW; },
  // centre line of the on-ramp (d), from the pad's front edge into the acceleration lane
  rampD(ls) {
    const eR = this.edgeR, t = U.smooth(LOOP.LOT_S1, LOOP.ACC0, ls);
    return eR + 18 + (this.auxD() - (eR + 18)) * t;
  },
  // half-width of the on-ramp: wide where it leaves the pad, exactly one lane where it joins
  rampHW(ls) { return this.LW / 2 + 1.75 * (1 - U.smooth(LOOP.LOT_S1, LOOP.ACC0, ls)); },
  // centre line + half-width of the off-ramp, from the deceleration lane to the pad's back edge
  offD(ls) {
    const eR = this.edgeR, t = U.smooth(LOOP.DEC1, LOOP.LOT_S0, ls);
    return this.auxD() + (eR + 18 - this.auxD()) * t;
  },
  offHW(ls) { return this.LW / 2 + 1.75 * U.smooth(LOOP.DEC1, LOOP.LOT_S0, ls); },
  // outer edge (d) of the paved acceleration / deceleration lane at s, or null where there is none
  auxOuter(s) {
    const ls = this.lotS(s), D = LOOP, e = 2 * this.LW, full = e + this.LW;
    if (ls >= D.OFF0 && ls < D.OFF0 + 60) return U.lerp(e, full, (ls - D.OFF0) / 60);
    if (ls >= D.OFF0 + 60 && ls < D.DEC1) return full;       // (the off-ramp takes over exactly where it leaves...
    if (ls >= D.ACC0 && ls < D.ACC1) return full;            //  ...and the on-ramp hands over exactly where it joins)
    if (ls >= D.ACC1 && ls < D.RAIL_OPEN1) return U.lerp(full, e, (ls - D.ACC1) / (D.RAIL_OPEN1 - D.ACC1));
    return null;
  },
  // outer boundary (fence line) of the start area at s, or null where there is none
  lotOuter(s) {
    const ls = this.lotS(s), eR = this.edgeR, D = LOOP;
    if (ls < D.OFF0 || ls > D.RAIL_OPEN1) return null;
    if (ls <= D.OFF0 + 40) return U.lerp(eR + 0.35, eR + 1.6, (ls - D.OFF0) / 40);          // deceleration lane taper
    if (ls <= D.DEC1) return eR + 1.6;
    if (ls <= D.LOT_S0 - 12) return Math.max(this.offD(ls) + this.offHW(ls) + 0.9, eR + 1.6);   // off-ramp
    if (ls <= D.LOT_S0) { const a = D.LOT_S0 - 12; return U.lerp(this.offD(a) + this.offHW(a) + 0.9, eR + D.LOT_D1 + 1, (ls - a) / 12); }
    if (ls <= D.LOT_S1) return eR + D.LOT_D1 + 1;
    const rOut = x => this.rampD(x) + this.rampHW(x) + 0.9;
    if (ls <= LOOP.LOT_S1 + 12) return U.lerp(eR + LOOP.LOT_D1 + 1, rOut(LOOP.LOT_S1 + 12), (ls - LOOP.LOT_S1) / 12);   // on-ramp
    if (ls <= LOOP.ACC1) return Math.max(rOut(ls), eR + 1.6);
    return U.lerp(eR + 1.6, eR + 0.35, (ls - LOOP.ACC1) / (LOOP.RAIL_OPEN1 - LOOP.ACC1));
  },
  railOpen(side, s) {
    if (!this.loop || side < 0) return false;
    const ls = this.lotS(s);
    return (ls > LOOP.OFF0 && ls < LOOP.OFF_RAIL1) || (ls > LOOP.RAIL_OPEN0 && ls < LOOP.RAIL_OPEN1);
  },
  // inside the lot / ramp area (pad: extra margin)?
  inLot(s, d, pad = 0) {
    const o = this.lotOuter(s); if (o === null) return false;
    return d > this.edgeR - 0.2 - pad && d < o + pad;
  },
  // starting spot i on the pad (0 = front row, nearest the exit)
  lotSpace(i) {
    const D = LOOP, row = Math.floor(i / D.SPAWN_COLS) % D.SPAWN_ROWS.length, col = i % D.SPAWN_COLS;
    return { s: D.SPAWN_ROWS[row], d: this.edgeR + D.SPAWN_D0 + D.SPAWN_DD * col };
  },
  // is (x, z) clear of every OTHER part of the loop by at least r metres? (scenery placement)
  clearOfLoop(x, z, r, sOwn) {
    if (!this.loop) return true;
    const lp = this.loop, C = lp.CELL, R = Math.ceil((r + 20) / C), cx = Math.floor(x / C), cz = Math.floor(z / C), own = this.wrapS(sOwn);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      const cell = lp.grid.get((cx + a) * 100003 + cz + b); if (!cell) continue;
      for (const i of cell) {
        let ds = Math.abs(i * lp.STEP - own); ds = Math.min(ds, lp.L - ds);
        if (ds < 2500) continue;
        if (Math.hypot(lp.X[i] - x, lp.Z[i] - z) < r + 20) return false;
      }
    }
    return true;
  },
});

// ---------- 2D convex hull collision (top-down, x/z plane) ----------
const SAT = {
  // local hull points are [right, forward]; returns world [x,z] list
  toWorld(hull, x, z, yaw, out) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    for (let i = 0; i < hull.length; i++) {
      const lx = hull[i][0], lf = hull[i][1];
      const o = out[i] || (out[i] = [0, 0]);
      o[0] = x + lf * s + lx * c;
      o[1] = z - lf * c + lx * s;
    }
    out.length = hull.length;
    return out;
  },
  test(A, B) {
    let best = Infinity, nx = 0, nz = 0;
    for (const P of [A, B]) {
      for (let i = 0; i < P.length; i++) {
        const p = P[i], q = P[(i + 1) % P.length];
        let ax = -(q[1] - p[1]), az = q[0] - p[0];
        const l = Math.hypot(ax, az); ax /= l; az /= l;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (const v of A) { const d = v[0] * ax + v[1] * az; if (d < a0) a0 = d; if (d > a1) a1 = d; }
        for (const v of B) { const d = v[0] * ax + v[1] * az; if (d < b0) b0 = d; if (d > b1) b1 = d; }
        const o = Math.min(a1 - b0, b1 - a0);
        if (o <= 0) return null;
        if (o < best) { best = o; nx = ax; nz = az; }
      }
    }
    // orient normal from A to B
    let ca = [0, 0], cb = [0, 0];
    for (const v of A) { ca[0] += v[0]; ca[1] += v[1]; }
    for (const v of B) { cb[0] += v[0]; cb[1] += v[1]; }
    ca[0] /= A.length; ca[1] /= A.length; cb[0] /= B.length; cb[1] /= B.length;
    if ((cb[0] - ca[0]) * nx + (cb[1] - ca[1]) * nz < 0) { nx = -nx; nz = -nz; }
    // contact point: midpoint of deepest vertices
    let pa = null, pb = null, ma = -Infinity, mb = Infinity;
    for (const v of A) { const d = v[0] * nx + v[1] * nz; if (d > ma) { ma = d; pa = v; } }
    for (const v of B) { const d = v[0] * nx + v[1] * nz; if (d < mb) { mb = d; pb = v; } }
    return { depth: best, nx, nz, px: (pa[0] + pb[0]) / 2, pz: (pa[1] + pb[1]) / 2 };
  },
  // chamfered rectangle hull: half width w, front f, rear r (negative), chamfer c
  hull(w, f, r, cf, cr) {
    cr = cr ?? cf;
    return [[w - cf, f], [w, f - cf], [w, r + cr], [w - cr, r], [-w + cr, r], [-w, r + cr], [-w, f - cf], [-w + cf, f]];
  },
};

// Rigid-body impulse between two bodies {x,z,vx,vz,w,im,ii}. n points from A to B.
function resolveImpulse(A, B, col, e = 0.18, mu = 0.35) {
  const rax = col.px - A.x, raz = col.pz - A.z, rbx = col.px - B.x, rbz = col.pz - B.z;
  const vax = A.vx - A.w * raz, vaz = A.vz + A.w * rax;
  const vbx = B.vx - B.w * rbz, vbz = B.vz + B.w * rbx;
  const rvx = vbx - vax, rvz = vbz - vaz;
  const vn = rvx * col.nx + rvz * col.nz;
  const cr = (rx, rz, nx, nz) => rx * nz - rz * nx;
  // positional correction
  const tot = A.im + B.im;
  if (tot > 0) {
    const corr = Math.max(col.depth - 0.005, 0) / tot;
    A.x -= col.nx * corr * A.im; A.z -= col.nz * corr * A.im;
    B.x += col.nx * corr * B.im; B.z += col.nz * corr * B.im;
  }
  if (vn >= 0) return 0;
  const ran = cr(rax, raz, col.nx, col.nz), rbn = cr(rbx, rbz, col.nx, col.nz);
  const k = A.im + B.im + ran * ran * A.ii + rbn * rbn * B.ii;
  const j = -(1 + e) * vn / k;
  const apply = (jx, jz) => {
    A.vx -= jx * A.im; A.vz -= jz * A.im; A.w -= cr(rax, raz, jx, jz) * A.ii;
    B.vx += jx * B.im; B.vz += jz * B.im; B.w += cr(rbx, rbz, jx, jz) * B.ii;
  };
  apply(j * col.nx, j * col.nz);
  // friction
  let tx = rvx - vn * col.nx, tz = rvz - vn * col.nz;
  const tl = Math.hypot(tx, tz);
  if (tl > 1e-4) {
    tx /= tl; tz /= tl;
    const rat = cr(rax, raz, tx, tz), rbt = cr(rbx, rbz, tx, tz);
    const kt = A.im + B.im + rat * rat * A.ii + rbt * rbt * B.ii;
    const jt = U.clamp(-tl / kt, -mu * j, mu * j);
    apply(jt * tx, jt * tz);
  }
  return -vn;
}
