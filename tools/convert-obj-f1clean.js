'use strict';
// node tools/convert-obj-f1clean.js <car.obj> <out.bin> <path to meshoptimizer package> [triangles=5000] [smooth passes=12] [panel angle=20] [panel depth=0.03]
// The owner's F1 model (OBJ, one lumpy 120k-triangle mesh, Y up, nose toward +Z) -> a clean low-poly copy of it, 1:1:
//  - turned to face -z, scaled to 5.2 m, on the ground, centred (the same placement as before)
//  - the lumpy surface smoothed (Taubin: smooths without shrinking the shape)
//  - its wheels removed (they were fused to the body; the game puts clean wheels in exactly the same places)
//  - simplified (meshoptimizer) to about `triangles` faces, then pressed into flat panels (flatten below): clean blocks
// File: 'F1C2', Uint32 triangles, then Int16 millimetre positions (3 vertices per triangle).
const fs = require('fs'), path = require('path');
const [, , inF, outF, moDir, triArg = '5000', smoothArg = '12'] = process.argv;
const { MeshoptSimplifier } = require(path.join(moDir, 'index.js'));
const WHEELS = [[-0.875, 0.35, -1.25], [0.875, 0.35, -1.25], [-0.875, 0.35, 2.05], [0.875, 0.35, 2.05]];   // (measured)
(async () => {
  await MeshoptSimplifier.ready;
  const V = [], F = [];
  for (const line of fs.readFileSync(inF, 'utf8').split(/\r?\n/)) {
    if (line[0] === 'v' && line[1] === ' ') { const t = line.split(/\s+/); V.push(+t[1], +t[2], +t[3]); }
    else if (line[0] === 'f') { const ids = line.trim().split(/\s+/).slice(1).map(s => +s.split('/')[0] - 1); for (let k = 1; k < ids.length - 1; k++) F.push(ids[0], ids[k], ids[k + 1]); }
  }
  // weld vertices at the same spot (so smoothing / simplifying treat the surface as connected)
  const key = new Map(), remap = new Int32Array(V.length / 3), P = [];
  for (let i = 0; i < V.length / 3; i++) {
    const k = Math.round(V[i * 3] * 1e5) + ',' + Math.round(V[i * 3 + 1] * 1e5) + ',' + Math.round(V[i * 3 + 2] * 1e5);
    let j = key.get(k); if (j === undefined) { j = P.length / 3; key.set(k, j); P.push(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]); } remap[i] = j;
  }
  let I = F.map(i => remap[i]);
  // placement: turn 180 deg, scale to 5.2 m, ground, centre
  const n = P.length / 3; let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], P[i * 3 + a]); mx[a] = Math.max(mx[a], P[i * 3 + a]); }
  const S = 5.2 / (mx[2] - mn[2]), cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  const G = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { G[i * 3] = -(P[i * 3] - cx) * S; G[i * 3 + 1] = (P[i * 3 + 1] - mn[1]) * S; G[i * 3 + 2] = -(P[i * 3 + 2] - cz) * S; }
  // Taubin smoothing (lambda / mu): takes the lumps out without shrinking
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; nb[a].add(b); nb[b].add(a); }
  const N = nb.map(s => [...s]), tmp = new Float32Array(G.length);
  for (let pass = 0; pass < +smoothArg * 2; pass++) {
    const f = pass % 2 ? -0.53 : 0.5;
    for (let i = 0; i < n; i++) {
      const L = N[i]; if (!L.length) { for (let a = 0; a < 3; a++) tmp[i * 3 + a] = G[i * 3 + a]; continue; }
      for (let a = 0; a < 3; a++) { let s = 0; for (const j of L) s += G[j * 3 + a]; tmp[i * 3 + a] = G[i * 3 + a] + f * (s / L.length - G[i * 3 + a]); }
    }
    G.set(tmp);
  }
  // drop the fused wheels (triangles inside each wheel's cylinder)
  const keep = [];
  for (let t = 0; t < I.length; t += 3) {
    const c = [0, 1, 2].map(a => (G[I[t] * 3 + a] + G[I[t + 1] * 3 + a] + G[I[t + 2] * 3 + a]) / 3);
    if (WHEELS.some(([x, y, z]) => Math.abs(c[0] - x) < 0.23 && Math.hypot(c[1] - y, c[2] - z) < 0.42)) continue;
    keep.push(I[t], I[t + 1], I[t + 2]);
  }
  // the cut leaves ragged open edges beside the wheels: smooth those edges along themselves so they run straight
  {
    const cnt = new Map();
    for (let t = 0; t < keep.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = keep[t + k], b = keep[t + (k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; cnt.set(key, (cnt.get(key) || 0) + 1);
    }
    const bn = new Map();
    for (const [key, c] of cnt) if (c === 1) { const [a, b] = key.split(',').map(Number); for (const [p, q] of [[a, b], [b, a]]) { if (!bn.has(p)) bn.set(p, []); bn.get(p).push(q); } }
    const tmpB = new Map();
    for (let pass = 0; pass < 30; pass++) {
      for (const [v, L] of bn) { const s = [0, 0, 0]; for (const j of L) for (let a = 0; a < 3; a++) s[a] += G[j * 3 + a]; tmpB.set(v, s.map((x, a) => G[v * 3 + a] + 0.5 * (x / L.length - G[v * 3 + a]))); }
      for (const [v, p] of tmpB) for (let a = 0; a < 3; a++) G[v * 3 + a] = p[a];
    }
  }
  // simplify to clean flat faces
  const target = +triArg * 3;
  let [out] = MeshoptSimplifier.simplify(new Uint32Array(keep), G, 3, target, 0.05);
  out = flatten(Array.from(out), G);
  // second pass: now the panels are flat, simplifying again merges their many small triangles into a few big ones
  // (straight panel edges), then they're pressed flat once more
  const tri2 = +(process.argv[9] || 0);
  if (tri2) { [out] = MeshoptSimplifier.simplify(new Uint32Array(out), G, 3, tri2 * 3, 0.02); out = flatten(Array.from(out), G); }
  // the model's own back, reshaped gently (the owner: less blocky, sides sloping in like the panels beside it, and a
  // smaller, slimmer wing - but still the model's back, not a new one)
  const clamp01 = x => Math.min(1, Math.max(0, x));
  for (const v of new Set(out)) {
    let [x, y, z] = [G[v * 3], G[v * 3 + 1], G[v * 3 + 2]];
    if (z > 2.12 && Math.abs(x) < 0.45 && y > 0.5 && y < 0.635) y = 0.585;           // (the big rear block's lumpy top: flat)
    // rear block: its sides lean in toward the top (35% narrower at the top), so it slopes on each side
    // (and smaller - the owner found it big and bulgy: 22% narrower at the bottom, about half as wide at the top,
    //  and 35% shorter out the back)
    if (z > 2.12 && Math.abs(x) < 0.45 && y < 0.64) { x *= 0.78 - 0.3 * clamp01((y - 0.12) / 0.47); z = 2.15 + Math.max(0, z - 2.15) * 0.65; }
    // wing: about half as thick (squashed toward its middle, 0.98 m up), 12% narrower and 15% shorter front to back;
    // blended in over the endplates / posts below it so nothing tears
    if (z > 1.98) {
      const w = clamp01((y - 0.62) / 0.22);
      if (y > 0.8) y = 0.88 + (y - 0.98) * 0.3;    // (owner, later: lower it 10 cm and thinner - now 30% of the model's thickness)
      x *= 1 - 0.12 * w; z = 2.32 + (z - 2.32) * (1 - 0.15 * w);
    }
    // narrower (the owner: looked odd in game): the body (sidepods etc., z -0.6..1.75) 13% and the front wing (z < -1.9)
    // 15%, blended in over 30 cm / 10 cm so nothing tears; the nose and front suspension between them stay as they are
    const sBody = clamp01((z + 0.9) / 0.3) * clamp01((1.9 - z) / 0.15), sWing = clamp01((-1.85 - z) / 0.1);
    x *= 1 - 0.13 * sBody - 0.27 * sWing;   // (front wing: 27% - the owner asked for it a bit narrower again)
    G[v * 3] = x; G[v * 3 + 1] = y; G[v * 3 + 2] = z;
  }
  // parts the game builds itself instead (js/f1.js makeF1): cut away cleanly, along straight lines.
  // The owner found the airbox over the driver odd: the game makes a cleaner one with sloping sides in its place.
  const CUTS = (process.argv[12] || 'airbox,rearcover,rearstubs,rearall,epstub,floater,wing').split(',').filter(Boolean).map(n => ({
    airbox: { lo: [-0.375, 0.64, 0.1], hi: [0.375, 9, 1.75] },      // airbox + engine cover, above the sidepods
    rear: { lo: [-0.8, 0.135, 1.72], hi: [0.8, 9, 9] },             // everything behind the sidepods, above the floor
    // the leftover of the model's own rear tyres (a cover wrapped round the front of each rear wheel) and the hub
    // stubs just inside them (the +x side: the other is mirrored from it)
    rearcover: { lo: [0.66, -1, 1.45], hi: [1.3, 0.8, 2.7] },
    rearstubs: { lo: [0.6, -1, 1.45], hi: [0.66, 0.55, 2.4] },
    // the big block at the back (the game makes a shorter one with chamfered edges: js/f1.js f1Parts)
    rearblock: { lo: [-0.45, 0.135, 2.12], hi: [0.45, 0.6, 2.8] },
    // the wing posts: each was a rectangle from the base up to the wing with a useless triangle flaring off it - the game
    // puts the plain rectangle back in the same place (js/f1.js g.posts)
    posts: { lo: [0.06, 0.595, 2.12], hi: [0.32, 0.825, 2.5] },
    // the floor plate left sticking out under / behind the block (the block now goes down to the floor line itself)
    rearfloor: { lo: [-0.46, -1, 2.1], hi: [0.46, 0.2, 9] },
    // the lower, slanted parts of the wing's endplates that ran down into the body in an odd way (the owner): the
    // endplates now end cleanly under the wing tips
    eplower: { lo: [0.45, 0.135, 1.95], hi: [0.75, 0.75, 2.7] },
    // the leftovers in the corner between the body and each rear wheel, behind the sidepods (old upright bits, pins):
    // the game's rear body + side arm are all that's there now
    rearcorner: { lo: [0.38, -1, 1.72], hi: [1.3, 0.75, 2.7] },
    // the whole back under the wing (the owner: keep it simple - the game builds a plain rear body with a two-faced back,
    // sloping endplates and the posts; only the model's wing stays)
    rearall: { lo: [-1.3, -1, 1.72], hi: [1.3, 0.8, 2.8] },
    // the rear wing's second (upper) layer - the owner only wants the one plane
    wingtop: { lo: [-1.3, 0.857, 1.95], hi: [1.3, 1.5, 2.8] },   // (not used: the owner wanted both layers back)
    // what was left of the old endplates beside the wing tips, floating by the rear wheels
    epstub: { lo: [0.53, 0.6, 1.95], hi: [0.8, 1.2, 2.8] },
    // a small leftover piece floating in front of each rear wheel (from the old tyre cover)
    floater: { lo: [0.56, 0.45, 1.45], hi: [0.85, 0.8, 1.75] },
    // the model's wing: its elements left slots between them once it was made thinner - the game makes one solid wing
    wing: { lo: [-1.3, 0.75, 1.95], hi: [1.3, 1.5, 2.8] },
  }[n]));
  // (one side of a plane: a = axis, v = value, keep = +1 keeps the part above it, -1 the part below)
  const clipPlane = (poly, a, v, keep) => {
    const res = [];
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length], ip = (p[a] - v) * keep >= 0, iq = (q[a] - v) * keep >= 0;
      if (ip) res.push(p);
      if (ip !== iq) { const s = (v - p[a]) / (q[a] - p[a]); res.push(p.map((x, i) => (i === a ? v : x + (q[i] - x) * s))); }
    }
    return res.length >= 3 ? res : null;
  };
  // the parts of a polygon outside a box (peeled off one face of the box at a time; what's left inside is dropped)
  const outsideBox = (poly, { lo, hi }) => {
    const res = []; let rem = poly;
    for (let a = 0; a < 3 && rem; a++) for (const [v, keep] of [[lo[a], -1], [hi[a], 1]]) {
      if (!rem) break;
      const o = clipPlane(rem, a, v, keep); if (o) res.push(o);
      rem = clipPlane(rem, a, v, -keep);
    }
    return res;
  };
  // symmetry: cut the car down the middle (x = 0), keep one half (side: +1 = the +x half, -1 = the -x half) and mirror it
  // onto the other side, so both sides are exactly the same
  const side = (process.argv[11] || '1') === '-1' ? -1 : 1, half = [];
  for (let t = 0; t < out.length; t += 3) {
    let polys = [[0, 1, 2].map(k => [G[out[t + k] * 3], G[out[t + k] * 3 + 1], G[out[t + k] * 3 + 2]])];
    for (const box of CUTS) polys = polys.flatMap(p => outsideBox(p, box));
    for (const p of polys) {
      const poly = clipPlane(p, 0, 0, side); if (!poly) continue;
      for (let k = 1; k < poly.length - 1; k++) half.push([poly[0], poly[k], poly[k + 1]]);
    }
  }
  const all = [];
  for (const tri of half) {
    const q = tri.map(p => p.map(v => Math.round(v * 1000)));
    if (q.every(p => p[0] === 0)) continue;                        // (a sliver lying in the centre plane itself)
    const u = [0, 1, 2].map(a => q[1][a] - q[0][a]), v = [0, 1, 2].map(a => q[2][a] - q[0][a]);
    if (!(u[1] * v[2] - u[2] * v[1]) && !(u[2] * v[0] - u[0] * v[2]) && !(u[0] * v[1] - u[1] * v[0])) continue;   // (squashed flat by the cut)
    all.push(q, [q[0], q[2], q[1]].map(([x, y, z]) => [-x, y, z]));   // (mirrored, winding flipped)
  }
  const tris = all.length, data = new Int16Array(tris * 9);
  all.forEach((tri, i) => tri.forEach((p, k) => { for (let a = 0; a < 3; a++) data[i * 9 + k * 3 + a] = p[a]; }));
  const head = Buffer.alloc(8); head.write('F1C2', 0); head.writeUInt32LE(tris, 4);
  fs.writeFileSync(outF, Buffer.concat([head, Buffer.from(data.buffer)]));
  console.log(`${F.length / 3} triangles -> ${keep.length / 3} without wheels -> ${tris} clean faces, ${(fs.statSync(outF).size / 1024).toFixed(0)} KB`);
})().catch(e => { console.error(e); process.exit(1); });

