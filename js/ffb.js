// ---------- force feedback for steering wheels (and rumble for controllers) ----------
// Three ways to push back, picked per device:
//   'lg'   Logitech's classic wheel commands over WebHID (G923 PlayStation/PC, G29, G27, G25, DFGT, DFP...):
//          the wheel's own centring spring (stiffer with speed) + a constant force for weight, bumps and crashes
//   'pid'  the standard USB force feedback reports over WebHID (most other wheels: Thrustmaster, Fanatec,
//          Moza, Simagic, direct drives...): one constant force effect carrying everything, centring included
//   'rumble' the Gamepad API's vibration (controllers): bumps, crashes and rough ground only
// WebHID only exists in Chrome / Edge and needs one click on "Connect wheel" (the browser asks which device);
// after that the wheel is picked up again by itself. The Xbox G923 / G920 speak Logitech's HID++ instead and
// only get what the browser offers (nothing for wheels), so they're told so.
const FFB = (() => {
  const LG = [0xc294, 0xc295, 0xc298, 0xc299, 0xc29a, 0xc29b, 0xc24f, 0xc266, 0xc267];   // classic-protocol wheels
  const LG_HIDPP = [0xc262, 0xc26d, 0xc26e];                                             // G920 / G923 Xbox
  const NAMES = { 0xc294: 'Logitech Driving Force', 0xc295: 'Logitech MOMO', 0xc298: 'Logitech Driving Force Pro', 0xc299: 'Logitech G25',
    0xc29a: 'Logitech Driving Force GT', 0xc29b: 'Logitech G27', 0xc24f: 'Logitech G29', 0xc266: 'Logitech G923', 0xc267: 'Logitech G923' };
  const P = u => 0x000f0000 | u;   // a usage on the force feedback (PID) page
  let dev = null, kind = '', name = '', busy = false, lastSend = 0, lastLevel = null, lastSpring = -1, springT = 0;
  let pid = null, jolt = 0, joltSign = 1, t = 0, rumbleT = 0, testUntil = 0, idle = true;
  const S = () => (typeof Settings !== 'undefined' ? Settings : {});
  const cfg = () => ({ on: S().ffbOn !== false, str: S().ffbStr === undefined ? 0.6 : S().ffbStr, inv: !!S().ffbInv });
  const testLevel = () => 0.35 * (cfg().inv ? -1 : 1);   // (TEST FORCE: a firm push to the right)
  const el = id => document.getElementById(id);
  const status = msg => { const e = el('ffbStatus'); if (e) e.textContent = msg; };

  // ---------- HID report packing (for the standard reports) ----------
  const itemUsages = it => {
    if (it.isRange) { const a = []; for (let u = it.usageMinimum; u <= it.usageMaximum && a.length < 256; u++) a.push(u); return a; }
    return it.usages || [];
  };
  // every report of one type in every collection; when an id shows up twice keep the longest version
  function allReports(cols, type, out = new Map()) {
    for (const c of cols || []) {
      for (const r of c[type] || []) {
        const bits = (r.items || []).reduce((n, it) => n + it.reportSize * it.reportCount, 0);
        const had = out.get(r.reportId);
        if (!had || had.bits < bits) out.set(r.reportId, { id: r.reportId, items: r.items || [], bits });
      }
      allReports(c.children, type, out);
    }
    return out;
  }
  const has = (rep, u) => rep.items.some(it => itemUsages(it).includes(u));
  // fill(usage) -> value; array items get the position of the usage that fill() returns true for
  function pack(rep, fill) {
    const buf = new Uint8Array(Math.ceil(rep.bits / 8));
    let bit = 0;
    const put = (v, size) => { for (let i = 0; i < size; i++, bit++) if (i < 32 && (v >>> i) & 1) buf[bit >> 3] |= 1 << (bit & 7); };
    for (const it of rep.items) {
      const us = itemUsages(it);
      for (let k = 0; k < it.reportCount; k++) {
        let v = 0;
        if (!it.isConstant) {
          if (it.isArray) {
            const i = us.findIndex(u => fill(u, it) === true);
            v = i < 0 ? 0 : it.logicalMinimum + i;
          } else {
            const u = us[Math.min(k, us.length - 1)];
            const f = u === undefined ? undefined : fill(u, it);
            v = typeof f === 'number' ? Math.round(U.clamp(f, it.logicalMinimum, it.logicalMaximum)) : 0;
          }
        }
        if (v < 0) v = it.reportSize >= 32 ? v >>> 0 : v & ((1 << it.reportSize) - 1);   // (two's complement)
        put(v, it.reportSize);
      }
    }
    return buf;
  }
  function unpack(rep, data) {
    const out = {}; let bit = 0;
    for (const it of rep.items) {
      const us = itemUsages(it);
      for (let k = 0; k < it.reportCount; k++) {
        let v = 0;
        for (let i = 0; i < it.reportSize; i++, bit++) if (data[bit >> 3] >> (bit & 7) & 1) v |= 1 << i;
        if (it.isConstant) continue;
        if (it.isArray) { const u = us[v - it.logicalMinimum]; if (u !== undefined) out[u] = true; }
        else out[us[Math.min(k, us.length - 1)]] = v;
      }
    }
    return out;
  }

  function findPid(d) {
    const outs = [...allReports(d.collections, 'outputReports').values()];
    const feats = [...allReports(d.collections, 'featureReports').values()];
    const r = {
      setEffect: outs.find(x => has(x, P(0x22)) && has(x, P(0x50))),
      constant: outs.find(x => has(x, P(0x70)) && !has(x, P(0x72)) && !has(x, P(0x5b))),
      op: outs.find(x => has(x, P(0x79))),
      control: outs.find(x => has(x, P(0x97))),
      gain: outs.find(x => has(x, P(0x7e))),
      create: feats.find(x => has(x, P(0x26)) && !has(x, P(0x22))),
      load: feats.find(x => has(x, P(0x8b)) || has(x, P(0x8c))),
    };
    return r.setEffect && r.constant && r.op ? r : null;
  }
  const send = (rep, fill) => dev.sendReport(rep.id, pack(rep, fill));
  async function pidStart() {
    const r = pid;
    if (r.control) { await send(r.control, u => u === P(0x9a)); await send(r.control, u => u === P(0x97)); }   // reset, then motors on
    if (r.gain) await send(r.gain, (u, it) => (u === P(0x7e) ? it.logicalMaximum : undefined));
    r.block = 1;
    if (r.create) {
      await dev.sendFeatureReport(r.create.id, pack(r.create, (u, it) => (u === P(0x26) ? true : u === P(0x3b) ? 0 : undefined)));
      if (r.load) {
        try {
          let v = new Uint8Array((await dev.receiveFeatureReport(r.load.id)).buffer);
          if (r.load.id && v[0] === r.load.id && v.length * 8 > r.load.bits) v = v.subarray(1);
          const got = unpack(r.load, v);
          if (got[P(0x22)]) r.block = got[P(0x22)];
          if (got[P(0x8d)] || got[P(0x8e)]) throw new Error('the wheel has no room for another effect');
        } catch (e) { if (/room/.test(e.message)) throw e; }
      }
    }
    await send(r.setEffect, (u, it) => {
      const span = it.logicalMaximum - it.logicalMinimum;
      switch (u) {
        case P(0x22): return r.block;
        case P(0x26): return true;                                   // effect type: constant force
        case P(0x50): return it.logicalMaximum;                      // duration: forever
        case P(0x52): return it.logicalMaximum;                      // effect gain: full
        case P(0x53): return it.logicalMaximum;                      // trigger button: none
        case P(0x56): return 1;                                      // direction enable
        case 0x00010030: return 1;                                   // the steering axis (X)
        case 0x000a0001: return it.logicalMinimum + Math.round((span + 1) / 4);   // direction 90 degrees: along X
        default: return undefined;
      }
    });
    await send(r.op, (u, it) => (u === P(0x22) ? r.block : u === P(0x79) ? true : u === P(0x7c) ? 1 : undefined));
  }
  const pidLevel = f => send(pid.constant, (u, it) => (u === P(0x22) ? pid.block : u === P(0x70) ? f * Math.max(it.logicalMaximum, -it.logicalMinimum) : undefined));

  // ---------- Logitech classic commands (7-byte output report) ----------
  const lg = bytes => dev.sendReport(0, new Uint8Array(bytes));
  // the wheel's own centring spring; k 0..1 (0 = off)
  async function lgSpring(k) {
    if (k <= 0.01) return lg([0xf5, 0, 0, 0, 0, 0, 0]);
    const m = Math.round(k * 0xffff);
    let a, b;
    if (m <= 0xaaaa) { a = 0x0c * m; b = 0x80 * m; } else { a = 0x0c * 0xaaaa + 0x06 * (m - 0xaaaa); b = 0x80 * 0xaaaa + 0xff * (m - 0xaaaa); }
    a >>= 1;
    await lg([0xfe, 0x0d, Math.floor(a / 0xaaaa), Math.floor(a / 0xaaaa), Math.min(255, Math.floor(b / 0xaaaa)), 0, 0]);
    return lg([0x14, 0, 0, 0, 0, 0, 0]);
  }
  const lgLevel = f => lg([0x11, 0x08, Math.round(U.clamp(0x80 - f * 0x7f, 0, 255)), 0x80, 0, 0, 0]);

  // ---------- connecting ----------
  async function open(d) {
    try {
      if (!d.opened) await d.open();
    } catch (e) { status('Could not open the wheel (another program may be holding it - try closing Logitech G HUB).'); return false; }
    const pidOk = d.vendorId === 0x046d ? null : findPid(d);
    if (d.vendorId === 0x046d && d.productId === 0xc267) {
      // G923 in its PC mode: switch it to the mode that takes the classic commands (it reconnects by itself)
      try {
        const hasId30 = [...allReports(d.collections, 'outputReports').keys()].includes(0x30);
        if (hasId30) await d.sendReport(0x30, new Uint8Array([0xf8, 0x09, 0x07, 0x01, 0x01, 0x00, 0x00]));
        else await d.sendReport(0, new Uint8Array([0xf8, 0x09, 0x07, 0x01, 0x01, 0x00, 0x00]));
      } catch (e) { /* if it refuses, try the classic commands as it is */ }
    }
    if (d.vendorId === 0x046d && LG.includes(d.productId)) {
      dev = d; kind = 'lg'; name = NAMES[d.productId] || d.productName;
      try { await lg([0xf5, 0, 0, 0, 0, 0, 0]); await lgLevel(0); } catch (e) { dev = null; kind = ''; status('The wheel didn\'t accept force commands. ' + e.message); return false; }
    } else if (d.vendorId === 0x046d && LG_HIDPP.includes(d.productId)) {
      status(d.productName + ': this Xbox-version wheel uses a Logitech-only protocol the browser can\'t drive, so there is no force feedback for it here (the PlayStation/PC versions work).');
      return false;
    } else if (pidOk) {
      dev = d; kind = 'pid'; pid = pidOk; name = d.productName;
      try { await pidStart(); } catch (e) { dev = null; kind = ''; status(name + ' didn\'t accept force feedback: ' + e.message); return false; }
    } else {
      status((d.productName || 'This device') + ' has no force feedback the browser can use.');
      return false;
    }
    lastLevel = null; lastSpring = -1; idle = true;
    status('Force feedback on: ' + name + '. Press TEST FORCE to check the direction.');
    return true;
  }
  async function pickDevices(list) {
    // a wheel can show up as several HID entries: try the ones with output reports first
    const ok = list.filter(d => d.collections.some(c => (c.outputReports || []).length || (c.children || []).length));
    for (const d of ok.length ? ok : list) if (await open(d)) return true;
    return false;
  }
  async function connect() {
    if (!navigator.hid) { status('This browser can\'t send force feedback to wheels - use Chrome or Edge. Controllers still rumble.'); return; }
    try {
      const list = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x046d }, { usagePage: 0x01, usage: 0x04 }, { usagePage: 0x01, usage: 0x05 }, { usagePage: 0x0f }] });
      if (!list.length) { status('No wheel picked.'); return; }
      await pickDevices(list);
    } catch (e) { status(/permission|policy|allowed/i.test(e.message) ? 'Force feedback isn\'t allowed on this page (open the game on polyweave.org).' : 'Could not connect: ' + e.message); }
  }
  async function reconnect() {
    if (!navigator.hid || dev) return;
    try { const list = await navigator.hid.getDevices(); if (list.length) await pickDevices(list); } catch (e) { /* not allowed here */ }
  }
  async function release() {
    if (!dev) return;
    const d = dev; dev = null;
    try { if (kind === 'lg') { await lgSpringFromDev(d); } else if (kind === 'pid' && pid.control) { await d.sendReport(pid.control.id, pack(pid.control, u => u === P(0x9a))); } } catch (e) { /* gone */ }
  }
  // put a Logitech wheel back the way it was: no constant force, the normal centring spring on
  async function lgSpringFromDev(d) {
    await d.sendReport(0, new Uint8Array([0x11, 0x08, 0x80, 0x80, 0, 0, 0]));
    await d.sendReport(0, new Uint8Array([0xfe, 0x0d, 0x03, 0x03, 0x40, 0, 0]));
    await d.sendReport(0, new Uint8Array([0x14, 0, 0, 0, 0, 0, 0]));
  }

  // ---------- sending (at most ~60 a second, never queued up) ----------
  function push(level, spring) {
    if (!dev || busy) return;
    const now = performance.now();
    if (now - lastSend < 16) return;
    const lb = Math.round(level * 127);
    const doSpring = kind === 'lg' && spring >= 0 && Math.abs(spring - lastSpring) > 0.04 && now - springT > 200;
    if (lb === lastLevel && !doSpring) return;
    busy = true; lastSend = now;
    const p = doSpring ? (springT = now, lastSpring = spring, lgSpring(spring)) : (lastLevel = lb, kind === 'lg' ? lgLevel(level) : pidLevel(level));
    p.catch(() => { if (dev && !dev.opened) { dev = null; status('Wheel disconnected.'); } }).finally(() => { busy = false; });
  }
  function rumble(strong, weak) {
    const p = typeof Input !== 'undefined' && Input.pad;
    const a = p && p.vibrationActuator;
    if (!a || !a.playEffect) return;
    const now = performance.now();
    if (strong < 0.03 && weak < 0.03) return;
    if (now - rumbleT < 90) return;
    rumbleT = now;
    a.playEffect('dual-rumble', { duration: 120, strongMagnitude: U.clamp(strong, 0, 1), weakMagnitude: U.clamp(weak, 0, 1) }).catch(() => {});
  }

  return {
    connect, reconnect, release,
    get kind() { return kind; },
    // a knock: bumps, crashes, wall hits (strength in m/s of speed lost)
    hit(strength) { if (strength > 0.3) { jolt = Math.max(jolt, U.clamp(strength / 8, 0.15, 1)); joltSign = Math.random() < 0.5 ? -1 : 1; } },
    // every driving frame. o: { kmh, wheel (-1..1 position, or null), ay (sideways g-force m/s^2), rough (0..1: kerb / grass / gravel) }
    drive(dt, o) {
      const c = cfg();
      t += dt; jolt *= Math.exp(-9 * dt);
      if (!c.on) { this.stop(); return; }
      idle = false;
      const sp = U.clamp(o.kmh / 130, 0, 1);
      const pos = o.wheel || 0;
      const vel = dt > 0 ? (pos - (this.lastPos ?? pos)) / dt : 0; this.lastPos = pos;
      let f = 0;
      const drift = o.align !== undefined;
      if (drift) {
        // drift car (js/drift.js): the front tyres' self-aligning torque - it pulls the wheel toward where the
        // wheels are rolling, so in a slide it winds itself into the counter-steer and goes light at the right
        // angle. A little damping keeps it from slapping lock to lock; a touch of centring when parked.
        f = o.align * 0.75 - U.clamp(vel, -4, 4) * 0.05 - pos * 0.1 * (1 - sp);
      } else {
        // the weight of the steering: back towards the middle, stiffer with speed and harder in a fast corner
        const corner = U.clamp(Math.abs(o.ay) / 12, 0, 1);
        const centre = 0.12 + 0.55 * sp;
        if (kind === 'pid') f -= pos * centre * 1.6;
        f -= Math.sign(pos) * Math.min(1, Math.abs(pos) * 6) * corner * 0.35;
      }
      // road texture: a faint buzz at speed, much more on kerbs / grass / gravel
      const tex = 0.025 * sp + o.rough * (0.18 + 0.2 * sp);
      f += tex * (Math.sin(t * 61) * 0.6 + Math.sin(t * 23.7) * 0.4);
      // knocks: a sharp shake that dies away
      f += jolt * joltSign * Math.sin(t * 38) * 1.3;
      f = U.clamp(f * c.str * (c.inv ? -1 : 1), -1, 1);
      if (performance.now() < testUntil) f = testLevel();
      // (Logitech: the wheel's own centring spring carries the normal weight; the drift car's comes from its tyres instead)
      if (dev) push(f, kind === 'lg' ? (drift ? 0 : U.clamp((0.1 + 0.6 * sp) * c.str * 1.3, 0, 1)) : -1);
      else rumble(jolt * c.str, (o.rough * 0.5 + jolt * 0.5) * c.str * sp);
    },
    // menus, pause, garage: no forces, just a gentle centring so the wheel isn't left limp
    stop() {
      if (dev && performance.now() < testUntil) { idle = false; push(testLevel(), -1); return; }
      if (idle && lastLevel === 0) return;
      idle = true;
      if (dev) { lastSend = 0; push(0, kind === 'lg' ? 0.15 : -1); }
    },
    test() {
      if (!dev) { status(navigator.hid ? 'Connect your wheel first.' : 'This browser can\'t send force feedback to wheels - use Chrome or Edge.'); return; }
      testUntil = performance.now() + 700;
      status('Pushing the wheel to the RIGHT for a moment... if it went LEFT, tick "Invert force".');
    },
    gone(d) { if (d && d === dev) { dev = null; kind = ''; status('Wheel disconnected.'); } },
  };
})();

