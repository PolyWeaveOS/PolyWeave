'use strict';
// =====================================================================
//  A real car model (.glb) -> a Film car (assets/<key>.js), 1:1: the model's own shape, only made lighter (corners
//  snapped to a fine grid), coloured with the game's material slots (texture colours sampled where the model uses them), the four wheels split out so they spin / steer. Same file format
//  as the owner's Koenigsegg (window.<KEY>_IMPORT = { bounds, body, wheels, cabin }: triangles per slot, Int16 mm, base64).
//  Usage:  node tools/convert-car.js <model.glb> <out.js> <config.json> [stats]
//   config: { "global": "GT3_IMPORT", "title", "credit", "length": 4.57 (real length, m), "front": "+z" | "-z" | "+x" | "-x"
//             (optional: which way the nose points in the file; otherwise the end without the red tail lights),
//             "lens": 1.9 (optional: window glass this far from the middle, m, is a clear lamp cover),
//             "bodyTris": 45000, "cabinTris": 6000, "wheelTris": 2500, "rimFrac": 0.78,
//             "rules": [["<regex>", "<SLOT | W:SLOT (a wheel part) | LIGHT | SAMPLE (texture colour) | DROP>"]] }
//   stats: prints every material with the slot it gets and where it is on the car (to check / fill in the rules).
// =====================================================================
const fs = require('fs');
const [, , inFile, outFile, cfgFile, mode] = process.argv;
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const b = fs.readFileSync(inFile);
let J = null, BIN = null;
for (let o = 12; o + 8 <= b.length;) {
  const len = b.readUInt32LE(o), type = b.readUInt32LE(o + 4);
  if (type === 0x4E4F534A) J = JSON.parse(b.toString('utf8', o + 8, o + 8 + len)); else if (type === 0x004E4942) BIN = b.subarray(o + 8, o + 8 + len);
  o += 8 + len;
}

