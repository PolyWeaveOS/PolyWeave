'use strict';
// =====================================================================
//  Player vehicle dynamics: BMW M4 Competition (G82)
//  - Dynamic bicycle model with Pacejka-style tyre curves
//  - Longitudinal weight transfer, friction-circle combined slip
//  - S58 torque curve, 8-speed M Steptronic, RWD, rev limiter
//  - ABS, optional traction control, handbrake
//  Frame: u = forward speed, v = lateral (right +), r = yaw rate (right turn +)
// =====================================================================

const M4 = {
  mass: 1725, Iz: 2950, wheelbase: 2.857, a: 1.343, b: 1.514, hcg: 0.49, rw: 0.345,
  mu: 1.08, muX: 1.38, Bf: 15, Br: 16.5, C: 1.4, // lateral / longitudinal peak friction (performance tyres)
  cdA: 0.34 * 2.2, rho: 1.225, crr: 0.014, eff: 0.88,
  gears: [0, 5.00, 3.20, 2.143, 1.72, 1.314, 1.00, 0.822, 0.64], rev: 3.46, fd: 3.154,
  idle: 850, redline: 7200, vmax: 290 / 3.6,
  torque: [[0, 300], [1000, 360], [2000, 520], [2750, 650], [5500, 650], [6250, 573], [7000, 490], [7300, 440], [8000, 300]],
  maxLock: 0.56, // ~32 deg front wheel lock (≈14.5:1 ratio at 450 deg)
  relax: 0,      // tyre relaxation length (m), 0 = off
  loadSens: 0.22, wtRate: 7, fall: 0.07,
  latG: 1.9,       // soft cornering ceiling (g) - high so big steering inputs really turn
  usK: 0,          // understeer gradient (s^2/m^2): 0 = same turn per degree at any speed (NoHesi-style)
  yawWn: 20,      // yaw response natural frequency (rad/s): rounds off the start/end of every turn
  latJerk: 8,    // max change of cornering force (g per second): weight-transfer speed
  yawTau0: 0.010, yawTauV: 0.00015, // yaw response delay: ~0.015 s at highway speed (near-instant, still eased)
  wheelFilter: 160, // wheel input smoothing rate (higher = more immediate; just removes sensor jitter)
  // M Servotronic variable-ratio rack: ~15:1 near centre (calm on the highway),
  // quickening to ~10.5:1 toward full lock (less arm-twirling in tight turns)
  ratioCentre: 15.0, ratioLock: 10.5,
  steerGamma: 1.6, gammaRange: 270, steerGain: 2.0, // wheel curve: over 270 deg, gamma 1.6, 2x turn
  yawFric: 7, latFricG: 1.05, maxHitSpin: 1.3, // crash recovery: tyre-limited spin/slide damping
  wheelSpeedSens: 1.0, // wheel speed sensitivity (AC style), fixed at 100%
  wheelTurnScale: 0.7, // overall wheel turn amount (0.7 = 30% less than the base curve)
  // wheel angle (deg) -> extra multiplier: small turns +20%, medium +5% (hard turns are set by turnG)
  // (fitted so at 120 km/h: small +20%, medium +5%, hard -30% vs the previous version)
  // 5-10 deg of wheel: double the previous response, blending back to the old curve by ~20 deg
  turnMultKeys: [[0, 2.446], [10.5, 2.446], [20, 1.35], [25, 1.223], [45, 1.14], [60, 1.279], [90, 0.727], [450, 1.0]],
  turnG: 2.52,// max cornering (g) at full lock - soft limit (high, so you can flick through gaps)
  // Keyboard steering (Assetto Corsa model), in full-lock per second:
  keySpeed: 5.5,    // steering speed toward the pressed side (~0.18 s to full)
  keyOpposite: 22,  // opposite lock speed when switching sides
  keyReturn: 7.0,   // return rate to centre when released
  keyFilter: 40,    // light smoothing so it stays smooth, not jerky
  ratio: 14.5,    // steering ratio (wheel deg : road-wheel deg)
  brakeGrip: 1.23, // braking grip multiplier on top of the tyre grip (stronger, shorter stops)
};

