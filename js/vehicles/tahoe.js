'use strict';
// Chevrolet Tahoe (5th gen) - low-poly (no badges)
(() => {
  registerVehicle({ key: 'tahoe', name: 'Chevrolet Tahoe', cls: 'suv', w: 4, mass: 2600, amax: 1.2, paint: 'car' }, () => {
    const gb = new GB(), W = 1.03, h = 2.675, aF = 1.72, aR = -1.35, r = 0.41;
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.95], [2.5, 1], [-2.5, 1], [-h, 0.97]],
      bot:  [[h, 0.44], [2.5, 0.34], [-2.5, 0.36], [-h, 0.46]],
      botX: 0.92, lowX: 0.99,
      low:  [[h, 0.56], [2.5, 0.58], [-h, 0.6]],
      sh:   [[h, 1.0], [2.5, 1.08], [1.2, 1.12], [-h, 1.12]],
      belt: [[h, 1.18], [2.5, 1.26], [1.2, 1.3], [-h, 1.32]],
      beltX: 0.97,
      edge: [[h, 1.22], [2.5, 1.3], [1.2, 1.33], [0.5, 1.88], [-2.55, 1.88], [-h, 1.78]],
      edgeX:[[h, 0.84], [1.2, 0.86], [0.5, 0.86], [-h, 0.86]],
      top:  [[h, 1.26], [2.5, 1.33], [1.2, 1.36], [0.5, 1.93], [-2.55, 1.93], [-h, 1.82]],
    });
    const B = LP.body(gb, {
      st: [h, 2.5, 2.1, 1.2, 0.5, -0.25, -0.35, -1.2, -1.3, -2.55, -h],
      ring,
      arches: [{ f: aF, r: 0.56, top: 0.96 }, { f: aR, r: 0.56, top: 0.96 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return 'T';
        if (k === 4 && ((f > -0.35 && f < -0.25) || (f > -1.3 && f < -1.2))) return 'T';   // pillars
        if (k === 4 && f > -2.55 && f < 0.5) return 'G';                                    // long glasshouse
        if (k === 4 && f > 0.5 && f < 1.2) return 'T';
        if (k === 5 && f > 0.5 && f < 1.2) return 'G';
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DTPPPP',
    });
    // tall flat face: big grille split by a body-colour bar, thin LED strips above, main lamps low in the corners
    LP.capDecal(gb, h, true, [[-0.68, 0.62], [0.68, 0.62], [0.68, 1.12], [-0.68, 1.12]], 'D');
    LP.capDecal(gb, h, true, [[-0.68, 0.86], [0.68, 0.86], [0.68, 0.94], [-0.68, 0.94]], 'C', 0.012);
    LP.capDecal(gb, h, true, [[0.42, 1.14], [0.92, 1.14], [0.92, 1.19], [0.42, 1.19]], 'R', 0.006, true);
    LP.capDecal(gb, h, true, [[0.72, 0.9], [0.94, 0.9], [0.94, 1.08], [0.72, 1.08]], 'H', 0.006, true);
    LP.capDecal(gb, h, true, [[0.72, 0.82], [0.94, 0.82], [0.94, 0.88], [0.72, 0.88]], 'A', 0.006, true);
    LP.capDecal(gb, h, true, [[-0.95, 0.44], [0.95, 0.44], [0.95, 0.6], [-0.95, 0.6]], 'T', 0.02);
    // rear: tall vertical tails, plate, bumper
    LP.capDecal(gb, -h, false, [[0.8, 1.0], [0.97, 1.0], [0.97, 1.5], [0.8, 1.5]], 'L', 0.006, true);
    LP.capDecal(gb, -h, false, [[0.8, 0.92], [0.97, 0.92], [0.97, 0.99], [0.8, 0.99]], 'A', 0.006, true);
    LP.capDecal(gb, -h, false, [[-0.7, 1.4], [0.7, 1.4], [0.7, 1.72], [-0.7, 1.72]], 'G');
    LP.capDecal(gb, -h, false, [[-0.26, 0.86], [0.26, 0.86], [0.26, 0.98], [-0.26, 0.98]], 'K');
    LP.capDecal(gb, -h, false, [[-0.95, 0.46], [0.95, 0.46], [0.95, 0.62], [-0.95, 0.62]], 'T', 0.02);
    LP.box(gb, 0.68, 1.955, -0.9, 0.06, 0.05, 2.9, 'T');                          // roof rails
    LP.box(gb, 1.09, 1.36, 0.95, 0.16, 0.18, 0.1, 'T');
    return LP.finish({ key: 'tahoe', gb, W, front: h, rear: -h, r, tyreW: 0.275, axles: [aF, aR], wheel: LP.wheel(r, 0.275, { spokes: 6 }) });
  });
})();
