'use strict';
// =====================================================================
//  PolyWeave Clip Studio (the owners and Content Creators: the server hands this file to nobody else)
//  - Film > Clip Studio: pick the map (the highway, the green screen room; the owners also the drift track), world, time of day and how you start, then START RUN: an empty road, and every
//    move your car makes is recorded (from the moment it moves, up to 5 minutes). F8 finishes the run, F7 starts again.
//  - Runs are kept in this browser (IndexedDB) and open in the video recorder's editor (tools/recorder.js): cameras,
//    slow motion, trim, MP4 export - plus a TRAFFIC panel: place cars (type, lane, speed, where they are next to you),
//    or Autofill a whole road of them that miss your path. Every car can be changed or deleted after.
//  - Placed cars drive at a steady speed in their lane, so the same clip always plays back the same.
// =====================================================================
(() => {
  if (window.Studio || !window.Recorder) return;
  const MAX_T = 300;                                     // longest run (s)
  const MAPS = [['highway', 'Highway'], ...DRIFT_TRACKS.map(t => [t.id, t.name])];
  const WORLDS = [['grass', 'Grassy'], ['desert', 'Desert'], ['snow', 'Snowy']];
  const TODS = [['day', 'Day'], ['sunset', 'Evening'], ['night', 'Night']];
  const STARTS = [['0', 'Standing'], ['60', '60 km/h'], ['100', '100 km/h']];
  const mapName = id => (MAPS.find(m => m[0] === id) || [id, id])[1];
  const pick = list => { let t = 0; for (const x of list) t += x.w; let r = Math.random() * t; for (const x of list) if ((r -= x.w) < 0) return x; return list[0]; };
  const hex = c => '#' + c.toString(16).padStart(6, '0');

  // ---------------------------------------------------------------- your settings + saved runs (this browser)
  let cfg = { map: 'highway', world: Settings.world || 'grass', tod: Settings.tod || 'day', start: '0' };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem('pwStudioCfg') || '{}')); } catch (e) { /* */ }
  const saveCfg = () => { try { localStorage.setItem('pwStudioCfg', JSON.stringify(cfg)); } catch (e) { /* */ } };
  const DB = (() => {
    let p = null;
    const db = () => p || (p = new Promise((ok, bad) => {
      const r = indexedDB.open('polyweave-studio', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('runs', { keyPath: 'id' });
      r.onsuccess = () => ok(r.result); r.onerror = () => { p = null; bad(r.error); };
    }));
    const tx = (mode, fn) => db().then(d => new Promise((ok, bad) => {
      const t = d.transaction('runs', mode), q = fn(t.objectStore('runs'));
      t.oncomplete = () => ok(q && q.result); t.onerror = () => bad(t.error);
    }));
    return { all: () => tx('readonly', s => s.getAll()), put: r => tx('readwrite', s => s.put(r)), del: id => tx('readwrite', s => s.delete(id)) };
  })();
  const runs = new Map();                                // id -> { id, name, created, cfg, clip }
  const store = r => DB.put(r).catch(e => toast('Could not save the run in this browser: ' + (e && e.message || e)));

  // ---------------------------------------------------------------- look
  const st = document.createElement('style');
  st.textContent = `
  #scrStudio .stdRuns { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
  #scrStudio .stdRun { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 9px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); }
  #scrStudio .stdRun .nm { flex: 1; min-width: 0; } #scrStudio .stdRun .nm b { display: block; } #scrStudio .stdRun .nm small { opacity: .65; }
  #scrStudio .stdRun button { padding: 6px 12px; font-size: 12px; }
  #scrStudio .stdKeys { font-size: 12px; opacity: .7; margin: 10px 0 0; }
  #scrStudio h3 { margin: 22px 0 0; letter-spacing: 2px; font-size: 14px; opacity: .85; }
  #stdRec { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 40; padding: 8px 16px; border-radius: 9px; pointer-events: none;
    background: rgba(12,15,22,.78); font: 800 13px "Segoe UI", Arial, sans-serif; letter-spacing: 1.5px; color: #fff; }
  #stdRec i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #ff4d4d; margin-right: 8px; vertical-align: 0; }
  #stdRec.armed i { background: #ffd84a; }
  #stdPanel { position: fixed; right: 12px; top: 12px; bottom: 150px; width: 340px; z-index: 61; display: flex; flex-direction: column; gap: 8px; padding: 12px;
    border-radius: 12px; font: 600 12px "Segoe UI", Arial, sans-serif; color: #fff; background: rgba(10,13,19,.88); box-shadow: 0 6px 24px rgba(0,0,0,.35); user-select: none; }
  #stdPanel .hd { display: flex; align-items: baseline; gap: 8px; font-size: 13px; letter-spacing: 1.5px; }
  #stdPanel .hd span { opacity: .6; letter-spacing: 0; }
  #stdPanel .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  #stdPanel button, #stdPanel select, #stdPanel input[type=number] { font: inherit; color: #fff; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.16); border-radius: 6px; padding: 4px 7px; }
  #stdPanel select option { background: #161b24; }
  #stdPanel button { cursor: pointer; } #stdPanel button:hover { background: rgba(255,255,255,.16); }
  #stdPanel button.go2 { background: #ffd84a; color: #14181f; border-color: #ffd84a; font-weight: 800; }
  #stdPanel input[type=number] { width: 52px; }
  #stdPanel input[type=range] { flex: 1; }
  #stdPanel .list { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 5px; scrollbar-width: thin; }
  #stdPanel .car { padding: 6px; border-radius: 8px; background: rgba(255,255,255,.05); border: 1px solid transparent; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; cursor: pointer; }
  #stdPanel .car.sel { border-color: #7fe3ff; background: rgba(127,227,255,.1); }
  #stdPanel .car .sw { width: 20px; height: 20px; padding: 0; border-radius: 5px; border: 1px solid rgba(255,255,255,.35); background: none; cursor: pointer; -webkit-appearance: none; appearance: none; }
  #stdPanel .car .sw::-webkit-color-swatch-wrapper { padding: 0; } #stdPanel .car .sw::-webkit-color-swatch { border: none; border-radius: 4px; }
  #stdPanel .car .sw::-moz-color-swatch { border: none; border-radius: 4px; }
  #stdPanel .car .tag { font-size: 10px; opacity: .55; letter-spacing: 1px; }
  #stdPanel .car .warn { width: 100%; color: #ff8a7a; font-size: 11px; }
  #stdPanel .hint { opacity: .6; font-size: 11px; line-height: 1.35; }`;
  document.head.appendChild(st);
  let toastT = 0;
  function toast(msg) {
    let el = document.getElementById('recToast');
    if (!el) { el = document.createElement('div'); el.id = 'recToast'; document.body.appendChild(el); }
    el.textContent = msg; el.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => (el.style.opacity = 0), 2800);
  }

  // ---------------------------------------------------------------- Play > Clip Studio
  const seg = (k, list) => `<div class="seg" data-k="${k}">${list.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`;
  const scr = document.createElement('div'); scr.id = 'scrStudio'; scr.className = 'screen panel hidden';
  scr.innerHTML = `
    <div class="hdr"><button class="back" data-k="back">← BACK</button><h1>CLIP STUDIO</h1></div>
    <p class="sub">Drive a run on an empty road: every move is recorded. Then place the traffic in the editor and export the clip.</p>
    <div class="picks">
      <div class="pickRow"><span>Map</span>${seg('map', MAPS)}</div>
      <div class="pickRow" data-k="worldRow"><span>World</span>${seg('world', WORLDS)}</div>
      <div class="pickRow"><span>Time of day</span>${seg('tod', TODS)}</div>
      <div class="pickRow"><span>Start</span>${seg('start', STARTS)}</div>
    </div>
    <div class="stack"><button class="go" data-k="go">START RUN</button></div>
    <p class="stdKeys">Recording starts as soon as your car moves · <b>F8</b> finish the run (opens the editor) · <b>F7</b> start again · up to 5 minutes</p>
    <h3>SAVED RUNS</h3>
    <div class="stdRuns" data-k="runs"></div>`;
  document.getElementById('menu').appendChild(scr);
  const $ = k => scr.querySelector(`[data-k="${k}"]`);
  for (const k of ['map', 'world', 'tod', 'start']) $(k).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cfg[k] = b.dataset.v; saveCfg(); paint(); });
  function paint() {
    for (const b of $('map').children) b.style.display = b.dataset.v === 'highway' || DriftTrack.available(b.dataset.v) ? '' : 'none';   // (the drift track: the owners only)
    if (cfg.map !== 'highway' && !DriftTrack.available(cfg.map)) cfg.map = 'highway';
    for (const k of ['map', 'world', 'tod', 'start']) for (const b of $(k).children) b.classList.toggle('sel', b.dataset.v === String(cfg[k]));
    $('worldRow').style.display = cfg.map === 'highway' ? '' : 'none';   // (the drift tracks have their own forest)
  }
  $('back').onclick = () => show('scrFilm');
  $('go').onclick = () => startRun();
  async function listRuns() {
    try { for (const r of await DB.all()) if (!runs.has(r.id)) runs.set(r.id, r); } catch (e) { /* (private window: this session only) */ }
    const el = $('runs'), all = [...runs.values()].sort((a, b) => b.created - a.created);
    el.innerHTML = all.length ? '' : '<p class="sub">No runs yet: start one above.</p>';
    for (const r of all) {
      const d = document.createElement('div'); d.className = 'stdRun';
      const n = r.clip.studio.cars.length;
      d.innerHTML = `<div class="nm"><b></b><small>${mapName(r.cfg.map)} · ${Math.round(r.clip.dur)} s · ${n} car${n === 1 ? '' : 's'} · ${PLAYER_CARS[r.cfg.car] ? PLAYER_CARS[r.cfg.car].short : ''}</small></div>
        <button class="go" data-a="traffic" title="Place and change the traffic">TRAFFIC</button><button class="go alt" data-a="video" title="Cameras, slow motion, trim and export - with your traffic">VIDEO</button><button data-a="ren">RENAME</button><button data-a="del">DELETE</button>`;
      d.querySelector('b').textContent = r.name;
      d.querySelector('[data-a="traffic"]').onclick = () => editRun(r, 'traffic');
      d.querySelector('[data-a="video"]').onclick = () => editRun(r, 'video');
      d.querySelector('[data-a="ren"]').onclick = () => { const v = prompt('Name this run', r.name); if (v && v.trim()) { r.name = r.clip.name = v.trim().slice(0, 60); store(r); listRuns(); } };
      d.querySelector('[data-a="del"]').onclick = () => { if (!confirm(`Delete "${r.name}"? This can't be undone.`)) return; runs.delete(r.id); DB.del(r.id).catch(() => {}); listRuns(); };
      el.appendChild(d);
    }
  }
  // (opened from its card in the Film area: js/film.js)
  function openScreen() { if (!canSpecial()) return; paint(); listRuns(); if (menuOpen) show('scrStudio'); else openMenu('scrStudio'); }

  // ---------------------------------------------------------------- the map, empty, your car at the start
  function enterWorld(c, kmh) {
    if (Net.active()) { quitting = true; Net.leave(); quitting = false; }
    Race.exit(); score.reset();
    const v = (+kmh || 0) / 3.6;
    if (c.map === 'highway') {
      DriftTrack.exit();
      game.mode = 'sp'; game.scored = false; game.density = 0;
      setWorld(c.world, c.tod); startPosition();
      car.place(40, ROAD.lane(2), v); car.tc = Settings.tc; car.manual = Settings.manual; car.hitT = 0;
      const p = ROAD.project(car.x, car.z); car.s = p.s; car.d = p.d; ROAD.hintS = car.s;
      camS.yaw = car.yaw; camS.shift = 0; Object.assign(proxy, { s: car.s, d: car.d, v: car.u });
      traffic.clear();
      closeMenu();
    } else {
      const old = Settings.tod; Settings.tod = c.tod; DriftTrack.enter(c.map); Settings.tod = old;
      if (v) DriftTrack.place(0, 0, v);
    }
    score.reset();
    worldKey = key(c);
  }
  const key = c => c.map === 'highway' ? `highway:${c.world}:${c.tod}` : `${c.map}:${c.tod}`;
  let worldKey = null;

  // ---------------------------------------------------------------- recording a run
  const run = { on: false, armed: false, t: 0, samples: [], cfg: null };
  const badge = document.createElement('div'); badge.id = 'stdRec'; badge.style.display = 'none'; document.body.appendChild(badge);
  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  function paintBadge() {
    badge.style.display = run.on && !menuOpen && !Recorder.active ? '' : 'none';
    badge.className = run.armed ? 'armed' : '';
    badge.innerHTML = run.armed ? '<i></i>READY · RECORDING STARTS WHEN YOU MOVE · F7 RESTART' : `<i></i>REC ${mmss(run.t)} · F8 FINISH · F7 RESTART`;
  }
  function startRun() {
    if (!canSpecial()) return;
    run.cfg = Object.assign({}, cfg, { car: carKey });
    enterWorld(run.cfg, run.cfg.start);
    run.on = true; run.armed = true; run.t = 0; run.samples = [];
    paintBadge();
  }
  function restartRun() {
    if (!run.on) return;
    enterWorld(run.cfg, run.cfg.start);
    run.armed = true; run.t = 0; run.samples = [];
    paintBadge(); toast('Run restarted');
  }
  const cap = Recorder.capture;
  Recorder.capture = dt => {
    cap(dt);
    if (!run.on || menuOpen || game.mode === 'menu' || Recorder.active) return;
    if (run.armed) { if (Math.hypot(car.u, car.v) < 0.3) { paintBadge(); return; } run.armed = false; }
    run.t += dt;
    const s = Recorder.sample(); s.t = run.t; run.samples.push(s);
    if (run.t >= MAX_T) { toast('5 minutes: run finished'); finishRun(); return; }
    paintBadge();
  };
  setInterval(() => { if (run.on && game.mode === 'menu') { run.on = false; } paintBadge(); }, 300);   // (quit to the title: the run is dropped)
  function finishRun() {
    if (!run.on) return;
    run.on = false; paintBadge();
    const S = run.samples;
    if (S.length < 30) { toast('Too short to keep: drive for a few seconds'); return; }
    const t0 = S[0].t; for (const s of S) s.t -= t0;
    const dur = S[S.length - 1].t, c = run.cfg, d = new Date();
    const name = `${mapName(c.map)} · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const r = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, created: Date.now(), cfg: c, clip: null };
    r.clip = { name, samples: S, dur, events: [], theme: world.theme, loop: !!ROAD.loop, units: Settings.units, inT: 0, outT: dur, studio: { runId: r.id, cars: [] } };
    runs.set(r.id, r); store(r);
    run.samples = [];
    mode = 'traffic'; Recorder.open(r.clip, { hud: false });
  }
  // a run opens in the TRAFFIC editor (the traffic panel) or for the VIDEO (cameras / export, no traffic tools) - always
  // on its own: Clip Studio runs never show up in the F10 recorder
  let mode = null;
  function editRun(r, m) {
    if (r.cfg.car && r.cfg.car !== carKey && PLAYER_CARS[r.cfg.car]) installCar(r.cfg.car);   // (the car the run was driven in)
    enterWorld(r.cfg, 0);
    mode = m; Recorder.open(r.clip, { hud: false });
  }
  addEventListener('keydown', e => {
    if (!run.on || Recorder.active || menuOpen) return;
    if (e.code === 'F8') { e.preventDefault(); e.stopImmediatePropagation(); finishRun(); }
    else if (e.code === 'F7') { e.preventDefault(); e.stopImmediatePropagation(); restartRun(); }
  }, true);

  // ---------------------------------------------------------------- your path through a run (for gaps, hits, autofill)
  const paths = new WeakMap();
  function pathOf(clip) {
    let P = paths.get(clip); if (P) return P;
    const S = clip.samples, n = S.length, T = new Float64Array(n), Sx = new Float64Array(n), Dx = new Float64Array(n), A = new Float64Array(n);
    const o = ROAD.origin, h = ROAD.hintS;
    for (let i = 0; i < n; i++) {
      const sm = S[i]; ROAD.origin = sm.origin; ROAD.hintS = sm.s;
      const q = ROAD.project(sm.pl[0], sm.pl[1]);
      T[i] = sm.t; Sx[i] = sm.s; Dx[i] = q.d; A[i] = U.wrap(-sm.pl[2] - ROAD.yaw(sm.s));   // (the car's angle to the road)
    }
    ROAD.origin = o; ROAD.hintS = h;
    P = { T, S: Sx, D: Dx, A, n }; paths.set(clip, P); return P;
  }
  function idxAt(P, t) { let lo = 0, hi = P.n - 1; if (t <= P.T[0]) return 0; if (t >= P.T[hi]) return hi; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P.T[m] <= t) lo = m; else hi = m; } return lo; }
  function youAt(P, t) {
    const i = idxAt(P, t), j = Math.min(i + 1, P.n - 1), k = j > i ? U.clamp((t - P.T[i]) / (P.T[j] - P.T[i]), 0, 1) : 0;
    const v = j > i ? (P.S[j] - P.S[i]) / Math.max(P.T[j] - P.T[i], 1e-3) : 0;
    return { s: P.S[i] + (P.S[j] - P.S[i]) * k, d: P.D[i] + (P.D[j] - P.D[i]) * k, v };
  }
  // car sizes (half length / half width, m) from the models themselves
  const dims = new Map();
  function dimsOf(k) {
    if (!dims.has(k)) { const v = makeVehicle(k, paintMat(0x888888), null, true), b = new THREE.Box3().setFromObject(v.root); dims.set(k, { l: (b.max.z - b.min.z) / 2, w: (b.max.x - b.min.x) / 2, h: b.max.y }); }
    return dims.get(k);
  }
  // ---- how a placed car moves: a steady speed in its lane (off: metres right of the lane's middle), plus maybe one
  //      lane change (lc: { t, to, dur } - indicates first, then an S-curve across) and one brake (br: { t, dv }:
  //      slows by dv km/h over 1.2 s, holds it 1.5 s, then picks up again over 3 s)
  const BR = [0, 1.2, 2.7, 5.7];
  function brakeLoss(br, t) {                            // metres it's behind where it would be without the brake
    if (!br || t <= br.t) return 0;
    const dv = br.dv / 3.6, V = [0, dv, dv, 0]; let a = 0;
    for (let i = 0; i < 3; i++) {
      const ta = br.t + BR[i], tb = br.t + BR[i + 1]; if (t <= ta) break;
      const t1 = Math.min(t, tb), v1 = V[i] + (V[i + 1] - V[i]) * (t1 - ta) / (tb - ta);
      a += (V[i] + v1) / 2 * (t1 - ta);
    }
    return a;
  }
  const carRun = (c, t) => c.kmh / 3.6 * t - brakeLoss(c.br, t);          // (metres driven since the clip's start)
  const carS = (c, t) => c.s0 + carRun(c, t);
  const carV = (c, t) => c.kmh / 3.6 - (brakeLoss(c.br, t + 0.05) - brakeLoss(c.br, t - 0.05)) / 0.1;
  const braking = (c, t) => !!c.br && t >= c.br.t && t < c.br.t + BR[2];
  const laneD = c => ROAD.lane(c.lane) + (c.off || 0);
  function carD(c, t) {
    const d0 = laneD(c); if (!c.lc) return d0;
    const k = U.clamp((t - c.lc.t) / c.lc.dur, 0, 1);
    return d0 + (ROAD.lane(c.lc.to) - d0) * k * k * (3 - 2 * k);
  }
  function carDV(c, t) {                                 // (sideways speed: the car's nose points where it's going)
    if (!c.lc) return 0; const k = (t - c.lc.t) / c.lc.dur;
    return k <= 0 || k >= 1 ? 0 : (ROAD.lane(c.lc.to) - laneD(c)) * 6 * k * (1 - k) / c.lc.dur;
  }
  // your car's own size (half length / half width), from the model you drove the run in
  // (f: how far the body's middle sits ahead of the car's own centre point)
  function youDims() { const g = playerVis.body.geometry; if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox; return { l: (b.max.z - b.min.z) / 2, w: (b.max.x - b.min.x) / 2, f: -((b.max.z + b.min.z) / 2 + playerVis.root.position.z) }; }
  // do two boxes touch (with M metres to spare)? you turned by a to the road (a drift), the car by b (a lane change);
  // ds / dd: how far it is from you along / across the road (m). Checked on all four sides of both boxes
  function touch(ds, dd, a, Y, b, m, M) {
    for (const th of [0, Math.PI / 2, a, a + Math.PI / 2, b, b + Math.PI / 2]) {
      const c = Math.cos(th), s = Math.sin(th);
      const rY = Y.l * Math.abs(Math.cos(a - th)) + Y.w * Math.abs(Math.sin(a - th)), rC = m.l * Math.abs(Math.cos(b - th)) + m.w * Math.abs(Math.sin(b - th));
      if (Math.abs(ds * c + dd * s) > rY + rC + M) return false;
    }
    return true;
  }
  // (the endless road's s counts straight ahead, not along its bends: this turns it into real metres along the road)
  const alongK = s => ROAD.loop ? 1 : Math.hypot(1, ROAD.dcx(s));
  // the first moment this car touches you (M: how much room it must leave, m), or null
  function hitTime(c, P, M = 0) {
    const m = dimsOf(c.key), Y = P.you || (P.you = youDims());
    for (let i = 0; i < P.n; i++) {
      const t = P.T[i], a = P.A[i], raw = carS(c, t) - P.S[i];
      if (Math.abs(raw) > 16) { if (Math.abs(raw) > 32) i += 7; continue; }   // (far apart: skip ahead - nothing can close 16 m in 8 frames)
      const ds = raw * alongK(P.S[i]) - Y.f * Math.cos(a), dd = carD(c, t) - P.D[i] - Y.f * Math.sin(a);
      if (touch(ds, dd, a, Y, Math.atan2(carDV(c, t), Math.max(carV(c, t), 2)), m, M)) return t;
    }
    return null;
  }
  // two placed cars that would run into each other where it can be seen (within 200 m of you) during the clip
  // (G: your position every quarter second - from grid(P))
  const grid = P => { const T = [], Ys = []; for (let t = P.T[0]; t <= P.T[P.n - 1]; t += 0.25) { T.push(t); Ys.push(youAt(P, t).s); } return { T, Ys }; };
  function clash(a, b, G) {
    const la = [a.lane, a.lc ? a.lc.to : a.lane], lb = [b.lane, b.lc ? b.lc.to : b.lane];
    if (!la.some(l => lb.includes(l))) return false;                          // (never in the same lane)
    const n = G.T.length - 1, g0 = carS(a, G.T[0]) - carS(b, G.T[0]), g1 = carS(a, G.T[n]) - carS(b, G.T[n]);
    if (Math.sign(g0) === Math.sign(g1) && Math.min(Math.abs(g0), Math.abs(g1)) > 60) return false;   // (always well apart)
    const ma = dimsOf(a.key), mb = dimsOf(b.key);
    for (let k = 0; k <= n; k++) {
      const t = G.T[k], sa = carS(a, t), sb = carS(b, t);
      if (Math.abs(sa - sb) > ma.l + mb.l + 3) continue;                     // (bumper to bumper: 3 m, packed traffic)
      if (Math.abs(sa - G.Ys[k]) > 200) continue;
      if (Math.abs(carD(a, t) - carD(b, t)) < ma.w + mb.w + 0.4) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- the placed traffic in the replay
  const grp = new THREE.Group(); grp.visible = false; scene.add(grp);
  const visOf = new Map();                               // car -> its model
  // the car picked in the list: a glowing box drawn round it (seen through anything, so there's no mistaking which car),
  // and the move tool - an arrow either side of it: drag one to slide the car left / right
  const CYAN = 0x7fe3ff, onTop = { color: CYAN, depthTest: false, depthWrite: false, transparent: true };
  const selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial(onTop));
  selBox.renderOrder = 20; grp.add(selBox);
  const gizmo = new THREE.Group(); gizmo.renderOrder = 20; grp.add(gizmo);
  const handles = [-1, 1].map(sd => {
    const h = new THREE.Group(), m = new THREE.MeshBasicMaterial(Object.assign({}, onTop, { opacity: 0.9 }));
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 8), m); shaft.rotation.z = Math.PI / 2; shaft.position.x = sd * 0.55;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 12), m); head.rotation.z = -sd * Math.PI / 2; head.position.x = sd * 1.3;
    const grab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 0.8), new THREE.MeshBasicMaterial({ visible: false })); grab.position.x = sd * 0.9;   // (an easy target to grab)
    for (const o of [shaft, head]) o.renderOrder = 20;
    h.add(shaft, head, grab); h.sd = sd; h.grab = grab; gizmo.add(h); return h;
  });
  let sel = null;
  function vis(c) {
    let v = visOf.get(c);
    if (v && (v.k !== c.key || v.col !== c.color)) { grp.remove(v.root); v = null; }
    if (!v) { v = makeVehicle(c.key, paintMat(c.color), null, true); v.k = c.key; v.col = c.color; grp.add(v.root); visOf.set(c, v); }
    return v;
  }
  Recorder.hooks.pose = (clip, t) => {
    grp.visible = !!clip.studio;
    if (!clip.studio) return;
    const cars = clip.studio.cars, live = new Set(cars);
    for (const [c, v] of visOf) if (!live.has(c)) { grp.remove(v.root); visOf.delete(c); }
    selBox.visible = gizmo.visible = false;
    const blink = (t * 1.45 % 1) < 0.55, yS = youAt(pathOf(clip), t).s;
    for (const c of cars) {
      const v = vis(c), s = carS(c, t);
      if (Math.abs(s - yS) > 600) { v.root.visible = false; continue; }   // (far off in the haze: not drawn)
      const d = carD(c, t), p = ROAD.pos(s, d), r = v.root;
      const rel = Math.atan2(carDV(c, t), Math.max(carV(c, t), 2));
      r.visible = true; r.position.set(p.x, 0, p.z); r.rotation.y = -(ROAD.yaw(s) + rel);
      const spin = s / 0.34;
      for (const w of v.wheels) { w.pivot.visible = true; w.mesh.rotation.x = spin * w.spinSign; if (w.front) w.pivot.rotation.y = w.base - rel * 3; }
      // indicator from 1.5 s before a lane change until it's across; brake lights while it's braking
      const sig = c.lc && t > c.lc.t - 1.5 && t < c.lc.t + c.lc.dur ? Math.sign(ROAD.lane(c.lc.to) - laneD(c)) : 0;
      v.spin = spin; v.brake.visible = braking(c, t); v.indL.visible = sig < 0 && blink; v.indR.visible = sig > 0 && blink;
      if (c === sel) {
        const m = dimsOf(c.key);
        selBox.visible = gizmo.visible = true;
        selBox.position.set(p.x, m.h / 2, p.z); selBox.rotation.y = r.rotation.y; selBox.scale.set(m.w * 2 + 0.25, m.h + 0.2, m.l * 2 + 0.25);
        gizmo.position.set(p.x, 0.55, p.z); gizmo.rotation.y = r.rotation.y;
        for (const h of handles) h.position.x = h.sd * (m.w + 0.35);
      }
    }
  };
  // dragging an arrow of the move tool: the car slides sideways to follow the mouse (on the road surface); the clip
  // pauses while you do it. Up to 1.6 m either way of its lane's middle
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
  let drag = null;
  const aim = e => { const b = renderer.domElement.getBoundingClientRect(); ndc.set((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1); ray.setFromCamera(ndc, camera); };
  const onHandle = e => { if (!Recorder.active || !sel || !gizmo.visible) return false; aim(e); return ray.intersectObjects(handles.map(h => h.grab), false).length > 0; };
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', e => {
    if (!onHandle(e)) return;
    e.preventDefault(); e.stopImmediatePropagation(); cv.setPointerCapture(e.pointerId);
    if (R) R.playing = false;
    snap(); drag = { c: sel };
  }, true);
  cv.addEventListener('pointermove', e => {
    if (!drag) { cv.style.cursor = onHandle(e) ? 'ew-resize' : ''; return; }
    e.stopImmediatePropagation(); aim(e);
    if (!ray.ray.intersectPlane(ground, hitP)) return;
    const c = drag.c, q = ROAD.project(hitP.x, hitP.z, {}, carS(c, R.t));
    c.off = Math.round(U.clamp(q.d - ROAD.lane(c.lane), -1.6, 1.6) * 20) / 20; c.auto = false;
  }, true);
  cv.addEventListener('pointerup', e => { if (!drag) return; e.stopImmediatePropagation(); drag = null; list(); }, true);
  // a run's map: set it up the way it was driven (its world is part of the run, not the recorder's)
  Recorder.hooks.world = clip => {
    if (!clip.studio) return false;
    const r = runs.get(clip.studio.runId);
    if (r && key(r.cfg) !== worldKey) enterWorld(r.cfg, 0);
    return true;
  };
  Recorder.hooks.close = clip => {
    grp.visible = false; sel = null; mode = null; undo.length = 0;
    if (panel) { panel.remove(); panel = null; }
    if (!clip || !clip.studio) return;
    const r = runs.get(clip.studio.runId);
    if (r) { store(r); enterWorld(r.cfg, 0); }            // (keep your edits; back at the run's start)
    openScreen();
  };

  // ---------------------------------------------------------------- the TRAFFIC panel in the editor
  // undo: the traffic as it was before each change (this editing session, up to 40 steps)
  const undo = [];
  const snap = () => { if (!R || !R.clip.studio) return; undo.push(JSON.parse(JSON.stringify(R.clip.studio.cars))); if (undo.length > 40) undo.shift(); };
  let panel = null, R = null, density = 10, close = 'scrape', lcP = 30, brP = 30;   // (density: cars per 100 m of road; lcP / brP: % of autofilled cars that change lane / brake)
  const TYPES = TTYPES.map(t => t.key);
  const TNAME = k => k.replace(/^./, c => c.toUpperCase());
  Recorder.hooks.editor = (ed, rr) => {
    R = rr;
    if (panel) { panel.remove(); panel = null; }
    sel = null;
    if (!R.clip || !R.clip.studio || !R.solo || mode !== 'traffic') return;   // (only in Clip Studio's traffic editor - never the F10 recorder)
    panel = document.createElement('div'); panel.id = 'stdPanel';
    panel.innerHTML = `
      <div class="hd"><b>TRAFFIC EDITOR</b><span data-k="n"></span><span style="flex:1"></span><button data-k="undo" title="Undo the last change (clears, autofill, adding / deleting / changing a car)">↶ Undo</button></div>
      <div class="row"><button class="go2" data-k="add" title="A car next to you at this moment">+ Car here</button><button class="go2" data-k="auto" title="Fill the road with cars that miss your path">Autofill</button></div>
      <label class="row">Density <input type="range" data-k="amt" min="1" max="30"> <b data-k="amtV"></b></label>
      <label class="row">Closeness <select data-k="close"><option value="scrape">Scrape (15-45 cm)</option><option value="close">Close (0.5-1.2 m)</option><option value="loose">Loose (anywhere)</option></select></label>
      <label class="row">Lane changes <input type="range" data-k="lcP" min="0" max="100" step="10"> <b data-k="lcV"></b></label>
      <label class="row">Braking <input type="range" data-k="brP" min="0" max="100" step="10"> <b data-k="brV"></b></label>
      <div class="row"><button data-k="clrA">Clear autofill</button><button data-k="clr">Clear all</button></div>
      <div class="hint">Cars keep a steady speed in their lane. Gap = metres ahead of you (− behind) at this moment: change it to move the car. Autofill spreads cars evenly along your whole run and ${AHEAD} m past its end; again for a new mix - the cars you placed yourself stay.</div>
      <div class="list" data-k="list"></div>`;
    document.body.appendChild(panel);
    const q = k => panel.querySelector(`[data-k="${k}"]`);
    const dTxt = () => `${density} / 100 m`;
    q('amt').value = density; q('amtV').textContent = dTxt(); q('close').value = close;
    q('amt').oninput = e => { density = +e.target.value; q('amtV').textContent = dTxt(); };
    q('close').onchange = e => { close = e.target.value; e.target.blur(); };
    for (const [k, get, set] of [['lc', () => lcP, v => (lcP = v)], ['br', () => brP, v => (brP = v)]]) {
      q(k + 'P').value = get(); q(k + 'V').textContent = get() + '% of cars';
      q(k + 'P').oninput = e => { set(+e.target.value); q(k + 'V').textContent = get() + '% of cars'; };
    }
    q('add').onclick = e => { e.target.blur(); snap(); addHere(); };
    q('auto').onclick = e => { e.target.blur(); snap(); autofill(); };
    q('clrA').onclick = e => {
      e.target.blur(); const C = R.clip.studio, n = C.cars.filter(c => c.auto).length;
      if (!n) { toast('No autofilled cars to clear'); return; }
      if (!confirm(`Remove the ${n} car${n > 1 ? 's' : ''} Autofill placed?\nCars you added or changed yourself stay. (Undo brings them back.)`)) return;
      snap(); C.cars = C.cars.filter(c => !c.auto); sel = null; list();
    };
    q('clr').onclick = e => { e.target.blur(); const n = R.clip.studio.cars.length; if (n && confirm(`Remove all ${n} cars from this clip? (Undo brings them back.)`)) { snap(); R.clip.studio.cars = []; sel = null; list(); } };
    q('undo').onclick = e => { e.target.blur(); if (!undo.length) { toast('Nothing to undo'); return; } R.clip.studio.cars = undo.pop(); sel = null; list(); toast('Undone'); };
    panel.addEventListener('keydown', e => e.stopPropagation());
    list();
  };
  const lanes = () => [0, 1, 2, 3];
  function list() {
    if (!panel) return;
    const C = R.clip.studio.cars, P = pathOf(R.clip), el = panel.querySelector('[data-k="list"]');
    panel.querySelector('[data-k="n"]').textContent = `${C.length} car${C.length === 1 ? '' : 's'}`;
    el.innerHTML = '';
    C.forEach(c => {
      const row = document.createElement('div'); row.className = 'car' + (c === sel ? ' sel' : ''); row.car = c;
      const hit = hitTime(c, P);
      row.innerHTML = `<input type="color" class="sw" data-f="pick" value="${hex(c.color)}" title="Pick its colour">
        <select data-f="key">${TYPES.map(k => `<option value="${k}"${k === c.key ? ' selected' : ''}>${TNAME(k)}</option>`).join('')}</select>
        <select data-f="lane">${lanes().map(l => `<option value="${l}"${l === c.lane ? ' selected' : ''}>Lane ${l + 1}</option>`).join('')}</select>
        <input type="number" data-f="kmh" min="0" max="300" step="5" value="${c.kmh}" title="Speed (km/h)"><span class="tag">KM/H</span>
        <input type="number" data-f="gap" step="1" title="Metres ahead of you (- behind) at this moment"><span class="tag">GAP</span>
        <input type="number" data-f="side" step="0.1" min="-1.6" max="1.6" title="Metres right (+) / left (-) of its lane's middle - or pick the car and drag the arrows"><span class="tag">SIDE</span>
        <button data-f="col" title="A random colour">🎨</button><button data-f="del" title="Remove this car">✕</button>
        <select data-f="lc" title="Change lane - it starts at this moment of the clip"><option value="">No lane change</option>${lanes().filter(l => l !== c.lane).map(l => `<option value="${l}"${c.lc && c.lc.to === l ? ' selected' : ''}>→ Lane ${l + 1}</option>`).join('')}</select>
        ${c.lc ? `<span class="tag">AT ${(c.lc.t - R.clip.inT).toFixed(1)} S</span>` : ''}
        <button data-f="br" title="Brake at this moment of the clip (again: no brake)">${c.br ? `Braking ${(c.br.t - R.clip.inT).toFixed(1)} s ✕` : 'Brake here'}</button>
        ${c.auto ? '<span class="tag">AUTO</span>' : ''}${hit !== null ? `<div class="warn">⚠ Hits you at ${(hit - R.clip.inT).toFixed(1)} s</div>` : ''}`;
      row.onclick = e => { if (e.target.closest('input, select, button')) return; sel = sel === c ? null : c; list(); };
      const f = n => row.querySelector(`[data-f="${n}"]`);
      row.addEventListener('change', e => { if (e.target.dataset.f !== 'pick') snap(); }, true);   // (any change to this car can be undone)
      row.addEventListener('click', e => { if (e.target.closest('button')) snap(); }, true);
      f('key').onchange = e => { c.key = e.target.value; c.auto = false; list(); };
      f('lane').onchange = e => { c.lane = +e.target.value; c.off = 0; if (c.lc && c.lc.to === c.lane) c.lc = null; c.auto = false; list(); };
      f('kmh').onchange = e => { const g = gapNow(c); c.kmh = U.clamp(+e.target.value || 0, 0, 300); setGap(c, g); c.auto = false; list(); };   // (stays where it is now, just faster / slower)
      f('gap').onchange = e => { setGap(c, +e.target.value || 0); c.auto = false; list(); };
      f('side').onchange = e => { c.off = U.clamp(+e.target.value || 0, -1.6, 1.6); c.auto = false; list(); };
      // its colour: the square opens a colour picker (the car changes as you pick; the list isn't rebuilt meanwhile, that
      // would close the picker), 🎨 a random one - never the one it has
      f('pick').oninput = e => { if (!e.target.dataset.snap) { e.target.dataset.snap = 1; snap(); } c.color = parseInt(e.target.value.slice(1), 16); c.auto = false; };
      f('pick').onchange = () => list();
      f('col').onclick = e => { e.stopPropagation(); e.target.blur(); let k; do k = pick(TCOLORS).c; while (k === c.color); c.color = k; c.auto = false; list(); };
      f('lc').onchange = e => { e.target.blur(); const g = gapNow(c); c.lc = e.target.value === '' ? null : { t: R.t, to: +e.target.value, dur: 2.6 }; setGap(c, g); c.auto = false; list(); };
      f('br').onclick = e => { e.stopPropagation(); e.target.blur(); const g = gapNow(c); c.br = c.br ? null : { t: R.t, dv: Math.round(c.kmh * 0.45) }; setGap(c, g); c.auto = false; list(); };
      f('del').onclick = e => { e.stopPropagation(); R.clip.studio.cars.splice(R.clip.studio.cars.indexOf(c), 1); if (sel === c) sel = null; list(); };
      el.appendChild(row);
    });
    gaps();
  }
  const gapNow = c => carS(c, R.t) - youAt(pathOf(R.clip), R.t).s;
  const setGap = (c, g) => { c.s0 = youAt(pathOf(R.clip), R.t).s + g - carRun(c, R.t); };
  function gaps() {                                      // (the gaps change as the clip plays)
    if (!panel) return;
    for (const row of panel.querySelectorAll('.car')) {
      const i = row.querySelector('[data-f="gap"]'), sd = row.querySelector('[data-f="side"]');
      if (document.activeElement !== i) i.value = Math.round(gapNow(row.car));
      if (document.activeElement !== sd) sd.value = (row.car.off || 0).toFixed(2);   // (follows the arrows while you drag)
    }
  }
  Recorder.hooks.frame = () => gaps();
  function addHere() {
    const P = pathOf(R.clip), y = youAt(P, R.t), mine = ROAD.nearestLane(y.d);
    const kmhYou = Math.max(30, Math.round(y.v * 3.6 * 0.7 / 5) * 5), others = R.clip.studio.cars, G = grid(P);
    // the lanes next to yours first, then the others (yours last); in each, 25 m ahead of you or the nearest free spot to
    // that - first among all the traffic; on a packed road, it goes where you asked and the autofilled cars that would
    // run into it make way (the cars you placed yourself always stay)
    const order = lanes().sort((a, b) => (a === mine) - (b === mine) || Math.abs(a - mine) - Math.abs(b - mine));
    for (const strict of [true, false]) for (const lane of order) {
      // (traffic already in that lane: it goes their speed, so it flows with them instead of running into them)
      const inLane = others.filter(o => o.lane === lane && !o.lc).map(o => o.kmh).sort((a, b) => a - b);
      const c = { key: TYPES[0], lane, off: 0, kmh: inLane.length ? inLane[inLane.length >> 1] : kmhYou, s0: 0, color: pick(TCOLORS).c, auto: false, lc: null, br: null };
      const keep = strict ? others : others.filter(o => !o.auto);
      for (let k = 0; k <= 80; k++) {
        setGap(c, 25 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.5);
        if (hitTime(c, P, 0.1) !== null || keep.some(o => clash(c, o, G))) continue;
        let gone = 0;
        if (!strict) for (let i = others.length - 1; i >= 0; i--) if (others[i].auto && clash(c, others[i], G)) { others.splice(i, 1); gone++; }
        if (gone) toast(`Packed road: ${gone} autofilled car${gone > 1 ? 's' : ''} made way for this one`);
        others.push(c); sel = c; list(); return;
      }
    }
    toast('No room for another car near you here - move or delete one of yours');
  }
  // fill the road evenly: the same number of cars per 100 m all the way along your run (by distance, not time - slow
  // at the start or flat out at the end, it looks the same), and on past where the run ends, so the last shot still has
  // traffic ahead. Each car is kept only if it misses you (and the others) for the whole run; with close calls it's
  // right next to you as you go by that spot
  // the middle of each moment you're facing backwards (past ~150 deg to the road) - your 360s
  function spinMoments(P, i0, i1) {
    const out = []; let a = -1;
    for (let i = i0; i <= i1; i++) {
      const back = Math.abs(U.wrap(P.A[i])) > 2.6;
      if (back && a < 0) a = i;
      if ((!back || i === i1) && a >= 0) { out.push(P.T[(a + i) >> 1]); a = -1; }
    }
    return out;
  }
  let lastFill = null;                                // (why cars were turned down last time: for testing)
  const AHEAD = 350, MAX_CARS = 450;                    // (metres of road filled past the end of the run; most cars in one clip)
  function autofill() {
    const clip = R.clip, P = pathOf(clip), C = clip.studio;
    const cars = C.cars.filter(c => !c.auto), track = ROAD.loop && !!DriftTrack.active;
    const all0 = P.T[0], all1 = P.T[P.n - 1];
    const i0 = idxAt(P, clip.inT), i1 = idxAt(P, clip.outT);
    // where you've got to by each moment (the furthest so far: a spin doesn't count twice)
    const reach = new Float64Array(P.n); for (let i = 0, m = -Infinity; i < P.n; i++) reach[i] = m = Math.max(m, P.S[i]);
    const sA = reach[i0], sB = reach[i1], sEnd = sB + AHEAD, yEnd = youAt(P, clip.outT);
    const BIN = 25, want = Math.min(MAX_CARS, Math.round(density * (sEnd - sA) / 100)), tight = close !== 'loose';
    // lane flow: from your average speed over the run (left lanes quicker, like the highway)
    const avg = Math.max(30, (sB - sA) / Math.max(clip.outT - clip.inT, 1) * 3.6), flow = [0.62, 0.54, 0.46, 0.38].map(k => avg * k);
    let added = 0, owe = 0; const why = { slot: 0, clash: 0, spin: 0 }, G = grid(P);
    // your 360s: when you're facing backwards, a car right beside you in the lane on your left and on your right, going
    // your speed through the spin so they stay with you all the way round - placed first, the rest fill in around them
    if (tight) for (const ts of spinMoments(P, i0, i1)) for (const side of [-1, 1]) {
      const y = youAt(P, ts), lane = ROAD.nearestLane(y.d) + side;
      if (lane < 0 || lane > 3) continue;
      const v = Math.max(3, (youAt(P, ts + 1.5).s - youAt(P, ts - 1.5).s) / 3);   // (your speed along the road through the spin)
      let done = false;
      for (let tries = 0; tries < 6 && !done; tries++) {
        const type = pick(TTYPES.filter(t => !t.truck));
        const c = { key: type.key, lane, off: 0, kmh: Math.round(v * 3.6 * (0.97 + Math.random() * 0.06)), s0: 0, color: pick(TCOLORS).c, auto: true, lc: null, br: null, spin: true };
        // as close to you as it can be: in its lane, nudged at most 0.8 m toward the far side of it, a metre or two
        // ahead / behind if it must
        for (let k = -0.15; k <= 0.8 && !done; k += 0.1) {
          c.off = side * k;
          for (const ds of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3]) {
            c.s0 = y.s + ds - carRun(c, ts);
            if (hitTime(c, P, 0.1) !== null || cars.some(o => clash(c, o, G))) continue;
            cars.push(c); added++; done = true; break;
          }
        }
      }
      if (!done) why.spin++;
    }
    for (let b = sA; b < sEnd && added < want; b += BIN) {
      owe += density * BIN / 100;
      for (let n = Math.floor(owe); n > 0; n--, owe--) {
        for (let tries = 0; tries < 12; tries++) {
          const u = b + Math.random() * BIN;
          let tc, y, i = i0;
          if (u <= sB) { while (i < i1 && reach[i] < u) i++; tc = P.T[i]; y = youAt(P, tc); }   // (the moment you pass this spot)
          else { i = i1; tc = clip.outT; y = yEnd; }                                             // (past the end: already ahead of you)
          // the lane: alongside you mostly (the lanes either side of you, your own), the rest anywhere
          const mine = ROAD.nearestLane(y.d), r = Math.random();
          const lane = !tight || u > sB || r > 0.85 ? Math.floor(Math.random() * 4) : U.clamp(mine + (r < 0.3 ? 0 : r < 0.575 ? -1 : 1), 0, 3);
          const type = pick(TTYPES.filter(t => !t.truck || (!track && lane >= 2)));
          // each lane flows at its own speed (slower than you - you weave through them), a little either way per car:
          // cars in one lane don't run up the back of each other, so the road can be packed
          const kmh = Math.round(U.clamp(flow[lane] * (0.985 + Math.random() * 0.03), 20, 140));
          const c = { key: type.key, lane, off: (Math.random() - 0.5) * 0.3, kmh, s0: 0, color: pick(type.truck ? TRUCK_COLORS : TCOLORS).c, auto: true, lc: null, br: null };   // (in its lane: a few cm either way, like real drivers)
          // some change lane, some brake - away from the moment they pass you, so the pass stays as placed
          if (Math.random() * 100 < lcP) {
            const to = U.clamp(c.lane + (Math.random() < 0.5 ? -1 : 1), 0, 3), tl = tc + (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 4);
            if (to !== c.lane) c.lc = { t: tl, to, dur: 2.4 + Math.random() * 1.2 };
          }
          if (Math.random() * 100 < brP) c.br = { t: tc + (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 4), dv: Math.round(kmh * (0.25 + Math.random() * 0.3)) };
          if (c.br && c.br.t < 0) c.br = null;
          // where along its lane: as close to right beside you as it can be while it still misses you by the gap asked -
          // tried from alongside outwards, half a metre at a time (so a drift across the lanes still gets cars either side,
          // just timed to slip past you, not taken out)
          const g = close === 'scrape' ? 0.15 + Math.random() * 0.3 : close === 'close' ? 0.5 + Math.random() * 0.7 : 0.4;
          const base = tight && u <= sB ? y.s : u;
          // (and not on top of another car: if that spot's taken, it slides on to the next free one)
          let ok = false, blocked = false;
          const sg = Math.random() < 0.5 ? 1 : -1;
          for (let k = 0; k <= (tight ? 60 : 0); k++) {
            const dd = sg * (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
            c.s0 = base + dd - carRun(c, tc);
            if (hitTime(c, P, g) !== null) continue;
            if (cars.some(o => clash(c, o, G))) { blocked = true; continue; }
            ok = true; break;
          }
          if (!ok) { why[blocked ? 'clash' : 'slot']++; continue; }
          cars.push(c); added++; break;
        }
      }
    }
    C.cars = cars; sel = null; list(); lastFill = why;
    toast(added < want ? `Placed ${added} of ${want} cars (no room for more that miss you)` : `Placed ${added} cars · ${Math.round(sEnd - sA)} m of road`);
  }

  window.Studio = { open: openScreen, finish: finishRun, restart: restartRun, get recording() { return run.on; }, get lastFill() { return lastFill; } };
})();
