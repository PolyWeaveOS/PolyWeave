'use strict';
// =====================================================================
//  Low/mid-poly vehicle generator.
//  Bodies are lofted from cross-sections along the car's length, so cars
//  get real curvature (hood slope, raked glass, tumblehome, wheel arches)
//  instead of boxes. Faces are flat-shaded for the PolyTrack look.
//  Local frame: x = right, y = up, z = -forward (front of car points -z).
// =====================================================================

const SLOT = { PAINT: 0, GLASS: 1, TRIM: 2, CHROME: 3, HEAD: 4, TAIL: 5, RIM: 6, DARK: 7, DRL: 8, CARBON: 9,
  CALIPER: 10, TIRE: 11, AMBER: 12, INT: 13, PLATE: 14, SCREEN: 15, WHITE: 16, METAL: 17, BOX: 18, HEADLENS: 19 };

const MATS = (() => {
  const S = (c, r = 0.6, m = 0, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: r, metalness: m }, extra));
  const m = [];
  m[SLOT.GLASS] = S(0x1d2833, 0.06, 0.7, { envMapIntensity: 1.4 });
  m[SLOT.TRIM] = S(0x1e1f22, 0.8, 0);
  m[SLOT.CHROME] = S(0xd0d4da, 0.18, 0.95);
  m[SLOT.HEAD] = S(0xe6eef6, 0.12, 0.4, { emissive: 0x9aa8b6, emissiveIntensity: 0.55 });
  m[SLOT.TAIL] = S(0x8e0d12, 0.25, 0.2, { emissive: 0x5a0306, emissiveIntensity: 1 });
  m[SLOT.RIM] = S(0xb9bec6, 0.28, 0.85);
  m[SLOT.DARK] = S(0x0d0e11, 0.55, 0.2);
  m[SLOT.DRL] = S(0xffe8a0, 0.3, 0, { emissive: 0xffcf3a, emissiveIntensity: 1.5 });
  m[SLOT.CARBON] = S(0x17191c, 0.32, 0.35);
  m[SLOT.CALIPER] = S(0xc8161d, 0.4, 0.2);
  m[SLOT.TIRE] = S(0x1a1a1c, 0.92, 0);
  m[SLOT.AMBER] = S(0xc8801c, 0.3, 0.1, { emissive: 0x3a1d00 });
  m[SLOT.INT] = S(0x2a2b2f, 0.85, 0);
  m[SLOT.PLATE] = S(0xeceff2, 0.5, 0);
  m[SLOT.SCREEN] = S(0x0a1622, 0.2, 0, { emissive: 0x1b4f7a, emissiveIntensity: 0.7 });
  m[SLOT.WHITE] = S(0xeff1f3, 0.55, 0.05);
  m[SLOT.METAL] = S(0x8f959d, 0.45, 0.6);
  m[SLOT.BOX] = S(0xdfe3e7, 0.6, 0.05);
  m[SLOT.HEADLENS] = S(0xe8f0f6, 0.04, 0.3, { transparent: true, opacity: 0.22, envMapIntensity: 1.6, depthWrite: false }); // clear headlight cover
  return m;
})();
// Lit lamp overlays sit on top of the unlit lenses: polygon offset makes them always win the
// depth test, so blinkers / brake lights never flicker (z-fight) against the lens underneath.
const OVERLAY = {
  brake: new THREE.MeshBasicMaterial({ color: 0xff2a22, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }),
  ind: new THREE.MeshBasicMaterial({ color: 0xffa21a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }),
};

const _paints = new Map();
function paintMat(hex) {
  if (!_paints.has(hex)) _paints.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.32, metalness: 0.45 }));
  return _paints.get(hex);
}
function matsWith(paint, overrides) {
  const a = MATS.slice(); a[SLOT.PAINT] = paint;
  if (overrides) for (const k in overrides) a[k] = overrides[k];
  return a;
}

// ---------- Geometry builder: triangles bucketed by material slot ----------
const _box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
class GB {
  constructor() { this.slots = {}; }
  arr(slot) { return this.slots[slot] || (this.slots[slot] = []); }
  tri(a, b, c, slot) { this.arr(slot).push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
  quad(a, b, c, d, slot) { this.tri(a, b, c, slot); this.tri(a, c, d, slot); }
  geom(g, m, slot) {
    const ng = g.index ? g.toNonIndexed() : g, p = ng.attributes.position, arr = this.arr(slot);
    for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).applyMatrix4(m); arr.push(_v.x, _v.y, _v.z); }
  }
  xf(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return _m4.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
  }
  box(x, y, z, sx, sy, sz, slot, rx = 0, ry = 0, rz = 0) { this.geom(_box, this.xf(x, y, z, rx, ry, rz, sx, sy, sz), slot); }
  // mirrored pair across x
  box2(x, y, z, sx, sy, sz, slot, rx = 0, ry = 0, rz = 0) { this.box(x, y, z, sx, sy, sz, slot, rx, ry, rz); this.box(-x, y, z, sx, sy, sz, slot, rx, -ry, -rz); }
  cyl(x, y, z, r1, r2, h, seg, slot, rx = 0, ry = 0, rz = 0) {
    this.geom(new THREE.CylinderGeometry(r1, r2, h, seg), this.xf(x, y, z, rx, ry, rz), slot);
  }
  build() {
    const keys = Object.keys(this.slots).map(Number).sort((a, b) => a - b);
    let n = 0; for (const k of keys) n += this.slots[k].length;
    const pos = new Float32Array(n), g = new THREE.BufferGeometry();
    let off = 0;
    for (const k of keys) { const a = this.slots[k]; pos.set(a, off); g.addGroup(off / 3, a.length / 3, k); off += a.length; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals(); // non-indexed => flat face normals
    g.computeBoundingSphere();
    return g;
  }
}

// Monotone cubic interpolation through keyframes [[x,y],...] (no overshoot, smooth curves)
function mcurve(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0]);
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  if (n === 1) return () => ys[0];
  const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const inRanges = (r, f) => r.some(([a, b]) => f >= Math.min(a, b) && f <= Math.max(a, b));

