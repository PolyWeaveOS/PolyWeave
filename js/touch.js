'use strict';
// =====================================================================
//  Phones and tablets (polyweave.org and the CrazyGames version)
//  - Touch controls while driving: a steering pad (bottom left: slide your thumb between ◀ and ▶), GAS and BRAKE
//    pedals (bottom right), and pause / camera / chat (multiplayer) / fullscreen buttons (top left).
//    They press the same virtual keys as the keyboard, so the car drives exactly as it does with keys
//    (same ramps, same lane assist; physics untouched).
//  - On automatically on touch-first devices (Settings: Touch controls Auto / On / Off).
//  - Lighter graphics on phones: sharper-than-needed pixel density capped, smaller shadow map, mirrors and motion
//    blur off on the first visit (all still in Settings).
//  - Turn-sideways message in portrait; menus compacted on short screens (style.css, .touch).
// =====================================================================
const TOUCH_DEVICE = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
const Touch = {
  on: false,
  update() {
    const want = Settings.touch === 'on' || (Settings.touch !== 'off' && TOUCH_DEVICE);
    this.on = want; document.documentElement.classList.toggle('touch', want);
    if (!want) this.release();
  },
  // virtual keys: the action's first key, like pressing it on a keyboard
  key(action, down) { const c = Input.binds[action][0]; if (down) { if (!Input.keys[c]) Input.pressed[c] = true; Input.keys[c] = true; } else Input.keys[c] = false; },
  tap(code) { Input.pressed[code] = true; Input.lastActive = performance.now(); },
  release() { for (const a of ['left', 'right', 'throttle', 'brake']) this.key(a, false); },
};
if (!Settings.touch) Settings.touch = 'auto';

(() => {
  // ---- lighter graphics on phones / tablets
  if (TOUCH_DEVICE) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    dispatchEvent(new Event('resize'));                        // (render targets follow the new size)
    const small = () => { if (sunLight.shadow.mapSize.x > 1024) { sunLight.shadow.mapSize.set(1024, 1024); if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; } } };
    { const r = realisticScene; realisticScene = on => { r(on); small(); }; }
    small();
    let first = false; try { first = !localStorage.getItem('pw_touch_init'); localStorage.setItem('pw_touch_init', '1'); } catch (e) { /* ignore */ }
    if (first) {
      Settings.mirrors = 'off'; MIRRORS.setQuality('off'); Settings.blur = 0; saveSettings();
      const mq = document.getElementById('mirrorQ'); if (mq) mq.value = 'off';
      const bl = document.getElementById('blur'); if (bl) { bl.value = 0; bl.dispatchEvent(new Event('input')); }
    }
  }

  // ---- the controls
  const ui = document.createElement('div'); ui.id = 'touchUI';
  const ico = {
    pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  };
  ui.innerHTML = `<div class="tTop">
      <button data-t="pause" aria-label="Pause">${ico.pause}</button><button data-t="camera" aria-label="Camera">${ico.camera}</button>
      <button data-t="chat" class="tChat" aria-label="Chat">${ico.chat}</button><button data-t="full" class="tFull" aria-label="Fullscreen">${ico.full}</button></div>
    <div id="tSteer"><div class="tHalf" data-s="-1"><svg viewBox="0 0 24 24"><path d="M15 5 7 12l8 7z"/></svg></div><div class="tHalf" data-s="1"><svg viewBox="0 0 24 24"><path d="m9 5 8 7-8 7z"/></svg></div></div>
    <div id="tPedals"><div id="tBrake" class="tPedal">BRAKE</div><div id="tGas" class="tPedal">GAS</div></div>`;
  document.getElementById('hud').appendChild(ui);
  ui.addEventListener('contextmenu', e => e.preventDefault());

  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (x) { /* (finger already gone) */ } };
  // steering pad: every finger on it steers by which half it's over (slide across to change side)
  const pad = ui.querySelector('#tSteer'), halves = [...pad.querySelectorAll('.tHalf')], fingers = new Map();
  const steer = () => {
    const sides = [...fingers.values()], l = sides.includes(-1), r = sides.includes(1);
    Touch.key('left', l); Touch.key('right', r);
    halves[0].classList.toggle('on', l); halves[1].classList.toggle('on', r);
  };
  const side = e => { const b = pad.getBoundingClientRect(); return e.clientX < b.left + b.width / 2 ? -1 : 1; };
  pad.addEventListener('pointerdown', e => { e.preventDefault(); capture(pad, e); fingers.set(e.pointerId, side(e)); steer(); });
  pad.addEventListener('pointermove', e => { if (fingers.has(e.pointerId)) { fingers.set(e.pointerId, side(e)); steer(); } });
  const lift = e => { if (fingers.delete(e.pointerId)) steer(); };
  pad.addEventListener('pointerup', lift); pad.addEventListener('pointercancel', lift); pad.addEventListener('lostpointercapture', lift);

  // pedals: held while a finger is on them
  for (const [id, action] of [['tGas', 'throttle'], ['tBrake', 'brake']]) {
    const el = ui.querySelector('#' + id), held = new Set();
    const set = () => { Touch.key(action, held.size > 0); el.classList.toggle('on', held.size > 0); };
    el.addEventListener('pointerdown', e => { e.preventDefault(); capture(el, e); held.add(e.pointerId); set(); });
    const up = e => { if (held.delete(e.pointerId)) set(); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }

  // top buttons
  const full = () => {
    const d = document.documentElement;
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    (d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : Promise.reject()).then(() => {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {});
  };
  ui.querySelector('.tTop').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const t = b.dataset.t;
    if (t === 'pause') Touch.tap('Escape');
    else if (t === 'camera') Touch.tap(Input.binds.camera[0]);
    else if (t === 'chat') MpChat.show(true);
    else if (t === 'full') full();
  });
  // fullscreen only where the browser can do it (not iPhones), and not on CrazyGames (their page handles it)
  if (CG || !document.fullscreenEnabled) ui.querySelector('.tFull').remove();
  if (CG) ui.querySelector('.tChat').remove();

  // menus open / app in the background: let go of everything
  { const o = openMenu; openMenu = id => { Touch.release(); fingers.clear(); o(id); }; }
  addEventListener('blur', () => Touch.release());
  document.addEventListener('visibilitychange', () => { if (document.hidden) Touch.release(); });

  // chat button only on servers
  setInterval(() => ui.classList.toggle('mp', game.mode === 'mp' && Net.active()), 500);

  // turn sideways (portrait phone)
  const rot = document.createElement('div'); rot.id = 'rotateMsg';
  rot.innerHTML = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"><rect x="8" y="14" width="18" height="32" rx="3"/><rect x="26" y="40" width="32" height="18" rx="3" stroke-dasharray="4 4" opacity=".55"/><path d="M32 10c10 0 18 8 18 20"/><path d="M44 25l6 6 6-6"/></svg><b>Turn your phone sideways</b><span>PolyWeave plays in landscape</span>';
  document.body.appendChild(rot);

  // Settings: Touch controls Auto / On / Off (next to the other driving options)
  const row = document.createElement('label'); row.className = 'row';
  row.innerHTML = 'Touch controls <select id="touchSel"><option value="auto">Auto</option><option value="on">On</option><option value="off">Off</option></select>';
  const after = document.getElementById('units').closest('label'); after.parentNode.insertBefore(row, after);
  const sel = row.querySelector('select'); sel.value = Settings.touch;
  sel.onchange = () => { Settings.touch = sel.value; saveSettings(); Touch.update(); };

  // keyboard hints don't apply on a touch screen
  { const h = hintText; hintText = () => (Touch.on ? '' : h()); }
  Touch.update();
})();
