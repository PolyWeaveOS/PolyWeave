'use strict';
// =====================================================================
//  Player accounts (Sign in with Google) - needed to get on the leaderboards.
//  - The game gets a Google ID token in the browser; the server checks it with Google and keeps
//    ONLY Google's account number ("sub") + the driver name the player picks. No email, no real name.
//  - Signing in gives a session token (kept in the player's browser) for later visits.
//  - Google Client ID: config.json -> "googleClientId" (or the GOOGLE_CLIENT_ID environment variable).
//  Stored in accounts.json next to this file (kept out of GitHub by .gitignore).
// =====================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'accounts.json');
const SESSION_DAYS = 90;

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (e) { /* no config yet */ }
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || cfg.googleClientId || '';

let db = { users: {}, sessions: {} };   // users[googleId] = { id, name, created }; sessions[token] = { uid, exp }
try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (j.users && j.sessions) db = j; } catch (e) { /* first run */ }
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const tmp = FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), err => { if (!err) fs.rename(tmp, FILE, () => {}); });
  }, 500);
}
// drop expired sessions now and then
setInterval(() => { const t = Date.now(); let n = 0; for (const [k, s] of Object.entries(db.sessions)) if (s.exp < t) { delete db.sessions[k]; n++; } if (n) save(); }, 3600 * 1000);

// ---- Google sign-in: check the ID token with Google, then find / create the account
async function verifyGoogle(credential) {
  if (!CLIENT_ID) throw new Error('Google sign-in is not set up on this server yet.');
  if (typeof credential !== 'string' || credential.length > 4096) throw new Error('Bad sign-in token.');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) throw new Error('Google could not confirm that sign-in.');
  const c = await r.json();
  if (c.aud !== CLIENT_ID) throw new Error('That sign-in was for a different app.');
  if (c.iss !== 'accounts.google.com' && c.iss !== 'https://accounts.google.com') throw new Error('Bad sign-in issuer.');
  if (!(+c.exp * 1000 > Date.now())) throw new Error('That sign-in expired. Try again.');
  if (!c.sub) throw new Error('Bad sign-in token.');
  return c.sub;
}
async function login(credential) {
  const sub = await verifyGoogle(credential);
  let u = db.users[sub];
  if (!u) { u = db.users[sub] = { id: sub, name: null, created: Date.now() }; }
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { uid: sub, exp: Date.now() + SESSION_DAYS * 86400 * 1000 };
  save();
  return { token, user: u };
}
function bySession(token) {
  if (typeof token !== 'string' || !token) return null;
  const s = db.sessions[token];
  if (!s || s.exp < Date.now()) return null;
  return db.users[s.uid] || null;
}
function logout(token) { if (db.sessions[token]) { delete db.sessions[token]; save(); } }

// driver names: 3-16 letters / numbers / _ . - and spaces, unique (ignoring upper / lower case)
const NAME_RE = /^[A-Za-z0-9_.\- ]{3,16}$/;
function setName(user, name) {
  name = String(name || '').trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(name)) return 'Names are 3-16 characters: letters, numbers, spaces, _ . -';
  const low = name.toLowerCase();
  for (const u of Object.values(db.users)) if (u !== user && u.name && u.name.toLowerCase() === low) return 'That name is taken.';
  user.name = name; save();
  return null;
}
const nameOf = uid => (db.users[uid] && db.users[uid].name) || null;

module.exports = { enabled: () => !!CLIENT_ID, clientId: () => CLIENT_ID, login, bySession, logout, setName, nameOf };