// ---------- Body loft ----------
// spec: L, W (half width), r (wheel radius), axles [f..], key curves top/belt/bot/low/hw/roofIn, glass ranges gTop/gSide
function loftBody(gb, sp, off = 0) {
  const h = sp.L / 2;
  const F = { top: mcurve(sp.top), belt: mcurve(sp.belt), bot: mcurve(sp.bot), low: mcurve(sp.low), hw: mcurve(sp.hw), ri: mcurve(sp.roofIn) };
  const AR = sp.r + 0.075, wy = sp.r;
  let st = [];
  const n = Math.ceil(sp.L / 0.17);
  for (let i = 0; i <= n; i++) st.push(-h + sp.L * i / n);
  for (const fw of sp.axles) for (const k of [-1.02, -0.93, -0.78, -0.55, -0.28, 0, 0.28, 0.55, 0.78, 0.93, 1.02]) st.push(fw + k * AR);
  for (const k of (sp.extraSt || [])) st.push(k);
  st = st.filter(f => f >= -h && f <= h).sort((a, b) => a - b);
  const S = [];
  for (const f of st) if (!S.length || f - S[S.length - 1] > 0.03) S.push(f);
  S[0] = -h; S[S.length - 1] = h;

  const ce = sp.crown ?? 0.06;
  const prof = f => {
    const W = sp.W * F.hw(f), yb = F.bot(f), yt = F.top(f);
    const ybl = Math.min(F.belt(f), yt - 0.015);
    let yl = F.low(f);
    for (const fw of sp.axles) { const dz = Math.abs(f - fw); if (dz < AR) yl = Math.max(yl, wy + Math.sqrt(AR * AR - dz * dz) * 0.97); }
    yl = Math.min(yl, ybl - 0.05);
    const ym = yl + (ybl - yl) * (sp.midK ?? 0.42);
    const ri = F.ri(f);
    const y5 = Math.max(yt - ce, ybl + 0.01);
    const y6 = Math.max(y5 + 0.004, yt - ce * 0.62);
    return [[0, yb], [W * 0.86, yb], [W * 0.975, yl], [W, ym], [W * (sp.shoulder ?? 0.965), ybl], [W * ri, y5], [W * ri * 0.9, y6], [W * ri * 0.5, yt - ce * 0.2], [0, yt]];
  };
  const R = S.map(prof);
  for (let i = 0; i < S.length - 1; i++) {
    const fm = (S[i] + S[i + 1]) / 2;
    let side = inRanges(sp.gSide, fm) ? SLOT.GLASS : SLOT.PAINT;
    if (side === SLOT.GLASS && sp.bPillar && inRanges(sp.bPillar, fm)) side = SLOT.TRIM; // black B-pillar between the doors
    let top = inRanges(sp.gTop, fm) ? SLOT.GLASS : SLOT.PAINT;
    if (top === SLOT.PAINT && sp.roofSlot != null && inRanges(sp.roofRange, fm)) top = sp.roofSlot;
    const pillar = top === SLOT.GLASS ? (sp.pillarSlot ?? SLOT.PAINT) : top;
    const sl = [SLOT.TRIM, sp.lowerSlot ?? SLOT.TRIM, SLOT.PAINT, SLOT.PAINT, side, pillar, top, top];
    const a = R[i], b = R[i + 1], z0 = -(S[i] + off), z1 = -(S[i + 1] + off);
    for (let k = 0; k < 8; k++) {
      for (const sg of [1, -1]) {
        const p = [sg * a[k][0], a[k][1], z0], q = [sg * a[k + 1][0], a[k + 1][1], z0];
        const r = [sg * b[k + 1][0], b[k + 1][1], z1], t = [sg * b[k][0], b[k][1], z1];
        if (sg > 0) gb.quad(p, t, r, q, sl[k]); else gb.quad(p, q, r, t, sl[k]);
      }
    }
  }
  const cap = (ring, z, slot, flip) => {
    const pts = [];
    for (let k = 0; k <= 8; k++) pts.push([ring[k][0], ring[k][1], z]);
    for (let k = 7; k >= 1; k--) pts.push([-ring[k][0], ring[k][1], z]);
    let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; }
    const c = [cx / pts.length, cy / pts.length, z];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (flip) gb.tri(c, b, a, slot); else gb.tri(c, a, b, slot);
    }
  };
  cap(R[0], -(S[0] + off), sp.rearCap ?? SLOT.PAINT, false);
  cap(R[R.length - 1], -(S[S.length - 1] + off), sp.frontCap ?? SLOT.PAINT, true);
  return F;
}

// ---------- Wheels ----------
function wheelGeometry(r, w, style) {
  const gb = new GB();
  // tire: lathe for rounded shoulders, axis along x
  const pr = [[r * 0.70, -w / 2], [r * 0.92, -w / 2], [r * 0.985, -w / 2 + 0.03], [r, -w / 2 + 0.06], [r, w / 2 - 0.06], [r * 0.985, w / 2 - 0.03], [r * 0.92, w / 2], [r * 0.70, w / 2]];
  const lathe = new THREE.LatheGeometry(pr.map(p => new THREE.Vector2(p[0], p[1])), 20);
  gb.geom(lathe, gb.xf(0, 0, 0, 0, 0, -Math.PI / 2), SLOT.TIRE);
  const rr = r * 0.70, ox = w / 2;
  if (style === 'm4') {
    gb.geom(new THREE.CylinderGeometry(rr, rr, 0.05, 20, 1, true), gb.xf(ox - 0.03, 0, 0, 0, 0, Math.PI / 2), SLOT.RIM);
    gb.cyl(ox - 0.11, 0, 0, rr * 0.98, rr * 0.98, 0.01, 20, SLOT.DARK, 0, 0, Math.PI / 2);
    for (let i = 0; i < 10; i++) { // forged Y-spokes
      const a = i / 10 * Math.PI * 2, len = rr * 0.86;
      gb.box(ox - 0.035, Math.cos(a) * len / 2, Math.sin(a) * len / 2, 0.04, len, i % 2 ? 0.03 : 0.045, SLOT.RIM, a, 0, 0);
    }
    gb.cyl(ox - 0.03, 0, 0, 0.075, 0.075, 0.05, 10, SLOT.RIM, 0, 0, Math.PI / 2);
    gb.cyl(ox - 0.005, 0, 0, 0.035, 0.035, 0.01, 8, SLOT.DARK, 0, 0, Math.PI / 2);
  } else if (style === 'truck') {
    gb.cyl(ox - 0.04, 0, 0, rr, rr * 0.9, 0.06, 14, SLOT.METAL, 0, 0, Math.PI / 2);
    gb.cyl(ox - 0.01, 0, 0, rr * 0.38, rr * 0.38, 0.04, 10, SLOT.CHROME, 0, 0, Math.PI / 2);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; gb.cyl(ox, Math.cos(a) * rr * 0.55, Math.sin(a) * rr * 0.55, 0.02, 0.02, 0.02, 5, SLOT.DARK, 0, 0, Math.PI / 2); }
  } else if (style === 'steel') {
    // hubcap style: dished silver cover with vents
    gb.cyl(ox - 0.09, 0, 0, rr, rr, 0.02, 18, SLOT.DARK, 0, 0, Math.PI / 2);
    gb.geom(new THREE.CylinderGeometry(rr, rr, 0.05, 18, 1, true), gb.xf(ox - 0.035, 0, 0, 0, 0, Math.PI / 2), SLOT.RIM);
    gb.cyl(ox - 0.03, 0, 0, rr * 0.93, rr * 0.85, 0.03, 18, SLOT.RIM, 0, 0, Math.PI / 2);
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; gb.box(ox - 0.01, Math.cos(a) * rr * 0.6, Math.sin(a) * rr * 0.6, 0.012, rr * 0.28, 0.05, SLOT.DARK, a, 0, 0); }
    gb.cyl(ox - 0.005, 0, 0, rr * 0.25, rr * 0.25, 0.02, 12, SLOT.CHROME, 0, 0, Math.PI / 2);
  } else {
    // alloy: deep dark barrel, polished lip, 5 split (twin) spokes, centre cap, lug nuts
    gb.cyl(ox - 0.1, 0, 0, rr * 0.98, rr * 0.98, 0.01, 18, SLOT.DARK, 0, 0, Math.PI / 2);
    gb.geom(new THREE.CylinderGeometry(rr, rr, 0.06, 20, 1, true), gb.xf(ox - 0.04, 0, 0, 0, 0, Math.PI / 2), SLOT.DARK);
    gb.geom(new THREE.TorusGeometry(rr * 0.98, 0.012, 4, 20), gb.xf(ox - 0.012, 0, 0, 0, Math.PI / 2, 0), SLOT.CHROME);
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
      const a = i / 5 * Math.PI * 2 + s * 0.11, len = rr * 0.86;
      gb.box(ox - 0.03 - (s > 0 ? 0.004 : 0), Math.cos(a) * len / 2, Math.sin(a) * len / 2, 0.035, len, 0.035, SLOT.RIM, a, 0, 0);
    }
    gb.cyl(ox - 0.03, 0, 0, rr * 0.3, rr * 0.3, 0.05, 10, SLOT.RIM, 0, 0, Math.PI / 2);
    gb.cyl(ox - 0.002, 0, 0, rr * 0.15, rr * 0.15, 0.012, 10, SLOT.DARK, 0, 0, Math.PI / 2);
    for (let i = 0; i < 5; i++) { const a = (i + 0.5) / 5 * Math.PI * 2; gb.cyl(ox - 0.001, Math.cos(a) * rr * 0.21, Math.sin(a) * rr * 0.21, 0.012, 0.012, 0.014, 6, SLOT.CHROME, 0, 0, Math.PI / 2); }
  }
  return gb.build();
}

