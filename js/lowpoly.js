'use strict';
// =====================================================================
//  Low-poly vehicle kit (PolyTrack / "faceted" style).
//  A body is a handful of cross-sections joined by big flat faces - no dense
//  sampling, no fake curves. Lamps, glass and trim are just colours on those
//  faces, and the lit brake / blinker overlays are copies of the lamp faces,
//  so they always sit exactly on the lamps.
//  Frame (same as js/models.js): x right, y up, -z forward; f = forward = -z.
// =====================================================================
const LP = (() => {
  const C = { P: SLOT.PAINT, G: SLOT.GLASS, T: SLOT.TRIM, D: SLOT.DARK, H: SLOT.HEAD, L: SLOT.TAIL, A: SLOT.AMBER,
    C: SLOT.CHROME, W: SLOT.WHITE, M: SLOT.METAL, B: SLOT.BOX, R: SLOT.DRL, K: SLOT.PLATE, X: SLOT.CARBON };
  const slot = c => (typeof c === 'number' ? c : C[c] ?? SLOT.PAINT);
  // piecewise-LINEAR keyframe curve (keeps the facets honest)
  const lin = keys => {
    const k = keys.slice().sort((a, b) => a[0] - b[0]);
    return f => {
      if (f <= k[0][0]) return k[0][1];
      for (let i = 1; i < k.length; i++) if (f <= k[i][0]) { const t = (f - k[i - 1][0]) / (k[i][0] - k[i - 1][0] || 1); return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * t; }
      return k[k.length - 1][1];
    };
  };
  const inR = (r, f) => r && r.some(([a, b]) => f >= Math.min(a, b) && f <= Math.max(a, b));

  // ---- the body -------------------------------------------------------------
  // o.st     : station list [f, ...] (any order) - the ONLY places the shape changes
  // o.ring   : (f) => half ring [[x, y], ...] from the bottom outer corner up to the roof centre (x = 0)
  //            (use LP.ringFrom(curves) for the usual 6-point car ring)
  // o.face   : (fMid, k) => slot letter for edge k of the segment around fMid (k = 0 is the underside)
  // o.capF / o.capR : slot letters (one per ring edge, bottom up) for the flat front / rear end caps
  // o.arches : [{ f, r, top }] wheel-arch cut-outs: the lower ring points rise to `top` over each wheel
  function body(gb, o) {
    let st = [...new Set(o.st.map(v => +v.toFixed(4)))];
    for (const a of o.arches || []) st.push(a.f - a.r, a.f - a.r * 0.62, a.f + a.r * 0.62, a.f + a.r);
    st = [...new Set(st.map(v => +v.toFixed(4)))].sort((a, b) => a - b);
    const ringAt = f => {
      const R = o.ring(f).map(p => p.slice());
      for (const a of o.arches || []) {
        const d = Math.abs(f - a.f);
        if (d >= a.r - 1e-6) continue;
        const y = d <= a.r * 0.62 + 1e-6 ? a.top : a.top + (R[0][1] - a.top) * (d - a.r * 0.62) / (a.r * 0.38);
        const lift = a.lift ?? 2; // how many ring points (from the bottom) follow the arch
        for (let i = 0; i < lift; i++) R[i][1] = Math.max(R[i][1], y + i * 0.02);
      }
      for (let i = 1; i < R.length; i++) if (R[i][1] < R[i - 1][1] + 0.005 && R[i][0] !== 0) R[i][1] = R[i - 1][1] + 0.005;
      return [[0, R[0][1]], ...R];
    };
    const rings = st.map(ringAt);
    for (let i = 0; i < st.length - 1; i++) {
      const a = rings[i], b = rings[i + 1], z0 = -st[i], z1 = -st[i + 1], fm = (st[i] + st[i + 1]) / 2;
      for (let k = 0; k < a.length - 1; k++) {
        const s = slot(o.face(fm, k, st[i], st[i + 1]));
        for (const sg of [1, -1]) {
          const p = [sg * a[k][0], a[k][1], z0], q = [sg * a[k + 1][0], a[k + 1][1], z0];
          const r = [sg * b[k + 1][0], b[k + 1][1], z1], t = [sg * b[k][0], b[k][1], z1];
          if (sg > 0) gb.quad(p, t, r, q, s); else gb.quad(p, q, r, t, s);
        }
      }
    }
    // flat end caps: fan from a centre point, one slot per ring edge
    const cap = (ring, z, codes, flip, cy) => {
      const n = ring.length, c = [0, cy ?? (ring[1][1] + ring[n - 1][1]) / 2, z];
      for (let k = 0; k < n - 1; k++) {
        const s = slot(codes[Math.min(k, codes.length - 1)]);
        for (const sg of [1, -1]) {
          const a = [sg * ring[k][0], ring[k][1], z], b = [sg * ring[k + 1][0], ring[k + 1][1], z];
          if ((sg > 0) !== flip) gb.tri(c, a, b, s); else gb.tri(c, b, a, s);
        }
      }
    };
    cap(rings[0], -st[0], o.capR || 'D', false, o.capRy);
    cap(rings[rings.length - 1], -st[st.length - 1], o.capF || 'D', true, o.capFy);
    return { st, ringAt, front: st[st.length - 1], rear: st[0] };
  }

  // The usual 6-point car ring from linear curves (all heights in m, x as fractions of the half width W):
  //   bot (underside / sill bottom), low (rocker crease), sh (shoulder, widest), belt (window line),
  //   edge (roof / hood edge), top (centre line).  Optional *X curves narrow points (default sensible).
  function ringFrom(W, c) {
    const F = {}; for (const k in c) F[k] = typeof c[k] === 'number' ? (() => c[k]) : lin(c[k]);
    const g = (k, f, d) => (F[k] ? F[k](f) : d);
    return f => {
      const w = W * g('w', f, 1);
      return [[w * g('botX', f, 0.9), F.bot(f)], [w * g('lowX', f, 0.99), F.low(f)], [w * g('shX', f, 1), F.sh(f)],
        [w * g('beltX', f, 0.95), F.belt(f)], [w * g('edgeX', f, 0.74), F.edge(f)], [0, F.top(f)]];
    };
  }

  // ---- flat decals on the vertical end caps (grilles, plates, lamps) ----------
  // quad in the plane z = -f, pushed `out` metres outward (front: -z, rear: +z). pts: [[x,y]...] (4), mirrored if mirror
  function capDecal(gb, f, front, pts, s, out = 0.006, mirror = false) {
    const z = -f + (front ? -out : out), n = [0, 0, front ? -1 : 1];
    poly(gb, pts.map(([x, y]) => [x, y, z]), s, n);
    if (mirror) poly(gb, pts.map(([x, y]) => [-x, y, z]), s, n);
  }
  // convex polygon (3+ points, any order around the edge) facing outward normal n
  function poly(gb, P, s, n) {
    const ux = P[1][0] - P[0][0], uy = P[1][1] - P[0][1], uz = P[1][2] - P[0][2];
    const vx = P[2][0] - P[0][0], vy = P[2][1] - P[0][1], vz = P[2][2] - P[0][2];
    const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    const Q = d >= 0 ? P : P.slice().reverse();
    for (let i = 1; i < Q.length - 1; i++) gb.tri(Q[0], Q[i], Q[i + 1], slot(s));
  }
  // box helper with slot letters; mirrored pair if x != 0 and mirror
  const box = (gb, x, y, f, sx, sy, sz, s, mirror = true, rx = 0, ry = 0, rz = 0) => {
    gb.box(x, y, -f, sx, sy, sz, slot(s), rx, ry, rz);
    if (mirror && x !== 0) gb.box(-x, y, -f, sx, sy, sz, slot(s), rx, -ry, -rz);
  };

  // ---- lit overlays = copies of the lamp faces, nudged outward -------------------
  function overlays(gb) {
    const pick = (sl, test) => {
      const src = gb.slots[sl] || [], out = [];
      for (let i = 0; i < src.length; i += 9) {
        const a = src.slice(i, i + 3), b = src.slice(i + 3, i + 6), c = src.slice(i + 6, i + 9);
        const cx = (a[0] + b[0] + c[0]) / 3;
        if (test && !test(cx)) continue;
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        for (const p of [a, b, c]) out.push(p[0] + nx * 0.007, p[1] + ny * 0.007, p[2] + nz * 0.007);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3)); g.computeVertexNormals();
      return g;
    };
    return { brake: pick(SLOT.TAIL), indL: pick(SLOT.AMBER, x => x < 0), indR: pick(SLOT.AMBER, x => x > 0) };
  }

  // ---- low-poly wheel: 10-sided tyre, flat rim face with chunky spokes ----------
  // built for the RIGHT side (hub face at +x), axle along x, centred at the origin
  function wheel(r, w, o = {}) {
    const gb = new GB(), n = o.sides ?? 10, rr = r * (o.rim ?? 0.62);
    gb.geom(new THREE.CylinderGeometry(r, r, w, n, 1, false), gb.xf(0, 0, 0, 0, 0, Math.PI / 2), SLOT.TIRE);
    gb.geom(new THREE.CylinderGeometry(rr, rr, 0.02, n, 1, false), gb.xf(w / 2 + 0.002, 0, 0, 0, 0, Math.PI / 2), slot(o.dish ?? 'D'));
    const sp = o.spokes ?? 5;
    for (let i = 0; i < sp; i++) {
      const a = i / sp * Math.PI * 2 + 0.3;
      gb.box(w / 2 + 0.012, Math.cos(a) * rr * 0.5, Math.sin(a) * rr * 0.5, 0.02, rr * 0.95, rr * (o.spokeW ?? 0.22), slot(o.spokeSlot ?? 'M'), a, 0, 0);
    }
    gb.geom(new THREE.CylinderGeometry(rr * 0.24, rr * 0.24, 0.03, 6, 1, false), gb.xf(w / 2 + 0.014, 0, 0, 0, 0, Math.PI / 2), slot(o.hub ?? 'M'));
    return gb.build();
  }

  // ---- assemble the object the game expects ----------------------------------
  // spec: { key, gb, W (half width for hitbox), front, rear, r, tyreW, axles:[f...], track, wheel (geometry),
  //         steer: number of front axles that steer (default 1), dual: [axle indexes with dual rear wheels] }
  function finish(s) {
    const ov = overlays(s.gb), wheels = [];
    const tx = s.track ?? (s.W - s.tyreW / 2 - 0.02);
    s.axles.forEach((f, i) => {
      const front = i < (s.steer ?? 1);
      wheels.push({ x: tx, f, side: 1, front }, { x: -tx, f, side: -1, front });
      if (s.dual && s.dual.includes(i)) wheels.push({ x: tx - s.tyreW - 0.02, f, side: 1 }, { x: -(tx - s.tyreW - 0.02), f, side: -1 });
    });
    return {
      key: s.key, body: s.gb.build(), wheel: s.wheel, wheels, r: s.r, L: s.front - s.rear, W: s.W, front: s.front, rear: s.rear,
      brake: ov.brake, indL: ov.indL, indR: ov.indR,
      hull: SAT.hull(s.W + 0.01, s.front, s.rear, s.chamfer ?? Math.min(0.35, s.W * 0.35), s.chamferR ?? 0.2),
    };
  }

  return { C, slot, lin, inR, body, ringFrom, capDecal, poly, box, overlays, wheel, finish };
})();
