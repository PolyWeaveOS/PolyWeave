'use strict';
// =====================================================================
//  PolyWeave video recorder (owners only: the server hands this file only to the owners' accounts)
//  - While you play, the last 60 s of what's on screen is kept: camera, your car, traffic, friends, HUD.
//  - F9 saves it as a clip. F10 opens the editor: trim, camera, slow motion, HUD on / off.
//  - Export replays the clip one frame at a time (exactly 1/60 s apart) at 1080p / 1440p / 4K and saves an
//    MP4 (WebCodecs + mp4-muxer). It doesn't matter how fast the computer is: a slow one just takes longer.
//  - No sound (add music / audio in a video editor).
//  - F8: the screen recorder, for everything the replay can't film (menus, leaderboards, profile, inbox...).
//    It records this browser tab as it is, live, with nothing of its own on screen while recording; F8 again stops
//    and saves the video.
// =====================================================================
(() => {
  if (window.Recorder) return;
  const BUFFER = 60;                               // seconds kept while playing
  const FPS = 60;
  const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/build/mp4-muxer.min.js';
  const RES = { '1080p': [1920, 1080, 'avc1.640028', 16e6], '1440p': [2560, 1440, 'avc1.640033', 28e6], '4K': [3840, 2160, 'avc1.640034', 50e6] };
  const CAMS = [['game', 'Game camera'], ['chase', 'Chase'], ['low', 'Low chase'], ['side', 'Side'], ['drone', 'Drone'], ['orbit', 'Orbit'], ['road', 'Roadside']];
  const wrapA = U.wrap, lerp = (a, b, k) => a + (b - a) * k, lerpA = (a, b, k) => a + wrapA(b - a) * k;

  // ---------------------------------------------------------------- capture (every frame while driving)
  const ids = new WeakMap(); let nextId = 1;
  const idOf = o => { let i = ids.get(o); if (!i) { i = nextId++; ids.set(o, i); } return i; };
  const meta = new Map();                          // traffic car id -> { key, mat }
  const fmeta = new Map();                         // friend id -> { name, color, title }
  const fnum = new Map(); let nextF = 1;
  let buf = [], start = 0, clock = 0, events = [];
  const clips = [];

  function paintOf(vis) { const c0 = vis.root.children[0]; return c0 && c0 !== vis.body && c0.material ? c0.material : null; }
  let capMap = null;
  function capture(dt) {
    if (!Account.signedIn || game.mode === 'menu' || menuOpen) return;
    // a different map or world (joined / left a server): start a new buffer, a clip never mixes two roads
    const map = (ROAD.loop ? 'loop:' : 'road:') + world.theme;
    if (map !== capMap) { buf = []; start = 0; events = []; capMap = map; }
    clock += dt;
    const q = camera.quaternion, p = camera.position;
    const tr = [];
    for (const c of traffic.cars) {
      const v = c.vis; if (!v || !v.root.visible) continue;
      const id = idOf(c);
      if (!meta.has(id)) meta.set(id, { key: c.type.key, mat: paintOf(v) });
      const fw = v.wheels.find(w => w.front), r = v.root;
      tr.push(id, r.position.x, r.position.y, r.position.z, r.rotation.y, v.spin, fw ? fw.base - fw.pivot.rotation.y : 0,
        (v.brake.visible ? 1 : 0) | (v.indL.visible ? 2 : 0) | (v.indR.visible ? 4 : 0) | (fw && fw.pivot.visible ? 8 : 0));
    }
    const fr = [];
    for (const f of Net.players.values()) {
      if (!f.g || !f.g.visible || !f.vis) continue;
      if (!fnum.has(f.id)) fnum.set(f.id, nextF++);
      const n = fnum.get(f.id);
      fmeta.set(n, { name: f.name, color: f.color, title: f.title, veh: f.veh });
      const fw = f.vis.wheels.find(w => w.front);
      fr.push(n, f.g.position.x, f.g.position.z, f.g.rotation.y, f.vis.spin, fw ? fw.base - fw.pivot.rotation.y : 0, f.vis.brake.visible ? 1 : 0, f.vis.lean ? f.vis.lean.rotation.z : 0);
    }
    const pr = playerVis.root, fw = playerVis.wheels.find(w => w.front);
    buf.push({
      t: clock, origin: ROAD.origin, s: car.s,
      cam: [p.x, p.y, p.z, q.x, q.y, q.z, q.w, camera.fov, camera.near],
      pl: [playerRoot.position.x, playerRoot.position.z, playerRoot.rotation.y, pr.rotation.x, pr.rotation.z, playerVis.spin,
        fw ? fw.base - fw.pivot.rotation.y : 0, swMesh.rotation.z, playerVis.brake.visible ? 1 : 0, cockpit.visible ? 1 : 0, playerGlass.opacity,
        vehicle === 'bike' ? 1 : 0, playerBike.lean.rotation.z, playerBike.spin, camMode === 1 ? 1 : 0],
      tr: Float32Array.from(tr), fr: fr.length ? Float64Array.from(fr) : null,
      hud: [hud.shownScore, score.best, score.pot, score.mult, U.clamp(score.timer, 0, 1), Math.abs(car.u), car.gear, U.clamp(car.rpm / M4.redline, 0, 1),
        car.limiter ? 1 : 0, score.prox || 1, score.pot > 0 ? 1 : 0],
      blur: blurAmount(),
    });
    while (start < buf.length && buf[start].t < clock - BUFFER) start++;
    if (start > 600) { buf = buf.slice(start); start = 0; }
    while (events.length && events[0].t < clock - BUFFER - 6) events.shift();
  }
  // HUD messages / results happen as events (drawn with their animations in the video)
  { const m = hud.message.bind(hud); hud.message = (text, crash = false) => { events.push({ t: clock, k: 'msg', text, crash }); m(text, crash); }; }
  { const r = hud.showResult.bind(hud); hud.showResult = (points, peak, best) => { events.push({ t: clock, k: 'res', points, peak, best }); r(points, peak, best); }; }

  function saveClip() {
    const s = buf.slice(start);
    if (s.length < 30) { toast('Nothing to save yet: drive for a few seconds first'); return null; }
    const t0 = s[0].t, t1 = s[s.length - 1].t;
    const clip = {
      name: `Clip ${clips.length + 1} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      samples: s.map(o => Object.assign({}, o, { t: o.t - t0 })), dur: t1 - t0,
      events: events.filter(e => e.t >= t0 - 6).map(e => Object.assign({}, e, { t: e.t - t0 })),
      theme: world.theme, loop: !!ROAD.loop, units: Settings.units, inT: 0, outT: t1 - t0,
    };
    clips.push(clip);
    toast(`Saved ${clip.name} (${Math.round(clip.dur)} s) · F10 to edit`);
    return clip;
  }

  // ---------------------------------------------------------------- replay: one moment of a clip
  const rg = new THREE.Group(); scene.add(rg); rg.visible = false;
  const pool = new Map(), fpool = new Map();
  const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
  function find(clip, t) {
    const S = clip.samples; let lo = 0, hi = S.length - 1;
    if (t <= S[0].t) return [S[0], S[0], 0];
    if (t >= S[hi].t) return [S[hi], S[hi], 0];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].t <= t) lo = m; else hi = m; }
    const a = S[lo], b = S[hi], k = (t - a.t) / Math.max(b.t - a.t, 1e-6);
    return a.origin === b.origin ? [a, b, k] : (k < 0.5 ? [a, a, 0] : [b, b, 0]);   // (never blend across a world shift)
  }
  function setWheels(v, spin, steer, wheelsOn) {
    v.spin = spin;
    for (const w of v.wheels) { w.mesh.rotation.x = spin * w.spinSign; if (w.front) w.pivot.rotation.y = w.base - steer; if (wheelsOn !== undefined) w.pivot.visible = wheelsOn; }
  }
  function vehicle(id) {
    let v = pool.get(id);
    if (!v) { const m = meta.get(id) || { key: TTYPES[0].key }; v = makeVehicle(m.key, m.mat || paintMat(0x9aa3ab), null, true); rg.add(v.root); pool.set(id, v); }
    return v;
  }
  function friend(n) {
    let f = fpool.get(n);
    if (!f) { const m = fmeta.get(n) || { name: 'Driver', color: '#a6b0b8' }; f = { name: m.name, color: m.color, title: m.title, veh: m.veh, buf: [] }; Net.makeVis(f); fpool.set(n, f); }
    return f;
  }
  // pose everything for clip time t; returns the (interpolated) player pose for the camera modes
  function pose(clip, t) {
    const [a, b, k] = find(clip, t);
    ROAD.origin = a.origin; ROAD.hintS = lerp(a.s, b.s, k);
    // your car
    const A = a.pl, B = b.pl, x = lerp(A[0], B[0], k), z = lerp(A[1], B[1], k), ry = lerpA(A[2], B[2], k);
    playerRoot.position.set(x, 0, z); playerRoot.rotation.y = ry;
    playerVis.root.rotation.x = lerp(A[3], B[3], k); playerVis.root.rotation.z = lerp(A[4], B[4], k);
    setWheels(playerVis, lerp(A[5], B[5], k), lerp(A[6], B[6], k));
    swMesh.rotation.z = cockpitWheel.rotation.z = lerp(A[7], B[7], k);
    playerVis.brake.visible = !!(k < 0.5 ? A[8] : B[8]);
    // motorcycle: lean + wheels (clips from before the bike existed have no entries here: car)
    const onBike = !!(k < 0.5 ? A[11] : B[11]);
    playerVis.root.visible = !onBike; playerBike.root.visible = onBike;
    if (onBike) { playerBike.lean.rotation.z = lerp(A[12], B[12], k); setWheels(playerBike, lerp(A[13], B[13], k), lerp(A[6], B[6], k) * 0.55); playerBike.brake.visible = playerVis.brake.visible; }
    // traffic (each car blended between the two moments it appears in)
    for (const v of pool.values()) v.root.visible = false;
    const near = k < 0.5 ? a : b, far = near === a ? b : a, kk = near === a ? k : 1 - k;
    const idx = new Map(); for (let i = 0; i < far.tr.length; i += 8) idx.set(far.tr[i], i);
    const T = near.tr, F = far.tr;
    for (let i = 0; i < T.length; i += 8) {
      const id = T[i], j = idx.get(id), v = vehicle(id), r = v.root;
      let px = T[i + 1], py = T[i + 2], pz = T[i + 3], rot = T[i + 4], spin = T[i + 5], st = T[i + 6];
      if (j !== undefined) { px = lerp(px, F[j + 1], kk); py = lerp(py, F[j + 2], kk); pz = lerp(pz, F[j + 3], kk); rot = lerpA(rot, F[j + 4], kk); spin = lerp(spin, F[j + 5], kk); st = lerp(st, F[j + 6], kk); }
      const fl = T[i + 7];
      r.visible = true; r.position.set(px, py, pz); r.rotation.y = rot;
      setWheels(v, spin, st, !!(fl & 8));
      v.brake.visible = !!(fl & 1); v.indL.visible = !!(fl & 2); v.indR.visible = !!(fl & 4);
    }
    // friends
    for (const f of fpool.values()) if (f.g) f.g.visible = false;
    if (near.fr) {
      const fi = new Map(); if (far.fr) for (let i = 0; i < far.fr.length; i += 8) fi.set(far.fr[i], i);
      const N = near.fr, G = far.fr;
      for (let i = 0; i < N.length; i += 8) {
        const f = friend(N[i]), j = fi.get(N[i]); if (!f.g) continue;
        let fx = N[i + 1], fz = N[i + 2], fr = N[i + 3], spin = N[i + 4], st = N[i + 5];
        if (j !== undefined) { fx = lerp(fx, G[j + 1], kk); fz = lerp(fz, G[j + 2], kk); fr = lerpA(fr, G[j + 3], kk); spin = lerp(spin, G[j + 4], kk); st = lerp(st, G[j + 5], kk); }
        f.g.visible = true; f.g.position.set(fx, 0, fz); f.g.rotation.y = fr;
        const lite = Math.hypot(fx - camera.position.x, fz - camera.position.z) > 50;
        if (f.visFull !== f.visLite) { f.visFull.root.visible = !lite; f.visLite.root.visible = lite; }
        const v = lite ? f.visLite : f.visFull;
        setWheels(v, spin, st); v.brake.visible = !!N[i + 6];
        if (v.lean) v.lean.rotation.z = j !== undefined ? lerpA(N[i + 7], G[j + 7], kk) : N[i + 7];
      }
    }
    return { a, b, k, x, z, yaw: -ry, s: ROAD.hintS, cockpit: !!(k < 0.5 ? A[9] : B[9]), firstPerson: !!(k < 0.5 ? A[14] : B[14]), glass: k < 0.5 ? A[10] : B[10], blur: lerp(a.blur || 0, b.blur || 0, k) };
  }

  // ---------------------------------------------------------------- cameras
  const cs = { yaw: null, orbit: 0, spot: null, side: 1 };
  function resetCams() { cs.yaw = null; cs.orbit = 0; cs.spot = null; }
  function look(x, y, z, tx, ty, tz, fov, nearP) {
    camera.position.set(x, y, z); camera.up.set(0, 1, 0); camera.lookAt(tx, ty, tz);
    camera.fov = fov; camera.near = nearP; camera.updateProjectionMatrix();
  }
  function placeCamera(mode, P, dt) {
    if (mode === 'game') {
      const A = P.a.cam, B = P.b.cam, k = P.k;
      camera.position.set(lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k));
      _qa.set(A[3], A[4], A[5], A[6]); _qb.set(B[3], B[4], B[5], B[6]); camera.quaternion.slerpQuaternions(_qa, _qb, k);
      camera.fov = lerp(A[7], B[7], k); camera.near = A[8]; camera.updateProjectionMatrix();
      return;
    }
    cs.yaw = cs.yaw === null ? P.yaw : U.dampAngle(cs.yaw, P.yaw, mode === 'drone' ? 2 : 4, dt);
    const sy = Math.sin(cs.yaw), cy = Math.cos(cs.yaw), fx = sy, fz = -cy, lx = cy, lz = sy;   // forward / right
    if (mode === 'chase') look(P.x - fx * 6.6, 1.35, P.z - fz * 6.6, P.x + fx * 3, 0.75, P.z + fz * 3, 58, 0.25);
    else if (mode === 'low') look(P.x - fx * 4.9, 0.55, P.z - fz * 4.9, P.x + fx * 2.5, 0.55, P.z + fz * 2.5, 56, 0.1);
    else if (mode === 'side') look(P.x - lx * 5.4 + fx * 1.2, 1.0, P.z - lz * 5.4 + fz * 1.2, P.x + fx * 0.6, 0.6, P.z + fz * 0.6, 52, 0.2);
    else if (mode === 'drone') look(P.x - fx * 15, 9.5, P.z - fz * 15, P.x + fx * 8, 0, P.z + fz * 8, 50, 0.5);
    else if (mode === 'orbit') {
      cs.orbit += dt * 0.32;
      const ang = cs.yaw + cs.orbit + 2.4;
      look(P.x + Math.sin(ang) * 7, 1.6, P.z - Math.cos(ang) * 7, P.x, 0.65, P.z, 50, 0.25);
    } else if (mode === 'road') {
      // a camera by the roadside: the car comes towards it and flies past, then the next one further on
      if (cs.spot === null || P.s > cs.spot + 28 || P.s < cs.spot - 400) { cs.spot = P.s + 95; cs.side = -cs.side; }
      // (on the shoulder, in front of the guard rail: nothing between it and the road)
      const q = ROAD.pos(cs.spot, cs.side < 0 ? ROAD.edgeL + 0.4 : ROAD.edgeR - 0.4), dist = Math.hypot(q.x - P.x, q.z - P.z);
      look(q.x, 1.1, q.z, P.x, 0.7, P.z, U.clamp(2 * Math.atan(5 / Math.max(dist, 1)) * 180 / Math.PI, 14, 58), 0.3);
    }
  }

  // ---------------------------------------------------------------- HUD drawn into the video (same look as the game's)
  const fmt = n => U.fmt(Math.round(n));
  function txt(g, s, x, y, size, weight, color, align = 'center', spacing = 0, glow = null) {
    g.font = `${weight} ${size}px "Segoe UI", Ubuntu, Arial, sans-serif`; g.textAlign = align; g.textBaseline = 'top';
    g.letterSpacing = spacing + 'px'; g.fillStyle = color;
    g.shadowColor = glow || 'rgba(0,0,0,0.38)'; g.shadowBlur = size * 0.16; g.shadowOffsetY = glow ? 0 : size * 0.05;
    g.fillText(s, x, y);
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
  }
  function drawHud(g, W, H, clip, P, t) {
    const k = H / 1250, h = (P.k < 0.5 ? P.a : P.b).hud, cx = W / 2, mph = clip.units !== 'kmh';
    g.save(); g.scale(k, k);
    const w = W / k, y0 = 22;
    txt(g, fmt(h[0]), w / 2, y0, 50, 900, '#fff', 'center', 1);
    txt(g, 'BEST ' + fmt(h[1]), w / 2, y0 + 56, 14, 500, 'rgba(255,255,255,.92)', 'center', 2.5);
    let y = y0 + 82;
    if (h[10]) {
      g.font = '800 26px "Segoe UI", Arial'; g.letterSpacing = '0px';
      const a = '+' + fmt(h[2]), b = '×' + h[3].toFixed(1), wa = g.measureText(a).width, wb = g.measureText(b).width, x0 = w / 2 - (wa + 10 + wb) / 2;
      txt(g, a, x0, y + 2, 26, 800, '#ffd84a', 'left'); txt(g, b, x0 + wa + 10, y + 2, 26, 800, '#ffd84a', 'left');
    }
    y += 36;
    g.fillStyle = 'rgba(110,128,146,.85)'; rr(g, w / 2 - 116, y, 232, 7, 3.5); g.fill();
    if (h[4] > 0) { g.fillStyle = '#ffd84a'; rr(g, w / 2 - 116, y, 232 * h[4], 7, 3.5); g.fill(); }
    y += 13;
    // messages: newest on top, max 3, pop in and fade out like the game's
    const ms = clip.events.filter(e => e.k === 'msg' && t >= e.t && t < e.t + (e.crash ? 2.2 : 1.5) + 0.45).slice(-3).reverse();
    for (const m of ms) {
      const age = t - m.t, life = (m.crash ? 2.2 : 1.5), inK = U.clamp(age / 0.32, 0, 1), outK = U.clamp((age - life) / 0.45, 0, 1);
      const sc = 0.85 + 0.15 * (1 - Math.pow(1 - inK, 3)) * (1 + 0.12 * Math.sin(inK * Math.PI)), al = Math.min(inK * 1.6, 1) * (1 - U.clamp(outK / 0.6, 0, 1));
      const shake = m.crash && age < 0.45 ? Math.sin(age * 70) * 5 * (1 - age / 0.45) : 0;
      g.save(); g.globalAlpha = al; g.translate(w / 2 + shake, y + 18 - (1 - inK) * 10 - outK * 6); g.scale(sc, sc);
      txt(g, m.text, 0, -18, 27, 900, m.crash ? '#ff6b6b' : '#fff', 'center', 0.5, m.crash ? 'rgba(255,70,70,.55)' : null);
      g.restore();
      y += 36 * (1 - outK);
    }
    // end-of-streak card
    const r = clip.events.filter(e => e.k === 'res' && t >= e.t && t < e.t + 5.6).pop();
    if (r) {
      const age = t - r.t, al = Math.min(1, age / 0.35) * (1 - U.clamp((age - 5.2) / 0.35, 0, 1));
      g.save(); g.globalAlpha = al; g.translate(0, y + 6 - (1 - Math.min(1, age / 0.4)) * 8);
      g.font = '700 14px "Segoe UI", Arial'; g.letterSpacing = '1.5px';
      const sub = `TOP MULTIPLIER ×${r.peak.toFixed(1)}` + (r.best ? ' · NEW BEST!' : ''), cw = Math.max(200, g.measureText(sub).width + 52);
      g.fillStyle = 'rgba(16,20,28,.55)'; rr(g, w / 2 - cw / 2, 0, cw, 86, 10); g.fill();
      txt(g, 'STREAK ENDED', w / 2, 10, 13, 700, 'rgba(255,255,255,.85)', 'center', 3);
      txt(g, fmt(r.points), w / 2, 26, 40, 900, '#ffd84a');
      txt(g, sub, w / 2, 66, 14, 700, r.best ? '#7dffa4' : 'rgba(255,255,255,.9)', 'center', 1.5);
      g.restore();
    }
    // multiplayer proximity bonus
    if (h[9] > 1) { txt(g, 'PROXY', w / 2 + 150, 34, 15, 900, '#7fe3ff', 'left', 2); txt(g, '×' + h[9].toFixed(1), w / 2 + 150, 52, 30, 900, '#7fe3ff', 'left'); }
    // speedometer (bottom right)
    const hh = H / k, R = w - 26, Bm = hh - 22;
    txt(g, String(Math.round(h[5] * (mph ? 2.23694 : 3.6))), R - 6, Bm - 118 + 18, 66, 900, '#fff', 'right', 1);
    txt(g, mph ? 'MPH' : 'KM/H', R - 6, Bm - 118 + 82, 16, 800, 'rgba(255,255,255,.95)', 'right', 2);
    txt(g, h[6] < 0 ? 'R' : h[6] === 0 ? 'N' : String(h[6]), R - 250 + 18 + 23, Bm - 118 + 34, 34, 900, '#fff');
    g.fillStyle = 'rgba(0,0,0,.22)'; rr(g, R - 250 + 18, Bm - 9, 250 - 24, 5, 2.5); g.fill();
    const gr = g.createLinearGradient(R - 232, 0, R - 6, 0); gr.addColorStop(0, '#ff5a3c'); gr.addColorStop(0.7, '#ff9a3c'); gr.addColorStop(1, '#ffd84a');
    g.fillStyle = h[8] ? '#ff3030' : gr; rr(g, R - 250 + 18, Bm - 9, (250 - 24) * h[7], 5, 2.5); g.fill();
    g.restore();
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, Math.max(w, 0), h, Math.min(r, w / 2)) : g.rect(x, y, Math.max(w, 0), h); }

  // ---------------------------------------------------------------- draw one frame of the replay
  const realBlur = window.blurAmount;
  function render(clip, t, dt, mode, withHud, hudCanvas) {
    const P = pose(clip, t);
    placeCamera(mode, P, dt);
    const inCar = mode === 'game' && P.cockpit;
    playerBike.riderTop.visible = !(mode === 'game' && P.firstPerson);   // (motorcycle, first person: you're the rider)
    cockpit.visible = cockpitWheel.visible = inCar; interior.visible = swMesh.visible = !inCar;
    playerGlass.opacity = inCar ? P.glass : 0.78;
    if (!inCar) { /* (outside views always show the body lean) */ }
    sunLight.position.set(P.x + SUN_OFF.x, SUN_OFF.y, P.z + SUN_OFF.z); sunLight.target.position.set(P.x, 0, P.z);
    world.fillAll(P.s); world.update(P.s, camera);
    window.blurAmount = () => (mode === 'game' ? P.blur : P.blur * 0.6);
    try { renderFrame(); } finally { window.blurAmount = realBlur; }
    if (hudCanvas) {
      const g = hudCanvas.getContext('2d');
      g.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
      if (withHud) drawHud(g, hudCanvas.width, hudCanvas.height, clip, P, t);
    }
    return P;
  }

  // ---------------------------------------------------------------- editor
  const css = `
  #recEd { position: fixed; left: 0; right: 0; bottom: 0; z-index: 60; padding: 12px 18px 14px; font: 600 13px "Segoe UI", Arial, sans-serif; color: #fff;
    background: linear-gradient(to top, rgba(10,13,19,.94), rgba(10,13,19,.82)); box-shadow: 0 -6px 24px rgba(0,0,0,.35); user-select: none; }
  #recEd .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  #recEd select, #recEd button { font: inherit; color: #fff; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.16); border-radius: 7px; padding: 6px 10px; cursor: pointer; }
  #recEd select option { background: #161b24; }
  #recEd button:hover, #recEd select:hover { background: rgba(255,255,255,.16); }
  #recEd .go { background: #ffd84a; color: #14181f; border-color: #ffd84a; font-weight: 800; }
  #recEd .go:hover { background: #ffe27a; }
  #recEd label { display: flex; gap: 6px; align-items: center; cursor: pointer; opacity: .9; }
  #recEd .grow { flex: 1; }
  #recEd .t { font-variant-numeric: tabular-nums; opacity: .85; min-width: 120px; }
  #recTl { display: block; width: 100%; height: 46px; margin-top: 10px; cursor: pointer; border-radius: 8px; }
  #recHud { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5; }
  #recBadge { position: fixed; top: 10px; left: 12px; z-index: 70; font: 800 11px "Segoe UI", Arial; letter-spacing: 1.5px; color: #fff; opacity: .55;
    text-shadow: 0 1px 3px rgba(0,0,0,.6); pointer-events: none; }
  #recBadge i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #ff4d4d; margin-right: 6px; vertical-align: 1px; }
  #recToast { position: fixed; top: 44px; left: 50%; transform: translateX(-50%); z-index: 80; padding: 9px 16px; border-radius: 8px;
    background: rgba(14,18,26,.88); font: 700 14px "Segoe UI", Arial; color: #fff; transition: opacity .3s; pointer-events: none; }
  #recBusy { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
    background: rgba(8,10,15,.86); font: 700 16px "Segoe UI", Arial; color: #fff; }
  #recBusy .bar { width: min(520px, 80vw); height: 10px; border-radius: 5px; background: rgba(255,255,255,.12); overflow: hidden; }
  #recBusy .bar i { display: block; height: 100%; width: 0; background: #ffd84a; }
  #recBusy button { font: inherit; color: #fff; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); border-radius: 7px; padding: 7px 16px; cursor: pointer; }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  // (a reminder for the first few seconds only: it would show up in screen recordings / streams)
  const badge = document.createElement('div'); badge.id = 'recBadge'; badge.innerHTML = '<i></i>REC · F9 SAVE CLIP · F10 EDIT · F8 SCREEN'; document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 12000);
  let toastT = 0;
  function toast(msg) {
    let el = document.getElementById('recToast');
    if (!el) { el = document.createElement('div'); el.id = 'recToast'; document.body.appendChild(el); }
    el.textContent = msg; el.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => (el.style.opacity = 0), 2600);
  }

  const R = { active: false, clip: null, t: 0, playing: true, mode: 'game', speed: 1, hud: true, res: '1440p', q: 1, exporting: false };
  let ed = null, hudCv = null, saved = null;
  function hidden(el, on) { if (el) el.style.visibility = on ? 'hidden' : ''; }
  // the road the clip was driven on (loop circuit or endless highway) and its world type
  function useClipWorld(clip) {
    if (!!ROAD.loop !== !!clip.loop) { ROAD.setLoop(!!clip.loop); world.reset(); }
    if (clip.theme !== world.theme) world.setTheme(clip.theme);
  }
  function open() {
    if (R.active || R.exporting) return;
    if (!clips.length && !saveClip()) return;
    R.active = true; R.clip = R.clip && clips.includes(R.clip) ? R.clip : clips[clips.length - 1];
    R.t = R.clip.inT; R.playing = true; resetCams();
    saved = { loop: !!ROAD.loop, origin: ROAD.origin, hintS: ROAD.hintS, theme: world.theme, camNear: camera.near, fov: camera.fov,
      pos: camera.position.clone(), quat: camera.quaternion.clone(), menuVis: document.getElementById('menu').style.visibility };
    try { sound.suspend(true); } catch (e) { /* (no audio yet) */ }
    saved.shown = traffic.cars.filter(c => c.vis.root.visible);       // (put back on close: wrecks don't redo it themselves)
    for (const c of saved.shown) c.vis.root.visible = false;
    for (const p of Net.players.values()) if (p.g) p.g.visible = false;
    zoneProps.group && (zoneProps.group.visible = false);
    rg.visible = true;
    hidden(document.getElementById('hud'), true); hidden(document.getElementById('menu'), true); hidden(badge, true);
    useClipWorld(R.clip);
    hudCv = document.createElement('canvas'); hudCv.id = 'recHud'; document.body.appendChild(hudCv); sizeHud();
    buildEditor();
  }
  function close() {
    if (!R.active || R.exporting) return;
    R.active = false;
    rg.visible = false;
    for (const f of fpool.values()) Net.removeVis(f);
    fpool.clear();
    if (!!ROAD.loop !== saved.loop) { ROAD.setLoop(saved.loop); world.reset(); }   // (before the origin: setLoop zeroes it)
    ROAD.origin = saved.origin; ROAD.hintS = saved.hintS;
    if (world.theme !== saved.theme) world.setTheme(saved.theme);
    camera.position.copy(saved.pos); camera.quaternion.copy(saved.quat); camera.near = saved.camNear; camera.fov = saved.fov; camera.updateProjectionMatrix();
    zoneProps.group && (zoneProps.group.visible = true);
    for (const c of saved.shown) if (traffic.cars.includes(c)) c.vis.root.visible = true;
    hidden(document.getElementById('hud'), false); document.getElementById('menu').style.visibility = saved.menuVis; hidden(badge, false);
    if (ed) ed.remove(); ed = null; if (hudCv) hudCv.remove(); hudCv = null;
    setVehicle(vehicle);                                             // (car / motorcycle as you had it)
    // the game puts your car, camera and scenery back on the next frame; the traffic shows again as it updates
    world.fillAll(car.s);
    try { if (!menuOpen) sound.suspend(false); } catch (e) { /* */ }
    if (game.mode === 'sp' && !menuOpen) openMenu('scrPause');      // (back to the game paused, not mid-swerve)
  }
  function sizeHud() { if (hudCv) { hudCv.width = innerWidth; hudCv.height = innerHeight; } }
  addEventListener('resize', sizeHud);

  function buildEditor() {
    ed = document.createElement('div'); ed.id = 'recEd';
    const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('');
    ed.innerHTML = `
      <div class="row">
        <select data-k="clip"></select>
        <button data-k="play">❚❚</button>
        <span class="t" data-k="time"></span>
        <select data-k="mode" title="Camera">${opt(CAMS, R.mode)}</select>
        <select data-k="speed" title="Speed">${opt([['1', 'Normal speed'], ['0.5', 'Slow motion ½×'], ['0.25', 'Slow motion ¼×']], String(R.speed))}</select>
        <label><input type="checkbox" data-k="hud"${R.hud ? ' checked' : ''}> HUD</label>
        <span class="grow"></span>
        <button data-k="in" title="Start the clip here (I)">Set start</button>
        <button data-k="out" title="End the clip here (O)">Set end</button>
        <select data-k="res" title="Resolution">${opt(Object.keys(RES).map(r => [r, r + ' · 60 fps']), R.res)}</select>
        <select data-k="q" title="Quality">${opt([['1', 'High quality'], ['1.6', 'Very high quality']], String(R.q))}</select>
        <button class="go" data-k="export">Export MP4</button>
        <button data-k="del" title="Delete this clip">Delete</button>
        <button data-k="close" title="Back to the game (Esc)">Close</button>
      </div>
      <canvas id="recTl"></canvas>`;
    document.body.appendChild(ed);
    const $ = k => ed.querySelector(`[data-k="${k}"]`);
    const fillClips = () => { $('clip').innerHTML = clips.map((c, i) => `<option value="${i}"${c === R.clip ? ' selected' : ''}>${c.name} (${Math.round(c.dur)} s)</option>`).join(''); };
    fillClips();
    $('clip').onchange = e => { R.clip = clips[+e.target.value]; useClipWorld(R.clip); R.t = R.clip.inT; resetCams(); };
    $('play').onclick = () => { R.playing = !R.playing; };
    $('mode').onchange = e => { R.mode = e.target.value; resetCams(); };
    $('speed').onchange = e => { R.speed = +e.target.value; };
    $('hud').onchange = e => { R.hud = e.target.checked; };
    $('res').onchange = e => { R.res = e.target.value; };
    $('q').onchange = e => { R.q = +e.target.value; };
    $('in').onclick = () => setIn(); $('out').onclick = () => setOut();
    $('export').onclick = () => exportClip();
    $('del').onclick = () => {
      const i = clips.indexOf(R.clip); if (i < 0) return;
      clips.splice(i, 1);
      if (!clips.length) { close(); toast('Clip deleted'); return; }
      R.clip = clips[Math.min(i, clips.length - 1)]; useClipWorld(R.clip); R.t = R.clip.inT; fillClips();
    };
    $('close').onclick = () => close();
    ed.querySelectorAll('select, button, input').forEach(el => el.addEventListener('keydown', e => e.stopPropagation()));
    // timeline: click / drag to move; drag the yellow handles to trim
    const tl = $('clip').closest('#recEd').querySelector('#recTl');
    let drag = null;
    const tAt = e => { const r = tl.getBoundingClientRect(); return U.clamp((e.clientX - r.left) / r.width, 0, 1) * R.clip.dur; };
    tl.onpointerdown = e => {
      tl.setPointerCapture(e.pointerId);
      const t = tAt(e), px = R.clip.dur / tl.getBoundingClientRect().width * 10;
      drag = Math.abs(t - R.clip.inT) < px ? 'in' : Math.abs(t - R.clip.outT) < px ? 'out' : 'seek';
      move(e);
    };
    const move = e => {
      if (!drag) return;
      const t = tAt(e);
      if (drag === 'in') { R.clip.inT = Math.min(t, R.clip.outT - 0.5); R.t = R.clip.inT; }
      else if (drag === 'out') { R.clip.outT = Math.max(t, R.clip.inT + 0.5); R.t = Math.max(R.clip.inT, R.clip.outT - 1); }
      else R.t = U.clamp(t, R.clip.inT, R.clip.outT);
      resetCams();
    };
    tl.onpointermove = move; tl.onpointerup = () => (drag = null);
    R.ui = { $, tl };
  }
  function setIn() { R.clip.inT = Math.min(R.t, R.clip.outT - 0.5); }
  function setOut() { R.clip.outT = Math.max(R.t, R.clip.inT + 0.5); }
  function drawTimeline() {
    const tl = R.ui.tl, w = tl.clientWidth, h = tl.clientHeight, dpr = devicePixelRatio || 1;
    if (tl.width !== Math.round(w * dpr)) { tl.width = Math.round(w * dpr); tl.height = Math.round(h * dpr); }
    const g = tl.getContext('2d'), c = R.clip, X = t => t / c.dur * w;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, 8, w, h - 16);
    g.fillStyle = 'rgba(255,216,74,.22)'; g.fillRect(X(c.inT), 8, X(c.outT) - X(c.inT), h - 16);
    for (const e of c.events) {                                  // near misses / crashes as ticks: where the action is
      if (e.k !== 'msg') continue;
      g.fillStyle = e.crash ? '#ff6b6b' : 'rgba(255,255,255,.55)'; g.fillRect(X(e.t) - 1, h - 16, 2, 8);
    }
    g.fillStyle = '#ffd84a'; g.fillRect(X(c.inT) - 3, 2, 6, h - 4); g.fillRect(X(c.outT) - 3, 2, 6, h - 4);
    g.fillStyle = '#fff'; g.fillRect(X(R.t) - 1, 0, 2, h);
    const s = (c.outT - c.inT) / R.speed;
    R.ui.$('time').textContent = `${(R.t - c.inT).toFixed(1)} / ${(c.outT - c.inT).toFixed(1)} s` + (R.speed !== 1 ? ` (video ${s.toFixed(1)} s)` : '');
    R.ui.$('play').textContent = R.playing ? '❚❚' : '▶';
  }
  function frame(dt) {
    if (R.exporting) return;
    const c = R.clip;
    if (R.playing) { R.t += dt * R.speed; if (R.t > c.outT) { R.t = c.inT; resetCams(); } }
    render(c, R.t, dt, R.mode, R.hud, hudCv);
    drawTimeline();
  }

  // ---------------------------------------------------------------- export: frame by frame, exactly 60 fps
  // let the page breathe between frames (a message, not a timer: timers crawl when the tab is in the background,
  // so the export keeps going at full speed even if you switch to another tab meanwhile)
  const breathe = () => new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
  let muxerP = null;
  function loadMuxer() {
    if (window.Mp4Muxer) return Promise.resolve();
    return muxerP || (muxerP = new Promise((ok, bad) => {
      const s = document.createElement('script'); s.src = MUXER_URL; s.onload = ok; s.onerror = () => { muxerP = null; bad(new Error('Could not load the MP4 writer (check your internet).')); };
      document.head.appendChild(s);
    }));
  }
  async function exportClip() {
    if (R.exporting) return;
    if (typeof VideoEncoder === 'undefined') { toast('This browser can\'t make videos: use Chrome or Edge'); return; }
    const [W, H, codec, rate] = RES[R.res], c = R.clip, bitrate = Math.round(rate * R.q);
    const cfg = { codec, width: W, height: H, bitrate, framerate: FPS, latencyMode: 'quality', avc: { format: 'avc' } };
    try {
      const sup = await VideoEncoder.isConfigSupported(cfg);
      if (!sup.supported) { toast(`This computer can't encode ${R.res}: try a smaller size`); return; }
      await loadMuxer();
    } catch (e) { toast(e.message); return; }
    R.exporting = true; R.cancel = false;
    const busy = document.createElement('div'); busy.id = 'recBusy';
    busy.innerHTML = `<div data-k="msg">Making your ${R.res} video…</div><div class="bar"><i></i></div><div data-k="sub" style="font-size:13px;opacity:.7"></div><button>Cancel</button>`;
    document.body.appendChild(busy);
    busy.querySelector('button').onclick = () => { R.cancel = true; };
    const bar = busy.querySelector('.bar i'), sub = busy.querySelector('[data-k="sub"]');
    // render at the video size (the screen just shows it squeezed underneath the progress screen)
    const pr = renderer.getPixelRatio(), aspect = camera.aspect;
    renderer.setPixelRatio(1); renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
    fxResize(); BLUR.rtPost.setSize(W, H);
    const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
    const cg = comp.getContext('2d'), hudLayer = document.createElement('canvas'); hudLayer.width = W; hudLayer.height = H;
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
    let err = null;
    const enc = new VideoEncoder({ output: (chunk, m) => muxer.addVideoChunk(chunk, m), error: e => { err = e; } });
    enc.configure(cfg);
    const n = Math.max(1, Math.round((c.outT - c.inT) / R.speed * FPS)), t0 = performance.now();
    let ok = false;
    try {
      resetCams();
      for (let i = 0; i < n && !R.cancel && !err; i++) {
        const t = c.inT + i / FPS * R.speed;
        render(c, t, 1 / FPS, R.mode, R.hud, hudLayer);
        cg.drawImage(renderer.domElement, 0, 0, W, H);
        if (R.hud) cg.drawImage(hudLayer, 0, 0);
        const vf = new VideoFrame(comp, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        enc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
        vf.close();
        while (enc.encodeQueueSize > 3) await breathe();
        if (i % 3 === 0) {
          const el = (performance.now() - t0) / 1000, left = el / (i + 1) * (n - i - 1);
          bar.style.width = ((i + 1) / n * 100).toFixed(1) + '%';
          sub.textContent = `frame ${i + 1} of ${n} · about ${left < 60 ? Math.ceil(left) + ' s' : Math.ceil(left / 60) + ' min'} left`;
          await breathe();
        }
      }
      if (err) throw err;
      if (!R.cancel) {
        await enc.flush(); muxer.finalize();
        const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
        const a = document.createElement('a'), d = new Date(), p2 = x => String(x).padStart(2, '0');
        a.href = URL.createObjectURL(blob);
        a.download = `PolyWeave ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())} ${R.res}.mp4`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        ok = true;
        toast(`Saved ${R.res} video (${(blob.size / 1048576).toFixed(0)} MB) to your Downloads`);
      }
    } catch (e) { toast('Export failed: ' + (e && e.message || e)); console.error(e); }
    finally {
      try { if (enc.state !== 'closed') enc.close(); } catch (e) { /* */ }
      renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); camera.aspect = aspect; camera.updateProjectionMatrix();
      fxResize(); { const z = renderer.getDrawingBufferSize(new THREE.Vector2()); BLUR.rtPost.setSize(z.x, z.y); }
      busy.remove(); R.exporting = false; resetCams();
      if (!ok && R.cancel) toast('Export cancelled');
    }
  }

  // ---------------------------------------------------------------- screen recorder (F8): menus, leaderboards, profile...
  // Records this tab live (the browser's own tab capture + its hardware video encoder). The panel and every hint
  // disappear the moment recording starts, so the video is just the game; F8 (or the browser's "Stop sharing")
  // stops it and the video goes to Downloads.
  const SR = { rec: null, stream: null, chunks: [], t0: 0, panel: null, fps: 60, q: 1 };
  const srMime = () => ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  function srPanel() {
    if (SR.panel) { SR.panel.remove(); SR.panel = null; return; }
    const p = document.createElement('div'); p.id = 'recScreen';
    p.style.cssText = 'position:fixed;top:16px;right:16px;z-index:95;width:300px;padding:16px 18px;border-radius:12px;background:rgba(10,13,19,.94);'
      + 'box-shadow:0 8px 30px rgba(0,0,0,.45);font:600 13px "Segoe UI",Arial,sans-serif;color:#fff;display:flex;flex-direction:column;gap:10px';
    const sel = (opts, cur) => `<select style="font:inherit;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:7px;padding:5px 8px">${opts.map(([v, l]) => `<option value="${v}" style="background:#161b24"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    p.innerHTML = `<div style="font-weight:800;letter-spacing:1.5px">SCREEN RECORDER</div>
      <div style="opacity:.75;font-weight:500;line-height:1.4">Records the game as you see it: menus, leaderboards, profile, inbox, driving. Nothing of this shows in the video. Press <b>F8</b> to stop.</div>
      <label style="display:flex;justify-content:space-between;align-items:center">Frame rate ${sel([[60, '60 fps'], [30, '30 fps']], SR.fps)}</label>
      <label style="display:flex;justify-content:space-between;align-items:center">Quality ${sel([[1, 'High'], [1.6, 'Very high']], SR.q)}</label>
      <button style="font:inherit;font-weight:800;padding:9px;border-radius:8px;border:0;background:#ff4d4d;color:#fff;cursor:pointer">● START RECORDING</button>
      <div style="opacity:.55;font-size:11.5px;line-height:1.35">Your browser asks what to share: pick <b>this tab</b>. Tip: make the window full screen first (F11) for the biggest video.</div>`;
    const [fpsSel, qSel] = p.querySelectorAll('select');
    fpsSel.onchange = () => (SR.fps = +fpsSel.value); qSel.onchange = () => (SR.q = +qSel.value);
    p.querySelectorAll('select').forEach(s => s.addEventListener('keydown', e => e.stopPropagation()));
    p.querySelector('button').onclick = () => srStart();
    document.body.appendChild(p); SR.panel = p;
  }
  async function srStart() {
    if (SR.rec) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.MediaRecorder) { toast('This browser can\'t record the screen: use Chrome or Edge'); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: SR.fps, max: SR.fps }, width: { ideal: 3840 }, height: { ideal: 2160 }, displaySurface: 'browser', cursor: 'never' },
        audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude',
      });
    } catch (e) { toast('Recording cancelled'); return; }
    const track = stream.getVideoTracks()[0], set = track.getSettings ? track.getSettings() : {};
    const px = (set.width || 1920) * (set.height || 1080);
    const mime = srMime(), bitrate = Math.round(Math.min(60e6, px / (2560 * 1440) * 28e6) * SR.q * (SR.fps / 60 * 0.5 + 0.5));
    let rec;
    try { rec = new MediaRecorder(stream, Object.assign({ videoBitsPerSecond: Math.max(8e6, bitrate) }, mime ? { mimeType: mime } : {})); }
    catch (e) { stream.getTracks().forEach(t => t.stop()); toast('Could not start recording: ' + e.message); return; }
    SR.rec = rec; SR.stream = stream; SR.chunks = []; SR.t0 = performance.now();
    rec.ondataavailable = e => { if (e.data && e.data.size) SR.chunks.push(e.data); };
    rec.onstop = srSave;
    track.onended = () => srStop();                  // (the browser's own "Stop sharing" button)
    if (SR.panel) { SR.panel.remove(); SR.panel = null; }
    const t = document.getElementById('recToast'); if (t) t.style.opacity = 0;   // (nothing of the recorder in the video)
    rec.start(1000);
    SR.size = `${set.width || '?'}x${set.height || '?'} at ${Math.round(set.frameRate || SR.fps)} fps`;
  }
  function srStop() {
    if (!SR.rec) return;
    if (SR.rec.state !== 'inactive') SR.rec.stop();
    SR.stream.getTracks().forEach(t => t.stop());
  }
  function srSave() {
    const rec = SR.rec, secs = (performance.now() - SR.t0) / 1000; SR.rec = null;
    const type = (rec.mimeType || 'video/webm').split(';')[0], ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(SR.chunks, { type }); SR.chunks = [];
    if (!blob.size) { toast('Nothing was recorded'); return; }
    const a = document.createElement('a'), d = new Date(), p2 = x => String(x).padStart(2, '0');
    a.href = URL.createObjectURL(blob);
    a.download = `PolyWeave screen ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`Saved ${Math.round(secs)} s screen recording (${SR.size}, ${(blob.size / 1048576).toFixed(0)} MB) to your Downloads`);
  }

  // ---------------------------------------------------------------- keys
  addEventListener('keydown', e => {
    if (!Account.signedIn) return;
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName) && document.activeElement.type !== 'checkbox';
    if (e.code === 'F8' && !typing) { e.preventDefault(); if (SR.rec) srStop(); else if (!R.active) srPanel(); return; }
    if (e.code === 'F9' && !typing) { e.preventDefault(); if (!R.active) saveClip(); return; }
    if (e.code === 'F10' && !typing) { e.preventDefault(); R.active ? close() : open(); return; }
    if (!R.active || R.exporting || typing) return;
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    else if (e.code === 'Space') { e.preventDefault(); R.playing = !R.playing; }
    else if (e.code === 'KeyI') setIn();
    else if (e.code === 'KeyO') setOut();
    else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); R.playing = false; R.t = U.clamp(R.t + (e.code === 'ArrowLeft' ? -1 : 1) / FPS * (e.shiftKey ? 30 : 1), R.clip.inT, R.clip.outT); resetCams(); }
  }, true);

  window.Recorder = { capture, frame, open, close, saveClip, clips, get active() { return R.active; } };
  toast('Recorder ready · F9 saves the last minute · F10 opens the editor · F8 records the screen (menus)');
})();