// ---------- Generic everyday-car spec generator ----------
function genSpec(o) {
  const h = o.L / 2, s = { L: o.L, W: o.W, r: o.r, axles: [o.axF, o.axR], crown: o.crown ?? 0.06, style: o.style };
  const top = [[h, o.noseH], [h - 0.10, o.noseH + 0.05], [h - 0.45, o.noseH + (o.hoodH - o.noseH) * 0.62], [o.cowl, o.hoodH], [o.roofF, o.H], [(o.roofF + o.roofR) / 2, o.H + 0.012], [o.roofR, o.H - 0.012]];
  if (o.style === 'sedan') top.push([o.deckF, o.deckH], [-h + 0.14, o.deckH + 0.02], [-h, o.deckH - 0.10]);
  else if (o.style === 'van') top.push([-h + 0.05, o.H - 0.06], [-h, o.H - 0.14]);
  else top.push([-h + 0.07, o.tailTop], [-h, o.tailTop - 0.12]);
  s.top = o.topKeys || top;
  s.belt = o.beltKeys || [[h, o.noseH - 0.05], [h - 0.4, o.beltF - 0.05], [o.cowl, o.beltF], [-h + 0.35, o.beltR], [-h, o.beltR - 0.1]];
  s.bot = [[h, o.clr + 0.10], [h - 0.35, o.clr], [-h + 0.35, o.clr], [-h, o.clr + 0.12]];
  const lw = o.lowerH ?? o.clr + 0.12;
  s.low = [[h, lw + 0.03], [0, lw], [-h, lw + 0.04]];
  s.hw = [[h, 0.82], [h - 0.08, 0.92], [h - 0.35, 0.985], [h - 0.9, 1], [-h + 0.6, 1], [-h + 0.2, 0.975], [-h + 0.05, 0.93], [-h, 0.88]];
  const t = o.tumble;
  s.roofIn = o.riKeys || (o.style === 'sedan'
    ? [[h, 0.84], [o.cowl + 0.1, 0.86], [o.roofF, t], [o.roofR, t], [o.deckF, 0.86], [-h, 0.85]]
    : [[h, 0.84], [o.cowl + 0.1, 0.86], [o.roofF, t], [o.roofR, t], [-h, t + 0.03]]);
  s.gTop = [[o.cowl - 0.02, o.roofF + 0.03]];
  if (o.style === 'sedan') s.gTop.push([o.roofR - 0.03, o.deckF + 0.03]);
  else if (o.style === 'hatch' || o.style === 'suv') s.gTop.push([o.roofR - 0.03, -h + 0.13]);
  if (o.gTopExtra) s.gTop.push(...o.gTopExtra);
  s.gSide = o.gSide || [[o.sideR ?? o.roofR + 0.12, o.cowl - 0.05]];
  // B-pillar between front and rear doors (4-door cars); extra loft stations keep it crisp
  if (o.bp !== undefined) { s.bPillar = [[o.bp - 0.065, o.bp + 0.065]]; s.extraSt = [o.bp - 0.065, o.bp + 0.065]; }
  s.pillarSlot = o.pillarSlot;
  s.lowerSlot = o.lowerSlot;
  s.o = o;
  return s;
}

// lights, grille, mirrors, plates for everyday vehicles
function addCarDetails(gb, sp, F, ov) {
  const o = sp.o, h = sp.L / 2, W = sp.W;
  const fy = o.lampFY ?? o.noseH - 0.07, ry = o.lampRY;
  const lh = o.lampH ?? 0.11, th = o.tailH ?? 0.13;
  const halfW = f => W * F.hw(f);                       // body half-width at f
  const truckish = o.style === 'pickup' || o.style === 'van';

  // ---- headlights: dark housing, two projector lenses, LED daytime strip ----
  gb.box2(W * 0.64, fy, -(h - 0.065), W * 0.44, lh + 0.03, 0.15, SLOT.DARK, 0, -0.32, 0);
  gb.box2(W * 0.73, fy - 0.005, -(h - 0.03), W * 0.15, lh * 0.72, 0.12, SLOT.HEAD, 0, -0.32, 0);
  gb.box2(W * 0.55, fy - 0.005, -(h - 0.005), W * 0.13, lh * 0.62, 0.12, SLOT.HEAD, 0, -0.32, 0);
  gb.box2(W * 0.63, fy + lh * 0.5, -(h - 0.03), W * 0.42, 0.02, 0.13, SLOT.HEAD, 0, -0.32, 0);
  // ---- grille: chrome surround, dark mesh, horizontal bars, badge ----
  const gy = fy - 0.03 - (o.grilleDrop ?? 0.12), gw = W * (o.grilleW ?? 0.8), gh = o.grilleH ?? 0.18;
  gb.box(0, gy, -(h - 0.025), gw + 0.05, gh + 0.05, 0.05, truckish ? SLOT.CHROME : SLOT.TRIM);
  gb.box(0, gy, -(h + 0.005), gw, gh, 0.04, SLOT.DARK);
  for (let i = -1; i <= 1; i++) gb.box(0, gy + i * gh * 0.3, -(h + 0.02), gw * 0.96, 0.018, 0.02, truckish ? SLOT.CHROME : SLOT.TRIM);
  gb.box(0, gy, -(h + 0.04), 0.1, 0.06, 0.02, SLOT.CHROME);
  // ---- front bumper: lower intake, fog lamps, splitter lip ----
  gb.box(0, o.clr + 0.17, -(h - 0.01), W * 1.05, 0.1, 0.06, SLOT.TRIM);
  gb.box(0, o.clr + 0.17, -(h + 0.025), W * 0.7, 0.07, 0.02, SLOT.DARK);
  gb.box2(W * 0.72, o.clr + 0.19, -(h - 0.02), 0.13, 0.05, 0.06, SLOT.HEAD, 0, -0.3, 0);
  gb.box(0, o.clr + 0.07, -(h - 0.06), W * 1.5, 0.03, 0.14, SLOT.TRIM);
  // ---- tail lights: red outer lens, darker inner, white reverse lamp ----
  gb.box2(W * 0.66, ry, h - 0.06, W * 0.46, th, 0.14, SLOT.TAIL, 0, 0.3, 0);
  gb.box2(W * 0.60, ry - th * 0.12, h - 0.03, W * 0.22, th * 0.45, 0.13, SLOT.DARK, 0, 0.3, 0);
  gb.box2(W * 0.48, ry - th * 0.12, h - 0.0, W * 0.07, th * 0.4, 0.12, SLOT.WHITE, 0, 0.3, 0);
  // ---- rear: plate + recess, bumper, reflectors, diffuser, exhaust ----
  const py = o.plateY ?? (o.clr + 0.42);
  gb.box(0, py, h - 0.005, 0.6, 0.18, 0.04, SLOT.TRIM);
  gb.box(0, py, h + 0.02, 0.52, 0.12, 0.02, SLOT.PLATE);
  gb.box(0, o.clr + 0.12, h - 0.02, W * 1.6, 0.12, 0.06, SLOT.TRIM);
  gb.box2(W * 0.82, o.clr + 0.2, h + 0.015, 0.14, 0.03, 0.02, SLOT.TAIL);
  if (!truckish) gb.cyl(-W * 0.55, o.clr + 0.1, h + 0.0, 0.035, 0.035, 0.14, 8, SLOT.CHROME, Math.PI / 2);
  // ---- doors: seams, handles; B-pillar comes from the loft ----
  const doorFront = o.cowl - 0.04, doorRear = o.doorRear ?? (o.roofR + 0.1);
  const seams = o.bp !== undefined ? [doorFront, o.bp, doorRear] : [doorFront, doorRear];
  for (const f of seams) {
    const w = halfW(f), y0 = Math.max(F.low(f), o.clr + 0.25) + 0.06, y1 = Math.min(F.belt(f), F.top(f) - 0.02) - 0.02;
    if (y1 > y0) gb.box2(w * 0.998, (y0 + y1) / 2, -f, 0.014, y1 - y0, 0.012, SLOT.DARK);
  }
  for (const f of (o.bp !== undefined ? [o.bp + 0.32, doorRear + 0.32] : [doorRear + 0.35])) {
    const w = halfW(f), y = F.belt(f) - 0.09;
    gb.box2(w * 1.0, y, -f, 0.025, 0.03, 0.15, SLOT.CHROME);
  }
  // ---- side skirts between the wheels ----
  const [aF, aR] = sp.axles, skirtL = (aF - aR) - 2 * (sp.r + 0.12);
  if (skirtL > 0.3) gb.box2(halfW((aF + aR) / 2) * 0.955, o.clr + 0.07, -(aF + aR) / 2, 0.05, 0.12, skirtL, SLOT.TRIM);
  // ---- mirrors: black stalk, body-coloured head, dark glass ----
  const mf = o.cowl - 0.12, my = o.beltF + 0.08, mw = halfW(mf);
  gb.box2(mw + 0.04, my - 0.03, -mf + 0.02, 0.1, 0.035, 0.06, SLOT.TRIM);
  gb.box2(mw + 0.11, my, -mf, 0.17, 0.12, 0.09, o.mirrorSlot ?? SLOT.PAINT, 0, 0.12, 0);
  gb.box2(mw + 0.11, my, -mf + 0.046, 0.14, 0.09, 0.005, SLOT.DARK, 0, 0.12, 0);
  // ---- roof antenna fin ----
  if (!truckish) { const fa = (o.roofR ?? -1) + 0.15; gb.box(0, F.top(fa) + 0.035, -fa, 0.04, 0.06, 0.16, SLOT.TRIM, -0.15, 0, 0); }
  // ---- amber indicators (unlit lens) + lit overlays that stand slightly proud of them ----
  const fw = W * 0.87, rw = W * 0.89;
  gb.box2(fw, fy, -(h - 0.12), 0.1, 0.06, 0.1, SLOT.AMBER, 0, -0.5, 0);
  gb.box2(rw, ry - th * 0.62, h - 0.1, 0.1, 0.05, 0.1, SLOT.AMBER, 0, 0.5, 0);
  gb.box2(mw + 0.11, my - 0.045, -mf - 0.02, 0.12, 0.02, 0.05, SLOT.AMBER, 0, 0.12, 0); // mirror repeater
  ov.ind.push([fw + 0.012, fy, -(h - 0.12), 0.115, 0.072, 0.115, -0.5], [rw + 0.012, ry - th * 0.62, h - 0.1, 0.115, 0.062, 0.115, 0.5],
    [mw + 0.112, my - 0.046, -mf - 0.022, 0.125, 0.026, 0.055, 0.12]);
  ov.brake.push([W * 0.66, ry, h - 0.05, W * 0.47, th + 0.012, 0.15, 0.3]);
  ov.third = [0, o.thirdY ?? (F.top(-h + 0.3) + 0.01), h - 0.3, 0.4, 0.04, 0.05];
}

