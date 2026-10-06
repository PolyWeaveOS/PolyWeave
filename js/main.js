'use strict';
// =====================================================================
//  Main: scene, cameras, game loop, menu/settings
// =====================================================================

// ---------- settings ----------
const DEFAULTS = { density: 0.55, assist: 0, sens: 1.0, vol: 0.6, tc: true, manual: false, color: '#a6b0b8', mpDensity: 0.55, minimap: true };
const SCORED_DENSITY = 0.6;               // scored (leaderboard) runs always use this much traffic
const Settings = Object.assign({}, DEFAULTS);
try { Object.assign(Settings, JSON.parse(localStorage.getItem('tw_settings2') || '{}')); } catch (e) { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem('tw_settings2', JSON.stringify(Settings)); } catch (e) { /* ignore */ } };

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = 0xd3eaf7;
scene.fog = new THREE.Fog(HORIZON, 160, 1250);
{ // sky gradient background
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#4f9fe3'); gr.addColorStop(0.55, '#9fd0f0'); gr.addColorStop(1, '#d3eaf7');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  scene.background = t;
}
{ // environment map for paint/glass reflections
  const es = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16), col = [], p = geo.attributes.position, c = new THREE.Color();
  const top = new THREE.Color(0x5aa6e6), hor = new THREE.Color(0xe6f3fb), gnd = new THREE.Color(0x56634f);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 50;
    if (y > 0) c.copy(hor).lerp(top, Math.pow(y, 0.6)); else c.copy(hor).lerp(gnd, Math.min(1, -y * 4));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  es.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 5.5) }));
  sun.position.set(-25, 35, 20); es.add(sun);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(es, 0.02).texture;
}
const hemi = new THREE.HemisphereLight(0xdff0ff, 0x7b9a5c, 0.72);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff3e2, 1.2);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 260 });
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.03;
scene.add(sunLight, sunLight.target);
const SUN_OFF = new THREE.Vector3(-55, 95, 40);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 3000);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// ---------- game objects ----------
const world = new World(scene);
const zoneProps = new ZoneProps(scene);
const traffic = new Traffic(scene);
const car = new PlayerCar();
const steerCtl = new SteerController();
const hud = new Hud();
const score = new Score(hud);
const sound = new Sound();
Input.init();

const CG_F = 0.157; // centre of gravity sits 0.157 m ahead of the body centre
const playerPaint = new THREE.MeshStandardMaterial({ color: Settings.color, roughness: 0.24, metalness: 0.55, envMapIntensity: 1.1 });
const playerGlass = new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.78, envMapIntensity: 1.5, side: THREE.DoubleSide });
const playerRim = new THREE.MeshStandardMaterial({ color: 0x9c7a4c, roughness: 0.32, metalness: 0.85 }); // bronze forged wheels
const playerVis = makeVehicle('m4', playerPaint, { [SLOT.GLASS]: playerGlass, [SLOT.RIM]: playerRim });
// double-sided where needed: the cockpit view sees panels from inside, and the imported model's
// surfaces aren't guaranteed to all face outward
const importedM4 = !!playerVis.M.wheelGeoms;
playerVis.body.material = playerVis.body.material.map((m, i) => m && (importedM4 || i === SLOT.PAINT || i === SLOT.CARBON || i === SLOT.TRIM) ? Object.assign(m.clone(), { side: THREE.DoubleSide }) : m);
const playerPaintDS = playerVis.body.material[SLOT.PAINT];
// the reduced real model has small surface ripples; a less mirror-like paint keeps them from showing as blotches
if (importedM4) Object.assign(playerPaintDS, { roughness: 0.4, metalness: 0.3, envMapIntensity: 1.1 });
const playerRoot = new THREE.Group();
playerVis.root.position.z = CG_F;
playerRoot.add(playerVis.root);
const interior = new THREE.Mesh(playerVis.M.interior, importedM4 ? playerVis.body.material : playerVis.mats);
playerVis.root.add(interior);
const swTilt = new THREE.Group();
if (playerVis.M.swCenter) { swTilt.position.fromArray(playerVis.M.swCenter); swTilt.quaternion.copy(playerVis.M.swQuat); } // real column position/angle
else { swTilt.position.set(-0.37, 0.90, -0.40); swTilt.rotation.x = 0.36; }
const swMesh = new THREE.Mesh(playerVis.M.wheelSW, importedM4 ? playerVis.body.material : playerVis.mats);
swTilt.add(swMesh); playerVis.root.add(swTilt);
scene.add(playerRoot);
const playerHull = playerVis.M.hull.map(([x, f]) => [x, f - CG_F]);
// against traffic the hitbox is a touch smaller (~3 cm narrower each side, ~4 cm shorter each end)
// so paint-scraping near misses don't count as crashes
const trafficHull = playerHull.map(([x, f]) => [x * 0.97, f * 0.983]);
const M4_EXT = { front: playerVis.M.front - CG_F, rear: playerVis.M.rear - CG_F, hw: 0.95 };

function setPaint(hex) { Settings.color = hex; playerPaint.color.set(hex); playerPaintDS.color.set(hex); saveSettings(); }
setPaint(Settings.color);

// ---------- state ----------
let camMode = 0, menuOpen = true, started = false, time = 0, lastCrash = -9, last = performance.now();
let lastShoulder = -9, shoulderLost = 0;
const camS = { off: new THREE.Vector3(0, 1.8, 6), yaw: 0, fov: 62, look: new THREE.Vector3(), orbit: 0 };
const proxy = { s: 0, d: 0, v: 0, front: M4_EXT.front, rear: M4_EXT.rear, hw: M4_EXT.hw, isPlayer: true, crashed: false };
const _hp = [];
// what's being played: 'menu' (title screen), 'sp' (singleplayer) or 'mp' (on a server); scored = counts for the leaderboard
const game = { mode: 'menu', scored: false, density: SCORED_DENSITY };

function startPosition() {
  car.place(40, ROAD.lane(2), 100 / 3.6);
  car.tc = Settings.tc; car.manual = Settings.manual; car.hitT = 0;
  camS.yaw = car.yaw; camS.shift = 0;
  steerCtl.key = 0; steerCtl.k1 = 0; steerCtl.wheelF = 0;
  traffic.clear();
  const p = ROAD.project(car.x, car.z); car.s = p.s; car.d = p.d; ROAD.hintS = car.s;
  Object.assign(proxy, { s: car.s, d: car.d, v: car.u });
  world.fillAll(car.s);
  traffic.maintain(proxy, game.density);
}
startPosition();

// Full reset: fresh traffic, fresh run score, car back in lane at a rolling start
function resetCar() {
  const p = ROAD.project(car.x, car.z);
  car.place(p.s, ROAD.lane(2), 100 / 3.6);
  car.tc = Settings.tc; car.manual = Settings.manual; car.hitT = 0;
  car.s = p.s; car.d = ROAD.lane(2); ROAD.hintS = car.s;
  steerCtl.key = 0; steerCtl.k1 = 0; steerCtl.wheelF = 0;
  camS.yaw = car.yaw; camS.shift = 0;
  Object.assign(proxy, { s: car.s, d: car.d, v: car.u });
  if (!traffic.remote) { traffic.clear(); traffic.maintain(proxy, game.density); }   // (online the traffic is shared)
  score.reset();
  lastCrash = -9;
}

