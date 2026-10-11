'use strict';
// =====================================================================
//  Inbox + friends (loaded after main.js; uses its menu helpers). Two buttons at the bottom right of the main menu.
//  - Inbox: titles arrive here and are yours once you CLAIM them (with a reveal).
//  - Friends: requests by username (accept / deny), friends list with what they're playing (JOIN for public
//    servers), one-to-one chats, and settings: allow requests, hide my activity, message pop-ups.
//  - Live updates come over the game's WebSocket (net.js keeps it open while you're signed in): friends'
//    activity, new messages (pop up top right unless that chat is open), requests, new inbox items.
// =====================================================================
const Social = {
  data: null,          // /api/social: { friends, incoming, outgoing, settings, inbox }
  items: [],           // /api/inbox
  chat: null, actKey: '',

  api(path, body) {
    const base = Account.base || Net.base;
    if (!base || !Account.session) return Promise.reject(new Error('offline'));
    const o = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ session: Account.session }, body)) }
      : { headers: { Authorization: 'Bearer ' + Account.session }, cache: 'no-store' };
    return fetch(base + path, o).then(r => r.json());
  },

  // ---------------------------------------------------------------- signed in / out
  accountChanged() {
    if (Account.signedIn) {
      Net.connect().then(() => Net.send({ t: 'auth', session: Account.session })).catch(() => {});
      this.actKey = ''; this.refresh();
    } else {
      this.data = null; this.items = []; this.chat = null;
      if (Net.ws) Net.send({ t: 'auth', session: '' });
      this.badges(); this.render();
    }
  },
  async refresh() {
    if (!Account.signedIn) return;
    try {
      const [s, ib] = await Promise.all([this.api('/api/social'), this.api('/api/inbox')]);
      if (!s.error) this.data = s;
      if (!ib.error) this.items = ib.items || [];
    } catch (e) { /* offline */ }
    this.badges();
    this.render();
  },

  // ---------------------------------------------------------------- counts on the two buttons (bottom right of the main menu)
  badges() {
    const d = this.data;
    const set = (id, n) => {
      const b = $id(id); if (b.textContent === String(n)) return;
      b.textContent = n > 99 ? '99+' : String(n); b.classList.add('hidden');
      if (n) requestAnimationFrame(() => b.classList.remove('hidden'));   // (pops in again when the count changes)
    };
    set('inboxBadge', this.items.filter(i => !i.claimed).length);
    set('friendsBadge', d ? d.incoming.length + d.friends.reduce((n, f) => n + (f.unread || 0), 0) : 0);
  },

  // ---------------------------------------------------------------- the two screens
  open(which = 'inbox', chatWith) {
    const id = which === 'friends' ? 'scrFriends' : 'scrInbox';
    if (!menuOpen) openMenu(id); else show(id);
    this.render(); this.refresh();
    if (chatWith) this.openChat(chatWith);
  },
  render() {
    const signed = Account.signedIn;
    if (screen === 'scrInbox') {
      $id('ibNote').textContent = signed ? '' : 'Sign in with Google on the main menu to get titles.';
      if (signed) this.renderInbox(); else $id('ibInbox').innerHTML = '';
    }
    if (screen === 'scrFriends') {
      $id('frNote').textContent = signed ? '' : 'Sign in with Google on the main menu to add friends.';
      $id('ibFriends').classList.toggle('hidden', !signed);
      if (signed) this.renderFriends();
    }
  },
  renderInbox() {
    const box = $id('ibInbox'); box.innerHTML = '';
    if (!this.items.length) { box.append(el('div', 'ibEmpty', 'Nothing here yet. Titles you earn show up here.')); return; }
    for (const it of this.items) {
      const t = it.kind === 'title' && Titles.TITLE_BY_ID[it.item]; if (!t) continue;
      const row = el('div', 'ibItem' + (it.claimed ? ' done' : ''));
      const what = el('div', 'what'); what.append(el('small', '', it.claimed ? 'Title claimed' : 'New title'), titleEl(t.id), el('span', 'd', Titles.desc(t, Settings.units)));
      const ico = el('div', 'ico'); ico.append(icon('tag'));          // (simple white tag; greys out once claimed)
      row.append(ico, what);
      if (it.claimed) row.append(el('span', 'got', 'CLAIMED ✓'));
      else { const b = el('button', 'go', 'CLAIM'); b.onclick = () => this.claim(it, b); row.append(b); }
      box.appendChild(row);
    }
  },
  async claim(it, btn) {
    btn.disabled = true;
    let r;
    try { r = await this.api('/api/inbox/claim', { id: it.id }); } catch (e) { btn.disabled = false; return; }
    if (r.error) { btn.disabled = false; return; }
    it.claimed = true; this.badges(); this.renderInbox();
    if (profData && profData.self && !profData.owned.includes(it.item)) profData.owned.push(it.item);
    this.reveal(it.item);
  },
  // the reveal (style.css "claiming a title"): glow + ring in the title's colour, the title settles in, EQUIP / LATER.
  // Showing it (display: none -> shown) restarts every animation in it.
  reveal(id) {
    const t = Titles.TITLE_BY_ID[id], fx = $id('claimFx');
    fx.style.setProperty('--rc', Titles.RARITIES[t.rarity].color);
    const box = $id('cfTitle'); box.innerHTML = ''; box.append(titleEl(id));
    $id('cfDesc').textContent = Titles.desc(t, Settings.units);
    // always a fresh start: cancel a close still in progress, and hide + show so every animation (ring, glow,
    // title) plays from the beginning even if the last reveal was still open
    clearTimeout(this._cfT);
    fx.classList.add('hidden'); void fx.offsetWidth;
    fx.classList.remove('hidden', 'closing');
    const close = () => { fx.classList.add('closing'); clearTimeout(this._cfT); this._cfT = setTimeout(() => fx.classList.add('hidden'), 220); };
    $id('cfOk').onclick = close;
    $id('cfEquip').onclick = async () => {
      try {
        const r = await this.api('/api/title', { title: id });
        if (!r.error) { Account.user.title = r.equipped; if (profData && profData.self) { profData.title = r.equipped; showProfTitle(); } }
      } catch (e) { /* offline */ }
      close();
    };
  },

  // ---------------------------------------------------------------- friends tab
  renderFriends() {
    const d = this.data; if (!d) return;
    $id('frAllow').checked = d.settings.allowRequests;
    $id('frHide').checked = d.settings.hideActivity;
    $id('frPopups').checked = Settings.msgPopups !== false;
    // requests
    const rq = $id('frRequests'); rq.innerHTML = '';
    if (d.incoming.length) {
      rq.append(el('div', 'frHead', 'Friend requests'));
      for (const name of d.incoming) {
        const row = el('div', 'frRow'), nm = el('div', 'nm'); nm.append(el('b', '', name), el('span', '', 'wants to be friends'));
        const yes = el('button', 'go', 'ACCEPT'), no = el('button', '', 'DENY');
        yes.onclick = () => this.friendCall('respond', name, { accept: true }, `You and ${name} are now friends.`);
        no.onclick = () => this.friendCall('respond', name, { accept: false });
        row.append(nm, yes, no); rq.appendChild(row);
      }
    }
    if (d.outgoing.length) {
      rq.append(el('div', 'frHead', 'Sent'));
      for (const name of d.outgoing) {
        const row = el('div', 'frRow'), nm = el('div', 'nm'); nm.append(el('b', '', name), el('span', '', 'request sent'));
        const c = el('button', '', 'CANCEL'); c.onclick = () => this.friendCall('cancel', name);
        row.append(nm, c); rq.appendChild(row);
      }
    }
    // friends: playing first, then online, then offline
    const list = $id('frList'); list.innerHTML = '';
    if (!d.friends.length) { list.append(el('div', 'frEmpty', 'No friends yet. Add someone by their username above.')); return; }
    const rank = f => !f.p.online ? 2 : f.p.act && f.p.act.mode !== 'menu' ? 0 : 1;
    for (const f of d.friends.slice().sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))) {
      const row = el('div', 'frRow' + (this.chat === f.name ? ' chatting' : ''));
      const dot = el('span', 'dot' + (f.p.online ? (rank(f) === 0 ? ' play' : ' on') : ''));
      const nm = el('div', 'nm'); nm.append(el('b', '', f.name), el('span', '', this.activityText(f.p)));
      row.append(dot, nm);
      const a = f.p.act;
      if (a && a.mode === 'mp' && a.room && !(Net.room && Net.room.id === a.room)) {   // public / official server: you can join them
        const j = el('button', 'join', a.full ? 'FULL' : 'JOIN'); j.disabled = !!a.full;
        j.onclick = () => { Net.joinServer(a.room, myName(), Settings.color); };
        row.append(j);
      }
      const c = el('button', '', 'CHAT'); c.onclick = () => this.openChat(f.name);
      if (f.unread) { const bd = el('span', 'badge', String(f.unread)); c.append(bd); }
      const x = el('button', 'x', '✕'); x.title = 'Remove friend';
      x.onclick = () => { if (confirm(`Remove ${f.name} from your friends?`)) { if (this.chat === f.name) this.closeChat(); this.friendCall('remove', f.name); } };
      row.append(c, x);
      list.appendChild(row);
    }
  },
  // what a friend is doing, e.g. "Singleplayer · Grassy · Night" or "Public · Desert · Day"
  activityText(p) {
    if (!p.online) return 'Offline';
    if (p.hidden || !p.act) return 'Online';
    const a = p.act, w = (WORLD_NAMES[a.theme] || 'Grassy') + ' · ' + (TOD_NAMES[a.tod] || 'Day');
    if (a.mode === 'sp') return 'Singleplayer · ' + w;
    if (a.mode === 'mp') return (a.kind === 'private' ? 'Private server' : 'Public') + ' · ' + w;
    return 'In the menus';
  },
  async friendCall(what, name, extra, okMsg) {
    const msg = $id('frMsg');
    let r;
    try { r = await this.api('/api/friends/' + what, Object.assign({ name }, extra || {})); } catch (e) { msg.className = 'frMsg err'; msg.textContent = 'Could not reach the server.'; return; }
    if (r.error) { msg.className = 'frMsg err'; msg.textContent = r.error; }
    else if (what === 'request') { msg.className = 'frMsg ok'; msg.textContent = r.ok === 'accepted' ? `You and ${r.name} are now friends.` : `Friend request sent to ${r.name}.`; }
    else if (okMsg) { msg.className = 'frMsg ok'; msg.textContent = okMsg; }
    else msg.textContent = '';
    this.refresh();
  },
  async saveSettings() {
    try { const r = await this.api('/api/social/settings', { allowRequests: $id('frAllow').checked, hideActivity: $id('frHide').checked }); if (!r.error && this.data) this.data.settings = r; } catch (e) { /* offline */ }
  },

  // ---------------------------------------------------------------- chats
  async openChat(name) {
    this.chat = name;
    $id('chatEmpty').classList.add('hidden');
    for (const id of ['chatHead', 'chatLog', 'chatForm']) $id(id).classList.remove('hidden');
    const f = this.data && this.data.friends.find(x => x.name === name);
    const head = $id('chatHead'); head.innerHTML = ''; head.append(el('b', '', name), el('span', '', f ? this.activityText(f.p) : ''));
    const log = $id('chatLog'); log.innerHTML = '';
    let r;
    try { r = await this.api('/api/chat?with=' + encodeURIComponent(name)); } catch (e) { return; }
    if (this.chat !== name || r.error) return;
    for (const m of r.messages) this.bubble(m.me, m.body, m.t);
    if (f) f.unread = 0;
    this.badges(); this.renderFriends();
    $id('chatText').focus();
  },
  closeChat() {
    this.chat = null;
    $id('chatEmpty').classList.remove('hidden');
    for (const id of ['chatHead', 'chatLog', 'chatForm']) $id(id).classList.add('hidden');
  },
  bubble(me, body, t) {
    const log = $id('chatLog'), b = el('div', 'bub' + (me ? ' me' : ''), body);
    b.append(el('time', '', new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })));
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.appendChild(b);
    if (atEnd || me) log.scrollTop = log.scrollHeight;
  },
  async send(text) {
    const to = this.chat; text = text.trim(); if (!to || !text) return;
    this.bubble(true, text, Date.now());
    try { const r = await this.api('/api/chat/send', { to, body: text }); if (r.error) this.bubble(false, '⚠ ' + r.error, Date.now()); } catch (e) { this.bubble(false, '⚠ Not sent: no connection', Date.now()); }
  },
  chatVisible(name) { return menuOpen && screen === 'scrFriends' && this.chat === name && document.visibilityState === 'visible'; },

  // ---------------------------------------------------------------- live updates (net.js -> here)
  onLive(m) {
    if (m.t === 'msg') {
      if (this.chatVisible(m.from)) { this.bubble(false, m.body, m.at); this.api('/api/chat/read', { with: m.from }).catch(() => {}); return; }
      const f = this.data && this.data.friends.find(x => x.name === m.from);
      if (f) f.unread = (f.unread || 0) + 1; else this.refresh();
      this.badges(); if (screen === 'scrFriends') this.renderFriends();
      if (Settings.msgPopups !== false) this.toast(m.from, m.body, () => this.open('friends', m.from));
    } else if (m.t === 'presence') {
      const f = this.data && this.data.friends.find(x => x.name === m.name);
      if (f) { f.p = m.p; if (screen === 'scrFriends') { this.renderFriends(); if (this.chat === m.name) this.openChatHead(f); } }
    } else if (m.t === 'social') {
      if (m.request && Settings.msgPopups !== false) this.toast(m.request, 'sent you a friend request', () => this.open('friends'));
      this.refresh();
    } else if (m.t === 'inbox') this.refresh();
  },
  openChatHead(f) { const head = $id('chatHead'); head.innerHTML = ''; head.append(el('b', '', f.name), el('span', '', this.activityText(f.p))); },
  // a message pops in at the top right (click it to open the chat)
  toast(from, text, onClick) {
    const t = el('div', 'toast'), tx = el('div', 'tx');
    tx.append(el('b', '', from), el('span', '', text));
    t.append(el('div', 'av', from.slice(0, 1).toUpperCase()), tx);
    const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 350); };
    t.onclick = () => { close(); onClick(); };
    const box = $id('toasts'); box.prepend(t);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(close, 6000);
  },

  // what I'm doing, for friends (servers are known to the server; this covers menus / singleplayer)
  reportActivity() {
    if (!Account.signedIn || !Net.ws || game.mode === 'mp') return;
    const a = game.mode === 'sp' ? { mode: 'sp', theme: Settings.world, tod: Settings.tod, scored: game.scored } : { mode: 'menu' };
    const k = JSON.stringify(a);
    if (k !== this.actKey) { this.actKey = k; Net.send({ t: 'activity', a }); }
  },
};