// ---------- Overlay meshes (brake lights / indicators) ----------
function overlayGeom(boxes, sideSign) {
  const gb = new GB();
  for (const b of boxes) {
    const [x, y, z, sx, sy, sz, ry = 0] = b;
    if (sideSign === 0) { gb.box(x, y, z, sx, sy, sz, 0, 0, ry, 0); if (x !== 0) gb.box(-x, y, z, sx, sy, sz, 0, 0, -ry, 0); }
    else gb.box(sideSign * x, y, z, sx, sy, sz, 0, 0, sideSign * ry, 0);
  }
  return gb.build();
}

// ---------- Catalog ----------
const CATALOG = {};
const _geoCache = {};
// Traffic vehicles in js/vehicles/*.js register here: { key, name, cls: 'car'|'suv'|'pickup'|'van'|'truck'|'bus',
// w (how common), mass (kg), amax (m/s^2), vmin/vmax (km/h), truck (keeps right), paint: 'car'|'truck'|[hex...] }
const TRAFFIC_VEHICLES = [];
function registerVehicle(meta, build) { CATALOG[meta.key] = build; TRAFFIC_VEHICLES.push(meta); }

function defineGeneric(key, o, wheelStyle = 'alloy') {
  CATALOG[key] = () => {
    const sp = genSpec(o), gb = new GB(), ov = { ind: [], brake: [] };
    const F = loftBody(gb, sp);
    addCarDetails(gb, sp, F, ov);
    if (o.extras) o.extras(gb, sp, F, ov);
    // brake discs (static)
    const tx = sp.W - (o.tw ?? 0.24) / 2 - 0.02;
    for (const f of sp.axles) for (const sg of [1, -1]) gb.cyl(sg * (tx - 0.06), sp.r, -f, sp.r * 0.58, sp.r * 0.58, 0.03, 12, SLOT.METAL, 0, 0, Math.PI / 2);
    return {
      key, body: gb.build(), wheel: wheelGeometry(sp.r, o.tw ?? 0.24, wheelStyle),
      wheels: sp.axles.flatMap(f => [{ x: tx, f, side: 1, front: f > 0 }, { x: -tx, f, side: -1, front: f > 0 }]),
      r: sp.r, L: sp.L, W: sp.W, front: sp.L / 2, rear: -sp.L / 2,
      indL: overlayGeom(ov.ind, -1), indR: overlayGeom(ov.ind, 1),
      brake: overlayGeom(ov.third ? [...ov.brake, ov.third] : ov.brake, 0),
      hull: SAT.hull(sp.W + 0.01, sp.L / 2, -sp.L / 2, o.chamfer ?? 0.32, o.chamferR ?? 0.22),
    };
  };
}

// Everyday sedan (Camry / Accord class)
defineGeneric('sedan', { style: 'sedan', L: 4.86, W: 0.915, H: 1.46, noseH: 0.74, hoodH: 0.99, cowl: 0.95, roofF: 0.12, roofR: -0.82, deckF: -1.62, deckH: 1.06,
  clr: 0.15, axF: 1.43, axR: -1.40, r: 0.33, beltF: 0.96, beltR: 1.02, tumble: 0.79, lampRY: 0.90, plateY: 0.62, pillarSlot: SLOT.TRIM,
  bp: 0.05, doorRear: -0.95 });
// Hatchback (Golf / Civic class)
defineGeneric('hatch', { style: 'hatch', L: 4.30, W: 0.895, H: 1.47, noseH: 0.70, hoodH: 0.95, cowl: 0.82, roofF: -0.02, roofR: -1.52, tailTop: 1.13,
  clr: 0.14, axF: 1.33, axR: -1.30, r: 0.32, beltF: 0.92, beltR: 1.0, tumble: 0.76, lampRY: 0.93, plateY: 0.55, pillarSlot: SLOT.TRIM,
  bp: -0.25, doorRear: -0.88 });
// Compact SUV (RAV4 / CR-V class) with black lower cladding
defineGeneric('suv', { style: 'suv', L: 4.62, W: 0.93, H: 1.70, noseH: 0.90, hoodH: 1.13, cowl: 0.98, roofF: 0.20, roofR: -1.86, tailTop: 1.42,
  clr: 0.21, axF: 1.38, axR: -1.32, r: 0.37, beltF: 1.10, beltR: 1.17, tumble: 0.80, lowerH: 0.50, lampRY: 1.08, plateY: 0.72, pillarSlot: SLOT.TRIM,
  grilleH: 0.24, tw: 0.25, bp: -0.3, doorRear: -0.84,
  extras(gb, sp) {
    gb.box2(sp.W * 0.62, 1.715, 0.1, 0.05, 0.05, 2.2, SLOT.TRIM);                       // roof rails
    for (const f of [0.95, -1.05]) gb.box2(sp.W * 0.62, 1.69, -f, 0.06, 0.05, 0.1, SLOT.TRIM); // rail feet
    for (const f of [1.38, -1.32]) gb.box2(sp.W * 0.97, 0.66, -f, 0.06, 0.08, 0.95, SLOT.TRIM); // arch flares
  } });