// ---- every triangle in world space, with its material ----
const mul = (a, c) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * c[j * 4 + k]; return o; };
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
const xf = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
function read(ai) {
  const a = J.accessors[ai], bv = J.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const size = { 5126: 4, 5125: 4, 5123: 2, 5122: 2, 5121: 1, 5120: 1 }[a.componentType];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * size, dv = new DataView(BIN.buffer, BIN.byteOffset + off);
  const get = o => a.componentType === 5126 ? dv.getFloat32(o, true) : a.componentType === 5125 ? dv.getUint32(o, true) : a.componentType === 5123 ? dv.getUint16(o, true)
    : a.componentType === 5122 ? dv.getInt16(o, true) : a.componentType === 5121 ? dv.getUint8(o) : dv.getInt8(o);
  const out = new Array(a.count);
  for (let i = 0; i < a.count; i++) { if (n === 1) { out[i] = get(i * stride); continue; } const v = []; for (let k = 0; k < n; k++) v.push(get(i * stride + k * size)); out[i] = v; }
  return out;
}
// ---- textures (PNG): a part's real colour where the model paints it from a texture (palette atlases, lamp sheets) ----
function decodePNG(buf) {
  const zlib = require('zlib'); let o = 8, w, h, bd, ct, plte = null; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; if (d[12]) throw new Error('interlaced'); }
    else if (type === 'PLTE') plte = d; else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (bd !== 8) throw new Error('bit depth ' + bd);
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct], stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], s = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, bb = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = s[x];
      if (f === 1) v += a; else if (f === 2) v += bb; else if (f === 3) v += (a + bb) >> 1;
      else if (f === 4) { const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return (u, v) => {
    u -= Math.floor(u); v -= Math.floor(v);
    const i = (Math.min(h - 1, Math.floor(v * h)) * w + Math.min(w - 1, Math.floor(u * w))) * bpp;
    if (ct === 3) return [plte[px[i] * 3] / 255, plte[px[i] * 3 + 1] / 255, plte[px[i] * 3 + 2] / 255];
    if (ct === 0 || ct === 4) return [px[i] / 255, px[i] / 255, px[i] / 255];
    return [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
  };
}
const texOf = [];                                              // per material: a sampler (u, v) -> [r, g, b], or null
J.materials.forEach((m, i) => {
  const pb = m.pbrMetallicRoughness || {}, t = pb.baseColorTexture, f = pb.baseColorFactor || [1, 1, 1, 1];
  texOf[i] = null;
  if (!t || !J.textures[t.index]) return;
  const img = J.images[J.textures[t.index].source]; if (!img || img.bufferView === undefined || (img.mimeType && img.mimeType !== 'image/png')) return;
  const bv = J.bufferViews[img.bufferView];
  try { const s = decodePNG(BIN.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)); texOf[i] = { at: (u, v) => s(u, v).map((c, k) => c * f[k]), uv: t.texCoord || 0 }; } catch (e) { /* (not readable: rules only) */ }
});
const tris = [];                                               // [ax,ay,az, bx,by,bz, cx,cy,cz, material, slot, rgb, normals (9) | null]
// normals go through the inverse transpose of the node's turn / scale (its cofactors: the same direction)
function nrmXf(m) {
  const [a, b, c] = [m[0], m[1], m[2]], [d, e, f] = [m[4], m[5], m[6]], [g, h, i] = [m[8], m[9], m[10]];
  const C = [e * i - h * f, h * c - b * i, b * f - e * c, g * f - d * i, a * i - g * c, d * c - a * f, d * h - g * e, g * b - a * h, a * e - d * b];
  const s = Math.sign(a * C[0] + d * C[1] + g * C[2]) || 1;
  return v => { const x = (C[0] * v[0] + C[1] * v[1] + C[2] * v[2]) * s, y = (C[3] * v[0] + C[4] * v[1] + C[5] * v[2]) * s, z = (C[6] * v[0] + C[7] * v[1] + C[8] * v[2]) * s, l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
}
function walk(ni, m) {
  const n = J.nodes[ni], w = mul(m, local(n)), nx = nrmXf(w);
  if (n.mesh !== undefined) for (const p of J.meshes[n.mesh].primitives) {
    if (p.mode !== undefined && p.mode !== 4) continue;       // (triangles only)
    const P = read(p.attributes.POSITION), idx = p.indices !== undefined ? read(p.indices) : P.map((_, i) => i);
    const N = p.attributes.NORMAL !== undefined ? read(p.attributes.NORMAL) : null;
    const T = p.material !== undefined && texOf[p.material], UV = T && p.attributes['TEXCOORD_' + T.uv] !== undefined ? read(p.attributes['TEXCOORD_' + T.uv]) : null;
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const t = [...xf(w, P[idx[i]]), ...xf(w, P[idx[i + 1]]), ...xf(w, P[idx[i + 2]]), p.material ?? -1, null, null,
        N ? [...nx(N[idx[i]]), ...nx(N[idx[i + 1]]), ...nx(N[idx[i + 2]])] : null];   // (the model's own smooth shading)
      if (UV) { const a = UV[idx[i]], c = UV[idx[i + 1]], d = UV[idx[i + 2]]; t[11] = T.at((a[0] + c[0] + d[0]) / 3, (a[1] + c[1] + d[1]) / 3); }   // (its colour at the middle of the triangle)
      tris.push(t);
    }
  }
  for (const c of n.children || []) walk(c, w);
}
for (const r of J.scenes[J.scene || 0].nodes) walk(r, I4);
const matName = i => (i >= 0 && J.materials[i] && J.materials[i].name) || '';
// a colour -> the nearest game slot (SAMPLE parts): saturated red / orange / blue, else by brightness
function slotByColour(rgb, front) {
  const [r, g, bl] = rgb, mxc = Math.max(r, g, bl), mnc = Math.min(r, g, bl), sat = mxc ? (mxc - mnc) / mxc : 0, lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  if (sat > 0.45 && mxc > 0.25) {
    let hue = mxc === r ? ((g - bl) / (mxc - mnc)) * 60 : mxc === g ? (2 + (bl - r) / (mxc - mnc)) * 60 : (4 + (r - g) / (mxc - mnc)) * 60; if (hue < 0) hue += 360;
    if (hue < 18 || hue > 335) return 'TAIL'; if (hue < 50) return 'AMBER'; if (hue < 70) return 'CALIPER'; return 'TRIM';
  }
  if (lum > 0.82) return front === undefined ? 'WHITE' : front ? 'HEAD' : 'WHITE';
  if (lum > 0.42) return 'CHROME'; if (lum > 0.16) return 'TRIM'; return 'DARK';
}

