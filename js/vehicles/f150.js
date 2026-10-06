'use strict';
// Ford F-150 - rounded "toy" style (see js/toykit.js): cab block + open bed block
(() => {
  registerVehicle({ key: 'f150', name: 'Ford F-150', cls: 'pickup', w: 6, mass: 2300, amax: 1.3, paint: 'car' }, () => {
    const gb = new GB(), r = 0.42, aF = 1.99, aR = -1.69;
    // cab + bonnet
    TOY.stack(gb, [
      { y: 0.5, w: 0.92, f: 2.86, r: -0.6, c: 0.35 },
      { y: 0.7, w: 1.0, f: 2.94, r: -0.62, c: 0.4 },        // chrome bumper band
      { y: 0.82, w: 1.01, f: 2.95, r: -0.62, c: 0.42 },
      { y: 1.24, w: 1.0, f: 2.92, r: -0.62, c: 0.42 },
      { y: 1.34, w: 0.95, f: 2.8, r: -0.62, c: 0.4 },       // square shoulder
      { y: 1.38, w: 0.9, f: 1.25, r: -0.62, c: 0.32 },      // power-dome bonnet top
      { y: 1.88, w: 0.84, f: 0.62, r: -0.56, c: 0.24 },     // crew cab glass
      { y: 1.96, w: 0.76, f: 0.5, r: -0.5, c: 0.2 },        // roof
    ], (seg, part) => {
      if (seg === 0) return 'T';
      if (seg === 1) return part === 'side' ? 'P' : 'C';
      if (seg === 5) return part === 'rear' || part === 'rcorner' ? 'P' : 'G';
      return 'P';
    });
    // bed: outer box with rounded corners, then a dark inset for the open load floor
    TOY.stack(gb, [
      { y: 0.5, w: 0.92, f: -0.66, r: -2.9, c: 0.3 },
      { y: 0.72, w: 1.0, f: -0.66, r: -2.95, c: 0.32 },
      { y: 1.36, w: 1.0, f: -0.66, r: -2.95, c: 0.32 },
    ], (seg, part) => (seg === 0 ? 'T' : part === 'rear' || part === 'rcorner' ? 'P' : 'P'));
    TOY.box(gb, 0, 1.365, -1.8, 1.76, 0.02, 2.1, 'D', false);                 // open bed floor (seen from above)
    // big grille + C-clamp lamps, ambers
    TOY.box(gb, 0, 1.02, 2.95, 1.26, 0.38, 0.06, 'D', false);
    for (const y of [0.92, 1.1]) TOY.box(gb, 0, y, 2.98, 1.2, 0.05, 0.03, 'C', false);
    TOY.box(gb, 0.76, 1.16, 2.92, 0.26, 0.1, 0.08, 'H');
    TOY.box(gb, 0.86, 1.02, 2.92, 0.08, 0.24, 0.08, 'H');
    TOY.box(gb, 0.94, 0.88, 2.8, 0.1, 0.07, 0.1, 'A', true, 0, -0.9);
    // rear: vertical tail lamps on the bed corners, ambers, plate, step bumper
    TOY.box(gb, 0.88, 1.08, -2.96, 0.14, 0.34, 0.06, 'L');
    TOY.box(gb, 0.88, 0.86, -2.96, 0.14, 0.07, 0.06, 'A');
    TOY.box(gb, 0, 0.64, -2.97, 0.4, 0.12, 0.03, 'K', false);
    TOY.box(gb, 0, 0.56, -2.98, 1.9, 0.14, 0.1, 'C', false);
    // tow mirrors
    TOY.box(gb, 1.12, 1.48, 0.55, 0.18, 0.24, 0.1, 'T');
    return LP.finish({ key: 'f150', gb, W: 1.01, front: 2.97, rear: -3.0, r, tyreW: 0.28, track: 0.9, axles: [aF, aR], wheel: TOY.wheel(r, 0.28) });
  });
})();
