'use strict';
// Nissan GT-R (R35) - low-poly
(() => {
  registerVehicle({ key: 'gtr', name: 'Nissan GT-R (R35)', cls: 'car', w: 1.5, mass: 1750, amax: 1.9, paint: 'car' }, () => {
    const gb = new GB(), W = 0.947, h = 2.355, aF = 1.39, aR = -1.39, r = 0.35;
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.86], [2.15, 0.97], [1.6, 1], [-1.9, 1], [-2.25, 0.97], [-h, 0.9]],
      bot:  [[h, 0.2], [2.15, 0.14], [-2.2, 0.16], [-h, 0.28]],
      botX: 0.86, lowX: 0.95,   // lower body tucks in under the shoulder crease
      low:  [[h, 0.3], [2.15, 0.3], [-2.2, 0.32], [-h, 0.38]],
      sh:   [[h, 0.56], [2.15, 0.66], [1.39, 0.84], [0.7, 0.84], [-1.39, 0.88], [-2.25, 0.86], [-h, 0.72]],
      // hood: raised fender crests (belt) either side of a lower hood with a centre ridge
      belt: [[h, 0.63], [2.15, 0.78], [1.85, 0.86], [0.7, 0.93], [0.15, 0.95], [-0.6, 0.97], [-1.75, 1.0], [-2.25, 0.99], [-h, 0.95]],
      beltX:[[h, 0.92], [0.7, 0.93], [0.15, 0.9], [-1.75, 0.93], [-h, 0.92]],
      edge: [[h, 0.62], [2.15, 0.76], [1.85, 0.82], [0.7, 0.9], [0.15, 1.31], [-0.6, 1.33], [-1.75, 1.03], [-2.25, 1.02], [-h, 0.97]],
      edgeX:[[h, 0.66], [2.15, 0.7], [0.7, 0.68], [0.15, 0.64], [-0.6, 0.64], [-1.75, 0.8], [-h, 0.8]],
      top:  [[h, 0.66], [2.15, 0.8], [1.85, 0.86], [0.7, 0.94], [0.15, 1.37], [-0.6, 1.37], [-1.75, 1.05], [-2.25, 1.04], [-h, 0.98]],
    });
    const B = LP.body(gb, {
      st: [h, 2.15, 1.85, 0.7, 0.15, -0.6, -1.75, -2.25, -h],
      ring,
      arches: [{ f: aF, r: 0.47, top: 0.77 }, { f: aR, r: 0.47, top: 0.77 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return 'T';
        if (k === 4 && f > 2.15) return 'H';               // swept headlights on the nose corners
        if (k === 3 && f > 2.15) return 'T';               // dark lamp housing
        if (k === 4 && f > -0.6 && f < 0.15) return 'G';    // side windows
        if (k === 4 && f > 0.15 && f < 0.7) return 'G';     // front quarter glass
        if (k === 5 && f > 0.15 && f < 0.7) return 'G';     // windshield
        if (k === 5 && f > -1.75 && f < -0.6) return 'G';   // fastback rear glass
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DTPPPP',
    });
    // front: big dark trapezoid grille, lower intakes, amber corner lamps
    LP.capDecal(gb, h, true, [[-0.42, 0.26], [0.42, 0.26], [0.36, 0.56], [-0.36, 0.56]], 'D');
    LP.capDecal(gb, h, true, [[0.55, 0.3], [0.7, 0.32], [0.7, 0.42], [0.55, 0.42]], 'A', 0.006, true);
    // rear: four round-ish tail lamps, diffuser, plate
    for (const x of [0.5, 0.72]) LP.capDecal(gb, -h, false, [[x - 0.07, 0.82], [x, 0.78], [x + 0.07, 0.82], [x + 0.07, 0.88], [x, 0.92], [x - 0.07, 0.88]], 'L', 0.006, true);
    LP.capDecal(gb, -h, false, [[0.3, 0.84], [0.38, 0.84], [0.38, 0.88], [0.3, 0.88]], 'A', 0.006, true);
    LP.capDecal(gb, -h, false, [[-0.25, 0.55], [0.25, 0.55], [0.25, 0.67], [-0.25, 0.67]], 'K');
    LP.capDecal(gb, -h, false, [[-0.7, 0.3], [0.7, 0.3], [0.62, 0.42], [-0.62, 0.42]], 'D');
    // wing, mirrors
    LP.box(gb, 0, 1.17, -2.12, 1.7, 0.04, 0.26, 'P', false, 0.12);
    LP.box(gb, 0.6, 1.08, -2.12, 0.05, 0.14, 0.12, 'P');
    LP.box(gb, 1.0, 0.98, 0.62, 0.16, 0.09, 0.12, 'P');
    LP.box(gb, 0.92, 0.95, 0.6, 0.08, 0.04, 0.06, 'T');
    return LP.finish({ key: 'gtr', gb, W, front: B.front, rear: B.rear, r, tyreW: 0.26, axles: [aF, aR], wheel: LP.wheel(r, 0.26, { spokes: 6 }) });
  });
})();
