'use strict';
// =====================================================================
//  The Bang Bus event (loaded after social.js): the home BANG BUS card and the locked Bang Bus in the Garage open
//  this screen - the bus and its five quests. Finishing all of them unlocks the Bang Bus for good (the server keeps
//  the progress and the unlock: /api/event, db.js busProgress). Quest rows: Sign in with Google (Google's button
//  right in the row), Play 1 hour, Drive 75 miles, Score over 100,000, Refer 3 friends (opens your invite link in
//  Friends).
// =====================================================================
const BusEvent = {
  data: null, from: 'scrTitle',
  QUESTS: {
    signin: { name: 'Sign in with Google', icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.2-7 8-7s7 2.5 8 7"/>' },
    play: { name: 'Play for 1 hour', icon: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2h5"/>' },
    drive: { name: 'Drive 75 miles', icon: '<path d="M4 20 9 4M20 20 15 4M12 6v2M12 11v2M12 16v2"/>' },
    score: { name: 'Score over 100,000 in one run', icon: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>' },
    refer: { name: 'Refer 3 friends', icon: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.6-3.3 3.2-5.2 6.5-5.2s5.9 1.9 6.5 5.2"/><path d="M18 8v6M15 11h6"/>' },
    // (the other way: instead of all five quests)
    refer5: { name: 'Refer 5 friends', icon: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.6-3.3 3.2-5.2 6.5-5.2s5.9 1.9 6.5 5.2"/><path d="M18 8v6M15 11h6"/>' },
  },
  // from: the screen Back returns to (the main menu, or the Garage when it came from the locked bus)
  open(from) {
    this.from = from || (screen === 'scrGarage' ? 'scrGarage' : 'scrTitle');
    show('scrEvent'); this.render(); this.load();
  },
  async load() {
    if (!Account.signedIn) { this.data = null; this.render(); return; }
    try {
      const j = await (await fetch((Account.base || Net.base) + '/api/event', { cache: 'no-store', headers: { Authorization: 'Bearer ' + Account.session } })).json();
      if (j.guest) return;
      const was = Account.user && Account.user.bus;
      this.data = j;
      if (j.unlocked && Account.user && !Account.user.bus) Account.user.bus = true;   // (finished just now: it's yours)
      if (screen === 'scrEvent') this.render(!was && j.unlocked && !j.owner);
    } catch (e) { /* offline */ }
  },
  // progress words for each quest, in the player's units
  progress(q) {
    const mi = Settings.units !== 'kmh';
    if (q.id === 'play') { const m = Math.floor(Math.min(q.have, q.need) / 60); return `${m >= 60 ? '1h' : m + 'm'} / 1h`; }
    if (q.id === 'drive') { const k = mi ? 1609.344 : 1000, f = v => (v >= 100 ? Math.floor(v) : Math.floor(v * 10) / 10); return `${f(Math.min(q.have, q.need) / k)} / ${f(q.need / k)} ${mi ? 'mi' : 'km'}`; }
    if (q.id === 'score') return `${U.fmt(Math.min(q.have, q.need))} / ${U.fmt(q.need)}`;
    if (q.id === 'refer' || q.id === 'refer5') return `${Math.min(q.have, q.need)} / ${q.need}` + (q.have < q.need && q.pending ? ` · ${q.pending} still playing their first 10 minutes` : '');
    return q.have >= q.need ? 'Done' : 'Not signed in';
  },
  render(justUnlocked) {
    const list = $id('evList'), signed = Account.signedIn, d = this.data;
    $id('evBack').onclick = () => show(this.from);
    const quests = d ? d.quests : Object.keys(this.QUESTS).map(id => ({ id, have: 0, need: { signin: 1, play: 3600, drive: 120701, score: 100000, refer: 3 }[id] }));
    const unlocked = !!(d && d.unlocked) || canVan();
    $id('evState').textContent = unlocked ? (justUnlocked ? 'UNLOCKED!' : 'UNLOCKED') : 'LOCKED';
    $id('evState').classList.toggle('on', unlocked);
    $id('evDrive').classList.toggle('hidden', !unlocked);
    const alt = (d && d.alt) || { id: 'refer5', have: 0, need: 5 };
    $id('evIntro').textContent = unlocked ? (d && d.perk && !d.owner ? 'The Bang Bus is yours: a perk of your title. Pick it in the Garage.' : 'The Bang Bus is yours. Pick it in the Garage.')
      : signed ? `Complete all 5 quests, or refer 5 friends, to unlock the Bang Bus for good. (${quests.filter(q => q.have >= q.need).length} / 5 quests done)`
      : !Account.clientId ? 'The event needs the online game: open it from polyweave.org.' : 'Sign in with Google to start - your progress is saved to your account.';
    list.innerHTML = '';
    for (const q of [...quests, null, alt]) {
      if (!q) { list.appendChild(el('div', 'evOr', 'OR')); continue; }   // (the other way to unlock it, below)
      const ref = q.id === 'refer' || q.id === 'refer5';
      const info = this.QUESTS[q.id], done = signed && q.have >= q.need, click = (ref && signed && !done) || (q.id === 'signin' && !signed);
      const row = el('div', 'evQuest' + (done ? ' done' : '') + (ref && signed ? ' click' : ''));
      const ico = el('div', 'evIco'); ico.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${info.icon}</svg>`;
      const mid = el('div', 'evMid'), bar = el('div', 'evBar'), fill = el('i');
      fill.style.width = (signed ? Math.min(1, q.have / q.need) * 100 : 0).toFixed(1) + '%'; bar.append(fill);
      mid.append(el('b', '', info.name), bar, el('span', 'evProg', signed ? this.progress(q) : q.id === 'signin' ? 'Sign in to start the event' : 'Sign in first'));
      const end = el('div', 'evEnd');
      if (done) end.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
      else if (q.id === 'signin' && Account.gisLoaded) { const g = el('div', 'evGoogle'); end.append(g); Account.renderButton(g); }
      else if (click) end.textContent = '›';
      row.append(ico, mid, end);
      if (ref && signed) row.onclick = () => this.invite();
      list.appendChild(row);
    }
  },
  // Refer 3 friends: Friends, with your invite link picked out
  invite() {
    Social.open('friends');
    const box = $id('frRef'); box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
    setTimeout(() => box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300);
  },
  // the unlocked Bang Bus: pick it and show it in the Garage
  drive() { Settings.vehicle = 'van'; saveSettings(); setVehicle('van'); show('scrGarage'); },
};
$id('ltmEvent').onclick = () => BusEvent.open('scrTitle');
if (CG) $id('ltmEvent').classList.add('hidden');        // (CrazyGames: no Google sign-in, so no quests - and no Bang Bus tile in the Garage)
$id('evDrive').onclick = () => BusEvent.drive();
// signed in / out (or Google's button arrived) while the event is open: redraw it with that account's progress
{ const prev = Account.onChange; Account.onChange = () => { if (prev) prev(); if (screen === 'scrEvent') { BusEvent.render(); BusEvent.load(); } }; }
