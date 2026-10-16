'use strict';
// =====================================================================
//  Garage (main menu): pick your car (only the BMW M4 Competition for now), paint it (colour + gloss /
//  metallic / matte), wheels (five styles, any colour), brake caliper colour and window tint. Each car keeps
//  its own setup (Settings.cars, see carCfg / setCarCfg / installCar in main.js). Every car drives the same.
//  The car stands on the right, unblurred, slowly turning (drag to turn it yourself); the options are on the left.
// =====================================================================
const GARAGE_PAINTS = [['Brooklyn Grey', '#a6b0b8'], ['Alpine White', '#eef0ee'], ['Black Sapphire', '#14161a'], ['Dravit Grey', '#6b6e68'],
  ['Kemora Grey', '#8d949b'], ['Isle of Man Green', '#0e5a44'], ['Python Green', '#4fbf3a'], ['São Paulo Yellow', '#f0c419'],
  ['Fire Orange', '#e0561c'], ['Guards Red', '#c4141c'], ['Toronto Red', '#8f1018'], ['Portimão Blue', '#1d5cc0'],
  ['Shark Blue', '#1f86d6'], ['Ascari Blue', '#1f3d8a'], ['Tanzanite Blue', '#1d2a4b'], ['Ruby Star', '#7a1d4f']];
const GARAGE_RIMS = [['stock', 'Stock'], ['m4', 'M Forged'], ['gt3', 'Centre-Lock'], ['alloy', 'Twin-Spoke'], ['mesh', 'Mesh'], ['five', 'Five-Spoke']];
const GARAGE_RIM_COLORS = [['Silver', '#c4c9cf'], ['Gunmetal', '#4a4f56'], ['Anthracite', '#2b2d31'], ['Satin Black', '#1d1f22'], ['Bronze', '#9c7a4c'], ['Gold', '#b8924e'], ['White', '#e9ebec'], ['Red', '#b31b20']];
const GARAGE_CALIPERS = [['Red', '#c8161d'], ['Yellow', '#f2c12e'], ['Blue', '#1f5fd1'], ['Black', '#1b1c1f'], ['Silver', '#a9aeb4'], ['Green', '#2e9b4d'], ['Orange', '#e8621c']];

const Garage = (() => {
  const $ = id => document.getElementById(id);
  const scr = $('scrGarage');
  let yaw = 0.9, lastDrag = -1e9, dragging = null, open = false;

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

  // the cars (the picker is hidden while there's only one)
  const cars = $('gCars');
  cars.classList.toggle('hidden', PLAYER_CAR_KEYS.length < 2);
  for (const k of PLAYER_CAR_KEYS) {
    const b = document.createElement('button'); b.className = 'gCar'; b.dataset.k = k;
    const [make, ...model] = PLAYER_CARS[k].name.split(' ');
    b.innerHTML = `<small>${make.toUpperCase()}</small><b>${model.join(' ').toUpperCase()}</b>`;
    b.onclick = () => { installCar(k); refresh(); };
    cars.appendChild(b);
  }
  // wheels
  const rims = $('gRims');
  for (const [k, n] of GARAGE_RIMS) {
    const b = document.createElement('button'); b.className = 'gRim'; b.dataset.k = k; b.textContent = n;
    b.onclick = () => { setCarCfg({ rim: k }); refresh(); };
    rims.appendChild(b);
  }
  const marks = [
    swatches($('gPaint'), GARAGE_PAINTS, () => carCfg().color, c => setCarCfg({ color: c })),
    swatches($('gRimCol'), GARAGE_RIM_COLORS, () => carCfg().rimColor, c => setCarCfg({ rimColor: c })),
    swatches($('gCaliper'), GARAGE_CALIPERS, () => carCfg().caliper, c => setCarCfg({ caliper: c })),
    seg($('gFinish'), () => carCfg().finish, v => setCarCfg({ finish: v })),
    seg($('gTint'), () => carCfg().tint, v => setCarCfg({ tint: v })),
  ];
  const pick = $('gPaintPick'), note = scr.querySelector('.gNote');
  pick.addEventListener('input', () => { setCarCfg({ color: pick.value }); refresh(); });
  function refresh() {
    const c = carCfg();
    for (const b of cars.children) b.classList.toggle('sel', b.dataset.k === carKey);
    for (const b of rims.children) { b.classList.toggle('sel', b.dataset.k === c.rim); if (b.dataset.k === 'stock') b.classList.toggle('hidden', !playerVis.M.wheelGeoms); }
    note.textContent = PLAYER_CAR_KEYS.length > 1 ? 'Every car drives the same: pick the one you like the look of.' : '';
    for (const m of marks) m();
    pick.value = c.color;
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
    shown(on) { open = on; if (on) refresh(); },
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
  };
})();
