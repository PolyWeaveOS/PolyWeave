'use strict';
// =====================================================================
//  CrazyGames version (only when PLATFORM is 'crazygames', see js/platform.js; does nothing on polyweave.org).
//  Basic Launch rules (docs.crazygames.com/requirements):
//  - no outside logins: everyone plays as a guest (Account.init skips Google), named "Guest1234"
//    (no typed names, so nobody sees a rude one)
//  - no chat: CrazyGames needs chat moderated, and server chat has no filter. Only "joined / left" lines show
//  - only CrazyGames' own ads (none during Basic Launch): no billboards, links or install button
//  - new players land straight in gameplay: a scored singleplayer run starts as soon as the game loads
//  - the CrazyGames SDK is told when gameplay starts / stops (their stats), its mute setting is obeyed, and a
//    big new best gets its "happy time". If the SDK is blocked (ad blockers) the game just carries on.
//  Hidden for guests (they need an account): friends, inbox, profile, achievements, leaderboard (style.css, .cg).
// =====================================================================
(() => {
  if (!CG) return;

  // ---- guest name (kept on this computer)
  let guest = '';
  try { guest = localStorage.getItem('pw_cg_name') || ''; } catch (e) { /* ignore */ }
  if (!/^Guest\d{4}$/.test(guest)) {
    guest = 'Guest' + String(Math.floor(1000 + Math.random() * 9000));
    try { localStorage.setItem('pw_cg_name', guest); } catch (e) { /* ignore */ }
  }
  Settings.mpName = guest; saveSettings();
  const lockNames = () => { for (const el of nameIns) { el.value = guest; el.disabled = true; } };
  { const r = renderAccount; renderAccount = () => { r(); lockNames(); }; }
  lockNames();

  // ---- no chat: the box never opens, and only join / leave lines are shown
  { const sh = MpChat.show.bind(MpChat); MpChat.show = on => { if (!on) sh(false); }; }
  Net.onChat = m => { if (m.sys) MpChat.add(m); };

  // ---- CrazyGames SDK
  let sdk = null, playing = false, told = null, muted = false;
  const call = f => { try { if (sdk) f(sdk); } catch (e) { console.warn('CrazyGames SDK:', e); } };
  // gameplayStart while driving, gameplayStop on every break (menus, pause); only when it changes
  const tell = () => { if (!sdk || told === playing) return; told = playing; call(s => (playing ? s.game.gameplayStart() : s.game.gameplayStop())); };
  { const o = openMenu; openMenu = id => { o(id); playing = false; tell(); }; }
  { const c = closeMenu; closeMenu = () => { c(); playing = true; tell(); }; }
  // their mute setting wins over the game's volume
  { const u = sound.update.bind(sound); sound.update = (car, throttle, vol) => u(car, throttle, muted ? 0 : vol); }
  // a big new personal best: CrazyGames' celebration (sparingly: not for small first runs)
  { const r = hud.showResult.bind(hud); hud.showResult = (points, peak, best) => { r(points, peak, best); if (best && points >= 25000) call(s => s.game.happytime()); }; }

  const start = () => {
    const S = window.CrazyGames && window.CrazyGames.SDK;
    if (!S) return;
    S.init().then(() => {
      if (S.environment === 'disabled') return;            // (not on CrazyGames or this computer: SDK calls would throw)
      sdk = S;
      const apply = () => { try { muted = !!S.game.settings.muteAudio; } catch (e) { muted = false; } };
      apply(); call(s => s.game.addSettingsChangeListener(apply));
      tell();
    }).catch(e => console.warn('CrazyGames SDK not started:', e));
  };
  if (window.CrazyGames) start();
  else {                                                   // (testing with ?cg=1: the build has it in index.html)
    const s = document.createElement('script');
    s.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js'; s.onload = start; s.onerror = () => console.warn('CrazyGames SDK blocked or offline: playing without it');
    document.head.appendChild(s);
  }

  // ---- straight into gameplay: a scored singleplayer run, with the controls shown
  // (the browser only allows sound after a key press or click, so it starts on the first one)
  const wake = () => { if (!menuOpen && sound.ctx && sound.ctx.state === 'suspended') sound.ctx.resume(); };
  for (const ev of ['keydown', 'pointerdown', 'touchend', 'click']) addEventListener(ev, wake);   // (iPhones: touchend / click)
  startSingle(true);
  // how to drive, until they've driven a bit (steered and used the throttle) or 20 s have gone by
  const k = a => `<b>${keyLabel(Input.binds[a][0])}</b>`;
  const help = document.createElement('div'); help.id = 'cgHelp';
  help.innerHTML = Touch.on
    ? 'Hold <b>GAS</b> · steer with <b>◀</b><b>▶</b> · weave past cars for points'
    : `${k('throttle')}${k('left')}${k('brake')}${k('right')} or <b>↑</b><b>←</b><b>↓</b><b>→</b> to drive · weave past cars for points<br><b>Esc</b> menu`;
  document.body.appendChild(help);
  let steered = false, throttled = false;
  const t0 = performance.now(), poll = setInterval(() => {
    const o = Input.out;
    if (!menuOpen) { if (Math.abs(o.steer) > 0.3) steered = true; if (o.throttle > 0.3) throttled = true; }
    help.classList.toggle('off', menuOpen);
    if ((steered && throttled) || performance.now() - t0 > 20000) { help.classList.add('off'); clearInterval(poll); setTimeout(() => help.remove(), 800); }
  }, 150);
})();
