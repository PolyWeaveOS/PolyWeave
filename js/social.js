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
      row.append(el('div', 'ico', '🏷️'), what);
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
    fx.classList.remove('hidden', 'closing');
    const close = () => { fx.classList.add('closing'); setTimeout(() => fx.classList.add('hidden'), 220); };
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
