// =====================================================================
//  Turns a real car model (.glb) into a PolyWeave car: low-poly (vertex clustering on a grid, flat faces),
//  coloured with the game's own material slots, wheels split out so they spin / steer.
//  Usage:  node tools/convert-glb.js <model.glb> <out.js> <config.json> [stats]
//   config: { "global": "GT3_IMPORT", "length": 4.535, "cell": 0.035, "wheelCell": 0.02,
//             "slots": { "<material index>": "PAINT" | "GLASS" | ... | "DROP" }, "wheelMats": [ids], "cabinMats": [ids] }
//  stats: prints each material's triangle count, size and position on the car (to fill in "slots").
//  Output: assets/<name>.js setting window.<global> = { bounds, body, wheels, cabin } (same format as the M4 import:
//  triangle soups per slot, Int16 millimetres in base64).
// =====================================================================
const fs = require('fs');
const [, , inFile, outFile, cfgFile, mode] = process.argv;
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const b = fs.readFileSync(inFile);
const jsonLen = b.readUInt32LE(12), J = JSON.parse(b.toString('utf8', 20, 20 + jsonLen));
const binStart = 20 + jsonLen + 8, BIN = b.subarray(binStart);

// ---- matrices ----
const mul = (a, c) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * c[j * 4 + k]; return o; };
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
const xf = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
// ---- accessors ----
function read(ai) {
  const a = J.accessors[ai], bv = J.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const C = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * C.BYTES_PER_ELEMENT;
  const out = new Array(a.count);
  const dv = new DataView(BIN.buffer, BIN.byteOffset + off);
  for (let i = 0; i < a.count; i++) {
    const v = [];
    for (let k = 0; k < n; k++) {
      const o = i * stride + k * C.BYTES_PER_ELEMENT;
      v.push(C === Float32Array ? dv.getFloat32(o, true) : C === Uint32Array ? dv.getUint32(o, true) : C === Uint16Array ? dv.getUint16(o, true) : dv.getUint8(o));
    }
    out[i] = n === 1 ? v[0] : v;
  }
  return out;
}
// ---- every triangle in world space, with its material and which top-level part it belongs to ----
const tris = [];          // [ax,ay,az, bx,by,bz, cx,cy,cz, mat, part]
function walk(ni, m, part) {
  const n = J.nodes[ni], w = mul(m, local(n));
  if (n.mesh !== undefined) for (const p of J.meshes[n.mesh].primitives) {
    const P = read(p.attributes.POSITION), idx = p.indices !== undefined ? read(p.indices) : P.map((_, i) => i);
    for (let i = 0; i < idx.length; i += 3) {
      const a = xf(w, ...P[idx[i]]), c = xf(w, ...P[idx[i + 1]]), d = xf(w, ...P[idx[i + 2]]);
      tris.push([...a, ...c, ...d, p.material, part]);
    }
  }
  (n.children || []).forEach(c => walk(c, w, part === null ? ni : part));
}
const top = J.nodes[J.nodes[J.nodes[J.scenes[J.scene || 0].nodes[0]].children[0]].children[0]];   // Sketchfab_model > root > GLTF_SceneRootNode
const rootM = mul(mul(local(J.nodes[J.scenes[0].nodes[0]]), local(J.nodes[J.nodes[J.scenes[0].nodes[0]].children[0]])), local(top));
for (const c of top.children) walk(c, rootM, null);
// ---- into the car's frame: y up, length along z, front at -z, ground at 0, centred ----
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const t of tris) for (let k = 0; k < 9; k++) { mn[k % 3] = Math.min(mn[k % 3], t[k]); mx[k % 3] = Math.max(mx[k % 3], t[k]); }
const ext = mx.map((v, i) => v - mn[i]);
const lenAx = ext[0] > ext[2] ? 0 : 2, upAx = 1, sideAx = lenAx === 0 ? 2 : 0;
const scale = cfg.length / ext[lenAx];
// which end is the back: the red tail lights (cfg.tailMat) sit there
const tail = cfg.tailMat;
let tailPos = 0, tn = 0;
for (const t of tris) if (t[9] === tail) { tailPos += (t[lenAx] + t[3 + lenAx] + t[6 + lenAx]) / 3; tn++; }
const mid = (mn[lenAx] + mx[lenAx]) / 2, tailSign = tn ? Math.sign(tailPos / tn - mid) : 1;   // +: tail toward +axis
const cs = [(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2];
// game frame: x right, y up, z = -forward. Front is the end without tail lights -> must map to -z
const toCar = (x, y, z) => {
  const p = [x - cs[0], y - cs[1], z - cs[2]];
  const L = p[lenAx] * tailSign, S = p[sideAx], U = p[upAx];   // L: + toward the tail
  return [S * scale * (lenAx === 0 ? tailSign : -tailSign), U * scale, L * scale];
};
for (const t of tris) for (let k = 0; k < 9; k += 3) { const v = toCar(t[k], t[k + 1], t[k + 2]); t[k] = v[0]; t[k + 1] = v[1]; t[k + 2] = v[2]; }
// a mirrored turn (determinant < 0) flips every triangle inside out: swap two corners back
{ const o = toCar(0, 0, 0), ex = toCar(1, 0, 0).map((v, i) => v - o[i]), ey = toCar(0, 1, 0).map((v, i) => v - o[i]), ez = toCar(0, 0, 1).map((v, i) => v - o[i]);
  const det = ex[0] * (ey[1] * ez[2] - ey[2] * ez[1]) - ex[1] * (ey[0] * ez[2] - ey[2] * ez[0]) + ex[2] * (ey[0] * ez[1] - ey[1] * ez[0]);
  if (det < 0) for (const t of tris) for (let k = 0; k < 3; k++) { const a = t[3 + k]; t[3 + k] = t[6 + k]; t[6 + k] = a; } }

if (mode === 'stats') {
  const S = {};
  for (const t of tris) {
    const m = t[9], s = S[m] || (S[m] = { n: 0, mn: [9, 9, 9], mx: [-9, -9, -9], parts: new Set() });
    s.n++; s.parts.add(t[10]);
    for (let k = 0; k < 9; k++) { s.mn[k % 3] = Math.min(s.mn[k % 3], t[k]); s.mx[k % 3] = Math.max(s.mx[k % 3], t[k]); }
  }
  const M = J.materials;
  console.log('car size', ext.map(v => (v * scale).toFixed(2)).join(' x '), 'tailSign', tailSign, 'lenAx', lenAx);
  for (const m of Object.keys(S).sort((a, b) => a - b)) {
    const s = S[m], mat = M[m], pb = mat.pbrMetallicRoughness || {}, f = v => v.map(x => x.toFixed(2)).join(',');
    console.log(`${m.padStart(2)} ${mat.name.padEnd(13)} tris ${String(s.n).padStart(7)} col ${pb.baseColorFactor ? f(pb.baseColorFactor) : '-'} em ${mat.emissiveFactor ? f(mat.emissiveFactor) : '-'} met ${pb.metallicFactor ?? '-'} rough ${pb.roughnessFactor ?? '-'} ${mat.alphaMode || ''}  x ${s.mn[0].toFixed(2)}..${s.mx[0].toFixed(2)} y ${s.mn[1].toFixed(2)}..${s.mx[1].toFixed(2)} z ${s.mn[2].toFixed(2)}..${s.mx[2].toFixed(2)} parts ${s.parts.size}`);
  }
  process.exit(0);
}

// ---- wheels: the parts made of wheel materials, grouped by corner ----
const wheelMats = new Set(cfg.wheelMats), cabinMats = new Set(cfg.cabinMats || []);
const corner = t => { const x = (t[0] + t[3] + t[6]) / 3, z = (t[2] + t[5] + t[8]) / 3; return (x > 0 ? 1 : 0) + (z < 0 ? 2 : 0); };   // bit0 right, bit1 front
const W = [[], [], [], []], body = [], cabin = [];
for (const t of tris) {
  const slot = cfg.slots[t[9]];
  if (slot === 'DROP') continue;
  if (wheelMats.has(t[9])) { W[corner(t)].push(t); continue; }
  if (cfg.bodyLift) { t[1] += cfg.bodyLift; t[4] += cfg.bodyLift; t[7] += cfg.bodyLift; }   // (body higher on its wheels)
  if (cabinMats.has(t[9])) cabin.push(t);
  else body.push(t);
}
// ---- game-style body measured from the model (cfg.loft = { step, rays }): slice the car every `step` m, cast
// `rays` rays from the middle of each slice out to its outer surface (right half, bottom to top), and loft a clean
// boxy body through those points; each face takes the material the model has there ----
function loftFromModel(list, step, rays) {
  let zmn = 9, zmx = -9;
  for (const t of list) for (let k = 2; k < 9; k += 3) { zmn = Math.min(zmn, t[k]); zmx = Math.max(zmx, t[k]); }
  const n = Math.max(4, Math.round((zmx - zmn) / step)), Z = [];
  for (let i = 0; i <= n; i++) Z.push(zmn + 0.004 + (zmx - zmn - 0.008) * i / n);
  // bucket triangles by z range for quick slicing
  const slice = z => {
    const seg = [];
    for (const t of list) {
      const p = [[t[0], t[1], t[2]], [t[3], t[4], t[5]], [t[6], t[7], t[8]]], s = p.map(v => v[2] - z);
      if ((s[0] > 0 && s[1] > 0 && s[2] > 0) || (s[0] < 0 && s[1] < 0 && s[2] < 0)) continue;
      const pts = [];
      for (let a = 0; a < 3; a++) { const b2 = (a + 1) % 3; if ((s[a] > 0) !== (s[b2] > 0)) { const k = s[a] / (s[a] - s[b2]); pts.push([Math.abs(p[a][0] + (p[b2][0] - p[a][0]) * k), p[a][1] + (p[b2][1] - p[a][1]) * k]); } }
      if (pts.length === 2) seg.push([pts[0], pts[1], t[9]]);
    }
    return seg;
  };
  const rings = Z.map(z => {
    const seg = slice(z);
    if (!seg.length) return null;
    let y0 = 9, y1 = -9; for (const [a, b2] of seg) { y0 = Math.min(y0, a[1], b2[1]); y1 = Math.max(y1, a[1], b2[1]); }
    const cy = (y0 + y1) / 2, ring = [];
    for (let i = 0; i <= rays; i++) {
      const ang = -Math.PI / 2 + Math.PI * i / rays, dx = Math.cos(ang), dy = Math.sin(ang);
      let best = -1, mat = null;
      for (const [a, b2, m] of seg) {                     // farthest crossing of this ray with the outline
        const ex = b2[0] - a[0], ey = b2[1] - a[1], den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) continue;
        const ax = a[0], ay = a[1] - cy, tr = (ax * ey - ay * ex) / den, u = (ax * dy - ay * dx) / den;
        if (tr > 0 && u >= 0 && u <= 1 && tr > best) { best = tr; mat = m; }
      }
      ring.push(best > 0 ? [dx * best, cy + dy * best, mat] : null);
    }
    for (let i = 0; i < ring.length; i++) if (!ring[i]) ring[i] = ring[i - 1] || ring.find(r => r);   // (gaps: take the neighbour)
    ring[0][0] = 0; ring[ring.length - 1][0] = 0;                                             // (centre line)
    return { z, ring };
  }).filter(Boolean);
  const out = [], push = (a, b2, c, m) => out.push([...a, ...b2, ...c, m, 0]);
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    for (let k = 0; k < rays; k++) for (const sg of [1, -1]) {
      const p = [sg * A.ring[k][0], A.ring[k][1], A.z], q = [sg * A.ring[k + 1][0], A.ring[k + 1][1], A.z];
      const r = [sg * B.ring[k + 1][0], B.ring[k + 1][1], B.z], s = [sg * B.ring[k][0], B.ring[k][1], B.z];
      const m = A.ring[k + 1][2] ?? A.ring[k][2];
      // (front at -z: winding so faces look outward)
      if (sg > 0) { push(p, q, r, m); push(p, r, s, m); } else { push(p, r, q, m); push(p, s, r, m); }
    }
  }
  for (const [R, flip] of [[rings[0], false], [rings[rings.length - 1], true]]) {          // end caps
    const pts = [...R.ring.map(v => [v[0], v[1], R.z, v[2]]), ...R.ring.slice(1, -1).reverse().map(v => [-v[0], v[1], R.z, v[2]])];
    let cx = 0, cy2 = 0; for (const v of pts) { cx += v[0]; cy2 += v[1]; } const c = [cx / pts.length, cy2 / pts.length, R.z];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b2 = pts[(i + 1) % pts.length]; if (flip) push(c, a.slice(0, 3), b2.slice(0, 3), a[3]); else push(c, b2.slice(0, 3), a.slice(0, 3), a[3]); }
  }
  return out;
}
// ---- low poly: snap every corner to a grid, merge, drop the triangles that collapse ----
function cluster(list, cell) {
  const key = (x, y, z) => `${Math.round(x / cell)},${Math.round(y / cell)},${Math.round(z / cell)}`;
  const acc = new Map();                       // cell -> averaged position (so the shape stays put)
  for (const t of list) for (let k = 0; k < 9; k += 3) {
    const kk = key(t[k], t[k + 1], t[k + 2]), a = acc.get(kk) || [0, 0, 0, 0];
    a[0] += t[k]; a[1] += t[k + 1]; a[2] += t[k + 2]; a[3]++; acc.set(kk, a);
  }
  const seen = new Set(), out = [];
  for (const t of list) {
    const ks = [0, 3, 6].map(k => key(t[k], t[k + 1], t[k + 2]));
    if (ks[0] === ks[1] || ks[1] === ks[2] || ks[0] === ks[2]) continue;
    const id = ks.slice().sort().join('|') + '|' + t[9];
    if (seen.has(id)) continue; seen.add(id);
    const v = ks.map(kk => { const a = acc.get(kk); return [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    out.push([...v[0], ...v[1], ...v[2], t[9], t[10]]);
  }
  return out;
}
// ---- or a proper simplifier (cfg.simplify: { lib: <meshoptimizer package folder>, ratio, error (m) }): per material,
// borders locked so neighbouring parts stay joined; clean flat facets instead of the grid's wrinkles ----
let MS = null;
function simplify(list, ratio, err) {
  if (cfg.simplify.merged) return simplifyMerged(list, ratio, err);
  const out = [], byMat = new Map();
  for (const t of list) { const k = t[9]; (byMat.get(k) || byMat.set(k, []).get(k)).push(t); }
  for (const [mat, ts] of byMat) {
    const map = new Map(), pos = [], idx = new Uint32Array(ts.length * 3);
    ts.forEach((t, i) => { for (let c = 0; c < 3; c++) {
      const x = t[c * 3], y = t[c * 3 + 1], z = t[c * 3 + 2], key = `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
      let v = map.get(key); if (v === undefined) { v = pos.length / 3; map.set(key, v); pos.push(x, y, z); }
      idx[i * 3 + c] = v;
    } });
    const P = new Float32Array(pos), target = Math.max(3, Math.floor(ts.length * ratio) * 3);
    const [res] = ts.length < 8 ? [idx] : MS.simplify(idx, P, 3, target, err, ['LockBorder', 'ErrorAbsolute']);
    for (let i = 0; i < res.length; i += 3) {
      const a = res[i] * 3, b2 = res[i + 1] * 3, c = res[i + 2] * 3;
      out.push([P[a], P[a + 1], P[a + 2], P[b2], P[b2 + 1], P[b2 + 2], P[c], P[c + 1], P[c + 2], mat, 0]);
    }
  }
  return out;
}
// the whole thing as one mesh (big chunky faces right across part / material edges): each corner remembers the
// material most of its triangles had, and a new face takes its corners' most common material
function simplifyMerged(list, ratio, err) {
  const map = new Map(), pos = [], votes = [], idx = new Uint32Array(list.length * 3);
  list.forEach((t, i) => { for (let c = 0; c < 3; c++) {
    const x = t[c * 3], y = t[c * 3 + 1], z = t[c * 3 + 2], key = `${Math.round(x * 1e3)},${Math.round(y * 1e3)},${Math.round(z * 1e3)}`;
    let v = map.get(key); if (v === undefined) { v = pos.length / 3; map.set(key, v); pos.push(x, y, z); votes.push(new Map()); }
    const area = Math.hypot(...[0, 1, 2].map(k => { const a = [t[3] - t[0], t[4] - t[1], t[5] - t[2]], b2 = [t[6] - t[0], t[7] - t[1], t[8] - t[2]]; return a[(k + 1) % 3] * b2[(k + 2) % 3] - a[(k + 2) % 3] * b2[(k + 1) % 3]; }));
    votes[v].set(t[9], (votes[v].get(t[9]) || 0) + area);
    idx[i * 3 + c] = v;
  } });
  const vmat = votes.map(m => { let best = 0, bw = -1; for (const [k, w] of m) if (w > bw) { bw = w; best = k; } return best; });
  const P = new Float32Array(pos), [res] = MS.simplify(idx, P, 3, Math.floor(list.length * ratio) * 3, err, ['ErrorAbsolute']);
  const out = [];
  for (let i = 0; i < res.length; i += 3) {
    const vs = [res[i], res[i + 1], res[i + 2]], ms = vs.map(v => vmat[v]);
    const mat = ms[0] === ms[1] || ms[0] === ms[2] ? ms[0] : ms[1] === ms[2] ? ms[1] : ms[0];
    out.push([...vs.flatMap(v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]), mat, 0]);
  }
  return out;
}
// (simplify.preCell: weld everything on a fine grid first, so separate panels join up and can be simplified together)
const reduce = (list, cell, scale = 1) => (MS ? simplify(cfg.simplify.preCell ? cluster(list, cfg.simplify.preCell) : list, cfg.simplify.ratio * scale, cfg.simplify.error) : cluster(list, cell));
const enc = list => {                          // Int16 millimetres, base64 (as the M4 import)
  const a = new Int16Array(list.length * 9);
  list.forEach((t, i) => { for (let k = 0; k < 9; k++) a[i * 9 + k] = Math.round(t[k] * 1000); });
  return Buffer.from(a.buffer).toString('base64');
};
const bySlot = list => { const g = {}; for (const t of list) { const s = cfg.slots[t[9]] || 'TRIM'; (g[s] || (g[s] = [])).push(t); } const o = {}; for (const s in g) o[s] = enc(g[s]); return o; };
(async () => {
if (cfg.simplify) { MS = require(cfg.simplify.lib + '/meshopt_simplifier.js'); await MS.ready; }
const lowBody = cfg.loft ? loftFromModel(body, cfg.loft.step, cfg.loft.rays) : reduce(body, cfg.cell), lowCabin = reduce(cabin, cfg.cell * 1.3, 0.6);
const wheels = W.map(list => {
  let mnw = [9, 9, 9], mxw = [-9, -9, -9];
  for (const t of list) for (let k = 0; k < 9; k++) { mnw[k % 3] = Math.min(mnw[k % 3], t[k]); mxw[k % 3] = Math.max(mxw[k % 3], t[k]); }
  const c = mnw.map((v, i) => (v + mxw[i]) / 2), r = (mxw[1] - mnw[1]) / 2;
  const loc = reduce(list, cfg.wheelCell, cfg.simplify ? cfg.simplify.wheelRatio / cfg.simplify.ratio : 1).map(t => { const o = t.slice(); for (let k = 0; k < 9; k += 3) { o[k] -= c[0]; o[k + 1] -= c[1]; o[k + 2] -= c[2]; } return o; });
  return { center: c.map(v => +v.toFixed(4)), radius: +r.toFixed(4), parts: bySlot(loc), tris: loc.length };
});
let bmn = [9, 9, 9], bmx = [-9, -9, -9];
for (const t of lowBody) for (let k = 0; k < 9; k++) { bmn[k % 3] = Math.min(bmn[k % 3], t[k]); bmx[k % 3] = Math.max(bmx[k % 3], t[k]); }
const D = { bounds: { min: bmn.map(v => +v.toFixed(4)), max: bmx.map(v => +v.toFixed(4)) }, body: bySlot(lowBody), cabin: bySlot(lowCabin),
  wheels: wheels.map(w => (cfg.loft ? { center: w.center, radius: w.radius } : { center: w.center, radius: w.radius, parts: w.parts })), credit: cfg.credit };
const head = `// ${cfg.title} - converted by tools/convert-glb.js (low poly, game colours)\n// ${cfg.credit}\n`;
fs.writeFileSync(outFile, head + `window.${cfg.global} = ${JSON.stringify(D)};\n`);
console.log(`body ${body.length} -> ${lowBody.length} tris, cabin ${cabin.length} -> ${lowCabin.length}, wheels ${wheels.map(w => w.tris).join(' / ')}`,
  `size ${bmx.map((v, i) => (v - bmn[i]).toFixed(2)).join(' x ')}, file ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`);
})();
