'use strict';
// Jeep Wrangler Unlimited (JL) - low-poly
(() => {
  registerVehicle({ key: 'wrangler', name: 'Jeep Wrangler Unlimited', cls: 'suv', w: 3, mass: 2000, amax: 1.3, paint: 'car' }, () => {
    const gb = new GB(), W = 0.86, h = 2.33, aF = 1.66, aR = -1.35, r = 0.395;
    // brick body (fender flares are separate black pieces sticking out over the tyres)
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.97], [2.2, 1], [-h, 1]],
      bot:  [[h, 0.5], [-h, 0.5]],
      botX: 0.95, lowX: 1,
      low:  [[h, 0.62], [-h, 0.62]],
      sh:   [[h, 1.0], [1.2, 1.05], [-h, 1.07]],
      belt: [[h, 1.1], [1.2, 1.15], [0.95, 1.18], [-h, 1.2]],
      beltX: 0.98,
      edge: [[h, 1.12], [1.2, 1.16], [0.9, 1.78], [-h, 1.79]],
      edgeX:[[h, 0.86], [1.2, 0.88], [0.9, 0.9], [-h, 0.9]],
      top:  [[h, 1.14], [1.2, 1.18], [0.9, 1.84], [-h, 1.84]],
    });
    const B = LP.body(gb, {
      st: [h, 2.2, 1.2, 0.9, 0.15, 0.05, -0.85, -1.0, -2.25, -h],
      ring,
      arches: [{ f: aF, r: 0.55, top: 0.98 }, { f: aR, r: 0.55, top: 0.98 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return 'T';
        if (k === 4 && f > 0.9 && f < 1.2) return 'T';                       // windshield frame
        if (k === 4 && ((f > 0.05 && f < 0.9) || (f > -0.85 && f < 0.05) || (f > -2.25 && f < -1.0))) return 'G';
        if (k === 4 && f < 0.9) return 'T';                                    // black hardtop pillars
        if (k === 5 && f > 0.9 && f < 1.2) return 'G';                         // flat upright windshield
        if (k === 5 && f < 0.9) return 'T';                                    // black removable hardtop
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DTPPTT',
    });
    // seven-slot grille + round headlights in the outer slots, amber lamps in the flares
    for (let i = -3; i <= 3; i++) {
      const x = i * 0.105;
      LP.capDecal(gb, h, true, [[x - 0.03, 0.72], [x + 0.03, 0.72], [x + 0.03, 1.02], [x - 0.03, 1.02]], 'D');
    }
    const lamp = x => [0, 1, 2, 3, 4, 5, 6, 7].map(i => [x + Math.cos(i / 8 * Math.PI * 2) * 0.12, 0.87 + Math.sin(i / 8 * Math.PI * 2) * 0.12]);
    LP.capDecal(gb, h, true, lamp(0.6), 'C', 0.006, true);
    LP.capDecal(gb, h, true, lamp(0.6).map(([x, y]) => [0.6 + (x - 0.6) * 0.75, 0.87 + (y - 0.87) * 0.75]), 'H', 0.01, true);
    // black steel bumpers
    LP.box(gb, 0, 0.62, h + 0.08, 1.95, 0.22, 0.2, 'T', false);
    LP.box(gb, 0, 0.62, -h - 0.08, 1.9, 0.22, 0.2, 'T', false);
    // black fender flares over each wheel (flat-topped, angled ends)
    for (const a of [aF, aR]) {
      LP.box(gb, 0.93, 1.0, a, 0.2, 0.06, 1.0, 'T');
      LP.box(gb, 0.93, 0.85, a + 0.52, 0.2, 0.3, 0.06, 'T', true, 0.5);
      LP.box(gb, 0.93, 0.85, a - 0.52, 0.2, 0.3, 0.06, 'T', true, -0.5);
    }
    LP.box(gb, 0.99, 0.96, aF + 0.45, 0.04, 0.05, 0.1, 'A');                  // turn lamp in the front flare
    // rear: square vertical tail lamps, spare tyre on the tailgate, plate
    LP.capDecal(gb, -h, false, [[0.72, 0.82], [0.84, 0.82], [0.84, 1.08], [0.72, 1.08]], 'L', 0.006, true);
    LP.capDecal(gb, -h, false, [[0.72, 0.76], [0.84, 0.76], [0.84, 0.81], [0.72, 0.81]], 'A', 0.006, true);
    LP.capDecal(gb, -h, false, [[0.3, 0.72], [0.62, 0.72], [0.62, 0.82], [0.3, 0.82]], 'K');
    gb.geom(new THREE.CylinderGeometry(0.38, 0.38, 0.24, 10), gb.xf(0, 1.15, h + 0.14, Math.PI / 2, 0, 0), SLOT.TIRE);
    gb.geom(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 10), gb.xf(0, 1.15, h + 0.265, Math.PI / 2, 0, 0), SLOT.METAL);
    // mirrors, door hinges
    LP.box(gb, 0.95, 1.25, 0.95, 0.16, 0.16, 0.06, 'T');
    LP.box(gb, 0.865, 0.9, 0.82, 0.02, 0.08, 0.06, 'T');
    return LP.finish({ key: 'wrangler', gb, W: 0.95, front: h + 0.18, rear: -h - 0.26, r, tyreW: 0.26, track: 0.8, axles: [aF, aR],
      wheel: LP.wheel(r, 0.26, { spokes: 5, rim: 0.55, spokeW: 0.3 }) });
  });
})();
