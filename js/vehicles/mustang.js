'use strict';
// Ford Mustang GT fastback (S550) - low-poly
(() => {
  registerVehicle({ key: 'mustang', name: 'Ford Mustang', cls: 'car', w: 3, mass: 1700, amax: 1.8, paint: 'car' }, () => {
    const gb = new GB(), W = 0.96, h = 2.395, aF = 1.45, aR = -1.27, r = 0.35;
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.84], [2.15, 0.95], [1.6, 0.98], [0.3, 0.97], [-1.27, 1], [-2.2, 0.97], [-h, 0.9]],
      bot:  [[h, 0.22], [2.15, 0.15], [-2.2, 0.17], [-h, 0.28]],
      botX: 0.86, lowX: 0.95,
      low:  [[h, 0.3], [2.15, 0.3], [-2.2, 0.33], [-h, 0.38]],
      sh:   [[h, 0.6], [2.15, 0.7], [1.45, 0.78], [0.5, 0.78], [-1.27, 0.84], [-2.2, 0.84], [-h, 0.74]],
      belt: [[h, 0.66], [2.15, 0.78], [1.6, 0.84], [0.55, 0.88], [-0.6, 0.92], [-1.85, 0.97], [-2.2, 0.98], [-h, 0.95]],
      beltX:[[h, 0.9], [0.55, 0.92], [-h, 0.92]],
      edge: [[h, 0.66], [2.15, 0.79], [1.6, 0.84], [0.55, 0.88], [-0.05, 1.32], [-0.6, 1.33], [-1.85, 0.99], [-2.2, 1.0], [-h, 0.96]],
      edgeX:[[h, 0.6], [2.15, 0.64], [0.55, 0.68], [-0.05, 0.64], [-0.6, 0.64], [-1.85, 0.8], [-h, 0.8]],
      top:  [[h, 0.7], [2.15, 0.84], [1.6, 0.9], [1.1, 0.92], [0.55, 0.91], [-0.05, 1.38], [-0.6, 1.38], [-1.85, 1.02], [-2.2, 1.02], [-h, 0.98]],
    });
    const B = LP.body(gb, {
      st: [h, 2.15, 1.6, 1.1, 0.55, -0.05, -0.6, -1.85, -2.2, -h],
      ring,
      arches: [{ f: aF, r: 0.47, top: 0.76 }, { f: aR, r: 0.47, top: 0.76 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return f > 2.15 || f < -2.2 ? 'T' : 'P';
        if (k === 4 && f > 2.15) return 'H';                     // angular headlights
        if (k === 3 && f > 2.15) return 'T';
        if (k === 4 && f > -1.85 && f < 0.55) return 'G';        // small fastback side glass
        if (k === 5 && f > -0.05 && f < 0.55) return 'G';
        if (k === 5 && f > -1.85 && f < -0.6) return 'G';
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DTPPPP',
    });
    // forward-leaning shark-nose trapezoid grille + ambers
    LP.capDecal(gb, h, true, [[-0.5, 0.3], [0.5, 0.3], [0.58, 0.62], [-0.58, 0.62]], 'D');
    LP.capDecal(gb, h, true, [[0.66, 0.58], [0.78, 0.6], [0.78, 0.64], [0.66, 0.63]], 'A', 0.006, true);
    // the iconic three vertical tail-lamp bars per side in a black panel
    LP.capDecal(gb, -h, false, [[-0.82, 0.74], [0.82, 0.74], [0.82, 0.92], [-0.82, 0.92]], 'D');
    for (const x of [0.5, 0.6, 0.7]) LP.capDecal(gb, -h, false, [[x - 0.035, 0.76], [x + 0.035, 0.76], [x + 0.035, 0.9], [x - 0.035, 0.9]], 'L', 0.012, true);
    LP.capDecal(gb, -h, false, [[0.76, 0.76], [0.81, 0.76], [0.81, 0.9], [0.76, 0.9]], 'A', 0.012, true);
    LP.capDecal(gb, -h, false, [[-0.24, 0.6], [0.24, 0.6], [0.24, 0.71], [-0.24, 0.71]], 'K');
    LP.capDecal(gb, -h, false, [[-0.78, 0.28], [0.78, 0.28], [0.74, 0.4], [-0.74, 0.4]], 'T');
    for (const x of [0.5, 0.62]) LP.box(gb, x, 0.3, -h - 0.04, 0.09, 0.08, 0.1, 'C');     // quad exhaust
    LP.box(gb, 0.24, 0.93, 1.3, 0.16, 0.03, 0.4, 'T');                                     // hood vents
    LP.box(gb, 1.0, 0.96, 0.45, 0.14, 0.09, 0.1, 'P');
    return LP.finish({ key: 'mustang', gb, W, front: B.front, rear: B.rear, r, tyreW: 0.255, axles: [aF, aR], wheel: LP.wheel(r, 0.255, { spokes: 5 }) });
  });
})();