// ---------------------------------------------------------------- achievements (Brawl Stars "records" style)
// Each track is a stat with tiers (1/3, 2/3, 3/3); each tier rewards a title. Past the last tier the stat keeps
// counting (MAX).
const Achievements = {
  async open() {
    show('scrAch');
    const note = $id('achNote'), list = $id('achList');
    list.innerHTML = '';
    if (!Account.signedIn) { note.textContent = 'Sign in with Google on the main menu to track achievements and earn titles.'; return; }
    note.textContent = 'Loading…';
    let d;
    try { d = await Social.api('/api/achievements'); } catch (e) { note.textContent = 'Could not reach the server.'; return; }
    if (screen !== 'scrAch') return;
    if (d.error) { note.textContent = d.error; return; }
    note.textContent = 'Reach each goal to earn its title. Titles arrive in your inbox.';
    for (const a of Titles.ACHIEVEMENTS) list.appendChild(this.card(a, d));
  },
  // a stat in the player's units: points, x multiplier, a count, or distance (mi / km)
  fmt(a, v) {
    if (a.unit === 'dist') { const mi = Settings.units !== 'kmh'; const n = v / (mi ? Titles.MILE : 1000); return (n >= 100 ? Math.floor(n).toLocaleString('en-US') : (Math.floor(n * 10) / 10).toString()) + (mi ? ' mi' : ' km'); }
    if (a.unit === 'x') return 'x' + (Math.floor(v * 10) / 10);
    return Math.floor(v).toLocaleString('en-US');
  },
  goal(a, t) {
    if (a.unit === 'pts') { const v = t.value; return v >= 1e9 ? v / 1e9 + 'B' : v >= 1e6 ? v / 1e6 + 'M' : v >= 1e3 ? v / 1e3 + 'K' : String(v); }   // (100K, 1M, 10M, 1B)
    const g = Titles.goalText(t, Settings.units);
    return a.unit === 'dist' ? g + (Settings.units === 'kmh' ? ' km' : ' mi') : a.unit === 'x' ? 'x' + g : g;
  },
  card(a, d) {
    const v = d.stats[a.stat] || 0, owned = new Set(d.owned), pending = new Set(d.pending);
    const tiers = a.tiers.map(id => Titles.TITLE_BY_ID[id]);
    const done = tiers.filter(t => v >= t.value || owned.has(t.id) || pending.has(t.id)).length, max = done === tiers.length;
    const next = tiers[done];
    const card = el('div', 'achCard' + (max ? ' max' : ''));
    const head = el('div', 'achHead');
    head.append(el('b', '', a.name), el('span', 'achTier' + (max ? ' max' : ''), max ? 'MAX' : `${done}/${tiers.length}`));
    card.append(head, el('div', 'achDesc', a.desc));
    // progress toward the next tier (from the last one reached); full once maxed
    const from = done ? tiers[done - 1].value : 0, frac = max ? 1 : U.clamp((v - from) / (next.value - from), 0, 1);
    const bar = el('div', 'achBar'), fill = el('i'); fill.style.width = (frac * 100).toFixed(1) + '%'; bar.append(fill);
    card.append(bar, el('div', 'achNum', max ? `${this.fmt(a, v)} · all done` : `${this.fmt(a, v)} / ${this.goal(a, next)}`));
    // the rewards: each tier's goal and title (owned / waiting in the inbox / still to earn)
    const rw = el('div', 'achRewards');
    tiers.forEach((t, i) => {
      const got = owned.has(t.id), wait = pending.has(t.id) || (!got && v >= t.value);
      const row = el('div', 'achReward' + (got ? ' got' : wait ? ' wait' : ' locked'));
      const st = got ? icon('check') : wait ? icon('tag') : icon('lock');
      row.append(el('span', 'achStep', `${i + 1}`), el('span', 'achGoal', this.goal(a, t)), titleEl(t.id), st);
      if (wait) row.title = 'Waiting in your inbox: claim it there';
      rw.appendChild(row);
    });
    card.appendChild(rw);
    return card;
  },
};
$id('achCard').onclick = () => Achievements.open();

