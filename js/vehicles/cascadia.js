'use strict';
// Freightliner Cascadia sleeper + 53 ft dry van trailer - low-poly
(() => {
  registerVehicle({ key: 'cascadia', name: 'Freightliner Cascadia + 53 ft trailer', cls: 'truck', w: 3, mass: 25000, amax: 0.5, paint: 'truck' }, () => {
    const gb = new GB(), W = 1.27, F = 10.75, r = 0.52, tw = 0.3;
    // ---- tractor: sloped hood, cab, tall sleeper with roof fairing ----
    const ring = LP.ringFrom(W, {
      w:    [[F, 0.9], [10.45, 0.97], [9.9, 0.98], [8.65, 0.96], [8.1, 1], [4.7, 1]],
      bot:  [[F, 0.42], [10.45, 0.46], [8.65, 0.62], [4.7, 0.62]],
      botX: 0.92, lowX: 0.98,
      low:  [[F, 0.78], [10.45, 0.8], [8.65, 0.95], [4.7, 0.95]],
      sh:   [[F, 1.18], [10.45, 1.32], [9.9, 1.4], [8.65, 1.5], [8.1, 1.5], [4.7, 1.5]],
      belt: [[F, 1.3], [10.45, 1.48], [9.9, 1.58], [8.65, 1.85], [8.1, 2.15], [4.7, 2.2]],
      beltX:[[F, 0.92], [9.9, 0.9], [8.65, 0.9], [8.1, 0.97], [4.7, 0.98]],
      edge: [[F, 1.34], [10.45, 1.55], [9.9, 1.66], [8.65, 1.96], [8.1, 2.9], [6.7, 3.95], [4.7, 4.0]],
      edgeX:[[F, 0.7], [9.9, 0.74], [8.65, 0.8], [8.1, 0.86], [6.7, 0.94], [4.7, 0.96]],
      top:  [[F, 1.38], [10.45, 1.6], [9.9, 1.72], [8.65, 2.0], [8.1, 3.0], [6.7, 4.05], [4.7, 4.08]],
    });
    LP.body(gb, {
      st: [F, 10.45, 9.9, 8.65, 8.1, 7.35, 6.7, 4.7],
      ring,
      arches: [{ f: 9.4, r: 0.68, top: 1.17 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return f > 10.45 ? 'C' : 'T';
        if (k === 3 && f > 9.9 && f < 10.45) return 'H';     // swept headlights on the fender corners
        if (k === 4 && f > 7.35 && f < 8.1) return 'G';      // door window
        if (k === 5 && f > 8.1 && f < 8.65) return 'G';      // windshield
        return 'P';
      },
      capF: 'DCPPPP', capR: 'TPPPPP',
    });
    // big chrome grille with dark slats, bumper, amber turn lamps
    LP.capDecal(gb, F, true, [[-0.62, 0.82], [0.62, 0.82], [0.56, 1.32], [-0.56, 1.32]], 'C');
    for (let i = 0; i < 5; i++) { const y = 0.88 + i * 0.09; LP.capDecal(gb, F, true, [[-0.54, y], [0.54, y], [0.54, y + 0.045], [-0.54, y + 0.045]], 'D', 0.012); }
    LP.capDecal(gb, F, true, [[-1.15, 0.42], [1.15, 0.42], [1.15, 0.78], [-1.15, 0.78]], 'M', 0.02);
    LP.capDecal(gb, F, true, [[0.8, 0.82], [1.05, 0.82], [1.05, 0.95], [0.8, 0.95]], 'A', 0.006, true);
    // side fairings + fuel tanks + steps under the cab, exhaust stacks, mirrors, frame
    LP.box(gb, 1.2, 0.9, 6.6, 0.12, 0.55, 2.0, 'P');
    LP.box(gb, 1.12, 0.62, 7.75, 0.22, 0.12, 0.6, 'M');
    LP.box(gb, 1.08, 3.3, 4.85, 0.16, 1.9, 0.16, 'C');
    LP.box(gb, 1.36, 2.35, 8.25, 0.06, 0.55, 0.22, 'T');
    LP.box(gb, 0, 0.95, 4.2, 1.6, 0.25, 2.2, 'T', false);
    // ---- 53 ft dry van trailer ----
    const tF = 4.0, tR = -F;
    const tRing = () => [[W * 0.97, 1.22], [W, 1.28], [W, 3.92], [W * 0.99, 4.02], [W * 0.92, 4.06], [0, 4.08]];
    LP.body(gb, {
      st: [tF, tR], ring: tRing,
      face: k => 'B',
      capF: 'BBBBBB', capR: 'BBBBBB',
    });
    // rear swing doors (seams + lock bars), tail lights, ambers, plate, under-ride guard
    LP.capDecal(gb, tR, false, [[-0.015, 1.32], [0.015, 1.32], [0.015, 3.95], [-0.015, 3.95]], 'T');
    for (const x of [0.45, 0.85]) LP.capDecal(gb, tR, false, [[x - 0.02, 1.35], [x + 0.02, 1.35], [x + 0.02, 3.9], [x - 0.02, 3.9]], 'M', 0.008, true);
    LP.capDecal(gb, tR, false, [[0.98, 1.32], [1.2, 1.32], [1.2, 1.5], [0.98, 1.5]], 'L', 0.01, true);
    LP.capDecal(gb, tR, false, [[0.98, 1.52], [1.2, 1.52], [1.2, 1.62], [0.98, 1.62]], 'A', 0.01, true);
    LP.capDecal(gb, tR, false, [[-0.22, 3.95], [0.22, 3.95], [0.22, 4.0], [-0.22, 4.0]], 'L', 0.01);   // top centre brake bar
    LP.box(gb, 0, 0.62, tR + 0.25, 2.3, 0.12, 0.1, 'M', false);
    LP.box(gb, 0.9, 0.9, tR + 0.25, 0.08, 0.5, 0.08, 'M');
    // side skirts, landing gear
    LP.box(gb, 1.2, 0.85, -2.2, 0.03, 0.6, 7.5, 'T');
    LP.box(gb, 0.8, 0.8, 1.8, 0.1, 0.85, 0.1, 'M');
    const axles = [9.4, 5.25, 3.95, -8.55, -9.8];
    return LP.finish({ key: 'cascadia', gb, W, front: F, rear: tR, r, tyreW: tw, axles, dual: [1, 2, 3, 4], track: W - tw / 2 - 0.06,
      wheel: LP.wheel(r, tw, { spokes: 0, rim: 0.6, dish: 'M', hub: 'C' }), chamfer: 0.35, chamferR: 0.05 });
  });
})();