function engineTorque(rpm) {
  const t = M4.torque;
  for (let i = 0; i < t.length - 1; i++) if (rpm <= t[i + 1][0]) {
    const k = (rpm - t[i][0]) / (t[i + 1][0] - t[i][0]);
    return t[i][1] + (t[i + 1][1] - t[i][1]) * k;
  }
  return t[t.length - 1][1];
}
// normalised lateral tyre curve (peak 1): Pacejka-style rise, then a gentle plateau past peak slip
const tyre = (alpha, B) => {
  const x = B * Math.abs(alpha), xp = Math.tan(Math.PI / (2 * M4.C));
  const f = x < xp ? Math.sin(M4.C * Math.atan(x)) : 1 - M4.fall * Math.min(1, (x - xp) / 4);
  return alpha < 0 ? -f : f;
};

class PlayerCar {
  constructor() {
    this.x = 0; this.z = 0; this.yaw = 0;
    this.u = 0; this.v = 0; this.r = 0;
    this.steer = 0; this.ax = 0; this.ay = 0; this.axWT = 0;
    this.gear = 1; this.rpm = M4.idle; this.shiftT = 0; this.manual = false; this.tc = true;
    this.slipF = 0; this.slipR = 0; this.spin = 0; this.skid = 0;
    this.limiter = false; this.brakeOn = false;
    this.s = 0; this.d = 0;
  }
  get speed() { return Math.hypot(this.u, this.v); }
  // Drawn heading: the body leads into the turn by a multiple of the steering angle
  // (2.5x in third person, 1x in the cockpit) so steering reads instantly. Hitbox uses it too.
  get visYaw() { return this.yaw + this.steer * (this.visK ?? 0.5); }
  get fwdX() { return Math.sin(this.yaw); }
  get fwdZ() { return -Math.cos(this.yaw); }

  place(s, d, speed) {
    const p = ROAD.pos(s, d);
    this.x = p.x; this.z = p.z; this.yaw = ROAD.yaw(s);
    this.u = speed; this.v = 0; this.r = 0; this.steer = 0; this.wImp = 0; this.rK = 0;
    this.gear = this.bestGear(speed); this.rpm = this.wheelRpm(this.gear);
  }
  ratio(g) { return g > 0 ? M4.gears[g] * M4.fd : g < 0 ? -M4.rev * M4.fd : 0; }
  wheelRpm(g) { return Math.abs(this.u / M4.rw * this.ratio(g)) * 60 / (2 * Math.PI); }
  bestGear(u) { for (let g = 1; g <= 8; g++) { this.u = u; if (this.wheelRpm(g) < 5200) return g; } return 8; }

  shift(dir) {
    if (this.shiftT > 0) return;
    const ng = U.clamp(this.gear + dir, this.u < 1 ? -1 : 1, 8);
    if (ng === this.gear) return;
    if (dir < 0 && ng > 0 && this.wheelRpm(ng) > M4.redline + 100) return; // money-shift protection
    this.gear = ng; this.shiftT = 0.13;
  }

  autoShift(throttle) {
    if (this.shiftT > 0 || this.gear <= 0) return;
    const up = throttle > 0.6 ? 6950 : 2600 + throttle * 4000;
    const down = 1500 + throttle * 2600;
    if (this.gear < 8 && this.rpm > up) { this.gear++; this.shiftT = 0.12; }
    else if (this.gear > 1 && this.rpm < down) {
      const ng = this.gear - 1;
      if (this.wheelRpm(ng) < 6500) { this.gear = ng; this.shiftT = 0.1; }
    }
  }

