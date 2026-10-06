'use strict';
// =====================================================================
//  PolyWeave dedicated server
//  - Serves the game itself (index.html, js/, assets/...) so everyone plays from one link.
//  - Multiplayer over WebSocket (/ws): always-on public servers plus private rooms with codes.
//  - Every room drives on the loop circuit and has ONE shared traffic simulation (trafficserver.js),
//    so all players see the same cars. Each player gets the cars around them ~10 times a second.
//  - Player positions are forwarded to the rest of the room the moment they arrive.
//  Run locally:  npm install  then  node server.js   (PORT env var picks the port, default 8790)
// =====================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { RingTraffic, nowS } = require('./trafficserver');
const LB = require('./leaderboard');

const PORT = +process.env.PORT || 8790;
const ROOT = __dirname;
const MAX_PLAYERS = 12;
const PUBLIC_ROOMS = [['highway-1', 'Highway 1'], ['highway-2', 'Highway 2'], ['highway-3', 'Highway 3']];
const SIM_DT = 0.1;                 // shared traffic: 10 steps (and snapshots) per second
const SCORED_DENSITY = 0.65;        // traffic on scored (leaderboard) servers, same as scored singleplayer
const MIN_RUN = 100;                // smallest drive that goes on a leaderboard

// ---------------------------------------------------------------- static files
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream',
};
const PUBLIC_DIRS = ['js', 'assets'];
const PUBLIC_FILES = ['index.html', 'style.css', 'manifest.webmanifest', 'sw.js'];

function serveStatic(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''); } catch (e) { res.writeHead(400); res.end(); return; }
  if (rel === '') rel = 'index.html';
  const norm = path.posix.normalize(rel);
  const top = norm.split('/')[0];
  const allowed = !norm.startsWith('..') && (PUBLIC_FILES.includes(norm) || (PUBLIC_DIRS.includes(top) && norm.includes('/')));
  const file = path.join(ROOT, norm);
  if (!allowed || !file.startsWith(ROOT + path.sep)) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------------------------------------------------------------- rooms
const rooms = new Map();   // id -> room
// scored rooms (public ones + hosted "scored" servers) use 65% traffic and feed the multiplayer leaderboard
const makeRoom = (id, name, pub, code, scored = true, density = SCORED_DENSITY) =>
  ({ id, name, pub, code, scored, density: scored ? SCORED_DENSITY : density, players: new Map(), emptySince: Date.now(), bests: new Map(), traffic: null });
for (const [id, name] of PUBLIC_ROOMS) rooms.set(id, makeRoom(id, name, true, ''));

// a player's streak on a scored server ended: it goes on the multiplayer leaderboard
function recordRun(p, room) {
  const pts = p.runPeak || 0; p.runPeak = 0;
  if (!room || !room.scored || pts < MIN_RUN) return;
  LB.add('mp', p.name, pts, { server: room.pub ? room.name : 'Private' })
    .then(rank => { if (rank) send(p.ws, { t: 'rank', rank }); })
    .catch(e => console.log('leaderboard error:', e.message));
}

const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I/L, easy to read out loud
function newCode() {
  for (;;) {
    let s = ''; for (let i = 0; i < 6; i++) s += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)];
    const code = s.slice(0, 3) + '-' + s.slice(3);
    if (!rooms.has('p-' + code)) return code;
  }
}
const cleanName = n => String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16) || 'Driver';
const cleanColor = c => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#a6b0b8');
const num = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
function cleanState(st) {
  if (!st || typeof st !== 'object' || !Number.isFinite(st.s) || !Number.isFinite(st.d)) return null;
  return {
    t: num(st.t, 0, 1e9), s: num(st.s, -1e9, 1e9), d: num(st.d, -200, 200), ry: num(st.ry, -7, 7), v: num(st.v, -100, 150), steer: num(st.steer, -1, 1),
    brake: !!st.brake, kmh: Math.round(num(st.kmh, 0, 600)), score: Math.round(num(st.score, 0, 1e12)),
  };
}

