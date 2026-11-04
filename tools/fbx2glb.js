'use strict';
// =====================================================================
//  A binary .fbx car model -> a .glb that tools/convert-car.js reads (some downloads only come as .fbx). 1:1: every
//  polygon (split into triangles), the file's own normals and UVs, each part placed where the file puts it, material
//  names kept, and PNG colour textures (found next to the .fbx) packed in so the converter can sample them. No dependencies.
//  Usage:  node tools/fbx2glb.js <model.fbx> <out.glb> [texture folder]
// =====================================================================
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const [, , inFile, outFile, texDirArg] = process.argv;
const B = fs.readFileSync(inFile), texDir = texDirArg || path.dirname(inFile);
if (B.toString('ascii', 0, 18) !== 'Kaydara FBX Binary') throw new Error('not a binary FBX');
const VER = B.readUInt32LE(23), BIG = VER >= 7500;

// ---- the node tree ----
function prop(o) {
  const t = String.fromCharCode(B[o]); o++;
  switch (t) {
    case 'Y': return [B.readInt16LE(o), o + 2]; case 'C': return [!!B[o], o + 1]; case 'I': return [B.readInt32LE(o), o + 4];
    case 'F': return [B.readFloatLE(o), o + 4]; case 'D': return [B.readDoubleLE(o), o + 8]; case 'L': return [Number(B.readBigInt64LE(o)), o + 8];
    case 'S': case 'R': { const n = B.readUInt32LE(o); return [t === 'S' ? B.toString('utf8', o + 4, o + 4 + n) : B.subarray(o + 4, o + 4 + n), o + 4 + n]; }
    case 'f': case 'd': case 'l': case 'i': case 'b': {
      const n = B.readUInt32LE(o), enc = B.readUInt32LE(o + 4), len = B.readUInt32LE(o + 8);
      let d = B.subarray(o + 12, o + 12 + len); if (enc === 1) d = zlib.inflateSync(d);
      const a = Buffer.from(d), out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = t === 'f' ? a.readFloatLE(i * 4) : t === 'd' ? a.readDoubleLE(i * 8) : t === 'i' ? a.readInt32LE(i * 4) : t === 'l' ? Number(a.readBigInt64LE(i * 8)) : a[i];
      return [out, o + 12 + len];
    }
  }
  throw new Error('fbx property type ' + t);
}
function node(o) {
  const end = BIG ? Number(B.readBigUInt64LE(o)) : B.readUInt32LE(o), np = BIG ? Number(B.readBigUInt64LE(o + 8)) : B.readUInt32LE(o + 4);
  o += BIG ? 24 : 12;
  if (end === 0) return [null, o + 1];
  const nl = B[o], name = B.toString('ascii', o + 1, o + 1 + nl); o += 1 + nl;
  const props = []; for (let i = 0; i < np; i++) { const [v, n] = prop(o); props.push(v); o = n; }
  const kids = [];
  while (o < end) { const [k, n] = node(o); o = n; if (!k) break; kids.push(k); }
  return [{ name, props, kids }, end];
}
const top = []; for (let o = 27; o < B.length - 200;) { const [n, e] = node(o); if (!n) break; top.push(n); o = e; }
const kid = (n, name) => n && n.kids.find(k => k.name === name), kidsOf = (n, name) => n ? n.kids.filter(k => k.name === name) : [];
const P70 = n => { const m = {}; for (const p of kidsOf(kid(n, 'Properties70'), 'P')) m[p.props[0]] = p.props.slice(4); return m; };
const clean = s => String(s).split('\u0000')[0];

// ---- objects and how they connect ----
const OBJ = new Map();
for (const o of top.find(n => n.name === 'Objects').kids) OBJ.set(o.props[0], o);
const parentOf = new Map(), childrenOf = new Map(), texFor = new Map();
for (const c of kidsOf(top.find(n => n.name === 'Connections'), 'C')) {
  const [kind, ch, par, pn] = c.props;
  if (!childrenOf.has(par)) childrenOf.set(par, []); childrenOf.get(par).push(ch);
  if (kind === 'OO' && OBJ.get(ch) && OBJ.get(ch).name === 'Model') parentOf.set(ch, par);
  if (kind === 'OP' && OBJ.get(ch) && OBJ.get(ch).name === 'Texture' && /Diffuse|BaseColor/i.test(pn || '') && !texFor.has(par)) texFor.set(par, ch);
}
const childObjs = (id, type) => (childrenOf.get(id) || []).map(i => OBJ.get(i)).filter(o => o && o.name === type);