// Pickup (F-150 class) with tonneau-covered bed
defineGeneric('pickup', { style: 'pickup', L: 5.85, W: 1.0, H: 1.93, noseH: 1.02, hoodH: 1.32, cowl: 1.12, roofF: 0.42, roofR: -0.72,
  clr: 0.26, axF: 1.80, axR: -1.85, r: 0.41, beltF: 1.28, beltR: 1.30, tumble: 0.86, lowerH: 0.56, lampRY: 1.10, plateY: 0.60, lampH: 0.16,
  grilleH: 0.34, grilleW: 0.9, grilleDrop: 0.17, tw: 0.27, pillarSlot: SLOT.TRIM, crown: 0.05, chamfer: 0.3, chamferR: 0.12,
  topKeys: [[2.925, 1.02], [2.83, 1.10], [2.45, 1.26], [1.12, 1.32], [0.42, 1.93], [-0.15, 1.945], [-0.72, 1.92], [-0.80, 1.86], [-0.87, 1.34], [-2.86, 1.34], [-2.925, 1.24]],
  beltKeys: [[2.925, 0.98], [2.4, 1.24], [1.12, 1.28], [-2.6, 1.30], [-2.925, 1.22]],
  riKeys: [[2.925, 0.88], [1.2, 0.9], [0.42, 0.86], [-0.80, 0.86], [-0.87, 0.97], [-2.925, 0.97]],
  gTopExtra: [[-0.87, -0.76]], gSide: [[-0.68, 1.07]], bp: 0.2, doorRear: -0.72,
  extras(gb, sp) {
    gb.box(0, 1.345, 1.88, sp.W * 1.86, 0.015, 3.85, SLOT.TRIM);                // bed cover
    gb.box(0, 0.62, 2.95, sp.W * 2.0, 0.16, 0.12, SLOT.CHROME);                 // rear bumper
    gb.box(0, 0.62, -2.95, sp.W * 2.0, 0.2, 0.12, SLOT.CHROME);                 // front bumper
  } }, 'steel');
// Panel van (Transit class)
defineGeneric('van', { style: 'van', L: 5.55, W: 1.0, H: 2.45, noseH: 0.98, hoodH: 1.28, cowl: 1.86, roofF: 1.12, roofR: -2.70,
  clr: 0.18, axF: 1.95, axR: -1.62, r: 0.36, beltF: 1.32, beltR: 1.40, tumble: 0.93, lampRY: 1.15, plateY: 0.55, crown: 0.09, lampH: 0.15,
  gSide: [[0.62, 1.80]], pillarSlot: SLOT.TRIM, grilleH: 0.22, chamferR: 0.12, mirrorSlot: SLOT.TRIM, tw: 0.24, doorRear: 0.6,
  extras(gb, sp) { gb.box2(sp.W - 0.01, 1.1, 0.8, 0.02, 0.04, 2.6, SLOT.TRIM); } }, 'steel');

// --------- Box truck: van-style cab + cargo box ---------
CATALOG.box = () => {
  const L = 7.6, h = L / 2, gb = new GB(), ov = { ind: [], brake: [] };
  const cabL = 2.5, cabOff = h - cabL / 2; // cab centre f
  const cab = genSpec({ style: 'van', L: cabL, W: 1.06, H: 2.65, noseH: 1.10, hoodH: 1.42, cowl: 0.82, roofF: 0.28, roofR: -1.2, clr: 0.36,
    axF: 0.32, axR: -50, r: 0.47, beltF: 1.5, beltR: 1.55, tumble: 0.95, crown: 0.07, sideR: -0.55, pillarSlot: SLOT.TRIM });
  loftBody(gb, cab, cabOff);
  gb.box(0, 2.0, -(-1.4), 2.44, 2.9, 4.9, SLOT.BOX);              // cargo box (f from 1.05 to -3.85)
  gb.box(0, 0.62, -(-1.0), 1.3, 0.22, 6.4, SLOT.TRIM);               // chassis rails
  gb.box(0, 0.52, -(-3.78), 2.3, 0.14, 0.1, SLOT.METAL);             // rear bumper
  gb.box2(1.13, 0.85, -(-2.5), 0.12, 0.08, 1.6, SLOT.TRIM);          // rear fenders
  const fy = 1.02;
  gb.box2(0.72, fy, -(h - 0.05), 0.4, 0.14, 0.12, SLOT.HEAD);
  gb.box(0, fy - 0.1, -(h - 0.02), 1.3, 0.22, 0.06, SLOT.DARK);
  gb.box(0, 0.6, -(h - 0.02), 2.2, 0.22, 0.1, SLOT.TRIM);
  gb.box2(1.15, 1.75, -(h - 0.9), 0.08, 0.32, 0.18, SLOT.TRIM);     // mirrors
  gb.box2(0.98, 0.78, 3.86, 0.18, 0.3, 0.04, SLOT.TAIL);
  gb.box(0, 0.62, 3.87, 0.52, 0.12, 0.02, SLOT.PLATE);
  gb.box2(1.0, fy, -(h - 0.15), 0.12, 0.08, 0.12, SLOT.AMBER);
  ov.ind.push([1.005, fy, -(h - 0.15), 0.13, 0.09, 0.13], [0.98, 1.0, 3.875, 0.18, 0.1, 0.04]);
  ov.brake.push([0.98, 0.78, 3.88, 0.19, 0.31, 0.04]);
  const wheels = [{ x: 0.86, f: cabOff + 0.32, side: 1, front: true }, { x: -0.86, f: cabOff + 0.32, side: -1, front: true },
    { x: 0.92, f: -2.5, side: 1 }, { x: -0.92, f: -2.5, side: -1 }, { x: 0.62, f: -2.5, side: 1 }, { x: -0.62, f: -2.5, side: -1 }];
  return { key: 'box', body: gb.build(), wheel: wheelGeometry(0.47, 0.26, 'truck'), wheels, r: 0.47, L, W: 1.22, front: h, rear: -h,
    indL: overlayGeom(ov.ind, -1), indR: overlayGeom(ov.ind, 1), brake: overlayGeom(ov.brake, 0), hull: SAT.hull(1.23, h, -h, 0.25, 0.05) };
};

