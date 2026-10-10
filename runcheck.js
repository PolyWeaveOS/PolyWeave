'use strict';
// =====================================================================
//  Run verification: stops faked leaderboard scores.
//  1. Run tokens: the server signs { account, mode, start time, nonce } when a scored run can start.
//     A run must come back with its token, only once, and can't be longer than the time since the
//     token was issued.
//  2. Event log: the game records every scoring event of the run (js/hud.js RunLog). The server
//     replays it with the same formulas and the same limits (top speed, multiplier cap, near-miss
//     rate) and only accepts the run if the replay gives the claimed score.
//  Log events (times are seconds since the streak started):
//    [0, t, gap, kmh, pts]  near miss           (multiplier +0.1, max 100, then pts x mult x prox)
//    [1, t, dur, base]      speed points chunk  (base = sum of (km/h - 130) x 0.55 x dt over `dur` seconds)
//    [2, t, prox]           proximity bonus changed (multiplayer only, 1 - 10)
//    [3, t, dur]            shoulder: score x 0.9^dur
//    [4, t, mult]           multiplier drained (below 130 km/h): new, lower value
// =====================================================================
const crypto = require('crypto');

const VMAX_KMH = 290;            // the car's top speed (js/physics.js M4.vmax)
const MULT_CAP = 100;            // near-miss multiplier cap (js/hud.js)
const PROX_MAX = 10;             // multiplayer proximity bonus at its closest (js/main.js PROX_CURVE)
const MAX_EVENTS = 400000;

// same curve as js/hud.js NEAR_MISS_SPEED (monotone cubic, copied from js/models.js mcurve)
function mcurve(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0]);
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const NEAR_MISS_SPEED = mcurve([[60, 0.08], [100, 0.25], [130, 0.45], [150, 0.66], [175, 1], [200, 1.4], [230, 2], [260, 2.6], [300, 3.3]]);
const nearMissPts = (gap, kmh) => { const close = Math.min(1, Math.max(0, 1 - gap / 1.15)); return Math.round((90 + 460 * close * close) * NEAR_MISS_SPEED(kmh) * 1.25); };

// ---------------------------------------------------------------- run tokens
const b64 = s => Buffer.from(s).toString('base64url');
function makeTokens(secret) {
  const sign = body => crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return {
    // fields: u = account id, m = mode, r = room (multiplayer); adds t = issue time, n = nonce
    issue(fields) {
      const body = b64(JSON.stringify(Object.assign({}, fields, { t: Date.now(), n: crypto.randomBytes(9).toString('base64url') })));
      return body + '.' + sign(body);
    },
    read(token) {
      if (typeof token !== 'string' || token.length > 600) return null;
      const [body, sig] = token.split('.');
      if (!body || !sig) return null;
      const want = sign(body);
      if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
      try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (e) { return null; }
    },
  };
}