let zoneHit = false, lastGoodS = 40;
// guard-rail contact for the player (rigid wall, per physics substep)
// Walls the car can hit at road position s: the two guard rails, plus the barrier line of any
// construction zone (only while the car is on the open side of it). On the loop circuit the right
// rail opens where the on-ramp joins, and the lot / ramp has its own fence (the rail beside the lot
// is solid from both sides).
function wallsAt(s, carD) {
  const w = [{ sg: -1, d: ROAD.edgeL - 0.35 }];
  // lotSide: the car is in the parking lot / ramp area (incl. just behind the lot's far fence, where the
  // end fence holds it) - the rail beside the lot then pushes it back INTO the lot, never onto the road
  const eR = ROAD.edgeR + 0.35, outer = ROAD.lotOuter(s), lotSide = carD > eR - 0.6 && nearLot(s, carD);
  if (!ROAD.railOpen(1, s)) w.push(lotSide ? { sg: -1, d: eR + 0.25 } : { sg: 1, d: eR });
  if (outer !== null && (lotSide || ROAD.railOpen(1, s))) w.push({ sg: 1, d: outer });
  for (const z of ZONES.near(s, s)) {
    if (ZONES.frac(z, s) <= 0) continue;
    const b = ZONES.wallD(z, s), sg = z.side === 0 ? -1 : 1;  // solid wall sits behind the cones
    if ((carD - b) * sg > 0.4) continue;           // car is inside the closure (came in some other way): ignore
    w.push({ sg, d: b, zone: true });
  }
  return w;
}

function railCollide(h) {
  const pre = ROAD.project(car.x, car.z);
  const zonesHere = ZONES.near(pre.s - 8, pre.s + 8).some(z => ZONES.frac(z, pre.s - 8) > 0 || ZONES.frac(z, pre.s + 8) > 0);
  if (!zonesHere && pre.d > ROAD.edgeL + 3 && pre.d < ROAD.edgeR - 3) return 0;
  // Anti-stuck: when the car is close to a wall and pointing INTO it, swing it back parallel
  // to the road (works even when stopped, where steering can't turn the car). It never
  // acts when you're pointing away from the wall, so it doesn't fight you driving off.
  const lotArea = nearLot(pre.s, pre.d);
  for (const wl of lotArea ? [] : wallsAt(pre.s, pre.d)) {   // (not in the parking lot: you park / turn around there)
    const sg = wl.sg;
    const dist = sg > 0 ? wl.d - pre.d : pre.d - wl.d;
    if (dist > 2.6) continue;
    const ry = ROAD.yaw(pre.s), nx = sg * Math.cos(ry), nz = sg * Math.sin(ry);
    const into = Math.sin(car.yaw) * nx - Math.cos(car.yaw) * nz;   // heading . normal-toward-rail
    if (into > 0.05) {
      const along = Math.cos(U.wrap(car.yaw - ry)) >= 0 ? ry : ry + Math.PI;
      car.yaw = U.dampAngle(car.yaw, along, 3.5, h);
    }
  }
  // hard safety net: the car's centre can never get past the rail line (except into the start area)
  const lim = 0.75;
  if ((pre.d > ROAD.edgeR + 0.35 - lim && !lotArea) || pre.d < ROAD.edgeL - 0.35 + lim) {
    const dd = U.clamp(pre.d, ROAD.edgeL - 0.35 + lim, ROAD.edgeR + 0.35 - lim);
    const p = ROAD.pos(pre.s, dd); car.x = p.x; car.z = p.z;
  }
  const pts = SAT.toWorld(playerHull, car.x, car.z, car.visYaw, _hp);
  let worst = null;
  for (const q of pts) {
    const pr = ROAD.project(q[0], q[1]);
    const ry = ROAD.yaw(pr.s);
    for (const wl of wallsAt(pr.s, pre.d)) {
      const pen = wl.sg > 0 ? pr.d - wl.d : wl.d - pr.d;
      if (wl.zone && pen > 1.4) continue;          // corner is deep past the barrier line (beyond its ends)
      if (pen > 0 && (!worst || pen > worst.pen)) worst = { q, pen, nx: wl.sg * Math.cos(ry), nz: wl.sg * Math.sin(ry), zone: !!wl.zone };
    }
  }
  if (!worst) return 0;
  const b = car.toBody();
  const nx = worst.nx, nz = worst.nz;
  const vn = resolveImpulse(b, { x: worst.q[0], z: worst.q[1], vx: 0, vz: 0, w: 0, im: 0, ii: 0 },
    { nx, nz, depth: worst.pen + 0.03, px: worst.q[0], pz: worst.q[1] }, 0.12, 0.12);
  car.fromBody(b);
  car.wImp = 0; // no lingering spin into the wall
  // nudge slightly away from the rail so contact doesn't persist
  car.x -= nx * 0.01; car.z -= nz * 0.01;
  if (worst.zone && vn > 1.0) zoneHit = true; // clipping construction barriers counts as a crash
  return vn;
}

// ---------- servers: the loop circuit with a parking lot to start from ----------
// Park in space `slot` of the lot, nose toward the exit (everyone in a room gets their own space).
function spawnInLot(slot) {
  const sp = ROAD.lotSpace(slot);
  car.place(sp.s, sp.d, 0);
  car.tc = Settings.tc; car.manual = Settings.manual; car.hitT = 0;
  car.s = sp.s; car.d = sp.d; ROAD.hintS = sp.s; lastGoodS = sp.s;
  steerCtl.key = 0; steerCtl.k1 = 0; steerCtl.wheelF = 0;
  camS.yaw = car.yaw; camS.shift = 0;
  world.fillAll(car.s);
  Object.assign(proxy, { s: car.s, d: car.d, v: 0 });
  score.reset();
  lastCrash = -9;
}
// joined a server: switch to the loop circuit + shared traffic, start in the lot
function enterServer(slot) {
  ROAD.setLoop(true); ZONES.setLoop(ROAD.loop.L);
  world.reset(); zoneProps.reset();
  traffic.clear(); traffic.remote = true;
  spawnInLot(slot);
}
// left / lost the server: back to the endless single-player highway
function exitServer() {
  ROAD.setLoop(false); ZONES.setLoop(0);
  world.reset(); zoneProps.reset();
  traffic.remote = false; traffic.clear();
  startPosition();
  score.reset();
}
// in (or right at the edge of) the start area beside the road: off-ramp, pad, on-ramp
function nearLot(s, d) {
  if (!ROAD.loop || d < ROAD.edgeR - 0.5) return false;
  const ls = ROAD.lotS(s);
  return ls > LOOP.OFF0 - 8 && ls < LOOP.RAIL_OPEN1 + 2 && d < ROAD.edgeR + LOOP.LOT_D1 + 8;
}
// the deceleration / acceleration lanes and the start area don't count as the shoulder
function inStartArea(s, d) {
  if (!ROAD.loop || d < 2 * ROAD.LW) return false;
  const ls = ROAD.lotS(s);
  return ls > LOOP.OFF0 - 5 && ls < LOOP.RAIL_OPEN1 + 5;
}

function crashEvent(strength) {
  sound.thump(0.3 + strength / 12);
  if (time - lastCrash > 1.2) score.crash();
  lastCrash = time;
}

