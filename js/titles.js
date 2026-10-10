'use strict';
// =====================================================================
//  Titles (Rocket League / Brawl Stars style): each player equips one, shown under their name.
//  Shared by the game (browser) and the server (require), so both agree on names and rarities.
//  Rarities, lowest first (one colour each): Common grey, Uncommon light green, Rare light blue, Super Rare blue,
//  Epic purple-pink, then the glowing ones: Mythic red, Exotic crimson, Legendary gold, Divine pearl
//  (clean pearl white with soft colours drifting across it).
// =====================================================================
const RARITIES = {
  common:    { name: 'Common',     color: '#a7adb6' },
  uncommon:  { name: 'Uncommon',   color: '#a9eea2' },
  rare:      { name: 'Rare',       color: '#9fd8ff' },
  srare:     { name: 'Super Rare', color: '#5b95ff' },
  epic:      { name: 'Epic',       color: '#d98cff' },
  mythic:    { name: 'Mythic',     color: '#ff4a42', neon: true },
  exotic:    { name: 'Exotic',     color: '#c8143c', neon: true },
  legendary: { name: 'Legendary',  color: '#ffd84a', neon: true },
  divine:    { name: 'Divine',     color: '#f6f3ec', neon: true, pearl: true },
};
const RARITY_ORDER = Object.keys(RARITIES);

// how: 'grant' = handed out (Owner, Alpha Tester, Verified, Bug Hunter); 'run' = one scored run of at least
// `score` points (either mode); 'team' = a team run: two or more signed-in players on the same multiplayer server
// at the same time, whose runs add up to `score` (each player's best overlapping run counts once; one rarity below
// the solo titles); 'stat' = a career total reaching `value`: near (near misses), dist (metres driven in scored
// runs), friends, peak (highest multiplier in a run). Every title arrives in the inbox; it's yours once claimed.
const MILE = 1609.344;
const TITLES = [
  { id: 'owner',       name: 'Owner',                  rarity: 'divine',    how: 'grant', desc: 'Made PolyWeave' },
  { id: 'bughunter',   name: 'Bug Hunter',             rarity: 'mythic',    how: 'grant', show: true, desc: 'First to report a new bug (it has to be an original find)' },
  { id: 'alpha',       name: 'Alpha Tester',           rarity: 'mythic',    how: 'grant', desc: 'Played PolyWeave during the alpha' },
  { id: 'verified',    name: 'Verified',               rarity: 'common',    how: 'grant', desc: 'Signed in with Google' },
  { id: 'millionaire', name: 'Millionaire',            rarity: 'epic',      how: 'run',  score: 1e6, desc: '1,000,000 points in one run' },
  { id: 'multimil',    name: 'Multi-Millionaire',      rarity: 'mythic',    how: 'run',  score: 1e7, desc: '10,000,000 points in one run' },
  { id: 'billionaire', name: 'Billionaire',            rarity: 'legendary', how: 'run',  score: 1e9, desc: '1,000,000,000 points in one run' },
  { id: 'teammil',     name: 'Team Millionaire',       rarity: 'srare',     how: 'team', score: 1e6, desc: '1,000,000 points together on one server' },
  { id: 'teammulti',   name: 'Team Multi-Millionaire', rarity: 'epic',      how: 'team', score: 1e7, desc: '10,000,000 points together on one server' },
  { id: 'teambil',     name: 'Team Billionaire',       rarity: 'exotic',    how: 'team', score: 1e9, desc: '1,000,000,000 points together on one server' },
  { id: 'social',      name: 'Social Butterfly',       rarity: 'uncommon',  how: 'stat', stat: 'friends', value: 10, desc: 'Have 10 friends' },
  { id: 'closecall',   name: 'Close Call',             rarity: 'rare',      how: 'stat', stat: 'near', value: 1000, desc: '1,000 near misses in total' },
  { id: 'needle',      name: 'Thread the Needle',      rarity: 'epic',      how: 'stat', stat: 'near', value: 10000, desc: '10,000 near misses in total' },
  // distance: the goal is the round number of MILES (600 mi = 966 km), so km drivers (shown 1,000 km) are never late
  { id: 'roadtrip',    name: 'Road Tripper',           rarity: 'uncommon',  how: 'stat', stat: 'dist', value: 600 * MILE, km: 1000, mi: 600, desc: 'Drive 1,000 km in scored runs' },
  { id: 'longhaul',    name: 'Long Hauler',            rarity: 'epic',      how: 'stat', stat: 'dist', value: 6000 * MILE, km: 10000, mi: 6000, desc: 'Drive 10,000 km in scored runs' },
  { id: 'maxed',       name: 'Maxed Out',              rarity: 'mythic',    how: 'stat', stat: 'peak', value: 100, desc: 'Reach the x100 multiplier' },
];
const TITLE_BY_ID = Object.fromEntries(TITLES.map(t => [t.id, t]));
// titles one run of `score` points unlocks / a team run adding up to `score` unlocks
const titlesForRun = score => TITLES.filter(t => t.how === 'run' && score >= t.score).map(t => t.id);
const titlesForTeam = score => TITLES.filter(t => t.how === 'team' && score >= t.score).map(t => t.id);
// titles career totals unlock: stats = { near, dist, friends, peak }
const titlesForStats = s => TITLES.filter(t => t.how === 'stat' && (s[t.stat] || 0) >= t.value).map(t => t.id);
// a title's description in the player's units (distance titles: miles when the game is set to MPH)
const desc = (t, units) => (t.stat === 'dist' ? `Drive ${(units === 'kmh' ? t.km : t.mi).toLocaleString('en-US')} ${units === 'kmh' ? 'km' : 'miles'} in scored runs` : t.desc);

const Titles = { RARITIES, RARITY_ORDER, TITLES, TITLE_BY_ID, titlesForRun, titlesForTeam, titlesForStats, desc };
if (typeof module !== 'undefined' && module.exports) module.exports = Titles;
