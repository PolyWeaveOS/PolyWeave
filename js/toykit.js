'use strict';
// =====================================================================
//  "Toy" vehicle kit - same style as the trees and hills: chunky rounded
//  shapes with a few clear facets. A vehicle body is a stack of rounded-
//  rectangle rings (octagons: a rectangle with its corners cut off) joined
//  by flat faces - wide at the bottom, the cabin a smaller rounded block on
//  top. Lamps / grilles are small chunky pieces. Lit brake + blinker overlays
//  come from the TAIL / AMBER faces (LP.overlays), so they always fit.
//  Frame: x right, y up, -z forward; f = forward = -z.
// =====================================================================
const TOY = (() => {
  // ring: { y, w (half width), f (front), r (rear), c (corner radius), cf / cr (front / rear corner radius) }
  // A rounded rectangle seen from above: straight sides + rounded corners (ARC facets per corner).
  // Points go round from the front centre-right: front edge, front-right corner, right side, rear-right
  // corner, rear edge, rear-left corner, left side, front-left corner.
  const ARC = 3;
  function pts(R) {
    const cf = Math.min(R.cf ?? R.c, R.w * 0.98), cr = Math.min(R.cr ?? R.c, R.w * 0.98), w = R.w, y = R.y, out = [];
    // front-right corner centre (w - cf, f - cf): angle 90 -> 0 deg
    for (let i = 0; i <= ARC; i++) { const a = Math.PI / 2 - i / ARC * Math.PI / 2; out.push([w - cf + Math.cos(a) * cf, y, -(R.f - cf + Math.sin(a) * cf)]); }
    for (let i = 0; i <= ARC; i++) { const a = -i / ARC * Math.PI / 2; out.push([w - cr + Math.cos(a) * cr, y, -(R.r + cr + Math.sin(a) * cr)]); }
    for (let i = 0; i <= ARC; i++) { const a = -Math.PI / 2 - i / ARC * Math.PI / 2; out.push([-(w - cr) + Math.cos(a) * cr, y, -(R.r + cr + Math.sin(a) * cr)]); }
    for (let i = 0; i <= ARC; i++) { const a = Math.PI - i / ARC * Math.PI / 2; out.push([-(w - cf) + Math.cos(a) * cf, y, -(R.f - cf + Math.sin(a) * cf)]); }
    return out;
  }
  // which part of the ring an edge belongs to (from its two end points)
  function part(a, b, R) {
    const fa = -a[2], fb = -b[2], e = 1e-4;
    if (Math.abs(fa - R.f) < e && Math.abs(fb - R.f) < e) return 'front';
    if (Math.abs(fa - R.r) < e && Math.abs(fb - R.r) < e) return 'rear';
    if (Math.abs(Math.abs(a[0]) - R.w) < e && Math.abs(Math.abs(b[0]) - R.w) < e) return 'side';
    return fa + fb > R.f + R.r ? 'fcorner' : 'rcorner';
  }

  // stack rings (bottom to top); face(seg, part, x, f) -> slot letter ('front','rear','side','fcorner','rcorner')
  function stack(gb, rings, face, top = 'P', bottom = 'D') {
    const P = rings.map(pts), n = P[0].length;
    let cx = 0, cy = 0, cz = 0, cnt = 0;
    for (const ring of P) for (const p of ring) { cx += p[0]; cy += p[1]; cz += p[2]; cnt++; }
    const C = [cx / cnt, cy / cnt, cz / cnt];
    for (let i = 0; i < P.length - 1; i++) {
      for (let k = 0; k < n; k++) {
        const a = P[i][k], b = P[i][(k + 1) % n], c = P[i + 1][(k + 1) % n], d = P[i + 1][k];
        const m = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4];
        // label from the upper ring (that's the shape the face is heading to)
        const pt = part(d, c, rings[i + 1]) === part(a, b, rings[i]) ? part(a, b, rings[i]) : part(d, c, rings[i + 1]);
        if (Math.hypot(b[0] - a[0], b[2] - a[2]) < 1e-5 && Math.hypot(c[0] - d[0], c[2] - d[2]) < 1e-5) continue;
        LP.poly(gb, [a, b, c, d], face(i, pt, m[0], -m[2]), [m[0] - C[0], m[1] - C[1], m[2] - C[2]]);
      }
    }
    LP.poly(gb, P[0].slice().reverse(), bottom, [0, -1, 0]);
    LP.poly(gb, P[P.length - 1], top, [0, 1, 0]);
    return P;
  }
  const EDGE = {};

  // chunky detail pieces
  const box = (gb, x, y, f, sx, sy, sz, s, mirror = true, rx = 0, ry = 0, rz = 0) => LP.box(gb, x, y, f, sx, sy, sz, s, mirror, rx, ry, rz);
  // round lamp / badge: an 8-sided puck facing forward (dir -1) or backward (dir +1)
  function puck(gb, x, y, f, rad, depth, s, dir = -1, mirror = true) {
    for (const sg of mirror && x !== 0 ? [1, -1] : [1]) {
      gb.geom(new THREE.CylinderGeometry(rad, rad, depth, 8), gb.xf(sg * x, y, -f, Math.PI / 2, 0, 0), LP.slot(s));
    }
  }
  // chunky wheel: 8-sided tyre, flat hub
  const wheel = (r, w, hub = 'M') => LP.wheel(r, w, { sides: 8, spokes: 0, rim: 0.56, dish: hub, hub: 'D' });

  return { pts, stack, EDGE, box, puck, wheel };
})();
