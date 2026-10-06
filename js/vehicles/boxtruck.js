'use strict';
// Isuzu NPR cab-over box truck - low-poly (no badges)
(() => {
  registerVehicle({ key: 'boxtruck', name: 'Cab-over box truck', cls: 'truck', w: 3, mass: 7500, amax: 0.75, paint: 'truck' }, () => {
    const gb = new GB(), F = 3.5, cabBack = 1.82, W = 0.995, BW = 1.22, r = 0.38, aF = 2.55, aR = -1.45, tw = 0.215;
    // ---- flat-faced cab-over cab ----
    const ring = LP.ringFrom(W, {
      w:    [[F, 0.93], [3.38, 1], [cabBack, 1]],
      bot:  [[F, 0.5], [3.38, 0.46], [cabBack, 0.46]],
      botX: 0.94, lowX: 0.99,
      low:  [[F, 0.78], [3.38, 0.8], [cabBack, 0.8]],
      sh:   [[F, 1.22], [3.38, 1.26], [cabBack, 1.26]],
      belt: [[F, 1.32], [3.38, 1.36], [cabBack, 1.36]],
      beltX: 0.99,
      edge: [[F, 2.08], [3.38, 2.16], [cabBack, 2.18]],
      edgeX:[[F, 0.82], [3.38, 0.86], [cabBack, 0.86]],
      top:  [[F, 2.16], [3.38, 2.25], [cabBack, 2.26]],
    });
    LP.body(gb, {
      st: [F, 3.38, 3.25, 2.3, 2.2, cabBack], ring,
      arches: [{ f: aF, r: 0.52, top: 0.92 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return 'T';
        if (k === 4 && f > 2.3 && f < 3.25) return 'G';             // door window
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DPPPPP',
    });
    // huge windshield, black grille panel, square headlights low on the corners, ambers, bumper, step
    LP.capDecal(gb, F, true, [[-0.8, 1.36], [0.8, 1.36], [0.78, 2.04], [-0.78, 2.04]], 'G');
    LP.capDecal(gb, F, true, [[-0.5, 0.86], [0.5, 0.86], [0.5, 1.18], [-0.5, 1.18]], 'D');
    LP.capDecal(gb, F, true, [[0.58, 0.88], [0.86, 0.88], [0.86, 1.1], [0.58, 1.1]], 'H', 0.006, true);
    LP.capDecal(gb, F, true, [[0.58, 1.12], [0.86, 1.12], [0.86, 1.18], [0.58, 1.18]], 'A', 0.006, true);
    LP.box(gb, 0, 0.6, F + 0.05, 1.95, 0.22, 0.14, 'M', false);
    LP.box(gb, 0.98, 0.5, 2.85, 0.1, 0.06, 0.45, 'M');
    LP.box(gb, 1.06, 1.6, 3.2, 0.06, 0.4, 0.2, 'T');                                  // mirrors
    // ---- tall dry box (wider and taller than the cab) on a frame ----
    const bRing = () => [[BW * 0.99, 0.95], [BW, 1.0], [BW, 3.22], [BW * 0.99, 3.28], [BW * 0.94, 3.3], [0, 3.3]];
    LP.body(gb, { st: [1.72, -F], ring: bRing, face: () => 'B', capF: 'BBBBBB', capR: 'BBBBBB' });
    LP.box(gb, 0, 0.78, -0.9, 1.6, 0.3, 5.0, 'T', false);                             // chassis frame
    // rear roll-up door (ribs), tails, ambers, clearance lamps, bumper
    for (let i = 1; i < 7; i++) { const y = 1.05 + i * 0.3; LP.capDecal(gb, -F, false, [[-1.0, y], [1.0, y], [1.0, y + 0.02], [-1.0, y + 0.02]], 'T'); }
    LP.capDecal(gb, -F, false, [[0.96, 1.04], [1.18, 1.04], [1.18, 1.2], [0.96, 1.2]], 'L', 0.008, true);
    LP.capDecal(gb, -F, false, [[0.96, 1.22], [1.18, 1.22], [1.18, 1.3], [0.96, 1.3]], 'A', 0.008, true);
    LP.capDecal(gb, -F, false, [[1.06, 3.18], [1.16, 3.18], [1.16, 3.24], [1.06, 3.24]], 'R', 0.008, true);
    LP.box(gb, 0, 0.6, -F + 0.15, 2.2, 0.12, 0.1, 'M', false);
    LP.box(gb, 1.21, 3.2, 1.4, 0.03, 0.05, 0.08, 'R');                                // front clearance lamps
    return LP.finish({ key: 'boxtruck', gb, W: BW, front: F + 0.12, rear: -F, r, tyreW: tw, axles: [aF, aR], dual: [1], track: 0.86,
      wheel: LP.wheel(r, tw, { spokes: 0, rim: 0.6, dish: 'M', hub: 'C' }), chamfer: 0.3, chamferR: 0.05 });
  });
})();
