'use strict';
// Honda Odyssey minivan (5th gen) - low-poly
(() => {
  registerVehicle({ key: 'odyssey', name: 'Honda Odyssey', cls: 'van', w: 4, mass: 2000, amax: 1.4, paint: 'car' }, () => {
    const gb = new GB(), W = 0.995, h = 2.58, aF = 1.63, aR = -1.37, r = 0.36;
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.88], [2.35, 0.97], [1.9, 1], [-2.3, 1], [-2.48, 0.97], [-h, 0.94]],
      bot:  [[h, 0.28], [2.35, 0.2], [-2.4, 0.22], [-h, 0.32]],
      botX: 0.9, lowX: 0.98,
      low:  [[h, 0.38], [2.35, 0.38], [-h, 0.42]],
      sh:   [[h, 0.66], [2.35, 0.76], [1.63, 0.84], [-1.37, 0.88], [-h, 0.86]],
      // the "lightning bolt": belt steps DOWN under the rear quarter window
      belt: [[h, 0.72], [2.35, 0.84], [1.55, 0.94], [0.9, 1.0], [-1.3, 1.08], [-1.5, 0.98], [-2.4, 1.0], [-h, 0.98]],
      beltX:[[h, 0.9], [0.9, 0.95], [-h, 0.95]],
      edge: [[h, 0.74], [2.35, 0.87], [1.55, 0.97], [0.85, 1.66], [-2.3, 1.66], [-2.48, 1.5], [-h, 1.36]],
      edgeX:[[h, 0.66], [2.35, 0.72], [1.55, 0.78], [0.85, 0.82], [-2.3, 0.84], [-h, 0.84]],
      top:  [[h, 0.76], [2.35, 0.9], [1.55, 1.0], [0.85, 1.74], [-2.3, 1.74], [-2.48, 1.55], [-h, 1.4]],
    });
    const B = LP.body(gb, {
      st: [h, 2.35, 2.0, 1.55, 0.85, -0.1, -0.2, -1.3, -1.5, -2.3, -2.48, -h],
      ring,
      arches: [{ f: aF, r: 0.49, top: 0.8 }, { f: aR, r: 0.49, top: 0.8 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return f > 2.35 || f < -2.48 ? 'T' : 'P';
        if (k === 4 && f > 2.35) return 'H';
        if (k === 3 && f > 2.35) return 'T';
        if (k === 3 && f < -2.48) return 'L';
        if (k === 4 && ((f > -0.2 && f < -0.1) || (f > -1.5 && f < -1.3))) return 'T';
        if (k === 4 && f > -2.3 && f < 0.85) return 'G';         // big glass area
        if (k === 5 && f > 0.85 && f < 1.55) return 'G';
        if (k === 5 && f > -2.48 && f < -2.3) return 'G';
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DTPPPP',
    });
    // chrome wing bar between the headlights, lower grille, ambers
    LP.capDecal(gb, h, true, [[-0.62, 0.66], [0.62, 0.66], [0.62, 0.7], [-0.62, 0.7]], 'C', 0.008);
    LP.capDecal(gb, h, true, [[-0.45, 0.32], [0.45, 0.32], [0.5, 0.6], [-0.5, 0.6]], 'D');
    LP.capDecal(gb, h, true, [[0.66, 0.62], [0.8, 0.64], [0.8, 0.68], [0.66, 0.67]], 'A', 0.006, true);
    // upright tailgate: horizontal tails + chrome bar, big rear glass, plate
    LP.capDecal(gb, -h, false, [[-0.62, 1.0], [0.62, 1.0], [0.62, 1.03], [-0.62, 1.03]], 'C', 0.008);
    LP.capDecal(gb, -h, false, [[0.6, 0.96], [0.86, 0.96], [0.86, 1.06], [0.6, 1.06]], 'L', 0.01, true);
    LP.capDecal(gb, -h, false, [[0.72, 0.9], [0.86, 0.9], [0.86, 0.95], [0.72, 0.95]], 'A', 0.006, true);
    LP.capDecal(gb, -h, false, [[-0.25, 0.68], [0.25, 0.68], [0.25, 0.8], [-0.25, 0.8]], 'K');
    LP.box(gb, 0.995, 1.04, -1.4, 0.02, 0.03, 1.2, 'C');                           // sliding-door track
    LP.box(gb, 1.05, 1.04, 1.4, 0.14, 0.11, 0.1, 'P');
    return LP.finish({ key: 'odyssey', gb, W, front: B.front, rear: B.rear, r, tyreW: 0.235, axles: [aF, aR], wheel: LP.wheel(r, 0.235, { spokes: 5 }) });
  });
})();