// ---------------------------------------------------------------- replay
// run: { score, dur, log: [...] }  ctx: { mode, wallS (seconds since the token), mp: { dist (m), nearS } | null }
// returns { ok: true, stats } or { ok: false, why }
function verify(run, ctx) {
  const fail = why => ({ ok: false, why });
  const claimed = run.score, dur = run.dur, ev = run.log;
  if (!Number.isFinite(claimed) || claimed < 0) return fail('bad score');
  if (!Number.isFinite(dur) || dur < 0) return fail('bad duration');
  if (!Array.isArray(ev) || ev.length > MAX_EVENTS) return fail('bad log');
  if (dur > ctx.wallS + 3) return fail(`run is ${dur.toFixed(0)} s but only ${ctx.wallS.toFixed(0)} s passed`);
  let score = 0, mult = 1, prox = 1, lastT = 0, chunkEnd = 0;
  let near = 0, topKmh = 0, peak = 1, speedBase = 0, proxS = 0;
  const win = [];                                      // near-miss times in the last 2 s
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (!Array.isArray(e) || !e.every(Number.isFinite)) return fail(`event ${i}: malformed`);
    const [k, t] = e;
    if (t < lastT - 0.02 || t > dur + 2) return fail(`event ${i}: time out of order`);
    lastT = Math.max(lastT, t);
    if (k === 0) {                                     // near miss
      const [, , gap, kmh, pts] = e;
      if (gap < 0 || gap > 1.2) return fail(`event ${i}: impossible near-miss gap`);
      if (kmh < 0 || kmh > VMAX_KMH + 3) return fail(`event ${i}: faster than the car can go`);
      const f = nearMissPts(gap, kmh);
      if (Math.abs(pts - f) > 1 + f * 0.002) return fail(`event ${i}: near-miss points don't match`);
      while (win.length && win[0] < t - 2) win.shift();
      win.push(t);
      // (passing a packed lane on each side at full speed allows ~14 a second at the very most; bursts are
      // allowed, the average over the whole run is checked at the end)
      if (win.length > 24) return fail(`event ${i}: too many near misses at once`);
      mult = Math.min(MULT_CAP, +(mult + 0.1).toFixed(1));
      score += pts * mult * prox;
      near++; topKmh = Math.max(topKmh, kmh); peak = Math.max(peak, mult);
    } else if (k === 1) {                              // speed points
      const [, , d, base] = e;
      if (!(d > 0 && d <= 5.5)) return fail(`event ${i}: bad speed chunk`);
      if (t - d < chunkEnd - 0.06) return fail(`event ${i}: overlapping speed chunks`);
      chunkEnd = t;
      if (base < 0 || base > (VMAX_KMH + 3 - 130) * 0.55 * d + 0.05) return fail(`event ${i}: faster than the car can go`);
      score += base * mult * prox;
      speedBase += base; if (prox > 1) proxS += d;
      topKmh = Math.max(topKmh, Math.min(VMAX_KMH, 130 + base / (0.55 * d)));
    } else if (k === 2) {                              // proximity bonus
      if (ctx.mode !== 'mp') return fail(`event ${i}: proximity bonus outside multiplayer`);
      if (!(e[2] >= 1 && e[2] <= PROX_MAX)) return fail(`event ${i}: bad proximity bonus`);
      prox = e[2];
    } else if (k === 3) {                              // shoulder
      if (!(e[2] > 0 && e[2] <= 3.6)) return fail(`event ${i}: bad shoulder time`);
      score *= Math.pow(0.9, e[2]); if (score < 1) score = 0;
    } else if (k === 4) {                              // multiplier drain
      if (!(e[2] >= 1 && e[2] <= mult + 1e-9)) return fail(`event ${i}: multiplier went up without a near miss`);
      mult = e[2];
    } else return fail(`event ${i}: unknown event`);
  }
  if (Math.abs(score - claimed) > 2 + claimed * 0.002) return fail(`log adds up to ${Math.round(score)}, not ${Math.round(claimed)}`);
  if (dur > 30 && near > dur * 4) return fail(`${near} near misses in ${Math.round(dur)} s is more than traffic allows`);
  // multiplayer: the server watched this player's position the whole time. Speed points per metre driven
  // are highest at top speed: (290 - 130) x 0.55 per (290 / 3.6) m = 1.093 per metre.
  if (ctx.mp) {
    const perMetre = (VMAX_KMH - 130) * 0.55 / (VMAX_KMH / 3.6);
    if (speedBase > ctx.mp.dist * perMetre * 1.05 + 60) return fail('speed points don\'t match how far the car actually went');
    if (proxS > ctx.mp.nearS * 1.25 + 4) return fail('proximity bonus without another player nearby');
  }
  return { ok: true, stats: { near, topKmh: Math.round(topKmh), peak, speedBase } };
}

module.exports = { makeTokens, verify, nearMissPts, VMAX_KMH, MULT_CAP };
