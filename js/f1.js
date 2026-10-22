'use strict';
// =====================================================================
//  F1 car (racing only): the owner's open-wheel race car model in your Garage paint, and its own physics.
//  - makeF1(paint): same shape of object as makeVehicle (root, body, wheels, brake...), so animateWheels and
//    the multiplayer code drive it like any car. Nose toward -z, ground at y = 0, centre of gravity at 0.
//  - F1Mode.enable() / disable(): while racing, the shared car physics (M4 in physics.js) get the F1's
//    numbers - much more power, grip and braking, 345 km/h - and the normal car's are put back afterwards.
//    The normal car's tuning is never changed.
// =====================================================================
const F1_PHYS = {
  mu: 1.7, muX: 2.5,          // tyre grip (sideways / under power and braking): slicks + downforce
  turnG: 5.0, latG: 3.6,      // cornering ceilings (g): downforce lets it corner far harder at speed
  vmax: 345 / 3.6,            // top speed
  brakeGrip: 1.5, brakeBoost: 2.3,   // carbon brakes: much harder stops than the normal car
  torqueScale: 3.4,           // engine pull (same gears and revs, much more push)
  // keyboard turning (sideways g by speed, km/h): the same as the normal car up to ~100 km/h (it turned too much when the
  // whole table was x1.4), then much more grip as the speed (downforce) builds - it was far too hard to turn at speed.
  // Sensitivity is fixed at 1x while racing (main.js).
  // x KB_BOOST (keyboard only - a steering wheel turns quicker and easier, so keyboard gets 1.2x the max turn and
  // 1.2x the turning speed; the wheel's steering is untouched)
  kbTurnG: [[0, 1.3], [48, 1.65], [64, 1.9], [97, 2.6], [129, 3.5], [161, 4.3], [200, 5.0], [260, 5.5], [350, 5.7]],
  kbTurnCap: 5.2, kbPressCap: 4.8,
  // no counter-steer boost (it's for highway lane changes: on a twisty track, slowing into a corner as the road bends
  // away from the car set it off, and the car suddenly turned up to 60% harder - a jolt), and grip ceilings blend smoothly
  kbCounter: 1, kbCapBlend: 5,
  kbSmooth: 12, kbFlipSmooth: 13,   // (steering eases in a little more gently than the road car's 18: smoother turn-in)
};
const KB_BOOST = 1.2;               // keyboard: max turn (kbTurnG + its grip ceilings) and turning speed (kbSmooth / kbFlipSmooth / kbBuild)
// ---- Racing Garage > Parts: tyres (coloured ring on the sidewall) and the rear wing ----
// soft: fastest, turns the least; medium: in between (the car as it was); hard: slowest, turns the most.
// No rear wing: less acceleration, more top speed (and a little lighter).
// accel = engine pull, traction = grip under power (the launch is traction-limited, so both make the gap)
const F1_TYRES = {
  soft:   { name: 'Soft',   ring: '#e8333a', speed: 1.04, accel: 1.12, traction: 1.1,  turn: 0.9 },
  medium: { name: 'Medium', ring: '#f2d24a', speed: 1,    accel: 1,    traction: 1,    turn: 1 },
  hard:   { name: 'Hard',   ring: '#a6e88f', speed: 0.96, accel: 0.88, traction: 0.9,  turn: 1.1 },
};
const F1_WING_OFF = { speed: 1.05, accel: 0.92, kg: -8 };
// front wing: low downforce = more top speed, turns less; high = turns more, less top speed (downforce adds grip)
const F1_FWING = { low: { name: 'Low', speed: 1.03, turn: 0.93 }, std: { name: 'Standard', speed: 1, turn: 1 }, high: { name: 'High', speed: 0.97, turn: 1.07 } };
// gearbox: short gears = quicker acceleration, lower top speed; long = the opposite
const F1_GEARS = { short: { name: 'Short', accel: 1.14, traction: 1.05, speed: 0.96 }, std: { name: 'Standard', accel: 1, traction: 1, speed: 1 }, long: { name: 'Long', accel: 0.86, traction: 0.95, speed: 1.04 } };
// brake bias: front = stronger brakes but turns a little less while braking; rear = weaker brakes, the car rotates more
const F1_BIAS = { front: { name: 'Front', brake: 1.12, turn: 0.96 }, mid: { name: 'Balanced', brake: 1, turn: 1 }, rear: { name: 'Rear', brake: 0.88, turn: 1.05 } };
const F1_KG = 798;                   // (shown: the car's weight)
// setup multipliers for the Parts choices (c = { tyre, wing, fwing, gear, bias }, Settings.f1): speed (top speed),
// accel (engine pull), traction (grip under power), turn (cornering), grip (sideways grip), brake (braking grip), kg
function f1Setup(c = {}) {
  const T = F1_TYRES[c.tyre] || F1_TYRES.medium, W = c.wing === false ? F1_WING_OFF : { speed: 1, accel: 1, kg: 0 };
  const FW = F1_FWING[c.fwing] || F1_FWING.std, G = F1_GEARS[c.gear] || F1_GEARS.std, B = F1_BIAS[c.bias] || F1_BIAS.mid;
  return { speed: T.speed * W.speed * FW.speed * G.speed, accel: T.accel * W.accel * G.accel, traction: T.traction * G.traction,
    turn: T.turn * FW.turn * B.turn, grip: (1 + (T.turn - 1) * 0.6) * (1 + (FW.turn - 1) * 0.6), brake: B.brake, kg: F1_KG + W.kg };
}
// 0-200 km/h (s) and 200-0 km/h braking distance (m), measured by running the game's own physics on a spare car with
// that setup (only while not racing - the Garage), remembered per setup
const F1_MEASURED = new Map();
function f1Measure(c) {
  const key = [c.tyre, c.wing, c.fwing, c.gear, c.bias].join('|');
  if (F1_MEASURED.has(key)) return F1_MEASURED.get(key);
  if (F1Mode.on) return null;
  F1Mode.enable(c);
  const pc = new PlayerCar(), h = 1 / 240, go = { throttle: 1, brake: 0, steer: 0, source: 'keys' }, stop = { throttle: 0, brake: 1, steer: 0, source: 'keys' };
  let t = 0;
  while (pc.u * 3.6 < 200 && t < 30) { pc.step(h, go); pc.v = pc.r = 0; t += h; }
  let dist = 0;
  for (let i = 0; i < 240 * 15 && pc.u > 0.3; i++) { pc.step(h, stop); pc.v = pc.r = 0; dist += pc.u * h; }
  F1Mode.disable();
  const m = { accel: t, braking: dist };
  F1_MEASURED.set(key, m);
  return m;
}
// the Garage's stat bars: { weight kg, accel (0-200 km/h s), top (km/h), handling, grip (out of 100), braking (m) }
const f1Stats = c => {
  const S = f1Setup(c), m = f1Measure(c) || { accel: 0, braking: 0 };
  return { weight: S.kg, accel: m.accel, top: 345 * S.speed, handling: 75 * S.turn, grip: 78 * S.grip, braking: m.braking };
};
const F1Mode = {
  on: false, saved: null,
  // setup: { tyre, wing, fwing, gear, bias } from the Racing Garage (f1Setup)
  enable(setup = {}) {
    if (this.on) return;
    this.saved = JSON.parse(JSON.stringify(M4));
    const P = F1_PHYS, S = f1Setup(setup);
    // (tires: sideways grip (mu) follows the turning; grip under power (muX) is the tire's traction - softs launch hardest)
    Object.assign(M4, { mu: P.mu * S.grip, muX: P.muX * S.traction, turnG: P.turnG * S.turn, latG: P.latG * S.turn, vmax: P.vmax * S.speed, brakeGrip: P.brakeGrip, brakeBoost: P.brakeBoost * S.brake });   // (brake bias: the F1's stops are limited by brake force, not grip)
    M4.torque = M4.torque.map(([r, t]) => [r, t * P.torqueScale * S.accel]);
    const K = KB_BOOST * S.turn;
    M4.kbTurnG = P.kbTurnG.map(([v, g]) => [v, g * K]); M4.kbTurnCap = P.kbTurnCap * K; M4.kbPressCap = P.kbPressCap * K; M4.kbCounter = P.kbCounter; M4.kbCapBlend = P.kbCapBlend;
    const Ks = KB_BOOST;                                 // (turning speed: keyboard boost only)
    M4.kbSmooth = P.kbSmooth * Ks; M4.kbFlipSmooth = P.kbFlipSmooth * Ks; M4.kbBuild *= Ks;
    this.on = true;
  },
  disable() {
    if (!this.on) return;
    for (const k of Object.keys(M4)) if (!(k in this.saved)) delete M4[k];   // (settings only racing adds go too)
    Object.assign(M4, this.saved);                     // (the normal car's numbers, exactly as they were)
    this.on = false;
  },
};

