'use strict';
// =====================================================================
//  Race tracks (Season 1 racing mode). Shared by the game and the server (lengths, names).
//  Each track is drawn as a closed outline of corner points (x right, z toward the camera / "down" on the
//  map), driven clockwise; every corner is rounded with its own radius (r, metres), like the corners of a real
//  circuit. The start / finish line sits `start` (0..1) of the way along the first side. The result is sampled
//  every STEP metres in the same form as the multiplayer loop (core.js), so the car, the road lookups
//  (ROAD.pos / project / yaw) and other players' cars all work on it unchanged.
// =====================================================================
// Layouts based on three fan-favourite Grand Prix circuits, scaled down so a lap is ~3 km. `path`: the centre line
// every ~100 m on the real circuit (x east, y north, metres, in the direction of the race, starting at the line),
// traced from public circuit outlines; `scale` shrinks it. The game smooths a curve through the points.
const TRACKS = [
  { id: 'ardennes', name: 'Ardennes Circuit', short: 'ARDENNES', desc: 'Inspired by Spa-Francorchamps: the La Source hairpin, the climb through Eau Rouge, the long Kemmel straight and fast sweepers.',
    scale: 0.5, look: ['grass', 'day'],
    path: [[0, 2], [-53, 87], [-106, 172], [-160, 256], [-191, 343], [-100, 311], [-11, 266], [71, 208], [142, 138], [210, 65], [277, -9], [355, -71], [419, -144], [445, -240],
      [501, -322], [559, -404], [613, -488], [649, -581], [680, -676], [712, -771], [743, -866], [774, -961], [806, -1056], [837, -1151], [868, -1246], [819, -1324], [831, -1420],
      [816, -1511], [737, -1571], [657, -1631], [577, -1691], [505, -1644], [571, -1575], [647, -1513], [625, -1418], [591, -1324], [567, -1226], [546, -1129], [522, -1032],
      [447, -973], [347, -975], [265, -1028], [225, -1119], [191, -1213], [157, -1307], [114, -1396], [21, -1397], [-72, -1392], [-127, -1475], [-178, -1561], [-257, -1598],
      [-340, -1543], [-399, -1467], [-379, -1370], [-333, -1281], [-268, -1205], [-196, -1136], [-110, -1085], [-24, -1036], [55, -975], [109, -891], [146, -799], [174, -703],
      [146, -608], [106, -516], [70, -423], [52, -325], [40, -226], [83, -170], [56, -87]] },
  { id: 'airfield', name: 'Airfield Circuit', short: 'AIRFIELD', desc: 'Inspired by Silverstone: an old airfield with the flat-out Maggotts-Becketts esses, Copse and long fast straights.',
    scale: 0.55, look: ['grass', 'sunset'],
    path: [[3, 0], [62, 81], [121, 162], [179, 243], [240, 321], [339, 331], [438, 326], [528, 364], [604, 429], [686, 479], [726, 389], [785, 394], [807, 491], [769, 576],
      [693, 641], [617, 706], [541, 771], [465, 836], [389, 901], [313, 966], [220, 973], [200, 877], [129, 829], [102, 913], [144, 1004], [199, 1086], [282, 1139], [381, 1155],
      [480, 1168], [579, 1180], [679, 1190], [775, 1173], [828, 1092], [855, 996], [872, 897], [880, 797], [888, 698], [931, 608], [918, 512], [908, 415], [959, 330], [918, 246],
      [838, 188], [791, 100], [746, 11], [701, -79], [655, -168], [610, -257], [565, -346], [514, -432], [456, -513], [361, -524], [302, -445], [247, -362], [178, -290], [111, -216],
      [26, -240], [-40, -168], [-49, -74]] },
  { id: 'saopaulo', name: 'Sao Paulo Circuit', short: 'SAO PAULO', desc: 'Inspired by Interlagos: run anti-clockwise, with the Senna S, a twisty infield and an uphill drag to the line.',
    scale: 0.75, look: ['grass', 'day'],
    path: [[-1, -1], [25, -97], [51, -194], [80, -289], [158, -307], [241, -288], [337, -309], [421, -260], [459, -168], [483, -71], [508, 25], [533, 122], [558, 219], [583, 316],
      [603, 413], [525, 460], [427, 452], [353, 388], [297, 306], [239, 224], [180, 144], [88, 126], [17, 190], [-1, 288], [66, 313], [141, 336], [90, 417], [41, 501], [81, 553],
      [149, 480], [243, 459], [314, 525], [366, 610], [364, 693], [269, 722], [170, 704], [80, 662], [11, 592], [-18, 497], [-40, 399], [-60, 302], [-54, 202], [-30, 106], [-3, 9]] },
];
// barriers: tarmac strips on the straights, and on the outside of every corner a gravel trap (sand) that runs from
// the braking zone to the exit, with the wall set back behind it, like a real circuit
const RUNOFF = { strip: 3, trapMax: 24, inside: 4.5, half: 7.4, kerb: 1.3 };
const TRACK_BY_ID = Object.fromEntries(TRACKS.map(t => [t.id, t]));
const RACE_LAPS = 3, RACE_MAX = 10, RACE_MIN = 2, RACE_COUNTDOWN = 60;