// ---------- camera ----------
function updateCamera(dt) {
  const spd = car.speed, sy = Math.sin(car.visYaw), cy = Math.cos(car.visYaw); // cockpit sits in the drawn body
  if (menuOpen) { // slow orbit around the car in the menu
    camS.orbit += dt * 0.25;
    const a = car.yaw + camS.orbit + 2.4, r = 6.8;
    camera.position.set(car.x + Math.sin(a) * r, 1.9, car.z - Math.cos(a) * r);
    camera.lookAt(car.x, 0.7, car.z);
    camera.fov = 50; camera.near = 0.25; camera.updateProjectionMatrix();
    return;
  }
  if (camMode === 0) {
    // camera follows the direction of travel smoothly (like "Low Poly Traffic Racer"),
    // so you see the car rotate into the turn instead of the whole world swinging
    const travel = car.u > 4 ? car.yaw + Math.atan2(car.v, Math.max(car.u, 0.1)) : car.yaw;
    camS.yaw = U.dampAngle(camS.yaw, travel, 5, dt);
    // ...and slides slightly sideways toward the turn instead of orbiting
    const shiftT = U.clamp(car.r * 1.5, -0.3, 0.3);
    camS.shift = U.damp(camS.shift || 0, shiftT, 4, dt);
    const sp = U.clamp(spd / 80, 0, 1);
    // camera has inertia: it lags back when accelerating and surges toward the car under braking
    const brk = U.clamp(-car.ax / 13, 0, 1);
    const dist = 5.7 + sp * 0.9 + U.clamp(car.ax, -15, 9) * 0.05;
    const hgt = 1.72 + sp * 0.12;
    const cyw = Math.cos(camS.yaw), syw = Math.sin(camS.yaw);
    const ox = -syw * dist + cyw * camS.shift, oz = cyw * dist + syw * camS.shift;
    camS.off.x = U.damp(camS.off.x, ox, 14, dt);
    camS.off.z = U.damp(camS.off.z, oz, 14, dt);
    camS.off.y = U.damp(camS.off.y, hgt, 5, dt);
    let shx = 0, shy = 0;
    if (spd > 45) { const k = (spd - 45) * 0.00035; shx = Math.sin(time * 37) * k; shy = Math.sin(time * 53 + 1) * k; }
    if (brk > 0.3 && spd > 6) { // ABS judder under hard braking
      const k = (brk - 0.3) * Math.min(spd / 40, 1) * 0.03;
      shx += Math.sin(time * 61) * k; shy += Math.sin(time * 47 + 2) * k;
    }
    camera.position.set(car.x + camS.off.x + shx, camS.off.y + shy, car.z + camS.off.z);
    const la = 3.2, lx = camS.shift * 0.6;
    camS.dip = U.damp(camS.dip || 0, brk * 0.35, 8, dt); // view tips forward with the nose
    camera.lookAt(car.x + syw * la + cyw * lx, 0.95 - camS.dip, car.z - cyw * la + syw * lx);
    camS.fov = U.damp(camS.fov, 60 + U.clamp((spd - 20) / 60, 0, 1) * 11, 3, dt);
  } else {
    // cockpit: driver's eye, with subtle head motion from g-forces
    const lx = -0.37 - U.clamp(car.ay, -12, 12) * 0.004;
    const lf = -0.32 - CG_F - U.clamp(car.ax, -15, 12) * 0.006; // head pitches forward under braking
    const y = 1.13 +Math.sin(time * 31) * Math.min(spd / 80, 1) * 0.0015;
    camera.position.set(car.x + lf * sy + lx * cy, y, car.z - lf * cy + lx * sy);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(-0.045 + U.clamp(car.ax, -15, 10) * 0.0025 + (camS.body ? camS.body.pitch : 0), -car.visYaw, U.clamp(car.ay, -12, 12) * 0.0015);
    camS.fov = U.damp(camS.fov, 70 + U.clamp((spd - 20) / 60, 0, 1) * 5, 3, dt);
  }
  // near plane: far enough out in the chase view for good depth precision (no z-fighting
  // flicker on lights/trim), close in the cockpit so the dashboard isn't clipped
  camera.near = camMode === 1 ? 0.05 : 0.25;
  camera.fov = camS.fov; camera.updateProjectionMatrix();
}

// ---------- menus ----------
// Screens: title (main menu) -> singleplayer / multiplayer / leaderboard / settings; pause while driving.
const menu = document.getElementById('menu');
const $id = id => document.getElementById(id);
let screen = 'scrTitle', settingsFrom = 'scrTitle';
function show(id) {
  if (id === 'scrSettings' && screen !== 'scrSettings') settingsFrom = screen;
  screen = id;
  for (const s of menu.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  if (id === 'scrMP') Net.refreshList();
  if (id === 'scrLB') loadLeaderboard();
  if (id === 'scrSettings') renderKeys();
  if (id === 'scrPause') updatePause();
}
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => show(b.dataset.go)));
$id('setBack').onclick = () => show(settingsFrom);

const bindRange = (id, key, toVal, fmt) => {
  const el = $id(id), lab = $id(id + 'V');
  el.value = Math.round(Settings[key] * 100);
  const upd = () => { Settings[key] = toVal(+el.value); lab.textContent = fmt(+el.value); saveSettings(); };
  el.addEventListener('input', upd); upd();
};
bindRange('fdDens', 'density', v => v / 100, v => v + '%');        // singleplayer free drive traffic
bindRange('mpDens', 'mpDensity', v => v / 100, v => v + '%');      // free drive server traffic
bindRange('la', 'assist', v => v / 100, v => (v === 0 ? 'Off' : v + '%'));
bindRange('sens', 'sens', v => v / 100, v => (v / 100).toFixed(2) + '×');
bindRange('vol', 'vol', v => v / 100, v => v + '%');
const tcEl = $id('tc'), manEl = $id('manual'), mmEl = $id('minimapOn');
tcEl.checked = Settings.tc; manEl.checked = Settings.manual; mmEl.checked = Settings.minimap;
tcEl.addEventListener('change', () => { Settings.tc = car.tc = tcEl.checked; saveSettings(); });
manEl.addEventListener('change', () => { Settings.manual = car.manual = manEl.checked; saveSettings(); });
mmEl.addEventListener('change', () => { Settings.minimap = mmEl.checked; saveSettings(); });
const PAINTS = [['Brooklyn Grey', '#a6b0b8'], ['Isle of Man Green', '#0e5a44'], ['São Paulo Yellow', '#f0c419'], ['Toronto Red', '#b1121c'],
  ['Portimão Blue', '#1d5cc0'], ['Black Sapphire', '#14161a'], ['Alpine White', '#eef0ee'], ['Fire Orange', '#e0561c'], ['Dravit Grey', '#6b6e68'], ['Tanzanite Blue', '#1d2a4b']];
const swBox = $id('swatches'), picker = $id('paint');
const markSw = () => { for (const el of swBox.children) el.classList.toggle('sel', el.dataset.c === Settings.color); picker.value = Settings.color; };
for (const [n, c] of PAINTS) {
  const el = document.createElement('div'); el.className = 'sw'; el.title = n; el.dataset.c = c; el.style.background = c;
  el.onclick = () => { setPaint(c); markSw(); };
  swBox.appendChild(el);
}
picker.addEventListener('input', () => { setPaint(picker.value); markSw(); });
markSw();
const calMsg = $id('calMsg');
document.querySelectorAll('[data-cal]').forEach(b => b.addEventListener('click', () => Input.startCal(b.dataset.cal, t => (calMsg.textContent = t))));
$id('calReset').onclick = () => { Input.resetCal(); calMsg.textContent = 'Reset to Logitech G923 / G29 defaults.'; };
// keyboard controls: click an action, then press its new key
function renderKeys() {
  const box = $id('keyBinds'); box.innerHTML = '';
  for (const a in KEY_NAMES) {
    const lab = document.createElement('span'); lab.textContent = KEY_NAMES[a];
    const b = document.createElement('button'); b.textContent = Input.binds[a].map(keyLabel).join(' / ');
    b.onclick = () => {
      b.classList.add('wait'); b.textContent = 'Press a key…';
      $id('keyMsg').textContent = 'Press the new key for ' + KEY_NAMES[a].toLowerCase() + ' (Esc cancels).';
      Input.capture = { action: a, done: ok => { renderKeys(); $id('keyMsg').textContent = ok ? 'Saved.' : 'Cancelled.'; } };
    };
    box.append(lab, b);
  }
}
$id('keysReset').onclick = () => { Input.resetBinds(); renderKeys(); $id('keyMsg').textContent = 'Back to the default keys.'; };

// driver name (used on servers and leaderboards), shown on the singleplayer + multiplayer screens
const nameIns = [...document.querySelectorAll('.nameIn')];
for (const el of nameIns) {
  el.value = Settings.mpName || '';
  el.addEventListener('input', () => { Settings.mpName = el.value.trim(); for (const o of nameIns) if (o !== el) o.value = el.value; saveSettings(); });
}
const myName = () => (Account.signedIn ? Account.user.name : ((Settings.mpName || '').trim() || 'Driver')).slice(0, 16);