const F1_MATS = (() => {
  const std = (color, roughness = 0.5, metalness = 0.1) => new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  return { carbon: std(0x16171a, 0.45, 0.3), white: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.35 }), tyre: std(0x1a1b1e, 0.9), rim: std(0xc4c9cf, 0.3, 0.8), helmet: std(0xffd84a, 0.3, 0.2),
    visor: std(0x0b0d10, 0.1, 0.6), red: new THREE.MeshBasicMaterial({ color: 0xff2020 }),
    inner: std(0x2a2c31, 0.6, 0.4), tyreSmooth: new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.88, side: THREE.DoubleSide }), rimSmooth: new THREE.MeshStandardMaterial({ color: 0xc4c9cf, roughness: 0.3, metalness: 0.8 }), light: std(0xa8e6f2, 0.25, 0.1), mouth: std(0x3a0d10, 0.6), tail: std(0x7a1214, 0.4), glass: std(0x4d6c78, 0.15, 0.5),
    grey: std(0x3c3f44, 0.85, 0.1), hub: std(0x9a9ea4, 0.6, 0.1), red2: std(0xd42a2a, 0.45, 0.1),
    tyreFlat: new THREE.MeshStandardMaterial({ color: 0x45484d, roughness: 0.85, metalness: 0.05, flatShading: true, side: THREE.DoubleSide }) };
})();

