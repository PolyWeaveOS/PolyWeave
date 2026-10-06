'use strict';
// =====================================================================
//  PolyWeave dedicated server
//  - Serves the game itself (index.html, js/, assets/...) so everyone plays from one link.
//  - Multiplayer over WebSocket (/ws): always-on public servers plus private rooms with codes.
//    The server relays each player's state (road position, speed, score) to everyone in the
//    room ~15 times a second. Each player still runs their own traffic.
//  Run locally:  npm install  then  node server.js   (PORT env var picks the port, default 8790)
// =====================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 8790;
const ROOT = __dirname;
const MAX_PLAYERS = 12;
const PUBLIC_ROOMS = [['highway-1', 'Highway 1'], ['highway-2', 'Highway 2'], ['highway-3', 'Highway 3']];
const TICK = 1000 / 15;

// ---------------------------------------------------------------- static files
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream',
};
const PUBLIC_DIRS = ['js', 'assets'];
const PUBLIC_FILES = ['index.html', 'style.css', 'manifest.webmanifest', 'sw.js'];

function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
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
const rooms = new Map();   // id -> { id, name, pub, code, players: Map(pid -> player), emptySince }
for (const [id, name] of PUBLIC_ROOMS) rooms.set(id, { id, name, pub: true, code: '', players: new Map(), emptySince: 0 });

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
    s: num(st.s, -1e9, 1e9), d: num(st.d, -20, 20), ry: num(st.ry, -4, 4), v: num(st.v, -100, 150), steer: num(st.steer, -1, 1),
    brake: !!st.brake, kmh: Math.round(num(st.kmh, 0, 600)), score: Math.round(num(st.score, 0, 1e12)),
  };
}

function roster(room) { return [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color })); }
function send(ws, m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }
function broadcast(room, m) { const s = JSON.stringify(m); for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(s); }

function joinRoom(p, room) {
  leaveRoom(p);
  if (room.players.size >= MAX_PLAYERS) { send(p.ws, { t: 'error', msg: `${room.name} is full (${MAX_PLAYERS} players).` }); return; }
  // spawn next to whoever moved most recently
  let at = null, best = 0;
  for (const o of room.players.values()) if (o.st && o.stT > best) { best = o.stT; at = o.st; }
  room.players.set(p.id, p); p.room = room; p.st = null;
  send(p.ws, { t: 'joined', id: p.id, room: room.id, name: room.name, pub: room.pub, code: room.code, at });
  broadcast(room, { t: 'roster', list: roster(room) });
}
function leaveRoom(p) {
  const room = p.room; if (!room) return;
  room.players.delete(p.id); p.room = null;
  if (room.players.size) broadcast(room, { t: 'roster', list: roster(room) });
  else room.emptySince = Date.now();
}

// ---------------------------------------------------------------- HTTP + WebSocket
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/servers')) {
    const list = [...rooms.values()].filter(r => r.pub).map(r => ({ id: r.id, name: r.name, players: r.players.size, max: MAX_PLAYERS }));
    let online = 0; for (const r of rooms.values()) online += r.players.size;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ servers: list, online }));
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
let nextId = 1;
wss.on('connection', ws => {
  const p = { id: 'p' + (nextId++).toString(36), ws, name: 'Driver', color: '#a6b0b8', room: null, st: null, stT: 0, msgs: 0 };
  ws._tw = p;
  ws.on('pong', () => (ws._twDead = false));
  ws.on('message', raw => {
    if (++p.msgs > 60) return;                          // flood guard (reset every second)
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'state') { if (p.room) { const st = cleanState(m.st); if (st) { p.st = st; p.stT = Date.now(); } } return; }
    if (m.name !== undefined) p.name = cleanName(m.name);
    if (m.color !== undefined) p.color = cleanColor(m.color);
    if (m.t === 'join') {
      const id = String(m.room || '');
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const room = code ? rooms.get('p-' + code.slice(0, 3) + '-' + code.slice(3)) : rooms.get(id);
      if (!room) send(ws, { t: 'error', msg: code ? `No server with code ${code.slice(0, 3)}-${code.slice(3)}. Check the code.` : 'That server no longer exists.' });
      else joinRoom(p, room);
    } else if (m.t === 'create') {
      const code = newCode();
      const room = { id: 'p-' + code, name: `${p.name}'s server`, pub: false, code, players: new Map(), emptySince: 0 };
      rooms.set(room.id, room);
      joinRoom(p, room);
    } else if (m.t === 'leave') leaveRoom(p);
    else if (m.t === 'profile' && p.room) broadcast(p.room, { t: 'roster', list: roster(p.room) });
  });
  ws.on('close', () => leaveRoom(p));
  ws.on('error', () => leaveRoom(p));
  send(ws, { t: 'hello', id: p.id });
});

// relay everyone's latest state to their room
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size < 2) continue;
    const list = [];
    for (const p of room.players.values()) if (p.st) list.push({ id: p.id, st: p.st });
    if (list.length) broadcast(room, { t: 'states', list });
  }
}, TICK);

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
