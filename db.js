'use strict';
// =====================================================================
//  PolyWeave database (SQLite, built into Node 22: no extra packages). File: polyweave.db
//  - runs: EVERY scored run (verified, rejected and imported ones), with its details. A player's
//    leaderboard entry is their best run per mode and season.
//  - users: equipped title, banned flag, time played, friend settings (names stay in accounts.json).
//  - user_titles: titles each player has claimed. inbox: things waiting to be claimed (titles).
//  - friends / friend_requests / messages: the friends list and chats.
//  - used_tokens: run tokens already spent (a run can only be submitted once).
//  First start: imports leaderboard.json + accounts.json. Titles (v2): every title is wiped once and sent
//  again through the inbox: Alpha Tester to every existing account, Owner to CurryEater and PolyWeave, and
//  any money titles players' runs have earned. New accounts get Alpha Tester too while alpha_open is on.
// =====================================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const Titles = require('./js/titles');

const FILE = process.env.PW_DB || path.join(__dirname, 'polyweave.db');
const SEASON = 0;                 // 0 = pre-season (beta). Seasons come later.
const MODES = ['sp', 'mp'];
const OWNER_NAMES = ['curryeater', 'polyweave'];   // get the Owner title (account names, any upper / lower case)

const db = new DatabaseSync(FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY, title TEXT, banned INTEGER NOT NULL DEFAULT 0, play_s REAL NOT NULL DEFAULT 0, created INTEGER);
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, mode TEXT NOT NULL, score REAL NOT NULL, dur REAL,
    near INTEGER, top_kmh INTEGER, peak REAL, server TEXT, season INTEGER NOT NULL, t INTEGER NOT NULL,
    verified INTEGER NOT NULL,            -- 1 = passed the checks, 0 = imported from before checks existed, -1 = rejected
    removed INTEGER NOT NULL DEFAULT 0,   -- 1 = doesn't count (rejected, or removed by an admin)
    note TEXT, log BLOB);
  CREATE INDEX IF NOT EXISTS runs_board ON runs (mode, season, removed, uid, score);
  CREATE INDEX IF NOT EXISTS runs_uid ON runs (uid, t);
  CREATE TABLE IF NOT EXISTS user_titles (uid TEXT NOT NULL, title TEXT NOT NULL, t INTEGER, PRIMARY KEY (uid, title));
  CREATE TABLE IF NOT EXISTS used_tokens (n TEXT PRIMARY KEY, t INTEGER);
  CREATE TABLE IF NOT EXISTS inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, kind TEXT NOT NULL, item TEXT NOT NULL, t INTEGER NOT NULL, claimed INTEGER);
  CREATE INDEX IF NOT EXISTS inbox_uid ON inbox (uid, claimed);
  CREATE TABLE IF NOT EXISTS friends (uid TEXT NOT NULL, fid TEXT NOT NULL, t INTEGER, PRIMARY KEY (uid, fid));
  CREATE TABLE IF NOT EXISTS friend_requests (from_uid TEXT NOT NULL, to_uid TEXT NOT NULL, t INTEGER, PRIMARY KEY (from_uid, to_uid));
  CREATE INDEX IF NOT EXISTS freq_to ON friend_requests (to_uid);
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, from_uid TEXT NOT NULL, to_uid TEXT NOT NULL, body TEXT NOT NULL, t INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS msg_pair ON messages (from_uid, to_uid, t);
  CREATE INDEX IF NOT EXISTS msg_unread ON messages (to_uid, read);
