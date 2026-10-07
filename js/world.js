'use strict';
// =====================================================================
//  World: endless curved highway built in chunks + low-poly scenery
// =====================================================================

class CGB { // vertex-coloured geometry builder: flat-shaded faces (low poly), or smooth where asked (cactuses)
  constructor() { this.p = []; this.c = []; this.n = []; }
  // one face normal for all three corners = flat shading
  _flat(i0) {
    const p = this.p, ax = p[i0 + 3] - p[i0], ay = p[i0 + 4] - p[i0 + 1], az = p[i0 + 5] - p[i0 + 2];
    const bx = p[i0 + 6] - p[i0], by = p[i0 + 7] - p[i0 + 1], bz = p[i0 + 8] - p[i0 + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let i = 0; i < 3; i++) this.n.push(nx, ny, nz);
  }
  tri(a, b, c, col) {
    const i0 = this.p.length;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.c.push(col.r, col.g, col.b);
    this._flat(i0);
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  geom(g, m, col, rnd, vary = 0.06, colFn, smooth = false) {
    const ng = g.index ? g.toNonIndexed() : g, p = ng.attributes.position, nrm = ng.attributes.normal, v = new THREE.Vector3();
    const tmp = new THREE.Color(), nm = smooth ? new THREE.Matrix3().getNormalMatrix(m) : null;
    for (let i = 0; i < p.count; i += 3) {
      let cc = col;
      if (colFn) { v.fromBufferAttribute(p, i); cc = colFn(v) || col; }
      const k = 1 + (rnd ? (rnd() - 0.5) * 2 * vary : 0);
      tmp.setRGB(cc.r * k, cc.g * k, cc.b * k);
      const i0 = this.p.length;
      for (let j = 0; j < 3; j++) { v.fromBufferAttribute(p, i + j).applyMatrix4(m); this.p.push(v.x, v.y, v.z); this.c.push(tmp.r, tmp.g, tmp.b); }
      if (smooth && nrm) for (let j = 0; j < 3; j++) { v.fromBufferAttribute(nrm, i + j).applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z); }
      else this._flat(i0);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.computeBoundingSphere();
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
  lampHead: COL(0x5d646d), lampLens: COL(0xfff4d2),   // street light housing / over-bright lens (reads as lit)
  signO: COL(0xff5a00).multiplyScalar(1.6), // over-bright on purpose: reads as a vivid, saturated work sign
  rock2: COL(0x80868d), rock3: COL(0xaea89c), water: COL(0x3d8fc9), waterDeep: COL(0x2c74ad), sand: COL(0xcdbf8f),
  gmtn: COL(0x5f9a45), gmtn2: COL(0x6fa84c), gmtn3: COL(0x528c3f),

};

// World themes: grassy (the original), desert (low sandy hills, cactuses - some with pink flowers - dead
// bushes, sandy rocks, no lakes) and snowy (white hills, snow-covered pines and trees, capped rocks, frozen lakes)
const THEMES = {
  grass: { ground: 0x6f9f4a, gravel: WC.gravel, flora: 'grass', lakes: true, hillH: 1,
    hill: [WC.hill, WC.hill2], mtn: [WC.gmtn, WC.gmtn2, WC.gmtn3], far: WC.mtn, farTop: WC.snow, rocks: [WC.rock, WC.rock2, WC.rock3] },
  desert: { ground: 0xd8b67a, gravel: COL(0xc9ab7c), flora: 'desert', lakes: false, hillH: 0.45,
    hill: [COL(0xdcb877), COL(0xd2aa68)], mtn: [COL(0xc99258), COL(0xd8a566), COL(0xbd8650)], far: COL(0xb97f52), farTop: null,
    rocks: [COL(0xb4916a), COL(0xa07b55), COL(0xc7a57c)] },
  snow: { ground: 0xedf2f6, gravel: COL(0xbfc4c9), flora: 'snow', lakes: true, ice: true, hillH: 1,
    hill: [COL(0xf3f6f9), COL(0xe6ecf1)], mtn: [COL(0xf1f4f7), COL(0xe4eaf0), COL(0xd9e1e9)], far: COL(0xc9d2dc), farTop: COL(0xf6f9fb),
    rocks: [COL(0x8d949b), COL(0x7a8188), COL(0x9da3a9)] },
};
const FLORA = {
  cactus: COL(0x5d8c45), cactus2: COL(0x6e9b4f), flower: COL(0xff6fae), deadwood: COL(0x8b6b47), deadwood2: COL(0x9c7c55),
  snowPine: COL(0x2f6448), snowCap: COL(0xf1f5f8), snowLeaf: COL(0xe7edf2), ice: COL(0xbcd7e6), iceDeep: COL(0xa6c6d9),
};

class World {
  constructor(scene) {
    this.scene = scene;
    this.CH = 120; this.STEP = 5;
    this.chunks = new Map(); this.dying = new Map();
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });   // unlit (street light lenses)
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
      cyl8: new THREE.CylinderGeometry(1, 1, 1, 8).toNonIndexed(),
      cylS: new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).toNonIndexed(),    // cactuses: 8-sided, flat faces
      sphS: new THREE.SphereGeometry(1, 8, 5).toNonIndexed(),
      taper8: new THREE.CylinderGeometry(0.62, 1, 1, 8).toNonIndexed(),   // narrows toward the top (lamp posts)
      disc: new THREE.CylinderGeometry(1, 1, 1, 24).rotateX(Math.PI / 2).toNonIndexed(),   // round sign face (axis along z)
    };
    this.clouds = this.makeClouds();
    this.th = THEMES.grass; this.theme = 'grass';
  }
  // switch world theme (rebuilds the scenery)
  setTheme(name) {
    const t = THEMES[name] ? name : 'grass';
    if (t === this.theme) return;
    this.theme = t; this.th = THEMES[t];
    this.ground.material.color.set(this.th.ground);
    this.reset();
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
        for (const f of c.userData.far) { f.material.transparent = true; f.material.needsUpdate = true; }
        this.dying.set(k + '_' + c.id, c); c.userData.k = k;
      } else c.position.z = this.zbase(k);
    }
    for (const c of this.dying.values()) c.position.z = this.zbase(c.userData.k);
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
      const fs = c.userData.far, o = 1 - (now - c.userData.t0) / 1.2;
      if (o <= 0 || !fs.length) { this.scene.remove(c); c.traverse(x => x.geometry && x.geometry.dispose()); for (const f of fs) f.material.dispose(); this.dying.delete(k); }
      else for (const f of fs) f.material.opacity = o;
    }
    for (const c of this.chunks.values()) {
      for (const f of c.userData.far) {
        if (f.userData.done) continue;
        const o = Math.min(1, (now - c.userData.t0) / 2.5);
        f.material.opacity = o * o * (3 - 2 * o);
        if (o >= 1) { f.material.transparent = false; f.material.depthWrite = true; f.material.needsUpdate = true; f.userData.done = true; }
      }
    }
  }

  // (start of a run: everything appears at once, no fade)
  fillAll(ps) { const ci = Math.floor(ps / this.CH); for (let k = ci - 2; k <= ci + 11; k++) if (!this.chunks.has(k)) { const c = this.build(k); c.userData.t0 = -1e9; this.chunks.set(k, c); } }

  // where a chunk's geometry is anchored: endless road = along z (floating origin); loop = world origin
  zbase(k) { return ROAD.loop ? 0 : -(k * this.CH - ROAD.origin); }
  // chunk index within the lap (loop: scenery repeats every lap)
  lapK(k) { if (!ROAD.loop) return k; const n = ROAD.loop.L / this.CH; return ((k % n) + n) % n; }
  // loop only: keep scenery off the parking lot / ramp and off other parts of the circuit
  blocked(s, d, r, p) {
    if (!ROAD.loop) return false;
    const ls = ROAD.lotS(s);
    if (d > 0 && ls > LOOP.OFF0 - r - 15 && ls < LOOP.RAIL_OPEN1 + r + 10 && d < ROAD.edgeR + LOOP.LOT_D1 + r + 12) return true;
    return !ROAD.clearOfLoop(p[0], p[2], r, s);
  }

  // A hill set out sideways from the road can still land next to the same road further along a tight bend:
  // check the road's own stretch either side (blocked() only covers other parts of the loop).
  clearOfBend(s, d, r) {
    const c = ROAD.pos(s, d), lim = r + 6;      // (r = hill reach + gap; +6 ~ half the road)
    for (let k = -Math.min(2500, r * 4 + 300); k <= Math.min(2500, r * 4 + 300); k += 20) {
      const q = ROAD.pos(s + k, 0);
      if (Math.hypot(q.x - c.x, q.z - c.z) < lim) return false;
    }
    return true;
  }

  // Loop start area road markings, shared by the highway chunks and the lot:
  //  - edgeC: centre of the highway's right edge line
  //  - onC / offC: centre of the on-ramp's / off-ramp's left line; it never goes inside the edge line, so it
  //    runs into it exactly where the ramp joins (onC) or leaves (offC) the highway
  //  - tipOn / tipOff: where each ramp line meets the edge line (the point of the striped gore)
  //  - dash: lot-s ranges where the edge line is dashed (beside the deceleration / acceleration lanes)
  rampGeom() {
    if (this._rg) return this._rg;
    const edgeC = 2 * ROAD.LW + 0.16;
    const onC = s => Math.max(edgeC, ROAD.rampD(s) - ROAD.rampHW(s) + 0.125);
    const offC = s => Math.max(edgeC, ROAD.offD(s) - ROAD.offHW(s) + 0.125);
    let tipOn = LOOP.ACC0; while (tipOn > LOOP.LOT_S1 && onC(tipOn) <= edgeC + 1e-3) tipOn -= 0.25;
    let tipOff = LOOP.DEC1; while (tipOff < LOOP.LOT_S0 && offC(tipOff) <= edgeC + 1e-3) tipOff += 0.25;
    return (this._rg = { edgeC, onC, offC, tipOn, tipOff,
      dash: [[LOOP.OFF0 + 20, Math.round(tipOff)], [Math.round(tipOn), LOOP.RAIL_OPEN1 - 6]] });
  }

  // drop everything (switching between the endless road and the loop circuit)
  reset() {
    for (const c of [...this.chunks.values(), ...this.dying.values()]) { this.scene.remove(c); c.traverse(x => { if (x.geometry) x.geometry.dispose(); }); }
    this.chunks.clear(); this.dying.clear(); this._lakes = null;
    if (this.lot) { this.scene.remove(this.lot); this.lot.traverse(x => x.geometry && x.geometry.dispose()); this.lot = null; }
    if (ROAD.loop) { this.lot = this.buildLot(); this.scene.add(this.lot); }
  }

  build(k) {
    const s0 = k * this.CH, zb = this.zbase(k), kk = this.lapK(k), rnd = U.rng(kk * 7919 + 13);
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
    const TH = this.th;
    strip(road, eL - 2.2, eL - 0.6, 0.0, 0.02, TH.gravel);
    strip(road, eL - 0.6, -2 * LW - 0.05, 0.02, 0.03, WC.shoulder);
    strip(road, -2 * LW - 0.05, 2 * LW + 0.05, 0.03, 0.03, WC.asphalt);
    strip(road, 2 * LW + 0.05, eR + 0.6, 0.03, 0.02, WC.shoulder);
    strip(road, eR + 0.6, eR + 2.4, 0.02, 0.0, TH.gravel);
    // loop: the acceleration / deceleration lane beside the start area is paved like a real lane
    const RG = ROAD.loop ? this.rampGeom() : null;
    if (RG) for (let j = 0; j < n * 5; j++) {
      const a = s0 + j * 1, b = a + 1, oa = ROAD.auxOuter(a), ob = ROAD.auxOuter(b);
      if (oa === null || ob === null) continue;
      const ia = Math.min(2 * LW + 0.05, oa), ib = Math.min(2 * LW + 0.05, ob);   // (covers the shoulder's edge: no pale seam)
      road.quad(P(a, ia, 0.036), P(b, ib, 0.036), P(b, ob, 0.036), P(a, oa, 0.036), WC.asphalt);
      // its outer line runs into the highway's edge line exactly where the lane tapers in / out
      const ca = Math.max(RG.edgeC, oa - 0.125), cb = Math.max(RG.edgeC, ob - 0.125);
      if (ca > RG.edgeC + 0.01 || cb > RG.edgeC + 0.01)
        road.quad(P(a, ca - 0.075, 0.046), P(b, cb - 0.075, 0.046), P(b, cb + 0.075, 0.046), P(a, ca + 0.075, 0.046), WC.line);
    }
    // edge lines. Loop: the right one is dashed (5 m on, 7 m off) beside the deceleration / acceleration lanes
    strip(road, -2 * LW - 0.25, -2 * LW - 0.07, 0.045, 0.045, WC.yline);
    {
      const onAt = s => {
        if (!RG) return true;
        const ls = ROAD.lotS(s), r = RG.dash.find(([a, b]) => ls >= a && ls < b);
        return !r || (ls - r[0]) % 12 < 5;
      };
      const edgeQuad = (a, b) => road.quad(P(a, 2 * LW + 0.07, 0.045), P(b, 2 * LW + 0.07, 0.045), P(b, 2 * LW + 0.25, 0.045), P(a, 2 * LW + 0.25, 0.045), WC.line);
      let runA = null;
      for (let m = s0; m < s0 + this.CH; m += 0.5) {
        if (onAt(m + 0.25)) { if (runA === null) runA = m; if (m + 0.5 - runA >= this.STEP) { edgeQuad(runA, m + 0.5); runA = null; } }
        else if (runA !== null) { edgeQuad(runA, m); runA = null; }
      }
      if (runA !== null) edgeQuad(runA, s0 + this.CH);
    }
    // dashed lane lines: 4 m dash, 10 m gap
    for (let i = -1; i <= 1; i++) {
      const d = i * LW;
      for (let m = Math.ceil(s0 / 14) * 14; m < s0 + this.CH; m += 14) {
        const a = m, b = Math.min(m + 4, s0 + this.CH + 4);
        road.quad(P(a, d - 0.08, 0.045), P(b, d - 0.08, 0.045), P(b, d + 0.08, 0.045), P(a, d + 0.08, 0.045), WC.line);
      }
    }
    // guardrails (both sides): a solid steel beam, closed all round, on posts that stand BEHIND it (so the
    // light beam is what you see from the road) and go down into the ground. Where a rail stops (loop: around
    // the ramps) the beam is capped and finishes on a post.
    for (const side of [-1, 1]) {
      const dr = side < 0 ? eL - 0.35 : eR + 0.35;
      const din = dr, dout = dr + side * 0.16, yB = 0.47, yT = 0.83;
      const open = s => ROAD.railOpen(side, s);
      const postAt = m => { const p = P(m, dout + side * 0.07, 0); sc.geom(this.G.box, this.xf(p[0], 0.29, p[2], 0, -ROAD.yaw(m), 0.12, 0.98, 0.12), WC.post); };
      const cap = s => sc.quad(P(s, din, yB), P(s, dout, yB), P(s, dout, yT), P(s, din, yT), WC.rail);
      for (let j = 0; j < n; j++) {
        const a = s0 + j * this.STEP, b = a + this.STEP;
        if (open(a + this.STEP / 2)) continue;                        // (loop: gaps where the ramps join)
        sc.quad(P(a, din, yB), P(b, din, yB), P(b, din, yT), P(a, din, yT), WC.rail);       // face (road side)
        sc.quad(P(a, dout, yB), P(b, dout, yB), P(b, dout, yT), P(a, dout, yT), WC.rail);   // back
        sc.quad(P(a, din, yT), P(b, din, yT), P(b, dout, yT), P(a, dout, yT), WC.rail);     // top
        sc.quad(P(a, din, yB), P(b, din, yB), P(b, dout, yB), P(a, dout, yB), WC.post);     // underside
        if (open(a - this.STEP / 2)) { cap(a); postAt(a + 0.1); }      // the rail starts here...
        if (open(b + this.STEP / 2)) { cap(b); postAt(b - 0.1); }      // ...or ends here
      }
      for (let m = Math.ceil(s0 / 4) * 4; m < s0 + this.CH; m += 4) if (!open(m - 1.5) && !open(m + 1.5)) postAt(m);
    }
    // street lights on the median side every 120 m: concrete footing, tapered pole, an arm that sweeps up and
    // out over the fast lane, and a slim lamp head with a glowing lens underneath
    const glow = new CGB();                      // unlit bits (lamp lenses)
    const beam = (a, b, w, h, col, gbx = sc) => {   // box from point a to point b (world [x, y, z])
      const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = dir.length();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
      const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(w, h, len + 0.02));
      gbx.geom(this.G.box, m, col);
    };
    for (let m = Math.ceil(s0 / 120) * 120; m < s0 + this.CH; m += 120) {
      const yaw = -ROAD.yaw(m), dp = eL - 1.2, p = P(m, dp, 0), at = (d, y) => { const q = P(m, d, 0); return [q[0], y, q[2]]; };
      sc.geom(this.G.cyl8, this.xf(p[0], 0.22, p[2], 0, yaw, 0.3, 0.65, 0.3), WC.concrete);           // footing
      sc.geom(this.G.taper8, this.xf(p[0], 5.2, p[2], 0, yaw, 0.15, 9.9, 0.15), WC.pole);            // pole
      sc.geom(this.G.cyl8, this.xf(p[0], 0.62, p[2], 0, yaw, 0.19, 0.12, 0.19), WC.post);            // base flange
      const k = [at(dp, 9.95), at(dp + 0.25, 10.25), at(dp + 0.75, 10.42), at(dp + 3.3, 10.52)];     // arm: a smooth sweep
      for (let i = 0; i < 3; i++) beam(k[i], k[i + 1], 0.11 - i * 0.005, 0.11 - i * 0.005, WC.pole);
      sc.geom(this.G.cyl8, this.xf(p[0], 10.12, p[2], 0, yaw, 0.1, 0.1, 0.1), WC.pole);               // rounded top of the pole
      const h0 = at(dp + 2.9, 10.47), h1 = at(dp + 4.15, 10.41);
      beam(h0, h1, 0.44, 0.17, WC.lampHead);                                                         // lamp head
      beam([h0[0], h0[1] - 0.1, h0[2]], [h1[0], h1[1] - 0.1, h1[2]], 0.3, 0.05, WC.lampLens, glow);  // lens (unlit: reads as lit)
    }
    // overhead sign gantry
    if (kk % 9 === 4) {
      const m = s0 + 60, yaw = -ROAD.yaw(m);
      const a = P(m, eL - 1.0, 0), b = P(m, eR + 1.0, 0);
      for (const q of [a, b]) sc.geom(this.G.box, this.xf(q[0], 3.5, q[2], 0, yaw, 0.35, 7.4, 0.35), WC.pole);   // (into the ground)
      const c = P(m, (eL + eR) / 2, 0);
      sc.geom(this.G.box, this.xf(c[0], 6.9, c[2], 0, yaw, eR - eL + 2.3, 0.5, 0.5), WC.pole);
      [[-3.7, 6], [4.6, 7]].forEach(([d, w], si) => {
        const q = P(m - 0.4, d, 0);
        sc.geom(this.G.box, this.xf(q[0], 6.3, q[2], 0, yaw, w, 2.4, 0.12), WC.sign);
        // white text lines, laid flat on the sign's face (offsets follow the sign's angle on curves).
        // Half the signs have 3 lines (two on top, one below), half have 2 (upper-left, lower-right, near the middle).
        const rx = Math.cos(yaw), rz = -Math.sin(yaw), nx = Math.sin(yaw), nz = Math.cos(yaw);   // sign's sideways / facing directions
        const twoLines = (Math.abs(Math.sin(kk * 12.9898 + si * 78.233) * 43758.5453) % 1) < 0.5;   // fixed per sign
        const lines = twoLines ? [[-0.55, 6.6, 0.34], [0.55, 6.1, 0.34]]                         // [sideways, height, width share]
                               : [[-1.2, 6.6, 0.22], [0, 6.1, 0.22], [1.2, 6.6, 0.22]];
        for (const [o, y, ws] of lines)
          sc.geom(this.G.box, this.xf(q[0] + rx * o + nx * 0.07, y, q[2] + rz * o + nz * 0.07, 0, yaw, w * ws, 0.22, 0.04), WC.signW);
      });
    }
    // construction zones (lane closures)
    for (const z of ZONES.near(s0, s0 + this.CH)) this.buildZone(z, s0, sc, P);
    // lakes (built by the chunk holding the lake's centre; trees / rocks / hills keep clear of them)
    for (const L of this.lakesNear(s0, s0 + this.CH)) if (L.s >= s0 && L.s < s0 + this.CH) this.buildLake(L, sc, P, rnd);
    // trees, bushes, rocks
    const near = sc, far = new CGB(), hills = new CGB();
    // same number near the road as before, plus extra trees spread far out into the fields
    const trees = 16 + Math.floor(rnd() * 10), farTrees = 10 + Math.floor(rnd() * 8);
    for (let i = 0; i < trees + farTrees; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const edge = side < 0 ? -eL : eR;
      const off = i < trees ? 7 + Math.pow(rnd(), 1.6) * 170 : 110 + rnd() * 330;
      const d = side * (edge + off);
      const m = s0 + rnd() * this.CH, p = P(m, d, 0), sz = 0.8 + rnd() * 0.9;
      const kind = rnd();
      if (this.inLake(m, d, 4) || this.blocked(m, d, 4, p)) continue;
      const sc = off > 90 ? far : near; // far-out scenery fades in/out with the hills
      if (TH.flora !== 'grass') { this.themedPlant(TH, sc, p, sz, kind, rnd); continue; }
      if (kind < 0.45) { // pine
        sc.geom(this.G.cyl5, this.xf(p[0], 1.0 * sz - 0.1, p[2], 0, 0, 0.22 * sz, 2.0 * sz + 0.2, 0.22 * sz), WC.trunk, rnd);
        sc.geom(this.G.cone6, this.xf(p[0], 3.4 * sz, p[2], 0, rnd() * 3, 2.3 * sz, 4.2 * sz, 2.3 * sz), WC.pine, rnd, 0.12);
        sc.geom(this.G.cone6, this.xf(p[0], 5.5 * sz, p[2], 0, rnd() * 3, 1.6 * sz, 3.2 * sz, 1.6 * sz), WC.pine, rnd, 0.12);
      } else if (kind < 0.85) { // round
        sc.geom(this.G.cyl5, this.xf(p[0], 1.2 * sz - 0.1, p[2], 0, 0, 0.25 * sz, 2.4 * sz + 0.2, 0.25 * sz), WC.trunk, rnd);
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
      if (this.inLake(m, d, 3) || this.blocked(m, d, 5, P(m, d, 0))) continue;
      const big = rnd() < 0.15, n = big ? 1 : 1 + Math.floor(rnd() * 2), sc = off > 90 ? far : near;
      for (let j = 0; j < n; j++) {
        const p = P(m + (rnd() - 0.5) * 4, d + side * (rnd() - 0.3) * 3, 0);
        const sz = big ? 1.8 + rnd() * 1.6 : 0.35 + rnd() * (j === 0 ? 1.1 : 0.6);
        const col = TH.rocks[Math.floor(rnd() * 3)];
        const sx = sz * (1 + rnd() * 0.5), sy = sz * (0.55 + rnd() * 0.35), sz2 = sz * (0.8 + rnd() * 0.5);
        sc.geom(rnd() < 0.5 ? this.G.dode : this.G.ico0, this.xf(p[0], sz * 0.25, p[2], rnd(), rnd() * 3, sx, sy, sz2), col, rnd, 0.12);
        if (TH.flora === 'snow') sc.geom(this.G.ico0, this.xf(p[0], sz * 0.25 + sy * 0.55, p[2], 0, rnd() * 3, sx * 0.8, sy * 0.35, sz2 * 0.8), FLORA.snowCap, rnd, 0.04);   // snow on top
      }
    }
    // Hills: every chunk puts a row on BOTH sides (so there are no bare stretches), and each one keeps a
    // clear gap to the road measured from its widest point (they're stretched and turned at random).
    // A spot that's blocked (lake, lot, another part of the loop) is retried a little farther out.
    const GREENS = TH.mtn, HH = TH.hillH;   // (theme colours; desert hills are much lower)
    const hill = (side, gap, spread, radA, radB, hA, hB, sink, col, jitter, colFn) => {
      const edge = side < 0 ? -eL : eR;
      for (let tries = 0; tries < 4; tries++) {
        const rad = radA + rnd() * (radB - radA), hh = hA + rnd() * (hB - hA), zs = 0.75 + rnd() * 0.45;
        const ext = rad * Math.max(1, zs);                                  // widest reach on the ground
        const d = side * (edge + gap + ext + rnd() * spread + tries * 60);
        const m = s0 + rnd() * this.CH, p = P(m, d, 0);
        if (this.inLake(m, d, ext) || this.blocked(m, d, ext + gap * 0.8, p) || !this.clearOfBend(m, d, ext + gap)) continue;
        hills.geom(this.G.ico1, this.xf(p[0], -hh * sink, p[2], 0, rnd() * 3, rad, hh, rad * zs), col, rnd, jitter, colFn);
        return { m, d, rad, hh, ext };
      }
      return null;
    };
    for (const side of [-1, 1]) {
      // low rolling hills: at least 90 m of open field before them
      if (rnd() < 0.85) hill(side, 90, 220, 45, 110, 14 * HH, 38 * HH, 0.25, TH.hill[rnd() < 0.5 ? 0 : 1], 0.08);
      // big grassy mountains: at least 230 m out, sometimes with a smaller shoulder peak behind
      const col = GREENS[Math.floor(rnd() * 3)];
      const big = hill(side, 230, 380, 140, 290, 70 * HH, 170 * HH, 0.18, col, 0.09);
      if (big && rnd() < 0.5) {
        const q = P(big.m + (rnd() - 0.5) * big.rad * 1.6, big.d + side * big.rad * 0.6, 0), r2 = big.rad * (0.45 + rnd() * 0.3), h2 = big.hh * (0.45 + rnd() * 0.35);
        if (!this.blocked(big.m, big.d + side * big.rad * 0.6, r2, q)) hills.geom(this.G.ico1, this.xf(q[0], -h2 * 0.2, q[2], 0, rnd() * 3, r2, h2, r2 * 0.9), col === GREENS[0] ? GREENS[1] : GREENS[0], rnd, 0.09);
      }
      // distant mountains on the horizon (grassy: grey with snowy tops; desert: red-brown; snowy: white tops)
      if (rnd() < 0.5) hill(side, 650, 350, 180, 360, 120 * HH, 260 * HH, 0.15, TH.far, 0.1, TH.farTop ? v => (v.y > 0.8 ? TH.farTop : null) : undefined);
    }
    const grp = new THREE.Group();
    const rm = new THREE.Mesh(road.build(), this.roadMat); rm.receiveShadow = true;
    const sm = new THREE.Mesh(sc.build(), this.mat); sm.castShadow = true; sm.receiveShadow = true;
    grp.add(rm, sm);
    if (glow.p.length) grp.add(new THREE.Mesh(glow.build(), this.glowMat));
    grp.userData.far = [];
    for (const cg of [far, hills]) {
      if (!cg.p.length) continue;
      const fmat = Object.assign(this.mat.clone(), { transparent: true, opacity: 0 });
      const fm = new THREE.Mesh(cg.build(), fmat);
      fm.castShadow = true; fm.receiveShadow = true;
      grp.add(fm); grp.userData.far.push(fm);
    }
    grp.userData.t0 = performance.now() / 1000;
    grp.position.z = zb;
    this.scene.add(grp);
    return grp;
  }

  // ---- loop circuit start area (see LOOP in core.js): highway -> off-ramp (entrance) -> open concrete pad
  //      (everyone starts here) -> on-ramp (exit) -> highway. Laid out in road coordinates so it follows the curve.
  buildLot() {
    const P = (s, d, y) => { const p = ROAD.pos(s, d); return [p.x, y, p.z]; };
    const D = LOOP, eR = ROAD.edgeR, G = this.G, gb = new CGB(), lines = new CGB();
    const curb = COL(0xd6d4cc);
    const area = (gbx, s0, s1, dA, dB, y, col, step = 5) => {   // dA / dB may be functions of s
      const fA = typeof dA === 'function' ? dA : () => dA, fB = typeof dB === 'function' ? dB : () => dB;
      for (let a = s0; a < s1 - 1e-6; a += step) {
        const b = Math.min(a + step, s1);
        gbx.quad(P(a, fA(a), y), P(b, fA(b), y), P(b, fB(b), y), P(a, fB(a), y), col);
      }
    };
    const kerbAcross = (s, d0, d1) => { const c = P(s, (d0 + d1) / 2, 0); gb.geom(G.box, this.xf(c[0], 0.03, c[2], 0, -ROAD.yaw(s), d1 - d0, 0.16, 0.4), curb); };
    // low kerb along the road: a solid strip (top, both sides and ends) standing on the ground, not a floating sheet
    const curbSide = COL(0xb4b2aa), KT = 0.1, KB = -0.04;
    const kerb = (s0, s1, dA, dB, step = 2) => {
      const fA = typeof dA === 'function' ? dA : () => dA, fB = typeof dB === 'function' ? dB : () => dB;
      area(gb, s0, s1, fA, fB, KT, curb, step);
      for (let a = s0; a < s1 - 1e-6; a += step) {
        const b = Math.min(a + step, s1);
        for (const f of [fA, fB]) gb.quad(P(a, f(a), KB), P(b, f(b), KB), P(b, f(b), KT), P(a, f(a), KT), curbSide);
      }
      for (const s of [s0, s1]) gb.quad(P(s, fA(s), KB), P(s, fB(s), KB), P(s, fB(s), KT), P(s, fA(s), KT), curbSide);
    };
    const arrow = (s, d) => {                 // white arrow painted on the ground, pointing with the traffic
      const pt = (f, w) => P(s + f, d + w, 0.06);
      lines.quad(pt(-1.8, -0.22), pt(0.3, -0.22), pt(0.3, 0.22), pt(-1.8, 0.22), WC.line);
      lines.tri(pt(0.3, -0.8), pt(1.9, 0), pt(0.3, 0.8), WC.line);
    };
    // Double-sided sign: one face is a red "do not enter" disc with a white bar, the other a white board
    // with a black arrow pointing straight on. The red face looks toward +s (drivers heading the wrong way
    // see it), the arrow toward -s (drivers going the right way see it).
    const sign = (s, d) => {
      const yaw = -ROAD.yaw(s), p = P(s, d, 0), y = 2.55;
      gb.geom(G.box, this.xf(p[0], 1.2, p[2], 0, yaw, 0.1, 2.8, 0.1), WC.pole);   // (into the ground)
      gb.geom(G.box, this.xf(p[0], y, p[2], 0, yaw, 0.98, 0.98, 0.05), COL(0x3a3f48));            // backing plate
      const red = P(s + 0.05, d, 0), bar = P(s + 0.075, d, 0);
      gb.geom(G.disc, this.xf(red[0], y, red[2], 0, yaw, 0.46, 0.46, 0.02), COL(0xd0222b).multiplyScalar(1.25));
      gb.geom(G.box, this.xf(bar[0], y, bar[2], 0, yaw, 0.6, 0.13, 0.02), WC.wwhite);
      const wht = P(s - 0.05, d, 0), blk = P(s - 0.075, d, 0);
      gb.geom(G.box, this.xf(wht[0], y, wht[2], 0, yaw, 0.88, 0.88, 0.02), WC.wwhite);
      gb.geom(G.box, this.xf(blk[0], y - 0.08, blk[2], 0, yaw, 0.12, 0.48, 0.02), WC.black);   // arrow shaft
      gb.geom(G.box, this.xf(blk[0] + Math.cos(yaw) * 0.08, y + 0.16, blk[2] - Math.sin(yaw) * 0.08, 0, yaw, 0.12, 0.34, 0.02, 0.8), WC.black);
      gb.geom(G.box, this.xf(blk[0] - Math.cos(yaw) * 0.08, y + 0.16, blk[2] + Math.sin(yaw) * 0.08, 0, yaw, 0.12, 0.34, 0.02, -0.8), WC.black);
    };

    // the pad: plain asphalt (same as the road), a low kerb all round (open at the entrance and the exit)
    const d0 = eR + D.LOT_D0, d1 = eR + D.LOT_D1;
    area(gb, D.LOT_S0, D.LOT_S1, d0, d1, 0.035, WC.asphalt);
    kerb(D.LOT_S0, D.LOT_S1, d0 - 0.4, d0, 5);
    kerb(D.LOT_S0, D.LOT_S1, d1, d1 + 0.4, 5);
    const inA = ROAD.offD(D.LOT_S0) - ROAD.offHW(D.LOT_S0), inB = ROAD.offD(D.LOT_S0) + ROAD.offHW(D.LOT_S0);
    const outA = ROAD.rampD(D.LOT_S1) - ROAD.rampHW(D.LOT_S1), outB = ROAD.rampD(D.LOT_S1) + ROAD.rampHW(D.LOT_S1);
    kerbAcross(D.LOT_S0, d0 - 0.4, inA); kerbAcross(D.LOT_S0, inB, d1 + 0.4);
    kerbAcross(D.LOT_S1, d0 - 0.4, outA); kerbAcross(D.LOT_S1, outB, d1 + 0.4);

    // The ramps narrow to exactly one lane where they meet the deceleration / acceleration lane, so their
    // edges line up with it. Between a ramp and the highway's edge line there's a striped gore that ends
    // in a point; the ramp's inner line stops there. Kerbs only near the pad.
    const RG = this.rampGeom(), edge = RG.edgeC + 0.09;     // edge: outer side of the highway's edge line
    const lineAlong = (s0, s1, c) => area(lines, s0, s1, s => c(s) - 0.075, s => c(s) + 0.075, 0.055, WC.line, 1);
    // Striped gore between the highway's edge line and a ramp's left line: paved, with evenly spaced
    // stripes at one angle that run the way traffic moves (peeling off / merging in), all kept inside the
    // two lines. It starts at the point where the lines meet and ends where the ramp is clear of the
    // highway's gravel verge (or where the guard rail starts again).
    const gore = (tip, c, dir) => {             // dir +1: widens with s (off-ramp), -1: widens against s (on-ramp)
      const inner = s => c(s) - 0.075;          // inside edge of the ramp's line
      let end = tip; while (Math.abs(end - tip) < 140 && c(end) < ROAD.edgeR + 2.4 && ROAD.railOpen(1, end + dir)) end += dir * 0.5;
      const a = Math.min(tip, end), b = Math.max(tip, end);
      area(gb, a, b, edge - 0.05, s => Math.max(edge, inner(s) + 0.02), 0.034, WC.asphalt, 1);
      // a solid line across the wide end closes the painted area off neatly
      const ec = end - dir * 0.2;
      lines.quad(P(ec - 0.2, edge - 0.05, 0.05), P(ec + 0.2, edge - 0.05, 0.05), P(ec + 0.2, inner(ec + 0.2), 0.05), P(ec - 0.2, inner(ec - 0.2), 0.05), WC.line);
      const lean = 1.6;                        // stripe length along the road per metre of gore width (~32 deg)
      for (let k = 3; k < Math.abs(end - tip); k += 5) {
        const sr = tip + dir * k, w = inner(sr) - edge;   // stripe end on the ramp line
        if (w < 0.45) continue;
        const se = sr - dir * lean * w;                   // ...and on the highway's edge line (back toward the point)
        if (dir > 0 ? se < tip : se > tip) continue;
        const t = 0.4 * dir;                              // stripe width (along the road)
        lines.quad(P(se, edge, 0.05), P(se + t, edge, 0.05), P(sr + t, inner(sr + t), 0.05), P(sr, inner(sr), 0.05), WC.line);
      }
    };
    // off-ramp (entrance): leaves the deceleration lane and curves onto the pad's back edge
    const oA = s => ROAD.offD(s) - ROAD.offHW(s), oB = s => ROAD.offD(s) + ROAD.offHW(s);
    area(gb, D.DEC1, D.LOT_S0, oA, oB, 0.04, WC.asphalt, 2);
    lineAlong(RG.tipOff - 0.5, D.LOT_S0, RG.offC);                  // left line: grows out of the edge line
    lineAlong(D.DEC1, D.LOT_S0, s => oB(s) - 0.125);                 // right line: carries on the decel lane's
    gore(RG.tipOff, RG.offC, 1);
    kerb(D.LOT_S0 - 50, D.LOT_S0, s => oA(s) - 0.35, oA);
    kerb(D.LOT_S0 - 50, D.LOT_S0, oB, s => oB(s) + 0.35);
    arrow(D.LOT_S0 - 20, ROAD.offD(D.LOT_S0 - 20));
    // on-ramp (exit): from the pad's front edge down into the acceleration lane
    const rA = s => ROAD.rampD(s) - ROAD.rampHW(s), rB = s => ROAD.rampD(s) + ROAD.rampHW(s);
    area(gb, D.LOT_S1, D.ACC0, rA, rB, 0.04, WC.asphalt, 2);
    lineAlong(D.LOT_S1, RG.tipOn + 0.5, RG.onC);                    // left line: runs into the edge line
    lineAlong(D.LOT_S1, D.ACC0, s => rB(s) - 0.125);                 // right line: becomes the accel lane's
    gore(RG.tipOn, RG.onC, -1);
    kerb(D.LOT_S1, D.LOT_S1 + 50, s => rA(s) - 0.35, rA);
    kerb(D.LOT_S1, D.LOT_S1 + 50, rB, s => rB(s) + 0.35);
    arrow(D.LOT_S1 + 12, ROAD.rampD(D.LOT_S1 + 12));
    // signs either side of both openings
    for (const k of [-1, 1]) {
      sign(D.LOT_S0 + 1.5, ROAD.offD(D.LOT_S0) + k * 5.4);      // entrance: arrow toward arriving cars, "do not enter" toward the pad
      sign(D.LOT_S1 - 1.5, ROAD.rampD(D.LOT_S1) + k * 5.4);     // exit: arrow toward the pad, "do not enter" toward the ramp
    }

    // fence along the outside of the whole start area (same steel rail as the highway): a solid beam with
    // its posts standing behind it (outside) and down into the ground, and a post right at each end
    const rail = (pts) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [a, b] = [pts[i], pts[i + 1]];
        const pa = P(a[0], a[1] + 0.08, 0), pb = P(b[0], b[1] + 0.08, 0);
        const dx = pb[0] - pa[0], dz = pb[2] - pa[2], len = Math.hypot(dx, dz); if (len < 0.01) continue;
        const yaw = Math.atan2(dx, dz), mx = (pa[0] + pb[0]) / 2, mz = (pa[2] + pb[2]) / 2;
        gb.geom(G.box, this.xf(mx, 0.65, mz, 0, yaw, 0.16, 0.36, len + 0.02), WC.rail);
      }
      const post = i => { const [s, d] = pts[i], p = P(s, d + 0.23, 0); gb.geom(G.box, this.xf(p[0], 0.29, p[2], 0, -ROAD.yaw(s), 0.12, 0.98, 0.12), WC.post); };
      for (let i = 0; i < pts.length - 1; i += 2) post(i);
      post(pts.length - 1);
    };
    const outer = [];
    for (let s = D.OFF0; s <= D.RAIL_OPEN1; s += 2) outer.push([s, ROAD.lotOuter(s) + 0.1]);
    rail(outer);

    const grp = new THREE.Group();
    const m = new THREE.Mesh(gb.build(), this.mat); m.castShadow = true; m.receiveShadow = true;
    const l = new THREE.Mesh(lines.build(), this.roadMat); l.receiveShadow = true;
    grp.add(m, l);
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
      // loop: lakes repeat every lap (the same 18 slots), never by the parking lot
      const NL = ROAD.loop ? ROAD.loop.L / 700 : 0, j = NL ? ((i % NL) + NL) % NL : i, lap = NL ? Math.floor(i / NL) : 0;
      const r = U.rng(j * 3571 + 9);
      let L = null;
      if ((NL || i > 0) && r() < 0.5) {
        const side = r() < 0.5 ? -1 : 1, Rs = 45 + r() * 55, Rd = 24 + r() * 32;
        const edge = side < 0 ? -ROAD.edgeL : ROAD.edgeR;
        L = { s: j * 700 + 150 + r() * 400, d: side * (edge + 40 + Rd + r() * 60), Rs, Rd, side, ph: r() * 6, ph2: r() * 6 };
        if (NL) {
          const p = ROAD.pos(L.s, L.d);
          if (this.blocked(L.s, L.d, L.Rs * 1.3, [p.x, 0, p.z])) L = null;
          else L.s += lap * ROAD.loop.L;
        }
      }
      this._lakes.set(i, L);
    }
    return this._lakes.get(i);
  }
  lakesNear(s0, s1) {
    const out = [];
    if (!this.th.lakes) return out;                    // (no lakes in the desert)
    for (let i = Math.floor((s0 - 150) / 700); i <= Math.floor((s1 + 150) / 700); i++) { const L = this.lake(i); if (L) out.push(L); }
    return out;
  }
  // one plant for the desert / snowy worlds (kind: 0..1 random pick)
  themedPlant(TH, sc, p, sz, kind, rnd) {
    const G = this.G, x = p[0], z = p[2];
    if (TH.flora === 'desert') {
      if (kind < 0.5) {                     // saguaro cactus: chunky 8-sided trunk with rounded caps, one or two arms, some flowering
        const h = (3.4 + rnd() * 2.6) * sz, r = 0.42 * sz, col = rnd() < 0.5 ? FLORA.cactus : FLORA.cactus2, flower = rnd() < 0.35;
        const S = (g, m, c) => sc.geom(g, m, c, rnd, 0.04);   // (flat-shaded facets, like the rest of the world)
        S(G.cylS, this.xf(x, h / 2 - 0.15, z, 0, 0, r, h + 0.3, r), col);
        S(G.sphS, this.xf(x, h, z, 0, 0, r, r * 0.95, r), col);                                   // rounded top
        if (flower) for (let f = 0; f < 3; f++) {                                                   // pink flowers on the crown
          const fa = rnd() * 6.3;
          S(G.sphS, this.xf(x + Math.cos(fa) * r * 0.42, h + r * 0.8, z + Math.sin(fa) * r * 0.42, 0, 0, r * 0.42, r * 0.28, r * 0.42), FLORA.flower);
        }
        const arms = rnd() < 0.25 ? 0 : rnd() < 0.6 ? 1 : 2, a0 = rnd() * 6;
        for (let k = 0; k < arms; k++) {
          const a = a0 + k * Math.PI + (rnd() - 0.5) * 0.6, y0 = h * (0.38 + rnd() * 0.18), ar = r * 0.68, out = r + 0.55 * sz, up = h * (0.28 + rnd() * 0.14);
          const ca = Math.cos(a), sa = Math.sin(a), ex = x + ca * out, ez = z + sa * out;
          S(G.cylS, this.xf(x + ca * out / 2, y0, z + sa * out / 2, 0, -a, out, ar, ar).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)), col);   // out from the trunk
          S(G.sphS, this.xf(ex, y0, ez, 0, 0, ar, ar, ar), col);                                     // rounded elbow
          S(G.cylS, this.xf(ex, y0 + up / 2, ez, 0, 0, ar, up, ar), col);                            // ...then up
          S(G.sphS, this.xf(ex, y0 + up, ez, 0, 0, ar, ar * 0.95, ar), col);                         // rounded tip
          if (flower && rnd() < 0.6) S(G.sphS, this.xf(ex, y0 + up + ar * 0.8, ez, 0, 0, ar * 0.5, ar * 0.32, ar * 0.5), FLORA.flower);
        }
      } else if (kind < 0.85) {             // dead bush: bare twigs fanning out from the ground
        const n = 5 + Math.floor(rnd() * 4), hb = (0.55 + rnd() * 0.5) * sz;
        for (let k = 0; k < n; k++) {
          const a = rnd() * 6.3, tilt = 0.35 + rnd() * 0.5, len = hb * (0.7 + rnd() * 0.5);
          sc.geom(G.box, this.xf(x + Math.cos(a) * len * 0.25, len * 0.45, z + Math.sin(a) * len * 0.25, tilt, a, 0.05 * sz, len, 0.05 * sz), rnd() < 0.5 ? FLORA.deadwood : FLORA.deadwood2, rnd, 0.1);
        }
      } else {                              // sandy rock
        sc.geom(G.dode, this.xf(x, 0.2, z, rnd(), rnd() * 3, 1.2 * sz, 0.75 * sz, 1.0 * sz), TH.rocks[Math.floor(rnd() * 3)], rnd, 0.1);
      }
      return;
    }
    // snow
    if (kind < 0.55) {                      // pine with snow on every layer
      sc.geom(G.cyl5, this.xf(x, 1.0 * sz - 0.1, z, 0, 0, 0.22 * sz, 2.0 * sz + 0.2, 0.22 * sz), WC.trunk, rnd);
      for (const [y, w, h] of [[3.2, 2.3, 3.6], [5.0, 1.7, 3.0], [6.5, 1.1, 2.2]]) {
        const ry = rnd() * 3;
        sc.geom(G.cone6, this.xf(x, y * sz, z, 0, ry, w * sz, h * sz, w * sz), FLORA.snowPine, rnd, 0.1);
        sc.geom(G.cone6, this.xf(x, (y + h * 0.18) * sz, z, 0, ry, w * 0.86 * sz, h * 0.7 * sz, w * 0.86 * sz), FLORA.snowCap, rnd, 0.04);
      }
    } else if (kind < 0.8) {                // round tree under snow
      sc.geom(G.cyl5, this.xf(x, 1.2 * sz - 0.1, z, 0, 0, 0.25 * sz, 2.4 * sz + 0.2, 0.25 * sz), WC.trunk, rnd);
      sc.geom(G.ico0, this.xf(x, 3.6 * sz, z, rnd(), rnd() * 3, 2.3 * sz, 2.1 * sz, 2.3 * sz), FLORA.snowLeaf, rnd, 0.06);
    } else if (kind < 0.9) {                // snowy bush
      sc.geom(G.ico0, this.xf(x, 0.5 * sz, z, rnd(), rnd() * 3, 1.3 * sz, 0.9 * sz, 1.3 * sz), FLORA.snowLeaf, rnd, 0.06);
    } else {                                // rock with a snow cap
      const c = TH.rocks[Math.floor(rnd() * 3)];
      sc.geom(G.dode, this.xf(x, 0.2, z, rnd(), rnd() * 3, 1.2 * sz, 0.8 * sz, 1.0 * sz), c, rnd, 0.1);
      sc.geom(G.ico0, this.xf(x, 0.2 + 0.55 * sz, z, 0, rnd() * 3, 0.95 * sz, 0.3 * sz, 0.8 * sz), FLORA.snowCap, rnd, 0.04);
    }
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
      const ice = this.th.ice;   // (snowy world: frozen lakes)
      sc.quad(shore[i], shore[j], water[j], water[i], ice ? FLORA.snowLeaf : WC.sand);
      sc.quad(water[i], water[j], deep[j], deep[i], ice ? FLORA.ice : WC.water);
      sc.tri(deep[i], deep[j], c, ice ? FLORA.iceDeep : WC.waterDeep);
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

  reset() { for (const e of this.zones.values()) for (const it of e.items) this.scene.remove(it.mesh); this.zones.clear(); }

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
