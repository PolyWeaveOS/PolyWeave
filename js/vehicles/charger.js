'use strict';
// Dodge Charger (LD) - low-poly (no badges or lettering)
(() => {
  registerVehicle({ key: 'charger', name: 'Dodge Charger', cls: 'car', w: 3, mass: 1850, amax: 1.7, paint: 'car' }, () => {
    const gb = new GB(), W = 0.95, h = 2.55, aF = 1.6, aR = -1.45, r = 0.36;
    // big muscle sedan: long hood, high beltline, short glasshouse
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.9], [2.3, 0.98], [1.8, 1], [-2.0, 1], [-2.42, 0.97], [-h, 0.93]],
      bot:  [[h, 0.24], [2.3, 0.16], [-2.4, 0.18], [-h, 0.3]],
      botX: 0.88, lowX: 0.97,
      low:  [[h, 0.32], [2.3, 0.32], [-2.4, 0.35], [-h, 0.42]],
      sh:   [[h, 0.62], [2.3, 0.72], [1.6, 0.82], [0.85, 0.84], [-1.45, 0.88], [-2.42, 0.88], [-h, 0.8]],
      belt: [[h, 0.7], [2.3, 0.8], [1.6, 0.88], [0.85, 0.94], [-0.8, 1.0], [-1.75, 1.04], [-2.42, 1.06], [-h, 1.03]],
      beltX:[[h, 0.92], [0.85, 0.95], [-h, 0.94]],
      edge: [[h, 0.72], [2.3, 0.83], [1.6, 0.9], [0.85, 0.96], [0.15, 1.42], [-0.8, 1.43], [-1.75, 1.07], [-2.42, 1.08], [-h, 1.05]],
      edgeX:[[h, 0.7], [2.3, 0.74], [0.85, 0.76], [0.15, 0.68], [-0.8, 0.68], [-1.75, 0.82], [-h, 0.82]],
      top:  [[h, 0.74], [2.3, 0.86], [1.6, 0.94], [0.85, 0.98], [0.15, 1.48], [-0.8, 1.48], [-1.75, 1.1], [-2.42, 1.11], [-h, 1.08]],
    });
    const B = LP.body(gb, {
      st: [h, 2.3, 1.95, 0.85, 0.15, -0.3, -0.4, -0.8, -1.75, -2.42, -h],
      ring,
      arches: [{ f: aF, r: 0.49, top: 0.78 }, { f: aR, r: 0.49, top: 0.78 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return f > 2.3 || f < -2.42 ? 'T' : 'P';
        if (k === 4 && f > -0.4 && f < -0.3) return 'T';
        if (k === 4 && f > -1.75 && f < 0.85) return 'G';
        if (k === 5 && f > 0.15 && f < 0.85) return 'G';
        if (k === 5 && f > -1.75 && f < -0.8) return 'G';
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DTPPPP',
    });
    // wide low grille spanning the nose with the headlights in its ends, crosshair bar, ambers
    LP.capDecal(gb, h, true, [[-0.84, 0.5], [0.84, 0.5], [0.84, 0.68], [-0.84, 0.68]], 'D');
    LP.capDecal(gb, h, true, [[0.62, 0.53], [0.82, 0.53], [0.82, 0.65], [0.62, 0.65]], 'H', 0.01, true);
    LP.capDecal(gb, h, true, [[-0.55, 0.585], [0.55, 0.585], [0.55, 0.605], [-0.55, 0.605]], 'T', 0.012);
    LP.capDecal(gb, h, true, [[-0.012, 0.52], [0.012, 0.52], [0.012, 0.66], [-0.012, 0.66]], 'T', 0.012);
    LP.capDecal(gb, h, true, [[-0.6, 0.28], [0.6, 0.28], [0.55, 0.42], [-0.55, 0.42]], 'D');
    LP.capDecal(gb, h, true, [[0.66, 0.36], [0.8, 0.36], [0.8, 0.42], [0.66, 0.42]], 'A', 0.006, true);
    // the full-width "racetrack" tail light: a red ring running right across the rear
    LP.capDecal(gb, -h, false, [[-0.86, 0.84], [0.86, 0.84], [0.86, 0.98], [-0.86, 0.98]], 'D');
    for (const [y0, y1] of [[0.84, 0.87], [0.95, 0.98]]) LP.capDecal(gb, -h, false, [[-0.86, y0], [0.86, y0], [0.86, y1], [-0.86, y1]], 'L', 0.01);
    LP.capDecal(gb, -h, false, [[0.8, 0.87], [0.86, 0.87], [0.86, 0.95], [0.8, 0.95]], 'L', 0.01, true);
    LP.capDecal(gb, -h, false, [[0.66, 0.8], [0.84, 0.8], [0.84, 0.83], [0.66, 0.83]], 'A', 0.006, true);
    LP.capDecal(gb, -h, false, [[-0.25, 0.6], [0.25, 0.6], [0.25, 0.72], [-0.25, 0.72]], 'K');
    LP.capDecal(gb, -h, false, [[-0.75, 0.3], [0.75, 0.3], [0.7, 0.42], [-0.7, 0.42]], 'T');
    for (const x of [0.55, 0.68]) LP.box(gb, x, 0.32, -h - 0.04, 0.1, 0.08, 0.1, 'C');
    LP.box(gb, 0, 1.12, -2.48, 1.5, 0.04, 0.12, 'P', false, 0.3);                     // ducktail spoiler
    LP.box(gb, 0.99, 1.02, 0.75, 0.14, 0.09, 0.1, 'P');
    return LP.finish({ key: 'charger', gb, W, front: B.front, rear: B.rear, r, tyreW: 0.245, axles: [aF, aR], wheel: LP.wheel(r, 0.245, { spokes: 5 }) });
  });
})();
