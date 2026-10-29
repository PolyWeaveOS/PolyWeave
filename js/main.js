'use strict';
// =====================================================================
//  Main: scene, cameras, game loop, menu/settings
// =====================================================================

// ---------- settings ----------
const DEFAULTS = { density: 0.55, assist: 0, sens: 1.0, kbSens: 1.0, blur: 0, world: 'grass', tod: 'day', hostVis: 'public', hostWorld: 'grass', hostTod: 'day', hostName: '', mirrors: 'medium', units: 'mph', rhd: false, vol: 0.6, tc: true, manual: false, color: '#a6b0b8', mpDensity: 0.55, minimap: true, chatSize: 1.8, assistKb: 1, ghost: true };   // (assist: steering wheel lane assist; assistKb: keyboard / gamepad, 100% = the tuned straighten-up help)
const SCORED_DENSITY = 0.6;               // scored (leaderboard) runs always use this much traffic
const Settings = Object.assign({}, DEFAULTS);
try { Object.assign(Settings, JSON.parse(localStorage.getItem('tw_settings2') || '{}')); } catch (e) { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem('tw_settings2', JSON.stringify(Settings)); } catch (e) { /* ignore */ } };
// the chat's default went from 50% to 75% (1.2 -> 1.8): anyone still on the old default moves up once; a size
// someone picked themselves stays
if (!Settings.chat75) { if (Math.abs(Settings.chatSize - 1.2) < 1e-6) Settings.chatSize = 1.8; Settings.chat75 = true; }
// keyboard sensitivity was rescaled (old 2.0x is the new 1.0x): carry a saved value over so the feel doesn't change
if (Settings.kbV !== 2) {
  try { const saved = JSON.parse(localStorage.getItem('tw_settings2') || '{}'); if (saved.kbSens) Settings.kbSens = U.clamp(saved.kbSens / 2, 0.3, 2); } catch (e) { /* ignore */ }
  Settings.kbV = 2; saveSettings();
}

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
// HUD size (score, near miss / crash messages, run result, speedometer...) follows the window: full size with
// about 1250 px of height (a big monitor), smaller on laptops, never under half (style.css --hud)
// The main menu page (logo, big buttons, friends / inbox) scales the same way: full size on a big monitor,
// down to ~0.62 on a small laptop (style.css --ui)
function hudScale() {
  const s = document.documentElement.style;
  s.setProperty('--hud', U.clamp(Math.min(innerHeight / 1250, innerWidth / 2000), 0.5, 1.1).toFixed(3));
  s.setProperty('--ui', U.clamp(Math.min(innerHeight / 1000, innerWidth / 1650), 0.62, 1).toFixed(3));
}
hudScale(); addEventListener('resize', hudScale);

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
const playerPaint = new THREE.MeshPhysicalMaterial({ color: Settings.color, roughness: 0.24, metalness: 0.55, envMapIntensity: 1.1, clearcoat: 1, clearcoatRoughness: 0.06 });   // (clear-coated car paint)
const playerGlass = new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.78, envMapIntensity: 1.5, side: THREE.DoubleSide });
const playerRim = new THREE.MeshStandardMaterial({ color: 0x9c7a4c, roughness: 0.32, metalness: 0.85 }); // wheels (Garage colour)
const playerCaliper = new THREE.MeshStandardMaterial({ color: 0xc8161d, roughness: 0.4, metalness: 0.2 });   // brake calipers (Garage colour)
const PLAYER_OVR = { [SLOT.GLASS]: playerGlass, [SLOT.RIM]: playerRim, [SLOT.CALIPER]: playerCaliper };
const playerVis = makeVehicle('m4', playerPaint, PLAYER_OVR);
// double-sided where needed: the cockpit view sees panels from inside, and the imported model's
// surfaces aren't guaranteed to all face outward (one copy of each, shared by every car you can pick)
const importedM4 = !!playerVis.M.wheelGeoms;
const DS_MATS = {};
const doubleSided = mats => mats.map((m, i) => m && (importedM4 || i === SLOT.PAINT || i === SLOT.CARBON || i === SLOT.TRIM) ? (DS_MATS[i] || (DS_MATS[i] = Object.assign(m.clone(), { side: THREE.DoubleSide }))) : m);
playerVis.body.material = doubleSided(playerVis.body.material);
const playerPaintDS = playerVis.body.material[SLOT.PAINT];
// seen from inside (cockpit view) the painted roof and pillars are a dark headliner, not body colour lit by the grass
playerPaintDS.onBeforeCompile = sh => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  if (!gl_FrontFacing) gl_FragColor.rgb = vec3(0.035, 0.037, 0.042);');
};
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
DriftFx.init(scene);                                   // (the drift car's tyre smoke + skid marks - js/drift.js)

// ---------- first-person cockpit (only drawn in the cockpit camera) ----------
// Low-poly interior in the game's style (flat-shaded, few sides): a faceted dash with the gauge cluster set
// into it in front of the driver (live speed / gear / revs), console, doors, passenger seat, a faceted wheel
// with the M stripe, and real mirrors: a rear-view mirror hanging from the windscreen and the two door
// mirrors (their glass fills the whole mirror), each showing what's behind you from a camera on the car.
// Settings: mirror quality (low / medium / high), speed units, which side you drive from.
const cockpit = new THREE.Group(); cockpit.visible = false; playerVis.root.add(cockpit);
const cockpitWheel = new THREE.Group(); cockpitWheel.visible = false; swTilt.add(cockpitWheel);
const driverSide = new THREE.Group(); cockpit.add(driverSide);       // (the bits in front of the driver: moved for right-hand drive)
const MIRRORS = (() => {
  const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  const dash = std(0x17191d, 0.85), dash2 = std(0x202329, 0.8), trim = std(0x3c424b, 0.35, 0.6), leather = std(0x16181c, 0.9), gloss = std(0x0d0e11, 0.35, 0.3);
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = cockpit) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // a rectangle with cut (chamfered) corners: the low-poly mirror outline
  const chamfer = (w, h, c) => {
    const s = new THREE.Shape(), x = w / 2, y = h / 2;
    s.moveTo(-x + c, -y); s.lineTo(x - c, -y); s.lineTo(x, -y + c); s.lineTo(x, y - c); s.lineTo(x - c, y); s.lineTo(-x + c, y); s.lineTo(-x, y - c); s.lineTo(-x, -y + c); s.closePath();
    return s;
  };
  // mirror glass: the picture is flipped left-right, like a real mirror
  const glassGeo = (w, h, c, shape) => {
    const g = new THREE.ShapeGeometry(shape || chamfer(w, h, c)), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, 1 - (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
    return g;
  };
  // --- dash: one faceted piece across the car (a side profile pushed out sideways) ---
  {
    const prof = new THREE.Shape([[0.55, 0.58], [0.55, 0.78], [0.62, 0.855], [0.75, 0.9], [0.96, 0.91], [0.96, 0.58]].map(([a, b]) => new THREE.Vector2(a, b)));
    const g = new THREE.ExtrudeGeometry(prof, { depth: 1.72, bevelEnabled: false });
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -0.86, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));   // profile (forward, up) -> car (x, y, z)
    add(g, dash, 0, 0, 0);
    add(box(1.70, 0.012, 0.012), trim, 0, 0.782, -0.555);                          // thin trim line along the dash face
    for (const x of [-0.12, 0.12]) add(box(0.13, 0.05, 0.02), gloss, x, 0.72, -0.553);   // centre air vents
  }
  // --- gauge cluster: a faceted pod sitting on the dash, screen set into its face, hood over it ---
  const gauge = document.createElement('canvas'); gauge.width = 512; gauge.height = 176;
  const gTex = new THREE.CanvasTexture(gauge); gTex.encoding = THREE.sRGBEncoding;
  {
    const pod = new THREE.Group(); pod.position.set(-0.37, 0.905, -0.70); pod.rotation.x = -0.32; driverSide.add(pod);
    add(box(0.40, 0.14, 0.16), dash2, 0, 0.0, 0, 0, 0, 0, pod);                   // the pod (half sunk into the dash)
    add(box(0.42, 0.018, 0.2), dash2, 0, 0.078, 0.02, 0, 0, 0, pod);               // hood overhang
    add(box(0.362, 0.118, 0.004), gloss, 0, -0.004, 0.0805, 0, 0, 0, pod);          // bezel
    add(new THREE.PlaneGeometry(0.35, 0.106), new THREE.MeshBasicMaterial({ map: gTex, toneMapped: false }), 0, -0.004, 0.0828, 0, 0, 0, pod);
  }
  // --- console, doors, passenger seat ---
  add(box(0.26, 0.2, 0.86), dash, 0, 0.58, -0.26);
  add(box(0.2, 0.012, 0.7), trim, 0, 0.687, -0.24);
  add(new THREE.CylinderGeometry(0.022, 0.03, 0.08, 6), gloss, 0, 0.73, -0.08);   // gear selector
  for (const sg of [-1, 1]) {
    add(box(0.07, 0.07, 1.25), trim, sg * 0.86, 0.86, -0.08);                       // door top
    add(box(0.08, 0.06, 0.44), leather, sg * 0.83, 0.72, -0.05);                    // armrest
  }
  const passenger = new THREE.Group(); cockpit.add(passenger);
  add(box(0.48, 0.13, 0.5), leather, 0, 0.47, 0.24, 0, 0, 0, passenger);
  add(box(0.48, 0.66, 0.13), leather, 0, 0.86, 0.56, -0.2, 0, 0, passenger);
  add(box(0.26, 0.16, 0.11), leather, 0, 1.28, 0.65, -0.2, 0, 0, passenger);
  for (const sg of [-1, 1]) add(box(0.06, 0.6, 0.16), leather, sg * 0.25, 0.86, 0.53, -0.2, 0, 0, passenger);   // bolsters
  // --- steering wheel (turns with yours): faceted rim, three spokes, M stripe at the top ---
  { // rim: faceted all round, with the M stripe (blue / dark blue / red) painted onto the top of it
    const g = new THREE.TorusGeometry(0.185, 0.028, 5, 120).rotateZ(Math.PI / 120).toNonIndexed(), p = g.attributes.position, col = new Float32Array(p.count * 3);
    const base = new THREE.Color(0x16181c), stripe = [0x2b7fd8, 0x1d3b8f, 0xd8302b].map(c => new THREE.Color(c));
    for (let i = 0; i < p.count; i += 3) {
      const a = Math.atan2((p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3) * 180 / Math.PI;
      const k = Math.floor((a - 85.5) / 3), c = k >= 0 && k < 3 ? stripe[2 - k] : base;   // three 3-degree bands at the top
      for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    add(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }), 0, 0, 0, 0, 0, 0, cockpitWheel);
  }
  add(new THREE.CylinderGeometry(0.046, 0.05, 0.045, 8), gloss, 0, -0.012, 0.005, Math.PI / 2, 0, 0, cockpitWheel);
  for (const [a, len] of [[0, 0.13], [Math.PI, 0.13], [-Math.PI / 2, 0.12]])
    add(box(len, 0.034, 0.022), trim, Math.cos(a) * 0.1, Math.sin(a) * 0.1 - 0.01, 0, 0, 0, a, cockpitWheel);
  // --- mirrors ---
  const list = [];
  const mirror = (key, w, h, c, parent, camPos, camDir, fov, shape) => {
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false, color: 0xffffff });
    const mesh = add(glassGeo(w, h, c, shape), mat, 0, 0, 0, 0, 0, 0, parent);
    list.push({ key, mat, mesh, target: null, cam: new THREE.PerspectiveCamera(fov, w / h, 0.3, 450), camPos, camDir: camDir.normalize(), aspect: w / h });
  };
  // rear-view mirror: hangs from the windscreen on a short stalk, angled toward the driver
  const rv = new THREE.Group(); rv.position.set(0.0, 1.228, -0.05); cockpit.add(rv);
  add(new THREE.ExtrudeGeometry(chamfer(0.192, 0.062, 0.018), { depth: 0.024, bevelEnabled: false }), gloss, 0, 0, -0.026, 0, 0, 0, rv);
  mirror('rear', 0.18, 0.052, 0.014, rv, new THREE.Vector3(0, 1.3, 2.5), new THREE.Vector3(0, -0.035, 1), 15);
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 1, 6), gloss); cockpit.add(stalk);
  { // stalk from the back of the mirror up to the glass
    const a = new THREE.Vector3(0, 1.255, -0.075), b = new THREE.Vector3(0, 1.318, -0.094), d = b.clone().sub(a);
    stalk.position.copy(a).add(b).multiplyScalar(0.5); stalk.scale.y = d.length(); stalk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    add(box(0.05, 0.012, 0.04), gloss, 0, 1.322, -0.1, -0.5);                     // foot on the glass
  }
  // door mirrors: live glass laid over the whole face of the car's own mirror heads (same shape, see M4_MIRROR)
  const heads = [];
  for (const sg of [-1, 1]) {
    const M = M4_MIRROR, head = new THREE.Group(); head.position.set(sg * M.x, M.y, M.z); head.rotation.y = sg * M.yaw; cockpit.add(head);
    const gl = new THREE.Group(); gl.position.set(0, 0, M.depth + 0.002); head.add(gl);
    mirror(sg < 0 ? 'left' : 'right', M.w * 0.94, M.h * 0.94, 0, gl, new THREE.Vector3(sg * (M.x + 0.02), M.y, M.z + M.depth + 0.01),
      new THREE.Vector3(sg * 0.16, -0.03, 1), 22, m4MirrorOutline(sg, 0.94));
    heads.push({ sg, head, m: list[list.length - 1] });
  }
  // the car you picked (Garage): its door mirrors sit somewhere else (the cockpit itself is shifted by `off`)
  const setMount = (M, off) => {
    for (const { sg, head, m } of heads) {
      head.position.set(sg * M.x - off.x, M.y - off.y, M.z - off.z); head.rotation.y = sg * M.yaw;
      m.camPos.set(sg * (M.x + 0.02), M.y, M.z + M4_MIRROR.depth + 0.01);
    }
  };
  // quality: picture size, smoothing and how often each mirror is redrawn (low suits slower computers)
  const Q = { low: { rear: [256, 74], side: [128, 62], samples: 0, every: [2, 4], far: 220 },
              medium: { rear: [384, 110], side: [192, 92], samples: 0, every: [1, 3], far: 320 },
              high: { rear: [512, 148], side: [256, 124], samples: 2, every: [1, 2], far: 450 } };
  let q = Q.medium, qName = 'medium';
  let off = false;
  const setQuality = name => {
    qName = name;
    off = name === 'off';                                   // off: plain dark glass, nothing extra drawn (fastest)
    q = Q[name] || Q.medium;
    for (const m of list) {
      if (m.target) { m.target.dispose(); m.target = null; }
      if (off) { m.mat.map = null; m.mat.color.set(0x1a2028); m.mat.needsUpdate = true; continue; }
      m.mat.color.set(0xffffff);
      const [w, h] = m.key === 'rear' ? q.rear : q.side;
      m.target = new THREE.WebGLRenderTarget(w, h, { samples: q.samples });
      m.mat.map = m.target.texture; m.mat.needsUpdate = true;
      m.cam.far = q.far; m.cam.updateProjectionMatrix();
    }
  };
  // which side you drive from: steering wheel, cluster, your eye position, passenger seat, rear-view angle
  const setSide = rhd => {
    const s = rhd ? 1 : -1;
    swTilt.position.x = s * 0.37; driverSide.position.x = rhd ? 0.74 : 0; passenger.position.x = -s * 0.37;
    rv.rotation.y = s * 0.45;
  };
  // live gauge cluster (redrawn ~12 times a second)
  let gT = 0;
  const drawGauge = dt => {
    if ((gT -= dt) > 0) return; gT = 0.08;
    const g = gauge.getContext('2d'), mph = Settings.units !== 'kmh', spd = Math.round(Math.abs(car.u) * (mph ? 2.23694 : 3.6)), rpm = U.clamp(car.rpm / (car.drift ? DRIFT.redline : M4.redline), 0, 1);
    g.fillStyle = '#0b0e13'; g.fillRect(0, 0, 512, 176);
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(28, 140, 456, 10);
    const rg = g.createLinearGradient(28, 0, 484, 0); rg.addColorStop(0, '#3aa0ff'); rg.addColorStop(0.75, '#7fd0ff'); rg.addColorStop(0.9, '#ff4d4d');
    g.fillStyle = rg; g.fillRect(28, 140, 456 * rpm, 10);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '800 88px Segoe UI, Arial'; g.fillText(String(spd), 256, 100);
    g.font = '700 19px Segoe UI, Arial'; g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(mph ? 'MPH' : 'KM/H', 256, 128);
    g.textAlign = 'left'; g.font = '800 44px Segoe UI, Arial'; g.fillStyle = '#ffd84a';
    g.fillText(car.gear < 0 ? 'R' : car.gear === 0 ? 'N' : String(car.gear), 34, 84);
    g.textAlign = 'right'; g.font = '700 17px Segoe UI, Arial'; g.fillStyle = 'rgba(255,255,255,.55)'; g.fillText(car.manual ? 'MANUAL' : 'AUTO', 478, 84);
    gTex.needsUpdate = true;
  };
  // another vehicle's mirrors (the van's cab): same live glass, drawn while that glass is on screen
  const addMirror = (key, w, h, c, parent, camPos, camDir, fov) => { mirror(key, w, h, c, parent, camPos, camDir, fov); setQuality(qName); };
  return { list, drawGauge, setQuality, setSide, setMount, addMirror, frame: 0, every: () => q.every, off: () => off, gaugeTex: gTex };   // (gaugeTex: the van's dash shows it too)
})();
// the mirrors' cameras follow the car (each redrawn every few frames, depending on quality)
const _mp = new THREE.Vector3(), _md = new THREE.Vector3();
const shownNow = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
function renderMirrors() {
  if (MIRRORS.off()) return;
  const on = MIRRORS.list.filter(m => shownNow(m.mesh));   // (the car's cockpit or the van's cab: whichever is on screen)
  if (!on.length) return;
  playerVis.root.updateMatrixWorld(true);
  const was = renderer.shadowMap.autoUpdate, rtWas = renderer.getRenderTarget();
  renderer.shadowMap.autoUpdate = false;                 // (reuse this frame's shadows)
  const f = MIRRORS.frame++, [eR, eS] = MIRRORS.every();
  on.forEach((m, i) => {
    const every = m.key === 'rear' ? eR : eS;
    if ((f + i) % every) return;                          // (door mirrors are staggered against each other)
    _mp.copy(m.camPos).applyMatrix4(playerVis.root.matrixWorld);
    _md.copy(m.camDir).transformDirection(playerVis.root.matrixWorld);
    m.cam.position.copy(_mp); m.cam.up.set(0, 1, 0); m.cam.lookAt(_mp.x + _md.x, _mp.y + _md.y, _mp.z + _md.z);
    renderer.setRenderTarget(m.target); renderer.render(scene, m.cam);
  });
  renderer.setRenderTarget(rtWas);
  renderer.shadowMap.autoUpdate = was;
}
MIRRORS.setQuality(Settings.mirrors); MIRRORS.setSide(Settings.rhd);
const playerHull = playerVis.M.hull.map(([x, f]) => [x, f - CG_F]);
// against traffic the hitbox is a touch smaller (~3 cm narrower each side, ~4 cm shorter each end)
// so paint-scraping near misses don't count as crashes
const trafficHull = playerHull.map(([x, f]) => [x * 0.97, f * 0.983]);
const M4_EXT = { front: playerVis.M.front - CG_F, rear: playerVis.M.rear - CG_F, hw: 0.95 };

