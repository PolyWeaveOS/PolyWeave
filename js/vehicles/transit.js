'use strict';
// Ford Transit high-roof cargo van - low-poly (no badges)
(() => {
  registerVehicle({ key: 'transit', name: 'Ford Transit van', cls: 'van', w: 4, mass: 2800, amax: 1.1, paint: 'truck' }, () => {
    const gb = new GB(), W = 1.015, h = 2.99, aF = 2.09, aR = -1.66, r = 0.36;
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.9], [2.75, 0.97], [2.3, 0.99], [1.6, 1], [-h, 1]],
      bot:  [[h, 0.36], [2.75, 0.3], [-2.9, 0.32], [-h, 0.4]],
      botX: 0.92, lowX: 0.99,
      low:  [[h, 0.5], [2.75, 0.52], [-h, 0.54]],
      sh:   [[h, 0.86], [2.75, 0.96], [2.3, 1.0], [1.6, 1.02], [-h, 1.04]],
      belt: [[h, 0.98], [2.75, 1.1], [2.3, 1.2], [1.6, 1.24], [-h, 1.26]],
      beltX:[[h, 0.9], [2.3, 0.94], [1.6, 0.98], [-h, 0.99]],
      edge: [[h, 1.02], [2.75, 1.14], [2.3, 1.24], [1.6, 2.55], [1.3, 2.68], [-h, 2.68]],
      edgeX:[[h, 0.7], [2.3, 0.78], [1.6, 0.92], [1.3, 0.95], [-h, 0.95]],
      top:  [[h, 1.05], [2.75, 1.18], [2.3, 1.28], [1.6, 2.65], [1.3, 2.77], [-h, 2.77]],
    });
    const B = LP.body(gb, {
      st: [h, 2.75, 2.3, 1.6, 1.3, 0.85, -2.85, -h],
      ring,
      arches: [{ f: aF, r: 0.5, top: 0.82 }, { f: aR, r: 0.5, top: 0.82 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return 'T';                                  // black lower bumpers / sills
        if (k === 3 && f > 2.75) return 'H';                      // big swept-back headlights
        if (k === 4 && f > 2.3 && f < 2.75) return 'H';
        if (k === 4 && f > 0.85 && f < 1.6) return 'G';           // cab door window only (windowless cargo box)
        if (k === 5 && f > 1.6 && f < 2.3) return 'G';           // raked windshield
        return 'P';
      },
      capF: 'DTPPPP', capR: 'TTPPPP',
    });
    // big trapezoid grille with three bars, ambers
    LP.capDecal(gb, h, true, [[-0.55, 0.52], [0.55, 0.52], [0.62, 0.92], [-0.62, 0.92]], 'D');
    for (const y of [0.62, 0.72, 0.82]) LP.capDecal(gb, h, true, [[-0.58, y], [0.58, y], [0.58, y + 0.035], [-0.58, y + 0.035]], 'C', 0.012);
    LP.capDecal(gb, h, true, [[0.68, 0.7], [0.82, 0.72], [0.82, 0.8], [0.68, 0.78]], 'A', 0.006, true);
    // rear: twin doors (centre seam + handles), tall vertical tail lamps in the corners, step bumper
    LP.capDecal(gb, -h, false, [[-0.01, 0.56], [0.01, 0.56], [0.01, 2.6], [-0.01, 2.6]], 'T');
    LP.capDecal(gb, -h, false, [[0.82, 0.62], [0.97, 0.62], [0.97, 1.2], [0.82, 1.2]], 'L', 0.006, true);
    LP.capDecal(gb, -h, false, [[0.82, 0.56], [0.97, 0.56], [0.97, 0.61], [0.82, 0.61]], 'A', 0.006, true);
    LP.capDecal(gb, -h, false, [[-0.15, 2.62], [0.15, 2.62], [0.15, 2.66], [-0.15, 2.66]], 'L');
    LP.capDecal(gb, -h, false, [[0.06, 1.2], [0.14, 1.2], [0.14, 1.24], [0.06, 1.24]], 'T', 0.01, true);
    // side rubbing strip, sliding-door track, mirrors
    LP.box(gb, 1.02, 0.78, -0.4, 0.02, 0.1, 4.6, 'T');
    LP.box(gb, 1.01, 1.55, -0.1, 0.02, 0.03, 1.5, 'T');
    LP.box(gb, 1.1, 1.5, 1.45, 0.14, 0.28, 0.08, 'T');
    return LP.finish({ key: 'transit', gb, W, front: h, rear: -h, r, tyreW: 0.235, axles: [aF, aR],
      wheel: LP.wheel(r, 0.235, { spokes: 0, rim: 0.6, dish: 'M', hub: 'D' }) });   // steel wheels
  });
})();