// the steering wheel display: gear in the middle, speed, a row of shift lights (green, red, blue) across the top
function drawF1Screen(v, gear, speed, rpm01, units) {
  const g = v.screen.getContext('2d'), W = 256, H = 128;
  g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H);
  const n = 15, lit = Math.round(rpm01 * n);
  for (let i = 0; i < n; i++) {
    g.fillStyle = i >= lit ? '#1a1d22' : i < 5 ? '#2bd65a' : i < 10 ? '#ff2a2a' : '#3a7bff';
    g.beginPath(); g.arc(14 + i * 16.3, 14, 6, 0, 7); g.fill();
  }
  g.fillStyle = '#ffd84a'; g.font = '900 64px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(gear, W / 2, 74);
  g.fillStyle = '#fff'; g.font = '800 30px Segoe UI, Arial'; g.textAlign = 'left'; g.fillText(String(speed), 10, 74);
  g.font = '700 13px Segoe UI, Arial'; g.fillStyle = '#8b939e'; g.fillText(units, 12, 100);
  v.sTex.needsUpdate = true;
}

// ---------------------------------------------------------------- the F1 car (racing only)
// The owner's own 3D model, 1:1: tools/convert-obj-f1clean.js smoothed its lumpy surface, took off its fused-on
// wheels and pressed it into clean flat panels and made it exactly symmetrical (assets/f1_car.bin; bump ?v= when it changes).
// ONE colour all over (Garage paint).
// The game adds clean 10-sided wheels exactly where the model's were, so they spin and steer. No driver.
const F1Car = {
  geo: null, cbs: [], loading: false,
  load() {
    if (this.loading) return; this.loading = true;
    fetch('assets/f1_car.bin?v=20').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(buf => {
      const g = this.parse(buf); this.geo = g; const cbs = this.cbs; this.cbs = []; for (const f of cbs) f(g);
    }).catch(e => { this.loading = false; console.warn('F1 car file', e); });
  },
  parse(buf) {
    const n = new DataView(buf).getUint32(4, true), I = new Int16Array(buf, 8, n * 9), p = new Float32Array(n * 9);
    for (let i = 0; i < p.length; i++) p[i] = I[i] / 1000;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    creaseNormals(g, 30); g.computeBoundingSphere();   // (each flat panel shades as one smooth face, crisp edges between them)
    return g;
  },
  when(f) { if (this.geo) f(this.geo); else { this.cbs.push(f); this.load(); } },
};
F1Car.load();                          // (small: fetched straight away so the car is ready before the first race)
// ---- paint patterns (Garage: Pattern + Colour 2). Painted by the shader from where each point sits on the car
// (x across, y up, z along, nose toward -z), so stripes stay crisp and run cleanly over every panel.
const F1_PATTERNS = [['plain', 'Plain'], ['stripe', 'Stripe'], ['twin', 'Twin stripes'], ['twotone', 'Two-tone'], ['tips', 'Nose & wings'],
  ['chevron', 'Chevron'], ['band', 'Side band'], ['fade', 'Fade']];