// ---- transforms (column vectors, 4x4 column-major like glTF) ----
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a, c) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * c[j * 4 + k]; return o; };
const T = v => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1], S = v => [v[0], 0, 0, 0, 0, v[1], 0, 0, 0, 0, v[2], 0, 0, 0, 0, 1];
const neg = v => v.map(x => -x), inv = v => v.map(x => 1 / x);
function R(v, order = 0) {                                     // Euler degrees; order 0 = XYZ (x first)
  const r = v.map(x => x * Math.PI / 180), [cx, cy, cz] = r.map(Math.cos), [sx, sy, sz] = r.map(Math.sin);
  const X = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1], Y = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1], Z = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const seq = [[X, Y, Z], [X, Z, Y], [Y, Z, X], [Y, X, Z], [Z, X, Y], [Z, Y, X]][order] || [X, Y, Z];
  return mul(seq[2], mul(seq[1], seq[0]));
}
const transpose3 = m => [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];   // (inverse of a pure rotation)
const localCache = new Map();
function local(id) {
  const p = P70(OBJ.get(id)), g = (k, d) => (p[k] || d).map(Number), ord = p.RotationOrder ? +p.RotationOrder[0] : 0;
  const rp = g('RotationPivot', [0, 0, 0]), sp = g('ScalingPivot', [0, 0, 0]);
  return [T(g('Lcl Translation', [0, 0, 0])), T(g('RotationOffset', [0, 0, 0])), T(rp), R(g('PreRotation', [0, 0, 0])), R(g('Lcl Rotation', [0, 0, 0]), ord),
    transpose3(R(g('PostRotation', [0, 0, 0]))), T(neg(rp)), T(g('ScalingOffset', [0, 0, 0])), T(sp), S(g('Lcl Scaling', [1, 1, 1])), T(neg(sp))].reduce(mul);
}
function world(id) {
  if (localCache.has(id)) return localCache.get(id);
  const par = parentOf.get(id), w = mul(par && OBJ.get(par) ? world(par) : I4, local(id));
  localCache.set(id, w); return w;
}
const geomXf = id => { const p = P70(OBJ.get(id)), g = (k, d) => (p[k] || d).map(Number); return [T(g('GeometricTranslation', [0, 0, 0])), R(g('GeometricRotation', [0, 0, 0])), S(g('GeometricScaling', [1, 1, 1]))].reduce(mul); };
// the file's up axis -> +Y
const GS = P70(top.find(n => n.name === 'GlobalSettings')), up = GS.UpAxis ? +GS.UpAxis[0] : 1, upS = GS.UpAxisSign ? +GS.UpAxisSign[0] : 1;
const AXIS = up === 2 ? (upS > 0 ? [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1] : [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]) : up === 0 ? [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : upS > 0 ? I4 : S([1, -1, -1]);
const xf = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
function nrmXf(m) {
  const [a, b, c] = [m[0], m[1], m[2]], [d, e, f] = [m[4], m[5], m[6]], [g, h, i] = [m[8], m[9], m[10]];
  const C = [e * i - h * f, h * c - b * i, b * f - e * c, g * f - d * i, a * i - g * c, d * c - a * f, d * h - g * e, g * b - a * h, a * e - d * b];
  const s = Math.sign(a * C[0] + d * C[1] + g * C[2]) || 1;
  return { flip: s < 0, f: v => { const x = (C[0] * v[0] + C[1] * v[1] + C[2] * v[2]) * s, y = (C[3] * v[0] + C[4] * v[1] + C[5] * v[2]) * s, z = (C[6] * v[0] + C[7] * v[1] + C[8] * v[2]) * s, l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; } };
}

// ---- materials ----
const mats = [], matIndex = new Map(), images = [];
function material(mo) {
  const id = mo.props[0]; if (matIndex.has(id)) return matIndex.get(id);
  const p = P70(mo), dc = (p.DiffuseColor || p.Diffuse || [0.8, 0.8, 0.8]).map(Number);
  const m = { name: clean(mo.props[1]), pbrMetallicRoughness: { baseColorFactor: [dc[0], dc[1], dc[2], 1], metallicFactor: 0 } };
  const tid = texFor.get(id);
  if (tid) {
    const t = OBJ.get(tid), fn = clean((kid(t, 'RelativeFilename') || kid(t, 'FileName') || { props: [''] }).props[0]), base = path.basename(fn.replace(/\\/g, '/'));
    const file = [path.join(texDir, base), path.join(path.dirname(inFile), base), path.join(path.dirname(inFile), 'Textures', base)].find(f => base && fs.existsSync(f));
    if (file && /\.png$/i.test(file)) { m.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1]; m.pbrMetallicRoughness.baseColorTexture = { index: images.length }; images.push(fs.readFileSync(file)); }
    m.extras = { texture: base };
  }
  matIndex.set(id, mats.length); mats.push(m); return mats.length - 1;
}

