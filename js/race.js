'use strict';
// =====================================================================
//  Racing (Season 1 limited-time mode)
//  - RaceWorld: builds a whole race track at once (js/tracks.js): asphalt with red / white kerbs in the
//    corners, green run-off, concrete walls and tyre walls with catch fences, a start / finish line with the
//    grid, start lights, a pit building, and red and white grandstands full of fans around the lap, with
//    sponsor boards, tents, camera towers, trees and buildings filling the space beyond.
//  - Race: lap timing, the singleplayer time trial (best laps go on the leaderboard) and multiplayer races
//    (queue -> lobby practice -> 60 s countdown once 2 players are in -> grid + lights -> 3 laps -> results).
//    The server runs each race (server.js); this side drives, times and shows it.
// =====================================================================
const RC = {
  asphalt: COL(0x3e4249), line: COL(0xf4f4f0), kerbR: COL(0xd42a2a), kerbW: COL(0xf4f2ee), runoff: COL(0x3f8d4f), runoff2: COL(0x4a9a58),
  wall: COL(0xd8d6cf), wallR: COL(0xd42a2a), wallW: COL(0xf4f2ee), tyre: COL(0x1d1e22), tyre2: COL(0x2a2b30), fence: COL(0x5c636c),
  seatR: COL(0xc8202a), seatW: COL(0xeeece6), stand: COL(0x8e949c), standDark: COL(0x5d636b), roof: COL(0xe9e9e4), roofUnder: COL(0x34363b),
  pit: COL(0xeceae4), pitGlass: COL(0x2a3b4e), pitDoor: COL(0x30353d), pitLane: COL(0x50555d), checkB: COL(0x18191c), checkW: COL(0xf5f5f2),
  tentA: COL(0xf2f2ee), tentB: COL(0xd42a2a), tentC: COL(0x2a5bd4), marshal: COL(0xff7a1a), tower: COL(0x9aa2ab), lamp: COL(0xfff4d2),
  build: [COL(0xd9d4c8), COL(0xb8c2cc), COL(0xc9b8a6), COL(0x9fb0bf), COL(0xe3ddd0)], glass: COL(0x3d5068),
  sponsor: [COL(0xd42a2a), COL(0x1f5fd1), COL(0xffd41c), COL(0x1c1d21), COL(0x16a34a), COL(0xff6a14), COL(0xf4f2ee)],
  crowd: [COL(0xd42a2a), COL(0xf4f2ee), COL(0x1f5fd1), COL(0xffd41c), COL(0x16a34a), COL(0xff6a14), COL(0x1c1d21), COL(0x9b59b6), COL(0xf28cb1), COL(0x5fc8ff)],
  skin: [COL(0xf1c9a5), COL(0xd9a477), COL(0xa8714a), COL(0x7a4b2c)],
};