// ---------- accounts: Sign in with Google (needed for the leaderboards) ----------
let acctMsg = '';
function renderAccount() {
  for (const box of document.querySelectorAll('[data-acct]')) {
    box.innerHTML = '';
    if (!Account.ready || !Account.clientId) continue;          // (sign-in not set up on this server)
    if (Account.signedIn) {
      const who = document.createElement('span'); who.className = 'who';
      who.append('Signed in as ', Object.assign(document.createElement('b'), { textContent: Account.user.name }));
      const rn = Object.assign(document.createElement('button'), { textContent: 'RENAME', onclick: () => { $id('acctName').value = Account.user.name; show('scrName'); } });
      const out = Object.assign(document.createElement('button'), { textContent: 'SIGN OUT', onclick: () => Account.signOut() });
      box.append(who, rn, out);
    } else {
      const g = document.createElement('div'); box.appendChild(g); Account.renderButton(g);
      box.appendChild(Object.assign(document.createElement('span'), { className: 'why', textContent: acctMsg || 'Sign in to get on the leaderboards' }));
    }
  }
  // driver name fields: your account name when signed in
  for (const el of nameIns) { el.disabled = Account.signedIn; el.value = Account.signedIn ? Account.user.name : (Settings.mpName || ''); }
  for (const n of document.querySelectorAll('.acctNote')) {
    const on = !!Account.clientId;
    n.textContent = !on ? '' : Account.signedIn ? 'Scored runs go on the leaderboard under this name.' : 'Not signed in: scored runs won\'t go on the leaderboard. Sign in on the main menu.';
    n.classList.toggle('warn', on && !Account.signedIn);
  }
}
Account.onChange = () => { acctMsg = ''; renderAccount(); };
Account.onMsg = t => { acctMsg = t; renderAccount(); };
Account.onNeedName = () => { $id('acctName').value = ''; $id('acctNameErr').textContent = ''; if (!menuOpen) openMenu('scrName'); else show('scrName'); };
$id('acctNameSave').onclick = async () => {
  const err = await Account.setName($id('acctName').value);
  $id('acctNameErr').textContent = err || '';
  if (!err) show('scrTitle');
};
$id('acctName').addEventListener('keydown', e => { if (e.key === 'Enter') $id('acctNameSave').click(); });
$id('acctNameLater').onclick = () => show('scrTitle');

