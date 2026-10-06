'use strict';
// =====================================================================
//  World: endless curved highway built in chunks + low-poly scenery
// =====================================================================

class CGB { // vertex-coloured, flat-shaded geometry builder
  constructor() { this.p = []; this.c = []; }
  tri(a, b, c, col) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.c.push(col.r, col.g, col.b);
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  geom(g, m, col, rnd, vary = 0.06, colFn) {
    const ng = g.index ? g.toNonIndexed() : g, p = ng.attributes.position, v = new THREE.Vector3();
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i += 3) {
      let cc = col;
      if (colFn) { v.fromBufferAttribute(p, i); cc = colFn(v) || col; }
      const k = 1 + (rnd ? (rnd() - 0.5) * 2 * vary : 0);
      tmp.setRGB(cc.r * k, cc.g * k, cc.b * k);
      for (let j = 0; j < 3; j++) { v.fromBufferAttribute(p, i + j).applyMatrix4(m); this.p.push(v.x, v.y, v.z); this.c.push(tmp.r, tmp.g, tmp.b); }
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
}

const COL = (h) => new THREE.Color(h);
const WC = {
  asphalt: COL(0x474c55), shoulder: COL(0x51565f), line: COL(0xf2f2ee), yline: COL(0xf5c842),
  gravel: COL(0x9b9484), verge: COL(0x7fae55), rail: COL(0xc2c9d0), post: COL(0x878e97),
  trunk: COL(0x7a5536), leafA: COL(0x4f9a3c), leafB: COL(0x3f8a45), pine: COL(0x2f7a4a), leafC: COL(0x86b43f),
  rock: COL(0x9aa0a6), hill: COL(0x78ad4f), hill2: COL(0x6a9e4a), mtn: COL(0x8d98a6), snow: COL(0xf4f7fa),
  pole: COL(0x9aa2ab), sign: COL(0x1f7a46), signW: COL(0xf1f4f2), cloud: COL(0xffffff), concrete: COL(0xb7b6ae),
  orange: COL(0xff6a14), wwhite: COL(0xf6f6f2), black: COL(0x1c1d21), yellow: COL(0xffd41c), jersey: COL(0xd9d6ce),
  jersey2: COL(0xcfcbc1), orangeB: COL(0xff5e0a),
  signO: COL(0xff5a00).multiplyScalar(1.6), // over-bright on purpose: reads as a vivid, saturated work sign
  rock2: COL(0x80868d), rock3: COL(0xaea89c), water: COL(0x3d8fc9), waterDeep: COL(0x2c74ad), sand: COL(0xcdbf8f),
  gmtn: COL(0x5f9a45), gmtn2: COL(0x6fa84c), gmtn3: COL(0x528c3f),

};

class World {
  constructor(scene) {
    this.scene = scene;
    this.CH = 120; this.STEP = 5;
    this.chunks = new Map(); this.dying = new Map();
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    // ground
    const g = new THREE.PlaneGeometry(9000, 9000, 1, 1); g.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x6f9f4a }));
    this.ground.receiveShadow = true; this.ground.position.y = -0.03;
    scene.add(this.ground);
    // shared primitives
    this.G = {
      box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
      cone6: new THREE.ConeGeometry(1, 1, 7, 1).toNonIndexed(),
      ico0: new THREE.IcosahedronGeometry(1, 0).toNonIndexed(),
      ico1: new THREE.IcosahedronGeometry(1, 1).toNonIndexed(),
      dode: new THREE.DodecahedronGeometry(1, 0).toNonIndexed(),
      cyl5: new THREE.CylinderGeometry(1, 1, 1, 5).toNonIndexed(),
    };
    this.clouds = this.makeClouds();
  }

  update(ps, cam) {
    const ci = Math.floor(ps / this.CH);
    let built = 0;
    for (let k = ci - 2; k <= ci + 11; k++) {
      if (!this.chunks.has(k) && built < 2) { this.chunks.set(k, this.build(k)); built++; }
    }
    for (const [k, c] of this.chunks) {
      if (k < ci - 3 || k > ci + 12) {
        // fade the far scenery out first (removed by fadeChunks)
        this.chunks.delete(k); c.userData.t0 = performance.now() / 1000;
        const f = c.userData.far; if (f) { f.material.transparent = true; f.material.needsUpdate = true; }
        this.dying.set(k + '_' + c.id, c); c.userData.k = k;
      } else c.position.z = -(k * this.CH - ROAD.origin);
    }
    for (const c of this.dying.values()) c.position.z = -(c.userData.k * this.CH - ROAD.origin);
    this.ground.position.set(cam.position.x, -0.03, cam.position.z);
    // clouds drift around camera; one that drifts too far is moved and fades back in (no popping)
    for (const c of this.clouds.children) {
      c.position.x += c.userData.v * 0.016;
      const dx = c.position.x - cam.position.x, dz = c.position.z - cam.position.z;
      if (dx * dx + dz * dz > 1500 * 1500) {
        const a = Math.random() * Math.PI * 2, r = 900 + Math.random() * 500;
        c.position.set(cam.position.x + Math.cos(a) * r, c.position.y, cam.position.z + Math.sin(a) * r);
        c.userData.fade = 0; c.material.transparent = true; c.material.needsUpdate = true;
      }
      if (c.userData.fade < 1) {
        c.userData.fade = Math.min(1, c.userData.fade + 0.016 / 4); // ~4 s fade-in
        c.material.opacity = c.userData.fade * c.userData.fade * (3 - 2 * c.userData.fade);
        if (c.userData.fade >= 1) { c.material.transparent = false; c.material.needsUpdate = true; }
      }
    }
    this.fadeChunks();
  }

  // Hills / mountains live in their own mesh per chunk: they fade in when the chunk is built
  // and fade out before it's removed, instead of popping in and out.
  fadeChunks() {
    const now = performance.now() / 1000;
    for (const [k, c] of this.dying) {
      const f = c.userData.far, o = 1 - (now - c.userData.t0) / 1.2;
      if (o <= 0 || !f) { this.scene.remove(c); c.traverse(x => x.geometry && x.geometry.dispose()); if (f) f.material.dispose(); this.dying.delete(k); }
      else f.material.opacity = o;
    }
    for (const c of this.chunks.values()) {
      const f = c.userData.far;
      if (!f || f.userData.done) continue;
      const o = Math.min(1, (now - c.userData.t0) / 2.5);
      f.material.opacity = o * o * (3 - 2 * o);
      if (o >= 1) { f.material.transparent = false; f.material.depthWrite = true; f.material.needsUpdate = true; f.userData.done = true; }
    }
  }

  // (start of a run: everything appears at once, no fade)
  fillAll(ps) { const ci = Math.floor(ps / this.CH); for (let k = ci - 2; k <= ci + 11; k++) if (!this.chunks.has(k)) { const c = this.build(k); c.userData.t0 = -1e9; this.chunks.set(k, c); } }

  build(k) {
    const s0 = k * this.CH, zb = -(s0 - ROAD.origin), rnd = U.rng(k * 7919 + 13);
    const LW = ROAD.LW, eL = ROAD.edgeL, eR = ROAD.edgeR;
    const P = (s, d, y) => { const p = ROAD.pos(s, d); return [p.x, y, p.z - zb]; };
    const road = new CGB(), sc = new CGB();
    const n = this.CH / this.STEP;
    const strip = (gb, d0, d1, y0, y1, col, step = this.STEP) => {
      for (let j = 0; j < this.CH / step; j++) {
        const a = s0 + j * step, b = a + step;
        gb.quad(P(a, d0, y0), P(b, d0, y0), P(b, d1, y1), P(a, d1, y1), col);
      }
    };
    // road surface
    strip(road, eL - 2.2, eL - 0.6, 0.0, 0.02, WC.gravel);
    strip(road, eL - 0.6, -2 * LW - 0.05, 0.02, 0.03, WC.shoulder);
    strip(road, -2 * LW - 0.05, 2 * LW + 0.05, 0.03, 0.03, WC.asphalt);
    strip(road, 2 * LW + 0.05, eR + 0.6, 0.03, 0.02, WC.shoulder);
    strip(road, eR + 0.6, eR + 2.4, 0.02, 0.0, WC.gravel);
    // edge lines
    strip(road, -2 * LW - 0.25, -2 * LW - 0.07, 0.045, 0.045, WC.yline);
    strip(road, 2 * LW + 0.07, 2 * LW + 0.25, 0.045, 0.045, WC.line);
    // dashed lane lines: 4 m dash, 10 m gap
    for (let i = -1; i <= 1; i++) {
      const d = i * LW;
      for (let m = Math.ceil(s0 / 14) * 14; m < s0 + this.CH; m += 14) {
        const a = m, b = Math.min(m + 4, s0 + this.CH + 4);
        road.quad(P(a, d - 0.08, 0.045), P(b, d - 0.08, 0.045), P(b, d + 0.08, 0.045), P(a, d + 0.08, 0.045), WC.line);
      }
    }
    // guardrails (both sides)
    for (const side of [-1, 1]) {
      const dr = side < 0 ? eL - 0.35 : eR + 0.35;
      const din = dr - side * 0.0, dout = dr + side * 0.18;
      for (let j = 0; j < n; j++) {
        const a = s0 + j * this.STEP, b = a + this.STEP;
        sc.quad(P(a, din, 0.48), P(b, din, 0.48), P(b, din, 0.82), P(a, din, 0.82), WC.rail);
        sc.quad(P(a, din, 0.82), P(b, din, 0.82), P(b, dout, 0.84), P(a, dout, 0.84), WC.rail);
        sc.quad(P(a, din, 0.48), P(b, din, 0.48), P(b, dout, 0.46), P(a, dout, 0.46), WC.post);
      }
      for (let m = Math.ceil(s0 / 4) * 4; m < s0 + this.CH; m += 4) {
        const p = P(m, dr + side * 0.25, 0.4);
        sc.geom(this.G.box, this.xf(p[0], 0.4, p[2], 0, -ROAD.yaw(m), 0.12, 0.8, 0.14), WC.post);
      }
    }
    // light poles on the median side every 60 m
    for (let m = Math.ceil(s0 / 60) * 60; m < s0 + this.CH; m += 60) {
      const yaw = -ROAD.yaw(m), p = P(m, eL - 1.2, 0);
      sc.geom(this.G.cyl5, this.xf(p[0], 5, p[2], 0, yaw, 0.12, 10, 0.12), WC.pole);
      const q = P(m, eL + 1.0, 0);
      sc.geom(this.G.box, this.xf((p[0] + q[0]) / 2, 9.9, (p[2] + q[2]) / 2, 0, yaw, 4.4, 0.12, 0.14), WC.pole);
      sc.geom(this.G.box, this.xf(q[0] + (q[0] - p[0]) * 0.2, 9.82, q[2], 0, yaw, 0.9, 0.12, 0.35), WC.signW);
    }
    // overhead sign gantry
    if (k % 9 === 4) {
      const m = s0 + 60, yaw = -ROAD.yaw(m);
      const a = P(m, eL - 1.0, 0), b = P(m, eR + 1.0, 0);
      for (const q of [a, b]) sc.geom(this.G.box, this.xf(q[0], 3.6, q[2], 0, yaw, 0.35, 7.2, 0.35), WC.pole);
      const c = P(m, (eL + eR) / 2, 0);
      sc.geom(this.G.box, this.xf(c[0], 6.9, c[2], 0, yaw, eR - eL + 2.3, 0.5, 0.5), WC.pole);
      for (const [d, w] of [[-3.7, 6], [4.6, 7]]) {
        const q = P(m - 0.4, d, 0);
        sc.geom(this.G.box, this.xf(q[0], 6.3, q[2], 0, yaw, w, 2.4, 0.12), WC.sign);
        for (let t = 0; t < 3; t++) sc.geom(this.G.box, this.xf(q[0] + Math.cos(yaw) * (t - 1) * 1.2, 6.6 - (t % 2) * 0.5, q[2] + 0.07, 0, yaw, w * 0.22, 0.22, 0.04), WC.signW);
      }
    }
    // construction zones (lane closures)
    for (const z of ZONES.near(s0, s0 + this.CH)) this.buildZone(z, s0, sc, P);
    // lakes (built by the chunk holding the lake's centre; trees / rocks / hills keep clear of them)
    for (const L of this.lakesNear(s0, s0 + this.CH)) if (L.s >= s0 && L.s < s0 + this.CH) this.buildLake(L, sc, P, rnd);
    // trees, bushes, rocks
    const near = sc, far = new CGB();
    // same number near the road as before, plus extra trees spread far out into the fields
    const trees = 16 + Math.floor(rnd() * 10), farTrees = 10 + Math.floor(rnd() * 8);
    for (let i = 0; i < trees + farTrees; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const edge = side < 0 ? -eL : eR;
      const off = i < trees ? 7 + Math.pow(rnd(), 1.6) * 170 : 110 + rnd() * 330;
      const d = side * (edge + off);
      const m = s0 + rnd() * this.CH, p = P(m, d, 0), sz = 0.8 + rnd() * 0.9;
      const kind = rnd();
      if (this.inLake(m, d, 4)) continue;
      const sc = off > 90 ? far : near; // far-out scenery fades in/out with the hills
      if (kind < 0.45) { // pine
        sc.geom(this.G.cyl5, this.xf(p[0], 1.0 * sz, p[2], 0, 0, 0.22 * sz, 2.0 * sz, 0.22 * sz), WC.trunk, rnd);
        sc.geom(this.G.cone6, this.xf(p[0], 3.4 * sz, p[2], 0, rnd() * 3, 2.3 * sz, 4.2 * sz, 2.3 * sz), WC.pine, rnd, 0.12);
        sc.geom(this.G.cone6, this.xf(p[0], 5.5 * sz, p[2], 0, rnd() * 3, 1.6 * sz, 3.2 * sz, 1.6 * sz), WC.pine, rnd, 0.12);
      } else if (kind < 0.85) { // round
        sc.geom(this.G.cyl5, this.xf(p[0], 1.2 * sz, p[2], 0, 0, 0.25 * sz, 2.4 * sz, 0.25 * sz), WC.trunk, rnd);
        sc.geom(this.G.ico0, this.xf(p[0], 3.6 * sz, p[2], rnd(), rnd() * 3, 2.3 * sz, 2.1 * sz, 2.3 * sz), rnd() < 0.5 ? WC.leafA : WC.leafC, rnd, 0.12);
      } else if (kind < 0.94) { // bush
        sc.geom(this.G.ico0, this.xf(p[0], 0.5 * sz, p[2], rnd(), rnd() * 3, 1.3 * sz, 0.9 * sz, 1.3 * sz), WC.leafB, rnd, 0.12);
      } else { // rock
        sc.geom(this.G.dode, this.xf(p[0], 0.2, p[2], rnd(), rnd() * 3, 1.2 * sz, 0.8 * sz, 1.0 * sz), WC.rock, rnd, 0.1);
      }
    }
    // rocks: half as many as before, spread out - some by the road, most out in the fields
    const rocks = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < rocks; i++) {
      const side = rnd() < 0.5 ? -1 : 1, edge = side < 0 ? -eL : eR;
      const off = 3 + Math.pow(rnd(), 1.3) * 160, d = side * (edge + off), m = s0 + rnd() * this.CH;
      if (this.inLake(m, d, 3)) continue;
      const big = rnd() < 0.15, n = big ? 1 : 1 + Math.floor(rnd() * 2), sc = off > 90 ? far : near;
      for (let j = 0; j < n; j++) {
        const p = P(m + (rnd() - 0.5) * 4, d + side * (rnd() - 0.3) * 3, 0);
        const sz = big ? 1.8 + rnd() * 1.6 : 0.35 + rnd() * (j === 0 ? 1.1 : 0.6);
        const col = [WC.rock, WC.rock2, WC.rock3][Math.floor(rnd() * 3)];
        sc.geom(rnd() < 0.5 ? this.G.dode : this.G.ico0, this.xf(p[0], sz * 0.25, p[2], rnd(), rnd() * 3, sz * (1 + rnd() * 0.5), sz * (0.55 + rnd() * 0.35), sz * (0.8 + rnd() * 0.5)), col, rnd, 0.12);
      }
    }
    // rolling hills
    if (rnd() < 0.6) {
      const side = rnd() < 0.5 ? -1 : 1, edge = side < 0 ? -eL : eR;
      const rad = 50 + rnd() * 110, hh = 18 + rnd() * 50;
      const d = side * (edge + 40 + rad + rnd() * 250);
      const m = s0 + rnd() * this.CH, p = P(m, d, 0);
      if (!this.inLake(m, d, rad)) far.geom(this.G.ico1, this.xf(p[0], -hh * 0.25, p[2], 0, rnd() * 3, rad, hh, rad * (0.7 + rnd() * 0.6)), rnd() < 0.5 ? WC.hill : WC.hill2, rnd, 0.08);
    }
    // big grassy mountains in the background (sometimes a smaller shoulder peak beside them)
    if (rnd() < 0.75) {
      const side = rnd() < 0.5 ? -1 : 1, rad = 140 + rnd() * 170, hh = 70 + rnd() * 110;
      const d = side * ((side < 0 ? -eL : eR) + 300 + rad * 0.5 + rnd() * 420);
      const m = s0 + rnd() * this.CH, p = P(m, d, 0);
      const col = [WC.gmtn, WC.gmtn2, WC.gmtn3][Math.floor(rnd() * 3)];
      far.geom(this.G.ico1, this.xf(p[0], -hh * 0.18, p[2], 0, rnd() * 3, rad, hh, rad * (0.7 + rnd() * 0.5)), col, rnd, 0.09);
      if (rnd() < 0.5) {
        const q = P(m + (rnd() - 0.5) * rad * 1.6, d + side * rad * 0.3, 0), r2 = rad * (0.45 + rnd() * 0.3), h2 = hh * (0.45 + rnd() * 0.35);
        far.geom(this.G.ico1, this.xf(q[0], -h2 * 0.2, q[2], 0, rnd() * 3, r2, h2, r2 * 0.9), col === WC.gmtn ? WC.gmtn2 : WC.gmtn, rnd, 0.09);
      }
    }
    // distant mountains
    if (rnd() < 0.35) {
      const side = rnd() < 0.5 ? -1 : 1, rad = 180 + rnd() * 200, hh = 120 + rnd() * 160;
      const d = side * (650 + rnd() * 400);
      const p = P(s0 + rnd() * this.CH, d, 0);
      far.geom(this.G.ico1, this.xf(p[0], -hh * 0.15, p[2], 0, rnd() * 3, rad, hh, rad * 0.8), WC.mtn, rnd, 0.1,
        v => (v.y > 0.8 ? WC.snow : null));
    }
    const grp = new THREE.Group();
    const rm = new THREE.Mesh(road.build(), this.roadMat); rm.receiveShadow = true;
    const sm = new THREE.Mesh(sc.build(), this.mat); sm.castShadow = true; sm.receiveShadow = true;
    grp.add(rm, sm);
    if (far.p.length) {
      const fm = new THREE.Mesh(far.build(), Object.assign(this.mat.clone(), { transparent: true, opacity: 0 }));
      fm.castShadow = true; fm.receiveShadow = true;
      grp.add(fm); grp.userData.far = fm;
    }
    grp.userData.t0 = performance.now() / 1000;
    grp.position.z = zb;
    this.scene.add(grp);
    return grp;
  }

  xf(x, y, z, rx, ry, sx, sy, sz, rz = 0) {
    const e = rz ? new THREE.Euler(rx, ry, rz, 'YXZ') : new THREE.Euler(rx, ry, 0);
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(sx, sy, sz));
  }

  // Construction zone geometry for the part of zone z that falls inside chunk [s0, s0+CH)
  buildZone(z, s0, sc, P) {
    const s1 = s0 + this.CH, G = this.G;
    const sg = z.side === 0 ? -1 : 1;                       // -1 = left side of road, +1 = right
    const inChunk = m => m >= s0 && m < s1;
    const laneC = ROAD.lane(z.side);
    // advance warning signs on the closed side's shoulder (big, bright, saturated orange)
    for (const ds of [350, 180]) {
      const m = z.start - ds; if (!inChunk(m)) continue;
      const d = sg < 0 ? ROAD.edgeL - 0.9 : ROAD.edgeR - 0.6, p = P(m, d, 0), yaw = -ROAD.yaw(m);
      sc.geom(G.box, this.xf(p[0], 1.3, p[2], 0, yaw, 0.1, 2.6, 0.1), WC.pole);
      sc.geom(G.box, this.xf(p[0], 2.9, p[2], 0, yaw, 1.75, 1.75, 0.05, Math.PI / 4), WC.black);     // border
      sc.geom(G.box, this.xf(p[0], 2.9, p[2] + 0.03, 0, yaw, 1.55, 1.55, 0.05, Math.PI / 4), WC.signO);
      sc.geom(G.box, this.xf(p[0], 2.9, p[2] + 0.07, 0, yaw, 0.7, 0.13, 0.03, Math.PI / 4), WC.black);
      sc.geom(G.box, this.xf(p[0], 2.9, p[2] + 0.07, 0, yaw, 0.13, 0.7, 0.03, Math.PI / 4), WC.black);
    }
    // solid construction wall behind the cones: orange/white water-filled barriers through the
    // tapers (continuous, following the taper angle), then concrete jersey barriers along the lane
    const wallSeg = (m, len, k) => {
      const d0 = ZONES.wallD(z, m), d1 = ZONES.wallD(z, m + len), mid = m + len / 2;
      const p = P(mid, (d0 + d1) / 2, 0), yaw = -(ROAD.yaw(mid) + Math.atan2(d1 - d0, len));
      const c = k % 2 ? WC.wwhite : WC.orangeB;
      sc.geom(G.box, this.xf(p[0], 0.36, p[2], 0, yaw, 0.55, 0.72, len - 0.05), c);
      sc.geom(G.box, this.xf(p[0], 0.82, p[2], 0, yaw, 0.32, 0.22, len - 0.25), c);
    };
    let k = 0;
    for (let m = Math.ceil(Math.max(s0, z.start) / 2) * 2; m < Math.min(s1, z.start + z.taper); m += 2) wallSeg(m, 2, k++);
    for (let m = Math.ceil(Math.max(s0, z.end) / 2) * 2; m < Math.min(s1, z.end + z.taperOut); m += 2) wallSeg(m, 2, k++);
    // concrete F-shape barriers along the closed lane: 3.6 m precast segments with small joints
    const SEG = 3.7, run0 = z.start + z.taper;
    for (let k = Math.max(0, Math.ceil((s0 - run0) / SEG)); run0 + k * SEG < Math.min(s1, z.end); k++) {
      const m0 = run0 + k * SEG, m1 = Math.min(m0 + SEG - 0.1, z.end);
      if (m1 - m0 > 0.5) this.jersey(z, m0, m1, k, sc, P);
    }
    // flashing-arrow board just inside the closure
    { const m = z.start + z.taper + 12;
      if (inChunk(m)) {
        const p = P(m, laneC, 0), yaw = -ROAD.yaw(m);
        sc.geom(G.box, this.xf(p[0], 0.55, p[2], 0, yaw, 1.7, 0.5, 1.2), WC.yellow);
        sc.geom(G.box, this.xf(p[0], 1.6, p[2], 0, yaw, 0.12, 1.8, 0.12), WC.black);
        sc.geom(G.box, this.xf(p[0], 2.5, p[2], 0, yaw, 2.4, 1.3, 0.14), WC.black);
        for (let k = 0; k < 3; k++) sc.geom(G.box, this.xf(p[0] - sg * (k - 1) * 0.6 * Math.cos(yaw), 2.5, p[2] + 0.09, 0, yaw, 0.36, 0.5, 0.04, sg * 0.6), WC.yellow);
      }
    }
  }

  // One precast concrete barrier segment (F-shape profile) from m0 to m1, following the road.
  // Sits just behind the collision line so the car meets its face, not its middle.
  jersey(z, m0, m1, k, sc, P) {
    const sg = z.side === 0 ? -1 : 1, face = -sg;                       // face = side looking at traffic
    const cen = m => ZONES.wallD(z, m) + sg * 0.1;
    // half-width / height pairs from the ground up: kerb lip, lower slope, steep upper face, top chamfer
    const prof = [[0.31, 0], [0.31, 0.075], [0.2, 0.32], [0.085, 0.79], [0.06, 0.81]];
    const r = U.rng(z.seed * 977 + k), shade = 0.84 + r() * 0.1; // slightly weathered grey, varies per segment
    const tint = c => c.clone().multiplyScalar(shade);
    const cols = [tint(WC.jersey2).multiplyScalar(0.9), tint(WC.jersey), tint(WC.jersey).multiplyScalar(1.04)];
    const pt = (m, side, i) => P(m, cen(m) + side * prof[i][0], prof[i][1]);
    for (const side of [-1, 1]) {
      for (let i = 0; i < prof.length - 1; i++) {
        sc.quad(pt(m0, side, i), pt(m1, side, i), pt(m1, side, i + 1), pt(m0, side, i + 1), cols[Math.min(i, 2)]);
      }
    }
    const top = prof.length - 1;
    sc.quad(pt(m0, -1, top), pt(m1, -1, top), pt(m1, 1, top), pt(m0, 1, top), cols[2]);
    for (const m of [m0, m1]) for (let i = 0; i < top; i++) {                // end faces
      sc.quad(pt(m, -1, i), pt(m, 1, i), pt(m, 1, i + 1), pt(m, -1, i + 1), cols[0]);
    }
    // traffic side: an orange / white reflective band across the upper face (alternating per segment)
    const bp = (m, y) => { // point on the steep upper face at height y, a hair proud of the concrete
      const f = (y - 0.32) / 0.47, w = 0.2 + (0.085 - 0.2) * f + 0.006;
      return P(m, cen(m) + face * w, y);
    };
    sc.quad(bp(m0 + 0.15, 0.48), bp(m1 - 0.15, 0.48), bp(m1 - 0.15, 0.62), bp(m0 + 0.15, 0.62), WC.orangeB);
    sc.quad(bp(m0 + 0.15, 0.645), bp(m1 - 0.15, 0.645), bp(m1 - 0.15, 0.69), bp(m0 + 0.15, 0.69), WC.wwhite);
    // drainage slots at the foot of each end
    for (const [a, b] of [[m0 + 0.35, m0 + 0.8], [m1 - 0.8, m1 - 0.35]]) {
      const q = (m, y) => P(m, cen(m) + face * 0.316, y);
      sc.quad(q(a, 0.0), q(b, 0.0), q(b, 0.07), q(a, 0.07), WC.black);
    }
  }

  // ---- lakes: deterministic, at most one per 700 m stretch, either side of the road ----
  lake(i) {
    this._lakes = this._lakes || new Map();
    if (!this._lakes.has(i)) {
      const r = U.rng(i * 3571 + 9);
      let L = null;
      if (i > 0 && r() < 0.5) {
        const side = r() < 0.5 ? -1 : 1, Rs = 45 + r() * 55, Rd = 24 + r() * 32;
        const edge = side < 0 ? -ROAD.edgeL : ROAD.edgeR;
        L = { s: i * 700 + 150 + r() * 400, d: side * (edge + 40 + Rd + r() * 60), Rs, Rd, side, ph: r() * 6, ph2: r() * 6 };
      }
      this._lakes.set(i, L);
    }
    return this._lakes.get(i);
  }
  lakesNear(s0, s1) {
    const out = [];
    for (let i = Math.floor((s0 - 150) / 700); i <= Math.floor((s1 + 150) / 700); i++) { const L = this.lake(i); if (L) out.push(L); }
    return out;
  }
  inLake(s, d, pad = 0) {
    for (const L of this.lakesNear(s, s)) {
      const a = (s - L.s) / (L.Rs * 1.2 + pad), b = (d - L.d) / (L.Rd * 1.2 + pad);
      if (a * a + b * b < 1) return true;
    }
    return false;
  }
  buildLake(L, sc, P, rnd) {
    const N = 24, ring = (k, y) => {
      const out = [];
      for (let i = 0; i < N; i++) {
        const t = i / N * Math.PI * 2, w = 1 + 0.12 * Math.sin(3 * t + L.ph) + 0.07 * Math.sin(5 * t + L.ph2);
        out.push(P(L.s + Math.cos(t) * L.Rs * w * k, L.d + Math.sin(t) * L.Rd * w * k, y));
      }
      return out;
    };
    const shore = ring(1.14, 0.02), water = ring(1, 0.045), deep = ring(0.55, 0.05), c = P(L.s, L.d, 0.05);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      sc.quad(shore[i], shore[j], water[j], water[i], WC.sand);
      sc.quad(water[i], water[j], deep[j], deep[i], WC.water);
      sc.tri(deep[i], deep[j], c, WC.waterDeep);
    }
    // a few rocks and bushes along the shore
    for (let i = 0; i < 7; i++) {
      const t = rnd() * Math.PI * 2, k = 1.12 + rnd() * 0.12;
      const p = P(L.s + Math.cos(t) * L.Rs * k, L.d + Math.sin(t) * L.Rd * k, 0), sz = 0.5 + rnd() * 1.1;
      if (rnd() < 0.5) sc.geom(this.G.dode, this.xf(p[0], sz * 0.2, p[2], rnd(), rnd() * 3, sz * 1.3, sz * 0.6, sz), WC.rock2, rnd, 0.1);
      else sc.geom(this.G.ico0, this.xf(p[0], 0.45 * sz, p[2], rnd(), rnd() * 3, 1.2 * sz, 0.8 * sz, 1.2 * sz), WC.leafB, rnd, 0.12);
    }
  }

  makeClouds() {
    const grp = new THREE.Group();
    for (let i = 0; i < 48; i++) {
      const gb = new CGB(), rnd = U.rng(i + 500);
      const kind = rnd();
      // puffy cumulus, long flat streaks, or small single wisps
      const blobs = kind < 0.2 ? 1 + Math.floor(rnd() * 2) : kind < 0.75 ? 3 + Math.floor(rnd() * 5) : 6 + Math.floor(rnd() * 5);
      const scale = kind < 0.2 ? 0.45 + rnd() * 0.4 : 0.7 + rnd() * 1.4;
      const flat = kind >= 0.75 ? 0.45 : 0.6 + rnd() * 0.4;
      for (let b = 0; b < blobs; b++) {
        const r = (12 + rnd() * 18) * scale * (b === Math.floor(blobs / 2) ? 1.35 : 1);
        const geo = rnd() < 0.5 ? this.G.ico0 : this.G.dode;
        gb.geom(geo, this.xf((b - blobs / 2) * 17 * scale + rnd() * 8, rnd() * 7 * scale, (rnd() - 0.5) * 22 * scale, rnd(), rnd() * 3, r * (1.1 + rnd() * 0.6), r * flat, r * (0.8 + rnd() * 0.5)), WC.cloud);
      }
      // own material per cloud so each can fade in on its own (only see-through while fading)
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xb8c8d8, emissiveIntensity: 0.55, flatShading: true });
      const m = new THREE.Mesh(gb.build(), mat);
      m.rotation.y = Math.random() * Math.PI;
      const a = Math.random() * Math.PI * 2, rr = 150 + Math.random() * 1300;
      m.position.set(Math.cos(a) * rr, 130 + Math.random() * 190, Math.sin(a) * rr);
      m.userData.fade = 1;
      m.userData.v = 1 + Math.random() * 2;
      grp.add(m);
    }
    this.scene.add(grp);
    return grp;
  }
}