`);

// newer columns (added to databases made before them)
{
  const have = new Set(db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
  for (const [col, def] of [['best_rank_sp', 'INTEGER'], ['best_rank_mp', 'INTEGER'],
    ['allow_requests', 'INTEGER NOT NULL DEFAULT 1'], ['hide_activity', 'INTEGER NOT NULL DEFAULT 0']]) if (!have.has(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
  const haveR = new Set(db.prepare('PRAGMA table_info(runs)').all().map(c => c.name));
  if (!haveR.has('dist')) db.exec('ALTER TABLE runs ADD COLUMN dist REAL');
  if (!haveR.has('room')) db.exec('ALTER TABLE runs ADD COLUMN room TEXT');   // (multiplayer: which server, for team runs)
}

const getMeta = k => { const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k); return r ? r.v : null; };
const setMeta = (k, v) => db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));

// secret for signing run tokens (made once, kept in the database)
let SECRET = getMeta('run_secret');
if (!SECRET) { SECRET = crypto.randomBytes(32).toString('hex'); setMeta('run_secret', SECRET); }

const ensureUser = uid => db.prepare('INSERT OR IGNORE INTO users (uid, created) VALUES (?, ?)').run(uid, Date.now());
const grant = (uid, title) => { ensureUser(uid); return db.prepare('INSERT OR IGNORE INTO user_titles (uid, title, t) VALUES (?, ?, ?)').run(uid, title, Date.now()).changes > 0; };
const readAccounts = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'accounts.json'), 'utf8')).users || {}; } catch (e) { return {}; } };

// ---------------------------------------------------------------- inbox (titles to claim)
const owns = (uid, title) => !!db.prepare('SELECT 1 FROM user_titles WHERE uid = ? AND title = ?').get(uid, title);
const pending = (uid, title) => !!db.prepare("SELECT 1 FROM inbox WHERE uid = ? AND kind = 'title' AND item = ? AND claimed IS NULL").get(uid, title);
// send a title to someone's inbox (not if they have it or it's already waiting); returns true if sent
function gift(uid, title) {
  if (!Titles.TITLE_BY_ID[title] || owns(uid, title) || pending(uid, title)) return false;
  ensureUser(uid);
  db.prepare("INSERT INTO inbox (uid, kind, item, t) VALUES (?, 'title', ?, ?)").run(uid, title, Date.now());
  return true;
}
const inboxOf = uid => db.prepare('SELECT id, kind, item, t, claimed FROM inbox WHERE uid = ? ORDER BY claimed IS NOT NULL, t DESC LIMIT 60').all(uid)
  .filter(r => r.kind !== 'title' || Titles.TITLE_BY_ID[r.item]);
const unclaimed = uid => db.prepare('SELECT COUNT(*) AS n FROM inbox WHERE uid = ? AND claimed IS NULL').get(uid).n;
// claim one: the title becomes theirs. Returns the item, or null
function claim(uid, id) {
  const r = db.prepare('SELECT * FROM inbox WHERE id = ? AND uid = ? AND claimed IS NULL').get(id, uid);
  if (!r) return null;
  db.prepare('UPDATE inbox SET claimed = ? WHERE id = ?').run(Date.now(), id);
  if (r.kind === 'title') grant(uid, r.item);
  return { kind: r.kind, item: r.item };
}

// ---------------------------------------------------------------- first start: import the old files
function importOld() {
  if (getMeta('imported')) return;
  const accounts = readAccounts();
  let lb = {};
  try { lb = JSON.parse(fs.readFileSync(path.join(__dirname, 'leaderboard.json'), 'utf8')); } catch (e) { /* none */ }
  let users = 0, runs = 0;
  db.exec('BEGIN');
  try {
    for (const u of Object.values(accounts)) {
      if (!u || !u.id) continue;
      db.prepare('INSERT OR IGNORE INTO users (uid, created) VALUES (?, ?)').run(u.id, u.created || Date.now());
      users++;
    }
    const ins = db.prepare(`INSERT INTO runs (uid, mode, score, dur, server, season, t, verified, note) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'imported')`);
    for (const m of MODES) for (const e of Array.isArray(lb[m]) ? lb[m] : []) {
      if (!e || !e.uid || !Number.isFinite(e.score)) continue;
      ensureUser(e.uid);
      ins.run(e.uid, m, Math.round(e.score), e.dur || 0, e.server || null, SEASON, e.t || Date.now());
      runs++;
    }
    setMeta('imported', Date.now());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log(`database: imported ${users} accounts and ${runs} leaderboard runs`);
}
importOld();

// ---------------------------------------------------------------- titles v2 (once): wipe every title, send them again to inboxes
function titlesV2() {
  if (getMeta('titles_v2')) return;
  const accounts = Object.values(readAccounts()).filter(u => u && u.id);
  const owners = accounts.filter(u => u.name && OWNER_NAMES.includes(u.name.toLowerCase()));
  let n = 0;
  db.exec('BEGIN');
  try {
    db.exec("DELETE FROM user_titles; UPDATE users SET title = NULL; DELETE FROM inbox WHERE kind = 'title';");
    for (const u of accounts) if (gift(u.id, 'alpha')) n++;                         // everyone who has played so far
    for (const u of owners) gift(u.id, 'owner');
    // money titles players' runs have already earned
    for (const r of db.prepare('SELECT uid, MAX(score) AS s FROM runs WHERE removed = 0 AND verified >= 0 GROUP BY uid').all())
      for (const id of Titles.titlesForRun(r.s)) gift(r.uid, id);
    setMeta('titles_v2', Date.now());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log(`database: titles reset; Alpha Tester sent to ${n} inboxes${owners.length ? ', Owner sent to ' + owners.map(u => u.name).join(' and ') : ''}`);
}
titlesV2();

// Verified (once): every account that exists gets it (new ones get it at sign-in: server.js)
function verifiedV1() {
  if (getMeta('verified_v1')) return;
  let n = 0;
  for (const u of Object.values(readAccounts())) if (u && u.id && gift(u.id, 'verified')) n++;
  setMeta('verified_v1', Date.now());
  console.log(`database: Verified sent to ${n} inboxes`);
}
verifiedV1();

// Alpha Tester for new accounts too, until it's switched off: node admin.js alpha off
const alphaOpen = () => getMeta('alpha_open') !== '0';
const setAlphaOpen = on => setMeta('alpha_open', on ? '1' : '0');

// Reset titles: wipe every title (and equipped title), then send them all back to inboxes straight away:
// handed-out ones each player had (Owner, Alpha Tester, admin grants...), Verified for every account, Owner for
// OWNER_NAMES, Alpha Tester for every account while it's still being given out, money titles from each
// player's best run, and team titles from past team runs. Runs once with titles v3; again with: node admin.js retitle
function resetTitles() {
  const accounts = Object.values(readAccounts()).filter(u => u && u.id);
  const granted = db.prepare("SELECT uid, title AS t FROM user_titles UNION SELECT uid, item AS t FROM inbox WHERE kind = 'title'").all()
    .filter(r => Titles.TITLE_BY_ID[r.t] && Titles.TITLE_BY_ID[r.t].how === 'grant');
  db.exec('BEGIN');
  try {
    db.exec("DELETE FROM user_titles; UPDATE users SET title = NULL; DELETE FROM inbox WHERE kind = 'title';");
    for (const r of granted) gift(r.uid, r.t);
    for (const u of accounts) {
      gift(u.id, 'verified');
      if (alphaOpen()) gift(u.id, 'alpha');
      if (u.name && OWNER_NAMES.includes(u.name.toLowerCase())) gift(u.id, 'owner');
    }
    for (const r of db.prepare('SELECT uid, MAX(score) AS s FROM runs WHERE removed = 0 AND verified >= 0 GROUP BY uid').all())
      for (const id of Titles.titlesForRun(r.s)) gift(r.uid, id);
    for (const r of db.prepare("SELECT room, t, dur FROM runs WHERE mode = 'mp' AND room IS NOT NULL AND verified = 1 AND removed = 0").all())
      teamRun(r.room, r.t - (r.dur || 0) * 1000, r.t);
    for (const r of db.prepare('SELECT uid FROM users').all()) statTitles(r.uid);   // (near misses, distance, friends, x100)
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  cache.clear();
  const n = db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE kind = 'title' AND claimed IS NULL").get().n;
  console.log(`database: titles reset; ${n} titles sent back to inboxes`);
  return n;
}

// ---------------------------------------------------------------- leaderboards
// best counted run per player (newest-first tie break: the earlier run ranks higher), ranked
const cache = new Map();          // mode -> { t, list }
function board(mode) {
  const c = cache.get(mode);
  if (c && Date.now() - c.t < 3000) return c.list;
  const list = db.prepare(`
    SELECT b.uid, b.score, b.t, b.dur, b.server, u.title,
           ROW_NUMBER() OVER (ORDER BY b.score DESC, b.t ASC) AS rank
    FROM (SELECT uid, MAX(score) AS score, t, dur, server FROM runs
          WHERE mode = ? AND season = ? AND removed = 0 GROUP BY uid) b
    JOIN users u ON u.uid = b.uid
    WHERE u.banned = 0
    ORDER BY rank`).all(mode, SEASON);
  cache.set(mode, { t: Date.now(), list });
  return list;
}
const top = (mode, n = 100) => board(mode).slice(0, n);
// your rank + the k players ahead of you and k behind
function around(mode, uid, k = 10) {
  const list = board(mode), i = list.findIndex(e => e.uid === uid);
  return { total: list.length, rank: i >= 0 ? i + 1 : null, list: i >= 0 ? list.slice(Math.max(0, i - k), i + k + 1) : [] };
}
const rankOf = (mode, uid) => { const i = board(mode).findIndex(e => e.uid === uid); return i >= 0 ? i + 1 : null; };
const bestOf = (mode, uid) => { const r = db.prepare('SELECT MAX(score) AS s FROM runs WHERE uid = ? AND mode = ? AND season = ? AND removed = 0').get(uid, mode, SEASON); return (r && r.s) || 0; };

// ---------------------------------------------------------------- runs
// r: { uid, mode, score, dur, near, topKmh, peak, dist, server, room, verified, note, log }
// returns { rank, best, improved, newTitles, team } (newTitles: titles just sent to their inbox;
// team: { total, players, gifted: { uid: [titles just sent] } } when this run was part of a team run)
function addRun(r) {
  ensureUser(r.uid);
  const ok = r.verified === 1, now = Date.now();
  const before = ok ? bestOf(r.mode, r.uid) : 0;
  const improved = ok && r.score > before;
  // keep the full event log for personal bests and rejected runs (to look into later)
  const log = (improved || !ok) && r.log ? zlib.gzipSync(JSON.stringify(r.log)) : null;
  db.prepare(`INSERT INTO runs (uid, mode, score, dur, near, top_kmh, peak, dist, server, room, season, t, verified, removed, note, log)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(r.uid, r.mode, Math.round(r.score), r.dur || 0, r.near || 0, r.topKmh || 0, r.peak || 1, r.dist || 0, r.server || null, r.room || null, SEASON, now,
      r.verified, ok ? 0 : 1, r.note || null, log);
  if (!ok) return { rank: null, best: before, improved: false, newTitles: [], team: null };
  const newTitles = Titles.titlesForRun(r.score).filter(id => gift(r.uid, id)).concat(statTitles(r.uid));
  cache.delete(r.mode);
  const rank = improved ? rankOf(r.mode, r.uid) : null;
  if (rank) noteRank(r.mode, r.uid, rank);
  const team = r.mode === 'mp' && r.room ? teamRun(r.room, now - (r.dur || 0) * 1000, now) : null;
  return { rank, best: Math.max(before, Math.round(r.score)), improved, newTitles, team };
}
// Career totals (near misses, distance in scored runs, friends, best multiplier): sends any titles they've
// reached to the inbox. Returns the titles just sent.
function statTitles(uid) {
  const s = db.prepare('SELECT SUM(near) AS near, SUM(dist) AS dist, MAX(peak) AS peak FROM runs WHERE uid = ? AND removed = 0 AND verified = 1').get(uid) || {};
  s.friends = db.prepare('SELECT COUNT(*) AS n FROM friends WHERE uid = ?').get(uid).n;
  return Titles.titlesForStats(s).filter(id => gift(uid, id));
}
// Team run: every signed-in player whose verified run on the same server overlapped this one in time. Their
// runs add up (each player's best overlapping run counts once); 2+ players reaching a team goal all get it.
function teamRun(room, start, end) {
  const rows = db.prepare(`SELECT uid, MAX(score) AS s FROM runs WHERE mode = 'mp' AND room = ? AND verified = 1 AND removed = 0
                           AND t - dur * 1000 < ? AND t > ? GROUP BY uid`).all(room, end, start);
  if (rows.length < 2) return null;
  const total = rows.reduce((n, x) => n + x.s, 0), ids = Titles.titlesForTeam(total), gifted = {};   // uid -> titles just sent
  for (const x of rows) { const got = ids.filter(id => gift(x.uid, id)); if (got.length) gifted[x.uid] = got; }
  return { total, players: rows.length, gifted };
}
// highest leaderboard spot ever (a run can only climb when it improves, so this is checked then)
function noteRank(mode, uid, rank) {
  const col = mode === 'mp' ? 'best_rank_mp' : 'best_rank_sp';
  db.prepare(`UPDATE users SET ${col} = ? WHERE uid = ? AND (${col} IS NULL OR ${col} > ?)`).run(rank, uid, rank);
}

