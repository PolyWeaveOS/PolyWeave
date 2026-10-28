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
  // wheel buttons (Settings > Controls > Wheel buttons): { b: button } or { a: axis, v: value } for a D-pad that's
  // a "hat" axis (most wheels in Chrome: one axis, a different value per direction, ~1.29 at rest). Logitech
  // G923 / G29 numbering: 0 cross, 1 square, 2 circle, 3 triangle, 4 / 5 right / left paddle, 9 the menu button.
  btn: { menu: { b: 9 }, select: { b: 0 }, back: null, navUp: { a: 9, v: -1 }, navDown: { a: 9, v: 0.1429 }, navLeft: { a: 9, v: 0.7143 },
    navRight: { a: 9, v: -0.4286 }, gearbox: null, up: { b: 4 }, down: { b: 5 }, cam: { b: 3 }, reset: { b: 2 } },
};
// what each wheel button can do (Settings list order)
const PAD_ACTIONS = [['menu', 'Menu / pause (like Esc)'], ['select', 'Menu: select'], ['back', 'Menu: back'], ['navUp', 'Menu: up'], ['navDown', 'Menu: down'],
  ['navLeft', 'Menu: left'], ['navRight', 'Menu: right'], ['gearbox', 'Auto / manual gearbox'], ['up', 'Shift up (paddle)'], ['down', 'Shift down (paddle)'],
  ['cam', 'Camera'], ['reset', 'Reset car']];
// standard controllers (Xbox / PlayStation pads): fixed buttons, D-pad for the menus
const PAD_STD = { menu: { b: 9 }, select: { b: 0 }, back: { b: 1 }, navUp: { b: 12 }, navDown: { b: 13 }, navLeft: { b: 14 }, navRight: { b: 15 },
  gearbox: { b: 2 }, up: { b: 5 }, down: { b: 4 }, cam: { b: 3 }, reset: { b: 8 } };
const HAT_NAMES = [[-1, 'D-pad ↑'], [0.1429, 'D-pad ↓'], [0.7143, 'D-pad ←'], [-0.4286, 'D-pad →']];

