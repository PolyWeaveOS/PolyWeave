'use strict';
// =====================================================================
//  Input: keyboard (WASD), steering wheels (Logitech G923/G29 etc.) and
//  standard gamepads. Wheels are read through the Gamepad API; because
//  browsers expose pedal axes differently per OS/driver, a calibration
//  tool in the menu lets the player assign axes in a few seconds.
// =====================================================================

const PAD_DEFAULTS = {
  steer: { axis: 0, inv: false },
  throttle: { axis: 1, rest: 1, full: -1 },
  brake: { axis: 5, rest: 1, full: -1 },
  cam: 3, up: 4, down: 5, reset: 2,
};

// keyboard actions -> keys (first key can be changed in Settings; arrows stay as a backup for driving)
const KEY_DEFAULTS = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'], shiftUp: ['KeyE'], shiftDown: ['KeyQ'], gearbox: ['KeyG'], camera: ['KeyC'], reset: ['KeyR'], style: ['KeyT'],
  map: ['KeyM'],
};
const KEY_NAMES = {
  throttle: 'Throttle', brake: 'Brake / reverse', left: 'Steer left', right: 'Steer right', handbrake: 'Handbrake',
  shiftUp: 'Shift up', shiftDown: 'Shift down', gearbox: 'Auto / manual gearbox', camera: 'Camera (1st / 3rd person)',
  reset: 'Reset car', style: 'Visual style', map: 'Big map (multiplayer)',
};
const keyLabel = c => ({ Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace' }[c]
  || c.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ') );

const Input = {
  keys: {}, pressed: {},
  pad: null, padKind: 'none', padId: '',
  cfg: JSON.parse(JSON.stringify(PAD_DEFAULTS)),
  binds: JSON.parse(JSON.stringify(KEY_DEFAULTS)), capture: null,
  moved: {}, rest0: null, lastBtns: [], wheelUsed: false, lastWheelMove: -1e9,
  cal: null,
  out: { steer: 0, throttle: 0, brake: 0, handbrake: 0, source: 'keys' },

  down(a) { for (const c of this.binds[a]) if (this.keys[c]) return true; return false; },
  tap(a) { for (const c of this.binds[a]) if (this.pressed[c]) return true; return false; },
  saveBinds() { try { localStorage.setItem('tw_keys', JSON.stringify(this.binds)); } catch (e) { /* ignore */ } },
  resetBinds() { this.binds = JSON.parse(JSON.stringify(KEY_DEFAULTS)); this.saveBinds(); },

  init() {
    try { const c = JSON.parse(localStorage.getItem('tw_pad') || 'null'); if (c) this.cfg = Object.assign(this.cfg, c); } catch (e) { /* ignore */ }
    try { const b = JSON.parse(localStorage.getItem('tw_keys') || 'null'); if (b) for (const a in KEY_DEFAULTS) if (Array.isArray(b[a]) && b[a].length) this.binds[a] = b[a]; } catch (e) { /* ignore */ }
    addEventListener('keydown', e => {
      // waiting for a new key in Settings: that key becomes the action's main key (Esc cancels)
      if (this.capture) {
        e.preventDefault();
        const { action, done } = this.capture; this.capture = null;
        if (e.code !== 'Escape') { const b = this.binds[action]; b[0] = e.code; this.saveBinds(); }
        if (done) done(e.code !== 'Escape');
        return;
      }
      // typing in a text box (multiplayer name / room code) never drives the car
      if (e.target && (e.target.tagName === 'INPUT' && e.target.type === 'text')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
  },
  save() { try { localStorage.setItem('tw_pad', JSON.stringify(this.cfg)); } catch (e) { /* ignore */ } },
  hit(code) { const p = !!this.pressed[code]; return p; },
  endFrame() { this.pressed = {}; },

  findPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let best = null;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const wheel = /wheel|g923|g29|g920|logitech|driving force|racing/i.test(p.id);
      if (wheel) { best = p; this.padKind = 'wheel'; break; }
      if (!best) { best = p; this.padKind = p.mapping === 'standard' ? 'gamepad' : 'wheel'; }
    }
    if (!best) this.padKind = 'none';
    this.pad = best; this.padId = best ? best.id : '';
    return best;
  },

  pedal(p, c) {
    const v = p.axes[c.axis];
    if (!Number.isFinite(v) || !c || Math.abs(c.full - c.rest) < 0.05) return 0; // bad axis / bad calibration
    // Chrome reports 0 for untouched pedals until they move once
    if (!this.moved[c.axis]) { if (Math.abs(v - c.rest) < 0.02) this.moved[c.axis] = true; else if (v === 0) return 0; else this.moved[c.axis] = true; }
    return U.clamp((v - c.rest) / (c.full - c.rest), 0, 1);
  },

  btnEdge(p, i) { return i >= 0 && p.buttons[i] && p.buttons[i].pressed && !this.lastBtns[i]; },

  update(now, dt) {
    const o = this.out;
    const ks = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    const kt = this.down('throttle') ? 1 : 0, kb = this.down('brake') ? 1 : 0;
    // keyboard pedals ramp so taps feel analog
    o.kt = U.clamp((o.kt || 0) + (kt ? 4.5 : -7) * dt, 0, 1);
    o.kb = U.clamp((o.kb || 0) + (kb ? 9 : -9) * dt, 0, 1); // brake bites in ~0.1 s
    o.steer = ks; o.throttle = o.kt; o.brake = o.kb; o.handbrake = this.down('handbrake') ? 1 : 0;
    o.source = 'keys';
    o.camBtn = false; o.up = false; o.down = false; o.reset = false;

    const p = this.findPad();
    if (p) {
      if (this.cal) this.calTick(p, now);
      if (this.padKind === 'gamepad') {
        let sx = p.axes[0] || 0; sx = Math.abs(sx) < 0.1 ? 0 : Math.sign(sx) * Math.pow((Math.abs(sx) - 0.1) / 0.9, 1.6);
        const gt = p.buttons[7] ? p.buttons[7].value : 0, gb = p.buttons[6] ? p.buttons[6].value : 0;
        if (Math.abs(sx) > 0 && !ks) { o.steer = sx; }
        if (gt > 0.02) o.throttle = Math.max(o.throttle, gt);
        if (gb > 0.02) o.brake = Math.max(o.brake, gb);
        if (p.buttons[0] && p.buttons[0].pressed) o.handbrake = 1;
        o.camBtn = this.btnEdge(p, 3); o.up = this.btnEdge(p, 5); o.down = this.btnEdge(p, 4); o.reset = this.btnEdge(p, 8);
      } else {
        const c = this.cfg;
        let st = p.axes[c.steer.axis] || 0; if (c.steer.inv) st = -st;
        if (Math.abs(st) < 0.004) st = 0;
        if (this.prevSt === undefined) this.prevSt = st;
        if (Math.abs(st - this.prevSt) > 0.01) { this.wheelUsed = true; this.lastWheelMove = now; }
        this.prevSt = st;
        const th = this.pedal(p, c.throttle), br = this.pedal(p, c.brake);
        if (th > 0.03 || br > 0.03) this.wheelUsed = true;
        // After steering with the keys, stay on the keyboard until the wheel is actually moved again
        // (a wheel resting slightly off centre must not take over the moment a key is released).
        if (ks) this.lastKeySteer = now;
        if (this.wheelUsed && !ks && this.lastWheelMove > (this.lastKeySteer || -1e9)) { o.steer = st; o.source = 'wheel'; }
        o.throttle = Math.max(o.throttle, th);
        o.brake = Math.max(o.brake, br);
        o.camBtn = this.btnEdge(p, c.cam); o.up = this.btnEdge(p, c.up); o.down = this.btnEdge(p, c.down); o.reset = this.btnEdge(p, c.reset);
      }
      this.lastBtns = p.buttons.map(b => b.pressed);
    }
    return o;
  },

  // ---- calibration ----
  startCal(what, msg) {
    const p = this.findPad();
    if (!p) { msg('No wheel / controller detected. Press a pedal or button first so the browser can see it.'); return; }
    this.cal = { what, msg, t0: performance.now(), base: p.axes.slice(), btn0: p.buttons.map(b => b.pressed), best: -1, bestD: 0, val: 0 };
    const txt = { steer: 'Hold the wheel centred... then turn it to the RIGHT (about 90°).', throttle: 'Press the THROTTLE pedal all the way down.', brake: 'Press the BRAKE pedal all the way down.', cam: 'Press the wheel button you want for camera toggle.' };
    msg(txt[what]);
  },
  calTick(p, now) {
    const c = this.cal, t = now - c.t0;
    if (t > 8000) { c.msg('Calibration timed out.'); this.cal = null; return; }
    if (c.what === 'cam') {
      for (let i = 0; i < p.buttons.length; i++) if (p.buttons[i].pressed && !c.btn0[i]) { this.cfg.cam = i; this.save(); c.msg(`Camera button set to button ${i}.`); this.cal = null; return; }
      return;
    }
    if (t < 500) { c.base = p.axes.slice(); return; }
    for (let i = 0; i < p.axes.length; i++) {
      const dlt = Math.abs(p.axes[i] - c.base[i]);
      if (dlt > c.bestD) { c.bestD = dlt; c.best = i; c.val = p.axes[i]; }
    }
    const need = c.what === 'steer' ? 0.12 : 0.8;
    if (c.bestD > need) {
      const i = c.best;
      if (!c.hold) c.hold = now;
      if (now - c.hold > 600) {
        if (c.what === 'steer') { this.cfg.steer = { axis: i, inv: c.val < c.base[i] }; }
        else { this.cfg[c.what] = { axis: i, rest: c.base[i], full: p.axes[i] }; this.moved[i] = true; }
        this.save();
        c.msg(`${c.what[0].toUpperCase() + c.what.slice(1)} assigned to axis ${i}.`);
        this.cal = null;
      }
    }
  },
  resetCal() { this.cfg = JSON.parse(JSON.stringify(PAD_DEFAULTS)); this.moved = {}; this.save(); },
};