// ---------------------------------------------------------------- profiles
// time played: the game reports while you're driving (any mode); never more than real time since the last report
const lastBeat = new Map();
function addPlayTime(uid, s) {
  const now = Date.now(), last = lastBeat.get(uid);
  const add = Math.min(s, 75, last ? (now - last) / 1000 + 2 : 60);
  lastBeat.set(uid, now);
  if (add > 0) { ensureUser(uid); db.prepare('UPDATE users SET play_s = play_s + ? WHERE uid = ?').run(add, uid); }
}
setInterval(() => { const t = Date.now(); for (const [k, v] of lastBeat) if (t - v > 600e3) lastBeat.delete(k); }, 600e3).unref();
function profile(uid) {
  ensureUser(uid);
  const u = db.prepare('SELECT title, play_s, best_rank_sp, best_rank_mp FROM users WHERE uid = ?').get(uid);
  const s = db.prepare('SELECT SUM(near) AS near, SUM(dist) AS dist FROM runs WHERE uid = ? AND removed = 0').get(uid);
  // season: best this season + spot on this season's leaderboard; best: all-time (every season)
  const mode = m => {
    const rank = rankOf(m, uid), stored = u[m === 'mp' ? 'best_rank_mp' : 'best_rank_sp'];
    if (rank && (!stored || rank < stored)) noteRank(m, uid, rank);   // (highest spot ever: kept for later)
    const all = db.prepare('SELECT MAX(score) AS s FROM runs WHERE uid = ? AND mode = ? AND removed = 0').get(uid, m);
    return { season: bestOf(m, uid), rank, best: (all && all.s) || 0 };
  };
  return {
    title: Titles.TITLE_BY_ID[u.title] ? u.title : null, playS: Math.round(u.play_s || 0),
    sp: mode('sp'), mp: mode('mp'), near: s.near || 0, distM: Math.round(s.dist || 0),
  };
}
// a run token can be used once
function spendToken(n) {
  try { db.prepare('INSERT INTO used_tokens (n, t) VALUES (?, ?)').run(n, Date.now()); return true; } catch (e) { return false; }
}
setInterval(() => db.prepare('DELETE FROM used_tokens WHERE t < ?').run(Date.now() - 3 * 86400e3), 3600e3).unref();

