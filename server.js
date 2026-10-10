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
const DB = require('./db');
const RunCheck = require('./runcheck');
const Accounts = require('./accounts');
const Tokens = RunCheck.makeTokens(DB.SECRET);

const PORT = +process.env.PORT || 8790;
const ROOT = __dirname;
const MAX_PLAYERS = 12;
// the game's own (official) scored servers, one per world type
const OFFICIAL_ROOMS = [['highway-1', 'Grassy Highway', 'grass'], ['highway-2', 'Desert Highway', 'desert'], ['highway-3', 'Snowy Highway', 'snow']];
const THEMES = ['grass', 'desert', 'snow'], TODS = ['day', 'sunset', 'night'];
const SIM_DT = 0.1;                 // shared traffic: 10 steps (and snapshots) per second
const SCORED_DENSITY = 0.6;         // traffic on scored (leaderboard) servers, same as scored singleplayer
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
// scored rooms (official ones + hosted "scored" servers) use 60% traffic and feed the multiplayer leaderboard.
// official: the game's own servers. listed: a player's PUBLIC server (in the public list, and joinable by
// its code); a private one is joinable by code only. theme: world type, tod: time of day.
const makeRoom = (id, name, official, code, scored = true, density = SCORED_DENSITY, o = {}) =>
  ({ id, name, official, listed: !!o.listed, code, scored, density: scored ? SCORED_DENSITY : density, theme: o.theme || 'grass', tod: o.tod || 'day',
    players: new Map(), emptySince: Date.now(), bests: new Map(), traffic: null });
for (const [id, name, theme] of OFFICIAL_ROOMS) rooms.set(id, makeRoom(id, name, true, '', true, SCORED_DENSITY, { theme }));
const roomInfo = r => ({ id: r.id, name: r.name, players: r.players.size, max: MAX_PLAYERS, scored: r.scored, theme: r.theme, tod: r.tod });

// ---------------------------------------------------------------- multiplayer run checks
// Each signed-in player on a scored server holds a run token. While it's held, the server keeps its own
// record of the run from the positions it receives: how far the car actually drove (dist, metres) and
// seconds spent near another player (nearS, for the proximity bonus). The game submits the run's event
// log over HTTP (/api/run) and it's checked against this record (runcheck.js).
const mpRuns = new Map();           // token nonce -> { uid, room, server, t0, dist, nearS, last }
function issueMpToken(p) {
  if (p.run) p.run.closed = true;
  p.run = null;
  const room = p.room;
  if (!room || !room.scored || !p.account || !p.account.name || DB.isBanned(p.account.id)) return;
  const token = Tokens.issue({ u: p.account.id, m: 'mp', r: room.id }), n = Tokens.read(token).n;
  p.run = { uid: p.account.id, room, server: room.official || room.listed ? room.name : 'Private', t0: Date.now(), dist: 0, nearS: 0, last: null };
  mpRuns.set(n, p.run);
  send(p.ws, { t: 'runtoken', token });
}
// a new position from p: add to their run record
function trackRun(p, st) {
  const R = p.run; if (!R || R.closed || R.room !== p.room) return;
  const prev = R.last; R.last = { s: st.s, t: st.t };
  if (!prev) return;
  const dt = st.t - prev.t;                            // (sender's clock)
  if (!(dt > 0 && dt < 5)) return;
  const T = p.room.traffic, ds = Math.abs(T ? T.wd(T.w(st.s), T.w(prev.s)) : st.s - prev.s);
  if (ds > 120) return;                                // jumped (back to the lot, restart): not driving
  // (distance, not speed: a slow computer's game clock runs behind real time, so speeds worked out from
  // the update times would come out too low)
  R.dist += ds;
  for (const o of p.room.players.values()) {
    if (o === p || !o.st) continue;
    if (Math.abs(T ? T.wd(T.w(o.st.s), T.w(st.s)) : o.st.s - st.s) < 35 && Math.abs(o.st.d - st.d) < 12) { R.nearS += dt; break; }
  }
}
setInterval(() => { const t = Date.now(); for (const [n, R] of mpRuns) if (t - R.t0 > 48 * 3600e3) mpRuns.delete(n); }, 600e3).unref();
const titleOf = p => (p.account ? DB.equipped(p.account.id) : null);