// ---------- singleplayer ----------
$id('spScored').onclick = () => startSingle(true);
$id('spFree').onclick = () => startSingle(false);
function startSingle(scored) {
  score.reset();                                       // (ends anything left over first)
  game.mode = 'sp'; game.scored = scored; game.density = scored ? SCORED_DENSITY : Settings.density;
  startPosition(); score.reset();
  closeMenu();
  hud.message(scored ? 'SCORED RUN' : 'FREE DRIVE');
}
// scored singleplayer streaks go to the leaderboard (multiplayer runs are recorded by the server itself)
score.onStreakEnd = (pts, peak, dur) => {
  if (!game.scored || pts < 100) return;
  if (!Account.signedIn) { if (Account.clientId) hud.message('SIGN IN TO SAVE SCORES'); return; }   // (multiplayer runs: the server records them)
  if (game.mode === 'sp') submitScore(pts, peak, dur);
};
async function submitScore(pts, peak, dur) {
  const base = await Net.findBase(); if (!base) return;
  try {
    const r = await fetch(base + '/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'sp', session: Account.session, score: pts, peak, dur }) });
    const j = await r.json();
    if (j && j.rank) hud.message(`LEADERBOARD #${j.rank}`);
  } catch (e) { /* offline: no leaderboard */ }
}
function quitToTitle() {
  if (game.mode === 'mp') { quitting = true; Net.leave(); quitting = false; }   // (onLeft puts the endless road back)
  else score.reset();
  game.mode = 'menu'; game.scored = false; game.density = SCORED_DENSITY;
  startPosition(); score.reset();
  show('scrTitle');
}
$id('pQuit').onclick = quitToTitle;
$id('pResume').onclick = () => closeMenu();
let quitting = false;

// ---------- leaderboard ----------
let lbTab = 'sp';
document.querySelectorAll('[data-lb]').forEach(b => b.addEventListener('click', () => {
  lbTab = b.dataset.lb;
  document.querySelectorAll('[data-lb]').forEach(o => o.classList.toggle('sel', o === b));
  loadLeaderboard();
}));
async function loadLeaderboard() {
  const mode = lbTab, list = $id('lbList'), note = $id('lbNote');
  note.textContent = 'Loading…'; list.innerHTML = '';
  const base = await Net.findBase();
  if (!base) { note.textContent = 'Leaderboards live on the online server: open the game from its website link.'; return; }
  let j;
  try { j = await (await fetch(base + '/api/leaderboard?mode=' + mode, { cache: 'no-store' })).json(); }
  catch (e) { note.textContent = 'Could not load the leaderboard. Check your internet connection.'; return; }
  if (mode !== lbTab) return;
  const rows = j.list || [];
  note.textContent = (mode === 'sp' ? 'Best scored singleplayer drive of each driver (60% traffic).' : 'Best drive of each driver on public and scored servers.')
    + (j.persistent ? '' : ' (Not saved permanently yet: they reset when the server restarts.)')
    + (j.accounts ? (Account.signedIn ? '' : ' Sign in with Google to get on it.') : ' (Sign-in isn\'t set up on this server yet, so no drives can be saved.)');
  // run length as m:ss (h:mm:ss for very long runs)
  const time = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const me = Account.signedIn ? Account.user.name : null;
  // podium: 2nd | 1st | 3rd
  if (rows.length) {
    const pod = el('div', 'podium');
    for (const i of [1, 0, 2]) {
      const e = rows[i], p = el('div', 'pod p' + (i + 1) + (e ? '' : ' empty') + (e && e.name === me ? ' me' : ''));
      if (e) { p.append(el('div', 'pname', e.name), el('div', 'pscore', U.fmt(e.score)), el('div', 'ptime', time(e.dur))); }
      else p.append(el('div', 'pname', '—'));
      const block = el('div', 'block'); block.append(el('span', '', String(i + 1))); p.appendChild(block);
      pod.appendChild(p);
    }
    list.appendChild(pod);
  }
  // everyone else
  if (rows.length > 3) {
    const tbl = el('div', 'lbTable'), head = el('div', 'lbRow head');
    head.append(el('span', 'rk', '#'), el('span', 'nm', 'DRIVER'), el('span', 'sc', 'SCORE'), el('span', 'tm', 'TIME'));
    tbl.appendChild(head);
    rows.slice(3).forEach((e, k) => {
      const row = el('div', 'lbRow' + (e.name === me ? ' me' : ''));
      row.append(el('span', 'rk', String(k + 4)), el('span', 'nm', e.name), el('span', 'sc', U.fmt(e.score)), el('span', 'tm', time(e.dur)));
      tbl.appendChild(row);
    });
    list.appendChild(tbl);
  }
  if (!rows.length) list.appendChild(el('div', 'lbEmpty', 'No drives yet. Be the first on the podium!'));
}

// ---------- multiplayer (dedicated server: public servers + private rooms with codes) ----------
Net.init(scene);
renderAccount(); Account.init();
const mpEl = $id;
const mpCode = mpEl('mpCode');
mpEl('mpHostScored').onclick = () => Net.host(myName(), Settings.color, { scored: true });
mpEl('mpHostFree').onclick = () => Net.host(myName(), Settings.color, { scored: false, density: Settings.mpDensity });
mpEl('mpJoin').onclick = () => Net.joinCode(mpCode.value, myName(), Settings.color);
mpCode.addEventListener('keydown', e => { if (e.key === 'Enter') Net.joinCode(mpCode.value, myName(), Settings.color); });
mpEl('mpRefresh').onclick = () => Net.refreshList();
Net.onList = j => {
  mpEl('mpOnline').textContent = j.online ? `· ${j.online} online` : '';
  const box = mpEl('mpServers'); box.innerHTML = '';
  for (const s of j.servers) {
    const row = document.createElement('div'), here = Net.room && Net.room.id === s.id;
    row.className = 'mpSrv' + (here ? ' here' : '');
    row.innerHTML = '<span class="nm"></span><span class="ct"></span>';
    row.querySelector('.nm').textContent = s.name;
    row.querySelector('.ct').textContent = `${s.players}/${s.max} players`;
    const b = document.createElement('button');
    b.textContent = here ? 'JOINED' : s.players >= s.max ? 'FULL' : 'JOIN';
    b.disabled = here || s.players >= s.max;
    b.onclick = () => Net.joinServer(s.id, myName(), Settings.color);
    row.appendChild(b); box.appendChild(row);
  }
  if (!j.servers.length) box.innerHTML = '<div class="mpEmpty">No public servers.</div>';
};
setInterval(() => { if (menuOpen && screen === 'scrMP' && !document.hidden) Net.refreshList(); }, 6000);
// "Install app" button (Chrome / Edge offer it when the game is opened from its website)
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; mpEl('installBtn').classList.remove('hidden'); });
addEventListener('appinstalled', () => mpEl('installBtn').classList.add('hidden'));
mpEl('installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; mpEl('installBtn').classList.add('hidden'); };
mpCode.addEventListener('input', () => { // auto-format as XXX-XXX
  const s = mpCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  mpCode.value = s.length > 3 ? s.slice(0, 3) + '-' + s.slice(3) : s;
});
mpEl('mpCopy').onclick = () => {
  const done = () => Net.status('Code copied. Paste it to your friends.', 'ok');
  if (navigator.clipboard) navigator.clipboard.writeText(Net.code).then(done, () => {}); else done();
};
Net.onStatus = (msg, kind) => { for (const id of ['mpStatus', 'mpStatus2']) { const el = mpEl(id); el.textContent = msg; el.className = kind; } };
Net.onRoster = () => {
  const on = Net.active(), r = Net.room;
  mpEl('mpLive').classList.toggle('hidden', !on);
  mpEl('mpLot').classList.toggle('hidden', !on);
  mpEl('mpHud').classList.toggle('hidden', !on);
  mpEl('mpWhere').textContent = r ? (r.pub ? r.name : 'Private server') : '';
  mpEl('mpCodeWrap').classList.toggle('hidden', !(r && r.code));
  mpEl('mpCodeShow').textContent = Net.code;
  mpEl('mpHudCode').textContent = r ? (r.pub ? r.name.toUpperCase() : 'PRIVATE · ' + r.code) + (r.scored ? ' · SCORED' : ' · FREE DRIVE') : '';
  const list = mpEl('mpList'); list.innerHTML = '';
  for (const p of Net.roster(0)) {
    const sp = document.createElement('span'); sp.style.setProperty('--c', p.color); sp.textContent = p.name + (p.you ? ' (you)' : '');
    list.appendChild(sp);
  }
};
// joined a server: loop circuit + shared traffic, starting in your own space in the parking lot
Net.ext = { front: M4_EXT.front, rear: M4_EXT.rear, hw: M4_EXT.hw };
Net.refS = () => car.s;
Net.onTraffic = m => traffic.applySnapshot(m);
traffic.onReport = c => Net.reportCrash(c);
traffic.onRecover = c => Net.reportRecover(c);
traffic.onGone = c => Net.reportGone(c);
Net.onJoined = (room, slot) => {
  Net.slot = slot; bigMap = false;
  score.reset();
  game.mode = 'mp'; game.scored = !!room.scored; game.density = room.density;
  enterServer(slot);
  closeMenu();
  hud.message(room.pub ? 'JOINED ' + room.name.toUpperCase() : 'PRIVATE SERVER ' + room.code);
  if (room.scored && Account.clientId && !Account.signedIn) setTimeout(() => hud.message('NOT SIGNED IN · RUNS WON\'T BE SAVED'), 1800);
};
// left the server (or lost it): endless road again, back to the menu
Net.onRank = r => hud.message(`LEADERBOARD #${r}`);
Net.onLeft = () => {
  exitServer();
  game.mode = 'menu'; game.scored = false; game.density = SCORED_DENSITY;
  if (!quitting) openMenu('scrMP');
};
mpEl('mpLot').onclick = () => { if (Net.active()) { spawnInLot(Net.slot || 0); closeMenu(); hud.message('PARKING LOT'); } };
let mpHudT = 0;
// in-game player list: name, current score (grey), best score on this server (gold)
function updateMpHud(dt) {
  if (!Net.active() || (mpHudT -= dt) > 0) return;
  mpHudT = 0.25;
  const rows = Net.roster(score.score).sort((a, b) => b.best - a.best || b.score - a.score);
  mpEl('mpHudList').innerHTML = rows.map(r => `<div class="r${r.you ? ' you' : ''}" style="--c:${r.color}"><span class="n"></span>` +
    `<span class="k">${r.wait ? '…' : U.fmt(r.score)}</span><span class="s">${U.fmt(r.best)}</span></div>`).join('');
  [...mpEl('mpHudList').querySelectorAll('.n')].forEach((el, i) => (el.textContent = rows[i].name)); // names as text, never HTML
}
// my state as friends receive it (road coordinates + my clock, for smooth interpolation on their side)
function netState() {
  return { t: +(performance.now() / 1000).toFixed(3), s: +car.s.toFixed(2), d: +car.d.toFixed(3), ry: +(proxy.ry || 0).toFixed(4), v: +proxy.v.toFixed(2),
    steer: +car.steer.toFixed(3), brake: !!(car.brakeOn && car.gear >= 0), kmh: Math.round(Math.abs(car.u) * 3.6), score: Math.round(score.score),
    rt: Math.round(score.runTime || 0) };
}

// ---------- proximity multiplier (multiplayer): drive close to another player for up to x10 ----------
// gap between the two cars' outlines (m): ~10 ft (3 m) = x2, ~1 ft (0.3 m) = x10, nothing beyond 9 m
const PROX_CURVE = mcurve([[0.3, 10], [0.6, 7], [1, 5], [2, 3], [3.05, 2], [5, 1.5], [7, 1.25], [9, 1.1]]);
const _po = { s: 0, d: 0, relYaw: 0, front: M4_EXT.front, rear: M4_EXT.rear, hw: M4_EXT.hw };
function proximity(kmh) {
  if (game.mode !== 'mp' || kmh < 60) return 1;
  let g = Infinity;
  for (const p of Net.players.values()) {
    const n = p.now; if (!n || Math.abs(n.s - car.s) > 25) continue;
    Object.assign(_po, { s: n.s, d: n.d, relYaw: n.ry || 0 });
    g = Math.min(g, traffic.outlineGap(proxy, _po));
  }
  return g <= 9 ? PROX_CURVE(Math.max(0.3, g)) : 1;
}

// ---------- minimap (multiplayer) ----------
// Small: rounded square in the corner, you in the middle pointing up, the road, the start area and other
// players within ~600 m (players further away sit on the edge, in their direction).
// Big (M, rebindable): the whole loop, north up, every player with their name.
const mm = $id('minimap'), mmc = mm.getContext('2d');
let mmT = 0, bigMap = false, mmSize = 0;
const MM_SMALL = 190, MM_BIG = 420;
const mmLoop = () => {                                     // whole loop outline (world x/z), cached
  if (mmLoop.c && mmLoop.c.lp === ROAD.loop) return mmLoop.c;
  const pts = []; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let s = 0; s <= ROAD.loop.L; s += 40) { const p = ROAD.pos(s, 0); pts.push([p.x, p.z]); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  return (mmLoop.c = { lp: ROAD.loop, pts, x0, x1, z0, z1 });
};
// the start area outline: off-ramp, pad, on-ramp (road coordinates around a lap start)
function mmStartShapes(lap) {
  const eR = ROAD.edgeR, D = LOOP, pad = [], off = [], on = [];
  for (const [s, d] of [[D.LOT_S0, D.LOT_D0], [D.LOT_S1, D.LOT_D0], [D.LOT_S1, D.LOT_D1], [D.LOT_S0, D.LOT_D1]]) pad.push(ROAD.pos(lap + s, eR + d));
  for (let s = D.DEC1; s <= D.LOT_S0; s += 10) off.push(ROAD.pos(lap + s, ROAD.offD(s)));
  for (let s = D.LOT_S1; s <= D.ACC0; s += 10) on.push(ROAD.pos(lap + s, ROAD.rampD(s)));
  return { pad, off, on };
}
function drawMinimap(dt) {
  const on = game.mode === 'mp' && !menuOpen && (Settings.minimap || bigMap);
  if (mm.classList.contains('hidden') === on) mm.classList.toggle('hidden', !on);
  if (!on || (mmT -= dt) > 0) return;
  mmT = bigMap ? 0.12 : 0.08;
  const size = bigMap ? MM_BIG : MM_SMALL, dpr = Math.min(devicePixelRatio || 1, 2);
  if (mmSize !== size) { mmSize = size; mm.width = mm.height = Math.round(size * dpr); mm.style.width = mm.style.height = size + 'px'; mm.classList.toggle('big', bigMap); }
  const g = mmc, W = size;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, W);
  g.lineJoin = g.lineCap = 'round';
  const line = (pts, map, w, col) => { g.beginPath(); pts.forEach((p, i) => { const q = map(p.x ?? p[0], p.z ?? p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.lineWidth = w; g.strokeStyle = col; g.stroke(); };
  const lap = ROAD.near(0, car.s), start = mmStartShapes(lap);
  const dot = (x, y, col, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#fff'; g.stroke(); };
  const meArrow = (x, y, ang, sc) => {
    g.save(); g.translate(x, y); g.rotate(ang); g.scale(sc, sc);
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath();
    g.fillStyle = '#ffd84a'; g.fill(); g.lineWidth = 1.4; g.strokeStyle = '#1a1f28'; g.stroke(); g.restore();
  };

  if (!bigMap) {
    // ---- small: heading-up around me ----
    const R = W / 2, range = 600, k = R / range, yaw = car.visYaw, sy = Math.sin(yaw), cy = Math.cos(yaw);
    const map = (x, z) => { const dx = x - car.x, dz = z - car.z; return [R + (dx * cy + dz * sy) * k, R - (dx * sy - dz * cy) * k]; };
    g.save(); g.beginPath(); g.rect(4, 4, W - 8, W - 8); g.clip();
    const road = []; for (let s = car.s - range * 1.6; s <= car.s + range * 1.6; s += 10) road.push(ROAD.pos(s, 0));
    if (Math.abs(car.s - lap) < 1600) {
      line(start.off, map, Math.max(3, 7 * k), 'rgba(205,212,222,0.55)');
      line(start.on, map, Math.max(3, 7 * k), 'rgba(205,212,222,0.55)');
      g.beginPath(); start.pad.forEach((p, i) => { const q = map(p.x, p.z); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath();
      g.fillStyle = 'rgba(200,198,190,0.55)'; g.fill();
    }
    line(road, map, Math.max(6, 18 * k), 'rgba(10,13,19,0.55)');
    line(road, map, Math.max(4, 15 * k), 'rgba(214,220,230,0.85)');
    for (const p of Net.players.values()) {
      const n = p.now; if (!n) continue;
      const pos = ROAD.pos(n.s, n.d); let [x, y] = map(pos.x, pos.z);
      const m = 11, far = x < m || y < m || x > W - m || y > W - m;
      if (far) { const dx = x - R, dy = y - R, f = (R - m) / Math.max(Math.abs(dx), Math.abs(dy)); x = R + dx * f; y = R + dy * f; }
      dot(x, y, p.color, far ? 4 : 5.5);
    }
    g.restore();
    meArrow(R, R, 0, 1);
    g.font = '700 10px Segoe UI, Arial'; g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText(keyLabel(Input.binds.map[0]) + ' · MAP', W - 9, W - 9);
  } else {
    // ---- big: the whole loop, north up ----
    const L = mmLoop(), pad = 30, k = (W - pad * 2) / Math.max(L.x1 - L.x0, L.z1 - L.z0);
    const ox = (W - (L.x1 - L.x0) * k) / 2, oz = (W - (L.z1 - L.z0) * k) / 2 + 6;
    const map = (x, z) => [ox + (x - L.x0) * k, oz + (z - L.z0) * k];
    g.font = '800 12px Segoe UI, Arial'; g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText('MAP', 14, 22);
    g.textAlign = 'right'; g.font = '700 11px Segoe UI, Arial'; g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillText(keyLabel(Input.binds.map[0]) + ' to close', W - 14, 22);
    line(L.pts.concat([L.pts[0]]), map, 7, 'rgba(10,13,19,0.55)');
    line(L.pts.concat([L.pts[0]]), map, 4.5, 'rgba(214,220,230,0.85)');
    // start area
    const sp = map(start.pad[0].x, start.pad[0].z);
    g.beginPath(); g.arc(sp[0], sp[1], 7, 0, Math.PI * 2); g.fillStyle = '#2f3440'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#d6dbe3'; g.stroke();
    g.font = '900 9px Segoe UI, Arial'; g.textAlign = 'center'; g.fillStyle = '#ffd84a'; g.fillText('S', sp[0], sp[1] + 3.2);
    // players with names
    g.font = '700 11px Segoe UI, Arial';
    for (const p of Net.players.values()) {
      const n = p.now; if (!n) continue;
      const pos = ROAD.pos(n.s, n.d), [x, y] = map(pos.x, pos.z);
      dot(x, y, p.color, 5.5);
      g.textAlign = 'left'; g.lineWidth = 3; g.strokeStyle = 'rgba(10,13,19,0.8)'; g.strokeText(p.name, x + 8, y + 4);
      g.fillStyle = '#fff'; g.fillText(p.name, x + 8, y + 4);
    }
    const [mx, my] = map(car.x, car.z);
    meArrow(mx, my, car.visYaw, 1.15);
  }
}

// what's on the pause screen
function updatePause() {
  const r = Net.room;
  $id('pauseMode').textContent = game.mode === 'mp'
    ? `${r && r.pub ? r.name : 'Private server'} · ${game.scored ? 'Scored' : 'Free drive'} · ${Math.round(game.density * 100)}% traffic`
    : game.scored ? 'Singleplayer · Scored · 60% traffic' : `Singleplayer · Free drive · ${Math.round(game.density * 100)}% traffic`;
}
function hintText() {
  const k = a => keyLabel(Input.binds[a][0]);
  return `${k('camera')} camera · ${k('style')} style · ${k('reset')} restart` + (game.mode === 'sp' && !game.scored ? ' · [ ] traffic' : '') + ' · Esc menu';
}

function openMenu(id = 'scrPause') {
  menuOpen = true; menu.classList.remove('hidden'); show(id);
  document.getElementById('hud').classList.add('hidden'); sound.suspend(true); camS.orbit = 0;
}
function closeMenu() {
  menuOpen = false; menu.classList.add('hidden'); document.getElementById('hud').classList.remove('hidden');
  $id('hint').textContent = hintText();
  hud.trafficLabel = game.mode === 'mp' ? (game.scored ? 'SCORED SERVER' : `SHARED TRAFFIC ${Math.round(game.density * 100)}%`)
    : game.scored ? 'SCORED · 60% TRAFFIC' : `FREE DRIVE · ${Math.round(game.density * 100)}%`;
  sound.init(); sound.suspend(false);
  started = true; last = performance.now();
}

function updatePadPanel() {
  const p = Input.pad, st = document.getElementById('padStatus'), ax = document.getElementById('axes');
  if (!p) { st.textContent = 'No wheel detected. Turn the wheel or press a pedal (the browser only reveals it after input).'; ax.innerHTML = ''; return; }
  st.textContent = `${Input.padKind === 'gamepad' ? 'Controller' : 'Wheel'}: ${p.id.slice(0, 60)}`;
  if (ax.children.length !== p.axes.length) ax.innerHTML = p.axes.map((_, i) => `<div class="ax">${i}<i></i></div>`).join('');
  p.axes.forEach((v, i) => {
    const bar = ax.children[i].querySelector('i');
    bar.style.setProperty('--w', Math.abs(v) * 50 + '%');
    bar.style.setProperty('--o', v < 0 ? '-100%' : '0%');
  });
}

function updatePlayerVisual(dt) {
  playerRoot.position.set(car.x, 0, car.z);
  car.visK = 0; // body points exactly where the car is going (no lead = no "drift" look)
  playerRoot.rotation.y = -car.visYaw;
  // body pitch / roll from load transfer (purely visual)
  // spring-damper body motion so the car leans into turns and settles instead of feeling rigid
  const bm = camS.body || (camS.body = { roll: 0, rv: 0, pitch: 0, pv: 0 });
  const ayNow = car.u * car.r;
  if (dt > 0) {
    // barely-there lean (~0.5 deg in a hard turn), critically damped so it never rocks
    bm.rv += ((U.clamp(ayNow, -12, 12) * -0.0009 - bm.roll) * 120 - bm.rv * 22) * dt; bm.roll += bm.rv * dt;
    // nose dives visibly under hard braking (~1.7 deg at full ABS stop), squats slightly on throttle
    const axc = U.clamp(car.ax, -15, 12), pitchT = axc < 0 ? axc * 0.002 : axc * 0.0007;
    bm.pv += ((pitchT - bm.pitch) * 120 - bm.pv * 18) * dt; bm.pitch += bm.pv * dt;
  }
  playerVis.root.rotation.x = bm.pitch;
  playerVis.root.rotation.z = bm.roll;
  animateWheels(playerVis, car.u * dt, car.steer);
  swMesh.rotation.z = -car.steer * M4.ratio / Settings.sens;
  playerVis.brake.visible = car.brakeOn && car.gear >= 0;
  playerGlass.opacity = camMode === 1 && !menuOpen ? 0.14 : 0.78;
}

// ---------- visual styles (T cycles): 0 = normal, 1 = toon, 2 = realistic ----------
// Styles 1 and 2 render the scene into a multisampled target, run a "look" pass
// (toon: brighter saturated colour + soft dark outlines from depth edges; realistic: ACES
// filmic tone mapping + gentle vignette), then a final FXAA pass so edges stay smooth.
const FX = (() => {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rtScene = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  rtScene.depthTexture = new THREE.DepthTexture(size.x, size.y);
  rtScene.depthTexture.type = THREE.UnsignedIntType;
  const rtLook = new THREE.WebGLRenderTarget(size.x, size.y); // sRGB-encoded 8-bit result of the look pass
  const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const look = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: rtScene.texture }, tDepth: { value: rtScene.depthTexture }, res: { value: size.clone() },
      near: { value: camera.near }, far: { value: camera.far }, thick: { value: 1 }, mode: { value: 1 }, exposure: { value: 0.72 },
    },
    vertexShader: vs,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D tColor, tDepth; uniform vec2 res; uniform float near, far, thick, mode, exposure;
      float lin(vec2 uv){ float z = texture2D(tDepth, uv).r * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
      vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      void main(){
        vec3 c = texture2D(tColor, vUv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        if (mode < 1.5) {
          // ---- toon: lighter, brighter, saturated ----
          c = max(mix(vec3(l), c, 1.35), 0.0);
          c = c * 1.12 + 0.015;
          // soft outlines where depth jumps (anti-aliased by the edge ramp + FXAA after)
          vec2 px = thick / res;
          float d0 = lin(vUv);
          float dl = lin(vUv - vec2(px.x, 0.0)), dr = lin(vUv + vec2(px.x, 0.0));
          float dd = lin(vUv - vec2(0.0, px.y)), du = lin(vUv + vec2(0.0, px.y));
          float lap = abs(dl + dr - 2.0 * d0) + abs(du + dd - 2.0 * d0);
          float nearest = min(d0, min(min(dl, dr), min(du, dd)));
          float e = smoothstep(0.006, 0.035, lap / nearest);
          e *= 1.0 - smoothstep(300.0, 850.0, nearest);
          c = mix(c, vec3(0.06, 0.07, 0.10), e * 0.88);
        } else {
          // ---- realistic: filmic tone mapping, slight richness, vignette ----
          c = aces(c * exposure);
          float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l2), c, 1.08);
          float v = smoothstep(0.45, 1.05, length((vUv - 0.5) * vec2(1.25, 1.0)));
          c *= 1.0 - 0.22 * v;
        }
        gl_FragColor = LinearTosRGB(vec4(c, 1.0));
      }`,
    depthTest: false, depthWrite: false,
  });
  const fxaa = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: rtLook.texture }, res: { value: size.clone() } },
    vertexShader: vs,
    fragmentShader: `
      varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 res;
      void main(){
        vec2 inv = 1.0 / res; vec3 L = vec3(0.299, 0.587, 0.114);
        vec3 nw = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * inv).rgb, ne = texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * inv).rgb;
        vec3 sw = texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * inv).rgb, se = texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * inv).rgb;
        vec3 m = texture2D(tDiffuse, vUv).rgb;
        float lNW = dot(nw, L), lNE = dot(ne, L), lSW = dot(sw, L), lSE = dot(se, L), lM = dot(m, L);
        float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
        vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
        float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
        float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
        dir = clamp(dir * rcp, -8.0, 8.0) * inv;
        vec3 a = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
        vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, vUv - dir * 0.5).rgb + texture2D(tDiffuse, vUv + dir * 0.5).rgb);
        float lB = dot(b, L);
        gl_FragColor = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const quad = mat => { const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)); return s; };
  return { mode: 0, rtScene, rtLook, look, fxaa, lookScene: quad(look), fxaaScene: quad(fxaa), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
})();
function fxResize() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  FX.rtScene.setSize(size.x, size.y); FX.rtLook.setSize(size.x, size.y);
  FX.look.uniforms.res.value.copy(size); FX.fxaa.uniforms.res.value.copy(size);
  FX.look.uniforms.thick.value = Math.max(1, renderer.getPixelRatio() * 0.75);
}
fxResize();
addEventListener('resize', fxResize);

