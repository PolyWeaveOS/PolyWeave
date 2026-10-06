'use strict';
// Mini Cooper hardtop (F56) - low-poly
(() => {
  registerVehicle({ key: 'mini', name: 'Mini Cooper', cls: 'car', w: 3, mass: 1200, amax: 1.6, paint: 'car' }, () => {
    const gb = new GB(), W = 0.865, h = 1.93, aF = 1.27, aR = -1.23, r = 0.315;
    const ring = LP.ringFrom(W, {
      w:    [[h, 0.88], [1.75, 0.98], [1.4, 1], [-1.65, 1], [-1.8, 0.98], [-h, 0.94]],
      bot:  [[h, 0.26], [1.75, 0.18], [-1.8, 0.2], [-h, 0.3]],
      botX: 0.9, lowX: 0.98,
      low:  [[h, 0.34], [1.75, 0.34], [-1.8, 0.36], [-h, 0.4]],
      sh:   [[h, 0.62], [1.75, 0.7], [1.27, 0.76], [-1.23, 0.8], [-1.8, 0.8], [-h, 0.76]],
      belt: [[h, 0.7], [1.75, 0.8], [1.3, 0.85], [0.7, 0.9], [-1.4, 0.94], [-h, 0.92]],
      beltX:[[h, 0.9], [0.7, 0.95], [-h, 0.95]],
      edge: [[h, 0.72], [1.75, 0.83], [1.3, 0.87], [0.7, 0.92], [0.35, 1.34], [-1.55, 1.34], [-1.8, 1.0], [-h, 0.95]],
      edgeX:[[h, 0.7], [1.75, 0.74], [0.7, 0.8], [0.35, 0.8], [-1.55, 0.8], [-1.8, 0.84], [-h, 0.84]],
      top:  [[h, 0.74], [1.75, 0.86], [1.3, 0.9], [0.7, 0.95], [0.35, 1.41], [-1.55, 1.41], [-1.8, 1.03], [-h, 0.97]],
    });
    const B = LP.body(gb, {
      st: [h, 1.75, 1.45, 0.7, 0.35, -0.4, -0.5, -1.55, -1.8, -h],
      ring,
      arches: [{ f: aF, r: 0.43, top: 0.7, lift: 2 }, { f: aR, r: 0.43, top: 0.7, lift: 2 }],
      face: (f, k) => {
        if (k === 0) return 'D';
        if (k === 1) return 'T';                                    // black trim all round the bottom / arches
        if (k === 4 && f > 0.35 && f < 0.7) return 'T';             // black A-pillar
        if (k === 4 && f > -0.5 && f < -0.4) return 'T';            // black B-pillar ("floating" roof)
        if (k === 4 && f > -1.55 && f < 0.35) return 'G';
        if (k === 4 && f > -1.8 && f < -1.55) return 'T';
        if (k === 5 && f > 0.35 && f < 0.7) return 'G';             // upright windshield
        if (k === 5 && f > -1.8 && f < -1.55) return 'G';
        if (k === 5 && f > -1.55 && f < 0.35) return 'W';           // contrasting WHITE roof
        return 'P';
      },
      capF: 'DTPPPP', capR: 'DTPPPP',
    });
    // big round headlights with chrome rings (bonnet-mounted look), hexagon grille with chrome frame
    const oct = (cx, cy, rr) => [0, 1, 2, 3, 4, 5, 6, 7].map(i => [cx + Math.cos((i + 0.5) / 8 * Math.PI * 2) * rr, cy + Math.sin((i + 0.5) / 8 * Math.PI * 2) * rr]);
    LP.capDecal(gb, h, true, oct(0.52, 0.62, 0.14), 'C', 0.006, true);
    LP.capDecal(gb, h, true, oct(0.52, 0.62, 0.105), 'H', 0.01, true);
    LP.capDecal(gb, h, true, [[-0.34, 0.3], [0.34, 0.3], [0.4, 0.42], [0.3, 0.54], [-0.3, 0.54], [-0.4, 0.42]], 'C');
    LP.capDecal(gb, h, true, [[-0.3, 0.33], [0.3, 0.33], [0.35, 0.42], [0.27, 0.51], [-0.27, 0.51], [-0.35, 0.42]], 'D', 0.01);
    LP.capDecal(gb, h, true, [[0.66, 0.36], [0.76, 0.36], [0.76, 0.42], [0.66, 0.42]], 'A', 0.006, true);
    // rear: upright vertical tail lamps, plate
    LP.capDecal(gb, -h, false, [[0.66, 0.7], [0.78, 0.7], [0.8, 0.86], [0.66, 0.9]], 'L', 0.006, true);
    LP.capDecal(gb, -h, false, [[0.66, 0.64], [0.78, 0.64], [0.78, 0.69], [0.66, 0.69]], 'A', 0.006, true);
    LP.capDecal(gb, -h, false, [[-0.25, 0.5], [0.25, 0.5], [0.25, 0.62], [-0.25, 0.62]], 'K');
    LP.box(gb, 0, 1.39, -1.6, 0.9, 0.03, 0.14, 'W', false);                       // roof spoiler
    LP.box(gb, 0.92, 0.98, 0.6, 0.13, 0.1, 0.1, 'W');                             // white mirror caps
    return LP.finish({ key: 'mini', gb, W, front: B.front, rear: B.rear, r, tyreW: 0.2, axles: [aF, aR], wheel: LP.wheel(r, 0.2, { spokes: 5, spokeSlot: 'M' }) });
  });
})();
