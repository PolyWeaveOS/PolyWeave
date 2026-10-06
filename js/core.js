'use strict';
THREE.ColorManagement.legacyMode = false; // treat hex colours as sRGB (must run before any material is created)
// ---------- Shared helpers ----------
const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  damp: (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt)),
  smooth(e0, e1, x) { x = U.clamp((x - e0) / (e1 - e0), 0, 1); return x * x * (3 - 2 * x); },
  rand: (a, b) => a + Math.random() * (b - a),
  wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; },
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
  yaw(s) { return Math.atan(this.dcx(s)); },
  kappa(s) { const c = this.dcx(s); return this.ddcx(s) / Math.pow(1 + c * c, 1.5); },
  lane(i) { return (i - 1.5) * this.LW; },
  get edgeL() { return -2 * this.LW - this.SH_L; },
  get edgeR() { return 2 * this.LW + this.SH_R; },
  pos(s, d, out) {
    const c = this.dcx(s), n = Math.sqrt(1 + c * c);
    out = out || {};
    out.x = this.cx(s) + d / n;
    out.z = -(s - this.origin) + d * c / n;
    return out;
  },
  project(x, z, out) {
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
