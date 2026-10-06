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

let local = { sp: [], mp: [] };
if (!useRedis) {
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); for (const m of MODES) if (Array.isArray(j[m])) local[m] = j[m]; } catch (e) { /* no file yet */ }
}
let saveT = null;
const saveLocal = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(FILE, JSON.stringify(local), () => {}), 1000); };

async function redis(cmd) {
  const r = await fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOKEN }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const cache = {};   // mode -> { t, list }
async function top(mode) {
  if (!MODES.includes(mode)) return [];
  const c = cache[mode];
  if (c && Date.now() - c.t < 5000) return c.list;
  let list;
  if (useRedis) {
    const res = await redis(['ZREVRANGE', 'lb:' + mode, 0, TOP - 1]);
    list = (res || []).map(m => { try { return JSON.parse(m); } catch (e) { return null; } }).filter(Boolean);
  } else list = local[mode].slice(0, TOP);
  cache[mode] = { t: Date.now(), list };
  return list;
}

// add one drive; returns its rank (1-100) or null if it didn't make the top 100
async function add(mode, name, score, extra = {}) {
  if (!MODES.includes(mode)) return null;
  const entry = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name, score: Math.round(score), t: Date.now() }, extra);
  if (useRedis) {
    await redis(['ZADD', 'lb:' + mode, entry.score, JSON.stringify(entry)]);
    await redis(['ZREMRANGEBYRANK', 'lb:' + mode, 0, -(TOP + 1)]);       // keep only the top 100
  } else {
    const L = local[mode];
    L.push(entry); L.sort((a, b) => b.score - a.score); if (L.length > TOP) L.length = TOP;
    saveLocal();
  }
  delete cache[mode];
  const list = await top(mode), i = list.findIndex(e => e.id === entry.id);
  return i >= 0 ? i + 1 : null;
}

module.exports = { top, add, persistent };