// ---------------------------------------------------------------- friends: who's online, what they're playing
// Every signed-in game keeps its WebSocket open (not only on servers), so friends get messages, requests
// and each other's activity straight away.
const online = new Map();           // account id -> Set of connections
function setAccount(p, acct) {
  const was = p.account && p.account.id;
  p.account = acct;
  const now = acct && acct.id;
  if (was === now) return;
  if (was) { const s = online.get(was); if (s) { s.delete(p); if (!s.size) online.delete(was); } presenceChanged(was); }
  if (now) { if (!online.has(now)) online.set(now, new Set()); online.get(now).add(p); presenceChanged(now); }
}
const pushTo = (uid, m) => { const s = online.get(uid); if (s) for (const p of s) send(p.ws, m); };
// what a connection is doing: menu, singleplayer (world, time of day) or a server (public ones can be joined)
function activityOf(p) {
  const r = p.room;
  if (r) {
    const kind = r.official ? 'official' : r.listed ? 'public' : 'private';
    return { mode: 'mp', kind, name: kind === 'private' ? null : r.name, theme: r.theme, tod: r.tod, scored: r.scored,
      room: kind === 'private' ? null : r.id, full: r.players.size >= MAX_PLAYERS };
  }
  return p.act || { mode: 'menu' };
}
// what friends see of uid: offline, online (activity hidden), or online + what they're playing
function presenceOf(uid) {
  const s = online.get(uid);
  if (!s || !s.size) return { online: false };
  if (DB.socialSettings(uid).hideActivity) return { online: true, hidden: true };
  let best = null;                                      // (signed in on two tabs: the one that's playing)
  for (const p of s) { const a = activityOf(p); if (!best || (best.mode === 'menu' && a.mode !== 'menu') || (a.mode === 'mp' && best.mode !== 'mp')) best = a; }
  return { online: true, act: best };
}
function presenceChanged(uid) {
  const name = Accounts.nameOf(uid); if (!name) return;
  const pr = presenceOf(uid);
  for (const fid of DB.friendsOf(uid)) pushTo(fid, { t: 'presence', name, p: pr });
}
const cleanText = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
// the Friends tab: friends (online status, activity, unread messages), requests, settings, inbox count
function socialFor(u) {
  const unread = DB.unreadBy(u.id);
  const friends = DB.friendsOf(u.id).map(fid => ({ name: Accounts.nameOf(fid), title: DB.equipped(fid), unread: unread[fid] || 0, p: presenceOf(fid) }))
    .filter(f => f.name);
  const names = ids => ids.map(id => Accounts.nameOf(id)).filter(Boolean);
  return { friends, incoming: names(DB.requestsIn(u.id)), outgoing: names(DB.requestsOut(u.id)), settings: DB.socialSettings(u.id), inbox: DB.unclaimed(u.id) };
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
    brake: !!st.brake, kmh: Math.round(num(st.kmh, 0, 600)), score: Math.round(num(st.score, 0, 1e12)), rt: Math.round(num(st.rt, 0, 1e6)),
    rtt: Math.round(num(st.rtt, 0, 2000)),   // sender's round trip to the server (ms): friends use it to draw them where they are NOW
    // wrecks the sender is simulating right now (cars they hit): [id, s, d, ry]. Friends draw these straight from
    // here, on the same clock as the sender's own car, so the crash looks the same for everyone
    w: Array.isArray(st.w) ? st.w.slice(0, 6).filter(e => Array.isArray(e) && Number.isInteger(e[0]) && e.slice(1, 4).every(Number.isFinite))
      .map(e => [e[0], num(e[1], -1e9, 1e9), num(e[2], -60, 60), num(e[3], -7, 7), num(e[4], -60, 90), num(e[5], -15, 15), num(e[6], -8, 8)]) : undefined,
  };
}