// ---- material -> game slot (the config's rules first, then these) ----
const RULES = [...(cfg.rules || []), ...[
  ['red_?glass|red_lights|tail_?light|rear_?light', 'TAIL'], ['orange_lights|indicator|amber', 'AMBER'],
  ['tyre|tire', 'W:TIRE'], ['brake.?dis[ck]|rotor', 'W:METAL'], ['wheel|rim|hubcap', 'W:RIM'],
  ['cal+iper|brake', 'CALIPER'],
  ['window|glass', 'GLASS'], ['front_light_lens|lens', 'HEADLENS'], ['front_light|headlight', 'HEAD'], ['light', 'LIGHT'],
  ['paint|^body$|_ext$', 'PAINT'], ['carbon', 'CARBON'], ['chrome|mirror|alumin|exhaust|gold', 'CHROME'], ['badge|emblem', 'CHROME'],
  ['plate', 'PLATE'], ['interior|_cab$|engine|seat', 'INT'], ['coloured|textured', 'SAMPLE'],
]].map(([re, s]) => [new RegExp(re, 'i'), s]);
// (anything else: its texture's colour if it has one - grilles, trim sheets - or dark: base, underside)
const slotOf = i => { const n = matName(i); for (const [re, s] of RULES) if (re.test(n)) return s; return texOf[i] ? 'SAMPLE' : 'DARK'; };
const SLOTS = J.materials.map((_, i) => slotOf(i));

// ---- into the game's frame: x right, y up, z along (nose toward -z), real length, wheels on the ground ----
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const t of tris) for (let k = 0; k < 9; k++) { mn[k % 3] = Math.min(mn[k % 3], t[k]); mx[k % 3] = Math.max(mx[k % 3], t[k]); }
const ext = mx.map((v, i) => v - mn[i]), lenAx = ext[0] > ext[2] ? 0 : 2, sideAx = lenAx === 0 ? 2 : 0;
const mid = (mn[lenAx] + mx[lenAx]) / 2;
let tailSign;                                                  // + : the tail is toward +lenAx in the file
if (cfg.front) tailSign = cfg.front[0] === '+' ? -1 : 1;
else { let s = 0, n = 0; for (const t of tris) if (SLOTS[t[9]] === 'TAIL') { s += (t[lenAx] + t[3 + lenAx] + t[6 + lenAx]) / 3; n++; } tailSign = n ? Math.sign(s / n - mid) || 1 : 1; }
const scale = cfg.length / ext[lenAx], cs = [(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2];
// facing the nose (-z), right is +x: the file's side axis turned so the frame keeps its handedness
const sideSign = lenAx === 2 ? tailSign : -tailSign;
const toCar = p => { const q = [p[0] - cs[0], p[1] - cs[1], p[2] - cs[2]]; return [q[sideAx] * scale * sideSign, q[1] * scale, q[lenAx] * scale * tailSign]; };
const nrmCar = n => [n[sideAx] * sideSign, n[1], n[lenAx] * tailSign];   // (the same turn, for directions)
for (const t of tris) {
  for (let k = 0; k < 9; k += 3) { const v = toCar([t[k], t[k + 1], t[k + 2]]); t[k] = v[0]; t[k + 1] = v[1]; t[k + 2] = v[2]; }
  if (t[12]) for (let k = 0; k < 9; k += 3) { const v = nrmCar([t[12][k], t[12][k + 1], t[12][k + 2]]); t[12][k] = v[0]; t[12][k + 1] = v[1]; t[12][k + 2] = v[2]; }
}
{ // a mirrored turn flips the triangles inside out: swap two corners back (and their normals)
  const o = toCar([0, 0, 0]), e = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(a => toCar(a).map((v, i) => v - o[i]));
  const det = e[0][0] * (e[1][1] * e[2][2] - e[1][2] * e[2][1]) - e[0][1] * (e[1][0] * e[2][2] - e[1][2] * e[2][0]) + e[0][2] * (e[1][0] * e[2][1] - e[1][1] * e[2][0]);
  if (det < 0) for (const t of tris) for (let k = 0; k < 3; k++) {
    const a = t[3 + k]; t[3 + k] = t[6 + k]; t[6 + k] = a;
    if (t[12]) { const b2 = t[12][3 + k]; t[12][3 + k] = t[12][6 + k]; t[12][6 + k] = b2; }
  }
}
// lamps that are one material front and back: the front ones are headlights, the back ones tail lights
const cz = t => (t[2] + t[5] + t[8]) / 3, cx = t => (t[0] + t[3] + t[6]) / 3;
// (SAMPLE: the nearest slot to its texture colour there; a lamp sheet: red = tail, orange = indicator, bright = headlight
// at the front / reversing light at the back, the rest housing)
for (const t of tris) {
  let s = SLOTS[t[9]];
  if (s === 'SAMPLE') s = t[11] ? slotByColour(t[11]) : 'DARK';
  else if (s === 'LIGHT') s = t[11] ? slotByColour(t[11], cz(t) < 0) : cz(t) < 0 ? 'HEAD' : 'TAIL';
  else if (s === 'GLASS' && cfg.lens && Math.abs(cz(t)) > cfg.lens) s = 'HEADLENS';   // (lamp covers in the same material as the windows)
  t[10] = s;
}
// ground: the bottom of the tyres; centred across and along on the whole car
{ let g = 1e9, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const t of tris) for (let k = 0; k < 9; k += 3) { if (t[10].startsWith('W:')) g = Math.min(g, t[k + 1]); x0 = Math.min(x0, t[k]); x1 = Math.max(x1, t[k]); z0 = Math.min(z0, t[k + 2]); z1 = Math.max(z1, t[k + 2]); }
  if (g === 1e9) g = 0;
  const ox = (x0 + x1) / 2, oz = (z0 + z1) / 2;
  for (const t of tris) for (let k = 0; k < 9; k += 3) { t[k] -= ox; t[k + 1] -= g; t[k + 2] -= oz; } }