const RaceWorld = {
  group: null, lightMats: [], built: null,
  clear() {
    if (!this.group) return;
    scene.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map) { o.material.map.dispose(); o.material.dispose(); } });
    this.group = null; this.lightMats = []; this.built = null;
  },
  // the whole track (call with ROAD on the track): theme = world type (grass / desert / snow)
  build(theme) {
    this.clear();
    const lp = ROAD.loop, TH = THEMES[theme] || THEMES.grass, G = world.G, xf = (...a) => world.xf(...a);
    const rnd = U.rng(lp.N * 31 + lp.L);
    const LW = ROAD.LW, asp = 2 * LW, street = !!lp.track.street;
    const wD = (s, sg) => Tracks.wallAt(lp, s, sg), gravel = (s, sg) => Tracks.gravelAt(lp, s, sg);   // (each side's wall distance at s)
    const eR = asp + Tracks.RUNOFF.kerb, wallD = asp + Tracks.RUNOFF.kerb + Tracks.RUNOFF.strip;   // (nearest any wall gets)
    const P = (s, d, y) => { const p = ROAD.pos(s, d); return [p.x, y, p.z]; };
    const road = new CGB(), sc = new CGB(), glow = new CGB(), far = new CGB();
    const STEP = 2, N = Math.round(lp.L / STEP);
    const kAt = s => ROAD.kappa(s);
    const strip = (gb, s, d0, d1, y0, y1, col, len = STEP) => gb.quad(P(s, d0, y0), P(s + len, d0, y0), P(s + len, d1, y1), P(s, d1, y1), col);
    // is (x, z) at least `gap` metres off the track everywhere (the track's own run-off counts as track)?
    const clear = (x, z, gap) => { const pr = ROAD.project(x, z); return Math.abs(pr.d) > wD(pr.s, pr.d < 0 ? -1 : 1) + gap; };
    const used = [];                                   // footprints already taken: [x, z, r]
    const free = (x, z, r) => used.every(([ux, uz, ur]) => Math.hypot(ux - x, uz - z) > ur + r);
    const take = (x, z, r) => used.push([x, z, r]);

    // ---- the track surface: asphalt, edge lines, kerbs in the corners, run-off (gravel traps / painted tarmac), walls ----
    // (each side's wall distance changes along the lap, so these pieces go from (s, dA) to (s + STEP, dB))
    const band = (gb, s, a0, a1, b0, b1, y, col) => gb.quad(P(s, a0, y), P(s + STEP, b0, y), P(s + STEP, b1, y), P(s, a1, y), col);
    const verge = street ? COL(0xa9abaf) : TH.flora === 'snow' ? COL(0xe3e9ee) : TH.flora === 'desert' ? COL(0xcfb07a) : COL(0x5f9442);   // (street: pavement)
    const sand = TH.flora === 'snow' ? [COL(0xcfc8b8), COL(0xcbc4b3)] : [COL(0xd9bd86), COL(0xd5b882)];   // (two very close tones: an even gravel bed)
    for (let i = 0; i < N; i++) {
      const s = i * STEP, k = Math.abs(kAt(s + 1)), corner = k > 1 / 260, alt = (i % 2) === 0;
      strip(road, s, -asp - 0.05, asp + 0.05, 0.03, 0.03, RC.asphalt);
      for (const sg of [-1, 1]) {
        const a = sg * (asp - 0.32), b = sg * (asp - 0.12);
        strip(road, s, Math.min(a, b), Math.max(a, b), 0.045, 0.045, RC.line);
        // kerb (corners), then 2 m of tarmac, then a gravel trap or painted run-off out to the wall
        const k0 = sg * asp, k1 = sg * (asp + 1.3), w0 = wD(s, sg), w1 = wD(s + STEP, sg), g = gravel(s + 1, sg);
        if (corner) for (const h of [0, 1]) strip(road, s + h, Math.min(k0, k1), Math.max(k0, k1), sg < 0 ? 0.07 : 0.04, sg < 0 ? 0.04 : 0.07, h ? RC.kerbW : RC.kerbR, 1);   // (1 m red / white blocks)
        else strip(road, s, Math.min(k0, k1), Math.max(k0, k1), 0.032, 0.032, RC.asphalt);
        const t1 = sg * (asp + 3.3);
        strip(road, s, Math.min(k1, t1), Math.max(k1, t1), 0.031, 0.031, street ? RC.asphalt : RC.runoff2);
        const surf = street ? RC.asphalt : g ? sand[rnd() < 0.5 ? 0 : 1] : RC.runoff2;
        if (sg > 0) band(road, s, t1, w0, t1, w1, g ? 0.04 : 0.029, surf); else band(road, s, -w0, t1, -w1, t1, g ? 0.04 : 0.029, surf);
        // beyond the wall: a strip of verge
        if (sg > 0) band(road, s, w0 + 0.4, w0 + 7, w1 + 0.4, w1 + 7, 0.012, verge); else band(road, s, -w0 - 7, -w0 - 0.4, -w1 - 7, -w1 - 0.4, 0.012, verge);
        // the wall: tyres behind a gravel trap, otherwise concrete with a red / white top band (and sponsor panels on the straights)
        const tyres = g, th = tyres ? 0.75 : 0.35, yT = tyres ? 1.0 : street ? 1.15 : 0.95;
        const blk = Math.floor(s / 30), spon = !tyres && (street || !corner) && ((blk + (sg > 0 ? 1 : 0)) % 5 === 0), sCol = RC.sponsor[(blk * 7 + (sg > 0 ? 3 : 0)) % 6];
        const face = tyres ? ((i % 2) ? RC.tyre : RC.tyre2) : spon ? sCol : RC.wall, lett = ((s % 30) > 4 && (s % 30) < 26 && i % 3 !== 0) ? RC.wallW : sCol;
        const top = Math.floor(i / 2) % 2 ? RC.wallR : RC.wallW;
        const A = (d0, d1, y0, y1, col) => sc.quad(P(s, sg * d0, y0), P(s + STEP, sg * d1, y0), P(s + STEP, sg * d1, y1), P(s, sg * d0, y1), col);
        A(w0, w1, 0, yT * 0.62, face);
        if (spon) A(w0 - 0.01, w1 - 0.01, 0.2, 0.42, lett);
        A(w0, w1, yT * 0.62, yT, top);
        sc.quad(P(s, sg * w0, yT), P(s + STEP, sg * w1, yT), P(s + STEP, sg * (w1 + th), yT), P(s, sg * (w0 + th), yT), tyres ? RC.tyre : RC.wall);
        A(w0 + th, w1 + th, 0, yT, face);
        // catch fence above it (posts every 6 m, three wires)
        if (i % 3 === 0) { const q = P(s, sg * (w0 + th + 0.1), 0); sc.geom(G.box, xf(q[0], 2.4, q[2], 0, -ROAD.yaw(s), 0.1, 4.8, 0.1), RC.fence); }
        for (const y of [2.0, 3.2, 4.5]) A(w0 + th + 0.1, w1 + th + 0.1, y, y + 0.05, RC.fence);
      }
    }
    // ---- start / finish: chequered line, grid boxes, the gantry with the start lights ----
    for (let c = 0; c < 15; c++) for (let r = 0; r < 2; r++) {
      const d0 = -asp + c * (2 * asp / 15), d1 = d0 + 2 * asp / 15, s0 = -1 + r;
      road.quad(P(s0, d0, 0.05), P(s0 + 1, d0, 0.05), P(s0 + 1, d1, 0.05), P(s0, d1, 0.05), (c + r) % 2 ? RC.checkB : RC.checkW);
    }
    for (let g = 0; g < Tracks.RACE_MAX; g++) {
      const gp = Race.gridSpot(g), sF = gp.s + 2.6;
      road.quad(P(sF, gp.d - 1.4, 0.05), P(sF + 0.2, gp.d - 1.4, 0.05), P(sF + 0.2, gp.d + 1.4, 0.05), P(sF, gp.d + 1.4, 0.05), RC.line);
      for (const e of [-1.4, 1.2]) road.quad(P(sF - 3, gp.d + e, 0.05), P(sF + 0.2, gp.d + e, 0.05), P(sF + 0.2, gp.d + e + 0.2, 0.05), P(sF - 3, gp.d + e + 0.2, 0.05), RC.line);
    }
    {
      const sG = 6, yaw = -ROAD.yaw(sG);
      const gL = wD(sG, -1) + 1.2, gR = wD(sG, 1) + 1.2;
      for (const d of [-gL, gR]) { const q = P(sG, d, 0); sc.geom(G.box, xf(q[0], 4, q[2], 0, yaw, 0.7, 8, 0.7), RC.stand); }
      const c = P(sG, (gR - gL) / 2, 0);
      sc.geom(G.box, xf(c[0], 7.6, c[2], 0, yaw, gL + gR + 0.8, 0.9, 0.9), RC.standDark);
      // the start lights, like the real ones: a panel hanging under the gantry (centred on the road) with five black
      // pods side by side, each with two round lamps (a little sun visor over each). Both lamps of each pod light red,
      // pod by pod; at the start every lamp turns green. (local x = across, z = along the track)
      const panel = P(sG, 0, 0);
      sc.geom(G.box, xf(panel[0], 6.15, panel[2], 0, yaw, 6.8, 1.9, 0.25), RC.standDark);  // backplate / frame
      this.lightMats = [];
      const lampGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.08, 14).rotateX(Math.PI / 2), rows = [6.4, 5.68];   // (two rows, both red)
      for (let i = 0; i < 5; i++) {
        const d = -2.6 + i * 1.3, pod = P(sG - 0.35, d, 0);
        sc.geom(G.box, xf(pod[0], 6.04, pod[2], 0, yaw, 1.0, 1.6, 0.45), RC.checkB);          // pod (black)
        rows.forEach((y, row) => {
          const m = new THREE.MeshBasicMaterial({ color: 0x2a0b0b, fog: false }), q = ROAD.pos(sG - 0.6, d);
          const lamp = new THREE.Mesh(lampGeo, m); lamp.position.set(q.x, y, q.z); lamp.rotation.y = yaw;
          this.lightMats.push({ m, pod: i, red: true }); (this._lamps = this._lamps || []).push(lamp);
          const h = P(sG - 0.78, d, 0); sc.geom(G.box, xf(h[0], y + 0.29, h[2], 0.35, yaw, 0.6, 0.04, 0.34), RC.checkB);   // visor
        });
      }
    }
    // ---- the main straight: grandstand on the outside (left), pit lane + pit building on the infield ----
    let sA = 0, sB = 0;
    while (sA > -600 && Math.abs(kAt(sA - 2)) < 1 / 300) sA -= 2;
    while (sB < 600 && Math.abs(kAt(sB + 2)) < 1 / 300) sB += 2;
    sA += 20; sB -= 20;
    // (always a proper main straight's worth: on Airfield / Sao Paulo the start line sits near a bend, which made sB < sA -
    //  no stand or pit building at all, just the pit building's two end walls standing on their own)
    if (sB - sA < 160) { const m = Math.max(40, (sA + sB) / 2); sA = m - 100; sB = m + 80; }
    const wMax = (s0, s1, side) => { let m = 0; for (let s = s0; s <= s1; s += 4) m = Math.max(m, wD(s, side)); return m; };
    const stand = (s0, s1, side, rows, roofed, gap = 5.5) => {
      // grandstand following the track behind its wall: stepped rows of red / white seats
      const d0 = side * (wMax(s0, s1, side) + gap), rowD = 0.95, rowH = 0.55;
      for (let s = s0; s < s1; s += STEP) {
        const len = Math.min(STEP, s1 - s);
        for (let r = 0; r < rows; r++) {
          const da = d0 + side * r * rowD, db = da + side * rowD, y = 0.6 + r * rowH;
          const lo = Math.min(da, db), hi = Math.max(da, db);
          sc.quad(P(s, da, y - rowH), P(s + len, da, y - rowH), P(s + len, da, y), P(s, da, y), RC.standDark);   // riser
          sc.quad(P(s, lo, y), P(s + len, lo, y), P(s + len, hi, y), P(s, hi, y), r % 2 ? RC.seatW : RC.seatR);    // seats
        }
        // back wall + supports
        const dBack = d0 + side * rows * rowD, top = 0.6 + rows * rowH;
        sc.quad(P(s, dBack, 0), P(s + len, dBack, 0), P(s + len, dBack, top + 0.4), P(s, dBack, top + 0.4), RC.stand);
        sc.quad(P(s, d0, 0), P(s + len, d0, 0), P(s + len, d0, 0.6), P(s, d0, 0.6), RC.wallR);
        if (roofed) {
          const yR = top + 3.2, dIn = d0 + side * 0.5;
          // (wound so its face points up, whichever side of the track the stand is on: lit by the sky, not the ground)
          const r0 = P(s, dIn, yR - 0.4), r1 = P(s + len, dIn, yR - 0.4), r2 = P(s + len, dBack + side * 0.5, yR + 0.6), r3 = P(s, dBack + side * 0.5, yR + 0.6);
          if (side < 0) sc.quad(r0, r1, r2, r3, RC.roof); else sc.quad(r0, r3, r2, r1, RC.roof);
          const lo = q => [q[0], q[1] - 0.12, q[2]];          // underside: steel grey, facing down
          if (side < 0) sc.quad(lo(r0), lo(r3), lo(r2), lo(r1), RC.roofUnder); else sc.quad(lo(r0), lo(r1), lo(r2), lo(r3), RC.roofUnder);
          if (Math.round(s / STEP) % 6 === 0) { const q = P(s, dBack, 0); sc.geom(G.box, xf(q[0], yR / 2 + 0.3, q[2], 0, -ROAD.yaw(s), 0.3, yR + 0.6, 0.3), RC.stand); }
        }
      }
      for (let s = s0; s <= s1; s += 10) { const q = P(s, d0 + side * rows * rowD / 2, 0); take(q[0], q[2], rows * rowD / 2 + 6); }
    };
    // only where a piece is clear of EVERY part of the track: trimmed back from the start line until a stretch of it would
    // come near another bit of track (Ardennes: the hairpin right after the start folds back beside the pits)
    const fitRun = (dNear, dFar) => {
      const ok = s => [dNear, (dNear + dFar) / 2, dFar].every(d => {
        const q = P(s, d, 0), pr = ROAD.project(q[0], q[2], null, s);
        return clear(q[0], q[2], 1.5) && Math.abs(ROAD.near(pr.s, s) - s) < 12;
      });
      const m0 = U.clamp(10, sA, sB); let a = m0, b = m0;
      while (a - STEP >= sA && ok(a - STEP)) a -= STEP;
      while (b + STEP <= sB && ok(b + STEP)) b += STEP;
      return b - a >= 40 ? [a, b] : null;
    };
    // main grandstand: two tiers, roofed
    { const wL = wMax(sA, sB, -1), run = fitRun(-(wL + 5), -(wL + 23)); if (run) stand(run[0], run[1], -1, 14, true); }
    // pit lane, pit wall and the pit building (garages facing the track) on the right
    // (the pit lane sits right behind the wall: checked from 2.5 m out. Where the infield is narrow - Ardennes' return
    //  straight runs close alongside - a slimmer pit building that still fits)
    //  (the wall is measured around the start line: Ardennes has a wide run-off behind the grid that pushed the pits out)
    const wP = wMax(Math.max(sA, -10), Math.min(sB, 90), 1), pitFull = fitRun(wP + 2.5, wP + 25), pitRun = pitFull || fitRun(wP + 2.5, wP + 18);
    if (pitRun) {
      const dL0 = wP + 0.4, dL1 = wP + 9, dB0 = wP + 9.5, dB1 = pitFull ? wP + 24 : wP + 17;
      const [sA, sB] = pitRun;                           // (this block only: the pits' own clear stretch)
      for (let s = sA; s < sB; s += STEP) {
        strip(road, s, dL0, dL1, 0.03, 0.03, RC.pitLane);
        sc.quad(P(s, dB0, 0), P(s + STEP, dB0, 0), P(s + STEP, dB0, 3.6), P(s, dB0, 3.6), Math.floor(s / 12) % 2 ? RC.pitDoor : RC.pit);   // garages
        sc.quad(P(s, dB0, 3.6), P(s + STEP, dB0, 3.6), P(s + STEP, dB0, 5.4), P(s, dB0, 5.4), RC.pitGlass);   // windows (team rooms)
        sc.quad(P(s, dB0, 5.4), P(s + STEP, dB0, 5.4), P(s + STEP, dB0, 7.2), P(s, dB0, 7.2), RC.pit);
        sc.quad(P(s, dB0, 7.2), P(s + STEP, dB0, 7.2), P(s + STEP, dB1, 7.2), P(s, dB1, 7.2), RC.roof);
        sc.quad(P(s, dB1, 0), P(s + STEP, dB1, 0), P(s + STEP, dB1, 7.2), P(s, dB1, 7.2), RC.pit);
      }
      for (const s of [sA, sB]) sc.quad(P(s, dB0, 0), P(s, dB1, 0), P(s, dB1, 7.2), P(s, dB0, 7.2), RC.pit);
      for (let s = sA; s <= sB; s += 10) { const q = P(s, (dB0 + dB1) / 2, 0); take(q[0], q[2], 13); }
      // team trucks behind
      for (let s = sA + 8; s < sB - 8; s += 22) { const q = P(s, dB1 + 9, 0); if (!clear(q[0], q[2], 9) || !free(q[0], q[2], 8)) continue; sc.geom(G.box, xf(q[0], 1.9, q[2], 0, -ROAD.yaw(s), 2.5, 3.8, 14), RC.sponsor[Math.floor(rnd() * 7)], rnd, 0.04); take(q[0], q[2], 9); }
    }
    // ---- corners: a grandstand on the outside of every big corner, tyre walls already on the wall line ----
    const corners = [];
    for (let s = 0; s < lp.L; s += 4) {
      const k = Math.abs(kAt(s));
      if (k > 1 / 180 && k >= Math.abs(kAt(s - 8)) && k >= Math.abs(kAt(s + 8))) { if (!corners.length || s - corners[corners.length - 1].s > 60) corners.push({ s, k: kAt(s) }); }
    }
    const fits = (s0, s1, side, depth, gap) => {
      for (let s = s0; s <= s1; s += 8) for (const dd of [0, depth / 2, depth]) {
        const q = P(s, side * (wMax(s0, s1, side) + gap + dd), 0);
        if (!clear(q[0], q[2], gap - 0.5) || !free(q[0], q[2], 2)) return false;
        // (the point must belong to this part of the track: inside a tight bend it would fold back over itself)
        const pr = ROAD.project(q[0], q[2], null, s); if (Math.abs(ROAD.near(pr.s, s) - s) > 25) return false;
      }
      return true;
    };
    for (const c of corners) {
      const side = c.k > 0 ? -1 : 1;                      // (right-hand bend: the outside is on the left)
      for (const half of [55, 40, 26]) {
        if (fits(c.s - half, c.s + half, side, 9, 7)) { stand(c.s - half, c.s + half, side, 8, half >= 40, 7); break; }
      }
      // and a smaller one on the inside, if there's room
      if (fits(c.s - 18, c.s + 18, -side, 6, 9)) stand(c.s - 18, c.s + 18, -side, 6, false, 9);
    }
    // ---- straights: more grandstands every ~90 m, alternating sides (the other side if one doesn't fit) ----
    for (let s = sB + 90, n = 0; s < lp.L + sA - 60; s += 90) {
      if (Math.abs(kAt(s)) > 1 / 300) continue;
      const pref = (n++ % 2) ? 1 : -1;
      for (const side of [pref, -pref]) if (fits(s - 28, s + 28, side, 8, 7)) { stand(s - 28, s + 28, side, 6 + (n % 3), n % 4 === 0, 7); break; }
    }
    // ---- everything else along the lap: sponsor boards, tents, marshal posts, camera towers, light towers ----
    const facing = (s, d, w, h, y0, col, gb = sc) => {   // a flat board facing the track, w wide, from y0 up to y0 + h
      gb.quad(P(s - w / 2, d, y0), P(s + w / 2, d, y0), P(s + w / 2, d, y0 + h), P(s - w / 2, d, y0 + h), col);
    };
    for (let s = 0; s < lp.L; s += 14) for (const side of [-1, 1]) {
      const pick = rnd(), d = side * (wD(s, side) + 2.2 + rnd() * 1.5), q = P(s, d, 0);
      if (!clear(q[0], q[2], 1.5) || !free(q[0], q[2], 3)) continue;
      const yaw = -ROAD.yaw(s);
      if (pick < 0.45) {                                 // sponsor boards: a coloured panel with white "lettering"
        const col = RC.sponsor[Math.floor(rnd() * 7)], w = 7 + rnd() * 5;
        facing(s, d, w, 1.6, 0.4, col);
        const txt = col === RC.sponsor[6] ? RC.sponsor[0] : RC.wallW;
        for (let k = 0; k < 4; k++) { const ww = w * (0.12 + rnd() * 0.08), o = -w * 0.38 + k * w * 0.25; facing(s + o, d - side * 0.03, ww, 0.5, 0.95, txt); }
        sc.quad(P(s - w / 2, d + side * 0.25, 0.4), P(s + w / 2, d + side * 0.25, 0.4), P(s + w / 2, d + side * 0.25, 2.0), P(s - w / 2, d + side * 0.25, 2.0), RC.standDark);
        take(q[0], q[2], w / 2);
      } else if (pick < 0.6) {                           // marshal post: small orange hut on stilts
        sc.geom(G.box, xf(q[0], 1.5, q[2], 0, yaw, 2, 1.6, 2), RC.marshal); sc.geom(G.box, xf(q[0], 2.4, q[2], 0, yaw, 2.4, 0.15, 2.4), RC.wallW);
        take(q[0], q[2], 2.5);
      } else if (pick < 0.72) {                          // TV camera tower
        const q2 = P(s, d + side * 3, 0);
        sc.geom(G.box, xf(q2[0], 3, q2[2], 0, yaw, 0.25, 6, 0.25), RC.tower); sc.geom(G.box, xf(q2[0], 6.2, q2[2], 0, yaw, 1.8, 0.2, 1.8), RC.tower);
        sc.geom(G.box, xf(q2[0], 6.8, q2[2], 0, yaw, 0.6, 0.6, 1.0), RC.checkB); take(q2[0], q2[2], 2);
      } else if (pick < 0.86) {                          // hospitality tent (peaked roof)
        const q2 = P(s, d + side * 6, 0), col = [RC.tentA, RC.tentB, RC.tentC][Math.floor(rnd() * 3)];
        if (!free(q2[0], q2[2], 5)) continue;
        sc.geom(G.box, xf(q2[0], 1.2, q2[2], 0, yaw, 6, 2.4, 6), RC.tentA);
        sc.geom(G.cone6, xf(q2[0], 3.4, q2[2], 0, yaw + Math.PI / 4, 4.6, 2.2, 4.6), col);
        take(q2[0], q2[2], 5);
      } else {                                           // light tower (lit at night)
        const q2 = P(s, d + side * 4, 0);
        sc.geom(G.taper8, xf(q2[0], 9, q2[2], 0, yaw, 0.3, 18, 0.3), RC.tower);
        sc.geom(G.box, xf(q2[0], 18.4, q2[2], 0, yaw, 3, 1.2, 0.5), RC.standDark);
        glow.geom(G.box, xf(q2[0] - side * 0, 18.4, q2[2], 0, yaw, 2.6, 0.9, 0.56), RC.lamp);
        take(q2[0], q2[2], 2);
      }
    }
    // ---- trees, buildings and hills fill the land around the track (inside and out) ----
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    const block = (gb, x, z, yaw, w, h, dp) => {          // a city / office building with window bands
      gb.geom(G.box, xf(x, h / 2, z, 0, yaw, w, h, dp), RC.build[Math.floor(rnd() * RC.build.length)], rnd, 0.04);
      for (let f = 2.2; f < h - 1; f += 3.2) gb.geom(G.box, xf(x, f + 0.6, z, 0, yaw, w + 0.06, 1.1, dp + 0.06), RC.glass);
    };
    // street circuit: rows of buildings right behind the walls, like a city
    if (street) for (let s = 0; s < lp.L; s += 22) for (const side of [-1, 1]) {
      const w = 16 + rnd() * 6, dp = 12 + rnd() * 10, h = 9 + rnd() * 30, d = side * (wD(s, side) + 7 + dp / 2), q = P(s, d, 0), r = Math.hypot(w, dp) / 2;
      if (!clear(q[0], q[2], 3 + dp / 2) || !free(q[0], q[2], r * 0.8)) continue;
      const pr = ROAD.project(q[0], q[2], null, s); if (Math.abs(ROAD.near(pr.s, s) - s) > 20) continue;
      block(sc, q[0], q[2], -ROAD.yaw(s), w, h, dp); take(q[0], q[2], r * 0.8);
    }
    const treeBand = [];                                 // (planted after `tree` is defined below)
    for (let s = 0; s < lp.L; s += street ? 30 : 6) for (const side of [-1, 1]) {
      const d = side * (wD(s, side) + 12 + rnd() * 30), q = P(s + rnd() * 6, d, 0);
      if (!clear(q[0], q[2], 10) || !free(q[0], q[2], 3)) continue;
      treeBand.push(q); take(q[0], q[2], 2.5);
    }
    for (let i = 0; i < lp.N; i++) { x0 = Math.min(x0, lp.X[i]); x1 = Math.max(x1, lp.X[i]); z0 = Math.min(z0, lp.Z[i]); z1 = Math.max(z1, lp.Z[i]); }
    const tree = (gb, p, sz) => {
      if (TH.flora !== 'grass') { world.themedPlant(TH, gb, p, sz, rnd(), rnd); return; }
      if (rnd() < 0.5) {
        gb.geom(G.cyl5, xf(p[0], sz - 0.1, p[2], 0, 0, 0.22 * sz, 2 * sz + 0.2, 0.22 * sz), WC.trunk, rnd);
        gb.geom(G.cone6, xf(p[0], 3.4 * sz, p[2], 0, rnd() * 3, 2.3 * sz, 4.2 * sz, 2.3 * sz), WC.pine, rnd, 0.12);
        gb.geom(G.cone6, xf(p[0], 5.5 * sz, p[2], 0, rnd() * 3, 1.6 * sz, 3.2 * sz, 1.6 * sz), WC.pine, rnd, 0.12);
      } else {
        gb.geom(G.cyl5, xf(p[0], 1.2 * sz - 0.1, p[2], 0, 0, 0.25 * sz, 2.4 * sz + 0.2, 0.25 * sz), WC.trunk, rnd);
        gb.geom(G.ico0, xf(p[0], 3.6 * sz, p[2], rnd(), rnd() * 3, 2.3 * sz, 2.1 * sz, 2.3 * sz), rnd() < 0.5 ? WC.leafA : WC.leafC, rnd, 0.12);
      }
    };
    for (const q of treeBand) tree(sc, q, 0.85 + rnd() * 0.8);
    const area = (x1 - x0 + 600) * (z1 - z0 + 600), nTrees = Math.min(4000, Math.round(area / (street ? 4000 : 520)));
    for (let i = 0; i < nTrees; i++) {
      const x = x0 - 300 + rnd() * (x1 - x0 + 600), z = z0 - 300 + rnd() * (z1 - z0 + 600);
      const pr = ROAD.project(x, z), ad = Math.abs(pr.d);
      if (ad < wD(pr.s, pr.d < 0 ? -1 : 1) + 16 || ad > 420 || !free(x, z, 3)) continue;
      if (ad < 60 && rnd() < 0.35) continue;
      const gb = ad > 120 ? far : sc;
      // clusters: a few trees together
      const n = 1 + Math.floor(rnd() * 4);
      for (let j = 0; j < n; j++) {
        const px = x + (rnd() - 0.5) * 14, pz = z + (rnd() - 0.5) * 14;
        if (!clear(px, pz, 14)) continue;
        tree(gb, [px, 0, pz], 0.8 + rnd() * 0.9);
      }
    }
    // buildings: team hospitality / offices close in, a few taller ones further out
    for (let i = 0; i < (street ? 700 : 40); i++) {
      const x = x0 - 200 + rnd() * (x1 - x0 + 400), z = z0 - 200 + rnd() * (z1 - z0 + 400);
      const pr = ROAD.project(x, z), ad = Math.abs(pr.d);
      const w = 10 + rnd() * 18, dp = 8 + rnd() * 14, h = street ? 10 + rnd() * (ad > 100 ? 45 : 28) : 4 + rnd() * 5, r = Math.hypot(w, dp) / 2;
      if (ad < wD(pr.s, pr.d < 0 ? -1 : 1) + (street ? 10 : 22) + r || ad > 360 || !free(x, z, r + (street ? 2 : 4))) continue;
      block(ad > 120 ? far : sc, x, z, -ROAD.yaw(pr.s), w, h, dp);
      take(x, z, r + 2);
    }
    // hills all around, beyond everything
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, R0 = Math.max(x1 - x0, z1 - z0) / 2 + 420;
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * Math.PI * 2 + rnd() * 0.2, r = R0 + rnd() * 300, rad = 160 + rnd() * 160, hh = (60 + rnd() * 120) * TH.hillH;
      far.geom(G.ico1, xf(cx + Math.cos(a) * r, -hh * 0.2, cz + Math.sin(a) * r, 0, rnd() * 3, rad, hh, rad * (0.8 + rnd() * 0.4)), TH.mtn[Math.floor(rnd() * 3)], rnd, 0.09,
        TH.farTop ? v => (v.y > 0.75 ? TH.farTop : null) : undefined);
    }

    // ---- checkpoint gantries (Race.CP per lap, the first is the start / finish line): a POLYWEAVE gantry over the track
    // at each one - the live timing gaps are taken there (Race.cpFeed)
    this._banners = [];
    for (let k = 1; k < Race.CPV; k++) {
      const s = k * lp.L / Race.CPV, dl = wD(s, -1) + 1.6, dr = wD(s, 1) + 1.6, y = -ROAD.yaw(s), span = dl + dr + 1.4, c = P(s, (dr - dl) / 2, 0);
      sc.geom(G.box, xf(c[0], 6.6, c[2], 0, y, span, 0.45, 2.6), RC.standDark);           // beam (local x = across the track)
      sc.geom(G.box, xf(c[0], 7.95, c[2], 0, y, span, 2.3, 2.2), RC.standDark);          // sign board (tall: big lettering)
      for (const d of [-dl - 0.5, dr + 0.5]) { const q = P(s, d, 0); sc.geom(G.box, xf(q[0], 4.5, q[2], 0, y, 0.9, 9, 0.9), RC.stand); }
      this._banners.push([s, (dr - dl) / 2, span - 0.6, 0], [s, (dr - dl) / 2, span - 0.6, Math.PI]);
    }
    const grp = new THREE.Group();
    // cut into 250 m tiles so only what the camera (and the sun's shadow camera) can see gets drawn
    for (const m of this.tiles(road, world.roadMat, 250)) { m.receiveShadow = true; grp.add(m); }
    for (const m of this.tiles(sc, world.mat, 250)) { m.castShadow = true; m.receiveShadow = true; grp.add(m); }
    for (const m of this.tiles(far, world.mat, 600)) { m.receiveShadow = true; grp.add(m); }
    if (glow.len) grp.add(new THREE.Mesh(glow.build(), world.glowMat));
    for (const l of this._lamps || []) grp.add(l);
    this._lamps = null;
    // the PolyWeave banner across the start gantry, facing the grid
    grp.add(this.banner('POLYWEAVE', 6.4, 0.85, '#16181d', '#ffd84a', 6, 7.6, Math.PI));
    grp.add(this.banner('SEASON 1', 6.4, 0.85, '#16181d', '#ffffff', 6.4, 7.6, 0));
    for (const [s, d, w, flip] of this._banners) {       // (checkpoint gantries: the banner on both faces)
      const b = this.banner('POLYWEAVE.ORG', w, 2.1, '#16181d', '#ffd84a', s, 7.95, flip, true), q = ROAD.pos(s, d);
      b.position.x = q.x; b.position.z = q.z; b.translateZ(1.12); grp.add(b);
    }
    this._banners = null;
    scene.add(grp);
    this.group = grp;
    this.built = { sA, sB, pit: pitRun };
    return grp;
  },
  // split a builder's triangles into square tiles (by each triangle's centre) -> one mesh per tile
  tiles(gb, mat, size) {
    const P = gb.P, C = gb.C, Nn = gb.N, n = gb.len, buckets = new Map();
    for (let i = 0; i < n; i += 9) {
      const cx = (P[i] + P[i + 3] + P[i + 6]) / 3, cz = (P[i + 2] + P[i + 5] + P[i + 8]) / 3, key = Math.floor(cx / size) * 100003 + Math.floor(cz / size);
      let b = buckets.get(key); if (!b) buckets.set(key, (b = [])); b.push(i);
    }
    const out = [];
    for (const idx of buckets.values()) {
      const m = idx.length * 9, p = new Float32Array(m), c = new Float32Array(m), nr = new Float32Array(m);
      idx.forEach((i, k) => { p.set(P.subarray(i, i + 9), k * 9); c.set(C.subarray(i, i + 9), k * 9); nr.set(Nn.subarray(i, i + 9), k * 9); });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
      g.computeBoundingSphere();
      out.push(new THREE.Mesh(g, mat));
    }
    return out;
  },
  // a text banner (canvas texture) across the track at s, facing back down the track (flip = PI faces the grid)
  banner(text, w, h, bg, fg, s, y, flip, once = false) {
    // (the canvas keeps the banner's shape, so a long banner isn't stretched: the text repeats, or with `once` it's
    //  written a single time, bigger, in the middle)
    const c = document.createElement('canvas'); c.width = Math.min(2048, Math.max(512, Math.round(68 * w / h))); c.height = 68;
    const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, c.width, 68);
    g.fillStyle = fg; g.font = once ? '900 60px Segoe UI, Arial' : '900 52px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = once ? 1 : Math.max(1, Math.round(c.width / 512));
    for (let i = 0; i < n; i++) g.fillText(text, (i + 0.5) * c.width / n, 37);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    const q = ROAD.pos(s, 0); m.position.set(q.x, y, q.z); m.rotation.y = -ROAD.yaw(s) + flip;
    return m;
  },
  // start lights: n lit (0..5), red; 'go' = all green (the start)
  setLights(n) { for (const L of this.lightMats) L.m.color.setHex(n === 'go' ? 0x22ff66 : L.red && L.pod < n ? 0xff1a1a : 0x2a0b0b); },
};

