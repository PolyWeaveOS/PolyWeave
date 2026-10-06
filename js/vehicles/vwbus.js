'use strict';
// Volkswagen Type 2 (T1) "split-window" bus - low-poly, two-tone, no badge
(() => {
  registerVehicle({ key: 'vwbus', name: 'Volkswagen Type 2 bus', cls: 'van', w: 0.8, mass: 1200, amax: 0.9,
    paint: [0x5ab0c8, 0xd94f3a, 0xe8c747, 0x6fae6a] }, () => {
    const gb = new GB(), W = 0.875, h = 2.14, aF = 1.4, aR = -1.0, r = 0.33;
    // flat-fronted box with rounded roof edges; lower half paint, upper half white
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.94], [1.95, 1], [-1.95, 1], [-h, 0.95]],
      bot:  [[h, 0.36], [1.95, 0.3], [-1.95, 0.32], [-h, 0.4]],
      botX: 0.92, lowX: 0.98,
      low:  [[h, 0.44], [1.95, 0.46], [-h, 0.48]],
      sh:   [[h, 0.86], [1.95, 0.9], [-h, 0.9]],
      belt: [[h, 1.04], [1.95, 1.1], [-h, 1.1]],
      beltX: 0.99,
      edge: [[h, 1.76], [1.95, 1.84], [-1.95, 1.84], [-h, 1.76]],
      edgeX:[[h, 0.8], [1.95, 0.84], [-h, 0.8]],
      top:  [[h, 1.86], [1.95, 1.94], [-1.95, 1.94], [-h, 1.86]],
    });
    LP.body(gb, {
      st: [h, 1.95, 1.2, 1.1, 0.25, 0.15, -0.65, -0.75, -1.95, -h],
      ring,
      arches: [{ f: aF, r: 0.45, top: 0.72, lift: 2 }, { f: aR, r: 0.45, top: 0.72, lift: 2 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1 || k === 2) return 'P';                                       // painted lower body
        if (k === 3) return 'W';                                                  // white upper body
        if (k === 4 && ((f > 1.1 && f < 1.2) || (f > 0.15 && f < 0.25) || (f > -0.75 && f < -0.65))) return 'W';
        if (k === 4 && f > -1.95 && f < 1.95) return 'G';                         // row of side windows
        return 'W';                                                               // white roof
      },
      capF: 'DPPPPP', capR: 'DPPPPP',
    });
    // nose: white upper panel with the big white "V" dipping into the paint, split two-pane windshield
    LP.capDecal(gb, h, true, [[-0.8, 1.0], [0.8, 1.0], [0.78, 1.74], [-0.78, 1.74]], 'W', 0.004);
    LP.capDecal(gb, h, true, [[-0.55, 1.0], [0.55, 1.0], [0, 0.6]], 'W', 0.004);
    LP.capDecal(gb, -h, false, [[-0.8, 1.0], [0.8, 1.0], [0.78, 1.74], [-0.78, 1.74]], 'W', 0.004);
    LP.capDecal(gb, h, true, [[0.06, 1.2], [0.72, 1.2], [0.7, 1.64], [0.06, 1.64]], 'G', 0.008, true);
    const oct = (cx, cy, rr) => [0, 1, 2, 3, 4, 5, 6, 7].map(i => [cx + Math.cos((i + 0.5) / 8 * Math.PI * 2) * rr, cy + Math.sin((i + 0.5) / 8 * Math.PI * 2) * rr]);
    LP.capDecal(gb, h, true, oct(0.62, 0.78, 0.11), 'C', 0.006, true);
    LP.capDecal(gb, h, true, oct(0.62, 0.78, 0.085), 'H', 0.01, true);
    LP.capDecal(gb, h, true, [[0.3, 0.88], [0.4, 0.88], [0.4, 0.94], [0.3, 0.94]], 'A', 0.006, true);
    LP.box(gb, 0, 0.42, h + 0.05, 1.85, 0.08, 0.08, 'C', false);
    LP.box(gb, 0, 0.42, -h - 0.05, 1.85, 0.08, 0.08, 'C', false);
    // rear: small round tails, engine lid vents, small rear window
    LP.capDecal(gb, -h, false, oct(0.7, 0.9, 0.065), 'L', 0.006, true);
    LP.capDecal(gb, -h, false, oct(0.7, 0.78, 0.04), 'A', 0.006, true);
    LP.capDecal(gb, -h, false, [[-0.5, 1.4], [0.5, 1.4], [0.5, 1.62], [-0.5, 1.62]], 'G', 0.008);
    for (let i = 0; i < 3; i++) LP.capDecal(gb, -h, false, [[-0.3, 0.7 + i * 0.05], [0.3, 0.7 + i * 0.05], [0.3, 0.72 + i * 0.05], [-0.3, 0.72 + i * 0.05]], 'T');
    LP.box(gb, 0.93, 1.2, 1.55, 0.1, 0.08, 0.06, 'C');
    return LP.finish({ key: 'vwbus', gb, W, front: h + 0.09, rear: -h - 0.09, r, tyreW: 0.18, axles: [aF, aR],
      wheel: LP.wheel(r, 0.18, { spokes: 0, rim: 0.6, dish: 'W', hub: 'C' }) });
  });
})();
