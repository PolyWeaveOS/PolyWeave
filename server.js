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
const NetCodec = require('./js/netcodec');   // (binary versions of the frequent messages: snapshots + positions)
const DB = require('./db');
const RunCheck = require('./runcheck');
const Accounts = require('./accounts');
const Tracks = require('./js/tracks');      // (Season 1 racing: the race tracks' names / lengths)
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
const CHAT_GAP = 3000;              // server chat: at least this long (ms) between one player's messages

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
    players: new Map(), emptySince: Date.now(), bests: new Map(), traffic: null,
    race: o.race ? { track: o.race.track, laps: Tracks.RACE_LAPS, queue: !!o.race.queue, st: 'lobby', endsAt: 0, goAt: 0, grid: [], finish: new Map(), lap: new Map(), firstAt: 0, results: [] } : null });
for (const [id, name, theme] of OFFICIAL_ROOMS) rooms.set(id, makeRoom(id, name, true, '', true, SCORED_DENSITY, { theme }));
const roomInfo = r => ({ id: r.id, name: r.name, players: r.players.size, max: r.race ? Tracks.RACE_MAX : MAX_PLAYERS, scored: r.scored, theme: r.theme, tod: r.tod,
  race: r.race ? { track: r.race.track, st: r.race.st } : undefined });
const maxOf = room => (room.race ? Tracks.RACE_MAX : MAX_PLAYERS);