  // inp: {throttle 0..1, brake 0..1, handbrake 0..1, steer (rad, front wheel)}
  step(dt, inp) {
    const m = M4.mass, g = 9.81, L = M4.wheelbase;
    let throttle = inp.throttle;
    // progressive brake: strong bite early in the pedal travel (stiff wheel pedals rarely reach 100%)
    let brake = 1 - Math.pow(1 - U.clamp(inp.brake, 0, 1), 2.25);

    // ---- reverse logic: hold brake while stopped engages reverse; in reverse W/S swap ----
    if (this.gear >= 0 && this.u < 0.5 && brake > 0.3 && throttle < 0.05) { this.revHold = (this.revHold || 0) + dt; if (this.revHold > 0.35) { this.gear = -1; this.revHold = 0; } }
    else if (this.gear >= 0) this.revHold = 0;
    if (this.gear < 0) {
      if (this.u > -0.5 && throttle > 0.3 && brake < 0.05) { this.gear = 1; }
      else { const t = throttle; throttle = brake; brake = t; }
    }

    if (!this.manual && this.gear > 0) this.autoShift(throttle);
    if (this.shiftT > 0) this.shiftT -= dt;

    // ---- engine ----
    const ratio = this.ratio(this.gear);
    const wheelRpm = this.wheelRpm(this.gear);
    const launchRpm = M4.idle + throttle * 2900;
    let target = this.gear === 0 ? M4.idle + throttle * 5500 : Math.max(wheelRpm + this.spin * 900, Math.abs(this.u) < 6 && this.gear !== 0 ? Math.max(launchRpm * (1 - Math.abs(this.u) / 6), M4.idle) : M4.idle);
    target = Math.min(target, M4.redline + 80);
    this.rpm += (target - this.rpm) * Math.min(1, dt * (this.shiftT > 0 ? 25 : 18));
    this.limiter = this.rpm >= M4.redline;
    let thr = throttle;
    if (this.limiter) thr = 0;
    if (this.u > M4.vmax) thr = 0;
    if (this.shiftT > 0) thr *= 0.15;
    let engT = thr * engineTorque(this.rpm) - (1 - thr) * (18 + this.rpm * 0.0085);
    if (engT < 0 && wheelRpm < 1150) engT = 0; // clutch open near idle: no engine braking / creeping backwards
    const Fdrive = this.gear === 0 ? 0 : engT * ratio * M4.eff / M4.rw;

    // ---- loads (static + longitudinal transfer + a little aero) ----
    const spd = this.speed;
    const aero = 0.18 * spd * spd;
    const dW = m * this.axWT * M4.hcg / L;
    const Fzf0 = m * g * M4.b / L, Fzr0 = m * g * M4.a / L;
    const Fzf = Math.max(Fzf0 - dW + aero * 0.45, 1500);
    const Fzr = Math.max(Fzr0 + dW + aero * 0.55, 1500);
    // tyre load sensitivity: friction coefficient drops as load rises
    const lsF = 1 - M4.loadSens * (Fzf / Fzf0 - 1), lsR = 1 - M4.loadSens * (Fzr / Fzr0 - 1);
    const muF = M4.muX * Fzf * lsF, muR = M4.muX * Fzr * lsR;          // longitudinal capacity
    // lateral capacity; front loses a little more to lateral load transfer (stiffer front roll
    // stiffness), giving the gentle limit understeer a real M4 is set up with
    const latF = M4.mu * 0.93 * Fzf * lsF, latR = M4.mu * 1.06 * Fzr * lsR;

    const d = this.steer;

    // ---- brakes (ABS clamps each axle to its grip) ----
    const sgnU = this.u >= 0 ? 1 : -1;
    const bF = brake * 2.0 * m * g; // big M Compound brakes; ABS caps each axle at its grip below
    const bk = M4.brakeGrip;         // extra braking grip (arcade-strong stops, ~1.65 g)
    let Fxf = -sgnU * Math.min(bF * 0.64, muF * 0.96 * bk);
    let Fxr = -sgnU * Math.min(bF * 0.36, muR * 0.96 * bk);
    this.brakeOn = brake > 0.05;

    // ---- drive + traction ----
    let Fx_r_drive = Fdrive;
    this.spin = Math.max(0, this.spin - dt * 3);
    if (this.tc) {
      const lim = muR * 0.95;
      if (Math.abs(Fx_r_drive) > lim) Fx_r_drive = Math.sign(Fx_r_drive) * lim;
    } else if (Math.abs(Fx_r_drive + Fxr) > muR) {
      // wheelspin (no drift: rear keeps its lateral grip)
      this.spin = Math.min(1, this.spin + dt * 6);
      Fx_r_drive = Math.sign(Fx_r_drive) * muR * 0.9 - Fxr;
    }
    Fxr += Fx_r_drive;

    // handbrake: strong rear brake only (no drift)
    if (inp.handbrake > 0.1 && Math.abs(this.u) > 0.5) {
      Fxr = -sgnU * muR * 0.8 * inp.handbrake;
    } else if (inp.handbrake > 0.1) { this.u *= 0.9; }

    Fxf = U.clamp(Fxf, -muF * bk, muF * bk); Fxr = U.clamp(Fxr, -muR * bk, muR * bk);

    // ---- turning ----
    // Geometric steering (heading rate = speed / wheelbase * tan(steer angle)) with a soft grip
    // ceiling (M4.turnG). Like a real car, the yaw rate doesn't change instantly: it builds
    // with a short delay that grows a little with speed (~0.1 s slow, ~0.17 s at 250 km/h) -
    // this is where the smoothness comes from, instead of filtering your inputs.
    this.hitT = Math.max(0, (this.hitT || 0) - dt);
    // Collision spin (wImp): the tyres resist rotation with a friction-limited yaw moment
    // (~mu*m*g*wheelbase/2 / Iz -> roughly 7 rad/s^2), plus some damping. A side-swipe gives
    // a short wiggle instead of spinning the car round.
    {
      const w = this.wImp || 0, mag = Math.max(0, Math.abs(w) - M4.yawFric * dt);
      this.wImp = Math.sign(w) * mag * Math.exp(-2 * dt);
    }
    // natural understeer gradient: same wheel angle turns a bit less at high speed (real cars, AC tyres)
    let kin = this.u / L * Math.tan(d) / (1 + M4.usK * this.u * this.u);
    if (Math.abs(this.u) > 3) {
      const cap = 9.81 * M4.turnG;
      kin = cap * Math.tanh(this.u * kin / cap) / this.u;
    }
    const tau = M4.yawTau0 + M4.yawTauV * Math.abs(this.u);
    this.rK = (this.rK ?? kin) + (kin - (this.rK ?? kin)) * (1 - Math.exp(-dt / tau));
    this.r = this.rK + this.wImp;
    // Sideways sliding is stopped by tyre friction, which can't exceed grip (~1.05 g):
    // normal driving has no slide at all; after a hit you skid sideways briefly, then grip.
    {
      const dec = Math.min(Math.abs(this.v) * 24, M4.latFricG * 9.81) * dt;
      this.v = Math.sign(this.v) * Math.max(0, Math.abs(this.v) - dec);
    }
    const ayNow = this.u * this.r;

    // ---- longitudinal ----
    const drag = 0.5 * M4.rho * M4.cdA;
    const roll = M4.crr * m * g * (Math.abs(this.u) > 0.1 ? sgnU : this.u / 0.1);
    const corner = 0.02 * m * Math.min(Math.abs(ayNow), 10) * sgnU; // small cornering drag
    const Fx = Fxr + Fxf - drag * this.u * spd - roll - corner;
    const u0 = this.u;
    this.u += Fx / m * dt;
    // braking never reverses direction by itself
    if ((brake > 0 || inp.handbrake > 0.1 || (this.gear === 0)) && Math.sign(this.u) !== Math.sign(u0) && u0 !== 0) this.u = 0;
    if (Math.abs(this.u) < 0.05 && thr < 0.02 && brake > 0.02) this.u = 0;

    this.ax = U.lerp(this.ax, Fx / m, Math.min(1, dt * 10));
    this.axWT = U.lerp(this.axWT, Fx / m, Math.min(1, dt * M4.wtRate));
    this.ay = U.lerp(this.ay, ayNow, Math.min(1, dt * 10));
    this.skid = U.clamp(Math.max(this.spin, (Math.abs(ayNow) / 12 - 0.9) * 4, brake > 0.6 && spd > 8 ? 0.2 + 0.35 * brake : 0), 0, 1);

    // ---- integrate pose ----
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.x += (this.u * sy + this.v * cy) * dt;
    this.z += (-this.u * cy + this.v * sy) * dt;
    this.yaw = U.wrap(this.yaw + this.r * dt);
  }

