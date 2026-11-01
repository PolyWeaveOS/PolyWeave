'use strict';
// =====================================================================
//  Film (home, bottom right): the content creators' place - the owners' accounts and Content Creators only (the server
//  checks the creator servers, the content cars and Clip Studio again). In here:
//   - FILM GARAGE: the content cars (js/playercars.js CONTENT_CAR_KEYS, real models) - only ever driven in the Film area
//   - FREE DRIVE: the endless highway, your own traffic, no score
//   - CREATOR SERVERS: servers only these accounts can join; the host picks the traffic (never scored, no AFK kick)
//   - GREEN SCREEN: the green screen room (js/drifttrack.js buildStage) - key it out for shots
//   - CLIP STUDIO: tools/studio.js (loaded for these accounts only)
//  While you're in the Film area you drive your film car (Settings.filmCar); back on the main menu your road car comes
//  back. Nothing in here counts for leaderboards, stats or titles - only time played.
// =====================================================================
Object.assign(Film, {
  vehWas: null,
  enter() {
    if (!canSpecial()) return;
    if (!this.on) {
      this.on = true;
      // (the film cars are cars: off the motorcycle / out of the Bang Bus while in here, back on leaving)
      if ((Settings.vehicle || 'car') !== 'car') { this.vehWas = Settings.vehicle; Settings.vehicle = 'car'; setVehicle('car'); }
      installCar(wantedCar());
    }
    show('scrFilm');
    if (this.chat) this.chat();                              // (the creators' chat: messages + who's online)
  },
  leave() {
    if (!this.on) return;
    this.on = false;
    if (this.vehWas) { Settings.vehicle = this.vehWas; this.vehWas = null; saveSettings(); setVehicle(Settings.vehicle); }
    installCar(wantedCar());
  },
});

