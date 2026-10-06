'use strict';
// Toyota Camry - rounded "toy" style (see js/toykit.js)
(() => {
  registerVehicle({ key: 'camry', name: 'Toyota Camry', cls: 'car', w: 9, mass: 1550, amax: 1.5, paint: 'car' }, () => {
    const gb = new GB(), r = 0.33, aF = 1.47, aR = -1.36;
    TOY.stack(gb, [
      { y: 0.38, w: 0.84, f: 2.3, r: -2.32, c: 0.5 },
      { y: 0.5, w: 0.92, f: 2.43, r: -2.44, c: 0.6 },       // bumper line (black)
      { y: 0.56, w: 0.93, f: 2.44, r: -2.45, c: 0.62 },
      { y: 0.74, w: 0.92, f: 2.38, r: -2.42, c: 0.62 },
      { y: 0.84, w: 0.86, f: 2.2, r: -2.32, c: 0.6 },       // rounded shoulder
      { y: 0.9, w: 0.79, f: 0.9, r: -1.52, c: 0.45 },       // hood + trunk lids
      { y: 1.3, w: 0.69, f: 0.28, r: -0.95, c: 0.38 },      // glasshouse
      { y: 1.43, w: 0.57, f: 0.05, r: -0.72, c: 0.32 },     // crowned roof
    ], (seg, part) => {
      if (seg === 1) return part === 'side' ? 'P' : 'T';     // black bumpers wrapping the corners
      if (seg === 5) return part === 'rcorner' ? 'P' : 'G';  // windows (paint C-pillars)
      return 'P';
    });
    // front: grille, headlights, ambers
    TOY.box(gb, 0, 0.64, 2.43, 0.72, 0.13, 0.06, 'D', false);
    TOY.box(gb, 0.55, 0.69, 2.36, 0.4, 0.1, 0.1, 'H', true, 0, -0.35);
    TOY.box(gb, 0.82, 0.6, 2.25, 0.14, 0.06, 0.1, 'A', true, 0, -0.9);
    // rear: tail lamps, ambers, plate
    TOY.box(gb, 0.58, 0.7, -2.39, 0.46, 0.11, 0.08, 'L', true, 0, 0.3);
    TOY.box(gb, 0.84, 0.61, -2.27, 0.12, 0.06, 0.1, 'A', true, 0, 0.9);
    TOY.box(gb, 0, 0.62, -2.45, 0.42, 0.11, 0.03, 'K', false);
    // mirrors
    TOY.box(gb, 0.96, 0.98, 0.72, 0.13, 0.09, 0.12, 'P');
    return LP.finish({ key: 'camry', gb, W: 0.93, front: 2.45, rear: -2.46, r, tyreW: 0.25, track: 0.85, axles: [aF, aR], wheel: TOY.wheel(r, 0.24) });
  });
})();
