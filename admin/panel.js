'use strict';
// =====================================================================
//  PolyWeave admin panel - only ever sent to the admin account (server.js /api/tools/admin), and every action is
//  checked again on the server (/api/admin/*, the PolyWeave account's locked Google id). Adds a shield button next to
//  Friends / Inbox and an ADMIN screen: Overview, Players (ban / temp ban / unban, give / take titles, their runs),
//  Runs (filter by player, mode, status, score, length, points per second, days; take off / put back), Racing (laps +
//  race results per track, the held-for-review queue: approve / remove / restore) and the admin Log.
// =====================================================================
(() => {
  const E = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const fmt = n => Math.round(n || 0).toLocaleString('en-US');
  const day = t => (t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const dur = s => { s = Math.round(s || 0); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
  const left = until => { const s = Math.max(0, Math.floor((until - Date.now()) / 1000)); return `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h ${Math.floor(s % 3600 / 60)}m`; };
  async function api(path, body) {
    const base = (await Net.findBase()) || '';
    try {
      const r = await fetch(base + path, { method: body ? 'POST' : 'GET', cache: 'no-store',
        headers: Object.assign({ Authorization: 'Bearer ' + Account.session }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
      if (r.status === 404 && !path.includes('player?')) return { error: 'Not allowed.' };
      return await r.json();
    } catch (e) { return { error: 'Could not reach the server.' }; }
  }
  // ---- styles
  const css = document.createElement('style');
  css.textContent = `
  #adminBtn svg { color: #ffd84a; }
  #scrAdmin .adTabs { margin-bottom: 12px; }
  #scrAdmin .adMsg { min-height: 18px; font-size: 13px; margin: 2px 0 10px; } #scrAdmin .adMsg.err { color: #ff6b6b; } #scrAdmin .adMsg.ok { color: #5bd47a; }
  #scrAdmin .adTiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
  #scrAdmin .adTile { padding: 12px 14px; border-radius: 10px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); }
  #scrAdmin .adTile b { display: block; font-size: 24px; color: #ffd84a; font-variant-numeric: tabular-nums; } #scrAdmin .adTile span { font-size: 12px; opacity: .7; }
  #scrAdmin .adTile.click { cursor: pointer; } #scrAdmin .adTile.click:hover { border-color: #ffd84a; }
  #scrAdmin .adRow { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
  #scrAdmin .adRow input, #scrAdmin .adRow select { padding: 7px 9px; border-radius: 8px; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.15); color: inherit; font: inherit; font-size: 13px; }
  #scrAdmin .adRow input { width: 120px; } #scrAdmin .adRow input.wide { width: 220px; }
  #scrAdmin button.small { padding: 6px 10px; font-size: 11px; letter-spacing: 1px; } #scrAdmin button.red { background: rgba(212,42,42,.55); border-color: rgba(255,90,90,.5); }
  #scrAdmin .adTable { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  #scrAdmin .adTable th { text-align: left; font-size: 10px; letter-spacing: 1.5px; opacity: .6; padding: 6px; border-bottom: 1px solid rgba(255,255,255,.12); }
  #scrAdmin .adTable td { padding: 6px; border-bottom: 1px solid rgba(255,255,255,.06); vertical-align: middle; font-variant-numeric: tabular-nums; }
  #scrAdmin .adTable tr.link:hover td { background: rgba(255,255,255,.05); cursor: pointer; }
  #scrAdmin .tag { display: inline-block; padding: 2px 7px; border-radius: 6px; font-size: 10px; font-weight: 800; letter-spacing: 1px; }
  #scrAdmin .tag.bad { background: rgba(212,42,42,.3); color: #ff9a9a; } #scrAdmin .tag.good { background: rgba(60,180,90,.25); color: #8de0a4; }
  #scrAdmin .tag.hold { background: rgba(255,216,74,.2); color: #ffd84a; } #scrAdmin .tag.dim { background: rgba(255,255,255,.08); opacity: .8; }
  #scrAdmin .note { font-size: 11px; opacity: .7; max-width: 300px; }
  #scrAdmin .adScroll { max-height: 55vh; overflow: auto; }
  #scrAdmin h3 { font-size: 13px; letter-spacing: 2px; margin: 16px 0 4px; opacity: .85; }
  #scrAdmin .chip { display: inline-flex; gap: 6px; align-items: center; padding: 4px 8px; border-radius: 8px; background: rgba(255,255,255,.07); margin: 0 6px 6px 0; font-size: 12px; }
  #scrAdmin .chip button { padding: 0 6px; font-size: 11px; line-height: 18px; }
  #scrAdmin .adHelp { font-size: 12px; opacity: .6; margin: 4px 0; }
  #scrAdmin .adRole { font-size: 12px; font-weight: 700; color: #ffd84a; margin-left: 12px; opacity: .85; }`;
  document.head.appendChild(css);

  // ---- the button (next to Friends / Inbox)
  const corner = document.querySelector('#scrTitle .cornerBtns');
  const btn = E('button', 'roundBtn'); btn.id = 'adminBtn'; btn.title = 'Admin';
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>';
  if (corner) corner.prepend(btn);

  // ---- the screen
  const scr = E('div', 'screen panel wide hidden'); scr.id = 'scrAdmin';
  const hdr = E('div', 'hdr'), back = E('button', 'back', '← BACK'); back.onclick = () => show('scrTitle');
  // PolyWeave (boss): changes happen. An admin (Admin title): sees everything, every change is sent to PolyWeave
  const boss = () => !!(Account.user && Account.user.admin);
  const BOSS_ONLY = ['admin', 'owner'];                  // (only PolyWeave gives or takes these; the server refuses them from admins)
  const roleNote = E('span', 'adRole');
  hdr.append(back, E('h1', '', 'ADMIN'), roleNote);
  const tabs = E('div', 'tabs adTabs'), msg = E('div', 'adMsg'), body = E('div');
  const TABS = [['overview', 'OVERVIEW'], ['players', 'PLAYERS'], ['runs', 'RUNS'], ['racing', 'RACING'], ['requests', 'REQUESTS'], ['log', 'LOG']];
  let tab = 'overview';
  for (const [k, n] of TABS) { const b = E('button', 'tab', n); b.dataset.ad = k; b.onclick = () => open(k); tabs.appendChild(b); }
  scr.append(hdr, tabs, msg, body);
  document.getElementById('menu').appendChild(scr);
  btn.onclick = () => { show('scrAdmin'); open(tab); };
  const say = (t, ok) => { msg.textContent = t || ''; msg.className = 'adMsg' + (t ? (ok ? ' ok' : ' err') : ''); };
  // run an action (an admin's goes to PolyWeave to accept), report it, then redraw what's on screen
  async function act(body, confirmText, redraw) {
    if (confirmText && !confirm(boss() ? confirmText : confirmText + '\n\n(This is sent to PolyWeave to accept.)')) return;
    const j = await api('/api/admin/action', body);
    if (j.error) say(j.error); else say(j.msg, true);
    if (!j.error && !j.queued && redraw) redraw();
  }
  const button = (txt, fn, cls = '') => { const b = E('button', 'small ' + cls, txt); b.onclick = e => { e.stopPropagation(); fn(); }; return b; };
  const table = (heads) => { const t = E('table', 'adTable'), tr = E('tr'); for (const h of heads) tr.appendChild(E('th', '', h)); t.appendChild(tr); return t; };
  const cell = (tr, v) => { const td = E('td'); if (v instanceof Node) td.appendChild(v); else td.textContent = v; tr.appendChild(td); return td; };
  const tag = (txt, cls) => E('span', 'tag ' + cls, txt);
  const runStatus = r => r.verified === -1 ? tag('REJECTED', 'bad') : r.removed ? tag('TAKEN OFF', 'dim') : r.verified === 0 ? tag('IMPORTED', 'dim') : tag('COUNTED', 'good');

  function open(k) {
    tab = k; say(''); clearTimeout(onlineTimer);
    tabs.querySelectorAll('[data-ad]').forEach(b => b.classList.toggle('sel', b.dataset.ad === k));
    body.innerHTML = '';
    ({ overview, players, runs, racing, requests, log })[k]();
  }

  // ---- OVERVIEW
  async function overview() {
    const j = await api('/api/admin/overview'); if (j.error) { say(j.error); return; }
    const g = E('div', 'adTiles');
    const tiles = [
      [fmt(j.signedIn), 'signed in with Google (with a driver name)'], [fmt(j.accounts), 'Google accounts in total'],
      [fmt(j.onlineNow), 'signed in and online now', () => whoOnline()], [fmt(j.inGame), 'players on a server right now', () => whoOnline()],
      [fmt(j.runs24), 'verified runs, last 24 h'], [fmt(j.rejected24), 'rejected runs / laps / races, last 24 h', () => { Object.assign(runFilter, { name: '', mode: '', minScore: '', maxDur: '', minPps: '', status: 'rejected', days: '1' }); open('runs'); }],
      [fmt(j.held), 'racing times waiting for review', () => open('racing')], [fmt(j.laps24), 'time-trial laps, last 24 h'],
      [fmt(j.bannedPerm), 'permanent leaderboard bans'], [fmt(j.bannedTemp), 'temporary leaderboard bans'],
      [fmt(j.runsTotal), 'verified runs in total'], [String(j.playHours || 0), 'hours played in total'],
    ];
    if (boss()) tiles.unshift([fmt(j.requests), 'admin requests waiting for you', () => open('requests')]);
    for (const [v, k, fn] of tiles) { const d = E('div', 'adTile' + (fn ? ' click' : '')); d.append(E('b', '', v), E('span', '', k)); if (fn) d.onclick = fn; g.appendChild(d); }
    body.append(g, E('div', 'adHelp', boss() ? 'Only your account and admins (the Admin title) can open this panel, and only your changes happen - an admin\'s come to you in Requests. The server checks every request.'
      : 'You\'re an admin: every change you make is sent to PolyWeave to accept or decline. You\'ll get the answer in your inbox and in Requests.'));
  }

  // ---- REQUESTS: PolyWeave accepts (it happens) or declines what admins asked for, with a note to them;
  // an admin sees their own requests and the answers
  async function requests() {
    const j = await api('/api/admin/requests'); if (j.error) { say(j.error); return; }
    body.innerHTML = '';
    const STATUS = [['WAITING', 'hold'], ['ACCEPTED', 'good'], ['DECLINED', 'bad'], ['COULDN\'T BE DONE', 'bad']];
    const t = table(boss() ? ['WHEN', 'ADMIN', 'ASKED FOR', 'STATUS', ''] : ['WHEN', 'ASKED FOR', 'STATUS', 'NOTE FROM POLYWEAVE']);
    for (const r of j.list) {
      const tr = E('tr'); cell(tr, day(r.t)); if (boss()) cell(tr, r.name || '?');
      const what = cell(tr, r.summary || ''); if (r.result && r.status !== 0) what.appendChild(E('div', 'note', r.result));
      cell(tr, tag(STATUS[r.status][0], STATUS[r.status][1]));
      if (!boss()) cell(tr, r.note || '');
      else if (r.status === 0) {
        const td = E('td'), note = E('input', 'wide'); note.placeholder = 'Note to them (optional)'; note.maxLength = 300;
        const row = E('div', 'adRow'); row.style.margin = '0';
        const decide = async accept => { const k = await api('/api/admin/decide', { id: r.id, accept, note: note.value }); if (k.error) say(k.error); else say(k.msg, true); requests(); };
        row.append(note, button('ACCEPT', () => decide(true)), button('DECLINE', () => decide(false), 'red'));
        td.appendChild(row); tr.appendChild(td);
      } else cell(tr, r.note ? 'Note: ' + r.note : '');
      t.appendChild(tr);
    }
    const sc = E('div', 'adScroll'); sc.appendChild(t); if (!j.list.length) sc.appendChild(E('div', 'adHelp', boss() ? 'No requests from admins yet.' : 'You haven\'t asked for anything yet.'));
    body.append(E('div', 'adHelp', boss() ? 'Accept: it happens (checked again first). Decline: nothing changes. Either way the admin gets a note in their inbox, with yours if you write one.'
      : 'Everything you do in the panel comes here first; PolyWeave accepts or declines it.'), sc);
  }

  // ---- WHO'S ONLINE (from the Overview's online tiles): every signed-in player online and what they're doing, plus
  // guests on servers. Refreshes every 10 s while it's open.
  const WORLDS = { grass: 'Grassy', desert: 'Desert', snow: 'Snowy' }, TODS = { day: 'Day', sunset: 'Evening', night: 'Night' };
  const trackName = id => (Tracks.TRACK_BY_ID[id] || {}).name || id;
  const RACE_ST = { lobby: 'waiting in the lobby', countdown: 'countdown', grid: 'on the grid', racing: 'racing', results: 'results' };
  const ago = t => { const s = Math.max(0, Math.floor((Date.now() - t) / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`; };
  const doing = a => {
    if (!a) return ['Online', ''];
    if (a.mode === 'sp') return [a.scored ? 'Singleplayer (scored run)' : 'Singleplayer (free drive)', `${WORLDS[a.theme] || a.theme} · ${TODS[a.tod] || a.tod}`];
    if (a.mode === 'mp') return [{ official: 'Official server', public: 'Public server', private: 'Private server' }[a.kind] || 'Server',
      `${a.roomName || '?'}${a.code ? ' (code ' + a.code + ')' : ''} · ${a.players} player${a.players === 1 ? '' : 's'} · ${WORLDS[a.theme] || a.theme} · ${TODS[a.tod] || a.tod}${a.scored ? ' · scored' : ''}`];
    if (a.mode === 'race') return [`Race (${a.kind})`, `${trackName(a.track)} · ${RACE_ST[a.st] || a.st} · ${a.players} in the room`];
    if (a.mode === 'tt') return ['Time trial', trackName(a.track)];
    return ['In the menus', ''];
  };
  const carName = a => !a || !a.veh ? '' : a.veh === 'van' ? 'Bang Bus' : a.veh === 'bike' ? 'Motorcycle' : (PLAYER_CARS[a.model] || {}).name || a.model;
  let onlineTimer = null;
  async function whoOnline() {
    clearTimeout(onlineTimer);
    if (tab !== 'overview' || screen !== 'scrAdmin') return;
    const j = await api('/api/admin/online'); if (j.error) { say(j.error); return; }
    if (tab !== 'overview' || screen !== 'scrAdmin') return;
    body.innerHTML = '';
    const top = E('div', 'adRow'); top.append(button('← OVERVIEW', () => { clearTimeout(onlineTimer); overview(); }), E('b', '', `${j.list.length} signed in · ${j.guests.length} guest${j.guests.length === 1 ? '' : 's'} on servers`), E('span', 'adHelp', 'updates every 10 s'));
    body.append(top);
    const t = table(['DRIVER', 'DOING', 'WHERE', 'DRIVING', 'ONLINE FOR']);
    for (const p of j.list.concat(j.guests)) {
      const tr = E('tr', p.guest ? '' : 'link'), [what, where] = doing(p.act);
      const nm = E('span', '', p.name); if (p.guest) nm.append(' ', tag('GUEST', 'dim')); if (p.banned) nm.append(' ', tag('BANNED', 'bad')); if (p.tabs > 1) nm.append(' ', tag(p.tabs + ' TABS', 'dim'));
      cell(tr, nm); cell(tr, what); cell(tr, where); cell(tr, carName(p.act)); cell(tr, p.since ? ago(p.since) : '');
      if (!p.guest) tr.onclick = () => { clearTimeout(onlineTimer); tab = 'players'; tabs.querySelectorAll('[data-ad]').forEach(b => b.classList.toggle('sel', b.dataset.ad === 'players')); player(p.name); };
      t.appendChild(tr);
    }
    const sc = E('div', 'adScroll'); sc.appendChild(t); if (!j.list.length && !j.guests.length) sc.appendChild(E('div', 'adHelp', 'Nobody online right now.'));
    body.append(sc, E('div', 'adHelp', 'Click a signed-in driver for their page (bans, titles, runs). Guests in menus or singleplayer aren\'t connected, so they don\'t show here.'));
    onlineTimer = setTimeout(whoOnline, 10000);
  }

  // ---- PLAYERS
  let playerQ = '';
  async function players() {
    const row = E('div', 'adRow'), inp = E('input', 'wide'); inp.placeholder = 'Search a driver name'; inp.value = playerQ;
    const go = button('SEARCH', () => { playerQ = inp.value; players(); });
    inp.onkeydown = e => { if (e.key === 'Enter') go.click(); };
    row.append(inp, go); body.innerHTML = ''; body.append(row);
    const j = await api('/api/admin/players?q=' + encodeURIComponent(playerQ)); if (j.error) { say(j.error); return; }
    const t = table(['DRIVER', 'STATUS', 'SP BEST', 'MP BEST', 'PLAYED', 'JOINED']);
    for (const p of j.list) {
      const tr = E('tr', 'link'); tr.onclick = () => player(p.name);
      cell(tr, p.name); cell(tr, p.banned ? tag(p.banUntil ? 'BANNED ' + left(p.banUntil) : 'BANNED', 'bad') : tag('OK', 'good'));
      cell(tr, fmt(p.sp) + (p.rankSp ? ` (#${p.rankSp})` : '')); cell(tr, fmt(p.mp) + (p.rankMp ? ` (#${p.rankMp})` : '')); cell(tr, dur(p.playS)); cell(tr, day(p.joined));
      t.appendChild(tr);
    }
    const sc = E('div', 'adScroll'); sc.appendChild(t); body.append(sc, E('div', 'adHelp', j.list.length ? 'Click a driver for bans, titles and their runs.' : 'Nobody found.'));
  }
  async function player(name) {
    const j = await api('/api/admin/player?name=' + encodeURIComponent(name)); if (j.error) { say(j.error); return; }
    body.innerHTML = ''; const redraw = () => player(name);
    const top = E('div', 'adRow'); top.append(button('← ALL PLAYERS', () => players()), E('b', '', j.name),
      j.banned ? tag(j.banUntil ? 'BANNED · ' + left(j.banUntil) + ' left' : 'BANNED (permanent)', 'bad') : tag('NOT BANNED', 'good'));
    body.append(top, E('div', 'adHelp', `SP best ${fmt(j.sp)}${j.rankSp ? ' (#' + j.rankSp + ')' : ''} · MP best ${fmt(j.mp)}${j.rankMp ? ' (#' + j.rankMp + ')' : ''} · played ${dur(j.playS)} · joined ${day(j.joined)}`),
      E('div', 'adHelp', `Referred ${j.ref.counted} player${j.ref.counted === 1 ? '' : 's'}${j.ref.pending ? ` (+${j.ref.pending} under 10 min played)` : ''}${j.referredBy ? ' · invited by ' + j.referredBy : ''}`));
    // bans
    body.append(E('h3', '', 'LEADERBOARD BAN'));
    const b = E('div', 'adRow'), days = E('input'); days.type = 'number'; days.min = 1; days.placeholder = 'days';
    b.append(button('BAN PERMANENTLY', () => act({ action: 'ban', name: j.name, days: 0 }, `Permanently leaderboard ban ${j.name}?`, redraw), 'red'), days,
      button('BAN FOR DAYS', () => { if (!(+days.value > 0)) { say('Type how many days.'); return; } act({ action: 'ban', name: j.name, days: +days.value }, `Leaderboard ban ${j.name} for ${+days.value} days? Their scores and stats reset when it ends.`, redraw); }, 'red'),
      button('UNBAN', () => act({ action: 'unban', name: j.name }, `Lift ${j.name}'s ban? (Nothing is reset.)`, redraw)));
    body.append(b, E('div', 'adHelp', 'A ban hides all their runs from every board and stops new ones. A ban for days ends by itself and resets their scores and stats (date joined and time played stay).'));
    // titles
    body.append(E('h3', '', 'TITLES'));
    const owned = E('div');
    for (const id of j.owned) {
      const t = Titles.TITLE_BY_ID[id], c = E('span', 'chip'); c.append(E('span', '', t ? t.name : id));
      if (boss() || !BOSS_ONLY.includes(id)) c.append(button('✕', () => act({ action: 'revoke', name: j.name, title: id }, `Take "${t ? t.name : id}" away from ${j.name}?`, redraw)));   // (Admin / Owner: only PolyWeave)
      owned.appendChild(c);
    }
    if (!j.owned.length) owned.appendChild(E('div', 'adHelp', 'No titles yet.'));
    const g = E('div', 'adRow'), sel = E('select'), note = E('input', 'wide'); note.placeholder = 'Message with it (optional)';
    for (const t of Titles.TITLES) { if (!boss() && BOSS_ONLY.includes(t.id)) continue; const o = E('option', '', `${t.name} (${Titles.RARITIES[t.rarity].name})`); o.value = t.id; sel.appendChild(o); }   // (Admin / Owner: only PolyWeave can give them)
    g.append(sel, note, button('GIVE TITLE', () => act({ action: 'grant', name: j.name, title: sel.value, note: note.value }, null, redraw)));
    body.append(owned, g);
    // runs
    body.append(E('h3', '', 'THEIR LATEST RUNS'), runTable(j.runs, redraw));
  }

  // ---- RUNS (filters)
  const runFilter = { name: '', mode: '', status: '', minScore: '', maxDur: '', minPps: '', days: '' };
  function runTable(list, redraw) {
    const t = table(['ID', 'DRIVER', 'MODE', 'SCORE / TIME', 'LENGTH', 'PTS / S', 'NEAR', 'WHEN', 'STATUS', '']);
    for (const r of list) {
      const tr = E('tr'), lapLike = r.mode === 'lap' || r.mode === 'race';
      cell(tr, '#' + r.id); cell(tr, r.name || ''); cell(tr, r.mode.toUpperCase());
      cell(tr, lapLike ? (r.score ? (r.score / 1000).toFixed(3) + ' s' : '—') : fmt(r.score)); cell(tr, dur(r.dur));
      cell(tr, lapLike || !r.dur ? '—' : fmt(r.score / r.dur)); cell(tr, r.near || '—'); cell(tr, day(r.t));
      const st = cell(tr, runStatus(r)); if (r.note) st.appendChild(E('div', 'note', r.note));
      cell(tr, r.verified === -1 || lapLike ? '' : r.removed ? button('PUT BACK', () => act({ action: 'restoreRun', id: r.id }, null, redraw)) : button('TAKE OFF', () => act({ action: 'removeRun', id: r.id }, `Take run #${r.id} (${fmt(r.score)}) off the leaderboard?`, redraw), 'red'));
      t.appendChild(tr);
    }
    const sc = E('div', 'adScroll'); sc.appendChild(t);
    if (!list.length) sc.appendChild(E('div', 'adHelp', 'No runs match.'));
    return sc;
  }
  async function runs() {
    const f = runFilter, row = E('div', 'adRow'), inputs = {};
    const add = (k, ph, type = 'text') => { const i = E('input'); i.type = type; i.placeholder = ph; i.value = f[k]; inputs[k] = i; row.appendChild(i); };
    const pick = (k, opts) => { const s = E('select'); for (const [v, n] of opts) { const o = E('option', '', n); o.value = v; s.appendChild(o); } s.value = f[k]; inputs[k] = s; row.appendChild(s); };
    add('name', 'driver name');
    pick('mode', [['', 'all modes'], ['sp', 'singleplayer'], ['mp', 'multiplayer'], ['lap', 'time-trial laps'], ['race', 'races']]);
    pick('status', [['', 'any status'], ['counted', 'counted on the board'], ['verified', 'verified'], ['rejected', 'rejected'], ['removed', 'taken off']]);
    add('minScore', 'min score', 'number'); add('maxDur', 'max length (s)', 'number'); add('minPps', 'min points / s', 'number'); add('days', 'last N days', 'number');
    const go = button('FILTER', () => { for (const k in inputs) f[k] = inputs[k].value; runs(); });
    row.appendChild(go); Object.values(inputs).forEach(i => (i.onkeydown = e => { if (e.key === 'Enter') go.click(); }));
    body.innerHTML = ''; body.append(row, E('div', 'adHelp', 'Tip: real players top out around 2,000 points per second - a high "min points / s" finds suspicious runs fast.'));
    const qs = Object.entries(f).filter(([, v]) => v !== '').map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const j = await api('/api/admin/runs?' + qs + '&limit=200'); if (j.error) { say(j.error); return; }
    body.appendChild(runTable(j.list, runs));
  }

  // ---- RACING
  const rf = { track: Tracks.TRACKS[0].id, kind: 'laps' };
  async function racing() {
    const row = E('div', 'adRow'), tr = E('select'), kd = E('select');
    for (const t of Tracks.TRACKS) { const o = E('option', '', t.name); o.value = t.id; tr.appendChild(o); }
    for (const [v, n] of [['laps', 'time-trial laps'], ['races', 'race results']]) { const o = E('option', '', n); o.value = v; kd.appendChild(o); }
    tr.value = rf.track; kd.value = rf.kind; tr.onchange = kd.onchange = () => { rf.track = tr.value; rf.kind = kd.value; racing(); };
    row.append(tr, kd); body.innerHTML = '';
    body.append(row, E('div', 'adHelp', 'HELD = more than 8% quicker than the track record, kept off the board until you approve it. Refused laps / races (and why) are in Runs (mode: laps / races, status: rejected).'));
    const j = await api(`/api/admin/racing?track=${rf.track}&kind=${rf.kind}`); if (j.error) { say(j.error); return; }
    const t = table(['ID', 'DRIVER', rf.kind === 'races' ? 'RACE TIME' : 'LAP', rf.kind === 'races' ? 'POS' : '', 'WHEN', 'STATUS', '']);
    const action = rf.kind === 'races' ? 'race' : 'lap';
    for (const r of j.list) {
      const row2 = E('tr');
      cell(row2, '#' + r.id); cell(row2, r.name); cell(row2, (r.ms / 1000).toFixed(3) + ' s'); cell(row2, rf.kind === 'races' ? `P${r.pos || '-'}/${r.n}` : ''); cell(row2, day(r.t));
      cell(row2, r.removed === 2 ? tag('HELD', 'hold') : r.removed ? tag('REMOVED', 'dim') : tag('COUNTED', 'good'));
      const b = E('td');
      if (r.removed === 2) b.append(button('APPROVE', () => act({ action, id: r.id, status: 0 }, null, racing)), button('REMOVE', () => act({ action, id: r.id, status: 1 }, null, racing), 'red'));
      else if (r.removed) b.append(button('RESTORE', () => act({ action, id: r.id, status: 0 }, null, racing)));
      else b.append(button('REMOVE', () => act({ action, id: r.id, status: 1 }, `Remove ${r.name}'s ${(r.ms / 1000).toFixed(3)} s?`, racing), 'red'));
      row2.appendChild(b); t.appendChild(row2);
    }
    const sc = E('div', 'adScroll'); sc.appendChild(t); if (!j.list.length) sc.appendChild(E('div', 'adHelp', 'Nothing yet on this track.'));
    body.appendChild(sc);
  }

  // ---- LOG
  async function log() {
    const j = await api('/api/admin/log'); if (j.error) { say(j.error); return; }
    const t = table(['WHEN', 'ACTION', 'WHO / WHAT', 'DETAIL']);
    for (const r of j.list) { const tr = E('tr'); cell(tr, day(r.t)); cell(tr, r.action); cell(tr, r.target || ''); cell(tr, r.detail || ''); t.appendChild(tr); }
    const sc = E('div', 'adScroll'); sc.appendChild(t); if (!j.list.length) sc.appendChild(E('div', 'adHelp', 'Nothing done yet.'));
    body.appendChild(sc);
  }

  // signed out / switched account: the button and screen go away
  window.AdminPanel = {
    account() {
      const on = Account.signedIn && Account.user && (Account.user.admin || Account.user.staff);   // (PolyWeave, or an admin)
      btn.classList.toggle('hidden', !on);
      roleNote.textContent = on && !boss() ? 'Changes are sent to PolyWeave to accept' : '';
      if (!on && screen === 'scrAdmin') show('scrTitle');
    },
  };
  AdminPanel.account();
})();