// Flat panels ("smooth blocks"): group neighbouring triangles that face nearly the same way and lie close to one plane
// into a panel, then press every corner onto the planes of the panels it touches (a corner shared by 2 panels lands on
// their crease, 3+ on their corner). The small dents / ridges between triangles go and each panel is truly flat.
// I: triangle indices into the positions P (moved in place). Returns the indices without the squashed triangles.
function flatten(I, P, angDeg = +(process.argv[7] || 20), dist = +(process.argv[8] || 0.03), iters = 4) {
  const nt = I.length / 3, cosA = Math.cos(angDeg * Math.PI / 180);
  const fN = new Float64Array(nt * 3), fA = new Float64Array(nt), fC = new Float64Array(nt * 3);
  const faces = () => {
    for (let f = 0; f < nt; f++) {
      const [a, b, c] = [I[f * 3], I[f * 3 + 1], I[f * 3 + 2]];
      const u = [0, 1, 2].map(k => P[b * 3 + k] - P[a * 3 + k]), v = [0, 1, 2].map(k => P[c * 3 + k] - P[a * 3 + k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1e-12;
      for (let k = 0; k < 3; k++) { fN[f * 3 + k] = n[k] / l; fC[f * 3 + k] = (P[a * 3 + k] + P[b * 3 + k] + P[c * 3 + k]) / 3; }
      fA[f] = l / 2;
    }
  };
  faces();
  // neighbours across shared edges
  const edge = new Map(), nb = Array.from({ length: nt }, () => []);
  for (let f = 0; f < nt; f++) for (let k = 0; k < 3; k++) {
    const a = I[f * 3 + k], b = I[f * 3 + (k + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a;
    const o = edge.get(key); if (o === undefined) edge.set(key, [f]); else { for (const g of o) { nb[f].push(g); nb[g].push(f); } o.push(f); }
  }
  // grow panels from the biggest triangles outward (normals compared without their sign: the model's winding is mixed)
  const reg = new Int32Array(nt).fill(-1), order = [...Array(nt).keys()].sort((a, b) => fA[b] - fA[a]), R = [];
  for (const s of order) {
    if (reg[s] >= 0) continue;
    const r = R.length, N = [fN[s * 3], fN[s * 3 + 1], fN[s * 3 + 2]].map(x => x * fA[s]); let aSum = 0;
    const add = f => { const sg = fN[f * 3] * N[0] + fN[f * 3 + 1] * N[1] + fN[f * 3 + 2] * N[2] < 0 ? -1 : 1; for (let k = 0; k < 3; k++) N[k] += sg * fN[f * 3 + k] * fA[f]; reg[f] = r; aSum += fA[f]; };
    reg[s] = r; aSum = fA[s]; const q = [s];
    while (q.length) {
      const f = q.shift();
      for (const g of nb[f]) {
        if (reg[g] >= 0) continue;
        const l = Math.hypot(...N), n = N.map(x => x / l);
        const d0 = n[0] * fC[s * 3] + n[1] * fC[s * 3 + 1] + n[2] * fC[s * 3 + 2];
        if (Math.abs(n[0] * fN[g * 3] + n[1] * fN[g * 3 + 1] + n[2] * fN[g * 3 + 2]) < cosA) continue;
        if (Math.abs(n[0] * fC[g * 3] + n[1] * fC[g * 3 + 1] + n[2] * fC[g * 3 + 2] - d0) > dist) continue;
        add(g); q.push(g);
      }
    }
    R.push(null);
  }
  // tiny panels (noise from the reduction) join the neighbouring big panel that faces most nearly their way
  const minArea = +(process.argv[10] || 0.003), cosM = Math.cos(50 * Math.PI / 180);
  for (let pass = 0; pass < 6; pass++) {
    const rA = new Float64Array(R.length), rN = new Float64Array(R.length * 3);
    for (let f = 0; f < nt; f++) { const r = reg[f]; rA[r] += fA[f]; const ref = rN[r * 3] * fN[f * 3] + rN[r * 3 + 1] * fN[f * 3 + 1] + rN[r * 3 + 2] * fN[f * 3 + 2] < 0 ? -1 : 1; for (let k = 0; k < 3; k++) rN[r * 3 + k] += ref * fN[f * 3 + k] * fA[f]; }
    for (let r = 0; r < R.length; r++) { const l = Math.hypot(rN[r * 3], rN[r * 3 + 1], rN[r * 3 + 2]) || 1; for (let k = 0; k < 3; k++) rN[r * 3 + k] /= l; }
    let moved = 0;
    for (let f = 0; f < nt; f++) {
      if (rA[reg[f]] >= minArea) continue;
      let best = -1, bd = cosM;
      for (const g of nb[f]) {
        const r = reg[g]; if (r === reg[f] || rA[r] < minArea) continue;
        const d = Math.abs(rN[r * 3] * fN[f * 3] + rN[r * 3 + 1] * fN[f * 3 + 1] + rN[r * 3 + 2] * fN[f * 3 + 2]);
        if (d > bd) { bd = d; best = r; }
      }
      if (best >= 0) { reg[f] = best; moved++; }
    }
    if (!moved) break;
  }
  // each corner: the panels it touches
  const nv = P.length / 3, vReg = Array.from({ length: nv }, () => new Set());
  for (let f = 0; f < nt; f++) for (let k = 0; k < 3; k++) vReg[I[f * 3 + k]].add(reg[f]);
  const used = [...new Set(I)], P0 = Float64Array.from(P);
  for (let it = 0; it < iters; it++) {
    faces();
    // fit each panel's plane (area weighted, normals lined up with the panel's first triangle)
    const PN = new Float64Array(R.length * 3), PD = new Float64Array(R.length), PA = new Float64Array(R.length), ref = new Int32Array(R.length).fill(-1);
    for (let f = 0; f < nt; f++) {
      const r = reg[f]; if (ref[r] < 0) ref[r] = f; const e = ref[r];
      const sg = fN[f * 3] * fN[e * 3] + fN[f * 3 + 1] * fN[e * 3 + 1] + fN[f * 3 + 2] * fN[e * 3 + 2] < 0 ? -1 : 1;
      for (let k = 0; k < 3; k++) PN[r * 3 + k] += sg * fN[f * 3 + k] * fA[f];
    }
    for (let r = 0; r < R.length; r++) { const l = Math.hypot(PN[r * 3], PN[r * 3 + 1], PN[r * 3 + 2]) || 1; for (let k = 0; k < 3; k++) PN[r * 3 + k] /= l; }
    for (let f = 0; f < nt; f++) { const r = reg[f]; PD[r] += fA[f] * (PN[r * 3] * fC[f * 3] + PN[r * 3 + 1] * fC[f * 3 + 1] + PN[r * 3 + 2] * fC[f * 3 + 2]); PA[r] += fA[f]; }
    for (let r = 0; r < R.length; r++) PD[r] /= PA[r] || 1;
    // move each corner onto its panels' planes (least squares; a little pull to where it started keeps it steady)
    for (const v of used) {
      const lam = 0.02, A = [lam, 0, 0, 0, lam, 0, 0, 0, lam], b = [lam * P0[v * 3], lam * P0[v * 3 + 1], lam * P0[v * 3 + 2]];
      for (const r of vReg[v]) {
        const n = [PN[r * 3], PN[r * 3 + 1], PN[r * 3 + 2]], w = 1;
        for (let i = 0; i < 3; i++) { b[i] += w * n[i] * PD[r]; for (let j = 0; j < 3; j++) A[i * 3 + j] += w * n[i] * n[j]; }
      }
      const x = solve3(A, b); if (!x) continue;
      // (never move a corner far: a bad fit at a crowded corner shouldn't tear the shape)
      const dx = x[0] - P0[v * 3], dy = x[1] - P0[v * 3 + 1], dz = x[2] - P0[v * 3 + 2], m = Math.hypot(dx, dy, dz), cap = 0.04, s = m > cap ? cap / m : 1;
      P[v * 3] = P0[v * 3] + dx * s; P[v * 3 + 1] = P0[v * 3 + 1] + dy * s; P[v * 3 + 2] = P0[v * 3 + 2] + dz * s;
    }
  }
  faces();
  const keepI = [];
  for (let f = 0; f < nt; f++) if (fA[f] > 1e-6) keepI.push(I[f * 3], I[f * 3 + 1], I[f * 3 + 2]);
  console.log(`flat panels: ${R.length} panels from ${nt} triangles (${nt - keepI.length / 3} squashed ones dropped)`);
  return keepI;
}
function solve3(A, b) {
  const [a, B, c, d, e, f, g, h, i] = A, det = a * (e * i - f * h) - B * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  return [(b[0] * (e * i - f * h) - B * (b[1] * i - f * b[2]) + c * (b[1] * h - e * b[2])) / det,
    (a * (b[1] * i - f * b[2]) - b[0] * (d * i - f * g) + c * (d * b[2] - b[1] * g)) / det,
    (a * (e * b[2] - b[1] * h) - B * (d * b[2] - b[1] * g) + b[0] * (d * h - e * g)) / det];
}