if (mode === 'stats') {
  const S = {};
  for (const t of tris) { const s = S[t[9]] || (S[t[9]] = { n: 0, mn: [9, 9, 9], mx: [-9, -9, -9], to: {} }); s.n++; s.to[t[10]] = (s.to[t[10]] || 0) + 1; for (let k = 0; k < 9; k++) { s.mn[k % 3] = Math.min(s.mn[k % 3], t[k]); s.mx[k % 3] = Math.max(s.mx[k % 3], t[k]); } }
  console.log('size', ext.map(v => (v * scale).toFixed(2)).join(' x '), 'tris', tris.length, 'lenAx', lenAx, 'tailSign', tailSign);
  for (const m of Object.keys(S).sort((a, c) => S[c].n - S[a].n)) { const s = S[m], f = v => v.map(x => x.toFixed(2)).join(','); console.log(String(m).padStart(3), matName(+m).slice(0, 40).padEnd(40), String(s.n).padStart(7), ' min', f(s.mn), ' max', f(s.mx), ' ->', Object.entries(s.to).map(([k, v]) => k + ':' + v).join(' ')); }
  process.exit(0);
}

// ---- the file: every triangle kept (no simplifying), the model's own normals. Binary: "PWC2", header length (uint32),
// JSON header, then the data; per slot the shared corners (same point + same normal): positions Int16 in 0.1 mm,
// normals Int8, indices Uint32. Wheels are kept around their own centre (they spin / steer there).
const Q = 10000, chunks = [];
let size = 0;
const put = arr => { while (size % 4) { chunks.push(Buffer.alloc(1)); size++; } const off = size, buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); chunks.push(buf); size += buf.length; return off; };
const q16 = v => Math.max(-32767, Math.min(32767, Math.round(v * Q)));
function pack(list, o = [0, 0, 0]) {
  const by = new Map(), out = {};
  for (const t of list) (by.get(t[10]) || by.set(t[10], []).get(t[10])).push(t);
  for (const [slot, ts] of by) {
    const map = new Map(), P = [], N = [], I = new Uint32Array(ts.length * 3);
    ts.forEach((t, j) => {
      let fn = null;
      for (let c = 0; c < 3; c++) {
        let n = t[12] ? [t[12][c * 3], t[12][c * 3 + 1], t[12][c * 3 + 2]] : null;
        if (!n || !(Math.hypot(n[0], n[1], n[2]) > 0.5)) {         // (no normal in the file: the face's own)
          if (!fn) { const u = [t[3] - t[0], t[4] - t[1], t[5] - t[2]], v = [t[6] - t[0], t[7] - t[1], t[8] - t[2]], x = u[1] * v[2] - u[2] * v[1], y = u[2] * v[0] - u[0] * v[2], z = u[0] * v[1] - u[1] * v[0], l = Math.hypot(x, y, z) || 1; fn = [x / l, y / l, z / l]; }
          n = fn;
        }
        const p = [q16(t[c * 3] - o[0]), q16(t[c * 3 + 1] - o[1]), q16(t[c * 3 + 2] - o[2])], nn = n.map(x => Math.round(x * 127));
        const key = p.join(',') + '|' + nn.join(',');
        let k = map.get(key); if (k === undefined) { k = P.length / 3; map.set(key, k); P.push(...p); N.push(...nn); }
        I[j * 3 + c] = k;
      }
    });
    out[slot] = { n: P.length / 3, tris: ts.length, pos: put(Int16Array.from(P)), nrm: put(Int8Array.from(N)), idx: put(I) };
  }
  return out;
}
const body = [], W = [[], [], [], []];
for (const t of tris) {
  if (t[10] === 'DROP') continue;
  if (t[10].startsWith('W:')) { t[10] = t[10].slice(2); W[(cx(t) > 0 ? 1 : 0) + (cz(t) < 0 ? 2 : 0)].push(t); }
  else body.push(t);
}
let bmn = [9, 9, 9], bmx = [-9, -9, -9];
for (const t of body) for (let k = 0; k < 9; k++) { bmn[k % 3] = Math.min(bmn[k % 3], t[k]); bmx[k % 3] = Math.max(bmx[k % 3], t[k]); }
const bodyPack = pack(body);
const wheels = W.map(list => {
  let a = [9, 9, 9], c = [-9, -9, -9];
  for (const t of list) for (let k = 0; k < 9; k++) { a[k % 3] = Math.min(a[k % 3], t[k]); c[k % 3] = Math.max(c[k % 3], t[k]); }
  const ctr = a.map((v, i) => (v + c[i]) / 2), R = (c[1] - a[1]) / 2;
  // (tyre and rim one material in the file: the outer part - past the rim's edge - is the tyre)
  if (!list.some(t => t[10] === 'TIRE')) for (const t of list) if (t[10] === 'RIM' && Math.hypot((t[1] + t[4] + t[7]) / 3 - ctr[1], cz(t) - ctr[2]) > R * (cfg.rimFrac || 0.78)) t[10] = 'TIRE';
  return { center: ctr.map(v => +v.toFixed(4)), radius: +R.toFixed(4), width: +(c[0] - a[0]).toFixed(4), parts: pack(list, ctr), tris: list.length };
});
const order = [2, 3, 0, 1].map(i => wheels[i]);                   // (FL, FR, RL, RR, as the Koenigsegg)
const H = { v: 2, title: cfg.title, credit: cfg.credit, q: Q, bounds: { min: bmn.map(v => +v.toFixed(4)), max: bmx.map(v => +v.toFixed(4)) }, body: bodyPack,
  wheels: order.map(w => ({ center: w.center, radius: w.radius, width: w.width, parts: w.parts })) };
let hj = Buffer.from(JSON.stringify(H)); const padH = (4 - hj.length % 4) % 4; hj = Buffer.concat([hj, Buffer.alloc(padH, 32)]);
const head = Buffer.alloc(8); head.write('PWC2', 0, 'ascii'); head.writeUInt32LE(hj.length, 4);
fs.writeFileSync(outFile, Buffer.concat([head, hj, ...chunks]));
const cnt = {}; for (const t of body) cnt[t[10]] = (cnt[t[10]] || 0) + 1;
console.log(`body ${body.length} tris, wheels ${order.map(w => w.tris + ' (r ' + w.radius + ')').join(' / ')}, size ${bmx.map((v, i) => (v - bmn[i]).toFixed(2)).join(' x ')}, file ${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB`);
console.log('slots', JSON.stringify(cnt));