// ---------------------------------------------------------------- titles
const titlesOf = uid => db.prepare('SELECT title FROM user_titles WHERE uid = ? ORDER BY t').all(uid).map(r => r.title).filter(id => Titles.TITLE_BY_ID[id]);
// how many accounts own each title (claimed), e.g. { alpha: 41, owner: 2 }
const ownerCounts = () => Object.fromEntries(db.prepare('SELECT title, COUNT(*) AS n FROM user_titles GROUP BY title').all().map(r => [r.title, r.n]));
const equipped = uid => { const r = db.prepare('SELECT title FROM users WHERE uid = ?').get(uid); return r && r.title && Titles.TITLE_BY_ID[r.title] ? r.title : null; };
// equip one you own (null = none); returns an error message or null
function equip(uid, title) {
  ensureUser(uid);
  if (title !== null && !titlesOf(uid).includes(title)) return 'You haven\'t unlocked that title.';
  db.prepare('UPDATE users SET title = ? WHERE uid = ?').run(title, uid);
  cache.clear();
  return null;
}

// ---------------------------------------------------------------- friends
const areFriends = (a, b) => !!db.prepare('SELECT 1 FROM friends WHERE uid = ? AND fid = ?').get(a, b);
const friendsOf = uid => db.prepare('SELECT fid FROM friends WHERE uid = ? ORDER BY t').all(uid).map(r => r.fid);
const requestsIn = uid => db.prepare('SELECT from_uid AS uid FROM friend_requests WHERE to_uid = ? ORDER BY t DESC').all(uid).map(r => r.uid);
const requestsOut = uid => db.prepare('SELECT to_uid AS uid FROM friend_requests WHERE from_uid = ? ORDER BY t DESC').all(uid).map(r => r.uid);
function socialSettings(uid) {
  ensureUser(uid);
  const r = db.prepare('SELECT allow_requests, hide_activity FROM users WHERE uid = ?').get(uid);
  return { allowRequests: !!r.allow_requests, hideActivity: !!r.hide_activity };
}
function setSocialSettings(uid, s) {
  ensureUser(uid);
  if (typeof s.allowRequests === 'boolean') db.prepare('UPDATE users SET allow_requests = ? WHERE uid = ?').run(s.allowRequests ? 1 : 0, uid);
  if (typeof s.hideActivity === 'boolean') db.prepare('UPDATE users SET hide_activity = ? WHERE uid = ?').run(s.hideActivity ? 1 : 0, uid);
}
function befriend(a, b) {
  const t = Date.now();
  db.prepare('INSERT OR IGNORE INTO friends (uid, fid, t) VALUES (?, ?, ?)').run(a, b, t);
  db.prepare('INSERT OR IGNORE INTO friends (uid, fid, t) VALUES (?, ?, ?)').run(b, a, t);
  db.prepare('DELETE FROM friend_requests WHERE (from_uid = ? AND to_uid = ?) OR (from_uid = ? AND to_uid = ?)').run(a, b, b, a);
}
// a request from -> to. Returns 'sent', 'accepted' (they had already asked you), or an error message
function sendRequest(from, to) {
  if (from === to) return 'That\'s you!';
  if (areFriends(from, to)) return 'You\'re already friends.';
  if (db.prepare('SELECT 1 FROM friend_requests WHERE from_uid = ? AND to_uid = ?').get(to, from)) { befriend(from, to); return 'accepted'; }
  if (db.prepare('SELECT 1 FROM friend_requests WHERE from_uid = ? AND to_uid = ?').get(from, to)) return 'You already sent them a request.';
  if (!socialSettings(to).allowRequests) return 'That driver isn\'t accepting friend requests.';
  if (db.prepare('SELECT COUNT(*) AS n FROM friend_requests WHERE from_uid = ?').get(from).n >= 50) return 'You have too many requests waiting. Wait for some answers first.';
  db.prepare('INSERT INTO friend_requests (from_uid, to_uid, t) VALUES (?, ?, ?)').run(from, to, Date.now());
  return 'sent';
}
// answer a request someone sent you (or cancel one you sent: cancelRequest)
function respond(uid, fromUid, accept) {
  if (!db.prepare('SELECT 1 FROM friend_requests WHERE from_uid = ? AND to_uid = ?').get(fromUid, uid)) return false;
  if (accept) befriend(uid, fromUid);
  else db.prepare('DELETE FROM friend_requests WHERE from_uid = ? AND to_uid = ?').run(fromUid, uid);
  return true;
}
const cancelRequest = (uid, toUid) => db.prepare('DELETE FROM friend_requests WHERE from_uid = ? AND to_uid = ?').run(uid, toUid).changes > 0;
function unfriend(a, b) { db.prepare('DELETE FROM friends WHERE (uid = ? AND fid = ?) OR (uid = ? AND fid = ?)').run(a, b, b, a); }

