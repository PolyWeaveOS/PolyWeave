'use strict';
// =====================================================================
//  Garage (main menu): pick your car (the BMW M4 Competition, plus the F1 car used only in Racing), paint it
//  (colour + gloss / metallic / matte), wheels (five styles, any colour), brake caliper colour and window tint.
//  The F1 car has its own setup (Settings.f1: body, finish, rims, accent, helmet - see f1Cfg / setF1Cfg in main.js).
//  The car stands on the right, unblurred, slowly turning (drag to turn it yourself); the options are on the left.
// =====================================================================
const GARAGE_PAINTS = [['Brooklyn Grey', '#a6b0b8'], ['Alpine White', '#eef0ee'], ['Black Sapphire', '#14161a'], ['Dravit Grey', '#6b6e68'],
  ['Kemora Grey', '#8d949b'], ['Isle of Man Green', '#0e5a44'], ['Python Green', '#4fbf3a'], ['São Paulo Yellow', '#f0c419'],
  ['Fire Orange', '#e0561c'], ['Guards Red', '#c4141c'], ['Toronto Red', '#8f1018'], ['Portimão Blue', '#1d5cc0'],
  ['Shark Blue', '#1f86d6'], ['Ascari Blue', '#1f3d8a'], ['Tanzanite Blue', '#1d2a4b'], ['Ruby Star', '#7a1d4f']];
const GARAGE_RIMS = [['stock', 'Stock'], ['m4', 'M Forged'], ['gt3', 'Centre-Lock'], ['alloy', 'Twin-Spoke'], ['mesh', 'Mesh'], ['five', 'Five-Spoke']];
const GARAGE_RIM_COLORS = [['Silver', '#c4c9cf'], ['Gunmetal', '#4a4f56'], ['Anthracite', '#2b2d31'], ['Satin Black', '#1d1f22'], ['Bronze', '#9c7a4c'], ['Gold', '#b8924e'], ['White', '#e9ebec'], ['Red', '#b31b20']];
const GARAGE_CALIPERS = [['Red', '#c8161d'], ['Yellow', '#f2c12e'], ['Blue', '#1f5fd1'], ['Black', '#1b1c1f'], ['Silver', '#a9aeb4'], ['Green', '#2e9b4d'], ['Orange', '#e8621c']];
const GARAGE_ACCENTS = [['White', '#f4f2ee'], ['Black', '#16171a'], ['Yellow', '#ffd84a'], ['Red', '#d42a2a'], ['Blue', '#1f5fd1'], ['Teal', '#14b8a6'], ['Orange', '#ff7a1a'], ['Silver', '#b9bec5']];
const GARAGE_HELMETS = [['Yellow', '#ffd84a'], ['White', '#f4f2ee'], ['Red', '#d42a2a'], ['Blue', '#1f5fd1'], ['Black', '#1d1f22'], ['Green', '#2e9b4d'], ['Orange', '#ff7a1a'], ['Pink', '#f28cb1']];