// scene-side tweaks for the realistic look (stronger sun for the tone curve, crisper shadows,
// glossier paint, a little more atmospheric haze); everything is restored when leaving it
function realisticScene(on) {
  sunLight.intensity = on ? 1.9 : 1.2;
  hemi.intensity = on ? 0.7 : 0.72;
  const ms = on ? 3072 : 2048;
  if (sunLight.shadow.mapSize.x !== ms) {
    sunLight.shadow.mapSize.set(ms, ms);
    if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
  }
  playerPaint.envMapIntensity = playerPaintDS.envMapIntensity = on ? 1.8 : 1.1;
  scene.fog.near = on ? 120 : 160; scene.fog.far = on ? 1100 : 1250;
}
const FX_NAMES = ['SHADERS OFF', 'TOON', 'REALISTIC'];
function setFx(mode, silent) {
  FX.mode = mode; Settings.fx = mode; saveSettings();
  realisticScene(mode === 2);
  if (!silent) hud.message(FX_NAMES[mode]);
}
function renderFrame() {
  if (FX.mode === 0) { renderer.render(scene, camera); return; }
  renderer.setRenderTarget(FX.rtScene);
  renderer.render(scene, camera);
  FX.look.uniforms.near.value = camera.near; FX.look.uniforms.far.value = camera.far;
  FX.look.uniforms.mode.value = FX.mode;
  renderer.setRenderTarget(FX.rtLook);
  renderer.render(FX.lookScene, FX.cam);
  renderer.setRenderTarget(null);
  renderer.render(FX.fxaaScene, FX.cam);
}