// ---------- motorcycle (only for these accounts: same physics as the car, its own model and hitbox) ----------
// (the server checks the same list before showing a bike to other players)
const BIKE_NAMES = ['curryeater', 'polyweave'];   // (owners only: not released yet)
const playerBike = makeBike(playerPaint); playerBike.root.visible = false; playerRoot.add(playerBike.root);
const VEH = {
  car: { hull: playerHull.map(p => p.slice()), ext: Object.assign({}, M4_EXT) },
  bike: { hull: BIKE.hull.map(p => p.slice()), ext: { front: BIKE.front, rear: BIKE.rear, hw: BIKE.W } },
};
let vehicle = 'car';
const canBike = () => !!(Account.user && Account.user.name && BIKE_NAMES.includes(Account.user.name.toLowerCase()));
// the Bang Bus (the event's reward: js/event.js): the owners, and anyone who finished its quests
const canVan = () => canBike() || !!(Account.user && Account.user.name && Account.user.bus);
function setVehicle(v) {
  if (typeof Net !== 'undefined' && Net.room && Net.room.carsOnly) v = 'car';   // (on a cars-only server: your car until you leave)
  const van = v === 'van' && canVan();
  vehicle = v === 'bike' && canBike() ? 'bike' : 'car';
  const V = VEH[vehicle], bike = vehicle === 'bike';
  playerVis.root.visible = !bike; playerBike.root.visible = bike;
  playerHull.length = 0; for (const p of V.hull) playerHull.push(p.slice());
  trafficHull.length = 0; for (const [x, f] of playerHull) trafficHull.push([x * 0.97, f * 0.983]);
  Object.assign(M4_EXT, V.ext);
  Object.assign(proxy, V.ext);
  Net.ext = Object.assign({}, V.ext);
  Net.setVehicle(van && vehicle === 'car' ? 'van' : vehicle);   // (the van drives as a car; others see the van)
  // the motorcycle and the Bang Bus are just for fun: no personal bests, leaderboards, runs or stats (a streak with
  // any of it on them counts for nothing, even after switching back to the car)
  const fun = bike || van || carKey === 's15', was = score.funOnly; score.funOnly = fun;
  if (fun) { if (score.score >= 1) score.fun = true; if (!was && game.mode !== 'menu') hud.message((bike ? 'MOTORCYCLE' : van ? 'BANG BUS' : 'DRIFT CAR') + ' · JUST FOR FUN, NO STATS'); }
  const row = document.getElementById('vehRow'); if (row) row.classList.toggle('hidden', !canBike());
  showVan(van);
  if ((typeof Race !== 'undefined' && Race.active) || (typeof Garage !== 'undefined' && Garage.f1Preview)) showF1(true);   // (racing / the Garage showing the F1: still the F1 car)
}
// ---------- racing: the F1 car (js/f1.js) in your Garage paint, shown instead of the car / bike / van ----------
// Its own Garage setup (Settings.f1): colour 1 + finish, a paint pattern (js/f1.js F1_PATTERNS) in colour 2 (accent)
const F1_DEFAULT = { color: '#f2f2ee', finish: 'gloss', accent: '#d42a2a', pattern: 'plain', helmet: '#ffd84a', rim: '#c4c9cf', rimStyle: 'five', tyre: 'medium', wing: true, fwing: 'std', gear: 'std', bias: 'mid' };   // (tyre / wing / front wing / gearbox / brake bias: Racing Garage > Parts)   // (white with red, like the owner's reference car)
const f1Cfg = () => Object.assign({}, F1_DEFAULT, Settings.f1 || {});
const f1Paint = new THREE.MeshPhysicalMaterial({ color: F1_DEFAULT.color, roughness: 0.24, metalness: 0.55, envMapIntensity: 1.1, clearcoat: 1, clearcoatRoughness: 0.06,
  side: THREE.DoubleSide });   // (the model's faces are drawn from both sides)
f1Pattern(f1Paint);                                     // (its pattern + colour 2: set from the Garage in applyF1Cfg)
const f1Accent = new THREE.MeshStandardMaterial({ color: F1_DEFAULT.accent, roughness: 0.35, flatShading: true });
const f1Helmet = new THREE.MeshStandardMaterial({ color: F1_DEFAULT.helmet, roughness: 0.3, metalness: 0.2, flatShading: true });
const f1Rim = new THREE.MeshStandardMaterial({ color: F1_DEFAULT.rim, roughness: 0.3, metalness: 0.75, flatShading: true, side: THREE.DoubleSide });   // (the F1's rims: Garage colour)
function applyF1Cfg() {
  const c = f1Cfg(), [ro, me] = PAINT_FINISH[c.finish] || PAINT_FINISH.gloss;
  // (a flatter, toy-like paint than the road car's: the colour reads as itself instead of washing out in the light)
  f1Paint.color.set(c.color); f1Paint.roughness = Math.max(ro, 0.4); f1Paint.metalness = me * 0.35; f1Paint.clearcoat = c.finish === 'matte' ? 0 : 0.5;
  f1Paint.envMapIntensity = 0.55;
  f1Accent.color.set(c.accent); f1Helmet.color.set(c.helmet); f1Rim.color.set(c.rim);
  f1SetPattern(f1Paint, c.pattern, c.accent);
  try { f1SetRim(playerF1, c.rimStyle); f1SetParts(playerF1, c.tyre, c.wing, c.fwing); } catch (e) { /* (first call: the car isn't built yet - it's built with the style) */ }
}
const f1Livery = () => { const c = f1Cfg(); return f1LiveryKey(c.pattern, c.accent, c.rimStyle, c.rim, c.tyre, c.wing, c.fwing); };   // (racing: other drivers draw your pattern, rims and parts from this)
function setF1Cfg(patch) {
  Settings.f1 = Object.assign({}, Settings.f1, patch); applyF1Cfg(); saveSettings();
  if (typeof Race !== 'undefined' && Race.active) Net.setModel(f1Livery());   // (changed it in a race lobby: others see it)
}
const playerF1 = makeF1(f1Paint, { rimStyle: f1Cfg().rimStyle, tyre: f1Cfg().tyre, wing: f1Cfg().wing, fwing: f1Cfg().fwing }, { rimMat: f1Rim }); playerF1.root.visible = false; playerRoot.add(playerF1.root);
const f1Color = () => f1Cfg().color;                    // (racing: other drivers see your car in this colour)
function showF1(on) {
  playerF1.root.visible = on;
  if (on) { playerVis.root.visible = false; playerBike.root.visible = false; }
  else setVehicle(Settings.vehicle);                   // (back to whatever you drive normally)
}
// racing: lane assist is off and can't be turned on (Settings sliders locked while you race)
function lockLaneAssist(on) {
  for (const id of ['laKb', 'la', 'sens', 'kbSens']) { const e = document.getElementById(id); if (e) e.disabled = on; }
  const n = document.getElementById('laNote'); if (n) n.classList.toggle('hidden', !on);
}

// ---------- the owners' van (same accounts as the motorcycle): a ready-made textured model (assets/owner_van.glb)
// shown exactly as it is (its own colours and textures) in the car's place, with the car's physics and hitbox. The file (7.5 MB) is only loaded when the
// van is picked. While driving it, the chase camera sits higher and looks down more (see VAN_CAM), so you can see
// over it ----------
const VAN = { file: 'assets/owner_van.glb', length: 4.79, yaw: -Math.PI / 2 };  // (the model's length is along its x)
let ownerVan = null, vanOn = false, vanLoading = false, vanAsset = null;
// the van's geometry + material, loaded once and shared (your van and other players' vans in multiplayer)
function getVanAsset() { return vanAsset || (vanAsset = readVanFile()); }
// a minimal reader for this kind of file: one mesh (positions, normals, uv, indices), colour / metal-rough / normal maps
async function readVanFile() {
  const buf = await (await fetch(VAN.file + '?v=' + Date.now())).arrayBuffer(), dv = new DataView(buf);
  const jl = dv.getUint32(12, true), J = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl))), bin = 20 + jl + 8;
  const bytes = i => { const bv = J.bufferViews[i]; return buf.slice(bin + (bv.byteOffset || 0), bin + (bv.byteOffset || 0) + bv.byteLength); };
  const acc = i => { const a = J.accessors[i], T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type], all = bytes(a.bufferView); return new T(all, a.byteOffset || 0, a.count * n); };
  // two parts sharing the same points: the body (primitive 0) and the window glass (primitive 1, see-through)
  const pr = J.meshes[0].primitives[0], g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(acc(pr.attributes.POSITION), 3));
  if (pr.attributes.NORMAL !== undefined) g.setAttribute('normal', new THREE.BufferAttribute(acc(pr.attributes.NORMAL), 3));
  if (pr.attributes.TEXCOORD_0 !== undefined) g.setAttribute('uv', new THREE.BufferAttribute(acc(pr.attributes.TEXCOORD_0), 2));
  if (pr.indices !== undefined) g.setIndex(new THREE.BufferAttribute(acc(pr.indices), 1));
  // (2 and 3: the headlight and tail-light lenses - the body's own triangles, drawn again as glow when they're lit)
  const part = n => { const p = J.meshes[0].primitives[n]; if (!p) return null; const pg = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'uv']) if (g.attributes[k]) pg.setAttribute(k, g.attributes[k]); pg.setIndex(new THREE.BufferAttribute(acc(p.indices), 1)); return pg; };
  const gg = part(1), headG = part(2), tailG = part(3);
  // turn it to face forward, scale to the car's length, stand it on the ground, centred
  g.rotateY(VAN.yaw); g.computeBoundingBox();
  let bb = g.boundingBox; g.scale(...Array(3).fill(VAN.length / (bb.max.z - bb.min.z))); g.computeBoundingBox(); bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); g.computeBoundingSphere();
  if (!g.attributes.normal) g.computeVertexNormals();
  for (const pg of [gg, headG, tailG]) if (pg) pg.computeBoundingSphere();   // (same points, already moved with the body)
  const tex = async (ti, srgb) => {
    if (ti === undefined) return null;
    const im = J.images[J.textures[ti].source], url = URL.createObjectURL(new Blob([bytes(im.bufferView)], { type: im.mimeType }));
    const t = await new THREE.TextureLoader().loadAsync(url); URL.revokeObjectURL(url);
    t.flipY = false; if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
  };
  // the model's own materials, as they come: colour, metal / roughness and normal maps
  const m = J.materials[pr.material] || {}, pb = m.pbrMetallicRoughness || {};
  const map = await tex(pb.baseColorTexture && pb.baseColorTexture.index, true), mr = await tex(pb.metallicRoughnessTexture && pb.metallicRoughnessTexture.index, false);
  const nm = await tex(m.normalTexture && m.normalTexture.index, false);
  const mat = new THREE.MeshStandardMaterial({ map, metalnessMap: mr, roughnessMap: mr, normalMap: nm, metalness: pb.metallicFactor ?? 1, roughness: pb.roughnessFactor ?? 1, side: THREE.DoubleSide });
  // the shell seen from inside (through the windows / from the driver's seat): a dark lining, not the outside
  // paint back to front
  mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  if (!gl_FrontFacing) gl_FragColor.rgb = vec3(0.045, 0.047, 0.052);'); };
  return { g, mat, glassG: gg, headG, tailG };
}
// the van as one object: body, window glass and the cab inside (yours and other players' in multiplayer)
// glass: tinted from outside, nearly clear from the driver's seat (set each frame, like the car's)
const vanGlass = new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.62, envMapIntensity: 1.5, side: THREE.DoubleSide, depthWrite: false });
const vanGlassOthers = vanGlass.clone();                // (other players' vans: always the outside tint)
function makeVanModel(a, others) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(a.g, a.mat); body.castShadow = true; root.add(body);
  const cab = makeVanCab(); root.add(cab.root);
  let glass = null;
  if (a.glassG) { glass = new THREE.Mesh(a.glassG, others ? vanGlassOthers : vanGlass); glass.renderOrder = 2; root.add(glass); }
  // lamps: a glow laid over the lenses (headlights on at night; tail lights dim at night, bright when braking)
  const glow = (geo, color) => { if (!geo) return null; const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false })); m.renderOrder = 3; m.visible = false; root.add(m); return m; };
  const tail = glow(a.tailG, 0xff1a1a), head = makeVanHeadlamps(a, root);
  const setLamps = (lightsOn, braking) => {
    if (head) head.set(lightsOn);
    if (tail) { const o = braking ? 0.95 : lightsOn ? 0.4 : 0; tail.visible = o > 0; tail.material.opacity = o; }
  };
  return Object.assign(cab, { root, body, glass, setLamps });
}
// ---------- the van's headlamps: a clean lamp laid over each scanned one ----------
// The scanned lamp's triangles (van file part 2) give its shape: seen face-on, a smooth outline is fitted round them
// (convex, pulled in a touch), filled with a fine mesh pressed onto the lamp's surface, and drawn with a picture:
// an LED strip round the edge (on in daytime too, dimmer) and, at night, the lens lit with two projectors and a soft
// glow halo in front. Shapes are worked out once per file and shared by every van.
function makeVanHeadlamps(a, root) {
  if (!a.headG) return null;
  if (!a.lampParts) {
    const pos = a.headG.attributes.position, idx = a.headG.index.array, probe = new THREE.Mesh(a.headG, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const rc = new THREE.Raycaster(), parts = [];
    for (const side of [-1, 1]) {
      // this side's lamp: its points and average facing
      const P = [], n = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let t = 0; t < idx.length; t += 3) {
        A.fromBufferAttribute(pos, idx[t]); B.fromBufferAttribute(pos, idx[t + 1]); C.fromBufferAttribute(pos, idx[t + 2]);
        if ((A.x + B.x + C.x) * side < 0) continue;
        P.push(A.clone(), B.clone(), C.clone());
        n.add(new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A)));
      }
      if (P.length < 9) continue;
      n.normalize(); if (n.z > 0) n.negate();                          // (facing forward, out of the van)
      const c = P.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(P.length);
      const e1 = new THREE.Vector3(0, 1, 0).cross(n).normalize(), e2 = new THREE.Vector3().crossVectors(n, e1);
      const flat = P.map(p => { const d = p.clone().sub(c); return [d.dot(e1), d.dot(e2)]; });
      // convex outline (monotone chain), pulled 6% toward the middle
      const pts = flat.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]), cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
      const lo = [], hi = []; for (const p of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (const p of pts.slice().reverse()) { while (hi.length > 1 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
      const hull = lo.slice(0, -1).concat(hi.slice(0, -1)), m = hull.reduce((s, p) => [s[0] + p[0] / hull.length, s[1] + p[1] / hull.length], [0, 0]);
      const ring = hull.map(p => [m[0] + (p[0] - m[0]) * 0.94, m[1] + (p[1] - m[1]) * 0.94]);
      const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      // a fan of triangles from the middle, each split into 64, every point pressed onto the lamp (6 mm proud of it)
      const onLamp = (u, v) => { const o = c.clone().addScaledVector(e1, u).addScaledVector(e2, v); rc.set(o.clone().addScaledVector(n, 0.4), n.clone().negate()); const h = rc.intersectObject(probe, false)[0]; return (h ? h.point : o).addScaledVector(n, 0.006); };
      const P3 = [], UV = [];
      const tri = (p, q, r, depth) => {
        if (depth) { const mid = (s, t) => [(s[0] + t[0]) / 2, (s[1] + t[1]) / 2], pq = mid(p, q), qr = mid(q, r), rp = mid(r, p); tri(p, pq, rp, depth - 1); tri(pq, q, qr, depth - 1); tri(rp, qr, r, depth - 1); tri(pq, qr, rp, depth - 1); return; }
        for (const s of [p, q, r]) { P3.push(...onLamp(s[0], s[1]).toArray()); UV.push((s[0] - x0) / (x1 - x0), (s[1] - y0) / (y1 - y0)); }
      };
      for (let i = 0; i < ring.length; i++) tri(m, ring[i], ring[(i + 1) % ring.length], 3);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P3, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      // the pictures: outline in the canvas's coordinates (u right, v up)
      const W = 256, H = Math.max(64, Math.round(256 * (y1 - y0) / (x1 - x0))), path = (x, close = true) => { x.beginPath(); ring.forEach((p, i) => { const X = (p[0] - x0) / (x1 - x0) * W, Y = (1 - (p[1] - y0) / (y1 - y0)) * H; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); if (close) x.closePath(); };
      const pic = full => {
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
        if (full) {
          x.save(); path(x); x.clip();
          const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,248,232,0.55)'); gr.addColorStop(1, 'rgba(255,240,215,0.28)'); x.fillStyle = gr; x.fillRect(0, 0, W, H);
          for (const f of [0.36, 0.64]) {                                  // two projector lenses along the lamp
            const cx = f * W, cy = H * 0.55, r = Math.min(H * 0.32, W * 0.13), rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
            rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.55, 'rgba(255,250,235,0.85)'); rg.addColorStop(1, 'rgba(255,245,225,0)'); x.fillStyle = rg; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
          }
          x.restore();
        }
        x.save(); path(x); x.clip(); path(x); x.lineWidth = 10; x.lineJoin = 'round'; x.strokeStyle = 'rgba(255,255,255,1)'; x.stroke(); x.restore();   // LED strip round the edge
        const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; return t;
      };
      g.computeBoundingBox(); const bb = g.boundingBox;                 // (halo: in front of the lamp's most forward point, so the body never hides it)
      parts.push({ g, drl: pic(false), full: pic(true), at: new THREE.Vector3((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.min.z - 0.08), size: Math.max(x1 - x0, y1 - y0) * 1.5 });   // (just in front of the lamp: glare on it, not a ball floating beside the van)
    }
    if (!VAN_HALO.tex) {                                                // soft round glow for the halo
      const cv = document.createElement('canvas'); cv.width = cv.height = 128; const x = cv.getContext('2d'), rg = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      rg.addColorStop(0, 'rgba(255,246,226,0.85)'); rg.addColorStop(0.25, 'rgba(255,240,215,0.35)'); rg.addColorStop(1, 'rgba(255,235,205,0)'); x.fillStyle = rg; x.fillRect(0, 0, 128, 128);
      VAN_HALO.tex = new THREE.CanvasTexture(cv); VAN_HALO.tex.encoding = THREE.sRGBEncoding;
    }
    a.lampParts = parts;
  }
  const lens = (map, o) => new THREE.MeshBasicMaterial({ map, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const lamps = a.lampParts.map(p => {
    const drl = new THREE.Mesh(p.g, lens(p.drl, 0.6)), full = new THREE.Mesh(p.g, lens(p.full, 1)); drl.renderOrder = full.renderOrder = 3;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: VAN_HALO.tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    halo.position.copy(p.at); halo.scale.setScalar(p.size); halo.renderOrder = 4;
    root.add(drl, full, halo); return { drl, full, halo };
  });
  // lights on (night): the whole lamp lit + halo; off (day): just the LED strip
  return { set(on) { for (const l of lamps) { l.drl.visible = !on; l.full.visible = on; l.halo.visible = on; } } };
}
const VAN_HALO = {};
// ---------- the van's cab: low-poly interior in the game's style (flat-shaded, few sides) ----------
// Sized to the van's shell (glass 1.24-1.9 m up, cab 1.76 m wide, door pillar 0.26 m behind the centre):
// floor, dash with the live speed display in front of the driver, a big van steering wheel (turns with yours),
// driver's seat, a two-seat passenger bench, door panels, sun visors and the wall behind the seats.
// Coordinates: x across, y up, z backward (the van's centre is 0; its nose is at z = -2.4).
const VAN_EYE = { x: 0.45, y: 1.64, f: 0.36 };          // driver's eye: 0.45 m off centre, 1.64 m up, 0.36 m ahead of the van's centre
const VAN_CAB_GEO = {};                                 // (shapes built once, shared by every van)
function makeVanCab() {
  const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  const M = VAN_CAB_GEO.mats || (VAN_CAB_GEO.mats = { dash: std(0x1a1c20, 0.85), dash2: std(0x24272d, 0.8), trim: std(0x3c424b, 0.4, 0.5), seat: std(0x26292f, 0.95),
    seat2: std(0x1b1d22, 0.95), floor: std(0x121316, 0.95), wall: std(0x2b2e34, 0.9), gloss: std(0x0d0e11, 0.35, 0.3) });
  const root = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // floor (the front wheel arches come up under the dash: a raised footwell between them)
  add(box(1.6, 0.04, 0.96), M.floor, 0, 0.58, -0.63);
  add(box(0.84, 0.04, 0.4), M.floor, 0, 0.86, -1.31);
  add(box(1.0, 0.26, 0.04), M.floor, 0, 0.73, -1.11);
  // dash: one faceted piece across the cab (a side profile pushed out sideways), under the windscreen
  if (!VAN_CAB_GEO.dash) {
    const prof = new THREE.Shape([[1.16, 0.88], [1.16, 1.02], [1.22, 1.16], [1.34, 1.245], [1.6, 1.29], [1.72, 1.29], [1.72, 0.88]].map(([a, b]) => new THREE.Vector2(a, b)));
    const g = new THREE.ExtrudeGeometry(prof, { depth: 1.64, bevelEnabled: false });
    VAN_CAB_GEO.dash = g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -0.82, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));   // profile (forward, up) -> van (x, y, z)
    const p = g.attributes.position;                                              // narrower toward the nose (follows the van's front corners)
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (1 - 0.13 * U.clamp((-p.getZ(i) - 1.3) / 0.42, 0, 1)));
    g.computeVertexNormals();
  }
  add(VAN_CAB_GEO.dash, M.dash, 0, 0, 0);
  add(box(1.6, 0.012, 0.012), M.trim, 0, 1.02, -1.165);                                 // trim line along the dash face
  for (const x of [-0.16, 0.16]) add(box(0.14, 0.05, 0.02), M.gloss, x, 0.96, -1.163);   // centre air vents
  add(box(0.24, 0.15, 0.02), M.gloss, 0, 1.13, -1.205, -0.55);                          // centre screen
  // the driver's side (moved across for right-hand drive): gauge pod, steering wheel, seat
  const drv = new THREE.Group(); root.add(drv);
  // (up above the steering wheel's rim, tilted toward the driver, so the speed is always in view)
  const pod = new THREE.Group(); pod.position.set(0, 1.43, -1.25); pod.rotation.x = -0.23; drv.add(pod);
  add(box(0.4, 0.13, 0.15), M.dash2, 0, 0, 0, 0, 0, 0, pod);
  add(box(0.42, 0.018, 0.19), M.dash2, 0, 0.072, 0.02, 0, 0, 0, pod);                   // hood over the display
  add(box(0.362, 0.112, 0.004), M.gloss, 0, -0.004, 0.0755, 0, 0, 0, pod);
  const screen = add(new THREE.PlaneGeometry(0.35, 0.1), new THREE.MeshBasicMaterial({ map: MIRRORS.gaugeTex, toneMapped: false }), 0, -0.004, 0.078, 0, 0, 0, pod);
  // steering wheel: big and flatter than a car's, on a column into the dash
  const col = new THREE.Group(); col.position.set(0, 1.22, -0.9); col.rotation.x = -0.62; drv.add(col);   // (faces up toward the driver, top leaning forward)
  const wheel = new THREE.Group(); col.add(wheel);
  add(new THREE.TorusGeometry(0.2, 0.026, 5, 24), M.gloss, 0, 0, 0, 0, 0, 0, wheel);
  add(new THREE.CylinderGeometry(0.055, 0.06, 0.05, 8), M.dash2, 0, 0, 0.01, Math.PI / 2, 0, 0, wheel);
  for (const [ang, len] of [[0, 0.15], [Math.PI, 0.15], [-Math.PI / 2, 0.15]]) add(box(len, 0.035, 0.022), M.trim, Math.cos(ang) * 0.11, Math.sin(ang) * 0.11, 0, 0, 0, ang, wheel);
  add(new THREE.CylinderGeometry(0.035, 0.045, 0.34, 6), M.dash2, 0, 0, -0.19, Math.PI / 2, 0, 0, col);   // column
  const seat = (parent, w, x) => {
    add(box(w * 0.86, 0.36, 0.42), M.seat2, x, 0.79, -0.46, 0, 0, 0, parent);           // base
    add(box(w, 0.13, 0.52), M.seat, x, 1.03, -0.46, 0, 0, 0, parent);                    // cushion
    add(box(w, 0.66, 0.13), M.seat, x, 1.4, -0.17, -0.12, 0, 0, parent);                 // backrest
    for (const s of [-1, 1]) add(box(0.06, 0.56, 0.16), M.seat, x + s * (w / 2 - 0.03), 1.38, -0.15, -0.12, 0, 0, parent);   // bolsters
  };
  seat(drv, 0.5, 0);
  add(box(0.28, 0.18, 0.11), M.seat, 0, 1.83, -0.1, -0.12, 0, 0, drv);                  // headrest
  const pas = new THREE.Group(); root.add(pas);
  seat(pas, 0.74, 0);
  for (const x of [-0.18, 0.18]) add(box(0.25, 0.17, 0.11), M.seat, x, 1.82, -0.1, -0.12, 0, 0, pas);
  // doors: panel below the glass (stopping short of the wheel arch), armrest, trim along the window line
  for (const s of [-1, 1]) {
    add(box(0.04, 0.6, 0.84), M.dash, s * 0.86, 0.92, -0.68);
    add(box(0.08, 0.05, 0.42), M.trim, s * 0.83, 1.08, -0.7);
    add(box(0.06, 0.04, 0.84), M.dash2, s * 0.85, 1.22, -0.68);
    add(box(0.42, 0.012, 0.18), M.dash2, s * 0.44, 1.89, -0.7, 0.25);                   // sun visor
  }
  // trim over the edges of the glass (the scanned shell's window edges are ragged): a curved strip along the top
  // of the windscreen, the front pillars (from the windscreen's edge back to the door glass), and strips along the
  // top and back of the door windows. (Measured from the van file: windscreen plane z = -1.31 + 1.44 (y - 1.6).)
  if (!VAN_CAB_GEO.trim) {
    const wsZ = y => -1.31 + 1.4386 * (y - 1.6), inY = -0.0205, inZ = 0.014;     // (on the windscreen, nudged 2.5 cm into the cab)
    const top = [[0, 1.902], [0.2, 1.897], [0.4, 1.89], [0.6, 1.845], [0.8, 1.769], [0.88, 1.72]];
    const ytop = ax => { for (let i = 1; i < top.length; i++) if (ax <= top[i][0]) { const [x0, y0] = top[i - 1], [x1, y1] = top[i]; return y0 + (y1 - y0) * (ax - x0) / (x1 - x0); } return top[top.length - 1][1]; };
    const pos = [], push = (...v) => pos.push(...v);
    for (let x = -0.68; x < 0.679; x += 0.08) {                                     // header strip: 3.5 cm over the glass, 6 cm above it
      const x2 = x + 0.08, q = [[x, ytop(Math.abs(x)) - 0.035], [x2, ytop(Math.abs(x2)) - 0.035], [x2, ytop(Math.abs(x2)) + 0.06], [x, ytop(Math.abs(x)) + 0.06]].map(([a, y]) => [a, y + inY, wsZ(y) + inZ]);
      push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
    }
    for (const s of [-1, 1]) {                                                    // front pillars (a four-sided panel each side)
      // (the windscreen curves back at its edges: the pillar's windscreen side sits 5 cm in from the flat plane)
      const q = [[0.82, 1.32 - 0.041, wsZ(1.32) + 0.029], [0.55, 1.87 - 0.066, wsZ(1.87) + 0.046], [0.72, 1.88, -0.69], [0.83, 1.25, -1.19]].map(([x, y, z]) => [s * (x - 0.03), y, z]);
      if (s < 0) push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]); else push(...q[0], ...q[2], ...q[1], ...q[0], ...q[3], ...q[2]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    VAN_CAB_GEO.trim = g;
    VAN_CAB_GEO.trimMat = Object.assign(M.dash.clone(), { side: THREE.DoubleSide });
  }
  const edge = new THREE.Group(); root.add(edge);                                 // (only seen from outside, through the glass)
  add(VAN_CAB_GEO.trim, VAN_CAB_GEO.trimMat, 0, 0, 0, 0, 0, 0, edge);
  for (const s of [-1, 1]) {
    add(box(0.02, 0.08, 0.48), M.dash, s * 0.64, 1.84, -0.54, 0, 0, 0, edge);        // along the top of the door glass
    add(box(0.02, 0.56, 0.1), M.dash, s * 0.69, 1.55, -0.24, 0, 0, 0, edge);         // the pillar behind the door glass
  }
  // the wall behind the seats (the shell is wider low down than at the roof)
  if (!VAN_CAB_GEO.wall) VAN_CAB_GEO.wall = new THREE.ShapeGeometry(new THREE.Shape([[-0.86, 0.58], [0.86, 0.58], [0.84, 1.4], [0.74, 1.8], [0.6, 1.98], [-0.6, 1.98], [-0.74, 1.8], [-0.84, 1.4]].map(([a, b]) => new THREE.Vector2(a, b))));
  const wall = add(VAN_CAB_GEO.wall, M.wall, 0, 0, -0.03); wall.material = M.wall.clone(); wall.material.side = THREE.DoubleSide;
  // which side you drive from
  const setSide = rhd => { const s = rhd ? 1 : -1; drv.position.x = s * VAN_EYE.x; pas.position.x = -s * 0.4; };
  setSide(Settings.rhd);
  return { root, wheel, setSide, screen, edge };
}
// ---------- the van seen from the driver's seat: its own clean cab shell (like the car's cockpit) ----------
// The scanned body's window edges are too ragged to look out through, so in first person it's hidden and this
// stands in for it: slim front pillars, header and roof lining, door tops and rear pillars, the window line, the
// blue bonnet with its wipers, and the door mirrors with live glass (same as the car's). Same measurements as
// the van file (windscreen 1.34 - 1.90 m up, mirrors at x 1.0 - 1.16, 1.28 - 1.50 m up).
function makeVanCockpit() {
  const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  const M = { pillar: std(0x2a2d33, 0.85), liner: std(0x4b5058, 0.95), trim: std(0x1d1f24, 0.8), paint: std(0x3cc4e6, 0.45, 0.1), black: std(0x15171a, 0.6), panel: std(0x1a1c20, 0.85) };
  M.blackDS = Object.assign(M.black.clone(), { side: THREE.DoubleSide });
  const root = new THREE.Group(), heads = [];
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // a straight six-sided bar from a to b (pillars, rails)
  const beam = (a, b, r, mat, parent = root) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), mat);
    m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); parent.add(m); return m;
  };
  add(box(1.66, 0.03, 0.92), M.liner, 0, 1.975, -0.4);                                   // roof lining
  beam([-0.8, 1.93, -0.86], [0.8, 1.93, -0.86], 0.05, M.pillar);                          // header over the windscreen
  for (const s of [-1, 1]) {
    beam([s * 0.9, 1.3, -1.72], [s * 0.79, 1.93, -0.86], 0.05, M.pillar);                 // front pillar
    beam([s * 0.8, 1.93, -0.86], [s * 0.8, 1.93, -0.18], 0.04, M.pillar);                 // top of the door window
    add(box(0.07, 0.76, 0.14), M.pillar, s * 0.8, 1.58, -0.18);                           // rear pillar
    add(box(0.08, 0.05, 1.54), M.trim, s * 0.86, 1.27, -0.94);                            // window line
    add(box(0.04, 0.64, 0.64), M.panel, s * 0.86, 0.95, -1.4);                            // front of the door
    add(box(0.14, 0.42, 0.58), M.panel, s * 0.79, 1.08, -1.45);                           // dash end
    // door mirror, outside the door: a black corner panel at the front of the door window (its mount), two arms
    // out to a rounded housing, and the live glass on its back, turned toward the driver (see setSide)
    {
      const tri = [[0.9, 1.29, -1.71], [0.885, 1.29, -1.2], [0.848, 1.6, -1.3]].map(([x, y, z]) => [s * x, y, z]);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tri.flat(), 3)); g.computeVertexNormals();
      add(g, M.blackDS, 0, 0, 0);
    }
    beam([s * 0.89, 1.31, -1.32], [s * 1.0, 1.32, -1.2], 0.016, M.black);
    beam([s * 0.87, 1.45, -1.3], [s * 1.0, 1.49, -1.19], 0.014, M.black);
    const head = new THREE.Group(); head.position.set(s * 1.08, 1.41, -1.16); root.add(head);
    add(VAN_MIRROR_GEO(), M.black, 0, 0, 0, 0, 0, 0, head);
    const gl = new THREE.Group(); gl.position.set(0, 0, 0.002); head.add(gl);
    MIRRORS.addMirror(s < 0 ? 'vanLeft' : 'vanRight', 0.15, 0.24, 0.03, gl, new THREE.Vector3(s * 1.09, 1.41, -1.12), new THREE.Vector3(s * 0.16, -0.03, 1), 24);
    heads.push(head);
  }
  // bonnet: from under the windscreen down to the nose, in the van's blue, with the wipers resting on it
  {
    const p = [[-0.88, 1.31, -1.73], [0.88, 1.31, -1.73], [0.8, 1.05, -2.32], [-0.8, 1.05, -2.32]];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...p[0], ...p[2], ...p[1], ...p[0], ...p[3], ...p[2]], 3)); g.computeVertexNormals();
    add(g, M.paint, 0, 0, 0);
    for (const x of [-0.42, 0.18]) add(box(0.6, 0.015, 0.02), M.black, x, 1.325, -1.76, 0, 0, 0.06);
  }
  // the mirrors turn most of the way toward wherever the driver sits (left- / right-hand drive)
  const setSide = rhd => { const ex = (rhd ? 1 : -1) * VAN_EYE.x, ez = -VAN_EYE.f; for (const h of heads) h.rotation.y = Math.atan2(ex - h.position.x, ez - h.position.z) * 0.75; };
  setSide(Settings.rhd);
  return { root, setSide };
}
// the van's mirror housing: a rounded-off block (cut corners, bevelled edges), its back face (the glass side) at z = 0
let _vanMirrorGeo = null;
function VAN_MIRROR_GEO() {
  if (_vanMirrorGeo) return _vanMirrorGeo;
  const w = 0.17, h = 0.27, c = 0.04, s = new THREE.Shape(), x = w / 2, y = h / 2;
  s.moveTo(-x + c, -y); s.lineTo(x - c, -y); s.lineTo(x, -y + c); s.lineTo(x, y - c); s.lineTo(x - c, y); s.lineTo(-x + c, y); s.lineTo(-x, y - c); s.lineTo(-x, -y + c); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.012, bevelSegments: 1 });
  g.translate(0, 0, -0.06 - 0.018 - 0.001);                    // (back face just behind the glass)
  return (_vanMirrorGeo = g);
}
async function loadVan() {
  const a = await getVanAsset();
  ownerVan = makeVanModel(a); ownerVan.root.visible = false;
  const vc = makeVanCockpit(); ownerVan.cockpit = vc.root; ownerVan.cockpitSide = vc.setSide;
  ownerVan.cockpit.visible = false; ownerVan.root.add(ownerVan.cockpit);
  playerVis.root.add(ownerVan.root);
}
function showVan(on) {
  vanOn = on;
  if (on && !ownerVan) {          // (first time: load the model, then show it; the car stays until it's here)
    if (!vanLoading) { vanLoading = true; loadVan().then(() => { vanLoading = false; showVan(vanOn); }, e => { vanLoading = false; vanAsset = null; console.warn('van model', e); }); }
    return;
  }
  if (ownerVan) ownerVan.root.visible = on;
  playerVis.body.visible = !on;
  for (const w of playerVis.wheels) w.pivot.visible = !on;
  if (on) playerVis.indL.visible = playerVis.indR.visible = playerVis.brake.visible = false;
}
// the van's chase camera: just above its roof (~2.1 m) and looking far down the road, nearly level, so the middle of the
// view passes just over the roof - you see the road ahead over the bus without looking down on it
const VAN_CAM = { dist: 6.4, hgt: 2.55, look: 12, lookY: 1.6 };
// the F1 car's chase camera: lower and a little closer (it's a long, low car)
const F1_CAM = { dist: 5.8, hgt: 1.8, look: 4.0, lookY: 0.8 };
function setPaint(hex) { Settings.color = hex; playerPaint.color.set(hex); playerPaintDS.color.set(hex); saveSettings(); }