// ---------------------------------------------------------------- racing (Season 1 limited-time mode)
// A race room is a lobby on one of the tracks: everyone practises freely until 2+ players are in, then a
// 60 s countdown starts (back to waiting if it drops to 1). Then everyone (up to 10) is put on the grid, the
// lights go out, 3 laps, results for 15 s, and back to the lobby. The queue for each track is its public
// lobby rooms (a new one opens while the last is racing); players can also host public / private races.
// Each game times itself and reports laps; finishing times are measured here, from the start.
const RACE_RESULTS_MS = 15000, RACE_AFTER_WINNER_MS = 60000, RACE_LIMIT_MS = 15 * 60e3;
const RACE_TEST = process.env.PW_RACE_TEST === '1';   // (local testing only: 5 s countdown, no minimum race time)
// (each track's own world + time of day for its queue: js/tracks.js look)
const raceMsg = room => {
  const R = room.race, now = Date.now();
  return { t: 'race', st: R.st, track: R.track, laps: R.laps, n: room.players.size, need: Tracks.RACE_MIN, grid: R.grid,
    ms: Math.max(0, (R.st === 'grid' ? R.goAt : R.endsAt) - now), hold: R.hold, el: R.st === 'racing' ? now - R.goAt : 0, results: R.st === 'results' ? R.results : undefined };
};
// Time checks (anti-cheat): the server keeps its own record of each racer, so a hacked game can't fake a race.
//  - laps must come in order, each at least a flat-out lap (Tracks.minLapMs) after the one before
//  - the car's reported position must cover the whole race distance, and never faster than an F1 car can
//    go (top speed + 25%, measured over a second or more, 3 strikes)
// A driver who fails isn't classified (DNF) and it's logged. (PW_RACE_TEST skips these for bots.)
const RACE_VMAX = 345 / 3.6 * 1.25;
function raceTrace(R, p, st) {
  if (R.st !== 'racing' || !R.grid.includes(p.id) || R.finish.has(p.id)) return;
  const now = Date.now(); let T = R.tr.get(p.id);
  if (!T) R.tr.set(p.id, T = { pts: [], maxS: -1e9, strikes: 0, bad: null });
  T.maxS = Math.max(T.maxS, st.s);
  T.pts.push([now, st.s]);
  while (T.pts.length > 2 && now - T.pts[1][0] >= 1000) T.pts.shift();   // (the oldest kept sample: just over 1 s ago)
  const [t0, s0] = T.pts[0], dt = (now - t0) / 1000;
  if (dt >= 1 && (st.s - s0) / dt > RACE_VMAX && ++T.strikes >= 3 && !T.bad) {
    T.bad = `moved ${Math.round((st.s - s0) / dt * 3.6)} km/h`;
    console.log(`race check: ${p.name} (${p.account ? p.account.id : 'guest'}) ${R.track}: ${T.bad}`);
  }
}
// ---------------------------------------------------------------- admin panel API (see the /api/admin/ gate below)
const Titles = require('./js/titles');
const isAdmin = u => !!(u && u.id && DB.adminUid() && u.id === DB.adminUid());
const fmtN = n => Math.round(n).toLocaleString('en-US');
function adminApi(route, url, req, json, body) {
  const q = k => url.searchParams.get(k);
  const nameOf = uid => Accounts.nameOf(uid) || '?';
  const userInfo = uid => { const r = DB.userRow(uid) || {}; return { uid, name: nameOf(uid), banned: !!r.banned && DB.isBanned(uid), banUntil: DB.banUntil(uid), playS: Math.round(r.play_s || 0),
    sp: DB.bestOf('sp', uid), mp: DB.bestOf('mp', uid), rankSp: DB.rankOf('sp', uid), rankMp: DB.rankOf('mp', uid), title: DB.equipped(uid) }; };
  const withName = rows => rows.map(r => Object.assign({ name: nameOf(r.uid) }, r));
  if (route === '/api/admin/overview') {
    const users = Accounts.all();
    let inGame = 0; for (const r of rooms.values()) inGame += r.players.size;
    json(200, Object.assign({ accounts: users.length, signedIn: users.filter(x => x.name).length, onlineNow: online.size, inGame }, DB.adminOverview()));
    return;
  }
  if (route === '/api/admin/players') {               // ?q=part of a name (empty: newest first)
    const s = String(q('q') || '').toLowerCase().trim();
    const list = Accounts.all().filter(x => x.name && (!s || x.name.toLowerCase().includes(s))).sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 60);
    json(200, { list: list.map(x => Object.assign(userInfo(x.id), { joined: x.created || null })) });
    return;
  }
  if (route === '/api/admin/player') {
    const a = Accounts.byName(q('name')); if (!a) { json(404, { error: 'No player with that name.' }); return; }
    json(200, Object.assign(userInfo(a.id), { joined: a.created || null, owned: DB.titlesOf(a.id), runs: withName(DB.adminRuns({ uid: a.id, limit: 60 })) }));
    return;
  }
  if (route === '/api/admin/runs') {                  // filters: name, mode, status, minScore, maxScore, minDur, maxDur, minPps, days, limit
    const f = {}; for (const k of ['mode', 'status', 'minScore', 'maxScore', 'minDur', 'maxDur', 'minPps', 'limit']) { const v = q(k); if (v !== null && v !== '') f[k] = v; }
    if (q('name')) { const a = Accounts.byName(q('name')); if (!a) { json(200, { list: [] }); return; } f.uid = a.id; }
    if (+q('days') > 0) f.since = Date.now() - +q('days') * 86400e3;
    json(200, { list: withName(DB.adminRuns(f)) });
    return;
  }
  if (route === '/api/admin/racing') {                // ?track=&kind=laps|races
    const track = Tracks.TRACK_BY_ID[q('track')] ? q('track') : Tracks.TRACKS[0].id;
    json(200, { track, list: withName(q('kind') === 'races' ? DB.adminRaces(track) : DB.adminLaps(track)) });
    return;
  }
  if (route === '/api/admin/log') { json(200, { list: DB.adminLogList(200) }); return; }
  if (route === '/api/admin/action' && req.method === 'POST') {
    body(m => {
      const who = () => { const a = Accounts.byName(m.name); if (!a) throw new Error('No player called "' + m.name + '".'); return a; };
      let msg;
      try {
        switch (m.action) {
          case 'ban': {                                  // days 0 / empty = permanent
            const a = who(), days = Math.max(0, Math.min(3650, Math.floor(+m.days || 0)));
            if (isAdmin(a)) throw new Error('That\'s the admin account.');
            DB.setBanned(a.id, true, days); msg = `${a.name} leaderboard banned ${days ? 'for ' + days + ' days (scores + stats reset when it ends)' : 'permanently'}.`;
            DB.adminLog('ban', a.name, days ? days + ' days' : 'permanent'); break;
          }
          case 'unban': { const a = who(); DB.setBanned(a.id, false); msg = `${a.name} unbanned.`; DB.adminLog('unban', a.name); break; }
          case 'grant': {
            const a = who(); if (!Titles.TITLE_BY_ID[m.title]) throw new Error('Unknown title.');
            const note = m.note ? String(m.note).slice(0, 300) : null;
            msg = DB.gift(a.id, m.title, note) ? `"${Titles.TITLE_BY_ID[m.title].name}" sent to ${a.name}'s inbox.` : `${a.name} already has "${Titles.TITLE_BY_ID[m.title].name}" (or it's waiting in their inbox).`;
            DB.adminLog('grant', a.name, m.title + (note ? ' - ' + note : '')); break;
          }
          case 'revoke': {
            const a = who(); if (!Titles.TITLE_BY_ID[m.title]) throw new Error('Unknown title.');
            DB.db.prepare('DELETE FROM user_titles WHERE uid = ? AND title = ?').run(a.id, m.title);
            DB.db.prepare("DELETE FROM inbox WHERE uid = ? AND kind = 'title' AND item = ? AND claimed IS NULL").run(a.id, m.title);
            if (DB.equipped(a.id) === m.title) DB.equip(a.id, null);
            msg = `${a.name} lost "${Titles.TITLE_BY_ID[m.title].name}".`; DB.adminLog('revoke', a.name, m.title); break;
          }
          case 'removeRun': case 'restoreRun': {
            const id = Math.floor(+m.id), on = m.action === 'removeRun', row = DB.db.prepare('SELECT verified FROM runs WHERE id = ?').get(id);
            if (!row) throw new Error('No run #' + id + '.');
            if (!on && row.verified < 0) throw new Error('Run #' + id + ' failed the checks - it can\'t be put on the leaderboard.');   // (a rejected run never goes on)
            DB.setRemoved(id, on);
            msg = `Run #${id} ${on ? 'taken off the leaderboard' : 'restored'}.`; DB.adminLog(m.action, '#' + id); break;
          }
          case 'trim': {                                 // every run of a player above a score off the board
            const a = who(), mode = m.mode === 'mp' ? 'mp' : 'sp', max = +m.max;
            if (!Number.isFinite(max)) throw new Error('Give a score.');
            msg = `${a.name}: ${DB.removeAbove(a.id, mode, max)} ${mode} runs above ${fmtN(max)} removed.`; DB.adminLog('trim', a.name, `${mode} > ${max}`); break;
          }
          case 'lap': case 'race': {                     // status: 0 = counted (approve / restore), 1 = removed, 2 = held
            const st = [0, 1, 2].includes(+m.status) ? +m.status : 1, id = Math.floor(+m.id);
            if (!DB.setLapStatus(m.action === 'lap' ? 'laps' : 'race_results', id, st)) throw new Error('Nothing with id ' + id + '.');
            msg = `${m.action === 'lap' ? 'Lap' : 'Race result'} #${id} ${['approved / counted', 'removed', 'held'][st]}.`; DB.adminLog(m.action + ' ' + ['count', 'remove', 'hold'][st], '#' + id); break;
          }
          default: throw new Error('Unknown action.');
        }
      } catch (e) { json(400, { error: e.message }); return; }
      json(200, { ok: true, msg });
    });
    return;
  }
  json(404, { error: 'Not found' });
}