// ---------- one step of driving: physics, traffic, collisions, scoring ----------
// paused = the menu is open on a server: the car keeps rolling (no throttle or brake, lane keeping
// steers it down its lane) so it never just stops in the middle of shared traffic. No points meanwhile.
const COAST = { steer: 0, throttle: 0, brake: 0, handbrake: 0, source: 'keys' };
function driveStep(dt, ctl, paused) {
  // ---- physics (fixed-size substeps that exactly cover the frame) ----
  const n = Math.max(1, Math.ceil(dt / SUB)), h = dt / n;
  const steerSet = paused ? Object.assign({}, Settings, { assist: 1 }) : Settings;
  let wallHit = 0;
  ROAD.hintS = car.s;      // (loop circuit: road lookups pick the lap you're on)
  for (let i = 0; i < n; i++) {
    steerCtl.update(h, car, ctl, steerSet);
    car.step(h, ctl);
    wallHit = Math.max(wallHit, railCollide(h));
  }
  // safety net: if the car state ever becomes invalid (NaN), put it back on the road
  if (![car.x, car.z, car.u, car.v, car.r, car.yaw, car.steer].every(Number.isFinite)) {
    car.place(Number.isFinite(lastGoodS) ? lastGoodS : 40, ROAD.lane(2), 100 / 3.6);
    car.wImp = 0; car.rK = 0; steerCtl.key = steerCtl.k1 = steerCtl.wheelF = 0;
  }
  const pr = ROAD.project(car.x, car.z);
  car.s = pr.s; car.d = pr.d; lastGoodS = pr.s;
  const ry = ROAD.yaw(car.s);
  const vx = car.u * Math.sin(car.yaw) + car.v * Math.cos(car.yaw), vz = -car.u * Math.cos(car.yaw) + car.v * Math.sin(car.yaw);
  Object.assign(proxy, { s: car.s, d: car.d, v: vx * Math.sin(ry) - vz * Math.cos(ry), ry: U.wrap(car.visYaw - ry) });

  // ---- traffic, collisions, scoring ----
  Net.tick(dt, netState());
  traffic.update(dt, proxy, game.density);
  const impact = traffic.collide(car, trafficHull);
  // friends: light bumps just push you around, a hard hit (> ~11 km/h difference) costs your streak
  const bump = Net.collide(car, trafficHull);
  if (bump > 0.45) sound.thump(0.2 + bump / 12);
  if (bump > 3) crashEvent(bump);
  // cones / barrels: knocked flying (no streak loss), with a little thud and a small speed scrub
  const coneHits = zoneProps.update(dt, car, car.s, M4_EXT);
  if (coneHits) { sound.thump(0.15 * coneHits); car.u *= Math.pow(0.985, coneHits); }
  if (impact > 0.45) crashEvent(impact); // the lightest brushes (<0.45 m/s) just bump you
  if (impact > 1.5) car.hitT = 0.8;
  if (wallHit > 3.5 || zoneHit) crashEvent(wallHit);
  zoneHit = false;
  const kmh = Math.abs(car.u) * 3.6;
  const misses = traffic.nearMisses(proxy, kmh); // always run so pass tracking stays correct
  if (paused) { score.prox = 1; score.update(dt); return; }   // (no points while the menu is open)
  // multiplayer: driving close to another player multiplies the points you earn
  score.prox = proximity(kmh);
  const pe = $id('prox');
  if (pe.classList.contains('on') !== score.prox > 1) pe.classList.toggle('on', score.prox > 1);
  if (score.prox > 1) hud.set('prox', pe.firstElementChild, '×' + score.prox.toFixed(1));
  // Shoulder: car centre past the outer edge lines -> no points, and lose 10% of points per second
  const onShoulder = Math.abs(car.d) > 2 * ROAD.LW + 0.25 && Math.abs(car.u) > 2 && !inStartArea(car.s, car.d);
  if (!onShoulder) {
    for (const nm of misses) if (time - lastCrash > 1.5) score.nearMiss(nm.gap, kmh);
    if (time - lastCrash > 1.5) score.speed(dt, kmh);
  } else {
    if (time - lastShoulder > 1.5) shoulderLost = 0; // new trip onto the shoulder: count from zero
    shoulderLost += score.shoulder(dt);
    lastShoulder = time;
  }
  hud.shoulderWarn(onShoulder, shoulderLost);
  score.update(dt);

  // ---- floating origin: keep coordinates small for precision ----
  // (the loop circuit stays within a few km of the centre, so it never needs this)
  if (!ROAD.loop && car.z < -3000) {
    const sh = 3000;
    ROAD.origin += sh; car.z += sh;
    for (const c of traffic.cars) if (c.crashed && c.body) { c.body.z += sh; c.z += sh; }
    for (const c of world.clouds.children) c.position.z += sh;
    zoneProps.shift(sh);
  }
}