const F1_PAT_INDEX = Object.fromEntries(F1_PATTERNS.map(([k], i) => [k, i]));
// the pattern's GLSL: how much of colour 2 at point p (0..1); each shape as a distance (< 0 inside), softened over a pixel
const F1_PAT_GLSL = `
varying vec3 vF1Pos; uniform int uF1Pat; uniform vec3 uF1Col2;
float f1In(float d) { float w = max(fwidth(d), 1e-4); return clamp(0.5 - d / w, 0.0, 1.0); }
float f1Mask(vec3 p) {
  float ax = abs(p.x);
  if (uF1Pat == 1) return f1In(ax - 0.1);                                    // stripe down the middle
  if (uF1Pat == 2) return f1In(abs(ax - 0.13) - 0.045);                      // two stripes either side of the middle
  if (uF1Pat == 3) return f1In(p.y - 0.42);                                  // two-tone: the lower body in colour 2
  if (uF1Pat == 4) return f1In(min(p.z + 1.75, 2.0 - p.z));                  // nose + front wing, and the back + rear wing
  if (uF1Pat == 5) return f1In(max(abs(p.z - 1.4 * ax + 1.0) - 0.11, ax - 0.4));   // a chevron pointing forward on the nose (not the sidepods)
  if (uF1Pat == 6) return f1In(max(max(abs(p.y - 0.45) - 0.07, abs(p.z - 1.1) - 1.5), 0.2 - ax));   // a band along the sides (not the wings)
  if (uF1Pat == 7) return smoothstep(-1.2, 2.3, p.z);                        // fades from colour 1 at the nose to colour 2 at the back
  return 0.0;
}`;
// gives a paint material the pattern (its uniforms in mat.userData.f1u: pattern index + colour 2)
function f1Pattern(mat, pattern = 'plain', color2 = '#d42a2a') {
  const u = mat.userData.f1u = { uF1Pat: { value: F1_PAT_INDEX[pattern] || 0 }, uF1Col2: { value: new THREE.Color(color2) } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vF1Pos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvF1Pos = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + F1_PAT_GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uF1Col2, f1Mask(vF1Pos));');
  };
  mat.customProgramCacheKey = () => 'f1pattern';
  mat.needsUpdate = true;
  return mat;
}
function f1SetPattern(mat, pattern, color2) { const u = mat.userData.f1u; if (!u) return; u.uF1Pat.value = F1_PAT_INDEX[pattern] || 0; u.uF1Col2.value.set(color2); }
// what other racers are sent so they draw your pattern, rims and parts:
// 'f1:<pattern>:<colour 2>:<rim style>:<rim colour>:<tyre s|m|h><rear wing 1|0><front wing l|s|h>'
const F1_RIM_KEYS = ['five', 'ten', 'disc'];
const hex6 = (c, d) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : d);
const f1LiveryKey = (pattern, color2, rimStyle, rimColor, tyre, wing, fwing) => `f1:${F1_PAT_INDEX[pattern] ? pattern : 'plain'}:${hex6(color2, '#d42a2a')}:${F1_RIM_KEYS.includes(rimStyle) ? rimStyle : 'five'}:${hex6(rimColor, '#c4c9cf')}` +
  `:${(F1_TYRES[tyre] ? tyre : 'medium')[0]}${wing === false ? 0 : 1}${(F1_FWING[fwing] ? fwing : 'std')[0]}`;
