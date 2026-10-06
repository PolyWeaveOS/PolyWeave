'use strict';
// Toyota Prius (4th gen) - low-poly
(() => {
  registerVehicle({ key: 'prius', name: 'Toyota Prius', cls: 'car', w: 4, mass: 1400, amax: 1.3, paint: 'car' }, () => {
    const gb = new GB(), W = 0.88, h = 2.27, aF = 1.35, aR = -1.35, r = 0.315;
    // wedge: roof peaks forward, long sloping rear glass, high chopped Kamm tail
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.84], [2.05, 0.96], [1.5, 1], [-1.8, 1], [-2.15, 0.97], [-h, 0.93]],
      bot:  [[h, 0.24], [2.05, 0.15], [-2.1, 0.17], [-h, 0.3]],
      botX: 0.88, lowX: 0.97,
      low:  [[h, 0.32], [2.05, 0.3], [-2.1, 0.34], [-h, 0.4]],
      sh:   [[h, 0.56], [2.05, 0.66], [1.35, 0.74], [-1.35, 0.82], [-2.1, 0.86], [-h, 0.84]],
      belt: [[h, 0.62], [2.05, 0.74], [1.4, 0.82], [0.85, 0.87], [-0.8, 0.95], [-1.9, 1.02], [-h, 1.04]],
      beltX:[[h, 0.9], [0.85, 0.94], [-h, 0.94]],
      edge: [[h, 0.64], [2.05, 0.77], [1.4, 0.85], [0.9, 0.9], [0.05, 1.42], [-0.35, 1.42], [-1.95, 1.1], [-h, 1.08]],
      edgeX:[[h, 0.64], [2.05, 0.7], [0.9, 0.76], [0.05, 0.7], [-0.35, 0.7], [-1.95, 0.8], [-h, 0.82]],
      top:  [[h, 0.66], [2.05, 0.8], [1.4, 0.88], [0.9, 0.93], [0.05, 1.47], [-0.35, 1.47], [-1.95, 1.13], [-h, 1.1]],
    });
    const B = LP.body(gb, {
      st: [h, 2.05, 1.75, 0.9, 0.05, -0.35, -0.75, -0.85, -1.95, -2.1, -h],
      ring,
      arches: [{ f: aF, r: 0.43, top: 0.7 }, { f: aR, r: 0.43, top: 0.7 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return f > 2.05 || f < -2.1 ? 'T' : 'P';
        if (k === 4 && f > 2.05) return 'H';                     // sharp narrow headlights
        if (k === 3 && f > 2.05) return 'T';
        if (k === 3 && f < -1.95) return 'L';                    // tall boomerang tails down the corners
        if (k === 4 && f < -1.95) return 'L';
        if (k === 4 && f > -0.85 && f < -0.75) return 'T';
        if (k === 4 && f > -1.95 && f < 0.9) return 'G';
        if (k === 5 && f > 0.05 && f < 0.9) return 'G';          // long raked windshield
        if (k === 5 && f > -1.95 && f < -0.35) return 'G';       // long sloping rear glass
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DTPPPP',
    });
    // big triangular lower intakes + slim centre slot, ambers
    LP.capDecal(gb, h, true, [[-0.3, 0.27], [0.3, 0.27], [0.26, 0.36], [-0.26, 0.36]], 'D');
    LP.capDecal(gb, h, true, [[0.4, 0.26], [0.7, 0.26], [0.7, 0.5]], 'D', 0.006, true);
    LP.capDecal(gb, h, true, [[0.58, 0.54], [0.7, 0.55], [0.7, 0.6], [0.58, 0.59]], 'A', 0.006, true);
    // Kamm tail: split rear window (glass panel below the spoiler line), tails, plate
    LP.capDecal(gb, -h, false, [[-0.55, 0.9], [0.55, 0.9], [0.6, 1.02], [-0.6, 1.02]], 'G');
    LP.capDecal(gb, -h, false, [[0.66, 0.78], [0.8, 0.8], [0.8, 0.86], [0.66, 0.84]], 'A', 0.006, true);
    LP.capDecal(gb, -h, false, [[-0.25, 0.56], [0.25, 0.56], [0.25, 0.68], [-0.25, 0.68]], 'K');
    LP.box(gb, 0, 1.08, -2.12, 1.4, 0.03, 0.14, 'P', false, 0.15);
    LP.box(gb, 0.93, 0.96, 0.78, 0.13, 0.09, 0.1, 'P');
    return LP.finish({ key: 'prius', gb, W, front: B.front, rear: B.rear, r, tyreW: 0.215, axles: [aF, aR],
      wheel: LP.wheel(r, 0.215, { spokes: 10, spokeW: 0.12, rim: 0.66, dish: 'M', spokeSlot: 'D' }) });
  });
})();
