'use strict';
// Porsche 911 Carrera (992) - low-poly
(() => {
  registerVehicle({ key: 'p911', name: 'Porsche 911', cls: 'car', w: 1.5, mass: 1500, amax: 1.9, paint: 'car' }, () => {
    const gb = new GB(), W = 0.925, h = 2.26, aF = 1.33, aR = -1.12, r = 0.345;
    // teardrop: low front between raised fenders, roof sweeping in one line down to the tail, wide hips
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.82], [2.05, 0.92], [1.4, 0.95], [0.4, 0.94], [-0.9, 1], [-1.9, 0.99], [-h, 0.9]],
      bot:  [[h, 0.2], [2.05, 0.14], [-2.1, 0.16], [-h, 0.28]],
      botX: 0.86, lowX: 0.95,
      low:  [[h, 0.28], [2.05, 0.28], [-2.1, 0.32], [-h, 0.38]],
      sh:   [[h, 0.5], [2.05, 0.6], [1.33, 0.7], [0.5, 0.72], [-1.12, 0.78], [-2.0, 0.78], [-h, 0.68]],
      belt: [[h, 0.56], [2.05, 0.72], [1.6, 0.78], [0.7, 0.8], [-0.4, 0.84], [-1.2, 0.86], [-2.0, 0.86], [-h, 0.8]],
      beltX:[[h, 0.88], [1.6, 0.92], [0.7, 0.86], [-0.4, 0.84], [-1.2, 0.92], [-h, 0.9]],
      edge: [[h, 0.52], [2.05, 0.62], [1.6, 0.68], [0.75, 0.76], [0.15, 1.22], [-0.25, 1.24], [-1.0, 1.08], [-1.75, 0.92], [-h, 0.84]],
      edgeX:[[h, 0.56], [2.05, 0.54], [1.6, 0.56], [0.75, 0.64], [0.15, 0.62], [-0.25, 0.62], [-1.0, 0.68], [-1.75, 0.76], [-h, 0.78]],
      top:  [[h, 0.54], [2.05, 0.64], [1.6, 0.7], [0.75, 0.78], [0.15, 1.28], [-0.25, 1.3], [-1.0, 1.12], [-1.75, 0.95], [-h, 0.86]],
    });
    const B = LP.body(gb, {
      st: [h, 2.05, 1.6, 0.75, 0.15, -0.25, -1.0, -1.75, -2.1, -h],
      ring,
      arches: [{ f: aF, r: 0.46, top: 0.72 }, { f: aR, r: 0.46, top: 0.75 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return f > 2.05 || f < -2.1 ? 'T' : 'P';
        if (k === 4 && f > -0.85 && f < 0.75) return 'G';        // small side windows
        if (k === 5 && f > 0.15 && f < 0.75) return 'G';         // windshield
        if (k === 5 && f > -1.0 && f < -0.25) return 'G';        // rear window on the sloping roof
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DTPPPP',
    });
    // upright oval "frog-eye" headlights standing on the front fenders, facing forward
    // (8-sided pods sunk into the fender tops, tilted back with the bonnet line; lens on the front face)
    for (const sg of [1, -1]) {
      gb.geom(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 8), gb.xf(sg * 0.6, 0.77, -1.94, -Math.PI / 2 + 0.2, 0, 0), SLOT.PAINT);
      gb.geom(new THREE.CylinderGeometry(0.088, 0.088, 0.02, 8), gb.xf(sg * 0.6, 0.795, -2.075, -Math.PI / 2 + 0.2, 0, 0), SLOT.HEAD);
    }
    // no grille: three intakes in the bumper, ambers
    for (const [x, w] of [[0, 0.3], [0.58, 0.22]]) LP.capDecal(gb, h, true, [[x - w / 2, 0.24], [x + w / 2, 0.24], [x + w / 2, 0.36], [x - w / 2, 0.36]], 'D', 0.006, x !== 0);
    LP.capDecal(gb, h, true, [[0.5, 0.4], [0.68, 0.4], [0.68, 0.44], [0.5, 0.44]], 'A', 0.006, true);
    // rear: full-width light bar with slatted engine grille above it, small spoiler
    LP.capDecal(gb, -h, false, [[-0.78, 0.66], [0.78, 0.66], [0.78, 0.7], [-0.78, 0.7]], 'L');
    LP.capDecal(gb, -h, false, [[0.62, 0.62], [0.78, 0.62], [0.78, 0.65], [0.62, 0.65]], 'A', 0.006, true);
    for (let i = 0; i < 4; i++) { const y = 0.74 + i * 0.022; LP.capDecal(gb, -h, false, [[-0.4, y], [0.4, y], [0.4, y + 0.01], [-0.4, y + 0.01]], 'T', 0.008); }
    LP.capDecal(gb, -h, false, [[-0.24, 0.46], [0.24, 0.46], [0.24, 0.57], [-0.24, 0.57]], 'K');
    LP.box(gb, 0, 0.88, -2.05, 0.9, 0.02, 0.16, 'P', false, 0.2);
    for (const x of [0.25, 0.4]) LP.box(gb, x, 0.28, -h - 0.03, 0.1, 0.07, 0.08, 'C');
    LP.box(gb, 0.92, 0.9, 0.6, 0.13, 0.08, 0.1, 'P');
    return LP.finish({ key: 'p911', gb, W, front: B.front, rear: B.rear, r, tyreW: 0.27, axles: [aF, aR], wheel: LP.wheel(r, 0.27, { spokes: 5, spokeW: 0.3 }) });
  });
})();
