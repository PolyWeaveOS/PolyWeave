'use strict';
// =====================================================================
//  Updates board (main menu, top right): what's new in the current update and everything before it. The button
//  shows a dot until you've opened the board since the latest update (remembered in this browser).
//  To add an update: put it at the top of UPDATES (the first one is shown as the current update).
// =====================================================================
const UPDATES = [
  { v: '1.2', name: 'The Bang Bus', when: 'October 2026', items: [
    ['new', 'Bang Bus event: finish 5 quests - sign in with Google, play for 1 hour, drive 75 miles, score over 100,000 in one run and refer 3 friends - to unlock the Bang Bus for good. It\'s just for fun: no leaderboard points and no proxy bonus.'],
    ['new', 'Invite friends: your own invite link on your profile and in Friends. Players who join from it and play 10 minutes count as your referrals.'],
    ['new', 'The Bang Bus has real windows, its own cab in first person with working mirrors, and headlights and tail lights that work.'],
    ['new', 'Host a server for cars only (no motorcycles or Bang Bus): Multiplayer → Host → Vehicles.'],
    ['new', 'Friends can see when you\'re racing or in a time trial, and on which track.'],
    ['fix', 'Chat messages arrive without reloading, and reading a message clears its notification.'],
    ['fix', 'The Friends and Inbox buttons are bigger and no longer shrink on small screens.'],
  ] },
  { v: '1.1', name: 'Racing Garage', when: 'October 21, 2026', items: [
    ['new', 'Customize your F1 car in the Racing Garage: paint, patterns and rims, plus parts - tires, rear wing, front wing, gearbox and brake bias - with stats that show what each one does.'],
    ['new', 'Ghost car in time trials: race against your best lap (Settings → Gameplay).'],
    ['new', 'Races: causing a car collision adds 5 seconds to your time.'],
    ['fix', 'The racing timing tower no longer stays on screen after leaving a race queue.'],
    ['fix', 'Holding the throttle when the lights go green now launches the car straight away.'],
    ['thanks', 'Thanks to beachrat and TTNoManchas for finding these bugs - they got the Bug Hunter title.'],
  ] },
  { v: '1.0', name: 'Season 1: Racing', when: 'October 19, 2026', items: [
    ['new', 'Season 1 begins. The beta leaderboards are kept as Season 0 (Beta).'],
    ['new', 'Racing, a limited-time mode: three circuits inspired by Spa, Silverstone and Interlagos, races for 2 - 10 players, time trials and an F1 car.'],
    ['new', 'Racing leaderboards: Season 1 titles for the top 3 on every track.'],
    ['new', 'Stronger brakes.'],
  ] },
  { v: 'Beta', name: 'Season 0', when: 'Before Season 1', items: [
    ['new', 'Leaderboards with checked runs, profiles, titles, achievements and the inbox.'],
    ['new', 'Friends: requests, chat, and seeing what your friends are playing.'],
    ['new', 'Multiplayer: official, public and private servers - scored or free drive.'],
  ] },
];
const UpdatesBoard = {
  seenKey: 'pw_seenUpdate',
  latestSeen() { try { return localStorage.getItem(this.seenKey) === UPDATES[0].v; } catch (e) { return true; } },
  mark() { $id('updatesBtn').classList.toggle('fresh', !this.latestSeen()); },
  open() {
    const box = $id('updList'); box.innerHTML = '';
    UPDATES.forEach((u, i) => {
      const card = el('div', 'updCard' + (i === 0 ? ' now' : ''));
      const head = el('div', 'updHead');
      head.append(el('span', 'updV', u.v === 'Beta' ? u.v : 'v' + u.v), el('b', '', u.name), el('span', 'updWhen', u.when));
      if (i === 0) head.append(el('span', 'updNow', 'CURRENT UPDATE'));
      const list = el('ul', 'updItems');
      for (const [kind, text] of u.items) { const li = el('li', 'upd-' + kind); li.append(el('i', '', kind === 'fix' ? 'FIX' : kind === 'thanks' ? 'THANKS' : 'NEW'), el('span', '', text)); list.appendChild(li); }
      card.append(head, list); box.appendChild(card);
    });
    show('scrUpdates');
    try { localStorage.setItem(this.seenKey, UPDATES[0].v); } catch (e) { /* ignore */ }
    this.mark();
  },
};
$id('updatesBtn').onclick = () => UpdatesBoard.open();
UpdatesBoard.mark();
