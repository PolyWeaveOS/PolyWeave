'use strict';
// =====================================================================
//  Score (NoHesi-style streak) + HUD + synthesized engine audio
// =====================================================================
const $ = id => document.getElementById(id);
// near miss / close call points vs your speed (km/h): x1/4 at 100, x1 at 175, x2 at 230
const NEAR_MISS_SPEED = mcurve([[60, 0.08], [100, 0.25], [130, 0.45], [150, 0.66], [175, 1], [200, 1.4], [230, 2], [260, 2.6], [300, 3.3]]);

class Score {
  constructor(hud) {
    this.hud = hud;
    this.score = 0; this.pot = 0; this.mult = 1; this.timer = 0;
    this.best = +(localStorage.getItem('tw_best') || 0) || 0;
    this.COMBO_TIME = 5.5;
  }
  // Points go straight onto the score (x current multiplier). "pot" just shows what the
  // current combo has earned; when the combo timer runs out the multiplier resets to x1.
  add(pts) {
    const v = pts * this.mult * (this.prox || 1);     // prox: multiplayer proximity bonus (driving close to another player)
    if (!Number.isFinite(v)) return 0;          // never let a bad value poison the score
    if (this.score < 1) { this.bestBefore = this.best; this.peakMult = 1; this.runTime = 0; }   // a new streak starts
    this.score += v; this.pot += v;
    this.peakMult = Math.max(this.peakMult || 1, this.mult);
    this.saveBest();
    return v;
  }
  nearMiss(gap, kmh) {
    const close = U.clamp(1 - gap / 1.15, 0, 1);
    // your speed scales the points: x1 at 175 km/h, x2 at 230, x1/4 at 100 (smooth in between)
    const pts = Math.round((90 + 460 * close * close) * NEAR_MISS_SPEED(kmh) * 1.25);
    this.mult = +(this.mult + 0.1).toFixed(1); // no cap (NoHesi style)
    const got = Math.round(this.add(pts));
    this.timer = 1;
    this.hud.message(gap < 0.3 ? `CLOSE CALL +${U.fmt(got)}` : `NEAR MISS +${U.fmt(got)}`);
    this.hud.potBump();
  }
  speed(dt, kmh) {
    // below 130 km/h the multiplier bleeds away (faster the slower you go), never under x1
    if (kmh < 130 && this.mult > 1) this.mult = Math.max(1, this.mult - (0.25 + (130 - kmh) / 80) * dt);
    if (kmh < 130) return;
    this.add((kmh - 130) * 0.55 * dt);
    if (this.timer <= 0) this.timer = 1;
  }
  update(dt) {
    if (this.score >= 1) this.runTime = (this.runTime || 0) + dt;   // how long this streak has lasted (shown on the leaderboard)
    if (this.pot > 0) {
      this.timer -= dt / this.COMBO_TIME;
      if (this.timer <= 0) this.endCombo();
    }
  }
  endCombo() { // banks the combo; the multiplier carries on (it only drops below 130 km/h or on a crash)
    const had = this.pot >= 1;
    this.pot = 0; this.timer = 0;
    if (had) this.hud.bank();
  }
  // Driving on the shoulder: lose 10% of your points (banked + pending) every second
  // returns the points lost this frame
  shoulder(dt) {
    const k = Math.pow(0.9, dt), before = this.score;
    this.score *= k; this.pot *= k;
    if (this.score < 1) this.score = 0;
    if (this.pot < 1 && this.pot > 0) { this.pot = 0; this.timer = 0; this.hud.potHide(); }
    return before - this.score;
  }
  // a streak ends (crash or restart): show what it was worth before the score goes back to 0
  endStreak() {
    if (this.score < 1) return;
    this.hud.showResult(this.score, this.peakMult || this.mult, this.score > (this.bestBefore ?? 0) + 0.5);
    if (this.onStreakEnd) this.onStreakEnd(Math.round(this.score), this.peakMult || this.mult, Math.round(this.runTime || 0));   // (scored runs -> leaderboard)
  }
  crash() { this.lose(this.score > 0 || this.pot > 1 ? 'CRASH, STREAK LOST' : 'CRASH'); }
  // the streak ends (crash, too long on the shoulder): show its result, back to zero
  lose(msg) {
    this.endStreak();
    this.score = 0; this.pot = 0; this.mult = 1; this.timer = 0;
    this.hud.message(msg, true);
    this.hud.potHide();
  }
  reset() {
    this.endStreak();
    this.score = 0; this.pot = 0; this.mult = 1; this.timer = 0;
    this.hud.potHide(); this.hud.shownScore = 0; this.hud.el.msgs.innerHTML = '';
  }
  saveBest() {
    if (this.score > this.best) { this.best = this.score; try { localStorage.setItem('tw_best', this.best); } catch (e) { /* ignore */ } }
  }
}