// acct: signed in (their name is their account's, so it can open their profile; a guest's name could be anyone's)
function roster(room) { return [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, title: p.title || null, acct: !!(p.account && p.account.name) })); }
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
  p.title = titleOf(p);
  send(p.ws, { t: 'joined', id: p.id, room: room.id, name: room.name, official: room.official, listed: room.listed, code: room.code, slot, best: p.best,
    scored: room.scored, density: room.density, theme: room.theme, tod: room.tod });
  issueMpToken(p);                                     // (scored server + signed in: runs can go on the leaderboard)
  broadcast(room, { t: 'roster', list: roster(room) });
  if (p.account) presenceChanged(p.account.id);        // (friends see which server)
}
function leaveRoom(p) {
  const room = p.room; if (!room) return;
  if (p.run) p.run.closed = true;                      // (a run in progress can still be submitted)
  room.players.delete(p.id); p.room = null; p.agent = null;
  if (room.players.size) broadcast(room, { t: 'roster', list: roster(room) });
  else { room.emptySince = Date.now(); room.traffic = null; }   // nobody left: drop the traffic
  if (p.account) presenceChanged(p.account.id);
}

// ---------------------------------------------------------------- HTTP + WebSocket
let simMs = 0;   // average time one traffic step takes (shown in /api/servers as "load")
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/servers')) {
    const all = [...rooms.values()];
    const official = all.filter(r => r.official).map(roomInfo);
    const pub = all.filter(r => !r.official && r.listed && r.players.size).map(roomInfo)   // (players' public servers while someone's on them)
      .sort((a, b) => b.players - a.players).slice(0, 50);
    let online = 0; for (const r of rooms.values()) online += r.players.size;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ official, public: pub, servers: official, online, load: +(simMs / (SIM_DT * 1000)).toFixed(3) }));
    return;
  }
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const url = new URL(req.url, 'http://x'), route = url.pathname;
  const ip = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress;
  const body = (fn, max = 8192) => {                    // JSON POST bodies (small, except run logs)
    let b = '';
    req.on('data', c => { b += c; if (b.length > max) req.destroy(); });
    req.on('end', () => { let m; try { m = JSON.parse(b); } catch (e) { json(400, { error: 'bad request' }); return; } fn(m || {}); });
  };
  const tooFast = (key, ms) => { const now = Date.now(); if (now - (lastHit.get(key) || 0) < ms) return true; lastHit.set(key, now); return false; };

  // ---- accounts (Sign in with Google): only signed-in players get on the leaderboards
  if (route === '/api/config') { json(200, { googleClientId: Accounts.clientId() }); return; }
  if (route === '/api/auth/google' && req.method === 'POST') {
    body(m => {
      if (tooFast('auth:' + ip, 1500)) { json(429, { error: 'Too many sign-in attempts. Wait a moment.' }); return; }
      Accounts.login(m.credential).then(({ token, user, isNew }) => {
        if (isNew && DB.alphaOpen()) DB.gift(user.id, 'alpha');   // (new players get Alpha Tester until it's switched off)
        DB.gift(user.id, 'verified');                           // (signed in with Google; only sent once)
        json(200, { session: token, name: user.name, title: DB.equipped(user.id) });
      })
        .catch(e => json(401, { error: e.message }));
    });
    return;
  }
  const bearer = () => Accounts.bySession(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  if (route === '/api/account') {                       // who am I? (Authorization: Bearer <session>)
    const u = bearer();
    json(u ? 200 : 401, u ? { name: u.name, title: DB.equipped(u.id) } : { error: 'not signed in' });
    return;
  }
  // profiles: GET /api/profile?name=<driver> (anyone's), GET /api/profile (Bearer: your own, with your titles)
  if (route === '/api/profile') {
    const qn = url.searchParams.get('name');
    const u = qn ? Accounts.byName(qn) : bearer();
    if (!u || !u.name) { json(qn ? 404 : 401, { error: qn ? 'No driver with that name.' : 'Sign in to see your profile.' }); return; }
    if (DB.isBanned(u.id)) { json(404, { error: 'No driver with that name.' }); return; }
    const pr = Object.assign({ name: u.name, joined: u.created || null }, DB.profile(u.id));
    if (!qn) Object.assign(pr, { self: true, owned: DB.titlesOf(u.id), owners: DB.ownerCounts() });
    json(200, pr);
    return;
  }
  // POST /api/playtime {session, s}: about once a minute while driving (time played on the profile)
  if (route === '/api/playtime' && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session); if (!u) { json(401, { error: 'not signed in' }); return; }
      DB.addPlayTime(u.id, num(+m.s, 0, 75));
      json(200, { ok: true });
    });
    return;
  }
  // ---- inbox: GET /api/inbox (Bearer) -> items; POST /api/inbox/claim {session, id}
  if (route === '/api/inbox') {
    const u = bearer(); if (!u) { json(401, { error: 'Sign in to see your inbox.' }); return; }
    json(200, { items: DB.inboxOf(u.id).map(r => ({ id: r.id, kind: r.kind, item: r.item, t: r.t, claimed: !!r.claimed })) });
    return;
  }
  if (route === '/api/inbox/claim' && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session); if (!u) { json(401, { error: 'Not signed in.' }); return; }
      const got = DB.claim(u.id, +m.id);
      json(got ? 200 : 404, got ? { got, inbox: DB.unclaimed(u.id) } : { error: 'Already claimed.' });
    });
    return;
  }
  // ---- friends. GET /api/social (Bearer): friends + activity, requests, settings, inbox count
  if (route === '/api/social') {
    const u = bearer(); if (!u || !u.name) { json(401, { error: 'Sign in to add friends.' }); return; }
    json(200, socialFor(u));
    return;
  }
  // POST /api/friends/<request|respond|cancel|remove> {session, name, accept?}
  const fm = route.match(/^\/api\/friends\/(request|respond|cancel|remove)$/);
  if (fm && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session); if (!u || !u.name) { json(401, { error: 'Sign in to add friends.' }); return; }
      if (tooFast('friend:' + u.id, 400)) { json(429, { error: 'Slow down a little.' }); return; }
      const o = Accounts.byName(cleanText(m.name));
      if (!o || DB.isBanned(o.id)) { json(404, { error: 'No driver with that name.' }); return; }
      const ping = id => pushTo(id, { t: 'social' });   // (their Friends tab refreshes)
      // new friends: Social Butterfly (10 friends) may be due for either of them
      const friendTitles = () => { for (const id of [u.id, o.id]) if (DB.statTitles(id).length) pushTo(id, { t: 'inbox' }); };
      if (fm[1] === 'request') {
        const r = DB.sendRequest(u.id, o.id);
        if (r !== 'sent' && r !== 'accepted') { json(400, { error: r }); return; }
        pushTo(o.id, { t: 'social', request: r === 'sent' ? u.name : undefined });
        if (r === 'accepted') { presenceChanged(u.id); presenceChanged(o.id); friendTitles(); }
        json(200, { ok: r, name: o.name });
      } else if (fm[1] === 'respond') {
        if (!DB.respond(u.id, o.id, !!m.accept)) { json(404, { error: 'That request is gone.' }); return; }
        ping(o.id);
        if (m.accept) friendTitles();
        json(200, { ok: true });
      } else if (fm[1] === 'cancel') { DB.cancelRequest(u.id, o.id); ping(o.id); json(200, { ok: true }); }
      else { DB.unfriend(u.id, o.id); ping(o.id); json(200, { ok: true }); }
    });
    return;
  }
  // POST /api/social/settings {session, allowRequests?, hideActivity?}
  if (route === '/api/social/settings' && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session); if (!u) { json(401, { error: 'Not signed in.' }); return; }
      DB.setSocialSettings(u.id, { allowRequests: m.allowRequests, hideActivity: m.hideActivity });
      presenceChanged(u.id);
      json(200, DB.socialSettings(u.id));
    });
    return;
  }
  // chats: GET /api/chat?with=<name> (Bearer) -> last 100 messages (marks them read); POST /api/chat/send {session, to, body}
  if (route === '/api/chat') {
    const u = bearer(); if (!u) { json(401, { error: 'Not signed in.' }); return; }
    const o = Accounts.byName(url.searchParams.get('with') || '');
    if (!o || !DB.areFriends(u.id, o.id)) { json(404, { error: 'You can only chat with friends.' }); return; }
    DB.markRead(u.id, o.id);
    json(200, { name: o.name, messages: DB.chatWith(u.id, o.id).map(r => ({ id: r.id, me: r.from_uid === u.id, body: r.body, t: r.t })) });
    return;
  }
  if (route === '/api/chat/send' && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session); if (!u || !u.name) { json(401, { error: 'Not signed in.' }); return; }
      const o = Accounts.byName(cleanText(m.to)), text = cleanText(m.body);
      if (!o || !DB.areFriends(u.id, o.id)) { json(404, { error: 'You can only chat with friends.' }); return; }
      if (!text) { json(400, { error: 'Empty message.' }); return; }
      if (tooFast('chat:' + u.id, 300)) { json(429, { error: 'You\'re sending messages too fast.' }); return; }
      const r = DB.sendMessage(u.id, o.id, text);
      pushTo(o.id, { t: 'msg', id: r.id, from: u.name, body: text, at: r.t });
      json(200, { id: r.id, t: r.t });
    });
    return;
  }
  if (route === '/api/chat/read' && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session), o = Accounts.byName(cleanText(m.with));
      if (u && o) DB.markRead(u.id, o.id);
      json(200, { ok: true });
    });
    return;
  }
  // titles: GET /api/titles (Bearer) -> what you've unlocked + what's equipped; POST /api/title {session, title|null}
  if (route === '/api/titles') {
    const u = bearer(); if (!u) { json(401, { error: 'not signed in' }); return; }
    json(200, { owned: DB.titlesOf(u.id), equipped: DB.equipped(u.id) });
    return;
  }
  if (route === '/api/title' && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session); if (!u) { json(401, { error: 'Not signed in.' }); return; }
      const err = DB.equip(u.id, typeof m.title === 'string' ? m.title : null);
      if (err) { json(400, { error: err }); return; }
      // drivers on a server see it on your name tag straight away
      for (const room of rooms.values()) for (const p of room.players.values()) if (p.account && p.account.id === u.id) { p.title = titleOf(p); broadcast(room, { t: 'roster', list: roster(room) }); }
      json(200, { equipped: DB.equipped(u.id) });
    });
    return;
  }
  if (route === '/api/account/name' && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session); if (!u) { json(401, { error: 'Not signed in.' }); return; }
      const err = Accounts.setName(u, m.name);
      json(err ? 400 : 200, err ? { error: err } : { name: u.name });
    });
    return;
  }
  if (route === '/api/auth/logout' && req.method === 'POST') { body(m => { Accounts.logout(m.session); json(200, { ok: true }); }); return; }

  // leaderboard: GET /api/leaderboard?mode=sp|mp -> top 100 (signed-in drivers only, under their current name)
  //              GET /api/leaderboard/me?mode=sp|mp (Bearer) -> your rank + the 10 drivers ahead of you and 10 behind
  const lbRow = e => ({ rank: e.rank, name: Accounts.nameOf(e.uid) || 'Driver', title: e.title || null, score: e.score, t: e.t, dur: e.dur || 0, server: e.server });
  if (route === '/api/leaderboard' || route === '/api/leaderboard/me') {
    const mode = url.searchParams.get('mode') === 'mp' ? 'mp' : 'sp';
    try {
      if (route === '/api/leaderboard') { json(200, { mode, persistent: true, accounts: Accounts.enabled(), list: DB.top(mode).map(lbRow) }); return; }
      const u = bearer(); if (!u) { json(401, { error: 'Sign in to see your position.' }); return; }
      const a = DB.around(mode, u.id, 10);
      json(200, { mode, rank: a.rank, total: a.total, list: a.list.map(lbRow) });
    } catch (e) { console.log('leaderboard error:', e.message); json(500, { error: 'leaderboard unavailable' }); }
    return;
  }
  // scored runs. Singleplayer: POST /api/run/start {session} -> {token} before a run can count.
  // Multiplayer tokens come over the WebSocket ('runtoken'). Then POST /api/run {session, token, mode, score, dur, log}.
  if (route === '/api/run/start' && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session);
      if (!u || !u.name) { json(401, { error: 'Sign in to get on the leaderboard.' }); return; }
      if (DB.isBanned(u.id)) { json(403, { error: 'This account is banned from the leaderboards.' }); return; }
      if (tooFast('start:' + u.id, 800)) { json(429, { error: 'too fast' }); return; }
      json(200, { token: Tokens.issue({ u: u.id, m: 'sp' }) });
    });
    return;
  }
  if (route === '/api/run' && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session);
      if (!u || !u.name) { json(401, { error: 'Sign in to get on the leaderboard.' }); return; }
      if (DB.isBanned(u.id)) { json(403, { error: 'This account is banned from the leaderboards.' }); return; }
      const tok = Tokens.read(m.token), mode = m.mode === 'mp' ? 'mp' : 'sp';
      if (!tok || tok.u !== u.id || tok.m !== mode) { json(400, { error: 'Bad run token.' }); return; }
      if (Date.now() - tok.t > 48 * 3600e3) { json(400, { error: 'Run token expired.' }); return; }
      const R = mode === 'mp' ? mpRuns.get(tok.n) : null;
      if (mode === 'mp' && !R) { json(400, { error: 'The server restarted during that run, so it can\'t be checked.' }); return; }
      const run = { score: Number(m.score), dur: Number(m.dur), log: m.log };
      if (!(run.score >= MIN_RUN)) { json(200, { rank: null }); return; }
      if (!DB.spendToken(tok.n)) { json(409, { error: 'That run was already submitted.' }); return; }
      if (R) R.closed = true;
      const v = RunCheck.verify(run, { mode, wallS: (Date.now() - tok.t) / 1000, mp: R ? { dist: R.dist, nearS: R.nearS } : null });
      const rec = { uid: u.id, mode, score: run.score, dur: run.dur, server: R ? R.server : null, room: R ? R.room.id : null, log: run.log };
      if (!v.ok) {
        console.log(`run rejected: ${u.name} ${mode} ${Math.round(run.score)} (${v.why})`);
        DB.addRun(Object.assign(rec, { verified: -1, note: v.why, dur: Number.isFinite(run.dur) ? run.dur : 0, score: Number.isFinite(run.score) ? run.score : 0 }));
        json(200, { rank: null, rejected: v.why });
        return;
      }
      // distance driven (a profile stat): no more than top speed allows, or (multiplayer) than the server saw
      let dist = num(+m.dist, 0, run.dur * RunCheck.VMAX_KMH / 3.6 * 1.05);
      if (R) dist = Math.min(dist, R.dist * 1.05 + 50);
      const r = DB.addRun(Object.assign(rec, { verified: 1, near: v.stats.near, topKmh: v.stats.topKmh, peak: v.stats.peak, dist }));
      if (r.newTitles.length) pushTo(u.id, { t: 'inbox' });   // (a title is waiting in their inbox)
      // a team run: everyone in it who just got a team title hears about it
      if (r.team) for (const id of Object.keys(r.team.gifted)) pushTo(id, { t: 'inbox' });
      json(200, { rank: r.rank, best: r.best, improved: r.improved, newTitles: r.newTitles, teamTitles: (r.team && r.team.gifted[u.id]) || [] });
    }, 4 * 1024 * 1024);
    return;
  }
  serveStatic(req, res);
});
const lastHit = new Map();
setInterval(() => { const t = Date.now(); for (const [k, v] of lastHit) if (t - v > 60000) lastHit.delete(k); }, 60000);

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });   // (run logs go over HTTP, not here)
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
    if (m.t === 'ping') { if (Number.isFinite(m.c)) send(ws, { t: 'pong', c: m.c }); return; }   // round-trip time check
    // two players collided hard: the one who noticed tells the other, so BOTH streaks end
    if (m.t === 'bump') {
      const room = p.room; if (!room) return;
      for (const q of room.players.values()) if (q.id === m.id && q !== p) send(q.ws, { t: 'bumped', from: p.id, v: num(m.v, 0, 80) });
      return;
    }
    if (m.t === 'state') {                               // forward right away (no waiting for a tick = smoother)
      const room = p.room; if (!room) return;
      const st = cleanState(m.st); if (!st) return;
      p.st = st;
      if (st.score > p.best) { p.best = st.score; room.bests.set(p.name, p.best); }
      trackRun(p, st);                                   // (the server's own record of the run, for checking it)
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
    if (m.t === 'recover' || m.t === 'gone') {           // a wreck got going again / disappeared
      const room = p.room; if (!room || !room.traffic) return;
      const c = room.traffic.byId.get(m.id); if (!c) return;
      if (m.t === 'gone') room.traffic.gone(c);
      else if (Number.isFinite(m.s) && Number.isInteger(m.lane) && m.lane >= 0 && m.lane < 4) room.traffic.recover(c, m.s, m.lane, num(m.v, 0, 40));
      return;
    }
    if (m.t === 'runtoken') { issueMpToken(p); return; }   // a streak ended: a fresh token for the next run
    // signed-in game: online for friends (sent on connecting, and again after signing in / out)
    if (m.t === 'auth') { setAccount(p, Accounts.bySession(m.session)); send(ws, { t: 'authed', ok: !!p.account }); return; }
    // what I'm doing outside servers: menu / singleplayer (world, time of day, scored); servers are known here
    if (m.t === 'activity') {
      const a = m.a || {};
      p.act = a.mode === 'sp' ? { mode: 'sp', theme: THEMES.includes(a.theme) ? a.theme : 'grass', tod: TODS.includes(a.tod) ? a.tod : 'day', scored: !!a.scored } : { mode: 'menu' };
      if (p.account) presenceChanged(p.account.id);
      return;
    }
    if (m.session !== undefined) setAccount(p, Accounts.bySession(m.session));   // signed in: runs count, name = account name
    if (m.name !== undefined) p.name = p.account && p.account.name ? p.account.name : cleanName(m.name);
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
      const roomName = String(m.roomName || '').replace(/[^\p{L}\p{N} _.'!\-]/gu, '').trim().slice(0, 24) || `${p.name}'s server`;
      const room = makeRoom('p-' + code, roomName, false, code, scored, Number.isFinite(m.density) ? num(m.density, 0, 1) : 0.55,
        { listed: !!m.listed, theme: THEMES.includes(m.theme) ? m.theme : 'grass', tod: TODS.includes(m.tod) ? m.tod : 'day' });
      rooms.set(room.id, room);
      joinRoom(p, room);
    } else if (m.t === 'leave') leaveRoom(p);
  });
  ws.on('close', () => { leaveRoom(p); setAccount(p, null); });   // (offline for friends once no game is connected)
  ws.on('error', () => { leaveRoom(p); setAccount(p, null); });
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
      const ns = T.w(p.st.s);
      // jumped somewhere (back to the parking lot, restart...): fill the traffic around the new spot right
      // away, like when joining, instead of waiting for cars to drive in from the edges
      if (a.filled && a.s !== undefined && Math.abs(T.wd(ns, a.s)) > 250) a.filled = false;
      Object.assign(a, { raw: p.st.s, s: ns, d: p.st.d, v: p.st.v, front: p.ext.front, rear: p.ext.rear, hw: p.ext.hw });
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
  for (const [id, r] of rooms) if (!r.official && !r.players.size && now - r.emptySince > 5 * 60 * 1000) rooms.delete(id);
}, 20000);

// HOST: on AWS the server only listens to Caddy on the same machine (127.0.0.1); Caddy faces the internet
server.listen(PORT, process.env.HOST || undefined, () => console.log(`PolyWeave server on http://localhost:${PORT}/`));
