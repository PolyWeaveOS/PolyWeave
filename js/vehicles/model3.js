'use strict';
// Tesla Model 3 - low-poly
(() => {
  registerVehicle({ key: 'model3', name: 'Tesla Model 3', cls: 'car', w: 6, mass: 1700, amax: 1.6, paint: 'car' }, () => {
    const gb = new GB(), W = 0.925, h = 2.345, aF = 1.43, aR = -1.445, r = 0.34;
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.84], [2.1, 0.96], [1.6, 1], [-1.8, 1], [-2.2, 0.95], [-h, 0.88]],
      bot:  [[h, 0.24], [2.1, 0.16], [-2.2, 0.17], [-h, 0.3]],
      botX: 0.87, lowX: 0.96,
      low:  [[h, 0.32], [2.1, 0.3], [-2.2, 0.32], [-h, 0.4]],
      sh:   [[h, 0.5], [2.1, 0.64], [1.43, 0.76], [0.6, 0.78], [-1.45, 0.8], [-2.2, 0.8], [-h, 0.72]],
      belt: [[h, 0.56], [2.1, 0.72], [1.5, 0.8], [0.75, 0.86], [-0.9, 0.92], [-1.75, 0.96], [-2.2, 0.98], [-h, 0.94]],
      beltX:[[h, 0.92], [0.75, 0.94], [-h, 0.93]],
      edge: [[h, 0.58], [2.1, 0.75], [1.5, 0.82], [0.75, 0.88], [0.1, 1.38], [-0.7, 1.4], [-1.75, 1.0], [-2.2, 1.0], [-h, 0.96]],
      edgeX:[[h, 0.64], [2.1, 0.72], [0.75, 0.74], [0.1, 0.66], [-0.7, 0.66], [-1.75, 0.8], [-h, 0.8]],
      top:  [[h, 0.6], [2.1, 0.78], [1.5, 0.85], [0.75, 0.9], [0.1, 1.443], [-0.7, 1.443], [-1.75, 1.03], [-2.2, 1.03], [-h, 0.98]],
    });
    const B = LP.body(gb, {
      st: [h, 2.1, 1.75, 0.75, 0.1, -0.3, -0.7, -1.75, -2.2, -h],
      ring,
      arches: [{ f: aF, r: 0.46, top: 0.72 }, { f: aR, r: 0.46, top: 0.72 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return f > 2.1 || f < -2.2 ? 'T' : 'P';
        if (k === 4 && f > 2.1) return 'H';                     // big teardrop headlights...
        if (k === 3 && f > 2.1) return 'T';                     // ...with a dark lamp housing under them
        if (k === 3 && f < -2.2) return 'L';
        if (k === 4 && f > -1.75 && f < 0.75) return 'G';       // side glass, black trim (no chrome)
        if (k === 5 && f > -1.75 && f < 0.75) return 'G';       // one-piece glass roof: windshield to rear window
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DTPPPP',
    });
    // no grille: just a thin low intake slot; amber in the lamp corners
    LP.capDecal(gb, h, true, [[-0.45, 0.25], [0.45, 0.25], [0.4, 0.33], [-0.4, 0.33]], 'D');
    LP.capDecal(gb, h, true, [[0.58, 0.46], [0.7, 0.48], [0.7, 0.52], [0.58, 0.51]], 'A', 0.006, true);
    // rear: wrap tail lamps, amber, plate, black diffuser
    LP.capDecal(gb, -h, false, [[0.45, 0.82], [0.8, 0.8], [0.8, 0.88], [0.45, 0.9]], 'L', 0.006, true);
    LP.capDecal(gb, -h, false, [[0.66, 0.76], [0.8, 0.75], [0.8, 0.79], [0.66, 0.79]], 'A', 0.006, true);
    LP.capDecal(gb, -h, false, [[-0.25, 0.58], [0.25, 0.58], [0.25, 0.7], [-0.25, 0.7]], 'K');
    LP.capDecal(gb, -h, false, [[-0.75, 0.32], [0.75, 0.32], [0.7, 0.42], [-0.7, 0.42]], 'T');
    LP.box(gb, 0, 1.0, -2.3, 0.9, 0.025, 0.1, 'P', false, 0.25);                 // small trunk lip
    LP.box(gb, 0.97, 0.97, 0.66, 0.13, 0.09, 0.1, 'P');
    LP.box(gb, 0.9, 0.94, 0.64, 0.08, 0.035, 0.05, 'T');
    return LP.finish({ key: 'model3', gb, W, front: B.front, rear: B.rear, r, tyreW: 0.235, axles: [aF, aR],
      wheel: LP.wheel(r, 0.235, { spokes: 0, rim: 0.7, dish: 'M', hub: 'D' }) });   // smooth aero covers
  });
})();
