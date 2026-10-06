'use strict';
// =====================================================================
//  Leaderboards: the top 100 drives for each mode ('sp' singleplayer, 'mp' multiplayer).
//  Permanent storage = an Upstash Redis database (free tier) when the server has the environment
//  variables UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (Render: Environment tab).
//  Without them it keeps a local file: permanent on a server with its own disk (AWS Lightsail: the setup
//  script sets LB_PERSIST=1), but a free Render server loses it whenever it restarts.
// =====================================================================
const fs = require('fs');
const path = require('path');

const RURL = process.env.UPSTASH_REDIS_REST_URL, RTOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = !!(RURL && RTOKEN);
const persistent = useRedis || process.env.LB_PERSIST === '1';
const FILE = path.join(__dirname, 'leaderboard.json');
const TOP = 100, MODES = ['sp', 'mp'];
// Raise RESET to wipe both leaderboards (e.g. a new season): older entries are simply left behind.
const RESET = 2, KEY = m => 'lb' + RESET + ':' + m;

let local = { sp: [], mp: [] };
if (!useRedis) {
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (j.reset === RESET) for (const m of MODES) if (Array.isArray(j[m])) local[m] = j[m]; } catch (e) { /* no file yet */ }
}
let saveT = null;
const saveLocal = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(FILE, JSON.stringify(Object.assign({ reset: RESET }, local)), () => {}), 1000); };

async function redis(cmd) {
  const r = await fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOKEN }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// One entry per driver: only their best drive is kept (a better drive replaces it).
const keyOf = e => e.uid || 'name:' + e.name;
const bestPerDriver = list => {                       // (also tidies up any older duplicate entries)
  const seen = new Set();
  return list.filter(e => { const k = keyOf(e); if (seen.has(k)) return false; seen.add(k); return true; });
};

const cache = {};   // mode -> { t, list }
async function top(mode) {
  if (!MODES.includes(mode)) return [];
  const c = cache[mode];
  if (c && Date.now() - c.t < 5000) return c.list;
  let list;
  if (useRedis) {
    const res = await redis(['ZREVRANGE', KEY(mode), 0, TOP * 2]);
    list = (res || []).map(m => { try { return JSON.parse(m); } catch (e) { return null; } }).filter(Boolean);
  } else list = local[mode].slice();
  list = bestPerDriver(list.sort((a, b) => b.score - a.score)).slice(0, TOP);
  cache[mode] = { t: Date.now(), list };
  return list;
}

// add one drive. Returns { rank, best }: rank 1-100 when this drive is now the driver's entry on the
// board, null when it didn't beat their best (or didn't make the top 100); best = their best score.
async function add(mode, name, score, extra = {}) {
  if (!MODES.includes(mode)) return { rank: null };
  const entry = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name, score: Math.round(score), t: Date.now() }, extra);
  const key = keyOf(entry);
  const old = (await top(mode)).find(e => keyOf(e) === key)
    || (useRedis ? null : local[mode].find(e => keyOf(e) === key));
  if (old && old.score >= entry.score) return { rank: null, best: old.score };   // not a new best: board unchanged
  if (useRedis) {
    // remove this driver's previous entries, add the new best, keep the board trimmed
    const res = await redis(['ZREVRANGE', KEY(mode), 0, -1]);
    for (const m of res || []) { let e = null; try { e = JSON.parse(m); } catch (x) { /* skip */ } if (e && keyOf(e) === key) await redis(['ZREM', KEY(mode), m]); }
    await redis(['ZADD', KEY(mode), entry.score, JSON.stringify(entry)]);
    await redis(['ZREMRANGEBYRANK', KEY(mode), 0, -(TOP * 2 + 1)]);
  } else {
    const L = local[mode].filter(e => keyOf(e) !== key);
    L.push(entry); L.sort((a, b) => b.score - a.score); if (L.length > TOP) L.length = TOP;
    local[mode] = L;
    saveLocal();
  }
  delete cache[mode];
  const list = await top(mode), i = list.findIndex(e => e.id === entry.id);
  return { rank: i >= 0 ? i + 1 : null, best: entry.score, improved: true };
}

module.exports = { top, add, persistent };