function roster(room) { return [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color })); }
function send(ws, m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }
function broadcast(room, m, except) { const s = JSON.stringify(m); for (const p of room.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); }

function joinRoom(p, room) {
  leaveRoom(p);
  if (room.players.size >= MAX_PLAYERS) { send(p.ws, { t: 'error', msg: `${room.name} is full (${MAX_PLAYERS} players).` }); return; }
  // parking space: the lowest one nobody in the room is using
  const used = new Set([...room.players.values()].map(o => o.slot));
  let slot = 0; while (used.has(slot)) slot++;
  room.players.set(p.id, p); p.room = room; p.st = null; p.agent = null; p.slot = slot;
  p.best = room.bests.get(p.name) || 0;                 // best score on this server comes back if you rejoin
  if (!room.traffic) room.traffic = new RingTraffic();
  p.runPeak = 0;
  send(p.ws, { t: 'joined', id: p.id, room: room.id, name: room.name, pub: room.pub, code: room.code, slot, best: p.best, scored: room.scored, density: room.density });
  broadcast(room, { t: 'roster', list: roster(room) });
}
function leaveRoom(p) {
  const room = p.room; if (!room) return;
  recordRun(p, room);
  room.players.delete(p.id); p.room = null; p.agent = null;
  if (room.players.size) broadcast(room, { t: 'roster', list: roster(room) });
  else { room.emptySince = Date.now(); room.traffic = null; }   // nobody left: drop the traffic
}

// ---------------------------------------------------------------- HTTP + WebSocket
let simMs = 0;   // average time one traffic step takes (shown in /api/servers as "load")
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/servers')) {
    const list = [...rooms.values()].filter(r => r.pub).map(r => ({ id: r.id, name: r.name, players: r.players.size, max: MAX_PLAYERS }));
    let online = 0; for (const r of rooms.values()) online += r.players.size;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ servers: list, online, load: +(simMs / (SIM_DT * 1000)).toFixed(3) }));
    return;
  }
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  // leaderboard: GET /api/leaderboard?mode=sp|mp -> top 100
  if (req.url.startsWith('/api/leaderboard')) {
    const mode = new URL(req.url, 'http://x').searchParams.get('mode') === 'mp' ? 'mp' : 'sp';
    LB.top(mode).then(list => json(200, { mode, list: list.map(e => ({ name: e.name, score: e.score, t: e.t, server: e.server })), persistent: LB.persistent }))
      .catch(() => json(500, { error: 'leaderboard unavailable' }));
    return;
  }
  // a finished scored singleplayer drive: POST /api/score {mode:'sp', name, score}
  if (req.url.startsWith('/api/score') && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2048) req.destroy(); });
    req.on('end', () => {
      let m; try { m = JSON.parse(body); } catch (e) { json(400, { error: 'bad request' }); return; }
      const ip = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress;
      const now = Date.now();
      if (now - (lastSubmit.get(ip) || 0) < 5000) { json(429, { error: 'too fast' }); return; }   // one drive per 5 s per player
      lastSubmit.set(ip, now);
      const sc = num(m.score, 0, 5e7);
      if (!(sc >= MIN_RUN)) { json(200, { rank: null }); return; }
      LB.add('sp', cleanName(m.name), sc).then(rank => json(200, { rank })).catch(() => json(500, { error: 'leaderboard unavailable' }));
    });
    return;
  }
  serveStatic(req, res);
});
const lastSubmit = new Map();
setInterval(() => { const t = Date.now(); for (const [k, v] of lastSubmit) if (t - v > 60000) lastSubmit.delete(k); }, 60000);

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
let nextId = 1;
wss.on('connection', ws => {
  const p = { id: 'p' + (nextId++).toString(36), ws, name: 'Driver', color: '#a6b0b8', room: null, st: null, msgs: 0, best: 0,
    ext: { front: 2.24, rear: -2.55, hw: 0.95 } };
  ws._tw = p;
  ws.on('pong', () => (ws._twDead = false));
  ws.on('message', raw => {
    if (++p.msgs > 80) return;                          // flood guard (reset every second)
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'state') {                               // forward right away (no waiting for a tick = smoother)
      const room = p.room; if (!room) return;
      const st = cleanState(m.st); if (!st) return;
      p.st = st;
      if (st.score > p.best) { p.best = st.score; room.bests.set(p.name, p.best); }
      // streak tracking for the leaderboard: the score only goes back to 0 when a streak ends
      if (st.score > (p.runPeak || 0)) p.runPeak = st.score;
      else if (st.score === 0 && p.runPeak) recordRun(p, room);
      st.best = p.best;
      broadcast(room, { t: 'st', id: p.id, st }, p);
      return;
    }
    if (m.t === 'crash') {                               // a player hit a traffic car: it stays crashed where they report
      const room = p.room; if (!room || !room.traffic) return;
      const c = room.traffic.byId.get(m.id);
      if (c && Number.isFinite(m.s) && Number.isFinite(m.d) && Number.isFinite(m.ry)) room.traffic.crash(c, m.s, num(m.d, -30, 30), num(m.ry, -7, 7));
      return;
    }
    if (m.name !== undefined) p.name = cleanName(m.name);
    if (m.color !== undefined) p.color = cleanColor(m.color);
    if (m.ext && typeof m.ext === 'object') p.ext = { front: num(m.ext.front, 1, 4), rear: num(m.ext.rear, -4, -1), hw: num(m.ext.hw, 0.6, 1.3) };
    if (m.t === 'join') {
      const id = String(m.room || '');
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const room = code ? rooms.get('p-' + code.slice(0, 3) + '-' + code.slice(3)) : rooms.get(id);
      if (!room) send(ws, { t: 'error', msg: code ? `No server with code ${code.slice(0, 3)}-${code.slice(3)}. Check the code.` : 'That server no longer exists.' });
      else joinRoom(p, room);
    } else if (m.t === 'create') {
      const code = newCode(), scored = !!m.scored;
      const room = makeRoom('p-' + code, `${p.name}'s server`, false, code, scored, Number.isFinite(m.density) ? num(m.density, 0, 1) : 0.55);
      rooms.set(room.id, room);
      joinRoom(p, room);
    } else if (m.t === 'leave') leaveRoom(p);
  });
  ws.on('close', () => leaveRoom(p));
  ws.on('error', () => leaveRoom(p));
  send(ws, { t: 'hello', id: p.id });
});

