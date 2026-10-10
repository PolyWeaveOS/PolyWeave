'use strict';
// =====================================================================
//  Multiplayer client (talks to the dedicated server in server.js over a WebSocket)
//  - Public servers (always on, shown in the server list) and private servers with room codes.
//  - Servers drive on the loop circuit with ONE shared traffic (simulated by the server).
//  - Positions are sent in road coordinates (s = distance along the road, d = lateral), so each
//    player's floating world origin doesn't matter. 20 updates/s, each stamped with the sender's
//    clock: friends are drawn a little in the past on THEIR timeline, so uneven internet delivery
//    doesn't make them stutter. Player cars can bump each other.
// =====================================================================
// Where the server lives when the game is NOT opened from it (e.g. played locally with the .bat):
// the online address, e.g. 'https://polyweave.onrender.com'. Opened from the server itself,
// the game always uses that same server.
const NET_ONLINE = '';
const NET_RATE = 1 / 20;                    // state updates per second

const Net = {
  ws: null, base: null, myId: '', room: null,   // room: { id, name, pub, code }
  players: new Map(),                           // id -> { name, color, buf: [], g, vis, now, x, z, yaw }
  scene: null, onStatus: null, onJoined: null, onLeft: null, onRoster: null, onList: null, onTraffic: null, sendT: 0,
  me: { name: 'Driver', color: '#a6b0b8' }, _a: [], _b: [], pending: null, myBest: 0,
  ext: null, refS: () => 0,                     // set by main.js: my car's size, my road position

  init(scene) { this.scene = scene; },
  active() { return !!this.room; },
  get code() { return this.room ? this.room.code : ''; },
  status(msg, kind = '') { this.statusMsg = msg; if (this.onStatus) this.onStatus(msg, kind); },
  changed() { if (this.onRoster) this.onRoster(); },

  // ---------------------------------------------------------------- finding the server
  async findBase() {
    if (this.base) return this.base;
    const tries = [];
    if (/^https?:$/.test(location.protocol)) tries.push(location.origin);
    if (NET_ONLINE) tries.push(NET_ONLINE.replace(/\/+$/, ''));
    for (const b of tries) {
      try {
        const r = await fetch(b + '/api/servers', { cache: 'no-store' });
        if (r.ok) { this.base = b; return b; }
      } catch (e) { /* try the next one */ }
    }
    return null;
  },
  async refreshList() {
    const slow = setTimeout(() => this.status('Waking up the server… (the first visit can take up to a minute)'), 2500);
    try {
      const base = await this.findBase();
      if (!base) { this.status('Multiplayer server not found. Open the game from its website link to play online.', 'err'); return null; }
      const r = await fetch(base + '/api/servers', { cache: 'no-store' });
      const j = await r.json();
      if (this.statusMsg && this.statusMsg.startsWith('Waking')) this.status(this.room ? '' : 'Pick a server, host a private one, or join with a code.');
      if (this.onList) this.onList(j);
      return j;
    } catch (e) {
      this.status('Could not reach the multiplayer server. Check your internet connection.', 'err');
      return null;
    } finally { clearTimeout(slow); }
  },

  // ---------------------------------------------------------------- connection
  connect() {
    if (this.ws && this.ws.readyState === 1) return Promise.resolve(this.ws);
    if (this._conn) return this._conn;
    this._conn = (async () => {
      const base = await this.findBase();
      if (!base) throw new Error('Multiplayer server not found. Open the game from its website link to play online.');
      const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
      await new Promise((ok, bad) => {
        const t = setTimeout(() => bad(new Error('The multiplayer server did not answer. Try again in a moment.')), 60000);
        ws.onopen = () => { clearTimeout(t); ok(); };
        ws.onerror = () => { clearTimeout(t); bad(new Error('Could not connect to the multiplayer server.')); };
      });
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } this.onData(m); };
      // round trip to the server every 2 s (friends' cars are drawn ahead by the delay it implies)
      clearInterval(this._pingT);
      this._pingT = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
      this.send({ t: 'ping', c: performance.now() });
      ws.onclose = () => {
        clearInterval(this._pingT);
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.room) { this.left(); this.status('Disconnected from the server. Join again to keep playing together.', 'err'); }
        if (this.onClosed) this.onClosed();             // (signed in: social.js reconnects for friends / messages)
      };
      this.ws = ws;
      // signed in: online for friends (messages, requests and activity arrive over this connection)
      if (typeof Account !== 'undefined' && Account.session) this.send({ t: 'auth', session: Account.session });
      if (this.onOpened) this.onOpened();
      return ws;
    })();
    this._conn.finally(() => (this._conn = null)).catch(() => {});
    return this._conn;
  },
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
  async request(m, label) {
    this.me = { name: m.name, color: m.color };
    if (typeof Account !== 'undefined' && Account.session) m.session = Account.session;   // signed in: runs count for the leaderboard
    this.status(label);
    const slow = setTimeout(() => this.status(label + ' (waking up the server, can take up to a minute)'), 3000);
    try { await this.connect(); this.send(m); }
    catch (e) { this.status(e.message, 'err'); }
    finally { clearTimeout(slow); }
  },

  // public server from the list / private server by code / new private server
  joinServer(id, name, color) { return this.request({ t: 'join', room: id, name, color, ext: this.ext }, 'Joining…'); },
  joinCode(code, name, color) {
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 6) { this.status('Enter the 6-character code, e.g. K7P-2QX', 'err'); return; }
    return this.request({ t: 'join', code: c, name, color, ext: this.ext }, 'Joining ' + c.slice(0, 3) + '-' + c.slice(3) + '…');
  },
  // opts.scored: leaderboard server (60% traffic); otherwise free drive with opts.density traffic
  host(name, color, opts = {}) {
    return this.request({ t: 'create', name, color, ext: this.ext, scored: !!opts.scored, density: opts.density,
      listed: !!opts.listed, roomName: opts.roomName, theme: opts.theme, tod: opts.tod }, opts.listed ? 'Creating your public server…' : 'Creating your private server…');
  },
  leave() {
    if (!this.room) return;
    this.send({ t: 'leave' });
    this.left();
    this.status('Left the server.');
    this.refreshList();
  },
  left() { const was = !!this.room; this.clearRoom(); if (was && this.onLeft) this.onLeft(); },
  clearRoom() {
    for (const p of this.players.values()) this.removeVis(p);
    this.players.clear();
    this.room = null;
    this.changed();
  },
  // a traffic car I crashed into: tell the server where it ends up (everyone sees the wreck there)
  reportCrash(c) { this.send({ t: 'crash', id: c.id, s: +c.s.toFixed(2), d: +c.d.toFixed(2), ry: +U.wrap(c.yaw - ROAD.yaw(c.s)).toFixed(3) }); },
  // that car got going again (back in lane `lane` at speed v) / couldn't and disappeared
  reportRecover(c) { this.send({ t: 'recover', id: c.id, s: +c.s.toFixed(2), lane: c.lane, v: +c.v.toFixed(2) }); },
  reportGone(c) { this.send({ t: 'gone', id: c.id }); },
  // I hit a friend hard: tell them so their streak ends too (they may not have seen it on their side)
  reportBump(v) { if (this.lastBumpId) this.send({ t: 'bump', id: this.lastBumpId, v: +v.toFixed(1) }); },

  onData(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'st') { const p = this.players.get(m.id); if (p) this.pushState(p, m.st); }
    else if (m.t === 'traffic') { if (this.room && this.onTraffic) this.onTraffic(m); }
    else if (m.t === 'pong') { const r = performance.now() - m.c; if (r >= 0 && r < 3000) this.rtt = this.rtt === undefined ? r : this.rtt * 0.8 + r * 0.2; }
    else if (m.t === 'bumped') { if (this.room && this.onBumped) this.onBumped(m.v || 0); }   // a friend hit me hard (they saw it)
    else if (m.t === 'hello') this.myId = m.id;
    else if (m.t === 'joined') {
      this.clearRoom();
      this.myId = m.id; this.runToken = null;      // (the server sends this server's token next)
      // official: one of the game's own servers; listed: a player's public server (also joinable by code)
      this.room = { id: m.room, name: m.name, pub: !!(m.official ?? m.pub), official: !!(m.official ?? m.pub), listed: !!m.listed, code: m.code || '',
        scored: !!m.scored, density: Number.isFinite(m.density) ? m.density : 0.6, theme: m.theme || 'grass', tod: m.tod || 'day' };
      this.myBest = m.best || 0;
      this.status(this.room.official ? `Connected to ${m.name}` : `Connected to ${m.name} · code ${m.code}`, 'ok');
      this.changed();
      if (this.onJoined) this.onJoined(this.room, m.slot || 0);
    } else if (m.t === 'error') this.status(m.msg, 'err');
    else if (m.t === 'runtoken') this.runToken = typeof m.token === 'string' ? m.token : null;   // (lets my next scored run count)
    else if (m.t === 'presence' || m.t === 'msg' || m.t === 'social' || m.t === 'inbox') { if (this.onSocial) this.onSocial(m); }   // (friends: social.js)
    else if (m.t === 'roster') {
      const keep = new Set();
      for (const r of m.list) { if (r.id === this.myId) continue; keep.add(r.id); this.player(r.id, r.name, r.color, r.title).acct = !!r.acct; }
      for (const [id, p] of this.players) if (!keep.has(id)) { this.removeVis(p); this.players.delete(id); }
      this.changed();
    }
  },

  // ---------------------------------------------------------------- friends' cars
  player(id, name, color, title) {
    name = String(name || 'Driver').slice(0, 16);
    if (!/^#[0-9a-f]{6}$/i.test(color)) color = '#a6b0b8';   // only plain colours from other players
    title = Titles.TITLE_BY_ID[title] ? title : null;
    let p = this.players.get(id);
    if (!p) { p = { id, name, color, buf: [] }; this.players.set(id, p); }
    if (p.name !== name || p.color !== color || p.title !== title || !p.g) { p.name = name; p.color = color; p.title = title; this.removeVis(p); this.makeVis(p); }
    return p;
  },
  // Each update carries the sender's clock (t). The gap between their clock and ours is the network
  // delay plus a fixed clock difference: the smallest gap seen is the fastest delivery, and anything
  // above it is jitter. Friends are drawn just far enough in the past to cover that jitter.
  pushState(p, st) {
    if (!st || !Number.isFinite(st.s) || !Number.isFinite(st.d) || !Number.isFinite(st.t)) return;
    const now = performance.now() / 1000, off = now - st.t;
    if (p.off === undefined || off < p.off) p.off = off; else p.off += 0.0004;      // (drifts up slowly to follow clock drift)
    p.jit = (p.jit ?? 0.02) * 0.96 + Math.min(0.5, off - p.off) * 0.04;
    p.lastRecv = now;
    const e = Object.assign({}, st);
    e.s = ROAD.near(st.s, this.refS());               // loop: same lap numbering as my own position
    if (st.w) e.w = st.w.map(([id, s, d, ry, vs, vd, vr]) => [id, ROAD.near(s, e.s), d, ry, vs, vd, vr]);   // (their wrecks too)
    if (p.buf.length && e.t <= p.buf[p.buf.length - 1].t) return;   // out of order / duplicate
    p.buf.push(e);
    if (p.buf.length > 20) p.buf.shift();
    p.last = st;
  },
  makeVis(p) {
    if (!this.scene) return;
    p.g = new THREE.Group();
    p.vis = makeVehicle('m4', paintMat(p.color || '#a6b0b8'));
    p.vis.root.position.z = CG_F;                 // body sits behind the centre of gravity, like yours
    p.g.add(p.vis.root);
    // floating name tag (with their title underneath, in its rarity colour; neon ones glow)
    const t = p.title && Titles.TITLE_BY_ID[p.title], rar = t && Titles.RARITIES[t.rarity];
    const c = document.createElement('canvas'); c.width = 256; c.height = t ? 96 : 64;
    const g = c.getContext('2d');
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 30px Segoe UI, Arial';
    let w = g.measureText(p.name).width;
    if (t) { g.font = '800 19px Segoe UI, Arial'; w = Math.max(w, g.measureText(t.name.toUpperCase()).width); }
    w = Math.min(250, w + 34);
    const h = t ? 74 : 44;
    g.fillStyle = 'rgba(14,18,26,0.6)'; g.fillRect(128 - w / 2, 10, w, h);
    g.fillStyle = p.color || '#fff'; g.fillRect(128 - w / 2, 10, 6, h);
    g.font = '800 30px Segoe UI, Arial'; g.fillStyle = '#fff'; g.fillText(p.name, 131, 33);
    if (t) {
      g.font = '800 19px Segoe UI, Arial'; g.fillStyle = rar.color;
      const tw = g.measureText(t.name.toUpperCase()).width, grad = stops => {
        const gr = g.createLinearGradient(131 - tw / 2, 0, 131 + tw / 2, 0); stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c)); return gr;
      };
      if (t.rarity === 'epic') g.fillStyle = grad(['#c08cff', '#ff8cd2']);   // (the purple-pink mix, like in the menus)
      if (rar.neon) {                               // glowing: a soft halo, then a crisp bright core on top (readable)
        const exotic = t.rarity === 'exotic';         // (deep crimson: a brighter, wider halo so it glows like the rest)
        g.save(); g.shadowColor = exotic ? '#ff2350' : rar.color; g.shadowBlur = exotic ? 16 : 12; g.globalAlpha = rar.pearl ? 0.6 : exotic ? 0.9 : 0.75; g.fillText(t.name.toUpperCase(), 131, 64); g.restore();
        const c = new THREE.Color(rar.color).lerp(new THREE.Color('#ffffff'), t.rarity === 'exotic' ? 0.12 : 0.28); g.fillStyle = '#' + c.getHexString();   // (crimson stays deep)
        if (rar.pearl) g.fillStyle = grad(['#fbfaf6', '#f8cde1', '#c6e6fb', '#fbfaf6', '#d9cbfb', '#c9f2d8', '#fad9bd']);   // (pearl: soft colours)
      }
      g.fillText(t.name.toUpperCase(), 131, 64);
    }
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false }));
    tag.scale.set(2.4, t ? 0.9 : 0.6, 1); tag.position.y = t ? 2.2 : 2.05;
    p.g.add(tag);
    p.g.visible = false;
    this.scene.add(p.g);
  },
  removeVis(p) { if (p.g) { this.scene.remove(p.g); p.g = null; p.vis = null; } },

  // friend's state right now: a little in the past on THEIR clock, interpolated between updates
  sample(p, dt) {
    const b = p.buf; if (!b.length) return null;
    const now = performance.now() / 1000;
    if (now - p.lastRecv > 3) return null;           // no news for 3 s (tab hidden / lagging): hide them
    const want = U.clamp(0.065 + 2.5 * (p.jit || 0), 0.08, 0.3);   // one update interval + room for jitter
    p.delay = p.delay === undefined ? want : U.damp(p.delay, want, 0.5, dt);
    const t = now - p.off - p.delay;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > t) i--;
    if (i === 0) return Object.assign({}, b[0], { w: null });
    const a = b[i - 1], c = b[i];
    const k = U.clamp((t - a.t) / Math.max(c.t - a.t, 1e-3), 0, 2);   // (k > 1: briefly extrapolate a late update)
    const L = (x, y) => x + (y - x) * k;
    const st = Object.assign({}, c, { s: L(a.s, c.s), d: L(a.d, c.d), ry: a.ry + U.wrap(c.ry - a.ry) * k, v: L(a.v, c.v), steer: L(a.steer, c.steer) });
    // That is where they were a moment ago (network delay + the smoothing buffer): ~8 m behind at 200 km/h.
    // Carry them forward by that time, so a friend touching your bumper is drawn touching it (and the
    // proxy gap and bumps use where they really are).
    const lag = U.clamp(p.delay + ((this.rtt || 60) + (c.rtt || this.rtt || 60)) / 2000, 0, 0.45);
    const span = Math.max(c.t - a.t, 1e-3), dd = U.clamp((c.d - a.d) / span, -6, 6);   // sideways speed (m/s)
    // carry forward with their braking / accelerating too (a crash stops a car fast: without this it would
    // overshoot into the car it just hit, then snap back)
    const v = st.v || 0, acc = U.clamp(((c.v || 0) - (a.v || 0)) / span, -25, 10);
    st.s += acc < 0 && v + acc * lag < 0 ? v * v / (-2 * acc) : v * lag + 0.5 * acc * lag * lag;
    st.d += dd * lag * 0.8;
    // wrecks they're simulating: same clock and same carry-forward as their car, so car and wreck line up
    if (c.w && c.w.length) {
      const prev = new Map((a.w || []).map(e => [e[0], e]));
      // (their game sends each wreck's own speed and spin, so it's carried forward exactly, even on the first update)
      st.w = c.w.map(e => {
        const o = prev.get(e[0]), vs = U.clamp(e[4] || 0, -60, 90), vd = U.clamp(e[5] || 0, -15, 15), vr = U.clamp(e[6] || 0, -8, 8);
        let s, d, ry, extra;
        if (o && k <= 1) { s = o[1] + (e[1] - o[1]) * k; d = o[2] + (e[2] - o[2]) * k; ry = o[3] + U.wrap(e[3] - o[3]) * k; extra = 0; }
        else { s = e[1]; d = e[2]; ry = e[3]; extra = (k - 1) * span; }   // (new wreck / late update: from the newest pose, by its speed)
        const L = lag + extra;
        return { id: e[0], s: s + vs * L, d: d + vd * L, ry: ry + vr * L };
      });
    } else st.w = null;
    return st;
  },
  // every wreck a friend is simulating, by traffic-car id (drawn from them instead of the server's copy)
  wreckPoses() {
    const m = this._wp || (this._wp = new Map()); m.clear();
    if (!this.room) return m;
    for (const p of this.players.values()) if (p.now && p.now.w) for (const w of p.now.w) m.set(w.id, w);
    return m;
  },

  // ---------------------------------------------------------------- per frame (called by main.js)
  tick(dt, st) {
    if (!this.room) return;
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT += NET_RATE; if (this.sendT < 0) this.sendT = NET_RATE;
      this.send({ t: 'state', st });
    }
    // move friends' cars
    for (const p of this.players.values()) {
      const s = p.now = this.sample(p, dt);
      if (!p.g) continue;
      if (!s) { p.g.visible = false; continue; }
      const pos = ROAD.pos(s.s, s.d), yaw = ROAD.yaw(s.s) + (s.ry || 0);
      p.x = pos.x; p.z = pos.z; p.yaw = yaw;
      p.g.visible = true;
      p.g.position.set(pos.x, 0, pos.z);
      p.g.rotation.y = -yaw;
      p.vis.brake.visible = !!s.brake;
      animateWheels(p.vis, (s.v || 0) * dt, s.steer || 0);
    }
  },

  // friends as obstacles for my traffic (same shape as the player proxy)
  agents(ext) {
    const out = [];
    if (!this.room) return out;
    for (const p of this.players.values()) if (p.now) out.push({ s: p.now.s, d: p.now.d, v: p.now.v || 0, front: ext.front, rear: ext.rear, hw: ext.hw, isPlayer: true, isRemote: true });
    return out;
  },

  // bumping friends: their car is a solid body of the same mass; each player resolves their own side
  // returns the hardest impact speed this frame
  collide(player, hull) {
    if (!this.room) return 0;
    let impact = 0;
    this.lastBumpId = null;
    for (const p of this.players.values()) {
      if (!p.now || p.x === undefined) continue;
      const dx = p.x - player.x, dz = p.z - player.z;
      if (dx * dx + dz * dz > 64) continue;
      const pb = player.toBody();
      const A = SAT.toWorld(hull, pb.x, pb.z, player.visYaw, this._a), B = SAT.toWorld(hull, p.x, p.z, p.yaw, this._b);
      const col = SAT.test(A, B);
      if (!col) continue;
      const v = p.now.v || 0;
      const other = { x: p.x, z: p.z, vx: v * Math.sin(p.yaw), vz: -v * Math.cos(p.yaw), w: 0, im: 1 / M4.mass, ii: 1 / M4.Iz };
      const hit = resolveImpulse(pb, other, col, 0.15, 0.35);
      if (hit > impact) { impact = hit; this.lastBumpId = p.id; }
      player.fromBody(pb);
    }
    return impact;
  },

  // rows for the player lists: current score + best score on this server
  roster(myScore) {
    this.myBest = Math.max(this.myBest || 0, Math.round(myScore));
    const rows = [{ name: this.me.name, you: true, score: myScore, best: this.myBest, color: this.me.color }];
    for (const p of this.players.values()) rows.push({ name: p.name, score: p.last ? p.last.score || 0 : 0, best: p.last ? p.last.best || 0 : 0, color: p.color, wait: !p.last, acct: !!p.acct });
    return rows;
  },
};