(() => {
  const $ = id => document.getElementById(id);
  $('filmBtn').onclick = () => Film.enter();
  $('filmBack').onclick = () => show('scrTitle');            // (show() takes you out of the Film area)
  PARENT.scrFilm = 'scrTitle'; PARENT.scrFilmSP = 'scrFilm'; PARENT.scrFilmMP = 'scrFilm'; PARENT.scrStudio = 'scrFilm';
  $('filmGreen').onclick = () => DriftTrack.enter('greenscreen');
  $('filmStudio').onclick = () => { if (window.Studio) Studio.open(); };
  setInterval(() => $('filmStudio').classList.toggle('hidden', !window.Studio), 1000);   // (Clip Studio: once its file is in)

  // ---- free drive: the highway in your film car, your own traffic
  for (const [k, v] of [['filmDensity', 0.3], ['filmMpDensity', 0.3]]) if (!Number.isFinite(Settings[k])) Settings[k] = v;
  segPicker('fsWorld', 'filmWorld'); segPicker('fsTod', 'filmTod');
  bindRange('fsDens', 'filmDensity', v => v / 100, v => v + '%');
  $('fsGo').onclick = () => {
    DriftTrack.exit();
    if (Net.active()) { quitting = true; Net.leave(); quitting = false; }
    score.reset();
    game.mode = 'sp'; game.scored = false; game.density = Settings.filmDensity;
    setWorld(Settings.filmWorld, Settings.filmTod);
    startPosition(); score.reset();
    closeMenu();
    hud.message('FILM Â· FREE DRIVE');
  };

  // ---- creator servers: the open ones (listed) + host one / join with a code
  segPicker('fmVis', 'filmHostVis'); segPicker('fmWorld', 'filmHostWorld'); segPicker('fmTod', 'filmHostTod');
  bindRange('fmDens', 'filmMpDensity', v => v / 100, v => v + '%');
  $('fmName').value = Settings.filmHostName || '';
  $('fmName').addEventListener('input', e => { Settings.filmHostName = e.target.value; saveSettings(); });
  const status = (msg, kind) => { const el = $('fmStatus'); el.textContent = msg || ''; el.className = kind || ''; };
  const onStatus = Net.onStatus;
  Net.onStatus = (msg, kind) => { onStatus(msg, kind); if (screen === 'scrFilmMP') status(msg, kind); };
  $('fmHost').onclick = () => Net.host(myName(), Settings.color, { creator: true, density: Settings.filmMpDensity, listed: Settings.filmHostVis !== 'private',
    roomName: ($('fmName').value || '').trim() || `${myName()} creators`, theme: Settings.filmHostWorld, tod: Settings.filmHostTod });
  const code = $('fmCode');
  const join = () => Net.joinCode(code.value, myName(), Settings.color);
  $('fmJoin').onclick = join;
  code.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  code.addEventListener('input', () => { const s = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); code.value = s.length > 3 ? s.slice(0, 3) + '-' + s.slice(3) : s; });
  async function refresh() {
    const box = $('fmServers');
    let j = null;
    try {
      const base = await Net.findBase();
      if (base) { const r = await fetch(base + '/api/creator/servers', { cache: 'no-store', headers: { Authorization: 'Bearer ' + (Account.session || '') } }); if (r.ok) j = await r.json(); }
    } catch (e) { /* offline */ }
    if (screen !== 'scrFilmMP') return;
    if (!j) { box.innerHTML = '<div class="mpEmpty">Creator servers need the online server: open the game from its website link.</div>'; return; }
    box.innerHTML = '';
    for (const s of j.servers || []) {
      const row = el('div', 'mpSrv'), here = Net.room && Net.room.id === s.id;
      row.innerHTML = '<span class="nmBox"><span class="nm"></span><span class="sub"></span></span><span class="ct"></span>';
      row.querySelector('.nm').textContent = s.name;                    // (names as text, never HTML)
      row.querySelector('.sub').textContent = [`Traffic ${Math.round((s.density || 0) * 100)}%`, (WORLD_NAMES[s.theme] || 'Grassy') + ' world', TOD_NAMES[s.tod] || 'Day'].join(' Â· ');
      row.querySelector('.ct').textContent = `${s.players}/${s.max} players`;
      const b = el('button', '', here ? 'JOINED' : s.players >= s.max ? 'FULL' : 'JOIN'); b.disabled = here || s.players >= s.max;
      b.onclick = () => Net.joinServer(s.id, myName(), Settings.color);
      row.appendChild(b); box.appendChild(row);
    }
    if (!box.children.length) box.innerHTML = '<div class="mpEmpty">No creator servers open right now. Host one!</div>';
  }
  $('fmRefresh').onclick = refresh;

  // ---- the creators' chat (always on: server.js 'cchat') - messages and who's online, updated live while the game's open
  const log = $('fcLog'), inp = $('fcIn');
  const line = e => {
    const d = el('div');
    d.append(el('span', 'tm', new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), el('span', 'nm', e.name), document.createTextNode(e.text));   // (as text, never HTML)
    return d;
  };
  const empty = t => { log.innerHTML = ''; log.appendChild(el('div', 'fcEmpty', t)); };
  Net.onCreatorChat = m => {
    if (m.log) { log.innerHTML = ''; for (const e of m.log) log.appendChild(line(e)); }
    if (m.msg) { const e = log.querySelector('.fcEmpty'); if (e) e.remove(); log.appendChild(line(m.msg)); while (log.children.length > 60) log.firstChild.remove(); }
    if (m.log || m.msg) { if (!log.children.length) empty('No messages yet. Say hi!'); log.scrollTop = log.scrollHeight; }
    if (m.online) {
      const box = $('fcOnline'); box.innerHTML = '';
      for (const p of m.online) box.appendChild(el('span', '', p.name));
      $('fcCount').textContent = '· ' + m.online.length;
    }
  };
  Film.chat = () => { if (canSpecial() && Account.session) Net.connect().then(() => Net.send({ t: 'cchat', get: 1 })).catch(() => empty('The chat needs the online server.')); };
  const say = () => { const t = inp.value.trim(); if (!t) return; Net.send({ t: 'cchat', text: t }); inp.value = ''; };
  $('fcSend').onclick = say;
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') say(); });   // (typing here doesn't drive)
  addEventListener('load', () => { const prev = Net.onOpened; Net.onOpened = () => { if (prev) prev(); if (Film.on) setTimeout(() => Film.chat(), 300); }; });   // (reconnected: fresh list - after social.js has set its own)
  // (opening the creator servers screen: the list straight away, then every 6 s while it's open)
  new MutationObserver(() => { if (!$('scrFilmMP').classList.contains('hidden')) { status(''); refresh(); } }).observe($('scrFilmMP'), { attributes: true, attributeFilter: ['class'] });
  setInterval(() => { if (menuOpen && screen === 'scrFilmMP' && !document.hidden) refresh(); }, 6000);
})();
