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
//  any money titles players' runs have earned. New accounts got Alpha Tester while alpha_open was on; since beta_v1
//  (alpha closed, Beta Tester sent to every account) they get Beta Tester while beta_open is on.
// =====================================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const Titles = require('./js/titles');
const Tracks = require('./js/tracks');

const FILE = process.env.PW_DB || path.join(__dirname, 'polyweave.db');
const SEASON = 1;                 // the current season (0 = the beta; Season 1 started 2026-10-19). Older seasons stay viewable.
const SEASONS = [0, 1];
const MODES = ['sp', 'mp'];
const OWNER_NAMES = ['curryeater', 'polyweave'];   // get the Owner title (account names, any upper / lower case)
const BIKE_NAMES = ['curryeater', 'polyweave'];   // may ride the motorcycle (owners only, not released yet; same list in js/main.js)

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
  -- group chats: the group (its maker can rename it / add / remove people), who's in it (last_read: the last message
  -- they've seen) and its messages (from_uid '' = a line from the game: "X added Y", "X left")
  CREATE TABLE IF NOT EXISTS chat_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, owner TEXT NOT NULL, t INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS group_members (gid INTEGER NOT NULL, uid TEXT NOT NULL, t INTEGER, last_read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (gid, uid));
  CREATE INDEX IF NOT EXISTS gm_uid ON group_members (uid);
  CREATE TABLE IF NOT EXISTS group_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, gid INTEGER NOT NULL, from_uid TEXT NOT NULL, body TEXT NOT NULL, t INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS gmsg_gid ON group_messages (gid, id);
  CREATE TABLE IF NOT EXISTS laps (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, track TEXT NOT NULL, ms INTEGER NOT NULL, season INTEGER NOT NULL, t INTEGER NOT NULL,
    removed INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS laps_board ON laps (track, season, removed, uid, ms);
  CREATE TABLE IF NOT EXISTS race_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, track TEXT NOT NULL, pos INTEGER, n INTEGER NOT NULL, pts INTEGER NOT NULL,
    ms INTEGER, season INTEGER NOT NULL, t INTEGER NOT NULL, removed INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS race_board ON race_results (season, removed, uid);
  CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT);
  -- what an admin (Admin title) asked for, waiting for PolyWeave: status 0 waiting, 1 accepted, 2 declined, 3 accepted but it couldn't be done
  CREATE TABLE IF NOT EXISTS admin_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, uid TEXT NOT NULL, name TEXT, payload TEXT NOT NULL,
    summary TEXT, status INTEGER NOT NULL DEFAULT 0, decided INTEGER, note TEXT, result TEXT);
  CREATE TABLE IF NOT EXISTS referrals (uid TEXT PRIMARY KEY, by_uid TEXT NOT NULL, t INTEGER NOT NULL);   -- uid = the new player, by_uid = who invited them
  CREATE INDEX IF NOT EXISTS referrals_by ON referrals (by_uid);