// keyboard actions -> keys (first key can be changed in Settings; arrows stay as a backup for driving)
const KEY_DEFAULTS = {
  throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  shiftUp: ['KeyE'], shiftDown: ['KeyQ'], gearbox: ['KeyG'], camera: ['KeyC'], reset: ['KeyR'], style: ['KeyT'],
  map: ['KeyM'],
};
const KEY_NAMES = {
  throttle: 'Throttle', brake: 'Brake / reverse', left: 'Steer left', right: 'Steer right',
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
  out: { steer: 0, throttle: 0, brake: 0, source: 'keys' },

  down(a) { for (const c of this.binds[a]) if (this.keys[c]) return true; return false; },
  tap(a) { for (const c of this.binds[a]) if (this.pressed[c]) return true; return false; },
  saveBinds() { try { localStorage.setItem('tw_keys', JSON.stringify(this.binds)); } catch (e) { /* ignore */ } },
  resetBinds() { this.binds = JSON.parse(JSON.stringify(KEY_DEFAULTS)); this.saveBinds(); },

  init() {
    try { const c = JSON.parse(localStorage.getItem('tw_pad') || 'null'); if (c) this.cfg = Object.assign(this.cfg, c); } catch (e) { /* ignore */ }
    // (older saves: no button list yet - start from the defaults, keeping a camera button picked before)
    if (!this.cfg.btn) { this.cfg.btn = JSON.parse(JSON.stringify(PAD_DEFAULTS.btn)); if (Number.isInteger(this.cfg.cam)) this.cfg.btn.cam = { b: this.cfg.cam }; }
    for (const [a] of PAD_ACTIONS) if (!(a in this.cfg.btn)) this.cfg.btn[a] = PAD_DEFAULTS.btn[a];
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
      // binding a wheel button in Settings: Esc cancels it
      if (this.padCap && e.code === 'Escape') { e.preventDefault(); const d = this.padCap.done; this.padCap = null; d(false); return; }
      // typing in a text box (multiplayer name / room code) never drives the car
      if (e.target && (e.target.tagName === 'INPUT' && e.target.type === 'text')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
    // last time the player did anything at all (keys, wheel, pedals, pad, mouse in the menus): AFK check
    this.lastActive = performance.now();
    const act = () => { this.lastActive = performance.now(); };
    addEventListener('keydown', act); addEventListener('pointerdown', act); addEventListener('pointermove', act); addEventListener('wheel', act);
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
    o.steer = ks; o.throttle = o.kt; o.brake = o.kb;
    o.source = 'keys';
    o.camBtn = false; o.up = false; o.down = false; o.reset = false;
    o.menu = false; o.select = false; o.back = false; o.gearbox = false; o.nav = null;

    const p = this.findPad();
    if (p) {
      if (this.cal) this.calTick(p, now);
      if (this.padCap) this.padBindTick(p, now);
      if (this.padKind === 'gamepad') {
        let sx = p.axes[0] || 0; sx = Math.abs(sx) < 0.1 ? 0 : Math.sign(sx) * Math.pow((Math.abs(sx) - 0.1) / 0.9, 1.6);
        const gt = p.buttons[7] ? p.buttons[7].value : 0, gb = p.buttons[6] ? p.buttons[6].value : 0;
        if (Math.abs(sx) > 0 && !ks) { o.steer = sx; }
        if (gt > 0.02) o.throttle = Math.max(o.throttle, gt);
        if (gb > 0.02) o.brake = Math.max(o.brake, gb);
        this.padButtons(p, PAD_STD, now, o);
      } else {
        const c = this.cfg;
        let st = p.axes[c.steer.axis] || 0; if (c.steer.inv) st = -st;
        if (Math.abs(st) < 0.004) st = 0;
        this.wheelPos = st;   // (force feedback: where the wheel actually is - js/ffb.js)
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
        if (!this.padCap) this.padButtons(p, c.btn, now, o);
      }
      // (wheel turned, pedal pressed, stick moved or a button held all count as activity)
      if (this.lastWheelMove === now || o.throttle > 0.05 || o.brake > 0.05 || (this.padKind === 'gamepad' && Math.abs(o.steer) > 0.05)
        || p.buttons.some(b => b.pressed)) this.lastActive = now;
      this.lastBtns = p.buttons.map(b => b.pressed);
    }
    if (ks || kt || kb) this.lastActive = now;   // a driving key held down
    return o;
  },

  // ---- wheel / controller buttons ----
  padDown(p, b) { return !!b && (b.b !== undefined ? !!(p.buttons[b.b] && p.buttons[b.b].pressed) : Math.abs((p.axes[b.a] ?? 99) - b.v) < 0.08); },
  // a press of each bound button (menu arrows repeat while held: after 0.45 s, every 0.13 s)
  padButtons(p, map, now, o) {
    const prev = this.padPrev || (this.padPrev = {}), hold = this.padHold || (this.padHold = {}), E = {};
    for (const [a] of PAD_ACTIONS) {
      const down = this.padDown(p, map[a]);
      E[a] = down && !prev[a];
      if (down && a.startsWith('nav')) { if (E[a]) hold[a] = now + 450; else if (now >= hold[a]) { E[a] = true; hold[a] = now + 130; } }
      prev[a] = down;
    }
    o.camBtn = E.cam; o.up = E.up; o.down = E.down; o.reset = E.reset;
    o.menu = E.menu; o.select = E.select; o.back = E.back; o.gearbox = E.gearbox;
    o.nav = { up: E.navUp, down: E.navDown, left: E.navLeft, right: E.navRight };
  },
  padLabel(a) {
    const b = this.cfg.btn[a];
    if (!b) return '—';
    if (b.b !== undefined) return 'Button ' + b.b;
    const h = HAT_NAMES.find(([v]) => Math.abs(v - b.v) < 0.05);
    return h ? `${h[1]} (axis ${b.a})` : `Axis ${b.a} (${b.v.toFixed(2)})`;
  },
  setPadBind(a, v) { this.cfg.btn[a] = v; this.save(); },
  resetPadBinds() { this.cfg.btn = JSON.parse(JSON.stringify(PAD_DEFAULTS.btn)); this.save(); },
  // waiting for a button (or a D-pad direction) for action a; done(true) / done(false: cancelled) / done('message')
  startPadBind(a, done) {
    if (!this.findPad()) { done('No wheel or controller found. Press a pedal or a button first so the browser can see it.'); return; }
    this.padCap = { a, done, t0: performance.now(), btn0: null, ax0: null };
  },
  padBindTick(p, now) {
    const c = this.padCap, t = now - c.t0;
    if (t > 8000) { this.padCap = null; c.done('Timed out: nothing was pressed.'); return; }
    if (!c.btn0) { c.btn0 = p.buttons.map(b => b.pressed); c.ax0 = p.axes.slice(); return; }
    if (t < 150) { c.btn0 = c.btn0.map((was, i) => was || p.buttons[i].pressed); return; }   // (the click that started it)
    for (let i = 0; i < p.buttons.length; i++) if (p.buttons[i].pressed && !c.btn0[i]) { this.finishPadBind({ b: i }); return; }
    // a D-pad that's an axis: never the steering / pedal axes
    const used = [this.cfg.steer.axis, this.cfg.throttle.axis, this.cfg.brake.axis];
    for (let i = 0; i < p.axes.length; i++) {
      if (used.includes(i)) continue;
      const v = p.axes[i], v0 = c.ax0[i];
      if (Math.abs(v - v0) > 0.3 && Math.abs(v) <= 1.01) { this.finishPadBind({ a: i, v: +v.toFixed(4) }); return; }
    }
  },
  finishPadBind(v) {
    const c = this.padCap; this.padCap = null;
    this.setPadBind(c.a, v);
    // (pressing it right after doesn't also trigger it)
    this.padPrev = this.padPrev || {}; this.padPrev[c.a] = true; if (c.a.startsWith('nav')) (this.padHold || (this.padHold = {}))[c.a] = performance.now() + 450;
    c.done(true);
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