// --------- Semi truck: cab-over tractor + 13.6 m trailer ---------
CATALOG.semi = () => {
  const gb = new GB(), ov = { ind: [], brake: [] };
  const front = 8.3, cabL = 2.4, cabC = front - cabL / 2;
  const cab = genSpec({ style: 'van', L: cabL, W: 1.24, H: 3.75, noseH: 1.45, hoodH: 1.85, cowl: 1.02, roofF: 0.75, roofR: -1.15, clr: 0.5,
    axF: -50, axR: -50, r: 0.52, beltF: 1.95, beltR: 2.0, tumble: 0.95, crown: 0.12, sideR: -0.2, pillarSlot: SLOT.TRIM, lowerH: 0.95 });
  loftBody(gb, cab, cabC);
  gb.box(0, 0.85, -(front - 0.08), 2.4, 0.5, 0.18, SLOT.TRIM);              // bumper
  gb.box(0, 1.5, -(front - 0.02), 1.6, 0.6, 0.05, SLOT.DARK);                // grille
  gb.box2(0.95, 1.05, -(front - 0.06), 0.4, 0.16, 0.1, SLOT.HEAD);
  gb.box2(1.38, 2.35, -(front - 0.5), 0.08, 0.5, 0.22, SLOT.TRIM);         // mirrors
  gb.box(0, 0.75, -3.6, 1.1, 0.3, 7.2, SLOT.TRIM);                         // tractor chassis
  gb.box2(0.9, 0.9, -(front - 2.9), 0.5, 0.5, 1.2, SLOT.CHROME);           // fuel tanks
  gb.box(0, 2.65, -(front - 2.65), 2.3, 2.3, 0.6, SLOT.TRIM);              // cab back / fairing gap
  const tF = front - 3.25, tL = 13.6, tC = tF - tL / 2;
  gb.box(0, 2.62, -tC, 2.55, 2.75, tL, SLOT.BOX);                          // trailer
  gb.box(0, 1.15, -tC, 2.3, 0.18, tL - 0.4, SLOT.TRIM);                     // trailer frame
  gb.box2(1.0, 0.75, -(tC - 4.4), 0.15, 0.08, 3.8, SLOT.TRIM);            // fenders
  gb.box(0, 0.62, -(tF - tL + 0.05), 2.3, 0.12, 0.1, SLOT.METAL);          // underride bar
  const re = tF - tL;
  gb.box2(1.05, 1.0, -(re - 0.0), 0.22, 0.14, 0.04, SLOT.TAIL);
  gb.box(0, 0.98, -(re - 0.0), 0.52, 0.12, 0.03, SLOT.PLATE);
  gb.box2(1.18, 1.05, -(front - 0.15), 0.08, 0.1, 0.1, SLOT.AMBER);
  ov.ind.push([1.185, 1.05, -(front - 0.15), 0.09, 0.11, 0.11], [1.05, 1.18, -(re - 0.005), 0.22, 0.1, 0.04]);
  ov.brake.push([1.05, 1.0, -(re - 0.01), 0.23, 0.15, 0.04]);
  const axl = [[front - 1.0, 'f'], [front - 4.3, 'd'], [front - 5.6, 'd'], [tF - 9.9, 't'], [tF - 11.2, 't'], [tF - 12.5, 't']];
  const wheels = [];
  for (const [f, t] of axl) {
    wheels.push({ x: 1.0, f, side: 1, front: t === 'f' }, { x: -1.0, f, side: -1, front: t === 'f' });
    if (t !== 'f') wheels.push({ x: 0.7, f, side: 1 }, { x: -0.7, f, side: -1 });
  }
  return { key: 'semi', body: gb.build(), wheel: wheelGeometry(0.52, 0.3, 'truck'), wheels, r: 0.52, L: front - re, W: 1.28, front, rear: re,
    indL: overlayGeom(ov.ind, -1), indR: overlayGeom(ov.ind, 1), brake: overlayGeom(ov.brake, 0), hull: SAT.hull(1.28, front, re, 0.3, 0.05) };
};