`);

// newer columns (added to databases made before them)
{
  const have = new Set(db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
  for (const [col, def] of [['best_rank_sp', 'INTEGER'], ['best_rank_mp', 'INTEGER'],
    ['allow_requests', 'INTEGER NOT NULL DEFAULT 1'], ['hide_activity', 'INTEGER NOT NULL DEFAULT 0'], ['best_team', 'REAL NOT NULL DEFAULT 0'],
    ['ban_until', 'INTEGER'], ['ev_play_s', 'REAL NOT NULL DEFAULT 0'], ['bus', 'INTEGER NOT NULL DEFAULT 0'], ['no_groups', 'INTEGER NOT NULL DEFAULT 0']]) if (!have.has(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
  // (no_groups: 1 = nobody can add them to a group chat - Friends > settings, off to start)
  // (ev_play_s: time played since the Bang Bus event started; bus: 1 = Bang Bus unlocked, for good)
  const haveR = new Set(db.prepare('PRAGMA table_info(runs)').all().map(c => c.name));
  if (!haveR.has('dist')) db.exec('ALTER TABLE runs ADD COLUMN dist REAL');
  if (!haveR.has('room')) db.exec('ALTER TABLE runs ADD COLUMN room TEXT');   // (multiplayer: which server, for team runs)
  const haveI = new Set(db.prepare('PRAGMA table_info(inbox)').all().map(c => c.name));
  if (!haveI.has('note')) db.exec('ALTER TABLE inbox ADD COLUMN note TEXT');  // (an optional message with an inbox item)
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
// send a title to someone's inbox (not if they have it or it's already waiting), with an optional message shown
// with it; returns true if sent
function gift(uid, title, note = null) {
  if (!Titles.TITLE_BY_ID[title] || owns(uid, title) || pending(uid, title)) return false;
  ensureUser(uid);
  db.prepare("INSERT INTO inbox (uid, kind, item, t, note) VALUES (?, 'title', ?, ?, ?)").run(uid, title, Date.now(), note ? String(note).slice(0, 500) : null);
  return true;
}
const inboxOf = uid => db.prepare('SELECT id, kind, item, t, claimed, note FROM inbox WHERE uid = ? ORDER BY claimed IS NOT NULL, t DESC LIMIT 60').all(uid)
  .filter(r => r.kind !== 'title' || Titles.TITLE_BY_ID[r.item]);
const pendingOf = uid => db.prepare("SELECT item FROM inbox WHERE uid = ? AND kind = 'title' AND claimed IS NULL").all(uid).map(r => r.item).filter(id => Titles.TITLE_BY_ID[id]);   // (waiting in the inbox)
// (only titles that still exist: a removed title left in someone's inbox doesn't count)
const unclaimed = uid => db.prepare('SELECT kind, item FROM inbox WHERE uid = ? AND claimed IS NULL').all(uid).filter(r => r.kind === 'note' || Titles.TITLE_BY_ID[r.item]).length;   // (notes too)
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
// Beta Tester for new accounts, until it's switched off: node admin.js beta off
const betaOpen = () => getMeta('beta_open') !== '0';
const setBetaOpen = on => setMeta('beta_open', on ? '1' : '0');

// Beta (once): the alpha is over. Stop giving out Alpha Tester (players who have it keep it) and send
// Beta Tester to every account that exists; new accounts get it at sign-in (server.js)
function betaV1() {
  if (getMeta('beta_v1')) return;
  setAlphaOpen(false);
  let n = 0;
  for (const u of Object.values(readAccounts())) if (u && u.id && gift(u.id, 'beta')) n++;
  setMeta('beta_v1', Date.now());
  console.log(`database: alpha closed (no more Alpha Tester); Beta Tester sent to ${n} inboxes`);
}
betaV1();

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
      if (betaOpen()) gift(u.id, 'beta');
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
// best counted run per player (newest-first tie break: the earlier run ranks higher), ranked. season: which
// season's board (default: the current one)
const cache = new Map();          // mode:season -> { t, list }
function board(mode, season = SEASON) {
  const key = mode + ':' + season, c = cache.get(key);
  if (c && Date.now() - c.t < 3000) return c.list;
  const list = db.prepare(`
    SELECT b.uid, b.score, b.t, b.dur, b.server, u.title,
           ROW_NUMBER() OVER (ORDER BY b.score DESC, b.t ASC) AS rank
    FROM (SELECT uid, MAX(score) AS score, t, dur, server FROM runs
          WHERE mode = ? AND season = ? AND removed = 0 GROUP BY uid) b
    JOIN users u ON u.uid = b.uid
    WHERE u.banned = 0
    ORDER BY rank`).all(mode, season);
  cache.set(key, { t: Date.now(), list });
  return list;
}
const top = (mode, n = 100, season = SEASON) => board(mode, season).slice(0, n);
// your rank + the k players ahead of you and k behind
function around(mode, uid, k = 10, season = SEASON) {
  const list = board(mode, season), i = list.findIndex(e => e.uid === uid);
  return { total: list.length, rank: i >= 0 ? i + 1 : null, list: i >= 0 ? list.slice(Math.max(0, i - k), i + k + 1) : [] };
}
// racing: best lap per player on a track (singleplayer time trials), fastest first
function lapBoard(track, season = SEASON) {
  const key = 'lap:' + track + ':' + season, c = cache.get(key);
  if (c && Date.now() - c.t < 3000) return c.list;
  const list = db.prepare(`
    SELECT b.uid, b.ms, b.t, u.title, ROW_NUMBER() OVER (ORDER BY b.ms ASC, b.t ASC) AS rank
    FROM (SELECT uid, MIN(ms) AS ms, t FROM laps WHERE track = ? AND season = ? AND removed = 0 GROUP BY uid) b
    JOIN users u ON u.uid = b.uid WHERE u.banned = 0 ORDER BY rank`).all(track, season);
  cache.set(key, { t: Date.now(), list });
  return list;
}
const lapTop = (track, n = 100, season = SEASON) => lapBoard(track, season).slice(0, n);
function lapAround(track, uid, k = 10, season = SEASON) {
  const list = lapBoard(track, season), i = list.findIndex(e => e.uid === uid);
  return { total: list.length, rank: i >= 0 ? i + 1 : null, list: i >= 0 ? list.slice(Math.max(0, i - k), i + k + 1) : [] };
}
// a checked time-trial lap: returns { rank (if it's a new personal best), best }
// (racing review queue: a lap / race time more than 8% quicker than the current track record - once the board has 3+
//  drivers - is saved HELD (removed = 2): off the board until the admin approves it in the admin panel)
const HOLD_FACTOR = 0.92;
const tooGood = (list, ms) => list.length >= 3 && ms < list[0].ms * HOLD_FACTOR;
function addLap(uid, track, ms) {
  ensureUser(uid);
  const b = db.prepare('SELECT MIN(ms) AS ms FROM laps WHERE uid = ? AND track = ? AND season = ? AND removed = 0').get(uid, track, SEASON);
  const before = (b && b.ms) || 0, improved = !before || ms < before;
  if (tooGood(lapBoard(track), ms)) {
    db.prepare('INSERT INTO laps (uid, track, ms, season, t, removed) VALUES (?, ?, ?, ?, ?, 2)').run(uid, track, Math.round(ms), SEASON, Date.now());
    return { rank: null, best: before, held: true };
  }
  db.prepare('INSERT INTO laps (uid, track, ms, season, t) VALUES (?, ?, ?, ?, ?)').run(uid, track, Math.round(ms), SEASON, Date.now());
  cache.delete('lap:' + track + ':' + SEASON);
  const rank = improved ? (lapBoard(track).findIndex(e => e.uid === uid) + 1 || null) : null;
  return { rank, best: improved ? Math.round(ms) : before };
}
// racing: every finished race (rows [{ uid, pos (null = DNF), ms (server-measured, penalties included) }],
// n = drivers on the grid). The races leaderboard is each driver's fastest finish on a track.
function addRace(track, n, rows) {
  const ins = db.prepare('INSERT INTO race_results (uid, track, pos, n, pts, ms, season, t, removed) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)'), t = Date.now(), board = raceBoard(track);
  for (const r of rows) { ensureUser(r.uid); ins.run(r.uid, track, r.pos || null, n, r.pos ? Math.round(r.ms) : null, SEASON, t, r.pos && tooGood(board, r.ms) ? 2 : 0); }
  cache.delete('races:' + track + ':' + SEASON);
}
function raceBoard(track, season = SEASON) {
  const key = 'races:' + track + ':' + season, c = cache.get(key);
  if (c && Date.now() - c.t < 3000) return c.list;
  const list = db.prepare(`
    SELECT b.uid, b.ms, b.t, u.title, ROW_NUMBER() OVER (ORDER BY b.ms ASC, b.t ASC) AS rank
    FROM (SELECT uid, MIN(ms) AS ms, t FROM race_results WHERE track = ? AND season = ? AND removed = 0 AND pos IS NOT NULL AND ms IS NOT NULL GROUP BY uid) b
    JOIN users u ON u.uid = b.uid WHERE u.banned = 0 ORDER BY rank`).all(track, season);
  cache.set(key, { t: Date.now(), list });
  return list;
}
const raceTop = (track, n = 100, season = SEASON) => raceBoard(track, season).slice(0, n);
function raceAround(track, uid, k = 10, season = SEASON) {
  const list = raceBoard(track, season), i = list.findIndex(e => e.uid === uid);
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
  if (!ok) return { rank: null, best: before, improved: false, newTitles: [], team: null, autoBanned: autoBan(r.uid) };
  const newTitles = Titles.titlesForRun(r.score).filter(id => gift(r.uid, id)).concat(statTitles(r.uid));
  cache.delete(r.mode + ':' + SEASON);
  const rank = improved ? rankOf(r.mode, r.uid) : null;
  if (rank) noteRank(r.mode, r.uid, rank);
  const team = r.mode === 'mp' && r.room ? teamRun(r.room, now - (r.dur || 0) * 1000, now) : null;
  return { rank, best: Math.max(before, Math.round(r.score)), improved, newTitles, team };
}
// A player's achievement stats: near misses and distance (totals), farthest single run, multiplayer runs, best
// multiplier, friends, best single-run score (any counted run) and best team run.
function statsOf(uid) {
  const s = db.prepare(`SELECT SUM(near) AS near, SUM(dist) AS dist, MAX(dist) AS runDist, MAX(peak) AS peak,
                        SUM(CASE WHEN mode = 'mp' THEN 1 ELSE 0 END) AS mpRuns FROM runs WHERE uid = ? AND removed = 0 AND verified = 1`).get(uid) || {};
  const best = db.prepare('SELECT MAX(score) AS s FROM runs WHERE uid = ? AND removed = 0 AND verified >= 0').get(uid);
  const u = db.prepare('SELECT best_team FROM users WHERE uid = ?').get(uid);
  return {
    near: s.near || 0, dist: s.dist || 0, runDist: s.runDist || 0, peak: s.peak || 0, mpRuns: s.mpRuns || 0,
    friends: db.prepare('SELECT COUNT(*) AS n FROM friends WHERE uid = ?').get(uid).n,
    score: (best && best.s) || 0, team: (u && u.best_team) || 0,
  };
}
// every achievement title their stats have reached (stat titles, best single run, best team run) goes to the
// inbox. Returns the titles just sent.
function statTitles(uid) {
  const s = statsOf(uid);
  return Titles.titlesForStats(s).concat(Titles.titlesForRun(s.score), Titles.titlesForTeam(s.team)).filter(id => gift(uid, id));
}
// Team run: every signed-in player whose verified run on the same server overlapped this one in time. Their
// runs add up (each player's best overlapping run counts once); 2+ players reaching a team goal all get it.
function teamRun(room, start, end) {
  const rows = db.prepare(`SELECT uid, MAX(score) AS s FROM runs WHERE mode = 'mp' AND room = ? AND verified = 1 AND removed = 0
                           AND t - dur * 1000 < ? AND t > ? GROUP BY uid`).all(room, end, start);
  if (rows.length < 2) return null;
  const total = rows.reduce((n, x) => n + x.s, 0), ids = Titles.titlesForTeam(total), gifted = {};   // uid -> titles just sent
  for (const x of rows) {
    db.prepare('UPDATE users SET best_team = MAX(best_team, ?) WHERE uid = ?').run(total, x.uid);   // (Achievements: best team run)
    const got = ids.filter(id => gift(x.uid, id)); if (got.length) gifted[x.uid] = got;
  }
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
  if (add > 0) { ensureUser(uid); db.prepare('UPDATE users SET play_s = play_s + ?, ev_play_s = ev_play_s + ? WHERE uid = ?').run(add, add, uid); }   // (ev_play_s: the Bang Bus event's play time)
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
// ---------------------------------------------------------------- referrals
// A brand-new account made from someone's invite link (polyweave.org/?ref=<name>) is tied to them once, for good.
// It only counts once that player has played 10 minutes and isn't leaderboard banned (so spare accounts are a chore).
const REF_PLAY_S = 600;
function addReferral(uid, byUid) {
  if (!uid || !byUid || uid === byUid) return false;
  ensureUser(uid);
  return db.prepare('INSERT OR IGNORE INTO referrals (uid, by_uid, t) VALUES (?, ?, ?)').run(uid, byUid, Date.now()).changes > 0;
}
function referralStats(byUid) {
  const rows = db.prepare('SELECT r.uid, u.play_s, u.banned FROM referrals r LEFT JOIN users u ON u.uid = r.uid WHERE r.by_uid = ?').all(byUid);
  const ok = rows.filter(r => !r.banned && (r.play_s || 0) >= REF_PLAY_S).length;
  return { counted: ok, pending: rows.filter(r => !r.banned && (r.play_s || 0) < REF_PLAY_S).length };
}
const referredBy = uid => { const r = db.prepare('SELECT by_uid FROM referrals WHERE uid = ?').get(uid); return r ? r.by_uid : null; };

// ---------------------------------------------------------------- the Bang Bus event
// Five quests unlock the Bang Bus for good: sign in with Google, play 1 hour, drive 75 miles and score 100k in one
// run (these three count from the event's start, from 0 for everyone), and refer 3 players (all your referrals so
// far count). Distance and score come from verified runs that are still on the boards.
if (!getMeta('bus_event_start')) setMeta('bus_event_start', Date.now());
const BUS_EVENT_START = +getMeta('bus_event_start');
const BUS_QUESTS = { play: 3600, drive: 75 * 1609.344, score: 100000, refer: 3, referAlt: 5 };
// (or, instead of all five quests: refer 5 players. Admins (the Admin title, not banned) and Content Creators get it anyway)
const busPerk = uid => (owns(uid, 'admin') && !isBanned(uid)) || owns(uid, 'creator');
function busProgress(uid) {
  ensureUser(uid);
  const u = db.prepare('SELECT ev_play_s, bus FROM users WHERE uid = ?').get(uid);
  const r = db.prepare("SELECT SUM(dist) AS dist, MAX(score) AS best FROM runs WHERE uid = ? AND t >= ? AND verified = 1 AND removed = 0 AND mode IN ('sp', 'mp')").get(uid, BUS_EVENT_START);
  const ref = referralStats(uid);
  const quests = [
    { id: 'signin', have: 1, need: 1 },
    { id: 'play', have: Math.floor(u.ev_play_s || 0), need: BUS_QUESTS.play },
    { id: 'drive', have: Math.round(r.dist || 0), need: Math.round(BUS_QUESTS.drive) },
    { id: 'score', have: Math.round(r.best || 0), need: BUS_QUESTS.score },
    { id: 'refer', have: ref.counted, need: BUS_QUESTS.refer, pending: ref.pending },
  ];
  const alt = { id: 'refer5', have: ref.counted, need: BUS_QUESTS.referAlt, pending: ref.pending };
  let unlocked = !!u.bus;
  if (!unlocked && (quests.every(q => q.have >= q.need) || alt.have >= alt.need)) { db.prepare('UPDATE users SET bus = 1 WHERE uid = ?').run(uid); unlocked = true; }
  const perk = busPerk(uid);   // (not saved: it goes with the title)
  return { start: BUS_EVENT_START, quests, alt, unlocked: unlocked || perk, perk };
}
// the Bang Bus is theirs (finished the quests or referred 5, an owner, an admin or a Content Creator): checks the quests too, so it unlocks the moment they're done
const hasBus = (uid, name) => !!(name && BIKE_NAMES.includes(String(name).toLowerCase())) || busProgress(uid).unlocked;
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
  const r = db.prepare('SELECT allow_requests, hide_activity, no_groups FROM users WHERE uid = ?').get(uid);
  return { allowRequests: !!r.allow_requests, hideActivity: !!r.hide_activity, noGroups: !!r.no_groups };
}
function setSocialSettings(uid, s) {
  ensureUser(uid);
  if (typeof s.allowRequests === 'boolean') db.prepare('UPDATE users SET allow_requests = ? WHERE uid = ?').run(s.allowRequests ? 1 : 0, uid);
  if (typeof s.hideActivity === 'boolean') db.prepare('UPDATE users SET hide_activity = ? WHERE uid = ?').run(s.hideActivity ? 1 : 0, uid);
  if (typeof s.noGroups === 'boolean') db.prepare('UPDATE users SET no_groups = ? WHERE uid = ?').run(s.noGroups ? 1 : 0, uid);
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

// ---------------------------------------------------------------- group chats (server.js /api/group/*)
const GROUP_MAX = 10;                                  // people in a group, its maker included
const groupOf = gid => db.prepare('SELECT id, name, owner, t FROM chat_groups WHERE id = ?').get(gid);
const groupMembers = gid => db.prepare('SELECT uid FROM group_members WHERE gid = ? ORDER BY t, rowid').all(gid).map(r => r.uid);
const inGroup = (gid, uid) => !!db.prepare('SELECT 1 FROM group_members WHERE gid = ? AND uid = ?').get(gid, uid);
// a line in the group (from '' = from the game itself); returns { id, t }
function groupSay(gid, from, body) {
  const t = Date.now(), id = Number(db.prepare('INSERT INTO group_messages (gid, from_uid, body, t) VALUES (?, ?, ?, ?)').run(gid, from, String(body).slice(0, 300), t).lastInsertRowid);
  if (from) db.prepare('UPDATE group_members SET last_read = ? WHERE gid = ? AND uid = ?').run(id, gid, from);   // (your own message: read)
  return { id, t };
}
function createGroup(owner, name, uids) {
  const t = Date.now(), gid = Number(db.prepare('INSERT INTO chat_groups (name, owner, t) VALUES (?, ?, ?)').run(name, owner, t).lastInsertRowid);
  const add = db.prepare('INSERT OR IGNORE INTO group_members (gid, uid, t) VALUES (?, ?, ?)');
  [owner, ...uids].forEach((uid, i) => add.run(gid, uid, t + i));
  return gid;
}
const addToGroup = (gid, uid) => db.prepare('INSERT OR IGNORE INTO group_members (gid, uid, t, last_read) VALUES (?, ?, ?, (SELECT COALESCE(MAX(id), 0) FROM group_messages WHERE gid = ?))').run(gid, uid, Date.now(), gid).changes > 0;
// someone out of a group (left / kicked). The leader can only leave last (server.js), so nobody left = it's gone
function removeFromGroup(gid, uid) {
  db.prepare('DELETE FROM group_members WHERE gid = ? AND uid = ?').run(gid, uid);
  if (!groupMembers(gid).length) { db.prepare('DELETE FROM group_messages WHERE gid = ?').run(gid); db.prepare('DELETE FROM chat_groups WHERE id = ?').run(gid); return null; }
  return groupOf(gid);
}
const renameGroup = (gid, name) => db.prepare('UPDATE chat_groups SET name = ? WHERE id = ?').run(name, gid);
const groupMessages = (gid, n = 100) => db.prepare('SELECT id, from_uid, body, t FROM group_messages WHERE gid = ? ORDER BY id DESC LIMIT ?').all(gid, n).reverse();
const markGroupRead = (gid, uid) => db.prepare('UPDATE group_members SET last_read = (SELECT COALESCE(MAX(id), 0) FROM group_messages WHERE gid = ?) WHERE gid = ? AND uid = ?').run(gid, gid, uid);
// uid's groups, newest message first, with how many they haven't read (others' messages after their last_read)
const groupsOf = uid => db.prepare(`SELECT g.id, g.name, g.owner,
    (SELECT COUNT(*) FROM group_messages m WHERE m.gid = g.id AND m.id > gm.last_read AND m.from_uid != ? AND m.from_uid != '') AS unread,   -- (the game's own lines don't count)
    (SELECT COALESCE(MAX(t), g.t) FROM group_messages m WHERE m.gid = g.id) AS last
  FROM group_members gm JOIN chat_groups g ON g.id = gm.gid WHERE gm.uid = ? ORDER BY last DESC`).all(uid, uid).map(g => Object.assign(g, { members: groupMembers(g.id) }));

// ---------------------------------------------------------------- admin (admin.js)
// Leaderboard bans: permanent (ban_until empty) or until a time (a temporary ban). While banned, runs aren't saved and
// the player is off every board. When a temporary ban runs out, their scores and stats are reset - every run, lap and
// race result taken off, best ranks and best team run cleared - keeping only the date they joined and time played.
function endBan(uid) {
  for (const t of ['runs', 'laps', 'race_results']) db.prepare(`UPDATE ${t} SET removed = 1 WHERE uid = ?`).run(uid);
  db.prepare('UPDATE users SET banned = 0, ban_until = NULL, best_rank_sp = NULL, best_rank_mp = NULL, best_team = 0 WHERE uid = ?').run(uid);
  cache.clear();
}
// (checked whenever a ban matters, so an expired one ends - and resets - right on time)
const isBanned = uid => {
  const r = db.prepare('SELECT banned, ban_until FROM users WHERE uid = ?').get(uid);
  if (!r || !r.banned) return false;
  if (r.ban_until && r.ban_until <= Date.now()) { endBan(uid); return false; }
  return true;
};
const banUntil = uid => { const r = db.prepare('SELECT banned, ban_until FROM users WHERE uid = ?').get(uid); return r && r.banned ? r.ban_until || null : null; };
// on = true: banned (days: a temporary ban for that many days; none = permanent); on = false: unbanned (no reset)
function setBanned(uid, on, days) {
  ensureUser(uid);
  db.prepare('UPDATE users SET banned = ?, ban_until = ? WHERE uid = ?').run(on ? 1 : 0, on && days > 0 ? Date.now() + days * 86400e3 : null, uid);
  cache.clear();
}
// Auto-ban: 3 runs rejected for a reason only a faked run can have, within 24 hours = a 7-day leaderboard ban (scores
// and stats reset when it ends). Reasons an honest player could hit through lag or an old cached copy of the game -
// multiplayer distance / proximity mismatches, a log that doesn't add up, timing oddities - never count. Owners never.
const CHEAT_ONLY = ['impossible near-miss gap', 'faster than the car can go', "near-miss points don't match", 'too many near misses at once',
  'more than traffic allows', 'multiplier went up without a near miss', 'proximity bonus outside multiplayer', 'bad proximity bonus',
  'bad speed chunk', 'bad shoulder time', 'unknown event', 'malformed', 'bad score', 'bad duration', 'bad log',
  // racing (flagRacing): a lap / lap split quicker than the car flat out, a car that teleported in a race
  'faster than flat out', 'a sector too fast', 'race: moved', 'lap quicker than flat out'];
const cheatOnly = note => !!note && CHEAT_ONLY.some(s => note.includes(s));
function autoBan(uid) {
  if (isBanned(uid)) return false;
  const acct = readAccounts()[uid];
  if (acct && acct.name && OWNER_NAMES.includes(acct.name.toLowerCase())) return false;
  const n = db.prepare('SELECT note FROM runs WHERE uid = ? AND verified = -1 AND t > ?').all(uid, Date.now() - 86400e3).filter(r => cheatOnly(r.note)).length;
  if (n < 3) return false;
  setBanned(uid, true, 7);
  console.log(`auto-ban: ${(acct && acct.name) || uid} - ${n} faked-run rejections in 24 h -> 7-day leaderboard ban`);
  return true;
}
// a refused time-trial lap / race finish: kept as a rejected run (mode 'lap' / 'race', off every board) so the admin
// panel shows it and the cheat-only ones count toward the auto-ban
function flagRacing(uid, mode, note, ms = 0) {
  ensureUser(uid);
  db.prepare('INSERT INTO runs (uid, mode, score, dur, season, t, verified, removed, note) VALUES (?, ?, ?, ?, ?, ?, -1, 1, ?)').run(uid, mode, Math.round(ms) || 0, (ms || 0) / 1000, SEASON, Date.now(), String(note).slice(0, 300));
  return autoBan(uid);
}

// ---------------------------------------------------------------- admin panel (server.js /api/admin/*, admin only)
// The admin is ONE account, locked by its Google id (not its name, so renaming can't pass it on): the account called
// PolyWeave when this first runs (meta admin_uid).
if (!getMeta('admin_uid')) { const a = Object.values(readAccounts()).find(x => x && x.name && x.name.toLowerCase() === 'polyweave'); if (a) setMeta('admin_uid', a.id); }
const adminUid = () => getMeta('admin_uid');
const adminLog = (action, target, detail) => db.prepare('INSERT INTO admin_log (t, action, target, detail) VALUES (?, ?, ?, ?)').run(Date.now(), action, target || null, detail || null);
const adminLogList = (n = 200) => db.prepare('SELECT * FROM admin_log ORDER BY id DESC LIMIT ?').all(n);
// admins' requests (server.js: an admin's action waits here until PolyWeave accepts or declines it)
const addRequest = (uid, name, payload, summary) => db.prepare('INSERT INTO admin_requests (t, uid, name, payload, summary) VALUES (?, ?, ?, ?, ?)').run(Date.now(), uid, name, JSON.stringify(payload), summary).lastInsertRowid;
const getRequest = id => { const r = db.prepare('SELECT * FROM admin_requests WHERE id = ?').get(id); if (r) r.payload = JSON.parse(r.payload); return r; };
const decideRequest = (id, status, note, result) => db.prepare('UPDATE admin_requests SET status = ?, decided = ?, note = ?, result = ? WHERE id = ? AND status = 0').run(status, Date.now(), note || null, result || null, id).changes > 0;
const requestList = (uid, n = 150) => db.prepare(`SELECT id, t, uid, name, summary, status, decided, note, result FROM admin_requests ${uid ? 'WHERE uid = ?' : ''} ORDER BY status = 0 DESC, id DESC LIMIT ?`).all(...(uid ? [uid, n] : [n]));
const waitingRequests = () => db.prepare('SELECT COUNT(*) AS n FROM admin_requests WHERE status = 0').get().n;
// a message in someone's inbox (kind 'note': read it, then OK), e.g. PolyWeave's answer to an admin's request
const sendNote = (uid, text) => { ensureUser(uid); db.prepare("INSERT INTO inbox (uid, kind, item, t, note) VALUES (?, 'note', 'admin', ?, ?)").run(uid, Date.now(), String(text).slice(0, 700)); };
// runs with filters: { uid, mode ('sp'|'mp'|'lap'|'race'), status ('verified'|'rejected'|'removed'|'counted'), minScore,
// maxScore, minDur, maxDur, minPps (points per second), since (ms), limit }
function adminRuns(f = {}) {
  const w = [], a = [];
  if (f.uid) { w.push('uid = ?'); a.push(f.uid); }
  if (['sp', 'mp', 'lap', 'race'].includes(f.mode)) { w.push('mode = ?'); a.push(f.mode); }
  if (f.status === 'verified') w.push('verified = 1');
  else if (f.status === 'rejected') w.push('verified = -1');
  else if (f.status === 'removed') w.push('verified = 1 AND removed = 1');
  else if (f.status === 'counted') w.push('removed = 0');
  for (const [k, col, op] of [['minScore', 'score', '>='], ['maxScore', 'score', '<='], ['minDur', 'dur', '>='], ['maxDur', 'dur', '<='], ['since', 't', '>=']])
    if (Number.isFinite(+f[k]) && f[k] !== '' && f[k] !== null && f[k] !== undefined) { w.push(`${col} ${op} ?`); a.push(+f[k]); }
  if (Number.isFinite(+f.minPps) && +f.minPps > 0) { w.push('dur > 0 AND score / dur >= ?'); a.push(+f.minPps); }
  return db.prepare(`SELECT id, uid, mode, score, dur, near, top_kmh, peak, server, t, verified, removed, note FROM runs ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY t DESC LIMIT ?`)
    .all(...a, Math.min(500, Math.max(1, +f.limit || 100)));
}
// racing: every lap / race result on a track (status: 0 counted, 1 removed, 2 held for review)
const adminLaps = (track, n = 200) => db.prepare('SELECT id, uid, ms, t, removed FROM laps WHERE track = ? AND season = ? ORDER BY removed = 2 DESC, ms ASC LIMIT ?').all(track, SEASON, n);
const adminRaces = (track, n = 200) => db.prepare('SELECT id, uid, pos, n, ms, t, removed FROM race_results WHERE track = ? AND season = ? AND ms IS NOT NULL ORDER BY removed = 2 DESC, ms ASC LIMIT ?').all(track, SEASON, n);
function setLapStatus(table, id, status) {   // table 'laps' | 'race_results'; status 0 / 1 / 2
  if (!['laps', 'race_results'].includes(table)) return false;
  const n = db.prepare(`UPDATE ${table} SET removed = ? WHERE id = ?`).run(status, id).changes; cache.clear(); return n > 0;
}
const heldCount = () => db.prepare('SELECT (SELECT COUNT(*) FROM laps WHERE removed = 2) + (SELECT COUNT(*) FROM race_results WHERE removed = 2) AS n').get().n;
function adminOverview() {
  const day = Date.now() - 86400e3, c = q => db.prepare(q).get(day).n;
  return {
    bannedPerm: db.prepare('SELECT COUNT(*) AS n FROM users WHERE banned = 1 AND ban_until IS NULL').get().n,
    bannedTemp: db.prepare('SELECT COUNT(*) AS n FROM users WHERE banned = 1 AND ban_until IS NOT NULL').get().n,
    runs24: c('SELECT COUNT(*) AS n FROM runs WHERE t > ? AND verified = 1'), rejected24: c('SELECT COUNT(*) AS n FROM runs WHERE t > ? AND verified = -1'),
    runsTotal: db.prepare('SELECT COUNT(*) AS n FROM runs WHERE verified = 1').get().n, laps24: c('SELECT COUNT(*) AS n FROM laps WHERE t > ?'),
    held: heldCount(), playHours: Math.round(db.prepare('SELECT SUM(play_s) AS s FROM users').get().s / 360) / 10,
  };
}
const userRow = uid => db.prepare('SELECT uid, title, banned, ban_until, play_s, created, best_rank_sp, best_rank_mp FROM users WHERE uid = ?').get(uid);
// temporary bans that ran out while nobody looked (the boards hide banned players without asking isBanned)
function sweepBans() { for (const r of db.prepare('SELECT uid FROM users WHERE banned = 1 AND ban_until IS NOT NULL AND ban_until <= ?').all(Date.now())) endBan(r.uid); }
setInterval(sweepBans, 60e3).unref();
function setRemoved(id, on) { const n = db.prepare('UPDATE runs SET removed = ? WHERE id = ?').run(on ? 1 : 0, id).changes; cache.clear(); return n > 0; }
const runsOf = (uid, n = 30) => db.prepare('SELECT id, mode, score, dur, near, top_kmh, peak, server, t, verified, removed, note FROM runs WHERE uid = ? ORDER BY t DESC LIMIT ?').all(uid, n);
const runLog = id => { const r = db.prepare('SELECT log FROM runs WHERE id = ?').get(id); return r && r.log ? JSON.parse(zlib.gunzipSync(r.log)) : null; };
const recentRejected = (n = 30) => db.prepare('SELECT id, uid, mode, score, dur, t, note FROM runs WHERE verified = -1 ORDER BY t DESC LIMIT ?').all(n);
// take every run of one player above a score off the boards (mode 'sp' / 'mp'); returns how many
function removeAbove(uid, mode, max) {
  const n = db.prepare('UPDATE runs SET removed = 1 WHERE uid = ? AND mode = ? AND score > ? AND removed = 0').run(uid, mode, max).changes;
  cache.clear(); return n;
}

// titles v5 (once): achievements + new titles - every title wiped and sent back (after everything above is defined)
if (!getMeta('titles_v5')) { for (const k of ['titles_v3', 'titles_v4', 'titles_v5']) setMeta(k, Date.now()); resetTitles(); }

// edge-line exploit (once, 2026-10-11): Codester found that sitting exactly on the white line between the road and
// the shoulder gave endless near misses with no risk of crashing (fixed in the game). His runs above 82k
// (multiplayer) and 85k (singleplayer) come off the boards; the rest stay. He gets Bug Hunter for reporting it.
if (!getMeta('edgeline_fix_v1')) {
  setMeta('edgeline_fix_v1', Date.now());
  const u = Object.values(readAccounts()).find(a => a && a.name && a.name.toLowerCase() === 'codester');
  if (u) {
    const mp = removeAbove(u.id, 'mp', 82000), sp = removeAbove(u.id, 'sp', 85000);
    const sent = gift(u.id, 'bughunter', 'Thank you for helping improve the game\n-PolyWeave');
    console.log(`edge-line fix: Codester - ${mp} multiplayer and ${sp} singleplayer runs removed; Bug Hunter ${sent ? 'sent' : 'already had / waiting'}`);
  } else console.log('edge-line fix: no Codester account here (nothing to do)');
}

// Bug Hunter for Chickle (once, 2026-10-13), with the same thank-you note. (Waits until the account exists here.)
if (!getMeta('bughunter_chickle_v1')) {
  const u = Object.values(readAccounts()).find(a => a && a.name && a.name.toLowerCase() === 'chickle');
  if (u) {
    setMeta('bughunter_chickle_v1', Date.now());
    const sent = gift(u.id, 'bughunter', 'Thank you for helping improve the game\n-PolyWeave');
    console.log(`Bug Hunter for Chickle: ${sent ? 'sent' : 'already had / waiting'}`);
  }
}

// Bug Hunter for beachrat and TTNoManchas (once each, 2026-10-21: racing bugs fixed in version 1.1), with the
// same thank-you note. (Each waits until that account exists here.)
for (const name of ['beachrat', 'ttnomanchas']) {
  const key = 'bughunter_' + name + '_v1'; if (getMeta(key)) continue;
  const u = Object.values(readAccounts()).find(a => a && a.name && a.name.toLowerCase() === name);
  if (!u) continue;
  setMeta(key, Date.now());
  const sent = gift(u.id, 'bughunter', 'Thank you for helping improve the game\n-PolyWeave');
  console.log(`Bug Hunter for ${u.name}: ${sent ? 'sent' : 'already had / waiting'}`);
}

// Leaderboard bans (once each, 2026-10-22): lmaoooo permanently (faked runs: made-up near misses, every run kept
// under 30 s to slip past the old check), BWOMACK for 7 days from when this first runs (his 1.97M mp run, 4 min after
// lmaoooo's on the same server) - when it ends his scores and stats reset (db.js endBan). Each waits for the account.
for (const [name, days] of [['lmaoooo', 0], ['bwomack', 7]]) {
  const key = 'ban_' + name + '_v1'; if (getMeta(key)) continue;
  const u = Object.values(readAccounts()).find(a => a && a.name && a.name.toLowerCase() === name);
  if (!u) continue;
  setMeta(key, Date.now());
  setBanned(u.id, true, days);
  console.log(`Leaderboard ban: ${u.name} ${days ? 'for ' + days + ' days' : 'permanently'}`);
}

// Season 1 (once, 2026-10-19): the beta is over. New accounts stop getting Beta Tester (players who have it keep
// it); the beta leaderboards stay as their own season (0) and every board starts fresh for Season 1.
if (!getMeta('season1_v1')) {
  setMeta('season1_v1', Date.now());
  setBetaOpen(false);
  console.log('database: Season 1 started (beta closed: no more Beta Tester; beta leaderboards kept as season 0)');
}

// End of a season: the top 5 of its singleplayer and multiplayer leaderboards get the season's title
// (1st Champion, 2nd-3rd Finalist, 4th-5th Podium: Titles.SEASON_REWARDS) in their inbox, and the racing boards'
// 1st / 2nd / 3rd on every track (Track / Race Champion, Finalist, Podium: Titles.RACE_REWARDS). node admin.js season-rewards 1
function seasonRewards(season) {
  const sent = [];
  for (const mode of MODES) for (const e of top(mode, 5, season)) {
    const id = Titles.seasonReward(season, e.rank);
    if (id && gift(e.uid, id, `Season ${season} · ${mode === 'mp' ? 'multiplayer' : 'singleplayer'} leaderboard · #${e.rank}`)) sent.push({ uid: e.uid, mode, rank: e.rank, title: id });
  }
  // racing: 1st / 2nd / 3rd on every track's time-trial and races boards (a title won on two tracks comes once)
  for (const t of Tracks.TRACKS) for (const [board, list] of [['tt', lapTop(t.id, 3, season)], ['races', raceTop(t.id, 3, season)]]) for (const e of list) {
    const id = Titles.seasonReward(season, e.rank, board);
    if (id && gift(e.uid, id, `Season ${season} · ${t.name} ${board === 'tt' ? 'time trials' : 'races'} · #${e.rank}`)) sent.push({ uid: e.uid, mode: board + ':' + t.id, rank: e.rank, title: id });
  }
  return sent;
}