// ---------------------------------------------------------------- server chat (multiplayer)
// "Name[Title] joined the server" / "Name [Title] : message" (your exact format). Enter opens the box, Enter sends, Esc cancels.
// One message per 3 s (the server enforces it too). Lines fade after 12 s; all show again while typing.
const MpChat = {
  GAP: 3000, last: 0,
  box: $id('mpChat'), lines: $id('mpChatLines'), form: $id('mpChatForm'), input: $id('mpChatInput'), hint: $id('mpChatHint'),
  get open() { return !this.form.classList.contains('hidden'); },
  who(name, title, gap) {                    // "Name[Title]" (gap: "Name [Title]"), the title in its rarity colour
    const f = document.createDocumentFragment(); f.append(el('b', '', name));
    const t = titleEl(title); if (t) f.append(gap ? ' [' : '[', t, ']');
    return f;
  },
  add(m) {
    const line = el('div', 'mcLine' + (m.sys ? ' sys' : ''));
    if (m.sys) line.append(this.who(m.name, m.title, false), m.sys === 'join' ? ' joined the server' : ' left the server');
    else line.append(this.who(m.name, m.title, true), ' : ', m.text);
    this.lines.appendChild(line);
    while (this.lines.children.length > 60) this.lines.firstChild.remove();
    this.lines.scrollTop = this.lines.scrollHeight;
    setTimeout(() => line.classList.add('old'), 12000);
  },
  onNet(m) {
    if (m.t === 'chatwait') { this.wait(m.ms); return; }
    this.add(m);
  },
  wait(ms) { this.hint.textContent = `Wait ${Math.ceil(ms / 1000)} s before sending another message`; clearTimeout(this._h); this._h = setTimeout(() => (this.hint.textContent = ''), Math.min(ms, 3000)); },
  show(on) { this.box.classList.toggle('open', on); this.form.classList.toggle('hidden', !on); if (on) this.input.focus(); else { this.input.blur(); this.hint.textContent = ''; } },
  send() {
    const text = this.input.value.trim();
    if (!text) { this.show(false); return; }
    const left = this.last + this.GAP - Date.now();
    if (left > 0) { this.wait(left); return; }              // (keeps the text: send it once the wait is over)
    this.last = Date.now();
    Net.send({ t: 'chat', text });
    this.input.value = ''; this.show(false);
  },
  clear() { this.lines.innerHTML = ''; this.show(false); },
};
Net.onChat = m => MpChat.onNet(m);
MpChat.form.onsubmit = e => { e.preventDefault(); MpChat.send(); };
MpChat.input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); MpChat.input.value = ''; MpChat.show(false); } });
// Enter while driving on a server: open the chat (not while a menu or another text box is in use)
addEventListener('keydown', e => {
  if (e.key !== 'Enter' || MpChat.open || menuOpen || game.mode !== 'mp' || !Net.active()) return;
  if (e.target && e.target.tagName === 'INPUT') return;
  e.preventDefault(); MpChat.show(true);
});
// shown only while on a server; a fresh, empty chat for each server
{ const prev = Net.onRoster; Net.onRoster = () => { if (prev) prev(); MpChat.box.classList.toggle('hidden', !Net.active()); if (!Net.active()) MpChat.clear(); }; }
{ const prev = Net.onJoined; Net.onJoined = (room, slot) => { MpChat.clear(); MpChat.last = 0; if (prev) prev(room, slot); }; }