// the outline as a path: straights between corners, each corner a circular arc of its radius (shrunk if the
// sides next to it are too short for it). Returns dense points every ~0.5 m starting at the start line.
function outline(t) {
  const P = t.pts, n = P.length, out = [], info = [];
  const dir = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return [dx / l, dz / l, l]; };
  // each corner: turn angle and tangent length
  const C = P.map((p, i) => {
    const a = P[(i + n - 1) % n], b = P[(i + 1) % n], d0 = dir(a, p), d1 = dir(p, b);
    const cross = d0[0] * d1[1] - d0[1] * d1[0], dot = d0[0] * d1[0] + d0[1] * d1[1], th = Math.atan2(cross, dot);   // (+ = right-hand: x right, z down)
    return { p, d0, d1, th, r: p[2] || 20, tl: 0 };
  });
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < n; i++) {
    const c = C[i], tn = Math.abs(Math.tan(c.th / 2));
    c.tl = c.r * tn;
    const side = dir(P[i], P[(i + 1) % n])[2], nx = C[(i + 1) % n], nt = nx.r * Math.abs(Math.tan(nx.th / 2));
    if (c.tl + nt > side * 0.98) { const k = side * 0.98 / (c.tl + nt); c.r *= k; nx.r *= k; c.tl *= k; }
  }
  // walk: from corner i's arc end along side i to corner i+1's arc start, then that arc
  const pushLine = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.ceil(l / 0.5)); for (let k = 0; k < m; k++) out.push([a[0] + (b[0] - a[0]) * k / m, a[1] + (b[1] - a[1]) * k / m]); };
  const arc = c => {
    const s = [c.p[0] - c.d0[0] * c.tl, c.p[1] - c.d0[1] * c.tl], sgn = Math.sign(c.th) || 1;
    const nrm = [-c.d0[1] * sgn, c.d0[0] * sgn];          // toward the centre
    const cx = s[0] + nrm[0] * c.r, cz = s[1] + nrm[1] * c.r, a0 = Math.atan2(s[1] - cz, s[0] - cx), len = Math.abs(c.th) * c.r, m = Math.max(1, Math.ceil(len / 0.5));
    for (let k = 0; k < m; k++) { const a = a0 + c.th * k / m; out.push([cx + Math.cos(a) * c.r, cz + Math.sin(a) * c.r]); }
    info.push({ len, r: c.r, th: c.th });
  };
  // start: `start` of the way along side 0 (between corner 0 and corner 1)
  const c0 = C[0], c1 = C[1], s0 = [c0.p[0] + c0.d1[0] * c0.tl, c0.p[1] + c0.d1[1] * c0.tl], e0 = [c1.p[0] - c1.d0[0] * c1.tl, c1.p[1] - c1.d0[1] * c1.tl];
  const st = [s0[0] + (e0[0] - s0[0]) * t.start, s0[1] + (e0[1] - s0[1]) * t.start];
  pushLine(st, e0);
  for (let k = 1; k <= n; k++) {
    const i = k % n, c = C[i]; arc(c);
    const ni = (i + 1) % n, nc = C[ni], a = [c.p[0] + c.d1[0] * c.tl, c.p[1] + c.d1[1] * c.tl];
    const b = ni === 1 ? st : [nc.p[0] - nc.d0[0] * nc.tl, nc.p[1] - nc.d0[1] * nc.tl];
    if (ni === 1) { pushLine(a, st); break; }
    pushLine(a, b);
  }
  return { pts: out, corners: info };
}
// a circuit given as centre-line points (`path`, y north): a smooth closed curve through them (centripetal
// Catmull-Rom: no loops or overshoot at tight corners), scaled, every ~0.5 m. (z = -y: north is up on the map)
function splinePath(t) {
  const P = t.path.map(([x, y]) => [x * t.scale, -y * t.scale]), n = P.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i + n - 1) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6, 0.5);
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), m = Math.max(2, Math.ceil(seg / 0.5));
    for (let k = 0; k < m; k++) {
      const u = t1 + (t2 - t1) * k / m, L = (a, b, ta, tb) => [a[0] * (tb - u) / (tb - ta) + b[0] * (u - ta) / (tb - ta), a[1] * (tb - u) / (tb - ta) + b[1] * (u - ta) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  // scaled down, a hairpin can get tighter than the road is wide: ease any bend tighter than RMIN open a little
  const RMIN = 18, M = out.length, h = 20;                // (curvature measured over +-10 m)
  for (let it = 0; it < 400; it++) {
    let moved = false;
    for (let i = 0; i < M; i++) {
      const a = out[(i - h + M) % M], b = out[i], c = out[(i + h) % M];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ac = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      const R = area2 > 1e-9 ? ab * bc * ac / (2 * area2) : 1e9;
      if (R < RMIN) { b[0] += ((a[0] + c[0]) / 2 - b[0]) * 0.3; b[1] += ((a[1] + c[1]) / 2 - b[1]) * 0.3; moved = true; }
    }
    if (!moved) break;
  }
  // then a light overall smoothing (+-3 m) so the eased bends don't keep any small ripples
  for (let pass = 0; pass < 6; pass++) {
    const src = out.map(p => p.slice());
    for (let i = 0; i < M; i++) { let x = 0, z = 0; for (let j = -6; j <= 6; j++) { const q = src[(i + j + M) % M]; x += q[0]; z += q[1]; } out[i][0] = x / 13; out[i][1] = z / 13; }
  }
  return { pts: out, corners: [] };
}
// sample the track every STEP metres: { L, STEP, N, X, Z, TH, K, TOT, grid, CELL, race, track }
function buildTrack(t, STEP = 2) {
  const { pts, corners } = t.path ? splinePath(t) : outline(t);
  const M = pts.length, cum = new Float64Array(M + 1);
  for (let i = 1; i <= M; i++) { const a = pts[i - 1], b = pts[i % M]; cum[i] = cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const N = Math.round(cum[M] / STEP), L = N * STEP, X = new Float64Array(N), Z = new Float64Array(N);
  for (let i = 0, j = 0; i < N; i++) {
    const target = i * cum[M] / N;
    while (cum[j + 1] < target) j++;
    const f = (target - cum[j]) / (cum[j + 1] - cum[j] || 1), a = pts[j], b = pts[(j + 1) % M];
    X[i] = a[0] + (b[0] - a[0]) * f; Z[i] = a[1] + (b[1] - a[1]) * f;
  }
  const TH = new Float64Array(N), K = new Float64Array(N), raw = new Float64Array(N);
  const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  for (let i = 0; i < N; i++) { const a = (i + N - 1) % N, b = (i + 1) % N; TH[i] = Math.atan2(X[b] - X[a], -(Z[b] - Z[a])); }
  for (let i = 0; i < N; i++) raw[i] = wrap(TH[(i + 1) % N] - TH[i]) / STEP;
  let tot = 0;
  for (let i = 1; i < N; i++) { tot += raw[i - 1] * STEP; TH[i] = TH[i - 1] + raw[i - 1] * STEP; }   // (unwrapped: keeps counting round the lap)
  tot += raw[N - 1] * STEP;
  for (let i = 0; i < N; i++) { let s = 0; for (let j = -3; j <= 3; j++) s += raw[(i + j + N) % N]; K[i] = s / 7; }
  const CELL = 50, grid = new Map();
  for (let i = 0; i < N; i++) {
    const key = Math.floor(X[i] / CELL) * 100003 + Math.floor(Z[i] / CELL);
    let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push(i);
  }
  const TOT = Math.round(tot / (2 * Math.PI)) * 2 * Math.PI;
  // wall distances from the centre line (left WL, right WR, metres) and where the run-off is gravel (GL / GR)
  const WL = new Float64Array(N), WR = new Float64Array(N), rawL = new Float64Array(N), rawR = new Float64Array(N);
  // (the trap is where a car that runs wide ends up: around the corner and just after it)
  const back = Math.round(55 / STEP), ahead = Math.round(12 / STEP), street = !!t.street;
  for (let i = 0; i < N; i++) {
    let kR = 0, kL = 0;                                  // strongest right / left bend from 55 m back to 12 m ahead
    for (let j = -ahead; j <= back; j++) { const k = K[(i - j + N) % N]; if (k > kR) kR = k; if (-k > kL) kL = -k; }
    const trap = k => (street ? Math.min(3, Math.max(0, (k - 1 / 40) * 200)) : Math.min(RUNOFF.trapMax, Math.max(0, (k - 1 / 110) * 2600)));
    // a right-hand bend's outside is on the left
    rawL[i] = RUNOFF.half + RUNOFF.kerb + Math.max(RUNOFF.strip, trap(kR), kL > 1 / 150 ? RUNOFF.inside : 0);
    rawR[i] = RUNOFF.half + RUNOFF.kerb + Math.max(RUNOFF.strip, trap(kL), kR > 1 / 150 ? RUNOFF.inside : 0);
  }
  const sm = Math.round(24 / STEP);
  for (let i = 0; i < N; i++) {
    let a = 0, b = 0; for (let j = -sm; j <= sm; j++) { a += rawL[(i + j + N) % N]; b += rawR[(i + j + N) % N]; }
    WL[i] = a / (2 * sm + 1); WR[i] = b / (2 * sm + 1);
  }
  // never let a wall reach another part of the track: at most halfway to the nearest far-away bit of it
  for (let i = 0; i < N; i++) {
    let best = 1e9; const cx = Math.floor(X[i] / CELL), cz = Math.floor(Z[i] / CELL);
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {
      const cell = grid.get((cx + a) * 100003 + cz + b); if (!cell) continue;
      for (const j of cell) { let ds = Math.abs(i - j) * STEP; ds = Math.min(ds, L - ds); if (ds < 120) continue; best = Math.min(best, Math.hypot(X[i] - X[j], Z[i] - Z[j])); }
    }
    const lim = Math.max(RUNOFF.half + RUNOFF.kerb + 1.5, best / 2 - 4);
    WL[i] = Math.min(WL[i], lim); WR[i] = Math.min(WR[i], lim);
  }
  return { L, STEP, N, X, Z, TH, K, TOT, grid, CELL, race: true, track: t, corners, WL, WR };
}
// wall distance at s on a side (-1 left, +1 right), and whether the run-off there is a gravel trap
function wallAt(lp, s, side) {
  const f = (((s % lp.L) + lp.L) % lp.L) / lp.STEP, i = Math.floor(f) % lp.N, j = (i + 1) % lp.N, t = f - Math.floor(f), A = side < 0 ? lp.WL : lp.WR;
  return A[i] + (A[j] - A[i]) * t;
}
const gravelAt = (lp, s, side) => !lp.track.street && wallAt(lp, s, side) > RUNOFF.half + RUNOFF.kerb + RUNOFF.strip + 2.5;
// fastest believable lap (the server rejects anything quicker): the whole lap at the F1 car's top speed (345 km/h), plus 12%
const minLapMs = L => Math.round(L / (345 / 3.6) * 1000 * 1.12);
const _lenCache = {};
function trackLength(id) { return _lenCache[id] || (_lenCache[id] = buildTrack(TRACK_BY_ID[id]).L); }

const Tracks = { TRACKS, TRACK_BY_ID, RACE_LAPS, RACE_MAX, RACE_MIN, RACE_COUNTDOWN, RUNOFF, buildTrack, trackLength, minLapMs, outline, wallAt, gravelAt };
if (typeof module !== 'undefined' && module.exports) module.exports = Tracks;