// ---------------------------------------------------------------- chats (between friends)
function sendMessage(from, to, body) {
  const t = Date.now();
  const id = db.prepare('INSERT INTO messages (from_uid, to_uid, body, t) VALUES (?, ?, ?, ?)').run(from, to, body, t).lastInsertRowid;
  return { id: Number(id), t };
}
// the last `n` messages between a and b, oldest first
const chatWith = (a, b, n = 100) => db.prepare(`SELECT id, from_uid, body, t FROM messages WHERE (from_uid = ? AND to_uid = ?) OR (from_uid = ? AND to_uid = ?)
  ORDER BY id DESC LIMIT ?`).all(a, b, b, a, n).reverse();
const markRead = (uid, from) => db.prepare('UPDATE messages SET read = 1 WHERE to_uid = ? AND from_uid = ? AND read = 0').run(uid, from);
// unread messages to uid, by sender
const unreadBy = uid => Object.fromEntries(db.prepare('SELECT from_uid, COUNT(*) AS n FROM messages WHERE to_uid = ? AND read = 0 GROUP BY from_uid').all(uid).map(r => [r.from_uid, r.n]));

// ---------------------------------------------------------------- admin (admin.js)
const isBanned = uid => { const r = db.prepare('SELECT banned FROM users WHERE uid = ?').get(uid); return !!(r && r.banned); };
function setBanned(uid, on) { ensureUser(uid); db.prepare('UPDATE users SET banned = ? WHERE uid = ?').run(on ? 1 : 0, uid); cache.clear(); }
function setRemoved(id, on) { const n = db.prepare('UPDATE runs SET removed = ? WHERE id = ?').run(on ? 1 : 0, id).changes; cache.clear(); return n > 0; }
const runsOf = (uid, n = 30) => db.prepare('SELECT id, mode, score, dur, near, top_kmh, peak, server, t, verified, removed, note FROM runs WHERE uid = ? ORDER BY t DESC LIMIT ?').all(uid, n);
const runLog = id => { const r = db.prepare('SELECT log FROM runs WHERE id = ?').get(id); return r && r.log ? JSON.parse(zlib.gunzipSync(r.log)) : null; };
const recentRejected = (n = 30) => db.prepare('SELECT id, uid, mode, score, dur, t, note FROM runs WHERE verified = -1 ORDER BY t DESC LIMIT ?').all(n);

// titles v4 (once): new rarities + new titles - every title wiped and sent back (after everything above is defined)
if (!getMeta('titles_v4')) { setMeta('titles_v3', Date.now()); setMeta('titles_v4', Date.now()); resetTitles(); }

module.exports = {
  db, SEASON, SECRET, ensureUser, grant, gift, inboxOf, unclaimed, claim, top, around, rankOf, bestOf, addRun, spendToken, profile, addPlayTime,
  titlesOf, ownerCounts, alphaOpen, setAlphaOpen, resetTitles, statTitles, equipped, equip, isBanned, setBanned, setRemoved, runsOf, runLog, recentRejected,
  areFriends, friendsOf, requestsIn, requestsOut, socialSettings, setSocialSettings, sendRequest, respond, cancelRequest, unfriend,
  sendMessage, chatWith, markRead, unreadBy,
};
