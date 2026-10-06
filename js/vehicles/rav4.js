'use strict';
// Toyota RAV4 - rounded "toy" style (see js/toykit.js)
(() => {
  registerVehicle({ key: 'rav4', name: 'Toyota RAV4', cls: 'suv', w: 8, mass: 1700, amax: 1.4, paint: 'car' }, () => {
    const gb = new GB(), r = 0.37, aF = 1.37, aR = -1.32;
    TOY.stack(gb, [
      { y: 0.44, w: 0.86, f: 2.2, r: -2.2, c: 0.45 },
      { y: 0.62, w: 0.93, f: 2.3, r: -2.3, c: 0.5 },        // black cladding band
      { y: 0.74, w: 0.94, f: 2.31, r: -2.31, c: 0.52 },
      { y: 0.96, w: 0.93, f: 2.26, r: -2.3, c: 0.5 },
      { y: 1.06, w: 0.87, f: 2.08, r: -2.24, c: 0.48 },     // shoulder
      { y: 1.1, w: 0.82, f: 1.0, r: -2.18, c: 0.4 },        // bonnet top; tail stays tall
      { y: 1.6, w: 0.75, f: 0.42, r: -2.0, c: 0.34 },       // glasshouse
      { y: 1.69, w: 0.66, f: 0.25, r: -1.86, c: 0.28 },     // roof
    ], (seg, part) => {
      if (seg <= 1) return part === 'side' && seg === 1 ? 'T' : seg === 0 ? 'T' : 'T';   // black lower cladding
      if (seg === 5) return part === 'rcorner' ? 'P' : 'G';
      if (seg === 6) return 'T';                                                         // black roof edge
      return 'P';
    }, 'T');
    // two-tier grille, headlights, ambers
    TOY.box(gb, 0, 0.84, 2.3, 0.8, 0.22, 0.06, 'D', false);
    TOY.box(gb, 0, 1.0, 2.26, 0.5, 0.06, 0.06, 'D', false);
    TOY.box(gb, 0.58, 0.98, 2.22, 0.36, 0.09, 0.1, 'H', true, 0, -0.35);
    TOY.box(gb, 0.84, 0.88, 2.1, 0.12, 0.07, 0.1, 'A', true, 0, -0.9);
    // rear: tails, ambers, plate, roof rails, mirrors
    TOY.box(gb, 0.62, 1.0, -2.28, 0.4, 0.1, 0.08, 'L', true, 0, 0.3);
    TOY.box(gb, 0.86, 0.88, -2.16, 0.12, 0.07, 0.1, 'A', true, 0, 0.9);
    TOY.box(gb, 0, 0.88, -2.31, 0.42, 0.12, 0.03, 'K', false);
    TOY.box(gb, 0.52, 1.73, -0.8, 0.06, 0.06, 1.9, 'T');
    TOY.box(gb, 0.97, 1.18, 0.95, 0.14, 0.11, 0.12, 'T');
    return LP.finish({ key: 'rav4', gb, W: 0.94, front: 2.31, rear: -2.31, r, tyreW: 0.25, track: 0.86, axles: [aF, aR], wheel: TOY.wheel(r, 0.25) });
  });
})();
