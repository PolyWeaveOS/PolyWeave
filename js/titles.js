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
// the solo titles); 'stat' = a stat reaching `value`: near (near misses), dist (metres driven in scored runs),
// runDist (metres in ONE run), friends, peak (highest multiplier in a run). (No titles for a number of runs:
// those could be farmed with lots of tiny runs.)
// Every title arrives in the inbox; it's yours once claimed. (`stat` / `value` on run and team titles are for the
// Achievements screen: score = best single run, team = best team run.)
const MILE = 1609.344;
// distance goals are set in both units; the goal is the smaller of the two, so nobody unlocks it late
const distGoal = (km, mi) => Math.min(km * 1000, mi * MILE);
const TITLES = [
  { id: 'owner',       name: 'Owner',                  rarity: 'divine',    how: 'grant', desc: 'Made PolyWeave' },
  { id: 'bughunter',   name: 'Bug Hunter',             rarity: 'legendary', how: 'grant', show: true, desc: 'First to report a new bug (it has to be an original find)' },
  { id: 'alpha',       name: 'Alpha Tester',           rarity: 'exotic',    how: 'grant', desc: 'Played PolyWeave during the alpha' },
  { id: 'beta',        name: 'Beta Tester',            rarity: 'epic',      how: 'grant', desc: 'Played PolyWeave during the beta' },
  { id: 'verified',    name: 'Verified',               rarity: 'common',    how: 'grant', desc: 'Signed in with Google' },
  // best single run (either mode)
  { id: 'sixfig',      name: 'Six Figures',            rarity: 'rare',      how: 'run',  score: 1e5, stat: 'score', value: 1e5, desc: '100,000 points in one run' },
  { id: 'millionaire', name: 'Millionaire',            rarity: 'epic',      how: 'run',  score: 1e6, stat: 'score', value: 1e6, desc: '1,000,000 points in one run' },
  { id: 'multimil',    name: 'Multi-Millionaire',      rarity: 'mythic',    how: 'run',  score: 1e7, stat: 'score', value: 1e7, desc: '10,000,000 points in one run' },
  { id: 'billionaire', name: 'Billionaire',            rarity: 'legendary', how: 'run',  score: 1e9, stat: 'score', value: 1e9, desc: '1,000,000,000 points in one run' },
  // team runs
  { id: 'teammil',     name: 'Team Millionaire',       rarity: 'srare',     how: 'team', score: 1e6, stat: 'team', value: 1e6, desc: '1,000,000 points together on one server' },
  { id: 'teammulti',   name: 'Team Multi-Millionaire', rarity: 'epic',      how: 'team', score: 1e7, stat: 'team', value: 1e7, desc: '10,000,000 points together on one server' },
  { id: 'teambil',     name: 'Team Billionaire',       rarity: 'exotic',    how: 'team', score: 1e9, stat: 'team', value: 1e9, desc: '1,000,000,000 points together on one server' },
  // multiplier
  { id: 'halfcent',    name: 'Half Century',           rarity: 'epic',      how: 'stat', stat: 'peak', value: 50, desc: 'Reach the x50 multiplier' },
  { id: 'maxed',       name: 'Maxed Out',              rarity: 'mythic',    how: 'stat', stat: 'peak', value: 100, desc: 'Reach the x100 multiplier' },
  // near misses (total)
  { id: 'closecall',   name: 'Close Call',             rarity: 'rare',      how: 'stat', stat: 'near', value: 1000, desc: '1,000 near misses in total' },
  { id: 'needle',      name: 'Thread the Needle',      rarity: 'epic',      how: 'stat', stat: 'near', value: 10000, desc: '10,000 near misses in total' },
  // distance (total, in scored runs)
  { id: 'roadtrip',    name: 'Road Tripper',           rarity: 'uncommon',  how: 'stat', stat: 'dist', value: distGoal(1000, 600), km: 1000, mi: 600 },
  { id: 'longhaul',    name: 'Long Hauler',            rarity: 'epic',      how: 'stat', stat: 'dist', value: distGoal(10000, 6000), km: 10000, mi: 6000 },
  // distance in a single run (without crashing)
  { id: 'cruise',      name: 'Cruise Control',         rarity: 'uncommon',  how: 'stat', stat: 'runDist', value: distGoal(15, 10), km: 15, mi: 10 },
  { id: 'endurance',   name: 'Endurance',              rarity: 'rare',      how: 'stat', stat: 'runDist', value: distGoal(80, 50), km: 80, mi: 50 },
  { id: 'irondriver',  name: 'Iron Driver',            rarity: 'epic',      how: 'stat', stat: 'runDist', value: distGoal(160, 100), km: 160, mi: 100 },
  // friends
  { id: 'plusone',     name: 'Plus One',               rarity: 'common',    how: 'stat', stat: 'friends', value: 1, desc: 'Have a friend' },
  { id: 'social',      name: 'Social Butterfly',       rarity: 'uncommon',  how: 'stat', stat: 'friends', value: 10, desc: 'Have 10 friends' },
  { id: 'crowdfav',    name: 'Crowd Favorite',         rarity: 'epic',      how: 'stat', stat: 'friends', value: 50, desc: 'Have 50 friends' },
];
const TITLE_BY_ID = Object.fromEntries(TITLES.map(t => [t.id, t]));
// Achievements (Brawl Stars "records" style): each track is a stat with tiers; each tier's reward is a title
const ACHIEVEMENTS = [
  { id: 'score',   name: 'High Scorer',    stat: 'score',   unit: 'pts',     desc: 'Best score in a single run',            tiers: ['sixfig', 'millionaire', 'multimil', 'billionaire'] },
  { id: 'team',    name: 'Team Player',    stat: 'team',    unit: 'pts',     desc: 'Best team run (together on one server)', tiers: ['teammil', 'teammulti', 'teambil'] },
  { id: 'peak',    name: 'Multiplier',     stat: 'peak',    unit: 'x',       desc: 'Highest multiplier reached in a run',   tiers: ['halfcent', 'maxed'] },
  { id: 'near',    name: 'Close Calls',    stat: 'near',    unit: 'count',   desc: 'Near misses in total',                  tiers: ['closecall', 'needle'] },
  { id: 'dist',    name: 'Distance',       stat: 'dist',    unit: 'dist',    desc: 'Distance driven in scored runs',        tiers: ['roadtrip', 'longhaul'] },
  { id: 'runDist', name: 'Long Run',       stat: 'runDist', unit: 'dist',    desc: 'Farthest in a single run',              tiers: ['cruise', 'endurance', 'irondriver'] },
  { id: 'friends', name: 'Friends',        stat: 'friends', unit: 'count',   desc: 'Friends added',                         tiers: ['plusone', 'social', 'crowdfav'] },
];
// titles one run of `score` points unlocks / a team run adding up to `score` unlocks
const titlesForRun = score => TITLES.filter(t => t.how === 'run' && score >= t.score).map(t => t.id);
const titlesForTeam = score => TITLES.filter(t => t.how === 'team' && score >= t.score).map(t => t.id);
// titles stats unlock: stats = { near, dist, runDist, mpRuns, friends, peak }
const titlesForStats = s => TITLES.filter(t => t.how === 'stat' && (s[t.stat] || 0) >= t.value).map(t => t.id);
// a title's description in the player's units (distance titles: miles when the game is set to MPH)
const desc = (t, units) => {
  if (!t.km) return t.desc;
  const n = (units === 'kmh' ? t.km : t.mi).toLocaleString('en-US') + (units === 'kmh' ? ' km' : ' miles');
  return t.stat === 'runDist' ? `Drive ${n} in one run` : `Drive ${n} in scored runs`;
};
// a tier goal in the player's units, for the Achievements screen (distance: the round number shown)
const goalText = (t, units) => (t.km ? (units === 'kmh' ? t.km : t.mi).toLocaleString('en-US') : t.value.toLocaleString('en-US'));

const Titles = { RARITIES, RARITY_ORDER, TITLES, TITLE_BY_ID, ACHIEVEMENTS, MILE, titlesForRun, titlesForTeam, titlesForStats, desc, goalText };
if (typeof module !== 'undefined' && module.exports) module.exports = Titles;