// ---------- the car you drive (Garage: M4 / 911 GT3 / R8, paint + finish, wheels, calipers, window tint) ----------
// Each car is built the first time it's picked; switching moves its parts into the same player object, so
// everything that animates the car (wheels, lights, body lean, cockpit, recorder) keeps working. All three
// drive the same and keep the M4's hitbox (playerHull above): the car is looks only.
const CAR_PARTS = { m4: { body: playerVis.body, wheels: playerVis.wheels, brake: playerVis.brake, indL: playerVis.indL, indR: playerVis.indR, M: playerVis.M } };
let carKey = 'm4', glassOut = 0.78;
const PAINT_FINISH = { gloss: [0.24, 0.55], metallic: [0.3, 0.88], matte: [0.74, 0.06] };   // roughness, metalness
const WINDOW_TINT = { light: [0x2a3946, 0.55], medium: [0x1a2530, 0.78], dark: [0x10161c, 0.9], limo: [0x06080b, 0.97] };
function carParts(key) {
  if (CAR_PARTS[key]) return CAR_PARTS[key];
  const v = makeVehicle(key, playerPaint, PLAYER_OVR);
  v.body.material = doubleSided(v.body.material);
  v.root.remove(v.body, v.brake, v.indL, v.indR, ...v.wheels.map(w => w.pivot));
  return (CAR_PARTS[key] = { body: v.body, wheels: v.wheels, brake: v.brake, indL: v.indL, indR: v.indR, M: v.M });
}
// this car's Garage choices (Settings.cars[key]), filled in with what the car comes with
function carCfg(key = carKey) {
  const C = PLAYER_CARS[key] || PLAYER_CARS.m4, s = (Settings.cars && Settings.cars[key]) || {};
  return { color: s.color || C.color, finish: PAINT_FINISH[s.finish] ? s.finish : 'gloss', rim: s.rim || C.rim, rimColor: s.rimColor || C.rimColor,
    caliper: s.caliper || C.caliper, tint: WINDOW_TINT[s.tint] ? s.tint : 'medium' };
}
function setCarCfg(patch) {
  Settings.cars = Settings.cars || {};
  Settings.cars[carKey] = Object.assign({}, Settings.cars[carKey], patch);
  applyCarCfg(); saveSettings();
}
const _rimGeo = {};
function applyCarCfg() {
  const c = carCfg(), [ro, me] = PAINT_FINISH[c.finish], [tc, to] = WINDOW_TINT[c.tint];
  setPaint(c.color);
  for (const m of [playerPaint, playerPaintDS]) { m.roughness = ro; m.metalness = me; m.clearcoat = c.finish === 'matte' ? 0 : 1; }
  playerRim.color.set(c.rimColor); playerCaliper.color.set(c.caliper);
  playerGlass.color.set(tc); glassOut = to;
  const M = playerVis.M;
  if (M.wheelGeoms && c.rim === 'stock') {          // (a car from a real model: its own wheels)
    playerVis.wheels.forEach((w, i) => { w.mesh.geometry = M.wheelGeoms[i]; w.base = 0; w.spinSign = 1; w.pivot.rotation.y = 0; });
  } else {
    const style = c.rim === 'stock' ? (PLAYER_CARS[carKey].rim === 'stock' ? 'gt3' : PLAYER_CARS[carKey].rim) : c.rim, g = _rimGeo[carKey + ':' + style] || (_rimGeo[carKey + ':' + style] = wheelGeometry(M.r, M.tw || 0.275, style));
    // (the game's wheels are built for the right side: turned round on the left)
    for (const w of playerVis.wheels) { w.mesh.geometry = g; if (M.wheelGeoms) { w.base = w.side < 0 ? Math.PI : 0; w.spinSign = w.side; w.pivot.rotation.y = w.base; } }
  }
}
function installCar(key) {
  if (!PLAYER_CARS[key]) key = 'm4';
  const asked = key;
  if (PLAYER_CARS[key].owners && !canBike()) key = 'm4';   // (the owners' drift car: only on their accounts - it comes back when they sign in)
  const old = CAR_PARTS[carKey], P = carParts(key), C = PLAYER_CARS[key];
  if (old !== P) {
    playerVis.root.remove(old.body, old.brake, old.indL, old.indR, ...old.wheels.map(w => w.pivot));
    playerVis.root.add(P.body, P.brake, P.indL, P.indR, ...P.wheels.map(w => w.pivot));
    Object.assign(playerVis, { body: P.body, wheels: P.wheels, brake: P.brake, indL: P.indL, indR: P.indR, M: P.M });
  }
  carKey = key; Settings.car = asked;
  // where the driver sits: cabin seen through the glass, steering column, first-person cockpit, door mirrors
  interior.geometry = P.M.interior; swMesh.geometry = P.M.wheelSW;
  if (!P.M.swCenter) { swTilt.position.y = C.sw.y; swTilt.position.z = -C.sw.f; swTilt.rotation.x = C.sw.rx; }
  const off = { x: 0, y: C.cockpit.dy, z: -C.cockpit.df }, sx = C.cockpit.sx || 1;
  cockpit.position.set(off.x, off.y, off.z); cockpit.scale.x = sx;   // (a narrower car: the cockpit is narrower too)
  { const rim = cockpitWheel.children[0] && cockpitWheel.children[0].material;   // (the M stripe on the wheel is the BMW's only)
    if (rim) { rim.vertexColors = key === 'm4'; rim.color.set(key === 'm4' ? 0xffffff : 0x16181c); rim.needsUpdate = true; } }
  MIRRORS.setMount(sx !== 1 ? Object.assign({}, C.mirror, { x: C.mirror.x / sx }) : C.mirror, off); MIRRORS.setSide(Settings.rhd);
  applyCarCfg(); saveSettings();
  if (typeof Net !== 'undefined' && Net.setModel) Net.setModel(key);
  // the drift car is just for fun, like the motorcycle and the Bang Bus: no leaderboards, runs or stats
  const fun = vehicle === 'bike' || vanOn || carKey === 's15';
  if (score.funOnly !== fun) { score.funOnly = fun; if (fun && score.score >= 1) score.fun = true; }
}
// (older saves: the paint picked in Settings becomes the M4's paint)
if (!Settings.cars) Settings.cars = { m4: { color: Settings.color } };
installCar(Settings.car || 'm4');
applyF1Cfg();                                           // (the F1 car's own Garage colours)

// ---------- state ----------
let camMode = 0, menuOpen = true, started = false, time = 0, lastCrash = -9, last = performance.now();
let lastShoulder = -9, shoulderLost = 0, shoulderT = 0;
const camS = { off: new THREE.Vector3(0, 1.8, 6), yaw: 0, fov: 62, look: new THREE.Vector3(), orbit: 0 };
const proxy = { s: 0, d: 0, v: 0, front: M4_EXT.front, rear: M4_EXT.rear, hw: M4_EXT.hw, isPlayer: true, crashed: false };
const _hp = [];
// what's being played: 'menu' (title screen), 'sp' (singleplayer) or 'mp' (on a server); scored = counts for the leaderboard
const game = { mode: 'menu', scored: false, density: SCORED_DENSITY };

function startPosition() {
  car.place(40, ROAD.lane(2), 100 / 3.6);
  car.tc = Settings.tc; car.manual = Settings.manual; car.hitT = 0;
  camS.yaw = car.yaw; camS.shift = 0;
  steerCtl.key = 0; steerCtl.k1 = 0; steerCtl.wheelF = 0; steerCtl.kAl = 0; steerCtl.k1v = 0; steerCtl.kAlv = 0;
  traffic.clear();
  const p = ROAD.project(car.x, car.z); car.s = p.s; car.d = p.d; ROAD.hintS = car.s;
  Object.assign(proxy, { s: car.s, d: car.d, v: car.u });
  world.fillAll(car.s);
  traffic.maintain(proxy, game.density);
  warmUp();
}
// get every shader / mesh ready for the GPU now, instead of stuttering the first time each one is drawn
function warmUp() { try { renderer.compile(scene, camera); } catch (e) { /* (older browsers) */ } }
startPosition();