// a refused race lap / finish of a signed-in driver: recorded once per race (admin panel + the auto-ban count)
function raceFlag(R, p, note, ms = 0) {
  if (!p.account || !p.account.name) return;
  R.flagged = R.flagged || new Set(); if (R.flagged.has(p.id)) return; R.flagged.add(p.id);
  try { DB.flagRacing(p.account.id, 'race', note, ms); } catch (e) { console.log('race flag error:', e.message); }
}
const raceSet = (room, st, endsAt = 0) => { room.race.st = st; room.race.endsAt = endsAt; broadcast(room, raceMsg(room)); };
function raceTick() {
  const now = Date.now();
  for (const room of rooms.values()) {
    const R = room.race; if (!R) continue;
    const n = room.players.size;
    if (R.st === 'lobby') { if (n >= Tracks.RACE_MIN) raceSet(room, 'countdown', now + (RACE_TEST ? 5 : Tracks.RACE_COUNTDOWN) * 1000); }
    else if (R.st === 'countdown') {
      if (n < Tracks.RACE_MIN) raceSet(room, 'lobby');
      else if (now >= R.endsAt) {
        // on the grid: 2 s to settle, the five lights one per second, then a random pause before they go out
        R.hold = Math.round(300 + Math.random() * 2200);
        R.grid = [...room.players.keys()].slice(0, Tracks.RACE_MAX); R.goAt = now + 2000 + 5000 + R.hold;
        R.who = {}; for (const id of R.grid) { const p = room.players.get(id); R.who[id] = { name: p.name, color: p.color, uid: p.account && p.account.name ? p.account.id : null }; }   // (for the results, even if they leave; uid: signed in, for Race Points)
        R.finish = new Map(); R.lap = new Map(); R.lapAt = new Map(); R.tr = new Map(); R.flagged = new Set(); R.firstAt = 0; R.results = [];
        raceSet(room, 'grid', R.goAt);
      }
    } else if (R.st === 'grid') { if (now >= R.goAt) raceSet(room, 'racing', R.goAt + RACE_LIMIT_MS); }
    else if (R.st === 'racing') {
      const still = R.grid.filter(id => room.players.has(id));
      const allDone = still.every(id => R.finish.has(id));
      if (!still.length || allDone || (R.firstAt && now > R.firstAt + RACE_AFTER_WINNER_MS) || now > R.endsAt) {
        const fin = [...R.finish.entries()].sort((a, b) => a[1].ms - b[1].ms).map(([id, f]) => ({ id, name: f.name, color: f.color, ms: f.ms, pen: f.pen || 0 }));
        const dnf = R.grid.filter(id => !R.finish.has(id)).map(id => { const w = R.who[id] || { name: 'Driver', color: '#888' }; return { id, name: w.name, color: w.color, dnf: true, laps: R.lap.get(id) || 0 }; })
          .sort((a, b) => b.laps - a.laps);
        R.results = fin.concat(dnf);
        // saved for signed-in drivers (the races leaderboard: fastest finish on each track)
        try {
          const n = R.grid.length, rows = [];
          R.results.forEach((e, i) => { const w = R.who[e.id]; if (w && w.uid && !DB.isBanned(w.uid)) rows.push({ uid: w.uid, pos: e.dnf ? null : i + 1, ms: e.ms }); });          if (n >= Tracks.RACE_MIN && rows.length) DB.addRace(R.track, n, rows);
        } catch (e) { console.log('race results error:', e.message); }
        raceSet(room, 'results', now + RACE_RESULTS_MS);
      }
    } else if (R.st === 'results') { if (now >= R.endsAt) { R.grid = []; raceSet(room, 'lobby'); } }
  }
}
setInterval(raceTick, 250);
// the queue for a track: a public lobby that hasn't started yet (the fullest one), or a new one
function queueRoom(track) {
  let best = null;
  for (const r of rooms.values()) {
    if (!r.race || !r.race.queue || r.race.track !== track || r.players.size >= Tracks.RACE_MAX) continue;
    if (r.race.st !== 'lobby' && r.race.st !== 'countdown') continue;
    if (!best || r.players.size > best.players.size) best = r;
  }
  if (best) return best;
  const id = 'rq-' + track + '-' + (nextRace++).toString(36), [theme, tod] = Tracks.TRACK_BY_ID[track].look || ['grass', 'day'];
  const room = makeRoom(id, Tracks.TRACK_BY_ID[track].name, false, '', false, 0, { theme, tod, race: { track, queue: true } });
  rooms.set(id, room);
  return room;
}
let nextRace = 1;
// how many are queueing / racing on each track (the queue's rooms), and the public races players are hosting
function raceList() {
  const tracks = Tracks.TRACKS.map(t => ({ id: t.id, queue: 0, racing: 0 }));
  const byId = Object.fromEntries(tracks.map(t => [t.id, t])), list = [];
  for (const r of rooms.values()) {
    if (!r.race || !r.players.size) continue;
    const t = byId[r.race.track];
    if (r.race.queue && t) { if (r.race.st === 'lobby' || r.race.st === 'countdown') t.queue += r.players.size; else t.racing += r.players.size; }
    else if (r.listed) list.push(Object.assign(roomInfo(r), { code: r.code }));
  }
  return { tracks, rooms: list.sort((a, b) => b.players - a.players).slice(0, 30) };
}

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
  if (p.veh === 'bike') R.bike = true;                 // (on the motorcycle at any point: the run is just for fun)
  const prev = R.last; R.last = { s: st.s, t: st.t };
  if (!prev) return;
  const dt = st.t - prev.t;                            // (sender's clock)
  if (!(dt > 0 && dt < 5)) return;
  const T = p.room.traffic, ds = Math.abs(T ? T.wd(T.w(st.s), T.w(prev.s)) : st.s - prev.s);
  // jumped (back to the lot, restart): not driving. Anything a car could actually cover in that time counts,
  // so a lag spike (a second or two without updates at top speed) doesn't lose distance
  if (ds > dt * 95 + 30) return;
  // (distance, not speed: a slow computer's game clock runs behind real time, so speeds worked out from
  // the update times would come out too low)
  R.dist += ds;
  // near another player = the same test the game uses for the proximity bonus (js/main.js proximity(): the gap
  // between the two cars' bodies within 25 m, anywhere across the road), with a little room for lag
  const len = p.ext.front - p.ext.rear;
  for (const o of p.room.players.values()) {
    if (o === p || !o.st || o.veh === 'bike') continue;   // (riding near a motorcycle earns nothing: it's just for fun)
    const ds2 =Math.abs(T ? T.wd(T.w(o.st.s), T.w(st.s)) : o.st.s - st.s);
    if (ds2 > 48) continue;
    const gap = Math.hypot(Math.max(0, ds2 - len), Math.max(0, Math.abs(o.st.d - st.d) - 2 * p.ext.hw));
    if (gap < 30) { R.nearS += dt; break; }
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
    w: Array.isArray(st.w) ? st.w.slice(0, 8).filter(e => Array.isArray(e) && Number.isInteger(e[0]) && e.slice(1, 4).every(Number.isFinite))
      .map(e => [e[0], num(e[1], -1e9, 1e9), num(e[2], -60, 60), num(e[3], -7, 7), num(e[4], -60, 90), num(e[5], -15, 15), num(e[6], -8, 8)]) : undefined,
  };
}