  // world-space rigid body view for collisions
  toBody() {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    return { x: this.x, z: this.z, vx: this.u * sy + this.v * cy, vz: -this.u * cy + this.v * sy, w: this.r, im: 1 / M4.mass, ii: 1 / M4.Iz };
  }
  fromBody(b) {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.x = b.x; this.z = b.z;
    this.u = b.vx * sy - b.vz * cy;
    this.v = b.vx * cy + b.vz * sy;
    // collision spin, decays in step(); a real tyre-gripping car rarely exceeds ~1.3 rad/s from a knock
    this.wImp = U.clamp((this.wImp || 0) + (b.w - this.r), -M4.maxHitSpin, M4.maxHitSpin);
    // sideways velocity a hit can give you (anything beyond is absorbed by crumple/scrub)
    this.v = U.clamp(this.v, -6, 6);
    this.r = b.w;
  }
}

// wheel angle (deg, after deadzone) -> steering rack angle (deg); smooth monotone curve
// (each angle from 45 deg up turns like the next step up did before: 45->old 60, 60->old 90, 90->old 135...)
const WHEEL_CURVE = mcurve([[0, 0], [10, 4.6], [20, 14.1], [45, 72], [60, 112], [90, 230], [135, 405], [160, 450], [450, 450]]);

// =====================================================================
//  Steering controller: keyboard smoothing, wheel mapping, lane assist
// =====================================================================
class SteerController {
  constructor() { this.key = 0; this.k1 = 0; this.wheelF = 0; this.laLane = -1; this.assistActive = 0; }

