'use strict';
// =====================================================================
//  Which site this copy of the game runs on (loaded first).
//  'web': polyweave.org, the normal game. 'crazygames': the CrazyGames version (guests only, no Google
//  sign-in, no chat, starts straight into a run; see js/crazygames.js). The CrazyGames build
//  (tools/build-crazygames.ps1) sets window.PW_PLATFORM in its index.html. To try it on this computer,
//  add ?cg=1 to the address (e.g. http://localhost:8797/?cg=1).
// =====================================================================
const PLATFORM = window.PW_PLATFORM || (/[?&]cg=1(&|$)/.test(location.search) ? 'crazygames' : 'web');
const CG = PLATFORM === 'crazygames';
// the game server: the CrazyGames version is served from CrazyGames' own sites, so it talks to polyweave.org
// (except when tested on this computer, where the local server is used)
const PW_SERVER = CG && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'https://polyweave.org' : '';
if (CG) document.documentElement.classList.add('cg');
