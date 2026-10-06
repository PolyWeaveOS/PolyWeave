'use strict';
// =====================================================================
//  TEMPLATE / CONTRACT for a traffic vehicle file (not loaded by the game).
//  Copy this structure for js/vehicles/<key>.js. Everything used here comes from js/models.js:
//    GB (geometry builder, triangles bucketed by SLOT), loftBody, genSpec, addCarDetails, mcurve,
//    wheelGeometry, overlayGeom, SLOT, SAT (hitbox), registerVehicle.
//  Frame: x = right, y = up (ground at y = 0), z = -forward (the FRONT of the car points to -z).
//  "f" in specs is the forward coordinate (f = -z). Body centred on f = 0 (front = +L/2, rear = -L/2).
// =====================================================================
(() => { // every vehicle file is wrapped like this: no top-level names (all files share one global scope)
registerVehicle({
  key: '_template', name: 'Generic sedan (template)', cls: 'car',
  w: 10,          // how common in traffic (relative weight)
  mass: 1550,     // kg (collisions)
  amax: 1.5,      // gentle traffic acceleration, m/s^2
  // paint: 'car' (random realistic colours, default) | 'truck' (fleet whites/reds/blues) | [0xffc20e] (fixed list)
}, () => {
  // genSpec + loftBody + addCarDetails is the old generic car. A real-car model should write its own
  // profile curves (see CATALOG.m4 in js/models.js) and its own signature details.
  const o = { style: 'sedan', L: 4.86, W: 0.915, H: 1.46, noseH: 0.74, hoodH: 0.99, cowl: 0.95, roofF: 0.12, roofR: -0.82, deckF: -1.62, deckH: 1.06,
    clr: 0.15, axF: 1.43, axR: -1.40, r: 0.33, beltF: 0.96, beltR: 1.02, tumble: 0.79, lampRY: 0.90, plateY: 0.62, pillarSlot: SLOT.TRIM, bp: 0.05, doorRear: -0.95 };
  const sp = genSpec(o), gb = new GB(), ov = { ind: [], brake: [] };
  const F = loftBody(gb, sp);
  addCarDetails(gb, sp, F, ov);   // pushes indicator boxes to ov.ind, brake boxes to ov.brake, ov.third = 3rd brake light
  const tx = sp.W - 0.24 / 2 - 0.02; // wheel centre x (track / 2)
  return {
    key: '_template',
    body: gb.build(),                                   // ONE geometry, groups = SLOT ids (PAINT gets the traffic colour)
    wheel: wheelGeometry(sp.r, 0.24, 'alloy'),          // built for the RIGHT side (hub face at +x); left wheels are turned 180 deg
    wheels: [{ x: tx, f: o.axF, side: 1, front: true }, { x: -tx, f: o.axF, side: -1, front: true },
      { x: tx, f: o.axR, side: 1 }, { x: -tx, f: o.axR, side: -1 }],   // optional y = hub height (defaults to r)
    r: sp.r, L: sp.L, W: sp.W,                          // W = HALF width of the body (no mirrors)
    front: sp.L / 2, rear: -sp.L / 2,                   // forward extents (f) of the body
    // lit overlays: boxes [x, y, z, sx, sy, sz, rotY]; indicator boxes are given for the RIGHT side (x > 0)
    // and overlayGeom mirrors them: sideSign -1 = left set, +1 = right set, 0 = both sides (brake lights)
    indL: overlayGeom(ov.ind, -1), indR: overlayGeom(ov.ind, 1),
    brake: overlayGeom([...ov.brake, ov.third], 0),
    hull: SAT.hull(sp.W + 0.01, sp.L / 2, -sp.L / 2, 0.32, 0.22),  // collision outline: half width, front, rear, corner chamfers
  };
});
})();
