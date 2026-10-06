'use strict';
// Runs the game's own road + traffic code (js/core.js, js/zones.js, js/traffic.js, ringtraffic.js)
// on the server, with stand-ins for the 3D parts. Vehicle sizes come from assets/vehicles.json
// (exported from the game; re-export it if traffic vehicles are added or reshaped).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const VEH = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'vehicles.json'), 'utf8'));
const DIMS = Object.fromEntries(VEH.map(v => [v.key, v.dims]));
const nowS = () => Number(process.hrtime.bigint()) / 1e9;

const ctx = vm.createContext({
  console, Math, JSON, Date,
  performance: { now: () => nowS() * 1000 },
  THREE: { ColorManagement: {} },
  TRAFFIC_VEHICLES: VEH.map(v => { const o = Object.assign({}, v); delete o.dims; return o; }),
  // 3D stand-ins: a "vehicle" is just its size + paint colour
  makeVehicle: (key, paint) => ({ root: { position: { set() {} }, rotation: {}, visible: true }, wheels: [], brake: {}, indL: {}, indR: {}, M: DIMS[key], paint }),
  paintMat: hex => hex,
  getModel: key => DIMS[key],
  animateWheels: () => {},
});
for (const f of ['js/core.js', 'js/zones.js', 'js/traffic.js', 'ringtraffic.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
vm.runInContext('ROAD.setLoop(true); ZONES.setLoop(ROAD.loop.L);', ctx);
// the server never draws anything: skip the world-space placement the traffic code does for its 3D models
vm.runInContext('ROAD.pos = (s, d, out) => out || { x: 0, z: 0 }; ROAD.yaw = () => 0;', ctx);
const RingTraffic = vm.runInContext('RingTraffic', ctx);
const LOOP_L = vm.runInContext('ROAD.loop.L', ctx);

module.exports = { RingTraffic, LOOP_L, nowS };
