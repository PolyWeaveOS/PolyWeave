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
      };
      this.ws = ws;
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
    return this.request({ t: 'create', name, color, ext: this.ext, scored: !!opts.scored, density: opts.density }, 'Creating your private server…');
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
      this.myId = m.id;
      this.room = { id: m.room, name: m.name, pub: !!m.pub, code: m.code || '', scored: !!m.scored, density: Number.isFinite(m.density) ? m.density : 0.6 };
      this.myBest = m.best || 0;
      this.status(m.pub ? `Connected to ${m.name}` : `Connected to ${m.name} · code ${m.code}`, 'ok');
      this.changed();
      if (this.onJoined) this.onJoined(this.room, m.slot || 0);
    } else if (m.t === 'error') this.status(m.msg, 'err');
    else if (m.t === 'rank') { if (this.onRank) this.onRank(m.rank); }
    else if (m.t === 'roster') {
      const keep = new Set();
      for (const r of m.list) { if (r.id === this.myId) continue; keep.add(r.id); this.player(r.id, r.name, r.color); }
      for (const [id, p] of this.players) if (!keep.has(id)) { this.removeVis(p); this.players.delete(id); }
      this.changed();
    }
  },

  // ---------------------------------------------------------------- friends' cars
  player(id, name, color) {
    name = String(name || 'Driver').slice(0, 16);
    if (!/^#[0-9a-f]{6}$/i.test(color)) color = '#a6b0b8';   // only plain colours from other players
    let p = this.players.get(id);
    if (!p) { p = { id, name, color, buf: [] }; this.players.set(id, p); }
    if (p.name !== name || p.color !== color || !p.g) { p.name = name; p.color = color; this.removeVis(p); this.makeVis(p); }
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
    // floating name tag
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = '800 30px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = Math.min(250, g.measureText(p.name).width + 34);
    g.fillStyle = 'rgba(14,18,26,0.6)'; g.fillRect(128 - w / 2, 10, w, 44);
    g.fillStyle = p.color || '#fff'; g.fillRect(128 - w / 2, 10, 6, 44);
    g.fillStyle = '#fff'; g.fillText(p.name, 131, 33);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false }));
    tag.scale.set(2.4, 0.6, 1); tag.position.y = 2.05;
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
    if (i === 0) return b[0];
    const a = b[i - 1], c = b[i];
    const k = U.clamp((t - a.t) / Math.max(c.t - a.t, 1e-3), 0, 2);   // (k > 1: briefly extrapolate a late update)
    const L = (x, y) => x + (y - x) * k;
    const st = Object.assign({}, c, { s: L(a.s, c.s), d: L(a.d, c.d), ry: a.ry + U.wrap(c.ry - a.ry) * k, v: L(a.v, c.v), steer: L(a.steer, c.steer) });
    // That is where they were a moment ago (network delay + the smoothing buffer): ~8 m behind at 200 km/h.
    // Carry them forward by that time, so a friend touching your bumper is drawn touching it (and the
    // proxy gap and bumps use where they really are).
    const lag = U.clamp(p.delay + ((this.rtt || 60) + (c.rtt || this.rtt || 60)) / 2000, 0, 0.45);
    const dd = U.clamp((c.d - a.d) / Math.max(c.t - a.t, 1e-3), -6, 6);   // sideways speed (m/s)
    st.s += (st.v || 0) * lag;
    st.d += dd * lag * 0.8;
    return st;
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
    for (const p of this.players.values()) rows.push({ name: p.name, score: p.last ? p.last.score || 0 : 0, best: p.last ? p.last.best || 0 : 0, color: p.color, wait: !p.last });
    return rows;
  },
};