// =====================================================================
//  Construction-zone cones & barrels with physics.
//  They stand in front of the solid construction wall; drive into them and they get
//  knocked flying - tumbling, bouncing and sliding to rest - and can be kicked again.
// =====================================================================
class ZoneProps {
  constructor(scene) {
    this.scene = scene;
    this.zones = new Map();     // zone seed -> { z, items }
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const G = { cyl: new THREE.CylinderGeometry(1, 1, 1, 10).toNonIndexed(), cone: new THREE.ConeGeometry(1, 1, 10).toNonIndexed(), box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed() };
    const xf = (x, y, z, sx, sy, sz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    const barrel = new CGB();
    for (let k = 0; k < 4; k++) barrel.geom(G.cyl, xf(0, 0.12 + k * 0.24, 0, 0.32 - k * 0.012, 0.24, 0.32 - k * 0.012), k % 2 ? WC.wwhite : WC.orangeB);
    barrel.geom(G.cyl, xf(0, 0.03, 0, 0.38, 0.06, 0.38), WC.black);
    const cone = new CGB();
    cone.geom(G.box, xf(0, 0.025, 0, 0.42, 0.05, 0.42), WC.black);
    cone.geom(G.cone, xf(0, 0.38, 0, 0.17, 0.7, 0.17), WC.orangeB);
    cone.geom(G.cyl, xf(0, 0.42, 0, 0.12, 0.1, 0.12), WC.wwhite);
    this.geo = { barrel: barrel.build(), cone: cone.build() };
    this.R = { barrel: 0.36, cone: 0.22 };     // collision radius
    this.H = { barrel: 1.0, cone: 0.75 };
  }

  sync(ps) {
    for (const z of ZONES.near(ps - 300, ps + 1150)) {
      if (this.zones.has(z.seed)) continue;
      const items = ZONES.props(z).map(p => {
        const mesh = new THREE.Mesh(this.geo[p.kind], this.mat);
        mesh.castShadow = true;
        this.scene.add(mesh);
        return { kind: p.kind, s: p.s, d: p.d, loose: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: Math.random() * 6, rz: 0, wx: 0, wy: 0, wz: 0, cool: 0, mesh };
      });
      this.zones.set(z.seed, { z, items });
    }
    for (const [key, e] of this.zones) {
      if (e.z.end + e.z.taperOut < ps - 320 || e.z.start - 450 > ps + 1200) {
        for (const it of e.items) this.scene.remove(it.mesh);
        this.zones.delete(key);
      }
    }
  }

  // floating-origin shift
  shift(sh) { for (const e of this.zones.values()) for (const it of e.items) if (it.loose) it.z += sh; }

  // returns number of props the car knocked this frame
  update(dt, car, ps, carHull) {
    this.sync(ps);
    let hits = 0;
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    const cvx = car.u * sy + car.v * cy, cvz = -car.u * cy + car.v * sy, spd = Math.hypot(cvx, cvz);
    const front = carHull.front, rear = carHull.rear, hw = carHull.hw;
    for (const e of this.zones.values()) for (const it of e.items) {
      if (!it.loose) { const p = ROAD.pos(it.s, it.d); it.x = p.x; it.z = p.z; it.y = 0; }
      // --- car contact: prop position in the car's frame ---
      it.cool -= dt;
      const dx = it.x - car.x, dz = it.z - car.z;
      if (dx * dx + dz * dz < 40 && it.y < 1.0 && it.cool <= 0 && spd > 1) {
        const lf = dx * sy - dz * cy, lx = dx * cy + dz * sy, r = this.R[it.kind];
        if (Math.abs(lx) < hw + r && lf < front + r && lf > rear - r) {
          // knocked: carried along with the car, flung sideways and up, spinning
          const side = Math.sign(lx) || 1, kick = 0.35 + Math.random() * 0.35;
          it.loose = true; it.cool = 0.4;
          it.vx = cvx * (1 + kick * 0.4) + cy * side * spd * kick * 0.5;
          it.vz = cvz * (1 + kick * 0.4) + sy * side * spd * kick * 0.5;
          it.vy = 2 + Math.min(spd, 60) * (0.07 + Math.random() * 0.06);
          it.wx = (Math.random() - 0.5) * 18; it.wy = (Math.random() - 0.5) * 10; it.wz = (Math.random() - 0.5) * 18;
          hits++;
        }
      }
      // --- free-flight physics ---
      if (it.loose) {
        it.vy -= 9.81 * dt;
        it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
        it.rx += it.wx * dt; it.ry += it.wy * dt; it.rz += it.wz * dt;
        if (it.y <= 0) {            // bounce + scrape on the road
          it.y = 0;
          if (it.vy < -1.5) { it.vy = -it.vy * 0.3; it.wx *= 0.6; it.wz *= 0.6; } else it.vy = 0;
          const f = Math.exp(-4 * dt);
          it.vx *= f; it.vz *= f; it.wy *= f;
          if (it.vy === 0) { // settle: stand back up if it barely tipped, otherwise lie on its side
            it.rx = U.wrap(it.rx); it.rz = U.wrap(it.rz);
            const upright = Math.cos(it.rx) * Math.cos(it.rz) > 0.7;
            const tx = upright ? 0 : (it.rx >= 0 ? Math.PI / 2 : -Math.PI / 2);
            const k = Math.min(1, dt * 6);
            it.rx += (tx - it.rx) * k; it.rz -= it.rz * k;
            it.wx *= f; it.wz *= f;
          }
        }
      }
      const lie = it.loose && it.y < 0.05 && Math.abs(Math.sin(it.rx)) > 0.7 ? this.R[it.kind] * 0.9 : 0;
      it.mesh.position.set(it.x, it.y + lie, it.z);
      it.mesh.rotation.set(it.rx, it.ry, it.rz);
    }
    return hits;
  }
}