// ---------------------------------------------------------------- wiring
$id('inboxBtn').onclick = () => Social.open('inbox');
$id('friendsBtn').onclick = () => Social.open('friends');
$id('frSend').onclick = () => { const n = $id('frName').value.trim(); if (n) { Social.friendCall('request', n); $id('frName').value = ''; } };
$id('frName').addEventListener('keydown', e => { if (e.key === 'Enter') $id('frSend').click(); });
$id('frAllow').onchange = $id('frHide').onchange = () => Social.saveSettings();
$id('frPopups').onchange = () => { Settings.msgPopups = $id('frPopups').checked; saveSettings(); };
$id('chatForm').onsubmit = e => { e.preventDefault(); const i = $id('chatText'); Social.send(i.value); i.value = ''; };
Net.onSocial = m => Social.onLive(m);
// signed in and the connection dropped: reconnect (friends, messages)
Net.onClosed = () => { if (Account.signedIn) setTimeout(() => { if (Account.signedIn && !Net.ws) Net.connect().catch(() => {}); }, 5000); };
Net.onOpened = () => { Social.actKey = ''; setTimeout(() => Social.reportActivity(), 300); };
{ const prev = Account.onChange; Account.onChange = () => { if (prev) prev(); Social.accountChanged(); }; }
if (Account.ready) Social.accountChanged();
setInterval(() => Social.reportActivity(), 2000);
setInterval(() => { if (Account.signedIn && document.visibilityState === 'visible' && !Net.ws) Net.connect().catch(() => {}); }, 30000);
