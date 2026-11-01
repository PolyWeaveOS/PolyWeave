'use strict';
// =====================================================================
//  The cars you can drive (Garage). For now only the BMW M4 Competition (built in models.js).
//  PLAYER_CARS: names, what each car comes with, where the driver sits (cockpit camera, wheel, door mirrors).
// =====================================================================

// names, what each car comes with, and where the driver sits (eye, steering column, cockpit shift)
const PLAYER_CARS = {
  m4: { name: 'BMW M4 Competition', short: 'M4 COMP', rim: 'm4', rimColor: '#9c7a4c', caliper: '#c8161d', color: '#a6b0b8',
    mirror: M4_MIRROR, eyeY: 1.13, eyeF: -0.32, sw: { y: 0.90, f: 0.40, rx: 0.36 }, cockpit: { dy: 0, df: 0 } },
  // the owners' drift car (owners: only for main.js BIKE_NAMES; its own physics in js/drift.js; just for fun, no stats)
  s15: { name: 'Nissan Silvia S15', short: 'S15', owners: true, rim: 'five', rimColor: '#e9ebec', caliper: '#c8161d', color: '#f0c419',
    mirror: S15_MIRROR, eyeY: 1.03, eyeF: -0.30, sw: { y: 0.82, f: 0.36, rx: 0.36 }, cockpit: { dy: -0.10, df: 0.0, sx: 0.92 } },
};
// The content cars (Film > Garage: owners + Content Creators, only inside the Film area - never in scored play, nothing
// counts in them but time played). Each is a real model used 1:1 (assets/<key>.js, js/models.js BIG_MODELS); drives
// like the M4 (looks only). `file: null`: its model file isn't in yet - shown as "model needed".
const CONTENT_SEAT = { mirror: S15_MIRROR, eyeY: 0.98, eyeF: -0.30, sw: { y: 0.78, f: 0.36, rx: 0.36 }, cockpit: { dy: -0.14, df: 0.0, sx: 0.94 } };
const CONTENT = (name, short, color, file, credit) => Object.assign({ name, short, content: true, file, credit, rim: 'stock', rimColor: '#16181c', caliper: '#c8161d', color }, CONTENT_SEAT);
Object.assign(PLAYER_CARS, {
  koenigsegg: CONTENT('Koenigsegg', 'KOENIGSEGG', '#121214', 'assets/koenigsegg.js?v=1'),   // (the owner's own model, from their .blend)
  // (the owner's model files, converted by tools/convert-car.js - configs in tools/cars/; credit: shown in the Film Garage)
  mclaren720s: CONTENT('McLaren 720S LB Works', '720S', '#e0561c', 'assets/mclaren720s.js?v=1', '"2017 McLaren 720s LB★WORKS" by Ddiaz Design · CC BY 4.0'),
  gt3: CONTENT('Porsche 911 GT3', '911 GT3', '#eef0ee', 'assets/gt3.js?v=1', '"2022 Porsche 911 GT3 (992)" by Ddiaz Design · CC BY 4.0'),
  imola: CONTENT('Pagani Imola Roadster', 'IMOLA', '#1d2a4b', 'assets/imola.js?v=1', '"2024 Pagani Imola Roadster" by Ddiaz Design · CC BY-NC-SA 4.0'),
  aventador: CONTENT('Lamborghini Aventador', 'AVENTADOR', '#4fbf3a', 'assets/aventador.js?v=1', '"Lamborghini Aventador" by BlackCube · CC BY 4.0'),
  laferrari: CONTENT('Ferrari LaFerrari', 'LAFERRARI', '#c4141c', 'assets/laferrari.js?v=1'),
  tourbillon: CONTENT('Bugatti Tourbillon', 'TOURBILLON', '#1f3d8a', 'assets/tourbillon.js?v=1', '"2026 Bugatti Tourbillon" by Ddiaz Design · CC BY-NC-SA 4.0'),
});
const PLAYER_CAR_KEYS = Object.keys(PLAYER_CARS);
const ROAD_CAR_KEYS = PLAYER_CAR_KEYS.filter(k => !PLAYER_CARS[k].content), CONTENT_CAR_KEYS = PLAYER_CAR_KEYS.filter(k => PLAYER_CARS[k].content);