  update(dt, car, ctl, settings) {
    const sens = settings.sens, spd = Math.abs(car.u);
    const wheel = ctl.source === 'wheel';
    let drv, intent;
    if (wheel) {
      // ---- Steering wheel: Assetto Corsa / Forza "simulation" style ----
      // 900 deg wheel mapped 1:1 onto the car's own steering rack (no added filter).
      const deg = ctl.steer * 450;
      // +-5 deg deadzone around centre counts as straight (lane assist drives there)
      let a = Math.max(0, Math.abs(deg) - 5) * 450 / 445;
      // Steering curve (wheel deg -> rack deg): same quick start as before up to ~45 deg,
      // a touch calmer through the 60-110 deg range, then builds to full lock.
      a = WHEEL_CURVE(a);
      // Speed sensitivity (AC): reduces max lock as speed rises. Fixed at 100%.
      a *= 1 - M4.wheelSpeedSens * 0.75 * U.smooth(0, 70, spd);
      a *= M4.wheelTurnScale; // overall wheel turn amount
      // per-range trim (small / medium / hard turns), keyed on wheel angle
      if (this._tmKeys !== M4.turnMultKeys) { this._tmKeys = M4.turnMultKeys; this._tm = mcurve(M4.turnMultKeys); }
      a *= this._tm(Math.abs(deg));
      // M Servotronic variable ratio: ~15:1 near centre, quickening toward lock.
      // Sensitivity slider shortens/lengthens the ratio (2.0 = twice as quick).
      const ratio = U.lerp(M4.ratioCentre, M4.ratioLock, U.smooth(40, 300, a)) / sens;
      drv = Math.sign(deg) * (a / ratio) * Math.PI / 180;
      // lane assist only holds the wheel while it's in the +-5 deg "straight" zone; it hands over by 8 deg,
      // so any angle you hold beyond that keeps the car turning until you straighten the wheel
      intent = Math.max(0, Math.abs(deg) - 5) / 3;
      // tiny sensor-noise filter only (AC filter 0)
      this.wheelF = this.wheelF + (drv - this.wheelF) * (1 - Math.exp(-dt * M4.wheelFilter));
      drv = this.wheelF;
    } else {
      // ---- Keyboard: Assetto Corsa keyboard steering model ----
      // Steering speed ramps toward the key, opposite-lock speed is faster when switching sides,
      // and return rate re-centres when released. Speed sensitivity (~60%) scales max lock
      // with speed, then a light filter (~40%) rounds it off.
      const t = ctl.steer;
      let rate;
      if (t === 0) rate = M4.keyReturn;
      else if (this.key !== 0 && Math.sign(t) !== Math.sign(this.key)) rate = M4.keyOpposite;
      else rate = M4.keySpeed;
      this.key += U.clamp(t - this.key, -rate * dt, rate * dt);
      this.k1 += (this.key - this.k1) * (1 - Math.exp(-dt * M4.keyFilter));
      const ms = 0.55 / (1 + spd * 0.025) * sens;  // only mild speed reduction of max lock
      drv = this.k1 * ms;
      intent = Math.abs(t);
    }
    drv = U.clamp(drv, -M4.maxLock, M4.maxLock);

    // ---- lane assist ----
    const S = settings.assist;
    let out = drv;
    this.assistActive = 0;
    if (S > 0 && car.u > 9) {
      const p = ROAD.project(car.x, car.z);
      const ry = ROAD.yaw(p.s), kap = ROAD.kappa(p.s);
      const eYaw = U.wrap(car.yaw - ry);
      if (Math.abs(eYaw) < 0.45 && p.d > ROAD.edgeL - 1 && p.d < ROAD.edgeR + 1) {
        // Lane keeping: steer toward the centre of the nearest lane and follow the road's curve.
        // It takes over smoothly while the driver's input is small and hands back control
        // as soon as the driver clearly steers (e.g. to change lanes).
        const vlat = car.u * Math.sin(eYaw) + car.v * Math.cos(eYaw);
        const pred = p.d + vlat * 0.6;
        let lane = ROAD.nearestLane(pred);
        // never hold the car in a lane that's closed by roadworks just ahead
        if (ZONES.closedAhead(lane, p.s, 150)) lane += lane === 0 ? 1 : -1;
        const err = p.d - ROAD.lane(lane);
        const vdes = U.clamp(-err * 1.8, -4, 4);                     // m/s back toward lane centre (firm)
        const eDes = Math.asin(U.clamp(vdes / car.u, -0.3, 0.3));       // heading that achieves it
        const us = 1 + M4.usK * car.u * car.u;                          // match the car's understeer
        const ff = Math.atan(M4.wheelbase * kap * us);                  // follow the curve
        // steering that corrects the heading error over ~0.7 s, scaled for speed
        const la = U.clamp(ff + M4.wheelbase * us * (eDes - eYaw) / (0.4 * car.u), -0.15, 0.15);
        const fade = 1 - U.smooth(0, 1, intent); // driver steering -> assist lets go completely
        const w = (1 - (1 - S) * (1 - S)) * fade;   // strong even at low slider values (50% -> 75% authority)
        out = drv + w * (la - drv);
        this.assistActive = w;
      }
    }
    car.steer = U.clamp(out, -M4.maxLock, M4.maxLock);
  }
}
