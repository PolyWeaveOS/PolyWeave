'use strict';
// =====================================================================
//  Multiplayer client (talks to the dedicated server in server.js over a WebSocket)
//  - Public servers (always on, shown in the server list) and private servers with room codes.
//  - Positions are sent in road coordinates (s = distance along the road, d = lateral), so each
//    player's floating world origin doesn't matter. ~15 updates/s, smoothed by interpolation.
//  - Each player keeps their own traffic; friends' cars are fed into it as obstacles, so your traffic
//    brakes for / avoids them. Player cars can bump each other.
// =====================================================================
// Where the server lives when the game is NOT opened from it (e.g. played locally with the .bat):
// the online address, e.g. 'https://polyweave.onrender.com'. Opened from the server itself,
// the game always uses that same server.
const NET_ONLINE = '';
const NET_RATE = 1 / 15;                    // state updates per second
const NET_DELAY = 0.12;                     // friends are drawn 120 ms in the past (smooth interpolation)

const Net = {
  ws: null, base: null, myId: '', room: null,   // room: { id, name, pub, code }
  players: new Map(),                           // id -> { name, color, buf: [], g, vis, now, x, z, yaw }
  scene: null, onStatus: null, onJoined: null, onRoster: null, onList: null, sendT: 0,
  me: { name: 'Driver', color: '#a6b0b8' }, _a: [], _b: [], pending: null,

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
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.room) { this.clearRoom(); this.status('Disconnected from the server. Join again to keep playing together.', 'err'); }
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
    this.status(label);
    const slow = setTimeout(() => this.status(label + ' (waking up the server, can take up to a minute)'), 3000);
    try { await this.connect(); this.send(m); }
    catch (e) { this.status(e.message, 'err'); }
    finally { clearTimeout(slow); }
  },

  // public server from the list / private server by code / new private server
  joinServer(id, name, color) { return this.request({ t: 'join', room: id, name, color }, 'Joining…'); },
  joinCode(code, name, color) {
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 6) { this.status('Enter the 6-character code, e.g. K7P-2QX', 'err'); return; }
    return this.request({ t: 'join', code: c, name, color }, 'Joining ' + c.slice(0, 3) + '-' + c.slice(3) + '…');
  },
  host(name, color) { return this.request({ t: 'create', name, color }, 'Creating your private server…'); },
  leave() {
    if (!this.room) return;
    this.send({ t: 'leave' });
    this.clearRoom();
    this.status('Left the server.');
    this.refreshList();
  },
  clearRoom() {
    for (const p of this.players.values()) this.removeVis(p);
    this.players.clear();
    this.room = null;
    this.changed();
  },

  onData(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') this.myId = m.id;
    else if (m.t === 'joined') {
      this.clearRoom();
      this.myId = m.id;
      this.room = { id: m.room, name: m.name, pub: !!m.pub, code: m.code || '' };
      this.status(m.pub ? `Connected to ${m.name}` : `Connected to ${m.name} · code ${m.code}`, 'ok');
      this.changed();
      if (this.onJoined) this.onJoined(m.at, this.room);
    } else if (m.t === 'error') this.status(m.msg, 'err');
    else if (m.t === 'roster') {
      const keep = new Set();
      for (const r of m.list) { if (r.id === this.myId) continue; keep.add(r.id); this.player(r.id, r.name, r.color); }
      for (const [id, p] of this.players) if (!keep.has(id)) { this.removeVis(p); this.players.delete(id); }
      this.changed();
    } else if (m.t === 'states') {
      for (const e of m.list) { if (e.id === this.myId) continue; const p = this.players.get(e.id); if (p) this.pushState(p, e.st); }
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
  pushState(p, st) {
    if (!st || !Number.isFinite(st.s) || !Number.isFinite(st.d)) return;
    p.buf.push(Object.assign({ t: performance.now() / 1000 }, st));
    if (p.buf.length > 12) p.buf.shift();
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

  // friend's state right now (drawn NET_DELAY in the past, interpolated between updates)
  sample(p) {
    const b = p.buf; if (!b.length) return null;
    const t = performance.now() / 1000 - NET_DELAY;
    if (t - b[b.length - 1].t > 3) return null;      // no news for 3 s (tab hidden / lagging): hide them
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > t) i--;
    if (i === 0) return b[0];
    const a = b[i - 1], c = b[i];
    const k = U.clamp((t - a.t) / Math.max(c.t - a.t, 1e-3), 0, 2);   // (k > 1: briefly extrapolate a late update)
    const L = (x, y) => x + (y - x) * k;
    return Object.assign({}, c, { s: L(a.s, c.s), d: L(a.d, c.d), ry: L(a.ry, c.ry), v: L(a.v, c.v), steer: L(a.steer, c.steer) });
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
      const s = p.now = this.sample(p);
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
      impact = Math.max(impact, resolveImpulse(pb, other, col, 0.15, 0.35));
      player.fromBody(pb);
    }
    return impact;
  },

  // rows for the player lists
  roster(myScore, myKmh) {
    const rows = [{ name: this.me.name, you: true, kmh: myKmh, score: myScore, color: this.me.color }];
    for (const p of this.players.values()) rows.push({ name: p.name, kmh: p.now ? p.now.kmh || 0 : 0, score: p.now ? p.now.score || 0 : 0, color: p.color, wait: !p.now });
    return rows;
  },
};