module.exports = {
  db, SEASON, SEASONS, SECRET, lapTop, lapAround, addLap, addRace, raceTop, raceAround, seasonRewards, ensureUser, grant, gift, inboxOf, unclaimed, claim, top, around, rankOf, bestOf, addRun, spendToken, profile, addPlayTime,
  titlesOf, ownerCounts, alphaOpen, setAlphaOpen, betaOpen, setBetaOpen, resetTitles, statTitles, statsOf, pendingOf, equipped, equip, isBanned, banUntil, setBanned, sweepBans, flagRacing, adminUid, adminLog, adminLogList, owns, addRequest, getRequest, decideRequest, requestList, waitingRequests, sendNote, adminRuns, adminLaps, adminRaces, setLapStatus, adminOverview, userRow, readAccounts, setRemoved, removeAbove, runsOf, runLog, recentRejected,
  areFriends, friendsOf, requestsIn, requestsOut, socialSettings, setSocialSettings, sendRequest, respond, cancelRequest, unfriend,
  sendMessage, chatWith, markRead, unreadBy, GROUP_MAX, groupOf, groupMembers, inGroup, groupSay, createGroup, addToGroup, removeFromGroup, renameGroup, groupMessages, markGroupRead, groupsOf, OWNER_NAMES, BIKE_NAMES, addReferral, referralStats, referredBy, busProgress, hasBus,
};
