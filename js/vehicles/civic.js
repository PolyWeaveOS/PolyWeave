'use strict';
// Honda Civic sedan (11th gen) - low-poly
(() => {
  registerVehicle({ key: 'civic', name: 'Honda Civic', cls: 'car', w: 9, mass: 1350, amax: 1.5, paint: 'car' }, () => {
    const gb = new GB(), W = 0.9, h = 2.335, aF = 1.4, aR = -1.335, r = 0.33;
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.86], [2.1, 0.97], [1.6, 1], [-1.8, 1], [-2.2, 0.96], [-h, 0.9]],
      bot:  [[h, 0.22], [2.1, 0.15], [-2.2, 0.17], [-h, 0.28]],
      botX: 0.87, lowX: 0.96,
      low:  [[h, 0.3], [2.1, 0.3], [-2.2, 0.33], [-h, 0.4]],
      sh:   [[h, 0.56], [2.1, 0.66], [1.4, 0.74], [0.7, 0.76], [-1.34, 0.8], [-2.2, 0.8], [-h, 0.72]],
      belt: [[h, 0.62], [2.1, 0.74], [1.5, 0.8], [0.7, 0.84], [-0.7, 0.88], [-1.85, 0.94], [-2.2, 0.96], [-h, 0.93]],
      beltX:[[h, 0.9], [0.7, 0.95], [-h, 0.93]],
      edge: [[h, 0.63], [2.1, 0.76], [1.5, 0.82], [0.7, 0.86], [0.0, 1.36], [-0.6, 1.37], [-1.85, 0.97], [-2.2, 0.98], [-h, 0.95]],
      edgeX:[[h, 0.66], [2.1, 0.72], [0.7, 0.74], [0.0, 0.66], [-0.6, 0.66], [-1.85, 0.8], [-h, 0.8]],
      top:  [[h, 0.65], [2.1, 0.79], [1.5, 0.85], [0.7, 0.88], [0.0, 1.415], [-0.6, 1.415], [-1.85, 1.0], [-2.2, 1.0], [-h, 0.96]],
    });
    const B = LP.body(gb, {
      st: [h, 2.1, 1.85, 0.7, 0.0, -0.1, -0.2, -0.6, -1.85, -2.2, -h],
      ring,
      arches: [{ f: aF, r: 0.45, top: 0.72 }, { f: aR, r: 0.45, top: 0.72 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return f > 2.1 || f < -2.2 ? 'T' : 'P';
        if (k === 4 && f > 2.1) return 'H';                     // thin horizontal headlights
        if (k === 3 && f > 2.1) return 'T';
        if (k === 3 && f < -2.2) return 'L';                    // slim C-shaped tails wrapping round
        if (k === 4 && f > -0.2 && f < -0.1) return 'T';        // B-pillar
        if (k === 4 && f > -1.85 && f < 0.7) return 'G';        // long low glasshouse
        if (k === 5 && f > 0.0 && f < 0.7) return 'G';
        if (k === 5 && f > -1.85 && f < -0.6) return 'G';       // fastback rear glass
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DTPPPP',
    });
    // hexagonal mesh grille, amber corners
    LP.capDecal(gb, h, true, [[-0.48, 0.3], [0.48, 0.3], [0.56, 0.42], [0.46, 0.54], [-0.46, 0.54], [-0.56, 0.42]], 'D');
    LP.capDecal(gb, h, true, [[0.62, 0.52], [0.74, 0.53], [0.74, 0.57], [0.62, 0.57]], 'A', 0.006, true);
    // rear: long thin tail bar across the lid, plate, black lower
    LP.capDecal(gb, -h, false, [[0.35, 0.83], [0.82, 0.8], [0.82, 0.86], [0.35, 0.88]], 'L', 0.006, true);
    LP.capDecal(gb, -h, false, [[0.7, 0.75], [0.82, 0.75], [0.82, 0.78], [0.7, 0.78]], 'A', 0.006, true);
    LP.capDecal(gb, -h, false, [[-0.25, 0.6], [0.25, 0.6], [0.25, 0.72], [-0.25, 0.72]], 'K');
    LP.capDecal(gb, -h, false, [[-0.72, 0.3], [0.72, 0.3], [0.68, 0.4], [-0.68, 0.4]], 'T');
    LP.box(gb, 0, 0.99, -2.24, 0.9, 0.025, 0.08, 'P', false, 0.25);                 // integrated lip
    LP.box(gb, 0.95, 0.94, 0.62, 0.13, 0.09, 0.1, 'T');                             // black mirrors
    return LP.finish({ key: 'civic', gb, W, front: B.front, rear: B.rear, r, tyreW: 0.235, axles: [aF, aR], wheel: LP.wheel(r, 0.235, { spokes: 5 }) });
  });
})();
