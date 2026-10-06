'use strict';
// Volkswagen Golf (Mk8) hatchback - low-poly
(() => {
  registerVehicle({ key: 'golf', name: 'Volkswagen Golf', cls: 'car', w: 6, mass: 1300, amax: 1.5, paint: 'car' }, () => {
    const gb = new GB(), W = 0.895, h = 2.14, aF = 1.26, aR = -1.36, r = 0.32;
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.87], [1.95, 0.97], [1.5, 1], [-1.8, 1], [-2.0, 0.97], [-h, 0.93]],
      bot:  [[h, 0.24], [1.95, 0.16], [-2.0, 0.18], [-h, 0.28]],
      botX: 0.88, lowX: 0.97,
      low:  [[h, 0.32], [1.95, 0.32], [-2.0, 0.34], [-h, 0.38]],
      sh:   [[h, 0.58], [1.95, 0.68], [1.26, 0.76], [-1.36, 0.82], [-2.0, 0.82], [-h, 0.74]],
      belt: [[h, 0.64], [1.95, 0.76], [1.4, 0.84], [0.75, 0.9], [-1.25, 0.96], [-1.95, 1.02], [-h, 1.0]],
      beltX:[[h, 0.9], [0.75, 0.95], [-h, 0.94]],
      edge: [[h, 0.66], [1.95, 0.79], [1.4, 0.86], [0.75, 0.92], [0.15, 1.4], [-1.55, 1.4], [-1.95, 1.1], [-h, 1.04]],
      edgeX:[[h, 0.66], [1.95, 0.72], [0.75, 0.76], [0.15, 0.7], [-1.55, 0.72], [-1.95, 0.8], [-h, 0.82]],
      top:  [[h, 0.68], [1.95, 0.81], [1.4, 0.88], [0.75, 0.94], [0.15, 1.46], [-1.55, 1.46], [-1.95, 1.13], [-h, 1.06]],
    });
    const B = LP.body(gb, {
      st: [h, 1.95, 1.65, 0.75, 0.15, -0.3, -0.4, -1.25, -1.55, -1.95, -h],
      ring,
      arches: [{ f: aF, r: 0.44, top: 0.7 }, { f: aR, r: 0.44, top: 0.7 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return f > 1.95 || f < -2.0 ? 'T' : 'P';
        if (k === 4 && f > 1.95) return 'H';                       // slim LED headlights
        if (k === 3 && f > 1.95) return 'T';
        if (k === 3 && f < -1.95) return 'L';
        if (k === 4 && f > -0.4 && f < -0.3) return 'T';           // B-pillar
        if (k === 4 && f > -1.25 && f < 0.75) return 'G';          // side glass ends early: THICK C-pillar
        if (k === 5 && f > 0.15 && f < 0.75) return 'G';
        if (k === 5 && f > -1.95 && f < -1.55) return 'G';         // hatch glass
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DTPPPP',
    });
    // thin light bar joining the headlights, low black grille, ambers
    LP.capDecal(gb, h, true, [[-0.6, 0.6], [0.6, 0.6], [0.6, 0.62], [-0.6, 0.62]], 'R', 0.006);
    LP.capDecal(gb, h, true, [[-0.5, 0.26], [0.5, 0.26], [0.44, 0.44], [-0.44, 0.44]], 'D');
    LP.capDecal(gb, h, true, [[0.6, 0.48], [0.74, 0.5], [0.74, 0.55], [0.6, 0.54]], 'A', 0.006, true);
    // hatch: horizontal tails reaching into the tailgate, plate, roof spoiler
    LP.capDecal(gb, -h, false, [[0.38, 0.86], [0.84, 0.84], [0.84, 0.94], [0.38, 0.94]], 'L', 0.006, true);
    LP.capDecal(gb, -h, false, [[0.7, 0.79], [0.84, 0.79], [0.84, 0.83], [0.7, 0.83]], 'A', 0.006, true);
    LP.capDecal(gb, -h, false, [[-0.26, 0.6], [0.26, 0.6], [0.26, 0.72], [-0.26, 0.72]], 'K');
    LP.capDecal(gb, -h, false, [[-0.72, 0.3], [0.72, 0.3], [0.68, 0.4], [-0.68, 0.4]], 'T');
    LP.box(gb, 0, 1.43, -1.6, 1.1, 0.04, 0.22, 'P', false, -0.1);
    LP.box(gb, 0.95, 0.98, 0.66, 0.13, 0.09, 0.1, 'P');
    return LP.finish({ key: 'golf', gb, W, front: B.front, rear: B.rear, r, tyreW: 0.225, axles: [aF, aR], wheel: LP.wheel(r, 0.225, { spokes: 5 }) });
  });
})();