class Hud {
  constructor() {
    this.el = { score: $('scoreVal'), best: $('best'), pot: $('potVal'), mult: $('mult'), potRow: $('potRow'), bar: $('barFill'), msgs: $('msgs'),
      spd: $('spdVal'), gear: $('gear'), mode: $('gearMode'), rpm: $('rpmFill'), la: $('tagLA'), tc: $('tagTC'), pad: $('tagPad') };
    this.shownScore = 0; this.last = {};
  }
  set(key, el, val, prop = 'textContent') { if (this.last[key] !== val) { this.last[key] = val; el[prop] = val; } }
  message(text, crash = false) {
    const m = document.createElement('div');
    m.className = 'msg' + (crash ? ' crash in2' : '');
    m.textContent = text;
    this.el.msgs.prepend(m);
    while (this.el.msgs.children.length > 3) this.el.msgs.lastChild.remove();
    setTimeout(() => { m.classList.add('out'); setTimeout(() => m.remove(), 460); }, crash ? 2200 : 1500);
  }
  // lost = points lost during this trip onto the shoulder (shown live; stays readable while it fades out)
  // end-of-streak card under the score: final points, best multiplier, NEW BEST (stays ~5 s)
  showResult(points, peak, isBest) {
    const box = this.el.result || (this.el.result = document.getElementById('result'));
    document.getElementById('rVal').textContent = U.fmt(points);
    document.getElementById('rSub').innerHTML = `TOP MULTIPLIER ×${peak.toFixed(1)}` + (isBest ? ' · <b>NEW BEST!</b>' : '');
    box.classList.remove('on'); void box.offsetWidth; box.classList.add('on');
    clearTimeout(this._resT);
    this._resT = setTimeout(() => box.classList.remove('on'), 5200);
  }
  shoulderWarn(on, lost) {
    const w = this.el.warn || (this.el.warn = document.getElementById('warn'));
    if (!w) return;
    if (on) this.set('warn', w, `SHOULDER −${U.fmt(Math.round(lost))}`);
    if (w.classList.contains('on') !== on) w.classList.toggle('on', on);
  }
  potBump() { const p = this.el.pot; p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
  potHide() { this.el.potRow.classList.remove('on', 'bank'); }
  bank() {
    const r = this.el.potRow;
    r.classList.add('bank');
    setTimeout(() => r.classList.remove('on', 'bank'), 460);
    this.el.score.classList.add('pulse');
    setTimeout(() => this.el.score.classList.remove('pulse'), 260);
  }
  update(dt, car, score, steerCtl, settings) {
    const e = this.el;
    // score count-up animation
    this.shownScore = score.score < this.shownScore ? score.score : U.damp(this.shownScore, score.score, 7, dt);
    if (score.score - this.shownScore < 1) this.shownScore = score.score;
    this.set('score', e.score, U.fmt(this.shownScore));
    this.set('best', e.best, 'BEST ' + U.fmt(score.best));
    if (score.pot > 0) {
      if (!e.potRow.classList.contains('on')) e.potRow.classList.add('on');
      e.potRow.classList.remove('bank');
      this.set('pot', e.pot, '+' + U.fmt(score.pot));
      this.set('mult', e.mult, '×' + score.mult.toFixed(1));
    }
    e.bar.style.width = (U.clamp(score.timer, 0, 1) * 100).toFixed(1) + '%';
    // speedo
    const kmh = Math.round(Math.abs(car.u) * 3.6);
    this.set('spd', e.spd, String(kmh));
    this.set('gear', e.gear, car.gear < 0 ? 'R' : car.gear === 0 ? 'N' : String(car.gear));
    this.set('mode', e.mode, car.manual ? 'MANUAL' : 'AUTO');
    e.rpm.style.width = (U.clamp(car.rpm / M4.redline, 0, 1) * 100).toFixed(1) + '%';
    e.rpm.classList.toggle('limit', car.limiter);
    this.set('la', e.la, this.trafficLabel || `TRAFFIC ${Math.round(settings.density * 100)}%`);
    this.set('tc', e.tc, (car.tc ? 'TC' : 'TC OFF') + (settings.assist > 0 ? ` · LANE ASSIST ${Math.round(settings.assist * 100)}%${steerCtl.assistActive > 0.05 ? ' ●' : ''}` : ''));
    this.set('pad', e.pad, Input.padKind === 'wheel' && Input.wheelUsed ? 'WHEEL' : Input.padKind === 'gamepad' ? 'PAD' : '');
  }
}

// ---------- Engine / wind / tyre audio (WebAudio synthesis) ----------
class Sound {
  constructor() { this.ctx = null; }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(ctx.destination);
    // engine: three detuned oscillators through a resonant low-pass
    this.eng = ctx.createGain(); this.eng.gain.value = 0;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 3;
    this.eng.connect(this.lp); this.lp.connect(this.master);
    this.oscs = [['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['sawtooth', 2.005, 0.18]].map(([t, mul, g]) => {
      const o = ctx.createOscillator(), gg = ctx.createGain(); o.type = t; gg.gain.value = g; o.connect(gg); gg.connect(this.eng); o.start(); return { o, mul };
    });
    // noise source for wind + tyre squeal
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mk = (type, f, q) => { const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; n.connect(fl); fl.connect(g); g.connect(this.master); n.start(); return g; };
    this.wind = mk('bandpass', 700, 0.5);
    this.squeal = mk('bandpass', 1300, 9);
  }
  update(car, throttle, vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, f = car.rpm / 60 * 3; // inline-6 firing frequency
    for (const o of this.oscs) o.o.frequency.setTargetAtTime(f * o.mul, t, 0.02);
    this.lp.frequency.setTargetAtTime(300 + throttle * 2200 + car.rpm * 0.25, t, 0.05);
    this.eng.gain.setTargetAtTime((0.05 + throttle * 0.1) * (car.limiter ? 0.6 : 1), t, 0.04);
    const s = car.speed / 80;
    this.wind.gain.setTargetAtTime(Math.min(0.35, s * s * 0.3), t, 0.1);
    this.squeal.gain.setTargetAtTime(car.skid * 0.12, t, 0.05);
    this.master.gain.setTargetAtTime(vol, t, 0.05);
  }
  suspend(on) { if (this.ctx) on ? this.ctx.suspend() : this.ctx.resume(); }
  thump(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(110, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.25);
    g.gain.setValueAtTime(Math.min(1, strength), ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.connect(g); g.connect(this.master); o.start(); o.stop(ctx.currentTime + 0.4);
  }
}
