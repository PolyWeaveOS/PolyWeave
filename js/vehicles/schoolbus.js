'use strict';
// Conventional school bus (Thomas C2 / Blue Bird Vision style) - low-poly
(() => {
  registerVehicle({ key: 'schoolbus', name: 'School bus', cls: 'bus', w: 1, mass: 11000, amax: 0.6, paint: [0xffb800] }, () => {
    const gb = new GB(), F = 5.45, W = 1.22, r = 0.52, aF = 4.05, aR = -1.95, tw = 0.28;
    // pillars between the side windows
    const pillars = [];
    for (let f = 3.55; f > -4.9; f -= 0.86) pillars.push(f, f - 0.1);
    const inPillar = f => { for (let i = 0; i < pillars.length; i += 2) if (f < pillars[i] && f > pillars[i + 1]) return true; return false; };
    const ring = LP.ringFrom(W, {
      w:    [[F, 0.86], [5.2, 0.92], [4.6, 0.96], [4.3, 1], [-F, 1]],
      bot:  [[F, 0.56], [5.2, 0.48], [-F, 0.5]],
      botX: 0.94, lowX: 0.99,
      low:  [[F, 0.72], [5.2, 0.74], [-F, 0.74]],
      sh:   [[F, 1.12], [5.2, 1.22], [4.6, 1.32], [4.3, 1.36], [-F, 1.36]],
      belt: [[F, 1.26], [5.2, 1.38], [4.6, 1.58], [4.3, 1.78], [-F, 1.78]],
      beltX:[[F, 0.86], [4.6, 0.9], [4.3, 0.99], [-F, 0.99]],
      edge: [[F, 1.28], [5.2, 1.42], [4.6, 1.64], [4.3, 3.06], [-F, 3.06]],
      edgeX:[[F, 0.66], [4.6, 0.74], [4.3, 0.93], [-F, 0.93]],
      top:  [[F, 1.32], [5.2, 1.46], [4.6, 1.68], [4.3, 3.2], [-F, 3.2]],
    });
    LP.body(gb, {
      st: [F, 5.2, 4.6, 4.3, 3.65, ...pillars, -5.3, -F], ring,
      arches: [{ f: aF, r: 0.66, top: 1.2 }, { f: aR, r: 0.66, top: 1.2 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return 'T';
        if (k === 4 && f > 3.6 && f < 4.3) return 'G';                // door / driver window
        if (k === 4 && f > -5.3 && f < 3.6) return inPillar(f) ? 'P' : 'G';  // long row of side windows
        if (k === 5 && f > 4.3 && f < 4.6) return 'G';                // big flat windshield
        if (k === 5 && f < 4.3) return 'W';                           // white roof
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DPPPPP',
    });
    // short hood: black grille, round headlights, bumper
    LP.capDecal(gb, F, true, [[-0.5, 0.8], [0.5, 0.8], [0.5, 1.2], [-0.5, 1.2]], 'D');
    const oct = (cx, cy, rr) => [0, 1, 2, 3, 4, 5, 6, 7].map(i => [cx + Math.cos((i + 0.5) / 8 * Math.PI * 2) * rr, cy + Math.sin((i + 0.5) / 8 * Math.PI * 2) * rr]);
    LP.capDecal(gb, F, true, oct(0.72, 1.0, 0.11), 'H', 0.006, true);
    LP.capDecal(gb, F, true, [[0.66, 0.8], [0.82, 0.8], [0.82, 0.86], [0.66, 0.86]], 'A', 0.006, true);
    LP.box(gb, 0, 0.6, F + 0.06, 2.3, 0.26, 0.16, 'D', false);
    // three black rub rails each side
    for (const y of [0.98, 1.22, 1.5]) LP.box(gb, W + 0.005, y, -0.7, 0.03, 0.07, 9.6, 'D');
    // red + amber warning lamps over the windshield and on the rear, stop arm on the driver (left) side
    for (const x of [0.95, 0.62]) LP.box(gb, x, 3.04, 4.31, 0.16, 0.14, 0.04, x > 0.8 ? SLOT.CALIPER : 'R');
    LP.box(gb, -1.25, 1.7, 3.5, 0.02, 0.36, 0.36, SLOT.CALIPER, false);
    // rear: emergency door with window, round tail lamps, ambers, warning lamps, bumper
    LP.capDecal(gb, -F, false, [[-0.45, 0.8], [0.45, 0.8], [0.45, 2.85], [-0.45, 2.85]], 'T');
    LP.capDecal(gb, -F, false, [[-0.4, 1.85], [0.4, 1.85], [0.4, 2.75], [-0.4, 2.75]], 'G', 0.01);
    LP.capDecal(gb, -F, false, [[-0.4, 0.85], [0.4, 0.85], [0.4, 1.8], [-0.4, 1.8]], 'P', 0.01);
    LP.capDecal(gb, -F, false, oct(0.9, 1.05, 0.1), 'L', 0.006, true);
    LP.capDecal(gb, -F, false, oct(0.9, 1.3, 0.08), 'A', 0.006, true);
    for (const x of [0.95, 0.62]) LP.capDecal(gb, -F, false, [[x - 0.08, 2.9], [x + 0.08, 2.9], [x + 0.08, 3.04], [x - 0.08, 3.04]], x > 0.8 ? SLOT.CALIPER : 'R', 0.006, true);
    LP.box(gb, 0, 0.62, -F - 0.06, 2.3, 0.26, 0.14, 'D', false);
    LP.box(gb, 1.3, 2.2, 4.75, 0.06, 0.45, 0.22, 'T');                               // mirrors
    return LP.finish({ key: 'schoolbus', gb, W, front: F + 0.14, rear: -F - 0.13, r, tyreW: tw, axles: [aF, aR], dual: [1], track: 1.0,
      wheel: LP.wheel(r, tw, { spokes: 0, rim: 0.6, dish: 'M', hub: 'C' }), chamfer: 0.4, chamferR: 0.1 });
  });
})();
