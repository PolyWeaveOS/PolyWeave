'use strict';
// =====================================================================
//  Low-poly superbike (owners' accounts only: see BIKE_NAMES in main.js / db.js)
//  Styled after the popular litre sport bikes (R1 / Ninja / Panigale look): full fairing with twin slit
//  headlights and a central air intake, big tank, upswept tail with an LED strip, fat tyres on 3-spoke rims,
//  gold upside-down forks with twin discs and red calipers, aluminium swingarm and a side exhaust canister.
//  Same physics as the car; only the model and the hitbox differ. The model is centred on the car's centre
//  of gravity, so it sits exactly where the car would. Same handles as makeVehicle(): root, wheels, brake,
//  indL, indR, M (front, rear, W, r, hull), spin; plus lean (a group tipped into turns), rider and riderTop.
//  Coordinates: +z is the back of the bike, -z the front, y up, x to the right.
// =====================================================================
const BIKE = { front: 1.08, rear: -1.06, W: 0.42, r: 0.32, wheelbase: 1.44 };
BIKE.hull = SAT.hull(BIKE.W, BIKE.front, BIKE.rear, 0.16, 0.14);
BIKE.L = BIKE.front - BIKE.rear;

function makeBike(paint) {
  const flat = (color, roughness = 0.6, metalness = 0.1, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness, metalness, flatShading: true }, extra));
  const M = {
    paint, white: flat(0xf1f2f4, 0.35, 0.1), black: flat(0x16181d, 0.55, 0.2), matte: flat(0x22252b, 0.85), metal: flat(0x9aa1ab, 0.28, 0.85),
    alu: flat(0xb9bec6, 0.32, 0.8), chrome: flat(0xd6dae0, 0.15, 0.95), gold: flat(0xd8a432, 0.3, 0.85), red: flat(0xd8262e, 0.4, 0.3),
    tyre: flat(0x111216, 0.92), rim: flat(0x1c1e23, 0.4, 0.6), disc: flat(0xb6bbc3, 0.25, 0.9), ti: flat(0x8d8f99, 0.25, 0.9),
    seat: flat(0x0e0f12, 0.9), glass: flat(0x1d2836, 0.05, 0.5, { transparent: true, opacity: 0.6 }),
    suit: flat(0x1a1c22, 0.85), suit2: flat(0x2e333d, 0.8), helmet: flat(0x0f1013, 0.25, 0.4), visor: flat(0x1a2a3a, 0.08, 0.7),
    light: new THREE.MeshBasicMaterial({ color: 0xf4f7ff }), tail: new THREE.MeshBasicMaterial({ color: 0x4a0d12 }),
  };
  const root = new THREE.Group(), lean = new THREE.Group(); root.add(lean);
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, parent = lean) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; parent.add(m); return m;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (r1, r2, h, n = 10, open = false) => new THREE.CylinderGeometry(r1, r2, h, n, 1, open);
  const xcyl = (r1, r2, h, n = 10) => cyl(r1, r2, h, n).rotateZ(Math.PI / 2);          // axis along x (wheels, discs, axles)
  // a body panel from its side profile: [z, y] points, extruded to width w (chamfered edges = low-poly rounding)
  // taper(z) (optional): how much of the width is left at that point along the bike (a tail narrowing to a point)
  const side = (pts, w, mat, bev = 0.028, x = 0, parent = lean, taper = null) => {
    const s = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
    const depth = Math.max(0.005, w - 2 * bev);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 1, curveSegments: 1 });
    g.translate(0, 0, -depth / 2); g.rotateY(-Math.PI / 2);
    if (taper) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * taper(p.getZ(i))); }
    g.computeVertexNormals();
    return add(g, mat, x, 0, 0, 0, 0, 0, parent);
  };
  // a part running from point a to point b ([x, y, z]), made from a geometry whose long axis is y
  const between = (geo, mat, a, b, parent = lean) => {
    const m = new THREE.Mesh(geo, mat), A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.castShadow = true; parent.add(m); return m;
  };
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const hz = BIKE.wheelbase / 2, R = BIKE.r;
  const BODY_TAPER = z => z > 0.35 ? 1 - 0.6 * Math.min(1, (z - 0.35) / 0.55) : z < -0.62 ? 1 - 0.38 * Math.min(1, (-0.62 - z) / 0.3) : 1;

  // ---------------------------------------------------------------- wheels: fat tyres, 3-spoke rims, discs
  const wheels = [];
  const tyreGeo = w => {
    const h = w / 2, p = [[0.218, -h * 0.82], [0.262, -h], [0.298, -h * 0.94], [R - 0.004, -h * 0.62], [R + 0.004, 0], [R - 0.004, h * 0.62], [0.298, h * 0.94], [0.262, h], [0.218, h * 0.82]];
    return new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), 18).rotateZ(Math.PI / 2);
  };
  const wheel = (front) => {
    const w = front ? 0.13 : 0.19;                      // (front 120-section, rear 190-section: a real superbike's fat rear)
    const pivot = new THREE.Group(); pivot.position.set(0, R, front ? -hz : hz); lean.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    add(tyreGeo(w), M.tyre, 0, 0, 0, 0, 0, 0, spin);
    add(new THREE.CylinderGeometry(0.218, 0.218, w * 0.78, 18, 1, true).rotateZ(Math.PI / 2), M.rim, 0, 0, 0, 0, 0, 0, spin);   // rim barrel
    for (const sx of [-1, 1]) add(new THREE.TorusGeometry(0.214, 0.012, 4, 18).rotateY(Math.PI / 2), M.paint, sx * w * 0.38, 0, 0, 0, 0, 0, spin);   // rim lip stripe
    add(xcyl(0.055, 0.055, w * 0.9, 10), M.rim, 0, 0, 0, 0, 0, 0, spin);                                                       // hub
    // three split ("Y") spokes, wide and flat: a sport bike's cast wheel, not a bicycle's
    for (let k = 0; k < 3; k++) for (const da of [-0.17, 0.17]) {
      const g = new THREE.Group(); g.rotation.x = k * Math.PI * 2 / 3 + da; spin.add(g);
      add(box(0.028, 0.165, 0.032), M.rim, 0, 0.135, 0, 0, 0, 0, g);
    }
    // brake discs (twin up front, single rear) - they turn with the wheel; calipers don't
    const discs = front ? [-0.078, 0.078] : [-0.085];
    for (const dx of discs) {
      add(xcyl(front ? 0.165 : 0.115, front ? 0.165 : 0.115, 0.008, 18), M.disc, dx, 0, 0, 0, 0, 0, spin);
      add(xcyl(0.085, 0.085, 0.012, 10), M.rim, dx, 0, 0, 0, 0, 0, spin);
      const cal = add(box(0.03, 0.09, 0.05), M.red, dx + Math.sign(dx) * 0.012, 0, 0, 0, 0, 0, pivot);
      if (front) cal.position.set(dx + Math.sign(dx) * 0.012, 0.08, 0.12); else cal.position.set(dx - 0.012, 0.06, -0.08);
    }
    add(xcyl(0.016, 0.016, front ? 0.26 : 0.3, 6), M.chrome, 0, 0, 0, 0, 0, 0, pivot);                                        // axle
    wheels.push({ pivot, mesh: spin, side: 1, front, base: 0, spinSign: 1 });
    return pivot;
  };
  const fp = wheel(true); wheel(false);

  // ---------------------------------------------------------------- front end (turns with the front wheel)
  // upside-down forks raked back ~24 deg: chrome sliders at the axle, thick gold tubes up to the clamps
  const rake = 0.42, up = L => [0, L * Math.cos(rake), L * Math.sin(rake)];
  for (const sx of [-0.105, 0.105]) {
    const a = up(0), b = up(0.34), c = up(0.3), d = up(0.76);
    between(cyl(0.024, 0.024, len(a, b), 8), M.chrome, [sx, ...a.slice(1)], [sx, ...b.slice(1)], fp);
    between(cyl(0.037, 0.037, len(c, d), 8), M.gold, [sx, ...c.slice(1)], [sx, ...d.slice(1)], fp);
    add(box(0.05, 0.07, 0.07), M.black, sx, 0.005, 0.02, 0, 0, 0, fp);                     // axle clamp
  }
  const top = up(0.74);
  add(box(0.28, 0.03, 0.09), M.alu, 0, top[1], top[2], rake, 0, 0, fp);                    // top triple clamp
  add(box(0.25, 0.035, 0.08), M.alu, 0, up(0.5)[1], up(0.5)[2], rake, 0, 0, fp);           // bottom clamp
  for (const s of [-1, 1]) {                                                                 // clip-on bars, low and swept back
    between(cyl(0.016, 0.016, 0.2, 6), M.black, [s * 0.11, top[1] - 0.03, top[2] + 0.01], [s * 0.3, top[1] - 0.06, top[2] + 0.07], fp);
    between(cyl(0.022, 0.022, 0.1, 6), M.seat, [s * 0.24, top[1] - 0.047, top[2] + 0.045], [s * 0.33, top[1] - 0.065, top[2] + 0.08], fp);
    add(box(0.05, 0.03, 0.05), M.black, s * 0.12, top[1] + 0.025, top[2] - 0.02, 0, 0, 0, fp);   // reservoirs
  }
  // front fender hugging the tyre
  side([[-0.2, R + 0.02], [-0.1, R + 0.075], [0.06, R + 0.08], [0.18, R + 0.03], [0.17, R + 0.0], [0.05, R + 0.05], [-0.1, R + 0.045], [-0.19, R - 0.005]], 0.13, M.paint, 0.012, 0, fp);

  // ---------------------------------------------------------------- frame-mounted body
  // upper body: nose, tank, seat base and the upswept tail in one profile (side view, front at -z)
  side([[-0.9, 0.79], [-0.82, 0.9], [-0.68, 0.99], [-0.5, 1.03], [-0.38, 1.06], [-0.18, 1.11], [0.02, 1.03], [0.12, 0.95], [0.38, 0.97],
    [0.55, 1.03], [0.88, 1.12], [0.86, 1.04], [0.64, 0.93], [0.32, 0.83], [0.05, 0.82], [-0.3, 0.84], [-0.55, 0.71], [-0.8, 0.71]], 0.3, M.paint, 0.035, 0, lean, BODY_TAPER);
  // the tank's top cover in black (racing look) and a white stripe down each side of the nose
  side([[-0.4, 1.065], [-0.18, 1.115], [0.0, 1.04], [-0.02, 1.0], [-0.2, 1.07], [-0.38, 1.02]], 0.22, M.black, 0.02);
  for (const sx of [-1, 1]) side([[-0.78, 0.86], [-0.6, 0.97], [-0.56, 0.95], [-0.74, 0.84]], 0.012, M.white, 0.004, sx * 0.143);
  // lower (side) fairing round the engine, clearing the front tyre; white accent stripe; black belly pan
  side([[-0.66, 0.76], [-0.3, 0.82], [0.04, 0.74], [0.08, 0.42], [0.0, 0.28], [-0.34, 0.27], [-0.34, 0.42], [-0.42, 0.62]], 0.36, M.paint, 0.03);
  for (const sx of [-1, 1]) side([[-0.4, 0.62], [-0.06, 0.67], [-0.04, 0.63], [-0.38, 0.58]], 0.01, M.white, 0.003, sx * 0.183);
  side([[-0.34, 0.27], [0.0, 0.28], [0.05, 0.2], [-0.26, 0.17]], 0.3, M.black, 0.02);
  // aluminium twin-spar frame showing between tank and fairing
  side([[-0.44, 0.93], [0.06, 0.8], [0.1, 0.66], [0.04, 0.64], [-0.42, 0.84]], 0.33, M.alu, 0.015);
  // nose: twin slit headlights, central ram-air intake, windscreen, mirrors
  for (const sx of [-1, 1]) {
    add(box(0.09, 0.03, 0.03), M.light, sx * 0.075, 0.82, -0.875, 0.5, sx * -0.35, sx * 0.25);
    add(box(0.07, 0.012, 0.02), M.light, sx * 0.1, 0.875, -0.835, 0.5, sx * -0.4, sx * 0.35);   // DRL strips
  }
  add(box(0.07, 0.06, 0.04), M.black, 0, 0.78, -0.89, 0.4);                                   // ram-air intake
  side([[-0.66, 0.985], [-0.44, 1.14], [-0.4, 1.12], [-0.6, 0.995]], 0.24, M.glass, 0.01);     // windscreen
  for (const s of [-1, 1]) {
    between(cyl(0.01, 0.01, 0.1, 5), M.black, [s * 0.16, 0.98, -0.62], [s * 0.25, 1.02, -0.6]);
    add(box(0.1, 0.05, 0.03), M.paint, s * 0.28, 1.03, -0.6, 0, s * 0.2, 0);
  }
  // seat (rider) on top of the profile
  // (the pillion cover narrows with the tail)
  side([[0.08, 0.99], [0.14, 0.965], [0.38, 0.985], [0.44, 1.01], [0.36, 1.0], [0.14, 0.985]], 0.25, M.seat, 0.02);
  // tail: LED light strip, indicators, number-plate hanger
  add(box(0.1, 0.03, 0.03), M.tail, 0, 1.075, 0.875, 0.35);
  const brake = add(box(0.105, 0.034, 0.034), new THREE.MeshBasicMaterial({ color: 0xff2635 }), 0, 1.075, 0.877, 0.35); brake.visible = false;
  between(box(0.02, 1, 0.04), M.black, [0, 0.9, 0.7], [0, 0.68, 0.84]).scale.y = 0.26;
  add(box(0.17, 0.12, 0.01), new THREE.MeshStandardMaterial({ color: 0xececea, roughness: 0.6 }), 0, 0.62, 0.86, 0.3);
  const indL = add(box(0.06, 0.025, 0.03), new THREE.MeshBasicMaterial({ color: 0xffa21c }), -0.11, 0.7, 0.82); indL.visible = false;
  const indR = add(box(0.06, 0.025, 0.03), new THREE.MeshBasicMaterial({ color: 0xffa21c }), 0.11, 0.7, 0.82); indR.visible = false;
  // rear hugger over the tyre
  side([[0.48, R + 0.33], [0.64, R + 0.39], [0.8, R + 0.36], [0.78, R + 0.33], [0.62, R + 0.36], [0.5, R + 0.3]], 0.2, M.black, 0.01);
  // engine (mostly hidden behind the fairing), swingarm, chain, exhaust
  add(box(0.24, 0.24, 0.32), M.matte, 0, 0.42, -0.06);
  for (const sx of [-0.115, 0.115]) {
    const a = [sx, 0.44, 0.06], b = [sx, R + 0.01, hz];
    between(box(0.035, len(a, b), 0.08), M.alu, a, b);
  }
  between(box(0.012, 0.66, 0.03), M.black, [-0.14, 0.47, 0.08], [-0.14, R + 0.06, hz]);
  between(cyl(0.028, 0.028, 0.5, 7), M.ti, [0.06, 0.24, -0.12], [0.16, 0.36, 0.28]);          // header pipe
  between(cyl(0.07, 0.065, 0.36, 8), M.ti, [0.17, 0.4, 0.3], [0.2, 0.6, 0.6]);                 // side canister
  between(cyl(0.05, 0.05, 0.03, 8), M.black, [0.2, 0.6, 0.6], [0.205, 0.615, 0.625]);
  between(cyl(0.022, 0.022, 0.04, 6), M.chrome, [0.205, 0.615, 0.625], [0.208, 0.63, 0.65]);
  for (const sx of [-0.2, 0.2]) add(box(0.07, 0.022, 0.035), M.metal, sx, 0.47, 0.22);        // footpegs

  // ---------------------------------------------------------------- rider, tucked in (riderTop hidden in first person)
  const rider = new THREE.Group(), riderTop = new THREE.Group(); lean.add(rider); rider.add(riderTop);
  rider.position.y = 0.04;
  const wedge = (w, h, d, k = 0.6) => {
    const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setX(i, p.getX(i) * k);
    g.computeVertexNormals(); return g;
  };
  add(wedge(0.36, 0.48, 0.22, 0.82), M.suit, 0, 1.085, 0.08, -0.98, 0, 0, riderTop);          // torso
  add(box(0.34, 0.08, 0.2), M.paint, 0, 1.2, -0.02, -0.98, 0, 0, riderTop);                   // stripe across the back
  const hel = add(new THREE.IcosahedronGeometry(0.15, 1), M.helmet, 0, 1.33, -0.3, 0, 0, 0, riderTop); hel.scale.z = 1.12;
  add(box(0.2, 0.075, 0.1), M.visor, 0, 1.32, -0.43, -0.15, 0, 0, riderTop);
  add(wedge(0.14, 0.04, 0.2, 0.6), M.paint, 0, 1.46, -0.26, 0, 0, 0, riderTop);               // helmet fin
  for (const sx of [-1, 1]) {
    between(cyl(0.05, 0.042, 0.4, 6), M.suit2, [sx * 0.21, 1.16, -0.1], [sx * 0.28, 0.92, -0.38], rider);   // arms
    add(box(0.08, 0.06, 0.1), M.seat, sx * 0.29, 0.92, -0.39, 0, 0, 0, rider);                // gloves on the clip-ons
    between(box(0.13, 0.4, 0.13), M.suit, [sx * 0.15, 0.94, 0.28], [sx * 0.21, 0.8, -0.04], rider);     // thighs, hip to knee
    between(box(0.11, 0.42, 0.12), M.suit, [sx * 0.21, 0.8, -0.04], [sx * 0.2, 0.46, 0.2], rider);      // shins, knee to peg
    add(box(0.1, 0.07, 0.2), M.seat, sx * 0.2, 0.46, 0.22, 0, 0, 0, rider);                   // boots on the pegs
  }
  return { root, lean, rider, riderTop, body: lean, wheels, brake, indL, indR, M: BIKE, mats: M, spin: 0 };
}