// ---- meshes: polygons -> triangles, in world space ----
const prims = new Map();                                       // material -> { P, N, UV }
let polys = 0, tris = 0;
const layer = (g, name, data, idx) => { const L = kid(g, name); if (!L) return null; const d = kid(L, data), ix = kid(L, idx); return { map: clean((kid(L, 'MappingInformationType') || { props: [''] }).props[0]), ref: clean((kid(L, 'ReferenceInformationType') || { props: [''] }).props[0]), d: d ? d.props[0] : [], ix: ix ? ix.props[0] : null }; };
for (const [id, o] of OBJ) {
  if (o.name !== 'Model') continue;
  const geo = childObjs(id, 'Geometry').find(g => clean(g.props[2]) === 'Mesh'); if (!geo || !kid(geo, 'Vertices') || !kid(geo, 'PolygonVertexIndex')) continue;
  const mlist = childObjs(id, 'Material').map(material);
  const w = [AXIS, world(id), geomXf(id)].reduce(mul), nx = nrmXf(w);
  const V = kid(geo, 'Vertices').props[0], PI = kid(geo, 'PolygonVertexIndex').props[0];
  const NL = layer(geo, 'LayerElementNormal', 'Normals', 'NormalsIndex'), UL = layer(geo, 'LayerElementUV', 'UV', 'UVIndex'), ML = layer(geo, 'LayerElementMaterial', 'Materials', null);
  const get = (L, size, pv, vi, pi) => {
    if (!L || !L.d.length) return null;
    let k = L.map === 'ByPolygonVertex' ? pv : L.map === 'ByPolygon' ? pi : L.map === 'AllSame' ? 0 : vi;
    if (L.ref === 'IndexToDirect' && L.ix) k = L.ix[k];
    return k >= 0 && k * size < L.d.length ? L.d.slice(k * size, k * size + size) : null;
  };
  let start = 0, pi = 0;
  for (let i = 0; i < PI.length; i++) {
    if (PI[i] >= 0) continue;
    const corners = []; for (let j = start; j <= i; j++) { const vi = j === i ? ~PI[j] : PI[j]; corners.push({ vi, pv: j }); }
    const mm = ML && ML.d.length ? (ML.map === 'AllSame' ? ML.d[0] : ML.d[pi]) : 0, mat = mlist[mm] !== undefined ? mlist[mm] : -1;
    if (!prims.has(mat)) prims.set(mat, { P: [], N: [], UV: [] });
    const pr = prims.get(mat);
    const pt = c => ({ p: xf(w, V.slice(c.vi * 3, c.vi * 3 + 3)), n: get(NL, 3, c.pv, c.vi, pi), uv: get(UL, 2, c.pv, c.vi, pi) });
    const pts = corners.map(pt);
    for (let k = 1; k + 1 < pts.length; k++) {
      const tri = nx.flip ? [pts[0], pts[k + 1], pts[k]] : [pts[0], pts[k], pts[k + 1]];
      for (const c of tri) { pr.P.push(...c.p); pr.N.push(...(c.n ? nx.f(c.n) : [0, 0, 0])); pr.UV.push(c.uv ? c.uv[0] : 0, c.uv ? 1 - c.uv[1] : 0); }
      tris++;
    }
    polys++; pi++; start = i + 1;
  }
}

// ---- the .glb ----
const chunks = []; let size = 0; const bufferViews = [], accessors = [];
const put = (typed, extra) => { while (size % 4) { chunks.push(Buffer.alloc(1)); size++; } const b = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength); bufferViews.push({ buffer: 0, byteOffset: size, byteLength: b.length }); chunks.push(b); size += b.length; return bufferViews.length - 1; };
const acc = (arr, type, n) => { const f = Float32Array.from(arr), bv = put(f), a = { bufferView: bv, componentType: 5126, count: f.length / n, type };
  if (type === 'VEC3') { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < f.length; i++) { mn[i % 3] = Math.min(mn[i % 3], f[i]); mx[i % 3] = Math.max(mx[i % 3], f[i]); } a.min = mn; a.max = mx; }
  accessors.push(a); return accessors.length - 1; };
const primitives = [];
for (const [mat, pr] of prims) {
  if (!pr.P.length) continue;
  const p = { attributes: { POSITION: acc(pr.P, 'VEC3', 3), NORMAL: acc(pr.N, 'VEC3', 3), TEXCOORD_0: acc(pr.UV, 'VEC2', 2) }, mode: 4 };
  if (mat >= 0) p.material = mat; primitives.push(p);
}
const imgs = images.map(b => ({ bufferView: put(new Uint8Array(b.buffer, b.byteOffset, b.length)), mimeType: 'image/png' }));
const J = { asset: { version: '2.0', generator: 'PolyWeave fbx2glb' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }],
  materials: mats, accessors, bufferViews, buffers: [{ byteLength: size }], textures: imgs.map((_, i) => ({ source: i })), images: imgs };
if (!imgs.length) { delete J.textures; delete J.images; }
let js = Buffer.from(JSON.stringify(J)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 32)]);
const bin = Buffer.concat(chunks), binP = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
const h = Buffer.alloc(12); h.writeUInt32LE(0x46546C67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + binP.length, 8);
const ch = (len, type) => { const c = Buffer.alloc(8); c.writeUInt32LE(len, 0); c.writeUInt32LE(type, 4); return c; };
fs.writeFileSync(outFile, Buffer.concat([h, ch(js.length, 0x4E4F534A), js, ch(binP.length, 0x004E4942), binP]));
console.log(`FBX ${VER}, up axis ${up}${upS < 0 ? '-' : '+'}: ${polys} polygons -> ${tris} triangles, ${mats.length} materials (${images.length} PNG textures), ${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB`);