// acct: signed in (their name is their account's, so it can open their profile; a guest's name could be anyone's)
function roster(room) { return [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, title: p.title || null, acct: !!(p.account && p.account.name), veh: p.veh === 'bike' || p.veh === 'van' ? p.veh : undefined, model: p.model && p.model !== 'm4' ? p.model : undefined })); }
// which car a player drives (Garage): looks only, every car has the same hitbox
const CAR_MODELS = ['m4'];
const cleanModel = m => (CAR_MODELS.includes(m) || /^f1:[a-z]{2,10}:#[0-9a-f]{6}(:[a-z]{2,8}:#[0-9a-f]{6})?(:[smh][01][lsh]?)?$/.test(m) ? m : 'm4');   // (racing: 'f1:<pattern>:<colour 2>[:<rim style>:<rim colour>][:<tyre s|m|h><rear wing 1|0><front wing l|s|h>]', the F1 paint pattern, rims, parts)
// the motorcycle and the van: only for the accounts in DB.BIKE_NAMES (anyone else asking for them stays a car;
// the van drives and scores as a car, other players just see the van)
const mayBike = p => !!(p.account && p.account.name && DB.BIKE_NAMES.includes(p.account.name.toLowerCase()));
function cleanExt(p, e) {
  if (!e || typeof e !== 'object') return;
  // (a car can't claim to be motorcycle-sized: that would shrink its proximity / traffic gaps)
  p.ext = { front: num(e.front, 1, 4), rear: num(e.rear, -4, -1), hw: num(e.hw, p.veh === 'bike' ? 0.35 : 0.85, 1.3) };
}
function send(ws, m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }
function broadcast(room, m, except) { const s = JSON.stringify(m); for (const p of room.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); }
// a player's position to everyone else in the room: binary for today's game, JSON for a page loaded before
// the update (each version is made once, however many players get it)
function relayState(room, p, st) {
  let bin = null, txt = null;
  for (const q of room.players.values()) {
    if (q === p || q.ws.readyState !== 1) continue;
    if (q.bin) q.ws.send(bin || (bin = NetCodec.encodeRelay(p.id, st)));
    else q.ws.send(txt || (txt = JSON.stringify({ t: 'st', id: p.id, st })));
  }
}
// The wrecks a player's game is simulating (cars they hit) come with their position: the shared traffic
// puts each wreck where they say. Only the first player to hit a car moves it; anyone else is told so
// once (their game then leaves that car to the owner instead of reporting it too).
function claimWrecks(p, list) {
  const T = p.room && p.room.traffic; if (!T || !p.agent || !list) return;
  for (const [id, s, d, ry] of list) {
    const c = T.byId.get(id); if (!c) continue;
    if (T.claim(c, p.agent, s, num(d, -30, 30), num(ry, -7, 7))) { if (p.denied) p.denied.delete(id); continue; }
    p.denied = p.denied || new Set();
    if (!p.denied.has(id)) { p.denied.add(id); send(p.ws, { t: 'wreckOwner', id }); if (p.denied.size > 200) p.denied.clear(); }
  }
}

function joinRoom(p, room) {
  leaveRoom(p);
  if (room.players.size >= maxOf(room)) { send(p.ws, { t: 'error', msg: `${room.name} is full (${maxOf(room)} players).` }); return; }
  // parking space: the lowest one nobody in the room is using
  const used = new Set([...room.players.values()].map(o => o.slot));
  let slot = 0; while (used.has(slot)) slot++;
  room.players.set(p.id, p); p.room = room; p.st = null; p.agent = null; p.slot = slot;
  p.best = room.bests.get(p.name) || 0;                 // best score on this server comes back if you rejoin
  if (!room.traffic && !room.race) room.traffic = new RingTraffic();   // (race tracks have no traffic)
  p.title = titleOf(p);
  send(p.ws, { t: 'joined', id: p.id, room: room.id, name: room.name, official: room.official, listed: room.listed, code: room.code, slot, best: p.best,
    scored: room.scored, density: room.density, theme: room.theme, tod: room.tod, bin: !!p.bin,   // (bin: binary positions understood)
    race: room.race ? { track: room.race.track, laps: room.race.laps, queue: room.race.queue } : undefined });
  if (room.race) send(p.ws, raceMsg(room));            // (where the race is at: lobby / countdown / racing...)
  issueMpToken(p);                                     // (scored server + signed in: runs can go on the leaderboard)
  broadcast(room, { t: 'roster', list: roster(room) });
  broadcast(room, { t: 'chat', sys: 'join', name: p.name, title: p.title || null });   // "Name (Title) joined the server"
  if (p.account) presenceChanged(p.account.id);        // (friends see which server)
}
function leaveRoom(p) {
  const room = p.room; if (!room) return;
  if (p.run) p.run.closed = true;                      // (a run in progress can still be submitted)
  room.players.delete(p.id); p.room = null; p.agent = null;
  if (room.players.size) {
    broadcast(room, { t: 'roster', list: roster(room) });
    broadcast(room, { t: 'chat', sys: 'leave', name: p.name, title: p.title || null });
  }
  else {
    room.emptySince = Date.now(); room.traffic = null;  // nobody left: drop the traffic
    if (room.race && room.race.queue) rooms.delete(room.id);   // (an empty queue lobby just closes)
    else if (room.race) { room.race.st = 'lobby'; room.race.grid = []; }
  }
  if (p.account) presenceChanged(p.account.id);
}

// ---------------------------------------------------------------- HTTP + WebSocket
let simMs = 0;   // average time one traffic step takes (shown in /api/servers as "load")
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/servers')) {
    const all = [...rooms.values()];
    const official = all.filter(r => r.official).map(roomInfo);
    const pub = all.filter(r => !r.official && !r.race && r.listed && r.players.size).map(roomInfo)   // (players' public servers while someone's on them)
      .sort((a, b) => b.players - a.players).slice(0, 50);
    let online = 0; for (const r of rooms.values()) online += r.players.size;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ official, public: pub, servers: official, online, load: +(simMs / (SIM_DT * 1000)).toFixed(3) }));
    return;
  }
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const url = new URL(req.url, 'http://x'), route = url.pathname;
  // racing: who's queueing / racing on each track + public hosted races
  if (route === '/api/race') {
    let online = 0; for (const r of rooms.values()) online += r.players.size;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(Object.assign(raceList(), { online })));
    return;
  }
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
        if (isNew && DB.alphaOpen()) DB.gift(user.id, 'alpha');   // (Alpha Tester: switched off since the beta)
        if (isNew && DB.betaOpen()) DB.gift(user.id, 'beta');     // (new players get Beta Tester until it's switched off)
        DB.gift(user.id, 'verified');                           // (signed in with Google; only sent once)
        json(200, Object.assign({ session: token, name: user.name, title: DB.equipped(user.id), banned: DB.isBanned(user.id), banUntil: DB.banUntil(user.id) }, isAdmin(user) ? { admin: true } : {}));
      })
        .catch(e => json(401, { error: e.message }));
    });
    return;
  }
  const bearer = () => Accounts.bySession(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  if (route === '/api/account') {                       // who am I? (Authorization: Bearer <session>)
    const u = bearer();
    json(u ? 200 : 401, u ? Object.assign({ name: u.name, title: DB.equipped(u.id), banned: DB.isBanned(u.id), banUntil: DB.banUntil(u.id) }, isAdmin(u) ? { admin: true } : {}) : { error: 'not signed in' });   // (banned: leaderboard banned - the launch popup tells them; banUntil: when a temporary ban ends)
    return;
  }
  // owner tools: the video recorder (tools/recorder.js) is only handed to the owners' accounts (Bearer).
  // Everyone else gets a plain 404, as if it didn't exist; tools/ is never served as a static folder.
  if (route === '/api/tools/recorder') {
    const u = bearer();
    if (!u || !u.name || !DB.OWNER_NAMES.includes(u.name.toLowerCase())) { res.writeHead(404); res.end('Not found'); return; }
    fs.readFile(path.join(ROOT, 'tools', 'recorder.js'), (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }
  // ---- ADMIN (the PolyWeave account only - checked here on every request against its locked Google id, db.js
  // adminUid; anyone else gets a plain 404 as if none of this existed). The panel's code (admin/panel.js, never served
  // as a static file) is only handed to the admin. Every change is written to the admin log.
  if (route === '/api/tools/admin' || route.startsWith('/api/admin/')) {
    const u = bearer();
    if (!isAdmin(u)) { res.writeHead(404); res.end('Not found'); return; }
    if (route === '/api/tools/admin') {
      fs.readFile(path.join(ROOT, 'admin', 'panel.js'), (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }); res.end(data);
      });
      return;
    }
    try { adminApi(route, url, req, json, body); } catch (e) { console.log('admin error:', e.message); json(500, { error: e.message }); }
    return;
  }
  // profiles: GET /api/profile?name=<driver> (anyone's), GET /api/profile (Bearer: your own, with your titles)
  if (route === '/api/profile') {
    const qn = url.searchParams.get('name');
    const u = qn ? Accounts.byName(qn) : bearer();
    if (!u || !u.name) { json(qn ? 404 : 401, { error: qn ? 'No driver with that name.' : 'Sign in to see your profile.' }); return; }
    // leaderboard banned: the profile still opens, marked banned, with no stats (shown as N/A)
    const banned = DB.isBanned(u.id);
    // (it still shows the date joined and time played; banUntil: when a temporary ban ends)
    const pr = banned ? { name: u.name, joined: u.created || null, banned: true, banUntil: DB.banUntil(u.id), title: DB.equipped(u.id), playS: DB.profile(u.id).playS } : Object.assign({ name: u.name, joined: u.created || null }, DB.profile(u.id));
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
  // ---- achievements: GET /api/achievements (Bearer) -> your stats + which title rewards you own / have waiting
  if (route === '/api/achievements') {
    const u = bearer(); if (!u) { json(401, { error: 'Sign in to see your achievements.' }); return; }
    json(200, { stats: DB.statsOf(u.id), owned: DB.titlesOf(u.id), pending: DB.pendingOf(u.id) });
    return;
  }
  // ---- inbox: GET /api/inbox (Bearer) -> items; POST /api/inbox/claim {session, id}
  if (route === '/api/inbox') {
    const u = bearer(); if (!u) { json(401, { error: 'Sign in to see your inbox.' }); return; }
    json(200, { items: DB.inboxOf(u.id).map(r => ({ id: r.id, kind: r.kind, item: r.item, t: r.t, claimed: !!r.claimed, note: r.note || null })) });
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
  //              ?season=0 (the beta) / 1 (Season 1, the current one: the default)
  //              GET /api/laps?track=<id>[&me=1] -> racing: best time-trial laps on a track (this season)
  //              GET /api/races?track=<id>[&me=1] -> racing: fastest 3-lap race finish on a track
  const lbRow = e => ({ rank: e.rank, name: Accounts.nameOf(e.uid) || 'Driver', title: e.title || null, score: e.score, t: e.t, dur: e.dur || 0, server: e.server });
  if (route === '/api/leaderboard' || route === '/api/leaderboard/me') {
    const mode = url.searchParams.get('mode') === 'mp' ? 'mp' : 'sp', sq = url.searchParams.get('season');
    const season = sq !== null && DB.SEASONS.includes(+sq) ? +sq : DB.SEASON;
    try {
      if (route === '/api/leaderboard') { json(200, { mode, season, current: DB.SEASON, persistent: true, accounts: Accounts.enabled(), list: DB.top(mode, 100, season).map(lbRow) }); return; }
      const u = bearer(); if (!u) { json(401, { error: 'Sign in to see your position.' }); return; }
      const a = DB.around(mode, u.id, 10, season);
      json(200, { mode, season, current: DB.SEASON, rank: a.rank, total: a.total, list: a.list.map(lbRow) });
    } catch (e) { console.log('leaderboard error:', e.message); json(500, { error: 'leaderboard unavailable' }); }
    return;
  }
  if (route === '/api/laps') {
    const track = Tracks.TRACK_BY_ID[url.searchParams.get('track')] ? url.searchParams.get('track') : Tracks.TRACKS[0].id, sq = url.searchParams.get('season');
    const season = sq !== null && DB.SEASONS.includes(+sq) ? +sq : DB.SEASON;
    const row = e => ({ rank: e.rank, name: Accounts.nameOf(e.uid) || 'Driver', title: e.title || null, ms: e.ms, t: e.t });
    try {
      if (!url.searchParams.get('me')) { json(200, { track, season, accounts: Accounts.enabled(), list: DB.lapTop(track, 100, season).map(row) }); return; }
      const u = bearer(); if (!u) { json(401, { error: 'Sign in to see your position.' }); return; }
      const a = DB.lapAround(track, u.id, 10, season);
      json(200, { track, season, rank: a.rank, total: a.total, list: a.list.map(row) });
    } catch (e) { console.log('laps error:', e.message); json(500, { error: 'leaderboard unavailable' }); }
    return;
  }
  // GET /api/races?track=<id>[&me=1] -> racing: fastest finish of each driver in a race on a track (this season)
  if (route === '/api/races') {
    const track = Tracks.TRACK_BY_ID[url.searchParams.get('track')] ? url.searchParams.get('track') : Tracks.TRACKS[0].id;
    const row = e => ({ rank: e.rank, name: Accounts.nameOf(e.uid) || 'Driver', title: e.title || null, ms: e.ms, t: e.t });
    try {
      if (!url.searchParams.get('me')) { json(200, { track, accounts: Accounts.enabled(), list: DB.raceTop(track, 100).map(row) }); return; }
      const u = bearer(); if (!u) { json(401, { error: 'Sign in to see your position.' }); return; }
      const a = DB.raceAround(track, u.id, 10);
      json(200, { track, rank: a.rank, total: a.total, list: a.list.map(row) });
    } catch (e) { console.log('races error:', e.message); json(500, { error: 'leaderboard unavailable' }); }
    return;
  }
  // racing time trial: POST /api/lap/start {session, track} -> {token} when a lap starts; POST /api/lap {session, token, track, ms}
  // A lap counts if its token was issued at least as long ago as the lap took (with a little slack for the trip
  // here) and it's not quicker than the whole lap at top speed (Tracks.minLapMs).
  if (route === '/api/lap/start' && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session);
      if (!u || !u.name) { json(401, { error: 'Sign in to get on the leaderboard.' }); return; }
      if (DB.isBanned(u.id) || !Tracks.TRACK_BY_ID[m.track]) { json(403, { error: 'no' }); return; }
      if (tooFast('lapstart:' + u.id, 400)) { json(429, { error: 'too fast' }); return; }
      json(200, { token: Tokens.issue({ u: u.id, m: 'lap', k: m.track }) });
    });
    return;
  }
  // time trial marks: POST /api/lap/sector {session, token, track, k} when the lights go out (k 0), at a third
  // (k 1) and two thirds (k 2) of the lap -> a new token carrying the server's own time of each mark, which is
  // checked against the lap's splits when it's submitted.
  if (route === '/api/lap/sector' && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session), tok = Tokens.read(m.token), k = Math.floor(Number(m.k));
      if (!u || !tok || tok.u !== u.id || tok.m !== 'lap' || tok.k !== m.track || !(k >= 0 && k <= 2) || (tok.s || []).length !== k) { json(400, { error: 'Bad lap token.' }); return; }
      if (tooFast('lapsec:' + u.id, 300)) { json(429, { error: 'too fast' }); return; }
      json(200, { token: Tokens.issue({ u: u.id, m: 'lap', k: m.track, t0: tok.t0 || tok.t, s: (tok.s || []).concat(Date.now()) }) });
    });
    return;
  }
  // A lap counts only if (time checks, anti-cheat):
  //  - it isn't quicker than the whole lap at top speed (Tracks.minLapMs), nor any third of it
  //  - the server's own clock at lights out, the two sector marks and the finish agrees with the lap's splits,
  //    each third and the whole lap (within 2 s: a game running in slow motion or a made-up time won't match)
  if (route === '/api/lap' && req.method === 'POST') {
    body(m => {
      const u = Accounts.bySession(m.session);
      if (!u || !u.name) { json(401, { error: 'Sign in to get on the leaderboard.' }); return; }
      if (DB.isBanned(u.id)) { json(403, { error: 'This account is banned from the leaderboards.' }); return; }
      const tok = Tokens.read(m.token), ms = Math.round(Number(m.ms)), now = Date.now();
      if (!tok || tok.u !== u.id || tok.m !== 'lap' || tok.k !== m.track || !Tracks.TRACK_BY_ID[m.track]) { json(400, { error: 'Bad lap token.' }); return; }
      const t0 = tok.t0 || tok.t;
      if (now - t0 > 3 * 3600e3) { json(400, { error: 'Lap token expired.' }); return; }
      const min = Tracks.minLapMs(Tracks.trackLength(m.track)), pen = Number(m.pen) === 5 ? 5000 : 0, raw = ms - pen;   // (raw: driven, without the jump-start +5 s)
      const sp = Array.isArray(m.splits) ? m.splits.map(Number) : [], S = tok.s || [], SLACK = 2000;
      const off = (game, server) => Math.abs(game - server) > SLACK;
      const why = !(ms >= min && ms < 30 * 60e3) ? 'faster than flat out'
        : S.length !== 3 || sp.length !== 2 || !sp.every(Number.isFinite) ? 'no sector times'
        : !(sp[0] >= min / 3 && sp[1] - sp[0] >= min / 3 && raw - sp[1] >= min / 3) ? 'a sector too fast'
        : off(sp[0], S[1] - S[0]) ? `sector 1 ${sp[0]} ms, server saw ${S[1] - S[0]} ms`
        : off(sp[1] - sp[0], S[2] - S[1]) ? `sector 2 ${sp[1] - sp[0]} ms, server saw ${S[2] - S[1]} ms`
        : off(raw - sp[1], now - S[2]) ? `sector 3 ${raw - sp[1]} ms, server saw ${now - S[2]} ms`
        : off(raw, now - S[0]) ? `lap ${raw} ms, server saw ${now - S[0]} ms` : null;
      if (why) {                                         // (recorded once per lap token: admin panel + the auto-ban count)
        console.log(`lap rejected: ${u.name} ${m.track} ${ms} ms: ${why}`);
        if (DB.spendToken(tok.n)) DB.flagRacing(u.id, 'lap', `lap ${m.track}: ${why}`, ms);
        json(200, { rank: null, rejected: why }); return;
      }
      if (!DB.spendToken(tok.n)) { json(409, { error: 'That lap was already submitted.' }); return; }
      json(200, DB.addLap(u.id, m.track, ms));
    });
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
      // motorcycle runs are just for fun: no leaderboard, no run record, no stats (the game doesn't send them;
      // a multiplayer run is also checked against what the server saw)
      if (m.veh === 'bike' || (R && R.bike)) { if (R) R.closed = true; json(200, { rank: null, fun: true }); return; }
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
  ws.on('message', (raw, isBinary) => {
    if (++p.msgs > 80) return;                          // flood guard (reset every second)
    let m;
    if (isBinary) { m = NetCodec.decode(raw); if (!m || m.t !== 'state') return; }   // (only positions come as binary)
    else { try { m = JSON.parse(raw); } catch (e) { return; } }
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
      if (room.race && room.race.tr) raceTrace(room.race, p, st);   // (racing: the server's own record, for the time checks)
      if (!room.race && st.score > p.best && p.veh !== 'bike') { p.best = st.score; room.bests.set(p.name, p.best); }   // (not on the motorcycle; racing: "score" is race progress)
      trackRun(p, st);                                   // (the server's own record of the run, for checking it)
      claimWrecks(p, st.w);                              // (cars they hit: the shared traffic follows their crash)
      st.best = p.best;
      relayState(room, p, st);
      return;
    }
    if (m.t === 'crash') {                               // (a page from before the update reports wrecks one by one)
      const room = p.room; if (!room || !room.traffic) return;
      if (Number.isFinite(m.s) && Number.isFinite(m.d) && Number.isFinite(m.ry)) claimWrecks(p, [[m.id, m.s, m.d, m.ry]]);
      return;
    }
    if (m.t === 'recover' || m.t === 'gone') {           // a wreck got going again / disappeared (only its owner says so)
      const room = p.room; if (!room || !room.traffic) return;
      const c = room.traffic.byId.get(m.id); if (!c || !room.traffic.mayRelease(c, p.agent)) return;
      if (m.t === 'gone') room.traffic.gone(c);
      else if (Number.isFinite(m.s) && Number.isInteger(m.lane) && m.lane >= 0 && m.lane < 4) room.traffic.recover(c, m.s, m.lane, num(m.v, 0, 40));
      return;
    }
    if (m.t === 'runtoken') { issueMpToken(p); return; }
    // switched between car and motorcycle while on a server: everyone's roster shows the new one
    if (m.t === 'veh') {
      p.veh = (m.veh === 'bike' || m.veh === 'van') && mayBike(p) ? m.veh : 'car';
      if (m.model !== undefined) p.model = cleanModel(m.model);
      cleanExt(p, m.ext);
      if (p.room) broadcast(p.room, { t: 'roster', list: roster(p.room) });
      return;
    }   // a streak ended: a fresh token for the next run
    // racing: a lap done / the finish (finishing times are measured here, from the start)
    if (m.t === 'rlap' || m.t === 'rfin') {
      const room = p.room, R = room && room.race;
      if (!R || R.st !== 'racing' || !R.grid.includes(p.id)) return;
      const now = Date.now(), L = Tracks.trackLength(R.track), minLap = RACE_TEST ? 0 : Tracks.minLapMs(L);
      const lastAt = R.lapAt.get(p.id) || R.goAt, done = R.lap.get(p.id) || 0;
      if (m.t === 'rlap') {                              // (in order, and not quicker than a flat-out lap)
        const n = Math.floor(num(m.lap, 0, 99));
        if (n === done + 1 && now - lastAt >= minLap) { R.lap.set(p.id, n); R.lapAt.set(p.id, now); }
        else if (n > done) {
          console.log(`race check: ${p.name} ${R.track}: lap ${n} refused (had ${done}, ${now - lastAt} ms, min ${minLap})`);
          if (n === done + 1) raceFlag(R, p, `race ${R.track}: lap quicker than flat out (${now - lastAt} ms, min ${minLap})`);
        }
        return;
      }
      if (R.finish.has(p.id)) return;
      const ms = now - R.goAt, T = R.tr.get(p.id);
      if (done < R.laps - 1 || now - lastAt < minLap || ms < minLap * R.laps) return;   // (skipped laps / too quick to be real)
      if (!RACE_TEST && (!T || T.bad || T.maxS < R.laps * L - 300)) {                 // (didn't really drive the distance)
        console.log(`race check: ${p.name} ${R.track}: finish refused (${T ? T.bad || 'covered ' + Math.round(T.maxS) + ' of ' + Math.round(R.laps * L) + ' m' : 'no position reports'})`);
        raceFlag(R, p, `race ${R.track}: ` + (T && T.bad ? 'race: ' + T.bad : `finish refused, ${T ? 'covered ' + Math.round(T.maxS) + ' of ' + Math.round(R.laps * L) + ' m' : 'no position reports'}`), ms);
        return;
      }
      const pen = Math.round(num(m.pen, 0, 300));          // (penalty seconds the game handed out: jump start, track limits, collisions)
      R.finish.set(p.id, { ms: ms + pen * 1000, pen, name: p.name, color: p.color });
      R.lap.set(p.id, R.laps);
      if (!R.firstAt) R.firstAt = Date.now();
      broadcast(room, { t: 'rfinish', id: p.id, name: p.name, pos: R.finish.size, ms });
      return;
    }
    // server chat: "Name (Title): message" to everyone on the server, at most one message per 3 s per player
    if (m.t === 'chat') {
      const room = p.room; if (!room) return;
      const text = cleanText(m.text).slice(0, 120); if (!text) return;
      const now = Date.now(), wait = (p.chatT || 0) + CHAT_GAP - now;
      if (wait > 0) { send(ws, { t: 'chatwait', ms: wait }); return; }
      p.chatT = now;
      broadcast(room, { t: 'chat', id: p.id, name: p.name, title: p.title || null, text });
      return;
    }
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
    if (m.bin !== undefined) p.bin = m.bin === 1;      // (this game reads the binary snapshots / positions)
    if (m.veh !== undefined) p.veh = (m.veh === 'bike' || m.veh === 'van') && mayBike(p) ? m.veh : 'car';
    if (m.model !== undefined) p.model = cleanModel(m.model);
    cleanExt(p, m.ext);
    if (m.t === 'join') {
      const id = String(m.room || '');
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const room = code ? rooms.get('p-' + code.slice(0, 3) + '-' + code.slice(3)) : rooms.get(id);
      if (!room) send(ws, { t: 'error', msg: code ? `No server with code ${code.slice(0, 3)}-${code.slice(3)}. Check the code.` : 'That server no longer exists.' });
      else joinRoom(p, room);
    } else if (m.t === 'raceq') {                       // racing: queue for a track (its public lobby)
      if (!Tracks.TRACK_BY_ID[m.track]) return;
      joinRoom(p, queueRoom(m.track));
    } else if (m.t === 'racehost') {                    // racing: host a public / private race on a track
      if (!Tracks.TRACK_BY_ID[m.track]) return;
      const code = newCode();
      const roomName = String(m.roomName || '').replace(/[^\p{L}\p{N} _.'!\-]/gu, '').trim().slice(0, 24) || `${p.name}'s race`;
      const room = makeRoom('p-' + code, roomName, false, code, false, 0,
        { listed: !!m.listed, theme: THEMES.includes(m.theme) ? m.theme : 'grass', tod: TODS.includes(m.tod) ? m.tod : 'day', race: { track: m.track } });
      rooms.set(room.id, room);
      joinRoom(p, room);
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
    for (const p of room.players.values()) {
      if (!p.agent || p.ws.readyState !== 1) continue;
      const snap = T.snapshot(p.agent, now);
      p.ws.send(p.bin ? NetCodec.encodeTraffic(snap) : JSON.stringify(snap));
    }
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