// ---------------------------------------------------------------- shared traffic
let lastSim = nowS();
setInterval(() => {
  const now = nowS(), dt = Math.min(0.25, now - lastSim); lastSim = now;
  const t0 = nowS();
  for (const room of rooms.values()) {
    const T = room.traffic; if (!T) continue;
    // players are part of the traffic (cars brake for them / go around them)
    const agents = [];
    for (const p of room.players.values()) {
      if (!p.st) continue;
      const a = p.agent || (p.agent = { isPlayer: true, filled: false });
      Object.assign(a, { raw: p.st.s, s: T.w(p.st.s), d: p.st.d, v: p.st.v, front: p.ext.front, rear: p.ext.rear, hw: p.ext.hw });
      agents.push(a);
    }
    T.players = agents;
    T.step(dt, room.density);
    for (const p of room.players.values()) if (p.agent) send(p.ws, T.snapshot(p.agent, now));
  }
  simMs = simMs * 0.95 + (nowS() - t0) * 1000 * 0.05;
}, SIM_DT * 1000);

// housekeeping: flood counters, dead connections, empty private rooms
setInterval(() => { for (const c of wss.clients) c._tw && (c._tw.msgs = 0); }, 1000);
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws._twDead) { ws.terminate(); continue; }
    ws._twDead = true; ws.ping();
  }
  const now = Date.now();
  for (const [id, r] of rooms) if (!r.pub && !r.players.size && now - r.emptySince > 5 * 60 * 1000) rooms.delete(id);
}, 20000);

server.listen(PORT, () => console.log(`PolyWeave server on http://localhost:${PORT}/`));