// ---------- the Settings > Controls section ----------
(() => {
  const el = id => document.getElementById(id);
  const on = el('ffbOn'), str = el('ffbStr'), inv = el('ffbInv');
  if (!on) return;
  on.checked = Settings.ffbOn !== false;
  str.value = Math.round((Settings.ffbStr === undefined ? 0.6 : Settings.ffbStr) * 100);
  inv.checked = !!Settings.ffbInv;
  const lab = () => { el('ffbStrV').textContent = str.value + '%'; };
  lab();
  on.addEventListener('change', () => { Settings.ffbOn = on.checked; saveSettings(); if (!on.checked) FFB.stop(); });
  str.addEventListener('input', () => { Settings.ffbStr = str.value / 100; lab(); saveSettings(); });
  inv.addEventListener('change', () => { Settings.ffbInv = inv.checked; saveSettings(); });
  el('ffbConnect').addEventListener('click', () => FFB.connect());
  el('ffbTest').addEventListener('click', () => FFB.test());
  if (!navigator.hid) el('ffbStatus').textContent = 'Wheels: force feedback needs Chrome or Edge. Controllers rumble in any browser that supports it.';
  else {
    FFB.reconnect();
    navigator.hid.addEventListener('connect', () => FFB.reconnect());
    navigator.hid.addEventListener('disconnect', e => FFB.gone(e.device));
  }
  window.addEventListener('pagehide', () => FFB.release());
})();