// --------- BMW M4 Competition (G82) ---------
CATALOG.m4 = () => {
  const L = 4.79, h = L / 2, W = 0.945, aF = 1.50, aR = -1.357, r = 0.345;
  const sp = {
    L, W, r, axles: [aF, aR], crown: 0.055, midK: 0.38, shoulder: 0.968,
    top: [[h, 0.70], [h - 0.06, 0.775], [2.2, 0.83], [1.9, 0.865], [1.5, 0.905], [1.05, 0.955], [0.80, 0.985], [0.45, 1.15], [0.10, 1.315], [-0.20, 1.385], [-0.55, 1.39], [-0.95, 1.33], [-1.30, 1.20], [-1.62, 1.045], [-1.95, 1.02], [-2.25, 1.045], [-2.32, 1.035], [-2.37, 0.99], [-h, 0.93]],
    belt: [[h, 0.66], [2.2, 0.77], [1.5, 0.86], [0.80, 0.935], [-0.5, 0.975], [-1.45, 0.995], [-2.05, 0.985], [-2.3, 0.94], [-h, 0.86]],
    bot: [[h, 0.17], [2.28, 0.12], [1.9, 0.13], [-1.9, 0.15], [-2.2, 0.22], [-2.33, 0.27], [-h, 0.33]],
    low: [[h, 0.21], [2.2, 0.20], [1.0, 0.22], [-1.0, 0.22], [-2.2, 0.30], [-h, 0.37]],
    hw: [[h, 0.79], [h - 0.05, 0.89], [2.2, 0.955], [1.95, 0.99], [1.5, 1.0], [1.05, 0.98], [0.3, 0.965], [-0.6, 0.97], [-1.1, 0.99], [-1.36, 1.0], [-1.9, 0.985], [-2.2, 0.955], [-2.32, 0.91], [-h, 0.83]],
    roofIn: [[h, 0.80], [2.0, 0.85], [0.9, 0.84], [0.40, 0.77], [0.0, 0.735], [-0.6, 0.725], [-1.05, 0.74], [-1.45, 0.80], [-1.7, 0.86], [-h, 0.86]],
    gTop: [[0.80, 0.11], [-0.96, -1.60]],
    gSide: [[-1.12, 0.74]],
    roofSlot: SLOT.CARBON, roofRange: [[0.10, -0.95]],
    pillarSlot: SLOT.CARBON, lowerSlot: SLOT.CARBON,
  };
  const gb = new GB();
  const F = loftBody(gb, sp);
  const ov = { ind: [], brake: [] };
  const zf = -h;
  // --- Signature vertical kidney grilles ---
  const kid = (w, hh, rad) => {
    const s = new THREE.Shape(), x0 = -w / 2, y0 = -hh / 2;
    s.moveTo(x0 + rad, y0); s.lineTo(x0 + w - rad, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + rad);
    s.lineTo(x0 + w, y0 + hh - rad * 1.6); s.quadraticCurveTo(x0 + w, y0 + hh, x0 + w - rad * 1.4, y0 + hh);
    s.lineTo(x0 + rad * 1.4, y0 + hh); s.quadraticCurveTo(x0, y0 + hh, x0, y0 + hh - rad * 1.6);
    s.lineTo(x0, y0 + rad); s.quadraticCurveTo(x0, y0, x0 + rad, y0);
    return new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false, curveSegments: 3 });
  };
  for (const sg of [1, -1]) {
    gb.geom(kid(0.33, 0.47, 0.06), gb.xf(sg * 0.19, 0.47, zf - 0.03, -0.14, 0, 0), SLOT.METAL);
    gb.geom(kid(0.285, 0.42, 0.05), gb.xf(sg * 0.19, 0.47, zf - 0.045, -0.14, 0, 0), SLOT.DARK);
    for (let i = 0; i < 7; i++) gb.box(sg * 0.19, 0.30 + i * 0.056, zf - 0.088 + i * 0.0075, 0.27, 0.012, 0.02, SLOT.CARBON, -0.14, 0, 0);
  }
  // --- Headlights: dark lens + yellow DRL "eyebrows" ---
  for (const sg of [1, -1]) {
    gb.box(sg * 0.60, 0.655, zf + 0.04, 0.36, 0.09, 0.14, SLOT.DARK, 0, sg * -0.30, sg * -0.06);
    gb.box(sg * 0.58, 0.688, zf - 0.03, 0.26, 0.02, 0.03, SLOT.DRL, 0, sg * -0.30, sg * -0.06);
    gb.box(sg * 0.70, 0.645, zf + 0.0, 0.10, 0.02, 0.03, SLOT.DRL, 0, sg * -0.30, sg * -0.5);
    gb.box(sg * 0.50, 0.65, zf - 0.03, 0.08, 0.035, 0.02, SLOT.HEAD, 0, sg * -0.30, 0);
  }
  // --- Front bumper: big corner intakes, splitter ---
  gb.box2(0.62, 0.34, zf + 0.06, 0.36, 0.20, 0.14, SLOT.DARK, 0, -0.38, 0.12);
  gb.box(0, 0.20, zf + 0.02, 0.62, 0.08, 0.06, SLOT.DARK);
  gb.box(0, 0.125, zf + 0.09, 1.66, 0.025, 0.2, SLOT.CARBON);
  gb.box2(0.80, 0.15, zf + 0.12, 0.16, 0.025, 0.18, SLOT.CARBON, 0, -0.5, 0);
  // --- Carbon hood vents ---
  for (const sg of [1, -1]) {
    const f = 1.80, y = F.top(f) - 0.012;
    gb.box(sg * 0.30, y, -f, 0.26, 0.02, 0.36, SLOT.CARBON, -0.12, sg * 0.15, 0);
  }
  // --- Side gills, mirrors ---
  gb.box2(0.925, 0.62, -1.0, 0.03, 0.12, 0.16, SLOT.CARBON);
  gb.box2(1.02, 1.04, -0.66, 0.20, 0.10, 0.11, SLOT.PAINT, 0, 0.12, 0);
  gb.box2(0.94, 1.02, -0.70, 0.08, 0.035, 0.07, SLOT.CARBON);
  gb.box2(1.03, 1.025, -0.60, 0.17, 0.08, 0.01, SLOT.DARK);
  // --- Door handles ---
  gb.box2(0.925, 0.95, 0.15, 0.02, 0.025, 0.14, SLOT.CARBON);
  // --- Rear: laser tail lights, diffuser, quad exhaust, lip, plate ---
  const zr = h;
  for (const sg of [1, -1]) { // slim L-shaped "laser" tail lights in a smoked surround
    gb.box(sg * 0.60, 0.90, zr - 0.065, 0.46, 0.105, 0.12, SLOT.DARK, 0, sg * 0.28, 0);
    gb.box(sg * 0.60, 0.915, zr - 0.052, 0.42, 0.028, 0.12, SLOT.TAIL, 0, sg * 0.28, 0);
    gb.box(sg * 0.43, 0.885, zr - 0.012, 0.03, 0.06, 0.04, SLOT.TAIL, 0, sg * 0.28, 0);
    gb.box(sg * 0.78, 0.905, zr - 0.20, 0.035, 0.07, 0.26, SLOT.TAIL);
  }
  ov.brake.push([0.60, 0.915, zr - 0.048, 0.425, 0.032, 0.12, 0.28]);
  ov.third = [0, 1.32, 0.98, 0.42, 0.02, 0.05];
  gb.box(0, 0.24, zr - 0.06, 1.56, 0.14, 0.18, SLOT.CARBON);
  for (let i = -2; i <= 2; i++) gb.box(i * 0.16, 0.20, zr - 0.02, 0.012, 0.12, 0.14, SLOT.CARBON);
  for (const x of [-0.56, -0.41, 0.41, 0.56]) { gb.cyl(x, 0.27, zr + 0.02, 0.05, 0.05, 0.14, 10, SLOT.CHROME, Math.PI / 2); gb.cyl(x, 0.27, zr + 0.09, 0.037, 0.037, 0.02, 10, SLOT.DARK, Math.PI / 2); }
  gb.box(0, 1.065, zr - 0.13, 1.22, 0.025, 0.12, SLOT.CARBON, 0.18, 0, 0);
  gb.box(0, 0.58, zr + 0.003, 0.52, 0.12, 0.02, SLOT.PLATE);
  gb.box(0, 1.40, 0.70, 0.04, 0.05, 0.16, SLOT.CARBON);               // shark fin
  // indicators (in headlight + tail)
  ov.ind.push([0.78, 0.67, zf + 0.15, 0.06, 0.04, 0.08], [0.72, 0.89, zr - 0.13, 0.12, 0.03, 0.08]);
  // --- Brakes: red calipers, discs (static) ---
  const tx = 0.80;
  for (const f of [aF, aR]) for (const sg of [1, -1]) {
    gb.cyl(sg * (tx + 0.03), r, -f, 0.22, 0.22, 0.03, 16, SLOT.METAL, 0, 0, Math.PI / 2);
    gb.box(sg * (tx + 0.06), r + 0.1, -f + (f > 0 ? 0.08 : -0.08), 0.06, 0.14, 0.2, SLOT.CALIPER, f > 0 ? 0.5 : -0.5, 0, 0);
  }
  // --- Interior (for first person) ---
  const ib = new GB();
  ib.box(0, 0.86, -0.72, 1.62, 0.18, 0.32, SLOT.INT, 0.18, 0, 0);       // dash
  ib.box(0, 0.80, -0.58, 1.62, 0.12, 0.2, SLOT.INT);
  ib.box(0, 0.62, -0.25, 0.24, 0.24, 0.9, SLOT.INT);                    // console
  ib.box(0.06, 0.97, -0.68, 0.30, 0.17, 0.02, SLOT.SCREEN, -0.12, 0, 0); // iDrive
  ib.box(-0.37, 0.95, -0.66, 0.30, 0.11, 0.02, SLOT.SCREEN, -0.25, 0, 0); // cluster
  ib.box(-0.37, 1.005, -0.62, 0.34, 0.03, 0.12, SLOT.INT);              // cluster hood
  for (const sg of [-1, 1]) {
    ib.box(sg * 0.37, 0.45, 0.25, 0.5, 0.14, 0.52, SLOT.INT);           // seat base
    ib.box(sg * 0.37, 0.82, 0.55, 0.5, 0.72, 0.13, SLOT.INT, -0.18, 0, 0);
    ib.box(sg * 0.37, 1.23, 0.62, 0.26, 0.16, 0.1, SLOT.INT, -0.18, 0, 0);
    ib.box(sg * 0.86, 0.78, -0.05, 0.06, 0.08, 1.2, SLOT.CARBON);       // door trim
  }
  // steering wheel (separate, rotates)
  const sw = new GB();
  sw.geom(new THREE.TorusGeometry(0.185, 0.024, 6, 20), sw.xf(0, 0, 0), SLOT.INT);
  sw.box(0, -0.04, 0.0, 0.1, 0.08, 0.05, SLOT.INT);
  sw.box(0.1, -0.02, 0.0, 0.17, 0.035, 0.03, SLOT.INT);
  sw.box(-0.1, -0.02, 0.0, 0.17, 0.035, 0.03, SLOT.INT);
  sw.box(0, -0.12, 0.0, 0.035, 0.12, 0.03, SLOT.INT);
  sw.box(0, 0.183, 0.01, 0.025, 0.012, 0.05, SLOT.CALIPER);

  return {
    key: 'm4', body: gb.build(), interior: ib.build(), wheelSW: sw.build(),
    wheel: wheelGeometry(r, 0.275, 'm4'),
    wheels: [{ x: tx, f: aF, side: 1, front: true }, { x: -tx, f: aF, side: -1, front: true }, { x: tx, f: aR, side: 1 }, { x: -tx, f: aR, side: -1 }],
    r, L, W, front: h, rear: -h,
    indL: overlayGeom(ov.ind, -1), indR: overlayGeom(ov.ind, 1), brake: overlayGeom([...ov.brake, ov.third], 0),
    hull: SAT.hull(0.95, h, -h, 0.30, 0.24),
  };
};

