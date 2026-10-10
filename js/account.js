'use strict';
// =====================================================================
//  Player accounts: Sign in with Google (you need one to get on the leaderboards).
//  Google's sign-in button gives the game an ID token; the server checks it with Google and replies
//  with a session token that this browser keeps, so you stay signed in. New accounts pick a driver name.
// =====================================================================
const Account = {
  user: null, session: null, clientId: '', base: null, gisLoaded: false, ready: false,
  onChange: null, onNeedName: null, onMsg: null,

  get signedIn() { return !!(this.user && this.user.name); },
  changed() { if (this.onChange) this.onChange(); },
  msg(t) { if (this.onMsg) this.onMsg(t); },

  async init() {
    try { this.session = localStorage.getItem('pw_session'); } catch (e) { /* ignore */ }
    this.base = await Net.findBase();
    if (!this.base) { this.ready = true; this.changed(); return; }
    try { const c = await (await fetch(this.base + '/api/config', { cache: 'no-store' })).json(); this.clientId = c.googleClientId || ''; } catch (e) { /* offline */ }
    if (this.session) {                                     // still signed in from last time?
      try {
        const r = await fetch(this.base + '/api/account', { headers: { Authorization: 'Bearer ' + this.session }, cache: 'no-store' });
        if (r.ok) this.user = await r.json(); else if (r.status === 401) this.forget();
      } catch (e) { /* offline */ }
    }
    if (this.clientId) this.loadGoogle();
    this.ready = true; this.changed();
    if (this.user && !this.user.name && this.onNeedName) this.onNeedName();
  },
  loadGoogle() {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => {
      google.accounts.id.initialize({ client_id: this.clientId, callback: r => this.onGoogle(r), auto_select: false, cancel_on_tap_outside: true });
      this.gisLoaded = true; this.changed();
    };
    document.head.appendChild(s);
  },
  // Google's own button, drawn into el (once per element)
  renderButton(el) {
    if (!this.gisLoaded || !el || el.dataset.done) return;
    google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' });
    el.dataset.done = '1';
  },
  async onGoogle(resp) {
    try {
      const r = await fetch(this.base + '/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: resp.credential }) });
      const j = await r.json();
      if (!r.ok) { this.msg(j.error || 'Sign-in failed.'); return; }
      this.session = j.session; this.user = { name: j.name, title: j.title || null };
      try { localStorage.setItem('pw_session', j.session); } catch (e) { /* ignore */ }
      this.changed();
      if (!j.name && this.onNeedName) this.onNeedName();      // first time: pick a driver name
    } catch (e) { this.msg('Sign-in failed. Check your internet connection.'); }
  },
  // returns an error message, or null when the name was saved
  async setName(name) {
    try {
      const r = await fetch(this.base + '/api/account/name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: this.session, name }) });
      const j = await r.json();
      if (!r.ok) return j.error || 'Could not save that name.';
      this.user = Object.assign({}, this.user, { name: j.name }); this.changed();
      return null;
    } catch (e) { return 'Could not reach the server.'; }
  },
  async signOut() {
    const s = this.session;
    this.forget(); this.changed();
    if (this.gisLoaded) google.accounts.id.disableAutoSelect();
    if (s && this.base) fetch(this.base + '/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: s }) }).catch(() => {});
  },
  forget() { this.user = null; this.session = null; try { localStorage.removeItem('pw_session'); } catch (e) { /* ignore */ } },
};