// ---------- main loop ----------
const SUB = 1 / 240;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = U.clamp((now - last) / 1000, 0, 0.05); last = Math.max(last, now);
  const ctl = Input.update(now, dt);

  if (menuOpen) {
    // Esc: pause -> back to driving; settings -> where you came from; other screens -> main menu
    if (Input.hit('Escape')) {
      if (screen === 'scrPause') closeMenu();
      else if (screen === 'scrSettings') show(settingsFrom);
      else if (screen !== 'scrTitle') show(game.mode === 'menu' ? 'scrTitle' : 'scrPause');
    } else if (Input.hit('Enter') && screen === 'scrPause') closeMenu();
    updatePadPanel();
    // on a server the game doesn't stop behind the menu: your car keeps rolling with the shared traffic
    const rolling = game.mode === 'mp';
    if (rolling) { time += dt; driveStep(dt, COAST, true); }
    updatePlayerVisual(rolling ? dt : 0);
    updateCamera(dt);
    sunLight.position.set(car.x + SUN_OFF.x, SUN_OFF.y, car.z + SUN_OFF.z);
    sunLight.target.position.set(car.x, 0, car.z);
    world.update(car.s, camera);
    if (rolling) sound.update(car, 0, Settings.vol);
    drawMinimap(dt);
    Input.endFrame();
    renderFrame();
    return;
  }
  if (Input.hit('Escape') || Input.hit('KeyP')) { openMenu('scrPause'); Input.endFrame(); return; }
  time += dt;
  if (Input.tap('camera') || ctl.camBtn) camMode ^= 1;
  if (Input.tap('style')) setFx((FX.mode + 1) % 3);   // normal -> toon -> realistic -> normal
  if (Input.tap('reset') || ctl.reset) resetCar();
  if (game.mode === 'sp' && !game.scored && (Input.hit('BracketLeft') || Input.hit('BracketRight'))) { // [ ] traffic (free drive only)
    game.density = U.clamp(Math.round(game.density * 10 + (Input.hit('BracketRight') ? 1 : -1)) / 10, 0, 1);
    const el = $id('fdDens'); el.value = Math.round(game.density * 100); el.dispatchEvent(new Event('input'));
    hud.trafficLabel = `FREE DRIVE · ${Math.round(game.density * 100)}%`;
  }
  if (Input.tap('gearbox')) { car.manual = Settings.manual = !car.manual; manEl.checked = car.manual; saveSettings(); hud.message(car.manual ? 'MANUAL' : 'AUTO'); }
  if (Input.tap('map') && game.mode === 'mp') bigMap = !bigMap;
  if (Input.tap('shiftUp') || ctl.up) { if (!car.manual) { car.manual = Settings.manual = true; manEl.checked = true; } car.shift(1); }
  if (Input.tap('shiftDown') || ctl.down) { if (!car.manual) { car.manual = Settings.manual = true; manEl.checked = true; } car.shift(-1); }

  driveStep(dt, ctl, false);
  world.update(car.s, camera);

  updatePlayerVisual(dt);
  updateCamera(dt);
  sunLight.position.set(car.x + SUN_OFF.x, SUN_OFF.y, car.z + SUN_OFF.z);
  sunLight.target.position.set(car.x, 0, car.z);

  hud.update(dt, car, score, steerCtl, Settings);
  updateMpHud(dt);
  drawMinimap(dt);
  sound.update(car, ctl.throttle, Settings.vol);
  Input.endFrame();
  renderFrame();
}
// restore the last visual style (older saves used a toon on/off flag)
setFx(Number.isInteger(Settings.fx) ? Settings.fx : (Settings.toon ? 1 : 0), true);
requestAnimationFrame(frame);