// Full reset: fresh traffic, fresh run score, car back in lane at a rolling start
function resetCar() {
  const p = ROAD.project(car.x, car.z);
  car.place(p.s, ROAD.lane(2), 100 / 3.6);
  car.tc = Settings.tc; car.manual = Settings.manual; car.hitT = 0;
  car.s = p.s; car.d = ROAD.lane(2); ROAD.hintS = car.s;
  steerCtl.key = 0; steerCtl.k1 = 0; steerCtl.wheelF = 0; steerCtl.kAl = 0; steerCtl.k1v = 0; steerCtl.kAlv = 0;
  camS.yaw = car.yaw; camS.shift = 0;
  Object.assign(proxy, { s: car.s, d: car.d, v: car.u });
  if (!traffic.remote) { traffic.clear(); traffic.maintain(proxy, game.density); }   // (online the traffic is shared)
  score.reset();
  lastCrash = -9;
}

let zoneHit = false, railHit = false, lastGoodS = 40;
let ffbHit = 0, ffbRough = 0;   // (this frame's knock and rough ground, for force feedback - js/ffb.js)
// guard-rail contact for the player (rigid wall, per physics substep)
// Walls the car can hit at road position s: the two guard rails, plus the barrier line of any
// construction zone (only while the car is on the open side of it). On the loop circuit the right
// rail opens where the on-ramp joins, and the lot / ramp has its own fence (the rail beside the lot
// is solid from both sides).
function wallsAt(s, carD) {
  // race tracks: the walls sit behind the run-off / gravel, at their own distance all round the lap
  if (ROAD.loop && ROAD.loop.race) return [{ sg: -1, d: -Tracks.wallAt(ROAD.loop, s, -1) }, { sg: 1, d: Tracks.wallAt(ROAD.loop, s, 1) }];
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
  const race = ROAD.loop && ROAD.loop.race;
  const wL = race ? -Tracks.wallAt(ROAD.loop, pre.s, -1) : ROAD.edgeL - 0.35, wR = race ? Tracks.wallAt(ROAD.loop, pre.s, 1) : ROAD.edgeR + 0.35;
  if (!zonesHere && pre.d > wL + 3.35 && pre.d < wR - 3.35) return 0;
  // Anti-stuck: when the car is close to a wall and pointing INTO it, swing it back parallel
  // to the road (works even when stopped, where steering can't turn the car). It never
  // acts when you're pointing away from the wall, so it doesn't fight you driving off.
  // (Only when nearly stopped: at speed it steered you along the rail, so you could glide on it.)
  const lotArea = nearLot(pre.s, pre.d);
  for (const wl of lotArea || Math.abs(car.u) > 5 ? [] : wallsAt(pre.s, pre.d)) {   // (not in the parking lot: you park / turn around there)
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
  if ((pre.d > wR - lim && !lotArea) || pre.d < wL + lim) {
    const dd = U.clamp(pre.d, wL + lim, wR - lim);
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
  // any touch of a guard rail while driving is a crash (the lot / ramp fences don't count: you park there)
  if (!worst.zone && Math.abs(car.u) > 2 && !lotArea && !inStartArea(pre.s, pre.d)) railHit = true;
  return vn;
}

// ---------- servers: the loop circuit with a parking lot to start from ----------
// Park in space `slot` of the lot, nose toward the exit (everyone in a room gets their own space).
function spawnInLot(slot) {
  const sp = ROAD.lotSpace(slot);
  car.place(sp.s, sp.d, 0);
  car.tc = Settings.tc; car.manual = Settings.manual; car.hitT = 0;
  car.s = sp.s; car.d = sp.d; ROAD.hintS = sp.s; lastGoodS = sp.s;
  steerCtl.key = 0; steerCtl.k1 = 0; steerCtl.wheelF = 0; steerCtl.kAl = 0; steerCtl.k1v = 0; steerCtl.kAlv = 0;
  camS.yaw = car.yaw; camS.shift = 0;
  world.fillAll(car.s);
  Object.assign(proxy, { s: car.s, d: car.d, v: 0 });
  score.reset();
  lastCrash = -9;
  warmUp();
}
// joined a server: switch to the loop circuit + shared traffic, start in the lot
// Personal best shown in the HUD: the higher of what this device has saved and your entry on that mode's
// leaderboard (signed in), so it's right on a new device or straight after an update.
async function syncBest(mode) {
  if (typeof Account === 'undefined' || !Account.signedIn) return;
  try {
    const base = await Net.findBase(); if (!base) return;
    const j = await (await fetch(base + '/api/leaderboard?mode=' + mode, { cache: 'no-store' })).json();
    const me = (j.list || []).find(e => e.name === Account.user.name);
    if (me && score.bestKey === (mode === 'mp' ? 'tw_best_mp' : 'tw_best') && me.score > score.best) {
      score.best = me.score; try { localStorage.setItem(score.bestKey, me.score); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* offline: keep the saved one */ }
}
function enterServer(slot, room) {
  DriftTrack.exit();
  score.useBest('mp'); syncBest('mp');                 // (multiplayer has its own personal best)
  ROAD.setLoop(true); ZONES.setLoop(ROAD.loop.L);
  setWorld(room && room.theme, room && room.tod);     // the server's world type and time of day
  world.reset(); zoneProps.reset();
  traffic.clear(); traffic.remote = true;
  spawnInLot(slot);
}
// left / lost the server: back to the endless single-player highway
function exitServer() {
  score.useBest('sp'); syncBest('sp');                 // (back to the singleplayer personal best)
  ROAD.setLoop(false); ZONES.setLoop(0);
  setWorld(Settings.world, Settings.tod);             // back to your own world
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

// Too long on the shoulder: streak lost, car put back into the nearest lane on that side that has room
// (same spot along the road, same speed, pointing straight down the road)
function backOnRoad() {
  const order = car.d > 0 ? [3, 2, 1, 0] : [0, 1, 2, 3];
  const others = traffic.cars.concat(Net.agents(M4_EXT));
  const free = l => !others.some(c => !c.crashed && Math.abs(ROAD.lane(l) - c.d) < 2.4 && Math.abs(c.s - car.s) < 18);
  const lane = order.find(free) ?? order[0];
  const u = Math.max(0, car.u);
  car.place(car.s, ROAD.lane(lane), u); car.hitT = 0;
  car.d = ROAD.lane(lane);
  steerCtl.key = 0; steerCtl.k1 = 0; steerCtl.wheelF = 0; steerCtl.kAl = 0; steerCtl.k1v = 0; steerCtl.kAlv = 0;
  camS.yaw = car.yaw; camS.shift = 0;
  Object.assign(proxy, { s: car.s, d: car.d, v: u, ry: 0 });
  score.lose('SHOULDER, STREAK LOST');
  lastCrash = time;
}

function crashEvent(strength) {
  sound.thump(0.3 + strength / 12);
  if (Race.active) return;                             // (racing: a knock costs time, nothing else)
  if (time - lastCrash > 1.2) score.crash();
  lastCrash = time;
}

// ---------- camera ----------
function updateCamera(dt) {
  const spd = car.speed, sy = Math.sin(car.visYaw), cy = Math.cos(car.visYaw); // cockpit sits in the drawn body
  if (menuOpen && screen === 'scrGarage' && typeof Garage !== 'undefined') { Garage.camera(dt); return; }   // (js/garage.js)
  if (!menuOpen && Race.finCam(camera)) return;       // (racing finish: the slow-motion fly-by shots)
  if (menuOpen) { // slow orbit around the car in the menu
    camS.orbit += dt * 0.25;
    const a = car.yaw + camS.orbit + 2.4, r = 6.8;
    camera.position.set(car.x + Math.sin(a) * r, 1.9, car.z - Math.cos(a) * r);
    camera.lookAt(car.x, 0.7, car.z);
    camera.fov = 50; camera.near = 0.25; camera.updateProjectionMatrix();
    return;
  }
  if (camMode !== 1) {
    // chase camera: follows the direction of travel smoothly (like "Low Poly Traffic Racer"),
    // so you see the car rotate into the turn instead of the whole world swinging
    const travel = car.u > 4 ? car.yaw + Math.atan2(car.v, Math.max(car.u, 0.1)) : car.yaw;
    camS.yaw = U.dampAngle(camS.yaw, travel, 5, dt);
    // ...and slides slightly sideways toward the turn instead of orbiting
    const shiftT = U.clamp(car.r * 1.5, -0.3, 0.3);
    camS.shift = U.damp(camS.shift || 0, shiftT, 4, dt);
    const sp = U.clamp(spd / 80, 0, 1);
    // camera has inertia: it lags back when accelerating and surges toward the car under braking
    const brk = U.clamp(-car.ax / 13, 0, 1);
    const vc = playerF1.root.visible ? F1_CAM : vanOn ? VAN_CAM : null;
    const dist = (vc ? vc.dist : 5.7) + sp * 0.9 + U.clamp(car.ax, -15, 9) * 0.05;
    const hgt = (vc ? vc.hgt : 1.72) + sp * 0.12;
    const cyw = Math.cos(camS.yaw), syw = Math.sin(camS.yaw);
    const ox = -syw * dist + cyw * camS.shift, oz = cyw * dist + syw * camS.shift;
    camS.off.x = U.damp(camS.off.x, ox, 14, dt);
    camS.off.z = U.damp(camS.off.z, oz, 14, dt);
    // a friend right on your tail would put the camera inside their car: rise smoothly over their roof
    // instead, so they stay in view behind you
    camS.lift = U.damp(camS.lift || 0, tailgateLift(car.x + camS.off.x, car.z + camS.off.z, camS.off.y), 6, dt);
    camS.off.y = U.damp(camS.off.y, hgt, 5, dt);
    let shx = 0, shy = 0;
    if (spd > 45) { const k = (spd - 45) * 0.00035; shx = Math.sin(time * 37) * k; shy = Math.sin(time * 53 + 1) * k; }
    if (brk > 0.3 && spd > 6) { // ABS judder under hard braking
      const k = (brk - 0.3) * Math.min(spd / 40, 1) * 0.03;
      shx += Math.sin(time * 61) * k; shy += Math.sin(time * 47 + 2) * k;
    }
    camera.position.set(car.x + camS.off.x + shx, camS.off.y + camS.lift + shy, car.z + camS.off.z);
    const la = vc ? vc.look : 3.2, lx = camS.shift * 0.6;
    camS.dip = U.damp(camS.dip || 0, brk * 0.35, 8, dt); // view tips forward with the nose
    camera.lookAt(car.x + syw * la + cyw * lx, (vc ? vc.lookY : 0.95) - camS.dip, car.z - cyw * la + syw * lx);
    camS.fov = U.damp(camS.fov, 60 + U.clamp((spd - 20) / 60, 0, 1) * 11, 3, dt);
  } else {
    // cockpit: driver's eye, with subtle head motion from g-forces
    const bike = vehicle === 'bike', lean = bike ? (camS.body && camS.body.lean) || 0 : 0;
    // (motorcycle: the rider's helmet, tucked over the tank, tipping with the bike; car: the driver's seat)
    const f1 = playerF1.root.visible;                  // (racing: sat low in the middle of the F1 car)
    const van = vanOn && ownerVan && !f1 && !bike;      // (the van: up high in its cab)
    const side = van ? VAN_EYE.x : 0.37;
    const lx = bike ? Math.sin(lean) * -1.25 : f1 ? -U.clamp(car.ay, -30, 30) * 0.002 : (Settings.rhd ? side : -side) - U.clamp(car.ay, -12, 12) * 0.004;
    const seat = PLAYER_CARS[carKey];                  // (where the driver sits in the car you picked)
    const lf = (bike ? 0.2 : f1 ? playerF1.eye.f : van ? VAN_EYE.f - CG_F : seat.eyeF - CG_F) - U.clamp(car.ax, -15, 12) * 0.006; // head pitches forward under braking
    const y = (bike ? 1.3 * Math.cos(lean) : f1 ? playerF1.eye.y : van ? VAN_EYE.y : seat.eyeY) + Math.sin(time * 31) * Math.min(spd / 80, 1) * (bike ? 0.003 : 0.0015);
    camera.position.set(car.x + lf * sy + lx * cy, y, car.z - lf * cy + lx * sy);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(bike ? -0.09 : van ? -0.11 : -0.045, -car.visYaw, lean * 0.7);   // car: level, no tilt from braking / cornering (van: up high, looking down over the dash a little)
    camS.fov = U.damp(camS.fov, 70 + U.clamp((spd - 20) / 60, 0, 1) * 5, 3, dt);
  }
  // near plane: far enough out in the chase view for good depth precision (no z-fighting
  // flicker on lights/trim), close in the cockpit so the dashboard isn't clipped
  camera.near = camMode === 1 ? 0.05 : (camS.lift > 0.05 ? 0.1 : 0.25);
  camera.fov = camS.fov; camera.updateProjectionMatrix();
}
// how far to raise the chase camera so it isn't inside a friend's car (0 when nobody is that close)
function tailgateLift(cx, cz, cy) {
  if (!Net.active()) return 0;
  let lift = 0;
  for (const p of Net.players.values()) {
    if (!p.now || p.x === undefined || !p.g || !p.g.visible) continue;
    const dx = cx - p.x, dz = cz - p.z;
    if (dx * dx + dz * dz > 64) continue;
    const along = dx * Math.sin(p.yaw) - dz * Math.cos(p.yaw), lat = dx * Math.cos(p.yaw) + dz * Math.sin(p.yaw);
    // their body (with a bit of room around it): how deep the camera is inside it, 0..1
    const inside = Math.min(1 - U.smooth(2.4, 3.2, along), U.smooth(-3.6, -2.8, along), 1 - U.smooth(0.9, 1.6, Math.abs(lat)));
    lift = Math.max(lift, inside * Math.max(0, 1.75 - cy + 0.25));       // up to just over their roof
  }
  return lift;
}

// ---------- menus ----------
// Screens: title (main menu) -> singleplayer / multiplayer / leaderboard / settings; pause while driving.
const menu = document.getElementById('menu');
const $id = id => document.getElementById(id);
let screen = 'scrTitle', settingsFrom = 'scrTitle';
// where Back / Esc goes from each screen (anything not listed: the main menu)
const PARENT = { scrSP: 'scrPlay', scrMP: 'scrPlay', scrTitles: 'scrProfile', scrRace: 'scrRaceHub', scrRaceLB: 'scrRaceHub' };   // (scrGarage: set by Garage.setMode)
function show(id) {
  if (id === 'scrSettings' && screen !== 'scrSettings') settingsFrom = screen;
  if (id === 'scrGarage' && screen !== 'scrGarage' && typeof Garage !== 'undefined') Garage.setMode(screen === 'scrRaceHub');   // (from the racing hub: the Racing Garage, F1 car only)
  screen = id;
  for (const s of menu.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  if (id === 'scrMP') Net.refreshList();
  if (id === 'scrRace' && typeof refreshRace === 'function') refreshRace();
  if (id === 'scrLB') loadLeaderboard();
  if (id === 'scrRaceLB') loadRaceBoard();
  if (id === 'scrSettings') { renderKeys(); renderPadBinds(); }
  if (id === 'scrPause') updatePause();
  menu.classList.toggle('garageOpen', id === 'scrGarage');          // (the Garage shows the car itself: no blur)
  if (typeof Garage !== 'undefined') Garage.shown(id === 'scrGarage');
  PadNav.clear();
}
// ---------- moving around the menus with a wheel or controller (Settings > Controls > Wheel buttons) ----------
// D-pad / menu keys move a yellow outline between the buttons on the screen (nearest one in that direction);
// select presses it. On a slider or drop-down, left / right changes it.
const PadNav = {
  cur: null,
  items() {
    const fx = $id('claimFx'), root = fx && !fx.classList.contains('hidden') ? fx : menu.querySelector('.screen:not(.hidden)');
    if (!root) return [];
    return [...root.querySelectorAll('button, input, .sw, .gCar, .gRim')].filter(e => !e.disabled && e.offsetParent !== null && e.type !== 'color' && !e.classList.contains('ddNative'));
  },
  clear() { if (this.cur) this.cur.classList.remove('padFocus'); this.cur = null; },
  focus(el) { this.clear(); this.cur = el; el.classList.add('padFocus'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); },
  step(c, dx) {                                            // slider / drop-down: change it instead of moving away
    const sel = c.classList.contains('ddBtn') ? c.parentNode.querySelector('select') : null;
    if (sel) { sel.selectedIndex = (sel.selectedIndex + dx + sel.options.length) % sel.options.length; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    if (c.tagName === 'INPUT' && c.type === 'range') { const st = (+c.max - +c.min) / 20; c.value = U.clamp(+c.value + dx * st, +c.min, +c.max); c.dispatchEvent(new Event('input', { bubbles: true })); return true; }
    return false;
  },
  move(dx, dy) {
    const all = this.items(); if (!all.length) return;
    const c = this.cur;
    if (!c || !all.includes(c)) { this.focus(all.find(e => e.classList.contains('card')) || all.find(e => e.classList.contains('go')) || all[0]); return; }   // (start on the big buttons)
    if (dx && this.step(c, dx)) return;
    const r0 = c.getBoundingClientRect(), x0 = r0.left + r0.width / 2, y0 = r0.top + r0.height / 2;
    let best = null, bs = Infinity;
    for (const e of all) {
      if (e === c) continue;
      const r = e.getBoundingClientRect(), x = r.left + r.width / 2 - x0, y = r.top + r.height / 2 - y0, along = x * dx + y * dy;
      if (along <= 4) continue;
      const s = along + Math.abs(x * dy - y * dx) * 2.2;
      if (s < bs) { bs = s; best = e; }
    }
    if (best) this.focus(best);
  },
  select() {
    const c = this.cur;
    if (!c || !this.items().includes(c)) { this.move(0, 1); return; }
    if (c.classList.contains('ddBtn')) { this.step(c, 1); return; }   // (drop-down: next option)
    if (c.tagName === 'INPUT' && c.type === 'text') { c.focus(); return; }
    if (!(c.tagName === 'INPUT' && c.type === 'range')) c.click();
  },
  update(ctl) {
    const n = ctl.nav; if (!n) return;
    if (n.up) this.move(0, -1); if (n.down) this.move(0, 1); if (n.left) this.move(-1, 0); if (n.right) this.move(1, 0);
    if (ctl.select) this.select();
  },
};
addEventListener('pointermove', () => PadNav.clear());
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
bindRange('laKb', 'assistKb', v => v / 100, v => (v === 0 ? 'Off' : v + '%'));   // keyboard / gamepad (100% by default)
bindRange('la', 'assist', v => v / 100, v => (v === 0 ? 'Off' : v + '%'));       // steering wheel
bindRange('sens', 'sens', v => v / 100, v => (v / 100).toFixed(2) + '×');       // wheel / controller
bindRange('kbSens', 'kbSens', v => v / 100, v => (v / 100).toFixed(2) + '×');   // keyboard
setKbStyle(KB_STYLE);   // keyboard steering preset (physics.js KB_STYLE: 'snappy'; 'control' and 'classic' are kept to switch back)
bindRange('vol', 'vol', v => v / 100, v => v + '%');
// chat size (servers and races; style.css --chat). The slider reads 50% at the original size (1.2), 75% (1.8) is
// the default, 100% is twice the original; the setting keeps the real size
{
  const CHAT_PCT = 1.2 / 50, sl = $id('chatSize'), lab = $id('chatSizeV');
  sl.value = Math.round(Settings.chatSize / CHAT_PCT);
  const upd = () => { Settings.chatSize = +sl.value * CHAT_PCT; lab.textContent = sl.value + '%'; document.documentElement.style.setProperty('--chat', Settings.chatSize); saveSettings(); };
  sl.addEventListener('input', upd); upd();
}
{ // drop-downs: mirror quality, speed units, driver side
  const pick = (id, get, set) => { const el = $id(id); el.value = get(); el.addEventListener('change', () => { set(el.value); saveSettings(); }); };
  pick('mirrorQ', () => Settings.mirrors, v => { Settings.mirrors = v; MIRRORS.setQuality(v); });
  pick('units', () => Settings.units, v => { Settings.units = v; });  pick('rhd', () => (Settings.rhd ? 'right' : 'left'), v => { Settings.rhd = v === 'right'; MIRRORS.setSide(Settings.rhd); if (ownerVan) { ownerVan.setSide(Settings.rhd); ownerVan.cockpitSide(Settings.rhd); } });
  // car or motorcycle (the row only shows for the accounts allowed the bike: see setVehicle)
  pick('vehSel', () => Settings.vehicle || 'car', v => { Settings.vehicle = v; setVehicle(v); });
}
{ // motion blur 0..100 (stored as 0..100)
  const el = $id('blur'), lab = $id('blurV');
  el.value = Settings.blur || 0;
  const upd = () => { Settings.blur = +el.value; lab.textContent = +el.value === 0 ? 'Off' : el.value; saveSettings(); };
  el.addEventListener('input', upd); upd();
}
const tcEl = $id('tc'), manEl = $id('manual'), mmEl = $id('minimapOn');
tcEl.checked = Settings.tc; manEl.checked = Settings.manual; mmEl.checked = Settings.minimap;
tcEl.addEventListener('change', () => { Settings.tc = car.tc = tcEl.checked; saveSettings(); });
manEl.addEventListener('change', () => { Settings.manual = car.manual = manEl.checked; saveSettings(); });
mmEl.addEventListener('change', () => { Settings.minimap = mmEl.checked; saveSettings(); });
const ghEl = $id('ghostOn');                            // (racing: a see-through car on your best lap in time trials - race.js ghostShow)
ghEl.checked = Settings.ghost !== false;               // (on by default)
ghEl.addEventListener('change', () => { Settings.ghost = ghEl.checked; saveSettings(); });
const upEl = $id('updatePopupOn');                      // (the "Version 1.2 is here" popup on every launch - Welcome; not the sign-in one)
upEl.checked = Settings.updatePopup !== false;
upEl.addEventListener('change', () => { Settings.updatePopup = upEl.checked; saveSettings(); });
// (paint, wheels and the rest of the car's looks are in the Garage: js/garage.js)
// Settings tabs: gameplay / controls / graphics / audio
let setTab = 'gameplay';
function showSetTab(t) {
  setTab = t;
  document.querySelectorAll('[data-st]').forEach(b => b.classList.toggle('sel', b.dataset.st === t));
  document.querySelectorAll('[data-sp]').forEach(p => p.classList.toggle('hidden', p.dataset.sp !== t));
}
document.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => showSetTab(b.dataset.st)));
{ const el = $id('fxSel'); el.value = String(Number.isInteger(Settings.fx) ? Settings.fx : (Settings.toon ? 1 : 0)); el.addEventListener('change', () => setFx(+el.value, true)); }
const calMsg = $id('calMsg');
document.querySelectorAll('[data-cal]').forEach(b => b.addEventListener('click', () => Input.startCal(b.dataset.cal, t => (calMsg.textContent = t))));
// wheel / controller buttons: click an action, then press the button (or D-pad direction) for it
function renderPadBinds() {
  const box = $id('padBinds'); box.innerHTML = '';
  for (const [a, name] of PAD_ACTIONS) {
    const lab = document.createElement('span'); lab.textContent = name;
    const b = document.createElement('button'); b.textContent = Input.padLabel(a);
    b.onclick = () => {
      b.classList.add('wait'); b.textContent = 'Press a button…';
      $id('padMsg').textContent = `Press the wheel button for "${name.toLowerCase()}" (Esc cancels, 8 s).`;
      Input.startPadBind(a, ok => { renderPadBinds(); $id('padMsg').textContent = ok === true ? 'Saved.' : ok || 'Cancelled.'; });
    };
    const clr = document.createElement('button'); clr.className = 'mini'; clr.textContent = '✕'; clr.title = 'Clear';
    clr.onclick = () => { Input.setPadBind(a, null); renderPadBinds(); };
    const cell = document.createElement('div'); cell.className = 'padCell'; cell.append(b, clr);
    box.append(lab, cell);
  }
}
$id('padReset').onclick = () => { Input.resetPadBinds(); renderPadBinds(); $id('padMsg').textContent = 'Back to the default buttons.'; };
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
    n.textContent = !on || Account.signedIn ? '' : 'Not signed in: scored runs won\'t go on the leaderboard. Sign in on the main menu.';
    n.classList.toggle('warn', on && !Account.signedIn);
  }
}
Account.onChange = () => {
  acctMsg = ''; renderAccount(); syncBest(game.mode === 'mp' ? 'mp' : 'sp'); loadOwnerTools(); loadAdmin();
  if (window.AdminPanel) AdminPanel.account();          // (signed out / another account: the admin button goes)
  const wantCar = PLAYER_CARS[Settings.car] ? Settings.car : 'm4';
  if (wantCar !== carKey || (PLAYER_CARS[carKey].owners && !canBike())) installCar(wantCar);   // (the owners' drift car: back once they're signed in, gone when not)
  setVehicle(Settings.vehicle);                        // (the motorcycle only for its accounts; anyone else is in the car)
  if (typeof Garage !== 'undefined') Garage.refresh();
  $id('playDrift').classList.toggle('hidden', !canBike());   // (Play > Drift track: the owners only for now)
  if (game.mode === 'sp' && game.scored && !spToken) fetchSpToken();   // (signed in during a scored run: the next one counts)
  if (Account.ready) Welcome.update();
};
Account.onMsg = t => { acctMsg = t; renderAccount(); };
// ---------- launch popup (index.html #welcome): "Sign in with Google" every launch while you're not signed in
// (where sign-in exists: not on CrazyGames), then "Version 1.2 is here" every launch unless switched off in
// Settings > Gameplay (Settings.updatePopup; that setting doesn't touch the sign-in slide). Signing in from the
// popup moves on to the next slide.
const Welcome = {
  slides: null, i: 0,
  update() {
    if (!this.slides) {                                  // (the first time the account state is known: which slides)
      this.slides = [];
      if (Account.user && Account.user.banned) this.slides.push('banned');   // (leaderboard banned: told first, every launch)
      if (!Account.signedIn && Account.clientId) this.slides.push('signin');
      if (Settings.updatePopup !== false) this.slides.push('update');
      if (!this.slides.length) return;
      $id('welcome').classList.remove('hidden'); this.draw();
    } else if (Account.user && Account.user.banned && !this.slides.includes('banned')) {   // (signed in just now, banned: tell them)
      this.slides.splice(this.i + (this.slides[this.i] === 'signin' ? 1 : 0), 0, 'banned');
      if (this.slides[this.i] === 'signin') this.i++;
      $id('welcome').classList.remove('hidden'); this.draw();
    } else if (Account.signedIn && this.slides[this.i] === 'signin' && !$id('welcome').classList.contains('hidden')) this.next();
  },
  draw() {
    const cur = this.slides[this.i], last = this.i === this.slides.length - 1;
    document.querySelectorAll('#welcome .wcSlide').forEach(s => s.classList.toggle('on', s.dataset.wc === cur));
    document.querySelector('#welcome .wcDots').innerHTML = this.slides.length > 1 ? this.slides.map((_, j) => `<i${j === this.i ? ' class="on"' : ''}></i>`).join('') : '';
    $id('wcNext').textContent = cur === 'signin' && !Account.signedIn ? (last ? 'MAYBE LATER' : 'NOT NOW') : cur === 'banned' ? 'OK' : last ? 'GOT IT' : 'NEXT';
    // (a temporary ban: when it ends, counting down, and that the scores and stats reset then)
    clearInterval(this.banT);
    const until = cur === 'banned' && Account.user && Account.user.banUntil, bl = $id('wcBanLeft');
    bl.classList.toggle('hidden', !until);
    if (until) {
      const tick = () => { bl.innerHTML = `Ban ends in <b>${banLeft(until)}</b><br><span>When it ends, your scores and stats are reset (your date joined and time played stay).</span>`; };
      tick(); this.banT = setInterval(tick, 1000);
    }
  },
  next() {
    if (++this.i >= this.slides.length) { $id('welcome').classList.add('hidden'); clearInterval(this.banT); } else this.draw();
  },
};
$id('wcNext').onclick = () => Welcome.next();
// "Open Racing Garage" on the update slide: close the popup and go there (through the racing hub, so Back leads to it)
// the update slide's button: the Bang Bus quests (CrazyGames has no sign-in, so no event: the box isn't shown there)
$id('wcEvent').onclick = () => { $id('welcome').classList.add('hidden'); BusEvent.open('scrTitle'); };
if (CG) $id('wcEventBox').classList.add('hidden');
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
$id('playDrift').onclick = () => { if (typeof DriftTrack !== 'undefined') DriftTrack.enter('minami'); };
function startSingle(scored) {
  DriftTrack.exit();
  score.reset();                                       // (ends anything left over first)
  game.mode = 'sp'; game.scored = scored; game.density = scored ? SCORED_DENSITY : Settings.density;
  setWorld(Settings.world, Settings.tod);              // the world type / time of day picked on the singleplayer screen
  startPosition(); score.reset();
  closeMenu();
  hud.message(scored ? 'SCORED RUN' : 'FREE DRIVE');
  if (scored) fetchSpToken();
}
// ---------- scored runs -> leaderboard ----------
// Each run needs a token from the server, taken BEFORE the run (singleplayer: /api/run/start; multiplayer:
// the server sends one over the WebSocket). The run goes back with its token and its event log, and the
// server replays the log to check the score (runcheck.js).
let spToken = null;
async function fetchSpToken() {
  spToken = null;
  if (!Account.signedIn) return;
  const base = await Net.findBase(); if (!base) return;
  try {
    const r = await fetch(base + '/api/run/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: Account.session }) });
    const j = await r.json();
    if (j.token) spToken = j.token; else if (j.error && r.status === 403) hud.message(j.error.toUpperCase());
  } catch (e) { /* offline: runs won't count */ }
}
// the run's token (and a fresh one asked for straight away for the next run)
function takeToken(mode) {
  if (mode === 'mp') { const t = Net.runToken; Net.runToken = null; Net.send({ t: 'runtoken' }); return t; }
  const t = spToken; fetchSpToken(); return t;
}
const runBody = (mode, token, run) => JSON.stringify({ session: Account.session, token, mode, score: run.score, dur: run.dur, dist: run.dist || 0, log: run.log, veh: vanOn ? 'van' : vehicle });   // (veh: the server turns away motorcycle / Bang Bus runs)
// time played (profile): reported about once a minute while you're driving, signed in, in any mode
let playT = 0;
function playBeat(dt) {
  if (vehicle === 'bike') return;                      // (motorcycle: just for fun, not even time played)
  if (!Account.signedIn || !Net.base || (playT += dt) < 60) return;
  const s = playT; playT = 0;
  fetch(Net.base + '/api/playtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: Account.session, s }) }).catch(() => {});
}
score.onStreakEnd = run => {
  if (run.fun) return;                                 // (motorcycle: just for fun, never saved anywhere)
  if (!game.scored || run.score < 100 || !run.log) return;
  if (!Account.signedIn) { if (Account.clientId) hud.message('SIGN IN TO SAVE SCORES'); return; }
  submitRun(game.mode === 'mp' ? 'mp' : 'sp', run);
};
async function submitRun(mode, run) {
  const token = takeToken(mode);
  if (!token) { hud.message('RUN NOT SAVED (NO CONNECTION TO THE SERVER)'); return; }
  const base = await Net.findBase(); if (!base) return;
  try {
    const r = await fetch(base + '/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: runBody(mode, token, run) });
    const j = await r.json();
    if (j.rejected) { hud.message('RUN COULD NOT BE VERIFIED', true); console.warn('run rejected:', j.rejected); return; }
    if (j.error) { console.warn('run not saved:', j.error); return; }
    if (j.rank) hud.message(`LEADERBOARD #${j.rank}`);
    for (const id of (j.newTitles || []).concat(j.teamTitles || [])) { const t = Titles.TITLE_BY_ID[id]; if (t) setTimeout(() => hud.message(`NEW TITLE IN YOUR INBOX: ${t.name.toUpperCase()}`), 1600); }
  } catch (e) { /* offline: no leaderboard */ }
}
// closing / leaving the page in the middle of a scored run: send it anyway
addEventListener('pagehide', () => {
  if (!game.scored || score.fun || score.score < 100 || !Account.signedIn || !Net.base) return;
  const mode = game.mode === 'mp' ? 'mp' : 'sp', token = mode === 'mp' ? Net.runToken : spToken, log = score.runEvents();
  if (!token || !log) return;
  if (mode === 'mp') Net.runToken = null; else spToken = null;
  score.log = null;                                    // (sent: if the page comes back, this streak isn't sent again)
  navigator.sendBeacon(Net.base + '/api/run', new Blob([runBody(mode, token, { score: score.score, dur: score.runTime || 0, dist: score.runDist || 0, log })], { type: 'application/json' }));
});
// ...and if the browser brings the page back instead of closing it: a fresh token for the next run
addEventListener('pageshow', e => {
  if (!e.persisted || !game.scored) return;
  if (game.mode === 'mp') { if (!Net.runToken) Net.send({ t: 'runtoken' }); } else if (!spToken) fetchSpToken();
});
function quitToTitle() {
  if (game.mode === 'mp' || (game.mode === 'race' && Net.active())) { quitting = true; Net.leave(); quitting = false; }   // (onLeft puts the endless road back)
  else score.reset();
  Race.exit(); DriftTrack.exit();
  game.mode = 'menu'; game.scored = false; game.density = SCORED_DENSITY;
  setWorld(Settings.world, Settings.tod);              // (the title screen shows your chosen world again)
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
let lbView = 'top';   // 'top' = Top 100, 'me' = Your Position (you, 10 ahead, 10 behind)
document.querySelectorAll('[data-lbview]').forEach(b => b.addEventListener('click', () => {
  lbView = b.dataset.lbview;
  document.querySelectorAll('[data-lbview]').forEach(o => o.classList.toggle('sel', o === b));
  loadLeaderboard();
}));
// the racing leaderboard (its own screen, from the Racing page): time trials (best lap) or races (best 3-lap
// race time), each per track. Racing is Season 1 only, so no season picker.
let rlbKind = 'tt', rlbTrack = Tracks.TRACKS[0].id, rlbView = 'top', rlbReq = 0;
const pickSeg = (attr, set) => document.querySelectorAll(`[${attr}]`).forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll(`[${attr}]`).forEach(o => o.classList.toggle('sel', o === b));
  set(b.getAttribute(attr)); loadRaceBoard();
}));
pickSeg('data-rlbkind', v => (rlbKind = v));
pickSeg('data-rlbview', v => (rlbView = v));
$id('rlbTracks').innerHTML = Tracks.TRACKS.map(t => `<button data-rlbtrack="${t.id}"${t.id === rlbTrack ? ' class="sel"' : ''}>${t.short}</button>`).join('');
pickSeg('data-rlbtrack', v => (rlbTrack = v));
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
// simple white line icons (they take the text colour, so they grey out with whatever they're in)
const ICONS = {
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 12.2V4.5A1.5 1.5 0 0 1 4.5 3h7.7l9 9-9.2 9.2z"/><circle cx="7.8" cy="7.8" r="1.6" fill="currentColor" stroke="none"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.2"/><path d="M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};
const icon = (name, cls = '') => { const s = el('span', 'ico-' + name + (cls ? ' ' + cls : '')); s.innerHTML = ICONS[name]; return s; };
// a title as a coloured label (rarity colour; neon ones glow)
function titleEl(id, cls = 'ttl') {
  const t = Titles.TITLE_BY_ID[id]; if (!t) return null;
  const e = el('span', cls + ' r-' + t.rarity + (Titles.RARITIES[t.rarity].neon ? ' neon' : ''), t.name);
  e.title = Titles.desc(t, Settings.units);
  return e;
}
// driver name: click it to open their profile
function nameCell(cls, e) {
  const n = el('span', cls), who = el('span', 'who link', e.name);
  who.title = 'View profile'; who.onclick = () => openProfile(Account.signedIn && e.name === Account.user.name ? null : e.name);
  n.append(who); return n;
}
let lbReq = 0;   // only the newest load draws (two quick loads would otherwise both add their rows)
// season: Current Season (S1) by default; the beta's boards are kept as their own section
const LB_CURRENT = 1;
let lbSeason = LB_CURRENT;
$id('lbSeason').addEventListener('change', e => { lbSeason = +e.target.value; loadLeaderboard(); });
// the season's rewards (top 5 of the singleplayer / multiplayer boards), shown above the current season's board
// (board: the racing leaderboard's 'tt' / 'races' rewards instead)
function lbRewards(show, board) {
  const box = $id(board ? 'rlbRewards' : 'lbRewards');
  box.classList.toggle('hidden', !show); if (!show) return;
  box.innerHTML = '';
  box.append(el('span', 'rwHead', 'SEASON 1 REWARDS'));
  for (const [a, b, id] of board ? Titles.RACE_REWARDS[LB_CURRENT][board] : Titles.SEASON_REWARDS[LB_CURRENT]) {
    const it = el('span', 'rwItem');
    it.append(el('span', 'rwPlace', a === b ? `#${a}` : `#${a}–${b}`), titleEl(id));
    box.append(it);
  }
  box.append(el('span', 'rwNote', 'Sent to your inbox when the season ends.'));
}
async function loadLeaderboard() {
  const mode = lbTab, view = lbView, season = lbSeason, list = $id('lbList'), note = $id('lbNote'), my = ++lbReq;
  lbRewards(season === LB_CURRENT);
  note.textContent = 'Loading…'; list.innerHTML = '';
  const base = await Net.findBase();
  if (!base) { note.textContent = 'Leaderboards live on the online server: open the game from its website link.'; return; }
  if (view === 'me' && !Account.signedIn) { note.textContent = 'Sign in with Google to see where you rank.'; return; }
  let j;
  try {
    const url = (view === 'me' ? '/api/leaderboard/me?mode=' : '/api/leaderboard?mode=') + mode + '&season=' + season;
    const r = await fetch(base + url, { cache: 'no-store', headers: view === 'me' ? { Authorization: 'Bearer ' + Account.session } : {} });
    j = await r.json();
  } catch (e) { note.textContent = 'Could not load the leaderboard. Check your internet connection.'; return; }
  if (mode !== lbTab || view !== lbView || season !== lbSeason || my !== lbReq) return;
  if (j.error) { note.textContent = j.error; return; }
  const rows = j.list || [];
  const sName = season === LB_CURRENT ? 'Season 1' : 'Beta';
  const what = (mode === 'sp' ? 'Best scored singleplayer drive of each driver (60% traffic).' : 'Best drive of each driver on public and scored servers.') + ` ${sName}${season === LB_CURRENT ? '' : ' (final standings)'}.`;
  if (view === 'me') note.textContent = j.rank ? `You're #${j.rank} of ${j.total} drivers. ${what}` : `You're not on this leaderboard yet: finish a scored run of at least 100 points. ${what}`;
  else note.textContent = what + (season !== LB_CURRENT ? '' : j.accounts ? (Account.signedIn ? '' : ' Sign in with Google to get on it.') : ' (Sign-in isn\'t set up on this server yet, so no drives can be saved.)');
  drawBoard(list, rows, view, { fmt: v => U.fmt(v), head: 'SCORE', reward: season === LB_CURRENT, empty: 'No drives yet. Be the first on the podium!' });
}
// the racing leaderboard: fastest time-trial lap / fastest 3-lap race of each driver on a track (Season 1)
async function loadRaceBoard() {
  const kind = rlbKind, track = rlbTrack, view = rlbView, list = $id('rlbList'), note = $id('rlbNote'), my = ++rlbReq, races = kind === 'races';
  lbRewards(true, kind);
  note.textContent = 'Loading…'; list.innerHTML = '';
  const base = await Net.findBase();
  if (!base) { note.textContent = 'Leaderboards live on the online server: open the game from its website link.'; return; }
  if (view === 'me' && !Account.signedIn) { note.textContent = 'Sign in with Google to see where you rank.'; return; }
  let j;
  try {
    const r = await fetch(base + `/api/${races ? 'races' : 'laps'}?track=${track}${view === 'me' ? '&me=1' : ''}`, { cache: 'no-store', headers: view === 'me' ? { Authorization: 'Bearer ' + Account.session } : {} });
    j = await r.json();
  } catch (e) { note.textContent = 'Could not load the leaderboard. Check your internet connection.'; return; }
  if (kind !== rlbKind || track !== rlbTrack || view !== rlbView || my !== rlbReq) return;
  if (j.error) { note.textContent = j.error; return; }
  const rows = j.list || [];
  for (const e of rows) e.score = e.ms;
  const name = Tracks.TRACK_BY_ID[track].name;
  const what = races ? `Fastest finish of each driver in a ${Tracks.RACE_LAPS}-lap race on ${name} (penalties included).` : `Fastest time-trial lap of each driver on ${name}.`;
  if (view === 'me') note.textContent = j.rank ? `You're #${j.rank} of ${j.total} drivers. ${what}` : `You're not on this leaderboard yet: ${races ? 'finish a race' : 'set a time-trial lap'} while signed in. ${what}`;
  else note.textContent = what + (j.accounts ? (Account.signedIn ? '' : ' Sign in with Google to get on it.') : ' (Sign-in isn\'t set up on this server yet, so no times can be saved.)');
  drawBoard(list, rows, view, { fmt: fmtLap, head: races ? 'RACE TIME' : 'LAP', reward: kind, empty: races ? 'No race times yet. Finish a race to set the first one!' : 'No lap times yet. Set the first one in a time trial!' });
}
// podium + table for a leaderboard. o: { fmt (score text), head (score column), reward (season titles), empty }
function drawBoard(list, rows, view, o) {
  // when the drive was set, e.g. "Oct 7" (with the year if it's from an earlier year)
  const time = t => { if (!t) return '—'; const d = new Date(t); return d.toLocaleDateString(undefined, d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }); };
  const fmtScore = o.fmt;
  const rwFor = rank => (o.reward ? titleEl(Titles.seasonReward(LB_CURRENT, rank, typeof o.reward === 'string' ? o.reward : undefined), 'ttl small') : null);   // (what this spot wins)
  const me = Account.signedIn ? Account.user.name : null;
  // podium: 2nd | 1st | 3rd (Top 100 only)
  const podium = view === 'top' ? rows.slice(0, 3) : [];
  if (podium.length) {
    const pod = el('div', 'podium');
    for (const i of [1, 0, 2]) {
      const e = rows[i], p = el('div', 'pod p' + (i + 1) + (e ? '' : ' empty') + (e && e.name === me ? ' me' : ''));
      if (e) {
        p.append(nameCell('pname', e), el('div', 'pscore', fmtScore(e.score)), el('div', 'ptime', time(e.t)));
        const rw = rwFor(e.rank);
        if (rw) p.insertBefore(rw, p.querySelector('.pscore'));
      }
      else p.append(el('div', 'pname', '—'));
      const block = el('div', 'block'); block.append(el('span', '', String(i + 1))); p.appendChild(block);
      pod.appendChild(p);
    }
    list.appendChild(pod);
  }
  // everyone else (Your Position: everyone in the list, you highlighted)
  const rest = rows.slice(podium.length);
  if (rest.length) {
    const tbl = el('div', 'lbTable'), head = el('div', 'lbRow head');
    head.append(el('span', 'rk', '#'), el('span', 'nm', 'DRIVER'), el('span', 'sc', o.head), el('span', 'tm', 'TIME'));
    tbl.appendChild(head);
    for (const e of rest) {
      const row = el('div', 'lbRow' + (e.name === me ? ' me' : ''));
      const nm = nameCell('nm', e), rw = rwFor(e.rank);
      if (rw) nm.append(rw);                           // (4th / 5th: the Podium title)
      row.append(el('span', 'rk', String(e.rank)), nm, el('span', 'sc', fmtScore(e.score)), el('span', 'tm', time(e.t)));
      tbl.appendChild(row);
    }
    list.appendChild(tbl);
    if (view === 'me') { const mine = tbl.querySelector('.me'); if (mine) requestAnimationFrame(() => mine.scrollIntoView({ block: 'center' })); }
  }
  if (!rows.length && view === 'top') list.appendChild(el('div', 'lbEmpty', o.empty));
}

// ---------- profile ----------
let profBackTo = 'scrTitle', profData = null;
$id('profileCard').onclick = () => openProfile(null);
$id('profBack').onclick = () => show(profBackTo);
$id('profPickTitle').onclick = () => { show('scrTitles'); renderTitles(); };
// name = another driver's profile (null = yours)
async function openProfile(name) {
  if (screen !== 'scrProfile') profBackTo = screen;
  show('scrProfile');
  const note = $id('profNote'), body = $id('profBody'), my = name ? null : true;
  $id('profHead').textContent = name ? 'DRIVER PROFILE' : 'YOUR PROFILE';
  body.classList.add('hidden'); note.textContent = 'Loading…';
  const base = await Net.findBase();
  if (!base) { note.textContent = 'Profiles live on the online server: open the game from its website link.'; return; }
  if (my && !Account.signedIn) { note.textContent = 'Sign in with Google on the main menu to get your profile, stats and titles.'; return; }
  let p;
  try {
    const r = await fetch(base + '/api/profile' + (name ? '?name=' + encodeURIComponent(name) : ''), { cache: 'no-store', headers: my ? { Authorization: 'Bearer ' + Account.session } : {} });
    p = await r.json();
  } catch (e) { note.textContent = 'Could not reach the server.'; return; }
  if (screen !== 'scrProfile') return;
  if (p.error) { note.textContent = p.error; return; }
  note.textContent = '';
  profData = p;
  // the card: name, equipped title (and, on your own, the button to change it)
  $id('profName').textContent = p.name;
  showProfTitle();
  $id('profPickTitle').classList.toggle('hidden', !p.self);
  // stats
  const mph = Settings.units !== 'kmh';
  const hm = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`; };
  const pts = n => n ? U.fmt(n) : '—';
  // top row: this season's best runs with their leaderboard spot; then all-time bests; date joined bottom right
  const B = !!p.banned, sp = p.sp || {}, mpS = p.mp || {};   // (a banned profile comes without stats)
  const tiles = [
    ['Season best · singleplayer', B ? '' : pts(sp.season), sp.rank ? '#' + sp.rank : ''],
    ['Season best · multiplayer', B ? '' : pts(mpS.season), mpS.rank ? '#' + mpS.rank : ''],
    ['Best singleplayer run', B ? '' : pts(sp.best), ''],
    ['Best multiplayer run', B ? '' : pts(mpS.best), ''],
    ['Total distance', B ? '' : (p.distM / (mph ? 1609.34 : 1000)).toFixed(p.distM > 1e5 ? 0 : 1) + (mph ? ' mi' : ' km'), ''],
    ['Total near misses', B ? '' : U.fmt(p.near), ''],
    ['Time played', hm(p.playS || 0), '', true],
    ['Date joined', p.joined ? new Date(p.joined).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—', '', true],
  ];
  // leaderboard banned: a note at the top (with a live countdown for a temporary ban), every stat N/A except the
  // date joined and time played (the tiles marked true)
  banTag($id('profBan'), p.banned ? (p.banUntil || 0) : null);
  if (p.banned) for (const tl of tiles) if (!tl[3]) { tl[1] = 'N/A'; tl[2] = ''; }
  const st = $id('profStats'); st.innerHTML = '';
  for (const [k, v, sub] of tiles) { const d = el('div', 'stat'); d.append(el('span', 'k', k), el('span', 'v', v)); if (sub) d.append(el('span', 's rank', sub)); st.appendChild(d); }
  // your own: invite link + players referred (they count once they've played 10 minutes)
  drawRef($id('profRef'), p.self && p.name, p.ref);
  body.classList.remove('hidden');
}
// invite box (your profile + the Friends screen): your link and how many players you've referred
function drawRef(box, name, ref) {
  box.classList.toggle('hidden', !(name && ref));
  if (!name || !ref) return;
  box.querySelector('.refLink').value = 'https://polyweave.org/?ref=' + encodeURIComponent(name);
  box.querySelector('.refNote').textContent = `Players referred : ${ref.counted} (Referred players must be brand new accounts and play the game for at least 10 minutes)`;
}
// Friends screen: fetches your referral count (from your profile)
async function loadFriendRef() {
  const box = $id('frRef'), base = await Net.findBase();
  if (!base || !Account.signedIn) { box.classList.add('hidden'); return; }
  try {
    const p = await (await fetch(base + '/api/profile', { cache: 'no-store', headers: { Authorization: 'Bearer ' + Account.session } })).json();
    drawRef(box, p.self && p.name, p.ref);
  } catch (e) { /* offline */ }
}
for (const b of document.querySelectorAll('.refCopy')) b.onclick = () => {
  const inp = b.parentNode.querySelector('.refLink'), done = () => { b.textContent = 'COPIED!'; setTimeout(() => (b.textContent = 'COPY LINK'), 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(inp.value).then(done, () => { inp.select(); document.execCommand('copy'); done(); });
  else { inp.select(); document.execCommand('copy'); done(); }
};
// leaderboard ban countdown: "6d 23h 59m 12s"
const banLeft = until => { const s = Math.max(0, Math.floor((until - Date.now()) / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + m + 'm ' + (s % 60) + 's'; };
// the LEADERBOARD BANNED tag (profile): until = null: not banned; 0: permanent; a time: counts down every second
let banTimer = null;
function banTag(box, until) {
  clearInterval(banTimer); box.classList.toggle('hidden', until === null);
  if (until === null) return;
  const draw = () => { box.textContent = until ? `LEADERBOARD BANNED · ${banLeft(until)} LEFT` : 'LEADERBOARD BANNED'; if (until && (Date.now() >= until || box.offsetParent === null)) clearInterval(banTimer); };
  draw(); if (until) banTimer = setInterval(draw, 1000);
}
function showProfTitle() {
  const tb = $id('profTitle'); tb.innerHTML = '';
  const t = titleEl(profData && profData.title);
  tb.append(t || el('span', 'ttl none', profData && profData.self ? 'No title equipped' : 'No title'));
}
// ---------- select title: sort by rarity / name; "Owned" keeps your unlocked titles on top (on by default) ----------
const titleSort = $id('titleSort'), titleOwned = $id('titleOwned');
titleSort.value = ['rarityAsc', 'rarityDesc', 'az', 'za'].includes(Settings.titleSort) ? Settings.titleSort : 'rarityAsc';
titleOwned.checked = Settings.titleOwned !== false;
titleSort.onchange = () => { Settings.titleSort = titleSort.value; saveSettings(); renderTitles(); };
// "?": every rarity name in its own colour, highest first
{
  const pop = $id('rarityPop'), btn = $id('rarityBtn'), list = $id('rarityList');
  for (const id of Titles.RARITY_ORDER.slice().reverse()) {
    const r = Titles.RARITIES[id];
    list.append(el('span', 'ttl r-' + id + (r.neon ? ' neon' : ''), r.name));
  }
  const toggle = on => { pop.classList.toggle('hidden', !on); btn.classList.toggle('sel', on); };
  btn.onclick = e => { e.stopPropagation(); toggle(pop.classList.contains('hidden')); };
  document.addEventListener('click', e => { if (!pop.contains(e.target)) toggle(false); });
}
titleOwned.onchange = () => { Settings.titleOwned = titleOwned.checked; saveSettings(); renderTitles(); };
function renderTitles() {
  const p = profData, list = $id('titleList'), err = $id('titleErr');
  list.innerHTML = ''; err.textContent = '';
  if (!p || !p.self) return;
  const owned = new Set(p.owned || []);
  const pick = async id => {
    err.textContent = '';
    try {
      const r = await fetch(Account.base + '/api/title', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: Account.session, title: id }) });
      const k = await r.json();
      if (!r.ok) { err.textContent = k.error || 'Could not change your title.'; return; }
      Account.user.title = p.title = k.equipped;
      showProfTitle(); show('scrProfile');            // (back to your profile, wearing it)
    } catch (e) { err.textContent = 'Could not reach the server.'; }
  };
  const rk = t => Titles.RARITY_ORDER.indexOf(t.rarity);
  const by = {
    rarityAsc: (a, b) => rk(a) - rk(b) || a.name.localeCompare(b.name),
    rarityDesc: (a, b) => rk(b) - rk(a) || a.name.localeCompare(b.name),
    az: (a, b) => a.name.localeCompare(b.name),
    za: (a, b) => b.name.localeCompare(a.name),
  }[titleSort.value];
  // (handed-out titles you don't have aren't listed: there's no way to unlock them - except ones marked `show`)
  const all = Titles.TITLES.filter(t => owned.has(t.id) || t.how !== 'grant' || t.show)
    .sort((a, b) => (titleOwned.checked ? owned.has(b.id) - owned.has(a.id) : 0) || by(a, b));
  const none = el('button', 'titleOpt' + (p.title ? '' : ' sel')); none.append(el('span', 'ttl none', 'No title'), el('span', 'desc', 'Show only your name'));
  none.onclick = () => pick(null); list.appendChild(none);
  for (const t of all) {
    const have = owned.has(t.id), b = el('button', 'titleOpt' + (have ? '' : ' locked') + (p.title === t.id ? ' sel' : ''));
    const n = (p.owners && p.owners[t.id]) || 0;            // how many accounts own it
    const d = el('span', 'desc', Titles.desc(t, Settings.units)); if (!have) d.prepend(icon('lock'));
    b.append(titleEl(t.id), d, el('span', 'owners', `${U.fmt(n)} ${n === 1 ? 'owner' : 'owners'}`));
    if (have) b.onclick = () => pick(t.id); else b.disabled = true;
    list.appendChild(b);
  }
}

// ---------- multiplayer (dedicated server: public servers + private rooms with codes) ----------
Net.init(scene);
renderAccount(); Account.init();
const mpEl = $id;
const mpCode = mpEl('mpCode');
// segmented pickers: one button lit; remembered in Settings
function segPicker(id, key, onPick) {
  const el = $id(id), btns = [...el.querySelectorAll('button')];
  const mark = () => btns.forEach(b => b.classList.toggle('sel', b.dataset.v === Settings[key]));
  for (const b of btns) b.onclick = () => { Settings[key] = b.dataset.v; saveSettings(); mark(); if (onPick) onPick(b.dataset.v); };
  if (!btns.some(b => b.dataset.v === Settings[key])) Settings[key] = btns[0].dataset.v;
  mark();
}
// singleplayer: world type + time of day (the menu background shows it straight away)
segPicker('spWorld', 'world', () => { if (game.mode === 'menu') setWorld(Settings.world, Settings.tod); });
segPicker('spTod', 'tod', () => { if (game.mode === 'menu') setWorld(Settings.world, Settings.tod); });
// hosting: name, public (listed + code) or private (code only), world, time of day
const WORLD_NAMES = { grass: 'Grassy', desert: 'Desert', snow: 'Snowy' }, TOD_NAMES = { day: 'Day', sunset: 'Evening', night: 'Night' };
segPicker('hostVis', 'hostVis'); segPicker('hostWorld', 'hostWorld'); segPicker('hostTod', 'hostTod'); segPicker('hostVeh', 'hostVeh');   // (hostVeh: all vehicles / cars only)
$id('hostName').value = Settings.hostName || '';
$id('hostName').addEventListener('input', e => { Settings.hostName = e.target.value; saveSettings(); });
const hostOpts = extra => Object.assign({ listed: Settings.hostVis !== 'private', roomName: ($id('hostName').value || '').trim() || `${myName()}'s server`,
  theme: Settings.hostWorld, tod: Settings.hostTod, vehicles: Settings.hostVeh }, extra);
mpEl('mpHostScored').onclick = () => Net.host(myName(), Settings.color, hostOpts({ scored: true }));
mpEl('mpHostFree').onclick = () => Net.host(myName(), Settings.color, hostOpts({ scored: false, density: Settings.mpDensity }));
// server list tabs
let mpTab = 'official', mpLast = null;
document.querySelectorAll('[data-mptab]').forEach(b => b.addEventListener('click', () => {
  mpTab = b.dataset.mptab;
  document.querySelectorAll('[data-mptab]').forEach(o => o.classList.toggle('sel', o === b));
  if (mpLast) Net.onList(mpLast);
}));
mpEl('mpJoin').onclick = () => Net.joinCode(mpCode.value, myName(), Settings.color);
mpCode.addEventListener('keydown', e => { if (e.key === 'Enter') Net.joinCode(mpCode.value, myName(), Settings.color); });
mpEl('mpRefresh').onclick = () => Net.refreshList();
Net.onList = j => {
  mpLast = j;
  mpEl('mpOnline').textContent = j.online ? `· ${j.online} online` : '';
  const box = mpEl('mpServers'); box.innerHTML = '';
  const list = mpTab === 'public' ? (j.public || []) : (j.official || j.servers || []);
  for (const s of list) {
    const row = document.createElement('div'), here = Net.room && Net.room.id === s.id;
    row.className = 'mpSrv' + (here ? ' here' : '');
    row.innerHTML = '<span class="nmBox"><span class="nm"></span><span class="sub"></span></span><span class="ct"></span>';
    row.querySelector('.nm').textContent = s.name;                       // (names as text, never HTML)
    row.querySelector('.sub').textContent = [s.scored ? 'Scored' : 'Free drive', (WORLD_NAMES[s.theme] || 'Grassy') + ' world', TOD_NAMES[s.tod] || 'Day', s.carsOnly ? 'Cars only' : ''].filter(Boolean).join(' · ');
    row.querySelector('.ct').textContent = `${s.players}/${s.max} players`;
    const b = document.createElement('button');
    b.textContent = here ? 'JOINED' : s.players >= s.max ? 'FULL' : 'JOIN';
    b.disabled = here || s.players >= s.max;
    b.onclick = () => Net.joinServer(s.id, myName(), Settings.color);
    row.appendChild(b); box.appendChild(row);
  }
  if (!list.length) box.innerHTML = mpTab === 'public' ? '<div class="mpEmpty">No public servers right now. Host one and pick Public!</div>' : '<div class="mpEmpty">No official servers.</div>';
};
setInterval(() => { if (menuOpen && screen === 'scrMP' && !document.hidden) Net.refreshList(); }, 6000);

// ---------- racing (Season 1 limited-time mode): js/race.js + js/tracks.js ----------
// Each track: QUEUE (a public race: practise in the lobby until 2+ are in, 60 s countdown, 3 laps) or TIME TRIAL
// (alone, best laps on the leaderboard). Players can also host a public / private race on any track.
segPicker('rcWorld', 'raceWorld'); segPicker('rcTod', 'raceTod');
const titleCase = s => s.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');   // ('SAO PAULO' -> 'Sao Paulo')
$id('rhTrack').innerHTML = Tracks.TRACKS.map(t => `<button data-v="${t.id}">${titleCase(t.short)}</button>`).join('');
segPicker('rhVis', 'raceHostVis'); segPicker('rhTrack', 'raceHostTrack'); segPicker('rhWorld', 'raceHostWorld'); segPicker('rhTod', 'raceHostTod');
$id('rhName').value = Settings.raceHostName || '';
$id('rhName').addEventListener('input', e => { Settings.raceHostName = e.target.value; saveSettings(); });
// a small outline of a track (canvas), the start marked like the multiplayer spawn (a circle with an S)
function trackThumb(cv, id) {
  const tr = ROAD._tracks && ROAD._tracks[id] || (ROAD._tracks = ROAD._tracks || {}, ROAD._tracks[id] = Tracks.buildTrack(Tracks.TRACK_BY_ID[id]));
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < tr.N; i += 4) { x0 = Math.min(x0, tr.X[i]); x1 = Math.max(x1, tr.X[i]); z0 = Math.min(z0, tr.Z[i]); z1 = Math.max(z1, tr.Z[i]); }
  const k = Math.min((W - 16) / (x1 - x0), (H - 16) / (z1 - z0)), ox = (W - (x1 - x0) * k) / 2, oz = (H - (z1 - z0) * k) / 2;
  g.clearRect(0, 0, W, H); g.lineJoin = 'round'; g.beginPath();
  for (let i = 0; i <= tr.N; i += 4) { const j = i % tr.N, x = ox + (tr.X[j] - x0) * k, y = oz + (tr.Z[j] - z0) * k; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath(); g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.12)'; g.stroke(); g.lineWidth = 3; g.strokeStyle = '#e8ecf2'; g.stroke();
  // the start: a circle with an S, like the spawn marker on the multiplayer map
  const sx = ox + (tr.X[0] - x0) * k, sy = oz + (tr.Z[0] - z0) * k;
  g.beginPath(); g.arc(sx, sy, 4.6, 0, Math.PI * 2); g.fillStyle = '#2f3440'; g.fill(); g.lineWidth = 1.1; g.strokeStyle = '#d6dbe3'; g.stroke();
  g.font = '900 6px Segoe UI, Arial'; g.textAlign = 'center'; g.fillStyle = '#ffd84a'; g.fillText('S', sx, sy + 2.2);
}
const rcBox = $id('raceTracks');
for (const t of Tracks.TRACKS) {
  const L = Tracks.trackLength(t.id), row = el('div', 'rcTrack');
  row.dataset.t = t.id;
  row.innerHTML = `<canvas width="132" height="96"></canvas><div class="rcInfo"><b></b><span class="len"></span><p></p><span class="rcCount"></span><span class="rcBest"></span></div>
    <div class="rcBtns"><button class="go rcQ">QUEUE</button><button class="rcTT">TIME TRIAL</button></div>`;
  row.querySelector('b').textContent = t.name.toUpperCase();
  row.querySelector('.len').textContent = `${(L / 1000).toFixed(2)} km · ${Tracks.RACE_LAPS} laps`;
  row.querySelector('p').textContent = t.desc;
  row.querySelector('.rcQ').onclick = () => Net.raceQueue(t.id, myName(), f1Color());
  row.querySelector('.rcTT').onclick = () => startTimeTrial(t.id);
  rcBox.appendChild(row);
  trackThumb(row.querySelector('canvas'), t.id);
}
function startTimeTrial(track) {
  DriftTrack.exit();
  if (Net.active()) { quitting = true; Net.leave(); quitting = false; }
  score.reset();
  game.mode = 'race'; game.scored = false; game.density = 0;
  Race.startTT(track, Settings.raceWorld, Settings.raceTod);
  closeMenu();
}
async function refreshRace() {
  for (const row of rcBox.children) {                  // your best lap on each track (this device)
    let b = null; try { b = +localStorage.getItem('pw_lap_' + row.dataset.t) || null; } catch (e) { /* */ }
    row.querySelector('.rcBest').textContent = b ? 'YOUR BEST LAP ' + fmtLap(b) : 'NO LAP TIME YET';
  }
  const j = await Net.raceList();
  if (screen !== 'scrRace') return;
  if (!j) { $id('raceRooms').innerHTML = '<div class="mpEmpty">Racing needs the online server: open the game from its website link.</div>'; for (const row of rcBox.children) row.querySelector('.rcCount').textContent = ''; return; }
  $id('raceOnline').textContent = j.online ? `· ${j.online} online` : '';
  for (const t of j.tracks || []) {
    const row = rcBox.querySelector(`[data-t="${t.id}"]`); if (!row) continue;
    row.querySelector('.rcCount').innerHTML = `<i class="q"></i>${t.queue} IN QUEUE <i class="r"></i>${t.racing} RACING`;
  }
  const box = $id('raceRooms'); box.innerHTML = '';
  for (const s of j.rooms || []) {
    const t = Tracks.TRACK_BY_ID[s.race && s.race.track], row = el('div', 'mpSrv');
    row.innerHTML = '<span class="nmBox"><span class="nm"></span><span class="sub"></span></span><span class="ct"></span>';
    row.querySelector('.nm').textContent = s.name;
    const stName = { lobby: 'Waiting for players', countdown: 'Starting soon', grid: 'Starting', racing: 'Racing', results: 'Results' }[s.race && s.race.st] || '';
    row.querySelector('.sub').textContent = [t ? t.name : '', (WORLD_NAMES[s.theme] || 'Grassy') + ' world', TOD_NAMES[s.tod] || 'Day', stName].join(' · ');
    row.querySelector('.ct').textContent = `${s.players}/${s.max}`;
    const b = el('button', '', s.players >= s.max ? 'FULL' : 'JOIN'); b.disabled = s.players >= s.max;
    b.onclick = () => Net.joinServer(s.id, myName(), Settings.color);
    row.appendChild(b); box.appendChild(row);
  }
  if (!box.children.length) box.innerHTML = '<div class="mpEmpty">No public races right now. Host one!</div>';
}
setInterval(() => { if (menuOpen && screen === 'scrRace' && !document.hidden) refreshRace(); }, 4000);
$id('rhHost').onclick = () => Net.raceHost(myName(), f1Color(), { track: Settings.raceHostTrack, listed: Settings.raceHostVis !== 'private',
  roomName: ($id('rhName').value || '').trim() || `${myName()}'s race`, theme: Settings.raceHostWorld, tod: Settings.raceHostTod });
const rcCode = $id('rcCode');
$id('rcJoin').onclick = () => Net.joinCode(rcCode.value, myName(), Settings.color);
rcCode.addEventListener('keydown', e => { if (e.key === 'Enter') Net.joinCode(rcCode.value, myName(), Settings.color); });
rcCode.addEventListener('input', () => { const s = rcCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); rcCode.value = s.length > 3 ? s.slice(0, 3) + '-' + s.slice(3) : s; });
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
Net.onStatus = (msg, kind) => { for (const id of ['mpStatus', 'mpStatus2', 'rcStatus']) { const el = mpEl(id); el.textContent = msg; el.className = kind; } };
Net.onRoster = () => {
  const on = Net.active(), r = Net.room;
  mpEl('mpLive').classList.toggle('hidden', !on);
  mpEl('mpLot').classList.toggle('hidden', !on || !!(r && r.race));
  mpEl('mpHud').classList.toggle('hidden', !on);
  mpEl('mpWhere').textContent = r ? (r.official ? r.name : r.name + (r.listed ? ' (public)' : ' (private)')) : '';
  mpEl('mpCodeWrap').classList.toggle('hidden', !(r && r.code));
  mpEl('mpCodeShow').textContent = Net.code;
  mpEl('mpHudCode').textContent = r ? (r.official ? r.name.toUpperCase() : r.name.toUpperCase() + ' · ' + r.code) + (r.scored ? ' · SCORED' : ' · FREE DRIVE') : '';
  const list = mpEl('mpList'); list.innerHTML = '';
  for (const p of Net.roster(0)) {
    const sp = document.createElement('span'); sp.style.setProperty('--c', p.color); sp.textContent = p.name + (p.you ? ' (you)' : '');
    if (p.you || p.acct) {                             // (signed-in drivers only: a guest's name could be anyone's)
      sp.className = 'link'; sp.title = 'View profile';
      sp.onclick = () => openProfile(p.you ? null : p.name);
    }
    list.appendChild(sp);
  }
};
// joined a server: loop circuit + shared traffic, starting in your own space in the parking lot
Net.ext = { front: M4_EXT.front, rear: M4_EXT.rear, hw: M4_EXT.hw };
Net.refS = () => car.s;
Net.onTraffic = m => traffic.applySnapshot(m);
// a friend hit that car first: on my screen it still reacts to me, but it's theirs to move for everyone
Net.onWreckOwner = id => { const c = traffic.byId && traffic.byId.get(id); if (c && c.local) c.shadow = true; };
traffic.onRecover = c => Net.reportRecover(c);
traffic.onGone = c => Net.reportGone(c);
Net.onJoined = (room, slot) => {
  Net.slot = slot; bigMap = false;
  Input.lastActive = performance.now();   // (the AFK clock starts fresh)
  score.reset();
  if (room.race) {                                     // racing: the track, practising in the lobby until the race
    game.mode = 'race'; game.scored = false; game.density = 0;
    score.useBest('sp');
    Race.enterMp(room, slot);
    closeMenu();
    const t = Tracks.TRACK_BY_ID[room.race.track];
    hud.message(room.race.queue ? 'QUEUE · ' + t.name.toUpperCase() : room.name.toUpperCase() + ' · ' + room.code);
    return;
  }
  if (Race.active) Race.exit();
  game.mode = 'mp'; game.scored = !!room.scored; game.density = room.density;
  const swapped = room.carsOnly && (Settings.vehicle || 'car') !== 'car' && (vehicle !== 'car' || vanOn);
  if (room.carsOnly) setVehicle('car');               // (cars-only server: in your car while you're here)
  enterServer(slot, room);
  closeMenu();
  hud.message(room.official ? 'JOINED ' + room.name.toUpperCase() : room.name.toUpperCase() + ' · ' + room.code);
  if (swapped) setTimeout(() => hud.message('CARS ONLY SERVER · YOU\'RE IN YOUR CAR HERE'), 1600);
  if (room.scored && Account.clientId && !Account.signedIn) setTimeout(() => hud.message('NOT SIGNED IN · RUNS WON\'T BE SAVED'), 1800);
};
// left the server (or lost it): endless road again, back to the menu
// AFK on a server: no input for 20 s out on the road (60 s parked in the start lot) and you're removed,
// so an empty car doesn't sit in everyone's traffic. A warning shows 10 s before.
const AFK_ROAD = 20, AFK_LOT = 60;
let afkWarned = false;
function inLotPad(s, d) {
  if (!ROAD.loop) return false;
  const ls = ROAD.lotS(s);
  return ls > LOOP.LOT_S0 - 2 && ls < LOOP.LOT_S1 + 2 && d > ROAD.edgeR + LOOP.LOT_D0 - 2 && d < ROAD.edgeR + LOOP.LOT_D1 + 2;
}
function afkCheck(now) {
  if (game.mode !== 'mp' || !Net.active()) { afkWarned = false; return; }
  const idle = (now - Input.lastActive) / 1000, limit = inLotPad(car.s, car.d) ? AFK_LOT : AFK_ROAD;
  if (idle < limit - 10) { afkWarned = false; return; }
  if (!afkWarned) { afkWarned = true; hud.message('AFK? MOVE OR YOU\'LL BE REMOVED', true); }
  if (idle >= limit) {
    afkWarned = false;
    Net.leave();
    Net.status('You were removed from the server for being AFK (no input for ' + limit + ' seconds).', 'err');
  }
}
// a friend hit me hard (they noticed it on their side): my streak ends as well
Net.onBumped = v => { if (game.mode === 'mp') crashEvent(Math.max(3, v)); };
Net.onLeft = () => {
  const racing = Race.active;
  Race.exit();
  exitServer();
  game.mode = 'menu'; game.scored = false; game.density = SCORED_DENSITY;
  setVehicle(Settings.vehicle);                        // (back from a cars-only server: whatever you drive normally)
  if (!quitting) openMenu(racing ? 'scrRace' : 'scrMP');
};
Net.onRace = m => Race.onState(m);
Net.onRaceFinish = m => { if (m.id !== Net.myId) hud.message(`${m.name.toUpperCase()} FINISHED P${m.pos}`); else Race.finUpdate({ pos: m.pos }); };
// the finish card's LOBBY (time trial) / LEAVE RACE button: back to the Racing menu
Race.toLobby = () => {
  if (Net.active()) { Net.leave(); return; }           // (onLeft opens the Racing menu)
  Race.exit();
  game.mode = 'menu'; game.scored = false; game.density = SCORED_DENSITY;
  setWorld(Settings.world, Settings.tod); startPosition(); score.reset();
  openMenu('scrRace');
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
    steer: +car.steer.toFixed(3), brake: !!(car.brakeOn && car.gear >= 0), kmh: Math.round(Math.abs(car.u) * 3.6), score: Race.active ? Race.progress() : Math.round(score.score),   // (racing: how far round the race)
    rt: Math.round(score.runTime || 0), rtt: Math.round(Net.rtt || 0), w: traffic.remote ? traffic.localWrecks() : undefined };
}