// ---------------------------------------------------------------- the race itself
const Race = {
  active: false, kind: null,       // kind: 'tt' (time trial, singleplayer) | 'mp'
  track: null, laps: Tracks.RACE_LAPS, theme: 'grass', tod: 'day',
  st: 'free',                      // mp: 'lobby' | 'countdown' | 'grid' | 'racing' | 'results'
  frozen: false, clock: 0,
  // where grid spot g is (0 = pole): two columns, staggered, behind the line
  gridSpot(g) { return { s: -12 - g * 7, d: (g % 2 ? 1 : -1) * 3.2 }; },

  // ---------------- entering / leaving
  setup(track, theme, tod) {
    this.track = track; this.theme = theme; this.tod = tod;
    ROAD.setTrack(track); ZONES.setLoop(0);
    world.raceOn = true; world.reset(); zoneProps.reset();
    setWorld(theme, tod); world.ground.material.color.set(world.th.ground);
    traffic.clear(); traffic.remote = false;
    RaceWorld.build(theme);
    RaceWorld.setLights(0);
    if (ROAD.loop.track.street) world.ground.material.color.set(theme === 'snow' ? 0xd5dade : 0x8d9096);   // (street circuit: the city is paved)
    F1Mode.enable(); showF1(true);                     // (racing is always in the F1 car, with its own physics)
    Net.setModel(f1Livery());                          // (other racers draw your F1 paint pattern from this)
    this.active = true; document.body.classList.add('raceMode');
    lockLaneAssist(true);
    this.best = this.loadBest(); this.ghost = this.loadGhost(); this.rec = null; this.last = null; this.lapT0 = null; this.sec = 0; this.valid = true;
    this.results = null; this.finished = null; this.myGrid = -1;
    $id('raceResults').classList.add('hidden');
  },
  exit() {
    if (!this.active) return;
    this.endFin();
    if (this.ghostCar) { scene.remove(this.ghostCar.root); this.ghostCar = null; }   // (rebuilt next time, in the Garage's current look)
    this.active = false; this.kind = null; this.st = 'free'; this.frozen = false; Net.silent = false;
    document.body.classList.remove('raceMode');
    F1Mode.disable(); showF1(false); lockLaneAssist(false);
    Net.setModel(carKey);
    RaceWorld.clear();
    world.raceOn = false;
    world.ground.material.color.set(world.th.ground);
    ROAD.setTrack(null);
    $id('raceResults').classList.add('hidden'); $id('raceBanner').classList.add('hidden'); RaceLights.hide();
  },
  place(g, speed = 0) {
    const sp = this.gridSpot(g);
    car.place(sp.s, sp.d, speed); car.tc = Settings.tc; car.manual = Settings.manual; car.hitT = 0;
    car.s = sp.s; car.d = sp.d; ROAD.hintS = sp.s;
    steerCtl.key = 0; steerCtl.k1 = 0; steerCtl.wheelF = 0; steerCtl.kAl = 0; steerCtl.k1v = 0; steerCtl.kAlv = 0;
    camS.yaw = car.yaw; camS.shift = 0;
    Object.assign(proxy, { s: car.s, d: car.d, v: speed });
    this.lapIdx = Math.floor(car.s / ROAD.loop.L); this.lapT0 = null; this.sec = 0; this.valid = true; this.standing = false;
    this.gridPos = { x: car.x, z: car.z };
    warmUp();
  },
  // the clock everything is timed on: real time (a slow frame rate or slow-motion can't shrink a lap; the server
  // checks lap splits against its own clock). Pausing a time trial doesn't stop the lap.
  now() { return performance.now() / 1000; },
  // start lights: from `lightsAt` one red light comes on each second; all five go out at `goAt` (after a random
  // pause, like the real thing) and that's the start. Moving before that is a jump start.
  armStart(lightsAt, goAt) {
    this.lightsAt = lightsAt; this.goAt = goAt; this.started = false; this.jump = false;
  },
  // singleplayer time trial: standing start on pole with the lights; lap 1 runs from lights out, then flying laps
  startTT(track, theme, tod) {
    this.setup(track, theme, tod);
    this.kind = 'tt'; this.st = 'tt';
    this.ttGrid();
  },
  ttGrid() {
    this.place(0);
    this.fetchToken(); this.split = []; this.rec = null; // (a fresh lap token for each attempt: its sector times start empty)
    const t = this.now(); this.armStart(t + 1.5, t + 1.5 + 5 + 0.3 + Math.random() * 2.2);
    this.penLap = 0; this.resetPenalties();
    hud.message('TIME TRIAL · GO ON GREEN');
  },
  // a multiplayer race room (queue or hosted): practice in the lobby until the race
  enterMp(room, slot) {
    this.setup(room.race.track, room.theme, room.tod);
    this.kind = 'mp'; this.st = 'lobby'; this.laps = room.race.laps || Tracks.RACE_LAPS;
    this.place(slot % Tracks.RACE_MAX);
    this.goAt = undefined; this.started = true; this.resetPenalties();
    Net.silent = false;
  },
  // R / restart: back onto the track where you are, pointing the right way, stopped (time trial: back on the grid)
  reset() {
    if (this.fin && this.kind === 'mp') return;          // (race finish fly-by: the car comes back when the lobby opens)
    this.endFin();
    if (this.kind === 'tt') { this.ttGrid(); return; }
    if (this.st === 'grid') return;                     // (on the grid: stay in your box)
    const p = ROAD.project(car.x, car.z), d = U.clamp(p.d, -ROAD.LW * 1.5, ROAD.LW * 1.5);
    car.place(p.s, d, 0); car.s = p.s; car.d = d; car.hitT = 0;
    steerCtl.key = 0; steerCtl.k1 = 0; steerCtl.wheelF = 0; steerCtl.kAl = 0;
    camS.yaw = car.yaw; camS.shift = 0;
  },

  // ---------------- personal best lap (this device; signed in: the leaderboard's is kept in step)
  loadBest() { try { return +localStorage.getItem('pw_lap_' + this.track) || null; } catch (e) { return null; } },
  saveBest(ms) { this.best = ms; try { localStorage.setItem('pw_lap_' + this.track, ms); } catch (e) { /* ignore */ } },

  // ---------------- time trial ghost: your best lap, recorded (every 0.1 s: time, x, z, heading, distance) and
  // saved on this device per track. Settings "Ghost car" draws it as a see-through car; the timing tower always
  // compares you with it (how far ahead / behind, at the same point of the lap).
  ghost: null, rec: null, recT: 0, ghostCar: null,
  loadGhost() { try { const g = JSON.parse(localStorage.getItem('pw_ghost_' + this.track)); return g && g.ms && Array.isArray(g.p) && g.p.length > 50 ? g : null; } catch (e) { return null; } },
  saveGhost(ms) {
    if (!this.rec || this.rec.length < 250) return;     // (5 numbers a sample: needs a real lap's worth)
    const DP = [1000, 100, 100, 1000, 10];               // (rounding: time ms, x / z cm, heading, distance dm)
    const g = { ms, p: this.rec.map((v, i) => Math.round(v * DP[i % 5]) / DP[i % 5]) };
    this.ghost = g;
    try { localStorage.setItem('pw_ghost_' + this.track, JSON.stringify(g)); } catch (e) { /* storage full / blocked: kept for this visit */ }
  },
  // record while a time-trial lap runs (t = seconds since lights out)
  ghostRecord(dt, t) {
    if (!this.rec || (this.recT -= dt) > 0) return;
    this.recT = 0.1; this.rec.push(t, car.x, car.z, car.visYaw, car.s);
  },
  // where the ghost is at time t: [x, z, yaw] (between samples), or null before / after its lap
  ghostAt(t) {
    const p = this.ghost && this.ghost.p; if (!p) return null;
    const n = p.length / 5; if (t < p[0] || t > p[(n - 1) * 5]) return t < p[0] ? [p[1], p[2], p[3]] : null;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m * 5] <= t) lo = m; else hi = m; }
    const a = lo * 5, b = hi * 5, f = (t - p[a]) / Math.max(1e-6, p[b] - p[a]);
    return [p[a + 1] + (p[b + 1] - p[a + 1]) * f, p[a + 2] + (p[b + 2] - p[a + 2]) * f, p[a + 3] + U.wrap(p[b + 3] - p[a + 3]) * f];
  },
  // the ghost's time when it was where you are now (by distance round the lap), or null
  ghostTimeAt(s) {
    const p = this.ghost && this.ghost.p; if (!p) return null;
    const n = p.length / 5; if (s < p[4] || s > p[(n - 1) * 5 + 4]) return null;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m * 5 + 4] <= s) lo = m; else hi = m; }
    const a = lo * 5, b = hi * 5, f = (s - p[a + 4]) / Math.max(1e-6, p[b + 4] - p[a + 4]);
    return p[a] + (p[b] - p[a]) * f;
  },
  // the ghost: your own F1 car (paint, pattern, rims) but see-through; it appears when the lights go out (on the
  // grid it would sit inside your car). Built when first needed in each session, so Garage changes show.
  ghostShow(now) {
    const on = this.kind === 'tt' && Settings.ghost && this.ghost && !this.fin && this.started && this.lapT0 !== null;
    const q = on && this.ghostAt(now - this.lapT0);
    if (!q) { if (this.ghostCar) this.ghostCar.root.visible = false; return; }
    if (!this.ghostCar) {
      const c = f1Cfg(), see = m => Object.assign(m, { transparent: true, opacity: 0.45 });
      const paint = see(f1Paint.clone()); f1Pattern(paint, c.pattern, c.accent);   // (clone() drops the pattern shader: put it back)
      const rim = see(f1Rim.clone()), done = new Map([[paint, paint], [rim, rim]]);
      this.ghostCar = makeF1(paint, { rimStyle: c.rimStyle }, { rimMat: rim });
      this.ghostCar.root.traverse(o => {                // (every other part: its own see-through copy of the material)
        if (!o.isMesh) return;
        const m = o.material; if (!done.has(m)) done.set(m, see(m.clone()));
        o.material = done.get(m); o.castShadow = o.receiveShadow = false;
      });
      if (this.ghostCar.brake) this.ghostCar.brake.visible = false;
      scene.add(this.ghostCar.root);
    }
    const g = this.ghostCar.root;
    g.visible = true; g.position.set(q[0], 0, q[1]); g.rotation.y = -q[2];
  },

  // ---------------- penalties (F1-style, kept simple)
  //  - jump start: moving before the lights go out -> 5 s time penalty (time trial: +5 s on that lap)
  //  - track limits: all four wheels past the white line at the track's edge. Races: 3 warnings, then 5 s for
  //    each one after that. Time trial: no penalty, the run-off slows the car (main.js).
  //  - causing a collision: hitting the car in front hard -> 5 s
  // Race penalties are added to your race time at the finish.
  resetPenalties() { this.pen = 0; this.warn = 0; this.offArm = true; this.onT = 0; this.bumpT = -9; },
  penalty(sec, why) {
    if (this.kind === 'tt') return;
    this.pen += sec;
    hud.message(`${why} · ${sec} SECOND PENALTY`, true);
  },
  trackLimits(dt) {
    const limit = 2 * ROAD.LW + 0.78, ad = Math.abs(car.d);  // (centre this far out: all four wheels past the line)
    const racing = this.kind === 'mp' && this.st === 'racing' && this.myGrid >= 0 && !this.finished;
    if (ad > limit && Math.abs(car.u) > 11) {
      this.onT = 0;
      if (!this.offArm) return;
      this.offArm = false;
      if (this.kind === 'tt') return;                   // (time trial: no lap deleted - the grass / gravel slows you down instead: main.js)
      if (!racing) { hud.message('TRACK LIMITS'); return; }
      this.warn++;
      if (this.warn <= 3) hud.message(`TRACK LIMITS · WARNING ${this.warn}/3`, true);
      else this.penalty(5, 'TRACK LIMITS');
    } else if (ad < limit - 0.6 && (this.onT += dt) > 1) this.offArm = true;
  },
  // a hard hit on another driver (main.js): your fault if they were ahead of you
  onBump(v, id) {
    if (this.kind !== 'mp' || this.st !== 'racing' || this.myGrid < 0 || this.finished || v < 4) return;
    const p = Net.players.get(id); if (!p || !p.now) return;
    const now = performance.now() / 1000;
    if (p.now.s - car.s > 0.8 && now - this.bumpT > 5) { this.bumpT = now; this.penalty(5, 'CAUSING A COLLISION'); }
  },

  // ---------------- lap timing (called every frame after the car moved)
  // The lap line is at s = 0 (and every L after). The lap only counts if you passed both sector marks (a third
  // and two thirds of the way round) in order: driving backwards over the line cancels it. After a standing start
  // the first time over the line is just leaving the grid: lap 1 runs from the lights.
  timing(now) {
    if (!this.active || !ROAD.loop) return;
    const L = ROAD.loop.L, idx = Math.floor(car.s / L), into = car.s - idx * L;
    if (this.lapIdx === undefined) this.lapIdx = idx;
    if (idx < this.lapIdx) { this.valid = false; this.sec = 0; this.lapIdx = idx; return; }   // (went back over the line)
    if (idx > this.lapIdx) {                            // crossed the line going forward
      this.lapIdx = idx;
      if (this.standing) { this.standing = false; this.sec = 0; if (this.kind === 'mp' && this.st === 'racing' && this.myGrid >= 0) this.raceLine(now); return; }
      const run = this.lapT0 !== null, ms = run ? Math.round((now - this.lapT0) * 1000) : 0, ok = run && this.valid && this.sec === 2;
      this.lapT0 = now; this.sec = 0; this.valid = true;
      if (ok && this.kind === 'mp' && this.st === 'racing' && this.myGrid >= 0 && !this.finished) this.raceBest = Math.min(this.raceBest || 1e9, ms);   // (your best lap this race)
      if (ok) this.lapDone(ms);
      this.lapTop = 0;
      if (this.kind === 'mp' && this.st === 'racing' && this.myGrid >= 0) this.raceLine(now);
      return;
    }
    if (this.sec === 0 && into > L / 3 && into < L / 2) { this.sec = 1; this.sector(1, now); }
    else if (this.sec === 1 && into > 2 * L / 3) { this.sec = 2; this.sector(2, now); }
  },
  // time trial: lights out (k 0), a third (1) and two thirds (2) of the lap - the server notes its own time of
  // each on the lap token, and checks the lap's splits against them
  async sector(k, now) {
    if (this.kind !== 'tt' || this.lapT0 === null || (k > 0 && this.standing)) return;
    const ms = Math.round((now - this.lapT0) * 1000);
    if (k === 0) this.split = [];
    else if (k === 1 && this.split && this.split.length === 0) this.split.push(ms);
    else if (k === 2 && this.split && this.split.length === 1) this.split.push(ms);
    else return;
    const token = this.token; if (!token || !Account.signedIn) return;
    const base = await Net.findBase(); if (!base) return;
    try {
      const r = await fetch(base + '/api/lap/sector', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: Account.session, token, track: this.track, k }) });
      const j = await r.json(); if (j.token && this.token === token) this.token = j.token;
    } catch (e) { /* offline: this lap won't be saved */ }
  },
  lapDone(ms) {
    this.ttPen = this.kind === 'tt' ? this.penLap / 1000 : 0;
    if (this.kind === 'tt' && this.penLap) { ms += this.penLap; this.penLap = 0; }   // (jump start: +5 s on lap 1)
    this.last = ms;
    const pb = !this.best || ms < this.best;
    if (this.kind === 'tt') {
      hud.message((pb ? 'NEW BEST LAP ' : 'LAP ') + fmtLap(ms) + (this.best && !pb ? '  (+' + ((ms - this.best) / 1000).toFixed(3) + ')' : ''));
      const before = this.best;
      if (pb) this.saveBest(ms);
      if (pb || !this.ghost) this.saveGhost(ms);          // (the ghost: your best lap)
      this.rec = null;
      this.submitLap(ms);
      this.startFin({ kind: 'tt', ms, pb, before, top: this.lapTop, pen: this.ttPen || 0 });
    } else if (pb && this.st !== 'racing') { this.saveBest(ms); hud.message('PRACTICE LAP ' + fmtLap(ms)); }
    else if (this.st !== 'racing') hud.message('PRACTICE LAP ' + fmtLap(ms));
  },
  // multiplayer race: crossing the line (laps done since the start)
  raceLine(now) {
    const done = this.lapIdx;
    if (done <= 0) return;
    const total = Math.round((now - this.goAt) * 1000);
    if (done >= this.laps && !this.finished) {
      this.finished = { ms: total + this.pen * 1000, pen: this.pen };
      Net.send({ t: 'rfin', ms: total, pen: this.pen });
      hud.message('FINISHED · ' + fmtLap(total) + (this.pen ? ` (+${this.pen} s PENALTY)` : ''));
      const st = this.standings();
      this.startFin({ kind: 'mp', ms: this.finished.ms, pen: this.pen, pos: st.findIndex(r => r.you) + 1, n: Math.max(st.length, this.entrants ? this.entrants.size : 0), bestLap: this.raceBest, top: this.raceTop });
    } else if (!this.finished) { Net.send({ t: 'rlap', lap: done, ms: total }); hud.message(`LAP ${done + 1}/${this.laps}`); }
  },
  // progress round the race in decimetres (sent as the "score" so everyone can work out positions)
  // (finished: a fixed value above anyone still racing, earlier finishers higher)
  progress() {
    if (this.st !== 'racing' || this.myGrid < 0) return 0;
    return this.finished ? 1e10 - this.finished.ms : Math.max(1, Math.round((car.s + 200) * 10));
  },

  // ---------------- the finish: a Forza-style slow-motion fly-by with your stats
  // A time-trial lap done / the chequered flag in a race: the car drives itself on (easing over to the side of
  // the track and slowing down) in slow motion, filmed from beside the track, with a card of your stats.
  // Time trial: RESTART / LOBBY. Race: LEAVE RACE, or you get the car back when the lobby opens again.
  fin: null, finDt: 0,
  startFin(stats) {
    if (this.fin || !ROAD.loop) return;
    const side = car.d >= 0 ? 1 : -1;
    this.fin = { t: 0, stats, s: car.s, d: car.d, u: Math.max(25, Math.abs(car.u)), side, dGo: side * (2 * ROAD.LW - 1.6), shot: null };
    this.finShot('fixed');
    document.body.classList.add('finCam');
    this.drawFin();
  },
  endFin() {
    if (!this.fin) return;
    this.fin = null; this.finDt = 0;
    document.body.classList.remove('finCam'); $id('finCard').classList.add('hidden');
    if (ROAD.loop) this.lapIdx = Math.floor(car.s / ROAD.loop.L);
    this.lapT0 = null; this.sec = 0; this.valid = true; this.lapTop = 0;
  },
  // per frame instead of the physics: slow motion (easing up a little after a few seconds), gliding on
  finStep(dt) {
    const F = this.fin; F.t += dt; F.shot.t += dt;
    const k = F.t < 2.5 ? 0.22 : Math.min(0.55, 0.22 + (F.t - 2.5) * 0.12), h = dt * k;
    this.finDt = h;
    F.u += (32 - F.u) * (1 - Math.exp(-0.35 * h));     // (down to ~115 km/h)
    F.s += F.u * h; F.d += (F.dGo - F.d) * (1 - Math.exp(-0.6 * h));
    car.place(F.s, F.d, F.u); car.s = F.s; car.d = F.d; car.brakeOn = false;
    ROAD.hintS = F.s;
  },
  // camera shots: 'fixed' = low beside the track ahead, the car comes through and past; 'side' = alongside
  // the car, sliding from behind it to ahead of it. Then the next fixed shot further on.
  finShot(kind) {
    const F = this.fin, k = F.t < 2.5 ? 0.22 : 0.4;
    const s = kind === 'fixed' ? F.s + U.clamp(F.u * k * 2.6, 18, 45) : 0;
    F.shot = { kind, t: 0, s, d: kind === 'fixed' ? this.finSideD(s, 2 * ROAD.LW + 3.5) : 0 };
  },
  finSideD(s, want) { return this.fin.side * Math.min(want, Tracks.wallAt(ROAD.loop, s, this.fin.side) - 1.2); },   // (in front of the wall)
  finCam(camera) {
    const F = this.fin; if (!F) return false;
    const S = F.shot;
    let p, y;
    if (S.kind === 'fixed') { p = ROAD.pos(S.s, S.d); y = 0.95; if (F.s > S.s + 8) this.finShot('side'); }
    else {                                              // (from across the track: the car drifts over to the far side)
      const s = F.s - 7 + S.t * 2.4;
      p = ROAD.pos(s, -F.side * Math.min(2 * ROAD.LW + 2.5, Tracks.wallAt(ROAD.loop, s, -F.side) - 1.2)); y = 1.15;
      if (S.t > 5) this.finShot('fixed');
    }
    camera.position.set(p.x, y, p.z);
    camera.lookAt(car.x, 0.55, car.z);
    const dist = Math.hypot(car.x - p.x, car.z - p.z);   // (zoomed in like a telephoto lens: the car fills the shot)
    camera.fov = U.clamp(2 * Math.atan(4.5 / Math.max(dist, 1)) * 180 / Math.PI, 14, 55);
    camera.near = 0.25; camera.updateProjectionMatrix();
    // (wide screens: the car a little left of centre, clear of the stats card on the right)
    if (camera.aspect > 1.2) camera.rotateY(-0.45 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
    return true;
  },
  // the stats card
  drawFin() {
    const F = this.fin; if (!F) return;
    const S = F.stats, box = $id('finCard'), T = Tracks.TRACK_BY_ID[this.track];
    const spd = v => (Settings.units === 'kmh' ? Math.round(v * 3.6) + ' km/h' : Math.round(v * 2.237) + ' mph');
    const dl = ms => (ms >= 0 ? '+' : '−') + (Math.abs(ms) / 1000).toFixed(3);
    let rows = [], html;
    if (S.kind === 'tt') {
      rows.push(['Personal best', !S.before ? 'N/A' : S.pb ? `${dl(S.ms - S.before)} (${fmtLap(S.before)})` : `${fmtLap(S.before)} (${dl(S.ms - S.before)})`]);
      rows.push(['Leaderboard', !Account.signedIn ? 'Sign in to save lap times' : S.rank === 'off' ? 'Not saved' : S.rank ? '#' + S.rank : S.rank === null ? 'Not a new best' : 'Saving…']);
      rows.push(['Top speed', spd(S.top || 0)]);
      if (S.pen) rows.push(['Jump start', `+${S.pen} s`]);
      html = `<div class="fcTag">TIME TRIAL · ${T ? T.short : ''}</div><div class="fcTitle${S.pb ? ' pb' : ''}">${S.pb ? 'NEW PERSONAL BEST' : 'LAP COMPLETE'}</div>` +
        `<div class="fcBig">${fmtLap(S.ms)}</div>`;
    } else {
      rows.push(['Race time', fmtLap(S.ms)]);
      rows.push(['Best lap', S.bestLap ? fmtLap(S.bestLap) : 'N/A']);
      rows.push(['Top speed', spd(S.top || 0)]);
      rows.push(['Penalties', S.pen ? `+${S.pen} s` : 'None']);
      html = `<div class="fcTag">RACE · ${T ? T.short : ''}</div><div class="fcTitle">FINISHED</div>` +
        `<div class="fcBig">P${S.pos}<small>/${S.n}</small></div>`;
    }
    html += '<div class="fcRows">' + rows.map(r => `<div class="fcRow"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('') + '</div>';
    const res = S.results, w = res && res[0] && res[0].ms ? res[0].ms : 0;   // (race: the results, once everyone's done)
    if (res) html += '<div class="fcHead">RACE RESULTS</div><div class="fcRes">' + res.map((r, i) =>
      `<div class="fcRow${r.id === Net.myId ? ' me' : ''}"><span><i>${r.dnf ? 'DNF' : 'P' + (i + 1)}</i> <em style="--c:${/^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : '#fff'}"></em></span>` +
      `<b>${r.dnf ? '—' : i === 0 ? fmtLap(r.ms) : '+' + ((r.ms - w) / 1000).toFixed(3)}${r.pen ? ` <small>+${r.pen}s</small>` : ''}</b></div>`).join('') + '</div>';
    html += S.kind === 'tt' ? '<div class="fcBtns"><button class="go" id="fcRestart">RESTART</button><button id="fcLobby">LOBBY</button></div>'
      : `<div class="fcBtns"><button id="fcLobby">LEAVE RACE</button></div><div class="fcHint">${res ? 'Back to the lobby in a few seconds' : 'Results when everyone finishes · then back to the lobby'}</div>`;
    box.innerHTML = html; box.classList.remove('hidden');
    if (res) [...box.querySelectorAll('.fcRes em')].forEach((e, i) => (e.textContent = res[i].name));   // (names as text)
    const r = $id('fcRestart'); if (r) r.onclick = () => this.reset();
    $id('fcLobby').onclick = () => { if (this.toLobby) this.toLobby(); };
  },
  finUpdate(o) { if (this.fin) { Object.assign(this.fin.stats, o); this.drawFin(); } },

  // ---------------- time trial: laps go to the leaderboard (signed in)
  token: null,
  async fetchToken() {
    this.token = null;
    if (!Account.signedIn) return;
    const base = await Net.findBase(); if (!base) return;
    try {
      const r = await fetch(base + '/api/lap/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: Account.session, track: this.track }) });
      const j = await r.json(); if (j.token) this.token = j.token;
    } catch (e) { /* offline */ }
  },
  async submitLap(ms) {
    const token = this.token, splits = (this.split || []).slice(), pen = this.ttPen || 0; this.token = null;
    if (!Account.signedIn) { if (Account.clientId) hud.message('SIGN IN TO SAVE LAP TIMES'); return; }
    const base = token && await Net.findBase();
    if (!base) { setTimeout(() => this.finUpdate({ rank: 'off' }), 0); return; }
    try {
      const r = await fetch(base + '/api/lap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: Account.session, token, track: this.track, ms, pen, splits }) });
      const j = await r.json();
      if (j.rank) setTimeout(() => hud.message(`LAP LEADERBOARD #${j.rank}`), 1400);
      else if (j.error) console.warn('lap not saved:', j.error);
      this.finUpdate({ rank: j.rank || (j.error || j.rejected ? 'off' : null) });
    } catch (e) { this.finUpdate({ rank: 'off' }); }
  },

  // ---------------- multiplayer race state from the server
  // m: { st, ms (time left in this state), hold (grid: ms between all five lights and lights out), grid: [ids], laps,
  //      track, n (players), results: [{ name, ms, pen, dnf, color }] }
  onState(m) {
    if (!this.active || this.kind !== 'mp') return;
    const was = this.st, now = performance.now() / 1000;
    this.st = m.st; this.laps = m.laps || this.laps; this.n = m.n || 0; this.need = m.need || Tracks.RACE_MIN;
    this.endsAt = now + (m.ms || 0) / 1000;
    if (m.st === 'grid') {
      this.endFin();
      this.myGrid = (m.grid || []).indexOf(Net.myId);
      const goAt = now + (m.ms || 0) / 1000;
      this.armStart(goAt - (m.hold || 1000) / 1000 - 5, goAt);
      this.finished = null; this.results = null; this.resetPenalties(); $id('raceResults').classList.add('hidden');
      this.cpReset();                                    // (the grid: who's racing - shown on the timing tower in grid order)
      for (const id of m.grid || []) { const p = Net.players.get(id); this.entrants.set(id, { name: p ? p.name : id === Net.myId ? Net.me.name : 'Driver', color: p ? p.color : Net.me.color }); }
      if (this.myGrid >= 0) { this.place(this.myGrid); Net.silent = false; }
      else { Net.silent = true; hud.message('RACE STARTING · YOU\'LL BE IN THE NEXT ONE'); }
    } else if (m.st === 'racing') {
      if (was !== 'grid' || this.goAt === undefined) { this.goAt = now - (m.el || 0) / 1000; this.started = true; }
      this.myGrid = (m.grid || []).indexOf(Net.myId);
      Net.silent = this.myGrid < 0;
      if (was !== 'racing') {                            // (the race just started: who's in it, for the live timing / DNFs)
        this.cpReset();
        for (const id of m.grid || []) { const p = Net.players.get(id); this.entrants.set(id, { name: p ? p.name : id === Net.myId ? Net.me.name : 'Driver', color: p ? p.color : Net.me.color }); }
      }
    } else {
      Net.silent = false; this.started = true;
      if (m.st === 'results') { this.results = m.results || []; this.showResults(); }
      if (m.st === 'lobby' || m.st === 'countdown') { this.endFin(); this.myGrid = -1; this.finished = null; if (was === 'results') $id('raceResults').classList.add('hidden'); }
    }
  },
  showResults() {
    const box = $id('raceResults'), rows = this.results || [];
    if (this.fin) { this.finUpdate({ results: rows }); return; }   // (in the finish fly-by: the results go in its card)
    const winner = rows[0] && rows[0].ms ? rows[0].ms : 0;
    box.innerHTML = '<div class="rrHead">RACE RESULTS</div>' + rows.map((r, i) =>
      `<div class="rrRow${r.id === Net.myId ? ' me' : ''}"><span class="p">${r.dnf ? 'DNF' : 'P' + (i + 1)}</span><span class="n" style="--c:${r.color || '#fff'}"></span>` +
      `${r.pen ? `<span class="pen">+${r.pen}s</span>` : ''}<span class="t">${r.dnf ? '—' : i === 0 ? fmtLap(r.ms) : '+' + ((r.ms - winner) / 1000).toFixed(3)}</span></div>`).join('') +
      '<div class="rrFoot">Penalties are included in the times · back to the lobby in a few seconds…</div>';
    [...box.querySelectorAll('.n')].forEach((e, i) => (e.textContent = rows[i].name));   // (names as text)
    box.classList.remove('hidden');
  },

  // ---------------- the start: throttle only counts after the green light
  // While the lights are on, the throttle (and brake) do nothing - the car can't creep. Holding the throttle when
  // the lights turn green still does nothing: you have to let go and press it again after green (a real reaction).
  thrLock: false,
  gate(ctl) {
    if (!this.active) { this.thrLock = false; return; }
    const myStart = this.kind === 'tt' || (this.st === 'grid' && this.myGrid >= 0) || (this.st === 'racing' && this.myGrid >= 0);
    if (myStart && this.goAt !== undefined && !this.started) { this.thrLock = true; ctl.throttle = 0; ctl.brake = 0; return; }
    if (this.thrLock) { if ((ctl.throttle || 0) < 0.05) this.thrLock = false; else ctl.throttle = 0; }
  },

  // ---------------- per frame: start lights, jump starts, track limits, HUD
  hudT: 0,
  update(dt) {
    if (!this.active) return;
    const now = this.now();
    // the start (time trial, or a race with you on the grid)
    const myStart = this.kind === 'tt' || (this.st === 'grid' && this.myGrid >= 0) || (this.st === 'racing' && this.myGrid >= 0);
    if (myStart && this.goAt !== undefined && !this.started) {
      const n = now < this.lightsAt ? 0 : Math.min(5, Math.floor(now - this.lightsAt) + 1);
      if (now < this.goAt) {
        RaceWorld.setLights(n); RaceLights.show(n);
        if (!this.jump && this.gridPos && Math.hypot(car.x - this.gridPos.x, car.z - this.gridPos.z) > 1.0) {   // moved before lights out
          this.jump = true;
          if (this.kind === 'tt') { this.penLap = 5000; hud.message('JUMP START · +5 SECONDS ON THIS LAP', true); }
          else this.penalty(5, 'JUMP START');
        }
      } else {                                          // lights out: GO
        this.lapTop = 0; this.raceTop = 0; this.raceBest = null;
        this.started = true; this.lapT0 = this.goAt; this.standing = Math.floor(car.s / ROAD.loop.L) < 0 || this.lapIdx < 0;
        this.sec = 0; this.valid = true; this.lapIdx = Math.floor(car.s / ROAD.loop.L);
        RaceWorld.setLights('go'); RaceLights.show(0, true); this.goShownAt = now;
        this.sector(0, now);                             // (time trial: the server's clock starts the lap too)
        if (this.kind === 'tt') { this.rec = []; this.recT = 0; }   // (and the ghost recording)
      }
    } else if (this.goShownAt !== undefined && now - this.goShownAt < 1.4) { RaceWorld.setLights('go'); RaceLights.show(0, true); }
    else { RaceWorld.setLights(0); RaceLights.hide(); }
    if (!this.fin) {                                    // (the finish fly-by: the car is on autopilot)
      const v = Math.abs(car.u);
      this.lapTop = Math.max(this.lapTop || 0, v); if (this.started) this.raceTop = Math.max(this.raceTop || 0, v);
      if (this.kind === 'tt' && this.started && this.lapT0 !== null) this.ghostRecord(dt, now - this.lapT0);
      this.timing(now);
      if (this.started && (this.kind === 'tt' || this.kind === 'mp')) this.trackLimits(dt);
    }
    this.cpUpdate(now);
    this.ghostShow(now);
    if (!this.fin) this.griefCheck(dt, now);
    if ((this.hudT -= dt) > 0) return;
    this.hudT = 0.1;
    this.drawHud(now);
  },
  // time trial clock: game time (stops while paused)
  clockNow() { return this.now(); },
  standings() {
    const rows = [], meP = this.progress();
    rows.push({ name: Net.me.name || 'You', you: true, prog: meP, color: Net.me.color });
    for (const p of Net.players.values()) {
      const sc = p.last ? p.last.score || 0 : 0;
      if (sc > 0) rows.push({ name: p.name, prog: sc, color: p.color });
    }
    return rows.sort((a, b) => b.prog - a.prog);
  },
  drawHud(now) {
    const ban = $id('raceBanner'), H = $id('raceHud');
    const t = this.lapT0 !== null && !this.frozen ? (this.kind === 'tt' ? this.clockNow() : now) - this.lapT0 : 0;
    let pos = '', lap = '', main = this.lapT0 !== null ? fmtLap(t * 1000) : '0:00.000';
    let banner = '';
    if (this.kind === 'tt') { lap = 'TIME TRIAL'; if (!this.started) { banner = 'GO ON GREEN'; main = '0:00.000'; } else if (!this.valid) lap = 'TIME TRIAL · LAP DELETED'; }
    else {
      const left = Math.max(0, this.endsAt - now), mmss = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
      if (this.st === 'lobby') { lap = 'PRACTICE'; banner = `IN QUEUE · ${this.n}/${Tracks.RACE_MAX} PLAYERS · WAITING FOR ${Math.max(1, this.need - this.n)} MORE`; }
      else if (this.st === 'countdown') { lap = 'PRACTICE'; banner = `RACE STARTS IN ${mmss} · ${this.n}/${Tracks.RACE_MAX} PLAYERS`; }
      else if (this.st === 'grid') { lap = `LAP 1/${this.laps}`; banner = this.myGrid >= 0 ? `GRID P${this.myGrid + 1} · GO ON GREEN` : 'RACE STARTING · WAIT FOR THE NEXT ONE'; main = '0:00.000'; }
      else if (this.st === 'racing') {
        if (this.myGrid >= 0) {
          const st = this.standings(), me = st.findIndex(r => r.you);
          pos = `P${me + 1}<small>/${st.length}</small>`;
          const done = Math.max(0, this.lapIdx);
          lap = this.finished ? 'FINISHED' : `LAP ${Math.min(this.laps, done + 1)}/${this.laps}`;
          main = this.finished ? fmtLap(this.finished.ms) : fmtLap((now - this.goAt) * 1000);
        } else { lap = 'PRACTICE'; banner = `RACE IN PROGRESS · NEXT RACE AFTER THIS ONE`; }
      } else if (this.st === 'results') {
        lap = 'RESULTS'; main = this.finished ? fmtLap(this.finished.ms) : '—';
        const me = (this.results || []).findIndex(r => r.id === Net.myId);
        if (me >= 0) pos = this.results[me].dnf ? 'DNF' : `P${me + 1}<small>/${this.results.length}</small>`;
      }
    }
    H.querySelector('.rhPos').innerHTML = pos;
    H.querySelector('.rhLap').textContent = lap;
    H.querySelector('.rhTime').textContent = main;
    H.querySelector('.rhBest').textContent = (this.best ? 'BEST ' + fmtLap(this.best) : 'BEST N/A') + (this.last ? '   LAST ' + fmtLap(this.last) : '') +
      (this.kind === 'mp' && this.myGrid >= 0 && (this.st === 'racing' || this.st === 'grid') ? (this.warn ? `   TRACK LIMITS ${Math.min(3, this.warn)}/3` : '') + (this.pen ? `   PENALTY +${this.pen}s` : '') : '');
    // fair play warning (wrong way / blocking): big red banner with the seconds left
    const gw = this.gr && this.gr.warn;
    if (gw) banner = `⚠ ${gw.why} · ${Math.max(0, Math.ceil(5 - (now - gw.t0)))}`;
    ban.textContent = banner; ban.classList.toggle('hidden', !banner); ban.classList.toggle('warn', !!gw);
    // live standings (racing): the timing tower, top left
    const sl = $id('raceStand');
    if (this.kind === 'mp' && (this.st === 'racing' || this.st === 'grid') && this.cp) {
      sl.classList.remove('hidden'); sl.classList.add('tower');
      this.drawTower(sl, this.board());
    } else if (this.kind === 'mp') {
      sl.classList.remove('tower'); this.towerRows = null;
      const rows = Net.roster(0);
      sl.innerHTML = `<div class="hd">IN THIS LOBBY</div>` + rows.map(r => `<div class="r${r.you ? ' you' : ''}" style="--c:${r.color}"><span class="p">•</span><span class="n"></span></div>`).join('');
      [...sl.querySelectorAll('.n')].forEach((e, i) => (e.textContent = rows[i].name + (rows[i].you ? ' (you)' : '')));
      sl.classList.remove('hidden');
    } else if (this.kind === 'tt' && !this.fin) {        // (time trial: you and your personal best, the gap between you)
      sl.classList.remove('hidden'); sl.classList.add('tower');
      this.drawTower(sl, this.ttBoard(now));
    } else sl.classList.add('hidden');
  },
  // time trial tower rows: YOU (+/- seconds to your best at this point of the lap) and PERSONAL BEST (its time)
  ttBoard(now) {
    const pb = { id: 'pb', name: 'Personal best', color: '#9fd8ff', gap: this.ghost ? fmtLap(this.ghost.ms) : 'N/A' };
    const me = { id: 'me', name: 'You', you: true, color: Net.me.color || f1Color(), gap: '' };
    const tg = this.started && this.lapT0 !== null && this.ghost ? this.ghostTimeAt(car.s) : null;
    if (tg === null) return [me, pb];
    const d = (now - this.lapT0) - tg;                   // (seconds: + = behind your best, - = ahead)
    me.gap = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3);
    return d > 0 ? [pb, me] : [me, pb];
  },

  // ---------------- live timing at the checkpoint gantries (CP per lap; checkpoint 0 is the start / finish line)
  // Everyone's distance round the race is known (yours from your car, the others' from the progress they send).
  // The first car through a checkpoint (lap by lap) sets its time; everyone after gets the gap to it there.
  // timing points: about every 100 m (at least 12 a lap) so the gaps update every couple of seconds; CPV of them have a
  // gantry over the track (CP is a multiple of CPV, so every gantry is a timing point)
  CPV: 6,
  get CP() { return ROAD.loop ? Math.max(2, Math.round(ROAD.loop.L / 100 / this.CPV)) * this.CPV : 24; },
  cpReset() { this.cp = { times: new Map(), lead: new Map(), last: new Map() }; this.entrants = new Map(); this.dnf = new Set(); this.boardPos = new Map(); },
  // a racer's distance round the race now (metres since the start line, laps counted); t = seconds since lights out
  cpFeed(id, dist, t) {
    const C = this.cp, seg = ROAD.loop.L / this.CP, prev = C.last.get(id);
    C.last.set(id, { dist, t });
    if (!prev || dist <= prev.dist) return;
    const i0 = Math.floor(prev.dist / seg), i1 = Math.floor(dist / seg);
    if (i1 > i0 + this.CP) return;                      // (a jump - joining late, a reset: don't time it)
    let map = C.times.get(id); if (!map) C.times.set(id, (map = new Map()));
    for (let i = i0 + 1; i <= i1; i++) {
      if (i < 1) continue;                              // (the grid is behind the line: the first checkpoint is the line)
      const f = (i * seg - prev.dist) / (dist - prev.dist), tc = prev.t + (t - prev.t) * f;   // (when it crossed, in between)
      map.set(i, tc);
      if (!C.lead.has(i) || tc < C.lead.get(i)) C.lead.set(i, tc);
    }
  },
  // the gap shown for a racer: at the last checkpoint they passed, how far behind the first car through it
  cpGap(id) {
    const map = this.cp.times.get(id); if (!map || !map.size) return null;
    let last = 0; for (const k of map.keys()) last = Math.max(last, k);
    const leadMax = Math.max(...this.cp.lead.keys());
    if (leadMax - last >= this.CP) return { laps: Math.floor((leadMax - last) / this.CP) };
    return { s: map.get(last) - this.cp.lead.get(last) };
  },
  cpUpdate(now) {
    if (!(this.kind === 'mp' && this.st === 'racing' && this.goAt !== undefined && this.cp)) return;
    const t = now - this.goAt;
    if (t < 0) return;
    if (this.myGrid >= 0 && !this.finished) this.cpFeed(Net.myId, car.s, t);
    for (const p of Net.players.values()) {
      const sc = p.last ? p.last.score || 0 : 0;
      if (sc > 0 && sc < 1e8) this.cpFeed(p.id, sc / 10 - 200, t);
      if (this.entrants.has(p.id)) Object.assign(this.entrants.get(p.id), { name: p.name, color: p.color });
    }
    for (const id of this.entrants.keys()) if (id !== Net.myId && !Net.players.has(id)) this.dnf.add(id);   // (left mid-race)
  },
  // everyone in the race, in order: finished (by time), then by distance; DNF at the bottom
  board() {
    const rows = [], meP = this.progress();
    if (this.myGrid >= 0) rows.push({ id: Net.myId, name: Net.me.name || 'You', you: true, prog: meP, color: Net.me.color });
    for (const p of Net.players.values()) {
      const sc = p.last ? p.last.score || 0 : 0;
      if (sc > 0 && !this.dnf.has(p.id)) rows.push({ id: p.id, name: p.name, prog: sc, color: p.color });
    }
    rows.sort((a, b) => b.prog - a.prog);
    for (const id of this.dnf) { const e = this.entrants.get(id); if (e) rows.push({ id, name: e.name, color: e.color, dnf: true, prog: -1 }); }
    return rows;
  },
  // ---------------- fair play: driving the wrong way, or parking on the track, gets a 5 s warning, then you're out
  griefCheck(dt, now) {
    const racing = this.kind === 'mp' && this.st === 'racing' && this.myGrid >= 0 && !this.finished && this.started && now - this.goAt > 6;
    const g = this.gr || (this.gr = { s: car.s, vs: 0, wrongT: 0, stillT: 0, warn: null });
    const vs = (car.s - g.s) / Math.max(dt, 1e-3); g.s = car.s;
    g.vs += (vs - g.vs) * Math.min(1, dt * 3);
    if (!racing) { g.wrongT = g.stillT = 0; g.warn = null; return; }
    const onTrack = Math.abs(car.d) < 2 * ROAD.LW + 0.5;
    g.wrongT = g.vs < -2.5 ? g.wrongT + dt : g.vs > 2 ? 0 : g.wrongT;
    g.stillT = Math.abs(car.u) < 1.5 && onTrack ? g.stillT + dt : 0;
    const why = g.wrongT > 1.5 ? 'WRONG WAY · TURN AROUND' : g.stillT > 6 ? 'BLOCKING THE TRACK · GET MOVING' : null;
    if (why && !g.warn) g.warn = { why, t0: now };
    if (!why && g.warn && g.wrongT === 0 && g.stillT === 0) { g.warn = null; hud.message('OK · CARRY ON'); }
    if (g.warn) {
      g.warn.why = why || g.warn.why;
      if (now - g.warn.t0 >= 5) {
        g.warn = null;
        Net.leave();
        Net.status('You were removed from the race for ' + (g.wrongT > 1.5 ? 'driving the wrong way.' : 'blocking the track.'), 'err');
      }
    }
  },

  // the timing tower: a header (POLYWEAVE · LAP n/N), then one row per driver - position, their car colour, name,
  // gap. Rows are kept (by driver) and slide to their new place on an overtake, with a green / red arrow for a moment.
  drawTower(box, rows) {
    const ROW = 27, now = performance.now();
    if (!this.towerRows || this.towerBox !== box) {
      box.innerHTML = '<div class="twHd"><span class="twLogo">POLY<b>WEAVE</b></span><span class="twLap"></span></div><div class="twList"></div>';
      this.towerRows = new Map(); this.towerBox = box;
    }
    const list = box.querySelector('.twList'), tt = this.kind === 'tt';
    const lead = tt ? 0 : Math.max(0, ...[...this.cp.lead.keys()]), lap = Math.min(this.laps, Math.floor(lead / this.CP) + 1);
    box.querySelector('.twLap').textContent = tt ? 'TIME TRIAL' : this.st === 'grid' ? `LAP 1/${this.laps}` : `LAP ${lap}/${this.laps}`;
    list.style.height = rows.length * ROW + 'px';
    const seen = new Set();
    rows.forEach((r, i) => {
      seen.add(r.id);
      let e = this.towerRows.get(r.id);
      if (!e) {
        const el = document.createElement('div'); el.className = 'twRow';
        el.innerHTML = '<span class="twP"></span><span class="twC"></span><span class="twN"></span><span class="twMv"></span><span class="twG"></span>';
        el.style.transform = `translateY(${i * ROW}px)`; list.appendChild(el);
        this.towerRows.set(r.id, (e = { el, pos: i, mvT: 0 }));
      }
      if (e.pos !== i && !r.dnf && (this.st === 'racing' || tt)) {   // (overtake: slide, and flash how many places)
        const mv = e.el.querySelector('.twMv'), d = e.pos - i;
        mv.textContent = (d > 0 ? '▲' : '▼') + Math.abs(d); mv.className = 'twMv ' + (d > 0 ? 'up' : 'down'); e.mvT = now + 2600;
        e.el.classList.toggle('gain', d > 0); e.el.classList.toggle('lose', d < 0);
      }
      if (e.mvT && now > e.mvT) { e.mvT = 0; e.el.querySelector('.twMv').className = 'twMv'; e.el.classList.remove('gain', 'lose'); }
      e.pos = i;
      e.el.style.transform = `translateY(${i * ROW}px)`;
      e.el.classList.toggle('you', !!r.you); e.el.classList.toggle('dnf', !!r.dnf); e.el.classList.toggle('p1', i === 0 && !r.dnf && !tt);
      e.el.querySelector('.twP').textContent = r.dnf ? '–' : i + 1;
      e.el.querySelector('.twC').style.background = r.color || '#fff';
      e.el.querySelector('.twN').textContent = String(r.name || 'Driver').toUpperCase();
      let gap = '';
      if (r.gap !== undefined) gap = r.gap;
      else if (r.dnf) gap = 'DNF';
      else if (this.st === 'grid') gap = '';
      else if (i === 0) gap = r.prog >= 1e8 ? 'WINNER' : 'LEADER';
      else { const g = this.cpGap(r.id); gap = !g ? '' : g.laps ? `+${g.laps} LAP${g.laps > 1 ? 'S' : ''}` : `+${Math.max(0, g.s).toFixed(3)}`; }
      e.el.querySelector('.twG').textContent = gap;
    });
    for (const [id, e] of this.towerRows) if (!seen.has(id)) { e.el.remove(); this.towerRows.delete(id); }
  },

  // ---------------- minimap: the whole track, north up, everyone on it
  drawMap(g, W) {
    const lp = ROAD.loop; if (!lp) return;
    if (!this._mm || this._mm.lp !== lp) {
      const pts = []; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let s = 0; s <= lp.L; s += 10) { const p = ROAD.pos(s, 0); pts.push([p.x, p.z]); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      this._mm = { lp, pts, x0, x1, z0, z1 };
    }
    const M = this._mm, pad = 16, k = (W - pad * 2) / Math.max(M.x1 - M.x0, M.z1 - M.z0);
    const ox = (W - (M.x1 - M.x0) * k) / 2, oz = (W - (M.z1 - M.z0) * k) / 2;
    const map = (x, z) => [ox + (x - M.x0) * k, oz + (z - M.z0) * k];
    g.lineJoin = g.lineCap = 'round';
    const path = () => { g.beginPath(); M.pts.forEach((p, i) => { const q = map(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); };
    path(); g.lineWidth = 7; g.strokeStyle = 'rgba(10,13,19,0.6)'; g.stroke();
    path(); g.lineWidth = 4; g.strokeStyle = 'rgba(214,220,230,0.9)'; g.stroke();
    // the start: a circle with an S (like the track pictures on the Racing page and the multiplayer map)
    const st = ROAD.pos(0, 0), sq = map(st.x, st.z);
    g.beginPath(); g.arc(sq[0], sq[1], 6.5, 0, Math.PI * 2); g.fillStyle = '#2f3440'; g.fill(); g.lineWidth = 1.4; g.strokeStyle = '#d6dbe3'; g.stroke();
    g.font = '900 8.5px Segoe UI, Arial'; g.textAlign = 'center'; g.fillStyle = '#ffd84a'; g.fillText('S', sq[0], sq[1] + 3);
    for (const p of Net.players.values()) {
      const n = p.now; if (!n || !p.g || !p.g.visible) continue;
      const pos = ROAD.pos(n.s, n.d), q = map(pos.x, pos.z);
      g.beginPath(); g.arc(q[0], q[1], 4.5, 0, Math.PI * 2); g.fillStyle = p.color; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
    }
    const me = map(car.x, car.z);
    g.save(); g.translate(me[0], me[1]); g.rotate(car.visYaw);
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2.5); g.lineTo(-5, 5); g.closePath();
    g.fillStyle = '#ffd84a'; g.fill(); g.lineWidth = 1.3; g.strokeStyle = '#1a1f28'; g.stroke(); g.restore();
  },
};
// lap / race time as 1:23.456
function fmtLap(ms) { ms = Math.max(0, Math.round(ms)); const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000; return `${m}:${s.toFixed(3).padStart(6, '0')}`; }
// the big start lights on screen (five red lights, then all out: GO)
const RaceLights = {
  el: null,
  show(n, go) {
    const e = this.el || (this.el = $id('raceLights'));
    e.classList.remove('hidden');
    e.classList.toggle('go', !!go);
    [...e.children].forEach((c, i) => c.classList.toggle('on', !go && i < n));
  },
  hide() { const e = this.el || (this.el = $id('raceLights')); if (e) e.classList.add('hidden'); },
};