// --------- Imported low-poly M4 (assets/m4_lowpoly.js, made by tools/convert-m4.html) ---------
// Uses the real car's shape; falls back to the hand-built M4 above if the file isn't present.
const CATALOG_M4_BUILT = CATALOG.m4;
function decodeI16(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(u8.buffer), f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 1000;
  return f;
}
// Crease-aware normals for imported (non-indexed) geometry: each corner averages the normals of
// faces sharing that point whose direction is within `angle` of its own face -> smooth panels,
// crisp edges, and no speckled slivers from the low-poly reduction.
function creaseNormals(g, angleDeg = 40) {
  const pos = g.attributes.position, n = pos.count, cosA = Math.cos(angleDeg * Math.PI / 180);
  const fn = new Float32Array(n), key = new Array(n), map = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const faceN = new Float32Array(n / 3 * 3), faceA = new Float32Array(n / 3);
  for (let f = 0; f < n / 3; f++) {
    a.fromBufferAttribute(pos, f * 3); b.fromBufferAttribute(pos, f * 3 + 1); c.fromBufferAttribute(pos, f * 3 + 2);
    b.sub(a); c.sub(a); b.cross(c); const len = b.length() || 1;
    faceN[f * 3] = b.x / len; faceN[f * 3 + 1] = b.y / len; faceN[f * 3 + 2] = b.z / len;
    faceA[f] = len; // area weight: thin slivers left by the reduction barely affect the shading
    for (let k = 0; k < 3; k++) {
      const i = f * 3 + k, kk = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
      key[i] = kk; let l = map.get(kk); if (!l) map.set(kk, l = []); l.push(f);
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const f0 = (i / 3) | 0, nx = faceN[f0 * 3], ny = faceN[f0 * 3 + 1], nz = faceN[f0 * 3 + 2];
    let sx = 0, sy = 0, sz = 0;
    for (const f of map.get(key[i])) {
      const mx = faceN[f * 3], my = faceN[f * 3 + 1], mz = faceN[f * 3 + 2], d = mx * nx + my * ny + mz * nz;
      const w = faceA[f];
      if (d >= cosA) { sx += mx * w; sy += my * w; sz += mz * w; }
      else if (-d >= cosA) { sx -= mx * w; sy -= my * w; sz -= mz * w; } // same surface, opposite winding
    }
    const l = Math.hypot(sx, sy, sz);
    if (l < 1e-12) { out[i * 3] = nx; out[i * 3 + 1] = ny; out[i * 3 + 2] = nz; continue; }
    out[i * 3] = sx / l; out[i * 3 + 1] = sy / l; out[i * 3 + 2] = sz / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}
function gbFromImport(groups, only, xFilter) {
  const gb = new GB();
  for (const name in groups) {
    if (only && !only.includes(name)) continue;
    const slot = SLOT[name] ?? SLOT.TRIM, arr = gb.arr(only ? 0 : slot), f = decodeI16(groups[name]);
    for (let i = 0; i < f.length; i += 9) {
      if (xFilter && !xFilter((f[i] + f[i + 3] + f[i + 6]) / 3)) continue;
      for (let j = 0; j < 9; j++) arr.push(f[i + j]);
    }
  }
  return gb.build();
}
CATALOG.m4 = () => {
  const D = window.M4_IMPORT;
  if (!D) return CATALOG_M4_BUILT();
  const front = -D.bounds.min[2], rear = -D.bounds.max[2];
  const body = creaseNormals(gbFromImport(D.body), 38);
  const wheels = D.wheels.map(w => ({ x: w.center[0], y: w.center[1], f: -w.center[2], side: w.center[0] > 0 ? 1 : -1, front: -w.center[2] > 0 }));
  const wheelGeoms = D.wheels.map(w => creaseNormals(gbFromImport(w.parts), 38));
  // steering wheel: geometry expressed in a frame whose +z is the column axis, so it spins about local z
  const ax = new THREE.Vector3().fromArray(D.steer.axis).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax);
  const sw = gbFromImport(D.steer.parts); sw.applyQuaternion(q.clone().invert());
  // lamp overlays come straight from the model's own lenses: tail lights glow when braking,
  // the amber elements flash as blinkers (left / right split by side of the car)
  return {
    key: 'm4', body, interior: gbFromImport(D.cabin), wheelSW: sw, swCenter: D.steer.center, swQuat: q,
    wheelGeoms, wheels, r: D.wheels[0].radius, L: front - rear, W: 0.95, front, rear,
    brake: gbFromImport(D.body, ['TAIL']),
    indL: gbFromImport(D.body, ['AMBER'], x => x < 0), indR: gbFromImport(D.body, ['AMBER'], x => x > 0),
    hull: SAT.hull(0.95, front - 0.03, rear + 0.03, 0.32, 0.26),
  };
};

function getModel(key) { return _geoCache[key] || (_geoCache[key] = CATALOG[key]()); }

// Build an instance (Group) of a vehicle. Returns handles for animation.
// ---------- "Lite" traffic meshes: all non-paint parts baked into vertex colours ----------
// A traffic car then draws in 2 calls (paint + everything else) instead of ~12, and each wheel in 1.
const LITE_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
function splitLite(g) {
  const pos = g.attributes.position, nor = g.attributes.normal, col = new THREE.Color();
  const P = [], N = [], C = [], PP = [], PN = [];
  for (const gr of g.groups) {
    const isPaint = gr.materialIndex === SLOT.PAINT;
    if (!isPaint) {
      const m = MATS[gr.materialIndex];
      col.copy(m.color);
      if (m.emissive) col.add(m.emissive.clone().multiplyScalar((m.emissiveIntensity || 1) * 0.8));
    }
    for (let i = gr.start; i < gr.start + gr.count; i++) {
      (isPaint ? PP : P).push(pos.getX(i), pos.getY(i), pos.getZ(i));
      (isPaint ? PN : N).push(nor.getX(i), nor.getY(i), nor.getZ(i));
      if (!isPaint) C.push(col.r, col.g, col.b);
    }
  }
  const mk = (p, n, c) => {
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    b.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    if (c) b.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    b.computeBoundingSphere();
    return b;
  };
  return { paint: PP.length ? mk(PP, PN) : null, rest: mk(P, N, C) };
}

function makeVehicle(key, paint, matOverrides, lite = false) {
  const M = getModel(key);
  const mats = matsWith(paint, matOverrides);
  const root = new THREE.Group();
  let body;
  if (lite) {
    M.lite = M.lite || { body: splitLite(M.body), wheel: splitLite(M.wheel).rest };
    body = new THREE.Mesh(M.lite.body.rest, LITE_MAT);
    if (M.lite.body.paint) { const pm = new THREE.Mesh(M.lite.body.paint, paint); pm.castShadow = true; root.add(pm); }
  } else body = new THREE.Mesh(M.body, mats);
  body.castShadow = true; body.receiveShadow = false;
  root.add(body);
  const wheels = [];
  M.wheels.forEach((w, i) => {
    const pivot = new THREE.Group();
    // imported wheels come already facing the right way (one geometry per corner);
    // generated wheels are built for the right side and turned around for the left
    const base = !M.wheelGeoms && w.side < 0 ? Math.PI : 0;
    pivot.position.set(w.x, w.y ?? M.r, -w.f);
    pivot.rotation.y = base;
    const geo = M.wheelGeoms ? M.wheelGeoms[i] : M.wheel;
    const mesh = lite ? new THREE.Mesh(M.lite.wheel, LITE_MAT) : new THREE.Mesh(geo, mats);
    mesh.castShadow = true;
    pivot.add(mesh); root.add(pivot);
    wheels.push({ pivot, mesh, side: w.side, front: !!w.front, base, spinSign: M.wheelGeoms ? 1 : w.side });
  });
  const brake = new THREE.Mesh(M.brake, OVERLAY.brake); brake.visible = false; root.add(brake);
  const indL = new THREE.Mesh(M.indL, OVERLAY.ind); indL.visible = false; root.add(indL);
  const indR = new THREE.Mesh(M.indR, OVERLAY.ind); indR.visible = false; root.add(indR);
  return { root, body, wheels, brake, indL, indR, M, mats, spin: 0 };
}

function animateWheels(v, dist, steer) {
  v.spin -= dist / v.M.r;
  for (const w of v.wheels) {
    w.mesh.rotation.x = v.spin * w.spinSign;
    if (w.front) w.pivot.rotation.y = w.base - steer;
  }
}