// ---------- proxy multiplier (multiplayer): drive close to another player for up to x10 ----------
// Gap between the two cars (m, bumper to bumper / side to side): one car length (~4.8 m) = x5, a metre = ~x8.6,
// half a metre and closer = ~x10, nothing past 25 m. Side by side counts for less than nose-to-tail, and the
// bonus grows with speed: almost nothing at 60 km/h, half at ~105, the full amount from 160 km/h.
const PROX_CURVE = mcurve([[0.3, 10], [1, 8.6], [2, 7.2], [3, 6.1], [4.8, 5], [7, 3.8], [10, 2.7], [14, 1.9], [19, 1.35], [25, 1]]);
function proximity(kmh) {
  if (game.mode !== 'mp' || kmh < 50 || vanOn) return 1;  // (driving the Bang Bus: no bonus, it's just for fun)
  const len = M4_EXT.front - M4_EXT.rear;
  let best = 1;
  for (const p of Net.players.values()) {
    const n = p.now; if (!n || Math.abs(n.s - car.s) > 40 || p.veh === 'bike' || p.veh === 'van') continue;   // (a motorcycle or the Bang Bus gives no bonus: just for fun)
    const gs =Math.max(0, Math.abs(n.s - car.s) - len);             // gap along the road
    const gd = Math.max(0, Math.abs(n.d - car.d) - 2 * M4_EXT.hw);   // gap across it
    const gap = Math.hypot(gs, gd);
    if (gap > 25) continue;
    const side = (1 - U.smooth(0, 3, gs)) * U.smooth(1, 2.5, Math.abs(n.d - car.d));   // 1 = side by side (other lane, level with you)
    best = Math.max(best, 1 + (PROX_CURVE(Math.max(0.3, gap)) - 1) * (1 - 0.6 * side));
  }
  return 1 + (best - 1) * U.smooth(50, 160, kmh);
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
  const on = (game.mode === 'mp' || game.mode === 'race' || game.mode === 'drift') && !menuOpen && (Settings.minimap || bigMap);
  if (mm.classList.contains('hidden') === on) mm.classList.toggle('hidden', !on);
  if (!on || (mmT -= dt) > 0) return;
  mmT = bigMap ? 0.12 : 0.08;
  const size = bigMap ? MM_BIG : MM_SMALL, dpr = Math.min(devicePixelRatio || 1, 2);
  if (mmSize !== size) { mmSize = size; mm.width = mm.height = Math.round(size * dpr); mm.style.width = mm.style.height = size + 'px'; mm.classList.toggle('big', bigMap); }
  const g = mmc, W = size;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, W);
  if (Race.active || DriftTrack.active) { Race.drawMap(g, W); return; }     // (racing / the drift track: the whole track)
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
  if (game.mode === 'drift') { const t = Tracks.DRIFT_BY_ID[DriftTrack.id]; $id('pauseMode').textContent = `Drift track · ${t ? t.name : ''}`; return; }
  if (game.mode === 'race') {
    const t = Tracks.TRACK_BY_ID[Race.track];
    $id('pauseMode').textContent = `Racing · ${t ? t.name : ''} · ` + (Race.kind === 'tt' ? 'Time trial' : r && r.race && r.race.queue ? 'Queue' : (r ? r.name : 'Race'));
    return;
  }
  $id('pauseMode').textContent = game.mode === 'mp'
    ? `${r ? r.name : 'Server'} · ${game.scored ? 'Scored' : 'Free drive'} · ${Math.round(game.density * 100)}% traffic`
    : game.scored ? 'Singleplayer · Scored · 60% traffic' : `Singleplayer · Free drive · ${Math.round(game.density * 100)}% traffic`;
}
// bottom-left key hints, from the player's own key bindings (an action with no key isn't listed)
function hintText() {
  const parts = [['camera', 'camera'], ['style', 'Shaders'], ['gearbox', 'manual']]
    .filter(([a]) => Input.binds[a] && Input.binds[a][0]).map(([a, n]) => `${keyLabel(Input.binds[a][0])} ${n}`);
  return parts.join(' · ');
}