const Garage = (() => {
  const $ = id => document.getElementById(id);
  const scr = $('scrGarage');
  let yaw = 0.9, lastDrag = -1e9, dragging = null, open = false, f1 = false;   // f1: setting up the F1 car (racing only)
  // the setup being edited and where changes go (the road car's or the F1's)
  const cfg = () => (f1 ? f1Cfg() : carCfg());
  const setCfg = patch => (f1 ? setF1Cfg(patch) : setCarCfg(patch));

  // swatch rows: click one to pick it (the custom colour picker sits under the paint)
  const swatches = (box, list, get, set) => {
    box.innerHTML = '';
    for (const [n, c] of list) {
      const el = document.createElement('button'); el.className = 'sw'; el.title = n; el.dataset.c = c; el.style.background = c;
      el.onclick = () => { set(c); refresh(); };
      box.appendChild(el);
    }
    return () => { for (const el of box.children) el.classList.toggle('sel', el.dataset.c.toLowerCase() === String(get()).toLowerCase()); };
  };
  const seg = (box, get, set) => {
    const bs = [...box.querySelectorAll('button')];
    for (const b of bs) b.onclick = () => { set(b.dataset.v); refresh(); };
    return () => bs.forEach(b => b.classList.toggle('sel', b.dataset.v === get()));
  };

  // the cars: the road car(s), then the F1 car (shown here, but only driven in Racing)
  const cars = $('gCars');
  const pickF1 = on => { f1 = on; if (!Race.active) showF1(on); };
  for (const k of PLAYER_CAR_KEYS) {
    const b = document.createElement('button'); b.className = 'gCar'; b.dataset.k = k;
    const [make, ...model] = PLAYER_CARS[k].name.split(' ');
    b.innerHTML = `<small>${make.toUpperCase()}</small><b>${model.join(' ').toUpperCase()}</b>`;
    b.onclick = () => { pickF1(false); installCar(k); refresh(); };
    cars.appendChild(b);
  }
  {
    const b = document.createElement('button'); b.className = 'gCar f1'; b.dataset.k = 'f1';
    b.innerHTML = '<b>F1 CAR</b>';
    b.onclick = () => { pickF1(true); refresh(); };
    cars.appendChild(b);
  }
  // wheels
  const rims = $('gRims');
  for (const [k, n] of GARAGE_RIMS) {
    const b = document.createElement('button'); b.className = 'gRim'; b.dataset.k = k; b.textContent = n;
    b.onclick = () => { setCarCfg({ rim: k }); refresh(); };
    rims.appendChild(b);
  }
  // the F1 car's paint pattern (js/f1.js F1_PATTERNS), painted in colour 2
  const pats = $('gF1Pattern');
  for (const [k, n] of F1_PATTERNS) {
    const b = document.createElement('button'); b.className = 'gRim'; b.dataset.k = k; b.textContent = n;
    b.onclick = () => { setF1Cfg({ pattern: k }); refresh(); };
    pats.appendChild(b);
  }
  // the F1's rim styles (js/f1.js F1_RIM_STYLES); their colour is the Wheels colour row
  const f1Rims = $('gF1Rims');
  for (const [k, n] of F1_RIM_STYLES) {
    const b = document.createElement('button'); b.className = 'gRim'; b.dataset.k = k; b.textContent = n;
    b.onclick = () => { setF1Cfg({ rimStyle: k }); refresh(); };
    f1Rims.appendChild(b);
  }
  const pick2 = $('gF1Col2Pick');
  pick2.addEventListener('input', () => { setF1Cfg({ accent: pick2.value }); refresh(); });
  const marks = [
    swatches($('gPaint'), GARAGE_PAINTS, () => cfg().color, c => setCfg({ color: c })),
    swatches($('gF1Col2'), GARAGE_PAINTS, () => f1Cfg().accent, c => setF1Cfg({ accent: c })),
    swatches($('gRimCol'), GARAGE_RIM_COLORS, () => (f1 ? cfg().rim : cfg().rimColor), c => setCfg(f1 ? { rim: c } : { rimColor: c })),
    swatches($('gCaliper'), GARAGE_CALIPERS, () => carCfg().caliper, c => setCarCfg({ caliper: c })),
    swatches($('gF1Accent'), GARAGE_ACCENTS, () => f1Cfg().accent, c => setF1Cfg({ accent: c })),
    swatches($('gF1Helmet'), GARAGE_HELMETS, () => f1Cfg().helmet, c => setF1Cfg({ helmet: c })),
    seg($('gFinish'), () => cfg().finish, v => setCfg({ finish: v })),
    seg($('gTint'), () => carCfg().tint, v => setCarCfg({ tint: v })),
  ];
  const pick = $('gPaintPick'), note = scr.querySelector('.gNote');
  pick.addEventListener('input', () => { setCfg({ color: pick.value }); refresh(); });
  function refresh() {
    const c = cfg();
    for (const b of cars.children) b.classList.toggle('sel', f1 ? b.dataset.k === 'f1' : b.dataset.k === carKey);
    rims.classList.toggle('hidden', f1);                 // (the F1 car has its own wheels: only their colour changes)
    for (const b of rims.children) { b.classList.toggle('sel', b.dataset.k === carCfg().rim); if (b.dataset.k === 'stock') b.classList.toggle('hidden', !playerVis.M.wheelGeoms); }
    scr.querySelector('.gCarOnly').classList.toggle('hidden', f1);
    scr.querySelector('.gF1Only').classList.add('hidden');   // (old accent options: not used)
    // the F1 car: colour 1 + finish, then a pattern in colour 2 (all on Paint); no wheel / extras options
    scr.querySelector('[data-gt="extras"]').classList.toggle('hidden', f1);   // (the F1: Paint + Wheels - rim style and colour)
    f1Rims.classList.toggle('hidden', !f1);
    for (const b of f1Rims.children) b.classList.toggle('sel', b.dataset.k === f1Cfg().rimStyle);
    if (f1 && !scr.querySelector('[data-gp="extras"]').classList.contains('hidden')) scr.querySelector('[data-gt="paint"]').click();   // (was on Extras)
    $('gF1Tag').classList.toggle('hidden', !f1);
    scr.querySelector('.gF1Pat').classList.toggle('hidden', !f1);
    $('gColLabel').textContent = f1 ? 'Colour 1' : 'Colour';
    for (const b of pats.children) b.classList.toggle('sel', b.dataset.k === f1Cfg().pattern);
    note.textContent = f1 ? 'The F1 car is only for Racing mode: pick a pattern and colour 2 to paint it. Everywhere else you drive your road car.' : '';
    for (const m of marks) m();
    pick.value = c.color; pick2.value = f1Cfg().accent;
  }
  // tabs: paint / wheels / extras
  scr.querySelectorAll('[data-gt]').forEach(b => b.addEventListener('click', () => {
    scr.querySelectorAll('[data-gt]').forEach(o => o.classList.toggle('sel', o === b));
    scr.querySelectorAll('[data-gp]').forEach(p => p.classList.toggle('hidden', p.dataset.gp !== b.dataset.gt));
  }));

  // drag anywhere outside the panel to turn the car
  scr.addEventListener('pointerdown', e => {
    if (e.target.closest('.garagePanel')) return;
    dragging = { x: e.clientX, id: e.pointerId }; try { scr.setPointerCapture(e.pointerId); } catch (x) { /* */ }
  });
  scr.addEventListener('pointermove', e => { if (!dragging || e.pointerId !== dragging.id) return; yaw -= (e.clientX - dragging.x) * 0.008; dragging.x = e.clientX; lastDrag = performance.now(); });
  const up = e => { if (dragging && e.pointerId === dragging.id) dragging = null; };
  scr.addEventListener('pointerup', up); scr.addEventListener('pointercancel', up);

  return {
    // (leaving the Garage: the road car is back on show, unless you're racing)
    shown(on) { open = on; if (on) { if (f1 && !Race.active) showF1(true); refresh(); } else if (f1 && !Race.active) showF1(false); },
    // the camera while the Garage is open: low 3/4 view, the car on the right of the screen (the panel is on the left)
    camera(dt) {
      if (performance.now() - lastDrag > 2500 && !dragging) yaw += dt * 0.18;
      const fov = 38, asp = innerWidth / innerHeight, tn = Math.tan(fov * Math.PI / 360), panel = Math.min(0.46, 400 / innerWidth);
      // far enough back that the whole car (with room around it) fits in the space right of the panel
      const d = U.clamp(3.1 / (tn * asp * (1 - panel)), 5.4, 15), y = 0.55 + d * 0.13;
      const a = car.yaw + yaw, cx = car.x, cz = car.z;
      camera.position.set(cx + Math.sin(a) * d, y, cz - Math.cos(a) * d);
      // aim a little to the left of the car so it sits in the middle of the space right of the panel
      const k = panel * d * tn * asp;
      // (the camera looks along (-sin a, cos a), so its left is (cos a, sin a))
      camera.lookAt(cx + Math.cos(a) * k, 0.55, cz + Math.sin(a) * k);
      camera.fov = fov; camera.near = 0.25; camera.updateProjectionMatrix();
    },
    refresh,
    get open() { return open; },
    get f1Preview() { return open && f1; },   // (the F1 car is on show in the Garage)
  };
})();
