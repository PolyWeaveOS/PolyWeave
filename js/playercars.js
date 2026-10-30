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
  // the owner's own Koenigsegg model, 1:1 (owners + Content Creators; drives like the M4 - looks only for now; its own wheels)
  koenigsegg: { name: 'Koenigsegg', short: 'KOENIGSEGG', owners: true, rim: 'stock', rimColor: '#16181c', caliper: '#c8161d', color: '#121214',
    mirror: S15_MIRROR, eyeY: 0.98, eyeF: -0.30, sw: { y: 0.78, f: 0.36, rx: 0.36 }, cockpit: { dy: -0.14, df: 0.0, sx: 0.94 } },
};
const PLAYER_CAR_KEYS = Object.keys(PLAYER_CARS);