function openMenu(id = 'scrPause') {
  menuOpen = true; menu.classList.remove('hidden'); show(id);
  document.getElementById('hud').classList.add('hidden'); sound.suspend(true); camS.orbit = 0;
}
function closeMenu() {
  menuOpen = false; menu.classList.add('hidden'); document.getElementById('hud').classList.remove('hidden');
  $id('hint').textContent = hintText();
  hud.trafficLabel = game.mode === 'drift' ? 'DRIFT TRACK' : game.mode === 'race' ? (Race.kind === 'tt' ? 'TIME TRIAL' : 'RACE') : game.scored ? 'SCORED' : 'FREE DRIVE';   // (just which kind of run, above the speedo)
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

let f1ScreenT = 0;
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
  // (body pitch / roll only shows from outside: in the cockpit the car stays level around you)
  const level = camMode === 1 && !menuOpen;
  playerVis.root.rotation.x = level ? 0 : bm.pitch;
  playerVis.root.rotation.z = level ? 0 : bm.roll;
  animateWheels(playerVis, car.u * dt, car.steer);
  if (car.drift) for (const w of playerVis.wheels) if (!w.front) {   // (spinning / locked rear tyres turn faster / slower than the road)
    w.xs = ((w.xs || 0) - ((car.wr || 0) * DRIFT.rw - car.u) * dt / playerVis.M.r) % (Math.PI * 2);
    w.mesh.rotation.x += w.xs * w.spinSign;
  }
  DriftFx.update(dt, car, playerVis);
  swMesh.rotation.z = car.drift ? -car.steer * DRIFT.ratio / Settings.sens : -car.steer * M4.ratio / Settings.sens;   // (drift car: its own 10:1 rack)
  // cockpit camera: the detailed interior + mirrors replace the simple one (which is only seen through the glass)
  const inCockpit = camMode === 1 && !menuOpen;
  const bike = vehicle === 'bike';
  const vanShown = vanOn && !!ownerVan;                // (the van has its own cab: the car's cockpit stays hidden)
  cockpit.visible = cockpitWheel.visible = inCockpit && !bike && !vanShown; interior.visible = swMesh.visible = !inCockpit && !vanOn;
  cockpitWheel.rotation.z = swMesh.rotation.z;
  if (ownerVan) {
    ownerVan.wheel.rotation.z = swMesh.rotation.z; vanGlass.opacity = 0.62;
    // first person: the clean cab shell instead of the scanned body (its window edges are too rough to look out through)
    const inCab = inCockpit && vanShown;
    ownerVan.body.visible = !inCab; if (ownerVan.glass) ownerVan.glass.visible = !inCab; ownerVan.edge.visible = !inCab;
    if (ownerVan.cockpit) ownerVan.cockpit.visible = inCab;
    ownerVan.setLamps(lightsAreOn(), car.brakeOn && car.gear >= 0);
  }
  // the night headlight beams come from whichever front you're driving (the van's lamps sit higher and further forward)
  for (const l of headlights) { const s = Math.sign(l.position.x); l.position.set(s * (vanShown ? 0.72 : 0.62), vanShown ? 0.92 : 0.75, (vanShown ? -2.38 : -2.2) + CG_F); }
  if (inCockpit && !bike) MIRRORS.drawGauge(dt);
  playerVis.brake.visible = !vanOn && car.brakeOn && car.gear >= 0;
  playerGlass.opacity = camMode === 1 && !menuOpen ? 0.14 : glassOut;   // (outside: the Garage window tint)
  if (playerF1.root.visible) {                         // racing: the F1 car
    playerF1.root.rotation.x = level ? 0 : bm.pitch * 0.5; playerF1.root.rotation.z = level ? 0 : bm.roll * 0.4;
    animateWheels(playerF1, car.u * dt, f1VisDamp(playerF1, f1VisSteer(car.steer, car.u), dt));   // (front wheels: the turn shown clearly, smoothly - js/f1.js)
    playerF1.brake.visible = car.brakeOn && car.gear >= 0;
    playerF1.helmet.visible = !inCockpit;               // (the cockpit view is from inside the helmet)
    playerF1.cockpit.visible = inCockpit;
    if (playerF1.lid) playerF1.lid.visible = !inCockpit;
    if (playerF1.shield) playerF1.shield.visible = !inCockpit; // (the dark cover over the cockpit opening: only seen from outside)
    if (playerF1.steer) playerF1.steer.rotation.z = -car.steer * M4.ratio * 0.55;   // (an F1 wheel turns less than a road car's)
    if (inCockpit && (f1ScreenT -= dt) <= 0) {
      f1ScreenT = 0.08;
      const mph = Settings.units !== 'kmh';
      drawF1Screen(playerF1, car.gear < 0 ? 'R' : car.gear === 0 ? 'N' : String(car.gear), Math.round(Math.abs(car.u) * (mph ? 2.23694 : 3.6)), U.clamp((car.rpm - 3000) / (M4.redline - 3000), 0, 1), mph ? 'MPH' : 'KM/H');
    }
  }
  if (bike) {
    // the motorcycle leans into turns (the angle real bikes need for that turn, softened), nose dips the same as the car
    const leanT = U.clamp(-Math.atan2(ayNow, 9.81) * 0.85, -0.72, 0.72);
    bm.lean = dt > 0 ? U.damp(bm.lean || 0, leanT, 7, dt) : (bm.lean || 0);
    playerBike.lean.rotation.z = bm.lean;
    playerBike.root.rotation.x = level ? 0 : bm.pitch * 0.6;
    animateWheels(playerBike, car.u * dt, car.steer * 0.55);
    playerBike.brake.visible = car.brakeOn && car.gear >= 0;
    playerBike.riderTop.visible = !inCockpit;              // (first person: your own arms on the bars, no helmet in the way)
  }
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
// ---------- time of day (day / sunset / night) + world theme ----------
// Each preset sets the sky, fog, sun (moon at night) and ambient light; the theme tints the ground light
// and the haze. At night your headlights come on and every car's lights glow brighter.
const TOD = {
  day: { sky: ['#4f9fe3', '#9fd0f0', '#d3eaf7'], fog: 0xd3eaf7, sun: 0xfff3e2, sunI: 1.2, hemi: 0xdff0ff, hemiI: 0.72, off: [-55, 95, 40], cloud: 0xffffff, dark: 0 },
  // "Evening" (stored as 'sunset'): a warm orange sky, only a touch of dusk at the very top
  sunset: { sky: ['#c4683c', '#ee9a52', '#ffcf8c'], fog: 0xf6c38c, sun: 0xffa452, sunI: 1.08, hemi: 0xffc896, hemiI: 0.58, off: [-120, 30, 70], cloud: 0xffd0a2, dark: 0.3 },
  night: { sky: ['#050a1a', '#0d1a36', '#1a2948'], fog: 0x15223b, sun: 0x9fb8ff, sunI: 0.42, hemi: 0x5d78b0, hemiI: 0.45, off: [40, 90, -30], cloud: 0x4f5b75, dark: 1 },
};
function lightsAreOn() { return (TOD[look.tod] || TOD.day).dark > 0.5; }   // (night: headlights on - the van's lamps, other players' vans)
const THEME_LOOK = { grass: { ground: 0x7b9a5c, haze: null }, desert: { ground: 0xc4a274, haze: 0xead8b4 }, snow: { ground: 0xdde5ec, haze: 0xe4eef6 } };
const look = { theme: 'grass', tod: 'day', realistic: false };
const headlights = (() => {
  const g = [];
  for (const sx of [-0.62, 0.62]) {
    // (on the car's root group, not its body: they stay on when riding the motorcycle)
    const l = new THREE.SpotLight(0xfff1d6, 0, 70, 0.42, 0.55, 1.4); l.position.set(sx, 0.75, -2.2 + CG_F);
    l.target.position.set(sx * 1.4, 0, -22 + CG_F); playerRoot.add(l, l.target); g.push(l);
  }
  return g;
})();
const _skyCanvas = scene.background.image;
function applyLook() {
  const T = TOD[look.tod] || TOD.day, th = THEME_LOOK[look.theme] || THEME_LOOK.grass, on = look.realistic;
  { // sky gradient
    const g = _skyCanvas.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, T.sky[0]); gr.addColorStop(0.55, T.sky[1]); gr.addColorStop(1, T.sky[2]);
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256); scene.background.needsUpdate = true;
  }
  const fog = new THREE.Color(T.fog); if (th.haze && T.dark < 0.5) fog.lerp(new THREE.Color(th.haze), 0.35);
  scene.fog.color.copy(fog);
  sunLight.color.set(T.sun); sunLight.intensity = T.sunI * (on ? 1.58 : 1);
  hemi.color.set(T.hemi); hemi.groundColor.set(th.ground).lerp(new THREE.Color(0x1a2230), T.dark * 0.8); hemi.intensity = T.hemiI * (on ? 0.97 : 1);
  SUN_OFF.set(...T.off);
  for (const c of world.clouds.children) if (c.material && c.material.color) c.material.color.set(T.cloud);
  for (const l of headlights) l.intensity = T.dark > 0.5 ? 2.2 : 0;
  MATS[SLOT.HEAD].emissiveIntensity = T.dark > 0.5 ? 2.2 : 0.55;     // every car's headlights / tail lights glow at night
  MATS[SLOT.TAIL].emissiveIntensity = T.dark > 0.5 ? 2.4 : 1;
}
// the world (scenery theme + time of day) for singleplayer, the title screen or a server
function setWorld(theme, tod) {
  look.theme = THEMES[theme] ? theme : 'grass'; look.tod = TOD[tod] ? tod : 'day';
  world.setTheme(look.theme);
  applyLook();
}
function realisticScene(on) {
  look.realistic = on; applyLook();
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
  const sel = document.getElementById('fxSel'); if (sel) sel.value = String(mode);   // (T key: the Settings drop-down follows)
  if (!silent) hud.message(FX_NAMES[mode]);
}
// Motion blur (Settings slider): the faster you go, the more the scenery streaks toward the middle of the
// screen. Things close to the camera (your own car, the dashboard) stay sharp.
const BLUR = (() => {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rtPost = new THREE.WebGLRenderTarget(size.x, size.y);    // (styles 1/2: their finished picture, blurred after)
  const mat = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: null }, tDepth: { value: FX.rtScene.depthTexture }, amount: { value: 0 }, center: { value: new THREE.Vector2(0.5, 0.52) },
      near: { value: 0.25 }, far: { value: 2000 }, toSRGB: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      varying vec2 vUv; uniform sampler2D tColor, tDepth; uniform float amount, near, far, toSRGB; uniform vec2 center;
      float lin(vec2 uv){ float z = texture2D(tDepth, uv).r * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
      void main(){
        float k = amount * smoothstep(8.0, 22.0, lin(vUv));
        vec2 dir = (center - vUv) * k;
        vec3 c = vec3(0.0);
        for (int i = 0; i < 12; i++) c += texture2D(tColor, vUv + dir * (float(i) / 11.0)).rgb;
        c /= 12.0;
        gl_FragColor = toSRGB > 0.5 ? LinearTosRGB(vec4(c, 1.0)) : vec4(c, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  addEventListener('resize', () => { const z = renderer.getDrawingBufferSize(new THREE.Vector2()); rtPost.setSize(z.x, z.y); });
  return { rtPost, mat, scene: s };
})();
function blurAmount() {
  if (menuOpen || !(Settings.blur > 0)) return 0;
  return Settings.blur / 100 * 0.07 * U.smooth(70, 260, Math.abs(car.u) * 3.6);
}
function renderFrame() {
  renderMirrors();
  const blur = blurAmount();
  if (FX.mode === 0 && blur < 0.001) { renderer.render(scene, camera); return; }
  renderer.setRenderTarget(FX.rtScene);
  renderer.render(scene, camera);
  const U2 = BLUR.mat.uniforms;
  U2.amount.value = blur; U2.near.value = camera.near; U2.far.value = camera.far;
  if (FX.mode === 0) {                                      // plain look: blur straight from the scene picture
    U2.tColor.value = FX.rtScene.texture; U2.toSRGB.value = 1;
    renderer.setRenderTarget(null); renderer.render(BLUR.scene, FX.cam);
    return;
  }
  FX.look.uniforms.near.value = camera.near; FX.look.uniforms.far.value = camera.far;
  FX.look.uniforms.mode.value = FX.mode;
  renderer.setRenderTarget(FX.rtLook);
  renderer.render(FX.lookScene, FX.cam);
  renderer.setRenderTarget(blur > 0.001 ? BLUR.rtPost : null);
  renderer.render(FX.fxaaScene, FX.cam);
  if (blur > 0.001) { U2.tColor.value = BLUR.rtPost.texture; U2.toSRGB.value = 0; renderer.setRenderTarget(null); renderer.render(BLUR.scene, FX.cam); }
}

// ---------- one step of driving: physics, traffic, collisions, scoring ----------
// paused = the menu is open on a server: the car keeps rolling (no throttle or brake, lane keeping
// steers it down its lane) so it never just stops in the middle of shared traffic. No points meanwhile.
const COAST = { steer: 0, throttle: 0, brake: 0, source: 'keys' };
const OFF_SLOW = 1.1;                                  // (racing: grass slows you 1.1x more than it first did: lower cap, stronger drag)
const OFF_CAP = 150 / 3.6 / OFF_SLOW;                  // (racing: top speed on the grass / run-off, ~136 km/h)
const _raceSteer = {};
// racing: no lane assist, and steering sensitivity fixed at 1x (keyboard and wheel) so everyone's car turns the same
const RACE_STEER = () => Object.assign(_raceSteer, Settings, { assist: 0, assistKb: 0, laneCentre: false, sens: 1, kbSens: 1 });
// racing finish fly-by (race.js): the car glides on by itself; the other racers still see it
function finStep(dt) {
  Race.finStep(dt);
  Object.assign(proxy, { s: car.s, d: car.d, v: 0, ry: 0 });
  if (Net.active()) Net.tick(dt, netState());
}
function driveStep(dt, ctl, paused) {
  // ---- physics (fixed-size substeps that exactly cover the frame) ----
  const n = Math.max(1, Math.ceil(dt / SUB)), h = dt / n;
  // (racing: no lane assist of any kind; menu open on a server: the coasting car keeps its lane)
  const steerSet = Race.active ? RACE_STEER() : paused ? Object.assign({}, Settings, { assist: 1, laneCentre: true }) : Settings;
  // the owners' drift car: its own tyre physics (js/drift.js); everything else drives as always
  car.drift = carKey === 's15' && vehicle === 'car' && !vanOn && !Race.active && canBike() ? DRIFT : null;
  let wallHit = 0;
  ROAD.hintS = car.s;      // (loop circuit: road lookups pick the lap you're on)
  const held = Race.active && Race.frozen;               // (racing: on the grid until the lights go out)
  for (let i = 0; i < n && !held; i++) {
    steerCtl.update(h, car, ctl, steerSet);
    car.step(h, ctl);
    wallHit = Math.max(wallHit, railCollide(h));
  }
  if (held) { car.u = car.v = car.r = 0; car.brakeOn = true; }
  // safety net: if the car state ever becomes invalid (NaN), put it back on the road
  if (![car.x, car.z, car.u, car.v, car.r, car.yaw, car.steer].every(Number.isFinite)) {
    car.place(Number.isFinite(lastGoodS) ? lastGoodS : 40, ROAD.lane(2), 100 / 3.6);
    car.wImp = 0; car.rK = 0; steerCtl.key = steerCtl.k1 = steerCtl.wheelF = 0; steerCtl.kAl = 0; steerCtl.k1v = 0; steerCtl.kAlv = 0;
  }
  const pr = ROAD.project(car.x, car.z);
  car.s = pr.s; car.d = pr.d; lastGoodS = pr.s;
  const ry = ROAD.yaw(car.s);
  const vx = car.u * Math.sin(car.yaw) + car.v * Math.cos(car.yaw), vz = -car.u * Math.cos(car.yaw) + car.v * Math.sin(car.yaw);
  Object.assign(proxy, { s: car.s, d: car.d, v: vx * Math.sin(ry) - vz * Math.cos(ry), ry: U.wrap(car.visYaw - ry) });

  // ---- racing: no traffic and no points, just the other drivers (bumps) and the walls ----
  if (Race.active) {
    Net.tick(dt, netState());
    const bump = Net.silent ? 0 : Net.collide(car, trafficHull);   // (practising unseen during a race: no bumping the racers)
    if (bump > 0.45) sound.thump(0.2 + bump / 12);
    if (bump > 4) Race.onBump(bump, Net.lastBumpId);     // (a hard hit on the car in front: causing a collision)
    if (wallHit > 2) sound.thump(0.2 + wallHit / 14);
    zoneHit = false; railHit = false;
    ffbHit = Math.max(bump, wallHit);
    // off the track: a gravel trap bogs the car down hard; grass / painted run-off holds you to about
    // 150 km/h (pulled down smoothly), so cutting a corner or running wide costs time
    const off = Math.abs(car.d) - (2 * ROAD.LW + Tracks.RUNOFF.kerb + 0.6);
    ffbRough = Math.abs(car.d) > 2 * ROAD.LW ? (off > 0 ? 0.7 : 0.45) : 0;   // (force feedback: kerb, then run-off)
    if (off > 0 && Math.abs(car.u) > 1) {
      const grav = Tracks.gravelAt(ROAD.loop, car.s, car.d < 0 ? -1 : 1) && off > 2;
      if (grav) ffbRough = 1;
      car.u *= Math.exp(-(grav ? 1.15 : 0.25 * OFF_SLOW) * dt);
      if (grav) car.v *= Math.exp(-2 * dt);
      else if (car.u > OFF_CAP) car.u -= (car.u - OFF_CAP) * (1 - Math.exp(-1.6 * OFF_SLOW * dt));
    }
    if (!paused) playBeat(dt);
    return;
  }
  // ---- the drift track: just you, the barriers and the grass (no traffic, no score) ----
  if (DriftTrack.active) {
    zoneHit = false; railHit = false;
    if (wallHit > 2) sound.thump(0.2 + wallHit / 14);
    ffbHit = wallHit;
    const off = Math.abs(car.d) - (2 * ROAD.LW + Tracks.RUNOFF.kerb);   // (on the grass: rough, and it scrubs speed)
    ffbRough = Math.abs(car.d) > 2 * ROAD.LW ? (off > 0 ? 0.75 : 0.45) : 0;
    if (off > 0 && Math.abs(car.u) > 1) car.u *= Math.exp(-0.35 * dt);
    if (!paused) playBeat(dt);
    return;
  }

  // ---- traffic, collisions, scoring ----
  Net.tick(dt, netState());
  // shared traffic is drawn at "now" like friends are: its smoothing buffer + the trip from the server
  traffic.lead = traffic.remote ? traffic.netDelay() + (Net.rtt || 60) / 2000 : 0;
  traffic.wreckPose = traffic.remote ? Net.wreckPoses() : null;   // (wrecks friends are simulating come from them)
  traffic.update(dt, proxy, game.density);
  if (traffic.remote) Net.unoverlap(traffic.cars, trafficHull);    // (friends never drawn inside a car)
  const impact = traffic.collide(car, trafficHull);
  // friends: light bumps just push you around, a hard hit (> ~11 km/h difference) costs your streak
  const bump = Net.collide(car, trafficHull);
  if (bump > 0.45) sound.thump(0.2 + bump / 12);
  if (bump > 3) { crashEvent(bump); Net.reportBump(bump); }   // (their streak ends too)
  // cones / barrels: knocked flying (no streak loss), with a little thud and a small speed scrub
  const coneHits = zoneProps.update(dt, car, car.s, M4_EXT);
  if (coneHits) { sound.thump(0.15 * coneHits); car.u *= Math.pow(0.985, coneHits); }
  if (impact > 0.45) crashEvent(impact); // the lightest brushes (<0.45 m/s) just bump you
  if (impact > 1.5) car.hitT = 0.8;
  if (wallHit > 3.5 || zoneHit || railHit) crashEvent(Math.max(wallHit, 2));
  zoneHit = false; railHit = false;
  ffbHit = Math.max(impact, bump, wallHit, coneHits ? 0.5 : 0);
  ffbRough = Math.abs(car.d) > 2 * ROAD.LW + 0.15 ? (Math.abs(car.d) > 2 * ROAD.LW + 2.5 ? 0.8 : 0.4) : 0;   // (force feedback: shoulder, then off it)
  const kmh = Math.abs(car.u) * 3.6;
  const misses = traffic.nearMisses(proxy, kmh); // always run so pass tracking stays correct
  if (paused) { score.prox = 1; score.update(dt); return; }   // (no points while the menu is open)
  // multiplayer: driving close to another player multiplies the points you earn
  score.prox = Math.max(1, Math.round(proximity(kmh) * 10) / 10);   // (in steps of 0.1, as shown: the run check replays it exactly)
  const pe = $id('prox');
  if (pe.classList.contains('on') !== score.prox > 1) pe.classList.toggle('on', score.prox > 1);
  if (score.prox > 1) hud.set('prox', pe.firstElementChild, '×' + score.prox.toFixed(1));
  // Shoulder: car centre on / past the edge line (about half the car over it) -> no points, and lose 10% of points
  // per second. (Sitting exactly on the edge line used to give a perfect near miss on every car with no way to
  // crash - found by Codester. It counted as shoulder for a while; now traffic sways within its lane
  // (traffic.js), so outer-lane cars drifting over clip a car parked on the line, and this can be less touchy.)
  const onShoulder = Math.abs(car.d) > 2 * ROAD.LW + 0.15 && Math.abs(car.u) > 2 && !inStartArea(car.s, car.d);
  if (!onShoulder) {
    for (const nm of misses) if (time - lastCrash > 1.5) score.nearMiss(nm.gap, kmh);
    if (time - lastCrash > 1.5) score.speed(dt, kmh);
  } else {
    if (time - lastShoulder > 1.5) shoulderLost = 0; // new trip onto the shoulder: count from zero
    shoulderLost += score.shoulder(dt);
    lastShoulder = time;
  }
  // more than 3 s on the shoulder in one go: the streak is over and you're put back on the road
  shoulderT = onShoulder ? shoulderT + dt : 0;
  if (shoulderT > 3) { shoulderT = 0; backOnRoad(); hud.shoulderWarn(false, 0); return; }
  hud.shoulderWarn(onShoulder, shoulderLost);
  score.update(dt);
  if (score.score >= 1) score.runDist = (score.runDist || 0) + Math.abs(car.u) * dt;   // (distance this streak: a profile stat)
  playBeat(dt);

  // ---- floating origin: keep coordinates small for precision ----
  // (the loop circuit stays within a few km of the centre, so it never needs this)
  if (!ROAD.loop && car.z < -3000) {
    const sh = 3000;
    ROAD.origin += sh; car.z += sh;
    for (const c of traffic.cars) if (c.crashed && c.body) { c.body.z += sh; c.z += sh; }
    for (const c of world.clouds.children) c.position.z += sh;
    zoneProps.shift(sh);
    DriftFx.shift(sh);
  }
}

// ---------- main loop ----------
const SUB = 1 / 240;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = U.clamp((now - last) / 1000, 0, 0.05); last = Math.max(last, now);
  const ctl = Input.update(now, dt);
  // owners' video recorder (tools/recorder.js, only loaded for their accounts): while its editor is open it
  // draws the replay instead of the game
  if (window.Recorder && Recorder.active) { Recorder.frame(dt); Input.endFrame(); return; }
  afkCheck(now);

  if (menuOpen) {
    // Esc: pause -> back to driving; settings -> where you came from; other screens -> main menu
    // (the wheel's menu / back buttons work like Esc, unless a button is being bound in Settings)
    const back = Input.hit('Escape') || (!Input.padCap && (ctl.menu || ctl.back));
    if (back) {
      const fx = $id('claimFx');
      if (fx && !fx.classList.contains('hidden')) $id('cfOk').click();
      else if (screen === 'scrPause') closeMenu();
      else if (screen === 'scrSettings') show(settingsFrom);
      else if (screen !== 'scrTitle') show(game.mode === 'menu' ? (PARENT[screen] || 'scrTitle') : 'scrPause');
    } else if (Input.hit('Enter') && screen === 'scrPause') closeMenu();
    else if (!Input.padCap) PadNav.update(ctl);
    updatePadPanel();
    if (typeof FFB !== 'undefined') FFB.stop();   // (menus: no forces on the wheel)
    // on a server the game doesn't stop behind the menu: your car keeps rolling with the shared traffic
    const rolling = game.mode === 'mp' || (game.mode === 'race' && Net.active());   // (a multiplayer race doesn't wait for you either)
    if (rolling) { time += dt; if (Race.fin) finStep(dt); else driveStep(dt, COAST, true); Race.update(dt); }
    updatePlayerVisual(rolling ? (Race.fin ? Race.finDt : dt) : 0);
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
  if (Input.hit('Escape') || Input.hit('KeyP') || ctl.menu) { openMenu('scrPause'); Input.endFrame(); return; }
  time += dt;
  if (Input.tap('camera') || ctl.camBtn) camMode ^= 1;   // chase <-> cockpit
  if (Input.tap('style')) setFx((FX.mode + 1) % 3);   // normal -> toon -> realistic -> normal
  if (Input.tap('reset') || ctl.reset) { if (Race.active) Race.reset(); else if (DriftTrack.active) DriftTrack.reset(); else resetCar(); }
  if (Input.tap('gearbox') || ctl.gearbox) { car.manual = Settings.manual = !car.manual; manEl.checked = car.manual; saveSettings(); hud.message(car.manual ? 'MANUAL' : 'AUTO'); }
  if (Input.tap('map') && (game.mode === 'mp' || game.mode === 'race' || game.mode === 'drift')) bigMap = !bigMap;
  if (Input.tap('shiftUp') || ctl.up) { if (!car.manual) { car.manual = Settings.manual = true; manEl.checked = true; } car.shift(1); }
  if (Input.tap('shiftDown') || ctl.down) { if (!car.manual) { car.manual = Settings.manual = true; manEl.checked = true; } car.shift(-1); }

  if (Race.fin) { finStep(dt); if (Input.hit('Enter') && Race.kind === 'tt') Race.reset(); }   // (finish fly-by: the car drives itself)
  else {
    Race.gate(ctl);                                    // (racing start: no throttle before the green light - see race.js)
    ffbHit = 0; ffbRough = 0;
    driveStep(dt, ctl, false);
  }
  // steering wheel force feedback / controller rumble (js/ffb.js)
  if (typeof FFB !== 'undefined') {
    if (Race.fin || (Race.active && Race.frozen)) FFB.stop();
    else { FFB.hit(ffbHit); FFB.drive(dt, { kmh: Math.abs(car.u) * 3.6, wheel: Input.padKind === 'wheel' ? Input.wheelPos || 0 : null, ay: car.ay || 0, rough: ffbRough, align: car.drift ? car.ffbAlign || 0 : undefined }); }   // (drift car: the tyres' own aligning force)
  }
  Race.update(dt);                                     // (racing: lap timing, lights, race HUD)
  world.update(car.s, camera);

  updatePlayerVisual(Race.fin ? Race.finDt : dt);
  updateCamera(dt);
  sunLight.position.set(car.x + SUN_OFF.x, SUN_OFF.y, car.z + SUN_OFF.z);
  sunLight.target.position.set(car.x, 0, car.z);

  hud.update(dt, car, score, steerCtl, Settings);
  updateMpHud(dt);
  drawMinimap(dt);
  sound.update(car, ctl.throttle, Settings.vol);
  Input.endFrame();
  if (window.Recorder) Recorder.capture(dt);       // (owners: keeps the last minute for clips)
  renderFrame();
}
// The recorder: the server only sends it to the owners' accounts and Content Creators (anyone else gets a 404)
let toolsFor = null;
// a title that unlocks something was just claimed (Content Creator: the recorder; Admin: the admin panel) - no reload needed
function titleUnlocks(id) {
  if (id === 'creator') { toolsFor = null; loadOwnerTools(); }
  if (id === 'admin' && Account.user && !Account.user.admin) { Account.user.staff = true; adminFor = null; loadAdmin(); if (window.AdminPanel) AdminPanel.account(); }
  if ((id === 'creator' || id === 'admin') && Account.user && !Account.user.bus) { Account.user.bus = true; Account.onChange(); }   // (admins and Content Creators get the Bang Bus)
}
function loadOwnerTools() {
  if (!Account.signedIn || !Account.session || toolsFor === Account.session || window.Recorder) return;
  toolsFor = Account.session;
  fetch((Account.base || '') + '/api/tools/recorder', { headers: { Authorization: 'Bearer ' + Account.session }, cache: 'no-store' })
    .then(r => (r.ok ? r.text() : null))
    .then(src => {
      if (!src || window.Recorder) return;
      const s = document.createElement('script');
      s.src = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      document.body.appendChild(s);
    })
    .catch(() => { toolsFor = null; });
}
// Admin panel: only asked for when the server says this account is the admin, and the server checks again before
// handing it over (admin/panel.js; everyone else gets a 404). The panel adds its own button + screen.
let adminFor = null;
function loadAdmin() {
  if (!Account.signedIn || !(Account.user.admin || Account.user.staff) || !Account.session || adminFor === Account.session || window.AdminPanel) return;   // (staff: the Admin title - the server checks every request)
  adminFor = Account.session;
  fetch((Account.base || '') + '/api/tools/admin', { headers: { Authorization: 'Bearer ' + Account.session }, cache: 'no-store' })
    .then(r => (r.ok ? r.text() : null))
    .then(src => { if (!src || window.AdminPanel) return; const s = document.createElement('script'); s.src = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })); document.body.appendChild(s); })
    .catch(() => { adminFor = null; });
}
// restore the last visual style (older saves used a toon on/off flag)
setFx(Number.isInteger(Settings.fx) ? Settings.fx : (Settings.toon ? 1 : 0), true);
setWorld(Settings.world, Settings.tod);                // the title screen shows your chosen world
requestAnimationFrame(frame);
