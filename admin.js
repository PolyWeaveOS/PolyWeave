'use strict';
// =====================================================================
//  PolyWeave admin tool (run on the server, in /opt/polyweave):
//    sudo -u polyweave node admin.js top sp|mp            leaderboard with run ids
//    sudo -u polyweave node admin.js player <name>        a player's account, titles and recent runs
//    sudo -u polyweave node admin.js rejected             runs the checks turned down, and why
//    sudo -u polyweave node admin.js log <runId>          the event log of a run (kept for personal bests / rejected runs)
//    sudo -u polyweave node admin.js remove <runId>       take a run off the leaderboard (restore <runId> undoes it)
//    sudo -u polyweave node admin.js ban <name>           hide all their runs and block new ones (unban <name> undoes it)
//    sudo -u polyweave node admin.js trim <name> sp|mp <max>  take all their runs above <max> points off the board
//    sudo -u polyweave node admin.js grant <name> <title> ["message"]  send a title to their inbox, with an optional
//                                                         message (\n = new line); revoke <name> <title> takes it away
//    sudo -u polyweave node admin.js titles               every title id
//    sudo -u polyweave node admin.js alpha off            stop giving Alpha Tester to new accounts (alpha on / alpha)
//    sudo -u polyweave node admin.js beta off             stop giving Beta Tester to new accounts (beta on / beta)
//    sudo -u polyweave node admin.js retitle              wipe every title and send them all back to inboxes
// =====================================================================
const DB = require('./db');
const Accounts = require('./accounts');
const Titles = require('./js/titles');

const [cmd, a, b, c] = process.argv.slice(2);
const day = t => new Date(t).toISOString().replace('T', ' ').slice(0, 16);
const fmt = n => Math.round(n).toLocaleString('en-US');
function who(name) {
  const u = Accounts.byName(name);
  if (!u) { console.log(`No player called "${name}".`); process.exit(1); }
  DB.ensureUser(u.id);
  return u;
}
const runRow = r => `#${r.id}  ${r.mode}  ${fmt(r.score).padStart(14)}  ${String(Math.round(r.dur || 0)).padStart(5)} s  ${day(r.t)}  `
  + (r.verified === 1 ? 'verified' : r.verified === 0 ? 'imported' : 'REJECTED') + (r.removed ? ' (not counted)' : '') + (r.note && r.verified !== 0 ? `  ${r.note}` : '');

switch (cmd) {
  case 'top': {
    const mode = a === 'mp' ? 'mp' : 'sp';
    for (const e of DB.top(mode, 100)) console.log(`${String(e.rank).padStart(3)}. ${(Accounts.nameOf(e.uid) || '?').padEnd(16)} ${fmt(e.score).padStart(14)}  ${day(e.t)}`);
    break;
  }
  case 'player': {
    const u = who(a), row = DB.db.prepare('SELECT * FROM users WHERE uid = ?').get(u.id);
    console.log(`${u.name}  (id ${u.id})${row.banned ? '  BANNED' : ''}`);
    console.log(`titles: ${DB.titlesOf(u.id).join(', ') || '-'}   equipped: ${row.title || '-'}   time in scored runs: ${(row.play_s / 3600).toFixed(1)} h`);
    for (const m of ['sp', 'mp']) console.log(`${m}: best ${fmt(DB.bestOf(m, u.id))}, rank ${DB.rankOf(m, u.id) || '-'}`);
    for (const r of DB.runsOf(u.id, 30)) console.log('  ' + runRow(r));
    break;
  }
  case 'rejected':
    for (const r of DB.recentRejected(40)) console.log(`#${r.id}  ${(Accounts.nameOf(r.uid) || '?').padEnd(16)} ${r.mode}  ${fmt(r.score).padStart(14)}  ${day(r.t)}  ${r.note}`);
    break;
  case 'log': {
    const log = DB.runLog(+a);
    if (!log) console.log('No log kept for that run.'); else console.log(JSON.stringify(log));
    break;
  }
  case 'remove': case 'restore':
    console.log(DB.setRemoved(+a, cmd === 'remove') ? `Run #${a} ${cmd === 'remove' ? 'removed' : 'restored'}.` : `No run #${a}.`);
    break;
  case 'ban': case 'unban': {
    const u = who(a); DB.setBanned(u.id, cmd === 'ban');
    console.log(`${u.name} ${cmd === 'ban' ? 'banned' : 'unbanned'}.`);
    break;
  }
  case 'grant': case 'revoke': {
    const u = who(a);
    if (!Titles.TITLE_BY_ID[b]) { console.log(`Unknown title "${b}". Run: node admin.js titles`); process.exit(1); }
    if (cmd === 'grant') {
      const note = c ? c.replace(/\\n/g, '\n') : null;
      console.log(DB.gift(u.id, b, note) ? `${u.name}: "${Titles.TITLE_BY_ID[b].name}" sent to their inbox${note ? ' with your message' : ''} (they claim it there).` : `${u.name} already has "${Titles.TITLE_BY_ID[b].name}" (or it's waiting in their inbox).`);
      break;
    }
    DB.db.prepare('DELETE FROM user_titles WHERE uid = ? AND title = ?').run(u.id, b);
    DB.db.prepare("DELETE FROM inbox WHERE uid = ? AND kind = 'title' AND item = ? AND claimed IS NULL").run(u.id, b);
    if (DB.equipped(u.id) === b) DB.equip(u.id, null);
    console.log(`${u.name}: lost "${Titles.TITLE_BY_ID[b].name}".`);
    break;
  }
  case 'trim': {   // all of one player's runs above a score off the board (e.g. after an exploit)
    const u = who(a), mode = b === 'mp' ? 'mp' : b === 'sp' ? 'sp' : null, max = Number(c);
    if (!mode || !Number.isFinite(max)) { console.log('Usage: node admin.js trim <name> sp|mp <max points>'); process.exit(1); }
    console.log(`${u.name}: ${DB.removeAbove(u.id, mode, max)} ${mode} runs above ${fmt(max)} removed. New best: ${fmt(DB.bestOf(mode, u.id))}.`);
    break;
  }
  case 'retitle':   // wipe every title and send them all back to inboxes (players claim them again)
    console.log(`Done: ${DB.resetTitles()} titles waiting in inboxes. Players see them next time they open the game.`);
    break;
  case 'alpha':   // new accounts get Alpha Tester: on (default) / off
    if (a === 'on' || a === 'off') DB.setAlphaOpen(a === 'on');
    console.log(`New accounts ${DB.alphaOpen() ? 'GET' : 'do NOT get'} Alpha Tester.` + (a ? '' : ' (change it: alpha on / alpha off)'));
    break;
  case 'beta':    // new accounts get Beta Tester: on (default) / off
    if (a === 'on' || a === 'off') DB.setBetaOpen(a === 'on');
    console.log(`New accounts ${DB.betaOpen() ? 'GET' : 'do NOT get'} Beta Tester.` + (a ? '' : ' (change it: beta on / beta off)'));
    break;
  case 'titles':
    for (const t of Titles.TITLES) console.log(`${t.id.padEnd(12)} ${t.name.padEnd(20)} ${Titles.RARITIES[t.rarity].name.padEnd(12)} ${Titles.desc(t, 'kmh')}`);
    break;
  default:
    console.log('Commands: top sp|mp · player <name> · rejected · log <runId> · remove|restore <runId> · trim <name> sp|mp <max> · ban|unban <name> · grant <name> <title> ["message"] · revoke <name> <title> · titles · alpha on|off · beta on|off · retitle');
}
process.exit(0);