const f1ParseLivery = key => {
  const m = /^f1:([a-z]+):(#[0-9a-f]{6})(?::([a-z]+):(#[0-9a-f]{6}))?(?::([smh])([01])([lsh])?)?$/.exec(key || ''), lv = { pattern: 'plain', color2: '#d42a2a', rimStyle: 'five', rimColor: '#c4c9cf', tyre: 'medium', wing: true, fwing: 'std' };
  if (m && F1_PAT_INDEX[m[1]] !== undefined) { lv.pattern = m[1]; lv.color2 = m[2]; }
  if (m && m[3] && F1_RIM_KEYS.includes(m[3])) { lv.rimStyle = m[3]; lv.rimColor = m[4]; }
  if (m && m[5]) { lv.tyre = { s: 'soft', m: 'medium', h: 'hard' }[m[5]]; lv.wing = m[6] === '1'; }
  if (m && m[7]) lv.fwing = { l: 'low', s: 'std', h: 'high' }[m[7]];
  return lv;
};
// how far the front wheels look turned: the real steering angle is tiny at speed (a degree or two), so the car looked
// stiff - shown bigger the faster you go, easing softly toward ~34 deg (no hard cap to stick at), and the caller
// smooths it over time (f1VisDamp) so the wheels never snap
const f1VisSteer = (steer, u) => 0.6 * Math.tanh(steer * (1 + Math.abs(u) * 0.12) / 0.6);
const f1VisDamp = (v, target, dt) => (v.visSteer = (v.visSteer || 0) + (target - (v.visSteer || 0)) * (1 - Math.exp(-dt * 14)));
// the parts on a car already built: tyre compound (the ring colour), the rear wing (with its posts) on / off, and
// the front wing's flaps (low: none, standard: one, high: two)
const F1_RING_MAT = {};
const f1RingMat = tyre => F1_RING_MAT[tyre] || (F1_RING_MAT[tyre] = new THREE.MeshStandardMaterial({ color: (F1_TYRES[tyre] || F1_TYRES.medium).ring, roughness: 0.6, side: THREE.DoubleSide }));
function f1SetParts(v, tyre, wing, fwing) {
  for (const r of v.rings || []) r.material = f1RingMat(F1_TYRES[tyre] ? tyre : 'medium');
  for (const w of v.wing || []) w.visible = wing !== false;
  const fw = F1_FWING[fwing] ? fwing : 'std';
  if (v.fwing) { for (const m of v.fwing.std) m.visible = fw === 'std'; for (const m of v.fwing.high) m.visible = fw === 'high'; }
}
// change the rim style on a car already built (your own, from the Garage)
function f1SetRim(v, style) { const G = f1Parts(); for (const r of v.rims || []) r.geometry = G.rims[style] || G.rims.five; }
// the paint for a car: your own (already double-sided, its pattern set from the Garage) or another racer's (a copy of
// their colour with their pattern; one per colour + pattern, shared)
const F1_CAR_MAT = new Map();          // (the model's faces aren't all wound the same way: drawn from both sides)
const f1CarMat = (paint, livery) => {
  if (paint.side === THREE.DoubleSide) return paint;
  const lv = livery || { pattern: 'plain', color2: '#d42a2a' }, key = paint.uuid + lv.pattern + lv.color2;
  if (!F1_CAR_MAT.has(key)) { const m = paint.clone(); m.side = THREE.DoubleSide; m.flatShading = false; F1_CAR_MAT.set(key, f1Pattern(m, lv.pattern, lv.color2)); }
  return F1_CAR_MAT.get(key);
};
// a solid lofted through cross-sections [z, [[x, y], ...]] (same number of points in each, going round), ends capped
function f1Prism(sections) {
  const pos = [], n = sections[0][1].length, P = (s, k) => [sections[s][1][k][0], sections[s][1][k][1], sections[s][0]];
  for (let s = 0; s < sections.length - 1; s++) for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n, a = P(s, k), b = P(s, k2), c = P(s + 1, k2), d = P(s + 1, k);
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  for (const [s, flip] of [[0, true], [sections.length - 1, false]]) for (let k = 1; k < n - 1; k++) {
    const a = P(s, 0), b = P(s, k), c = P(s, k + 1); flip ? pos.push(...a, ...c, ...b) : pos.push(...a, ...b, ...c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return creaseNormals(g, 30);
}
// a body cross-section with sloping sides: straight up from the bottom (half width wb) to ym, then leaning in to a
// narrower flat top (half width wt) at yt
const f1Slope = (wb, ym, wt, yb, yt) => [[-wb, yb], [wb, yb], [wb, ym], [wt, yt], [-wt, yt], [-wb, ym]];
// the parts the game makes itself (the model's own were cut off by tools/convert-obj-f1clean.js): the airbox over the
// driver running back into the engine cover. Built once, shared by every F1 car on track.
let F1_PARTS = null;
function f1Parts() {
  if (F1_PARTS) return F1_PARTS;
  const g = {};
  // airbox -> engine cover: sides sloping in on each side, highest just behind the driver. It sits on the sidepods
  // (its straight lower band reaches their height, ~0.7) and meets the model's engine cover at z 1.75.
  g.hull = f1Prism([
    [0.10, f1Slope(0.30, 0.66, 0.15, 0.60, 0.74)],
    [0.30, f1Slope(0.38, 0.72, 0.17, 0.60, 1.03)],
    [0.50, f1Slope(0.38, 0.72, 0.17, 0.60, 1.04)],
    [0.95, f1Slope(0.38, 0.72, 0.15, 0.60, 0.96)],
    [1.35, f1Slope(0.36, 0.70, 0.11, 0.60, 0.84)],
    [1.76, f1Slope(0.34, 0.66, 0.08, 0.60, 0.72)],
  ]);
  // wheels: round but faceted (16 flat sides, the game's style); a thin tyre round a big rim (the owner: smaller tyre,
  // bigger rims) - the overall size is unchanged. Built once, shared.
  const W = { r: 0.35, w: 0.35 }, hw = W.w / 2, ri = 0.255, rec = 0.04;
  const prof = [[ri, -hw + rec], [ri, -hw], [W.r, -hw], [W.r, hw], [ri, hw], [ri, hw - rec]].map(([a, b]) => new THREE.Vector2(a, b));
  g.tyre = new THREE.LatheGeometry(prof, 16).rotateZ(Math.PI / 2);
  g.hub = new THREE.CylinderGeometry(ri, ri, W.w - 2 * rec, 16).rotateZ(Math.PI / 2);
  // the tyre compound's ring: a coloured band round the middle of each sidewall (like the real ones)
  const ringAt = sg => new THREE.RingGeometry(0.289, 0.311, 16).rotateY(Math.PI / 2).translate(sg * (hw + 0.002), 0, 0);
  { const a = ringAt(1).toNonIndexed(), b = ringAt(-1).toNonIndexed(), m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.Float32BufferAttribute([...a.attributes.position.array, ...b.attributes.position.array], 3));
    m.setAttribute('normal', new THREE.Float32BufferAttribute([...a.attributes.normal.array, ...b.attributes.normal.array], 3)); g.ring = m; }
  // rims (Garage: style + colour), each built for the +x face and mirrored for the other: a lip round the edge, then
  // five spokes / ten thin spokes / a solid aero disc, and a centre nut, on the dark hub
  const merge = list => {        // (several geometries -> one, so a wheel stays a handful of meshes)
    const pos = [], nor = [];
    for (const q of list) { const n = q.index ? q.toNonIndexed() : q; pos.push(...n.attributes.position.array); nor.push(...n.attributes.normal.array); }
    const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return m;
  };
  const face = hw - rec, both = q => merge([q, q.clone().scale(-1, 1, 1)]);
  const lip = () => new THREE.RingGeometry(ri - 0.03, ri + 0.004, 16).rotateY(Math.PI / 2).translate(face + 0.004, 0, 0);
  const nut = () => new THREE.CylinderGeometry(0.04, 0.04, 0.03, 6).rotateZ(Math.PI / 2).translate(face + 0.014, 0, 0);
  const spokes = (n, w) => Array.from({ length: n }, (_, k) => new THREE.BoxGeometry(0.022, ri * 0.9, w).translate(face + 0.008, ri * 0.45, 0).rotateX(k / n * Math.PI * 2));
  g.rims = {
    five: both(merge([lip(), ...spokes(5, 0.05), nut()])),
    ten: both(merge([lip(), ...spokes(10, 0.026), nut()])),
    disc: both(merge([lip(), new THREE.CylinderGeometry(ri - 0.02, ri - 0.02, 0.012, 16).rotateZ(Math.PI / 2).translate(face + 0.006, 0, 0), nut()])),
  };
  // ---- the back, kept simple (the owner's picture): one plain rear body - wide at the front where it meets the
  // sidepods, narrowing to the back - whose back is TWO faces angled slightly away from each other (a shallow V, so it
  // doesn't read as one flat block); a flat endplate on each side sloping from the wing tip down onto it; the two posts;
  // and a side arm out to each rear wheel. Only the model's wing is kept (tools/convert-obj-f1clean.js cuts the rest).
  // A solid from corner points + faces (each face a list of corner indices, any winding: the paint is two-sided)
  const solid = (V, F) => {
    const pos = [];
    for (const f of F) for (let k = 1; k < f.length - 1; k++) pos.push(...V[f[0]], ...V[f[k]], ...V[f[k + 1]]);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.computeVertexNormals(); return gg;
  };
  // rear body: front face z 1.7 (x +-0.52, y 0.1-0.62), back edges x +-0.42 at z 2.3, the middle of the back at z 2.42
  g.rear = solid([
    [-0.52, 0.1, 1.7], [0.52, 0.1, 1.7], [0.52, 0.62, 1.7], [-0.52, 0.62, 1.7],      // 0-3 front
    [-0.42, 0.1, 2.3], [0.42, 0.1, 2.3], [0.42, 0.55, 2.3], [-0.42, 0.55, 2.3],      // 4-7 back corners
    [0, 0.1, 2.42], [0, 0.55, 2.42],                                                  // 8-9 middle of the back
  ], [[0, 1, 2, 3], [1, 5, 6, 2], [0, 3, 7, 4], [3, 2, 6, 9, 7], [0, 4, 8, 5, 1], [4, 7, 9, 8], [8, 9, 6, 5]]);
  // endplates: thin flat plates from under each wing tip (x 0.52, y 0.86) sloping in and down onto the rear body (x 0.44)
  g.endplates = [-1, 1].map(sg => {
    const s = x => sg * x, T = 0.035;
    return solid([
      [s(0.52), 0.86, 2.06], [s(0.52), 0.86, 2.55], [s(0.44), 0.56, 2.3], [s(0.44), 0.58, 2.02],
      [s(0.52 - T), 0.86, 2.06], [s(0.52 - T), 0.86, 2.55], [s(0.44 - T), 0.56, 2.3], [s(0.44 - T), 0.58, 2.02],
    ], [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]);
  });
  // side arm from the rear body out to each rear wheel
  // the front suspension block (the model's) stops 5 cm short of the front wheels: carried on to them, same size
  // the rear wing: one solid plane in the same place and size as the model's (x +-0.53, y 0.8-0.93, z 2.06-2.57), every
  // edge lightly chamfered - no slots (the model's wing elements had gaps between them once it was made thinner)
  const wc = (w, yb, yt, c) => [[-w + c, yb], [w - c, yb], [w, yb + c], [w, yt - c], [w - c, yt], [-w + c, yt], [-w, yt - c], [-w, yb + c]];
  g.wing = f1Prism([[2.06, wc(0.53, 0.82, 0.9, 0.02)], [2.12, wc(0.53, 0.81, 0.93, 0.02)], [2.57, wc(0.53, 0.81, 0.93, 0.02)]]);
  // front wing flaps (Parts > Front wing), from inside the nose (x 0.08) to inside each endplate (x 0.82, the plates
  // are x 0.80-0.85) so they're joined at both ends, behind and above the model's main plane: low = none,
  // standard = one flap, high = two steeper flaps. Each flap: a thin plate rising from its front edge (z0, y0) to its
  // back edge (z1, y1).
  const flap = (sg, z0, y0, z1, y1) => { const r = y => [[sg * 0.08, y], [sg * 0.82, y], [sg * 0.82, y + 0.024], [sg * 0.08, y + 0.024]]; return f1Prism([[z0, r(y0)], [z1, r(y1)]]); };
  g.fwing = {
    std: [-1, 1].map(sg => flap(sg, -2.14, 0.21, -1.92, 0.31)),
    high: [-1, 1].flatMap(sg => [flap(sg, -2.14, 0.21, -1.93, 0.34), flap(sg, -2.0, 0.33, -1.86, 0.45)]),
  };
  // the sidepod intakes (square recesses in the sidepod fronts): filled in tyre black so they always match the wheels
  g.intakes = [-1, 1].map(sg => new THREE.BoxGeometry(0.205, 0.235, 0.05).translate(sg * 0.485, 0.43, -0.168));
  g.frontBlocks = [-1, 1].map(sg => new THREE.BoxGeometry(0.12, 0.2, 0.24).translate(sg * 0.67, 0.35, -1.27));
  g.rearBlocks = [-1, 1].map(sg => new THREE.BoxGeometry(0.3, 0.09, 0.1).translate(sg * 0.55, 0.36, 2.05));   // (thin)
  // the two wing posts (leaning like the model's: outward toward the top and a little back), from the rear body up to the wing
  g.posts = [-1, 1].map(sg => {
    const b = new THREE.BoxGeometry(0.065, 1, 0.2), p = b.attributes.position;
    for (let i = 0; i < p.count; i++) { const top = p.getY(i) > 0; p.setXYZ(i, sg * ((top ? 0.215 : 0.145) + p.getX(i)), top ? 0.835 : 0.55, (top ? 2.3 : 2.26) + p.getZ(i)); }
    b.computeVertexNormals(); return b;
  });
  // the cockpit opening (dark) and the dark intake on the front of the airbox
  g.opening = new THREE.BoxGeometry(0.36, 0.02, 0.56).translate(0, 0.61, -0.17);
  g.intake = new THREE.BoxGeometry(0.2, 0.13, 0.02).rotateX(-0.98).translate(0, 0.9, 0.2);
  for (const k of ['opening', 'intake']) g[k].computeVertexNormals();
  return (F1_PARTS = g);
}
const F1_TYRE = new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.9, metalness: 0.05, flatShading: true, side: THREE.DoubleSide });   // (F1 tyre black; faceted)
// rim colours: your own car uses main.js f1Rim; other racers get one of these per colour
const F1_RIM_MAT = new Map();
const f1RimMat = c => { if (!F1_RIM_MAT.has(c)) F1_RIM_MAT.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.75, flatShading: true, side: THREE.DoubleSide })); return F1_RIM_MAT.get(c); };
const F1_RIM_STYLES = [['five', 'Five-spoke'], ['ten', 'Ten-spoke'], ['disc', 'Aero disc']];
const F1_HUB = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.55, metalness: 0.4, flatShading: true });
// livery: { pattern, color2 } for another racer's car (your own car's pattern lives on its paint: main.js)
// opts.rimMat: your own car's rim material (main.js f1Rim, follows the Garage colour)
function makeF1(paint, livery, opts = {}) {
  const lv = Object.assign({ rimStyle: 'five', rimColor: '#c4c9cf' }, livery);
  const root = new THREE.Group(), body = new THREE.Group(), M = F1_MATS;
  root.add(body);
  const W = { fz: -1.25, rz: 2.05, tr: 0.875, r: 0.35, w: 0.35 };     // (where the model's wheels were, measured)
  const v = { root, body, M: { r: W.r }, spin: 0, f1: true, helmet: new THREE.Object3D(), eye: { y: 0.95, f: -0.02 } };
  const pm = f1CarMat(paint, livery);
  F1Car.when(g => { v.paintMesh = new THREE.Mesh(g, pm); v.paintMesh.castShadow = true; body.add(v.paintMesh); });
  const G = f1Parts(), part = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; body.add(m); return m; };
  part(G.hull, pm); part(G.rear, pm);
  for (const geo of [...G.rearBlocks, ...G.frontBlocks]) part(geo, pm);   // (no endplates: the owner found them odd)
  v.wing = [...G.posts, G.wing].map(geo => part(geo, pm));   // (the rear wing and its two posts: Parts can take it off)
  v.fwing = { std: G.fwing.std.map(geo => part(geo, pm)), high: G.fwing.high.map(geo => part(geo, pm)) };   // (front wing flaps: f1SetParts)
  v.lid = part(G.opening, M.carbon); part(G.intake, M.carbon);
  for (const geo of G.intakes) part(geo, F1_TYRE);
  // wheels (round, shared geometry) on their pivots
  v.wheels = []; v.rims = []; v.rings = [];
  for (const [front, z] of [[true, W.fz], [false, W.rz]]) for (const sg of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sg * W.tr, W.r, z);
    const mesh = new THREE.Group();
    const tyre = new THREE.Mesh(G.tyre, F1_TYRE); tyre.castShadow = true;
    const hub = new THREE.Mesh(G.hub, F1_HUB), rim = new THREE.Mesh(G.rims[lv.rimStyle] || G.rims.five, opts.rimMat || f1RimMat(lv.rimColor));
    const ring = new THREE.Mesh(G.ring, f1RingMat(lv.tyre || 'medium'));   // (the compound's coloured ring, both sidewalls)
    mesh.add(tyre, hub, rim, ring); pivot.add(mesh); root.add(pivot); v.rims.push(rim); v.rings.push(ring);
    v.wheels.push({ pivot, mesh, side: sg, front, base: 0, spinSign: 1 });
  }
  f1SetParts(v, lv.tyre, lv.wing, lv.fwing);
  v.brake = new THREE.Object3D(); v.brake.visible = false; root.add(v.brake);
  v.indL = new THREE.Object3D(); v.indR = new THREE.Object3D();
  // cockpit view: the steering wheel with its display (turns with yours)
  const cockpit = new THREE.Group(); cockpit.visible = false; root.add(cockpit);
  const wheel = new THREE.Group(); wheel.position.set(0, 0.72, -0.3); wheel.rotation.x = -0.35; cockpit.add(wheel);
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); wheel.add(m); };
  box(0.27, 0.13, 0.03, M.carbon, 0, 0, 0);
  for (const sg of [-1, 1]) { box(0.06, 0.15, 0.05, M.grey, sg * 0.16, -0.005, 0.005); box(0.05, 0.07, 0.01, M.hub, sg * 0.1, 0, -0.025); }
  const screen = document.createElement('canvas'); screen.width = 256; screen.height = 128;
  const sTex = new THREE.CanvasTexture(screen); sTex.encoding = THREE.sRGBEncoding;
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.06), new THREE.MeshBasicMaterial({ map: sTex, toneMapped: false })); disp.position.set(0, 0.012, 0.0165); wheel.add(disp);
  return Object.assign(v, { cockpit, steer: wheel, screen, sTex });
}

