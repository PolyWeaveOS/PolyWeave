'use strict';
// =====================================================================
//  Player vehicle dynamics: BMW M4 Competition (G82)
//  - Dynamic bicycle model with Pacejka-style tyre curves
//  - Longitudinal weight transfer, friction-circle combined slip
//  - S58 torque curve, 8-speed M Steptronic, RWD, rev limiter
//  - ABS, optional traction control
//  Frame: u = forward speed, v = lateral (right +), r = yaw rate (right turn +)
// =====================================================================

const M4 = {
  mass: 1725, Iz: 2950, wheelbase: 2.857, a: 1.343, b: 1.514, hcg: 0.49, rw: 0.345,
  mu: 1.08, muX: 1.38, Bf: 15, Br: 16.5, C: 1.4, // lateral / longitudinal peak friction (performance tyres)
  cdA: 0.34 * 2.2, rho: 1.225, crr: 0.014, eff: 0.88,
  assistBack: 0.6,   // lane assist eases back in over this long once you stop steering (it lets go instantly)
  coastExtra: 0.5,   // off both pedals the car slows 50% quicker than engine braking + drag alone
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
  // Keyboard steering: keys ask for a turn (sideways g), not a wheel angle (see SteerController)
  kbFirst: 0.5,     // a press goes straight to this much of the full turn...
  kbBuild: 0.6,     // ...then keeps tightening toward the full turn while held (~1 s; per second)
  kbSmooth: 18,     // how quickly the steering follows a press (starts at once, eases in: ~63% in 1/18 s)
  kbReturn: 10,     // ...letting go (straightens up smoothly)...
  kbReturnTail: 3,  // ...except the last bit, which slides gently back to centre...
  kbTailAt: 0.1,    // ...(roughly the last 10% of the turn)
  kbFlipSmooth: 12, // ...switching sides (car starts changing direction ~0.02 s after the switch, 90% over in ~0.12 s)
  kbFlipBoost: 1.2, // switching sides pulls this much harder for a moment, so the car changes direction sooner
  kbFlipTime: 0.12, // (how long that extra pull lasts after the switch)
  kbGrace: 0.12,    // releasing one key and pressing the other within this long still counts as a switch
  kbLowLock: 0.5,   // front wheel angle limit at walking pace (parking lot manoeuvring)
  // full-key turn (sideways g) vs speed (km/h); Settings > Keyboard sensitivity scales it
  // (highway speed: ~1.4 g the moment you press, tightening to ~2.3 g after holding ~1 s)
  kbTurnG: [[0, 4.35], [40, 4.05], [100, 3.9], [300, 3.7]],
  kbAlign: 0,       // with no key pressed, steer the car back in line with the road (0 = off, 1 = full)
  kbAlignTau: 0.6,  // ...taking about this long to line up
  kbAlignMax: 0.35, // ...using at most this much of a full turn
  kbCounter: 1,     // steering back against the way the car points (switching sides / straightening out) pulls this much harder
  kbTurnCap: 0,     // keyboard's own cornering ceiling (g) while swinging back / straightening; 0 = the same as the wheel (turnG)
  kbPressCap: 0,    // ...and while simply turning with a key held (0 = turnG)
  kbEase: 0,        // eased (critically damped) steering: speed factor vs the plain smoothing rates; 0 = off (instant-start smoothing)
  kbCapBlend: 0,    // how quickly those grip ceilings blend from one to another (per second); 0 = at once
  kbSlew: 0,        // hand speed: most the steering can move per second (in full turns); 0 = no limit
  // (the keyboard values above are overwritten by the preset picked in Settings - see KB_PRESETS)
  ratio: 14.5,    // steering ratio (wheel deg : road-wheel deg)
  brakeGrip: 1.23, // braking grip multiplier on top of the tyre grip (stronger, shorter stops)
};

// Keyboard steering presets (Settings > Keyboard steering). "classic" is the tuning as it was before
// "Max control" was added - kept exactly so it can be switched back to.
const KB_PRESETS = {
  classic: {
    kbFirst: 0.5, kbBuild: 0.6, kbSmooth: 18, kbReturn: 10, kbReturnTail: 3, kbTailAt: 0.1,
    kbFlipSmooth: 12, kbFlipBoost: 1.2, kbFlipTime: 0.12, kbGrace: 0.12,
    kbTurnG: [[0, 4.35], [40, 4.05], [100, 3.9], [300, 3.7]], kbAlign: 0, kbAlignTau: 0.6, kbAlignMax: 0.35,
    kbCounter: 1, kbTurnCap: 0, kbPressCap: 0,
  },
  // Max control: letting go lines the car back up with the road by itself (no counter-steering
  // needed to straighten out), and the steering comes back to centre crisply - no lingering turn.
  // (saved 2026-10-10 before "snappy": the Max control tuning as it was, to switch back to)
  control: {
    kbFirst: 0.5, kbBuild: 0.6, kbSmooth: 18, kbReturn: 14, kbReturnTail: 14, kbTailAt: 0.1,
    kbFlipSmooth: 12, kbFlipBoost: 1.2, kbFlipTime: 0.12, kbGrace: 0.12,
    kbTurnG: [[0, 4.35], [40, 4.05], [100, 3.9], [300, 3.7]], kbAlign: 1, kbAlignTau: 0.6, kbAlignMax: 0.35,
    kbCounter: 1, kbTurnCap: 0, kbPressCap: 0,
  },
  // Snappy (default): no heavy half-second when switching sides, no drifting on after letting go.
  // Steering back against the way the car points pulls harder, and letting go lines the car up quickly.
  // (measured at 200 km/h after a 0.3 s tap: the car changes direction 0.26 s after switching, was 0.38 s;
  //  letting go, it's straight again in 0.87 s, was 1.31 s; holding 0.6 s then letting go still carries you
  //  ~2.5 lanes across. A first, stronger version (0.15 s / 0.22 s / only 1.5 lanes) was too snappy.)
  //  Then a stronger initial turn: a press starts at 60.5% of the full turn (was 50%) with extra grip for its
  //  first ~0.4 s (kbPressCap). (tried 85% / 3.6 g, then 71% / 3.17 g; both too much, so halved again)
  //  Turning vs speed (kbTurnG, km/h -> sideways g): asking for the same g at every speed made the car rotate
  //  2.5x faster at 40 mph than at 100 mph (turn rate = g / speed), which looked unnatural. Now the g eases off
  //  below 100 mph: a quick tap at 40 mph turns ~1.4x what it does at 100 mph (30 mph ~1.6x). 100 mph and up
  //  are unchanged; parking-lot speeds are limited by the steering lock (kbLowLock) as before.
  snappy: {
    kbFirst: 0.605, kbBuild: 0.6, kbSmooth: 18, kbReturn: 15, kbReturnTail: 15, kbTailAt: 0.1,
    kbFlipSmooth: 18, kbFlipBoost: 1.2, kbFlipTime: 0.12, kbGrace: 0.12,
    kbTurnG: [[0, 1.3], [48, 1.65], [64, 1.9], [97, 2.5], [129, 3.2], [161, 3.84], [300, 3.7]], kbAlign: 1, kbAlignTau: 0.35, kbAlignMax: 0.5,
    kbCounter: 1.6, kbTurnCap: 3.2, kbPressCap: 2.85,
  },
};
// To go back to the previous keyboard feel, change 'snappy' to 'control' here.
const KB_STYLE = 'snappy';
function setKbStyle(name) { Object.assign(M4, KB_PRESETS[name] || KB_PRESETS[KB_STYLE]); }
setKbStyle(KB_STYLE);

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

  // inp: {throttle 0..1, brake 0..1, steer (rad, front wheel)}
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
      const cap = 9.81 * (this.turnCapG || M4.turnG);   // (keyboard can have its own ceiling; the wheel always uses turnG)
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
    // off both pedals: slow down more (engine braking + drag + rolling resistance scaled up by coastExtra)
    let coastX = 0;
    if (this.gear > 0 && this.u > 1 && throttle < 0.02 && brake < 0.02)
      coastX = M4.coastExtra * (Math.max(0, -Fdrive) + drag * this.u * spd + roll);
    const Fx = Fxr + Fxf - drag * this.u * spd - roll - corner - coastX;
    const u0 = this.u;
    this.u += Fx / m * dt;
    // braking never reverses direction by itself
    if ((brake > 0 || (this.gear === 0)) && Math.sign(this.u) !== Math.sign(u0) && u0 !== 0) this.u = 0;
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
  constructor() { this.key = 0; this.k1 = 0; this.kbSide = 0; this.kbSwitchT = 0; this.wheelF = 0; this.laLane = -1; this.assistActive = 0; }

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
      // ---- Keyboard ----
      // A key asks for a TURN (sideways g), not a wheel angle, so it feels the same at any speed.
      // A press goes straight to a strong turn, which keeps building to the full turn while held.
      // Switching sides carries how hard you were turning across to the other side.
      // The steering moves toward its target at once - fastest at the very start, then easing gently in
      // (no wind-up delay, no rush through the middle), so changes are instant AND smooth.
      const t = ctl.steer;
      if (t === 0) {
        this.kbIdle = (this.kbIdle || 0) + dt;
        if (this.kbIdle > M4.kbGrace) this.key = 0;          // (a quick A->D change with a gap still counts as a switch)
      } else {
        this.kbIdle = 0;
        if (this.key === 0) this.key = M4.kbFirst;            // fresh press: strong turn straight away
        this.key = Math.min(1, this.key + M4.kbBuild * dt);   // ...building to the full turn while held
        if (Math.sign(t) !== this.kbSide) {
          this.kbSide = Math.sign(t); this.kbSwitchT = 0;
          this.kbFlip = Math.abs(this.k1) > 0.05 && Math.sign(this.k1) !== Math.sign(t);   // a real switch (was turning the other way)
        } else this.kbSwitchT = (this.kbSwitchT || 0) + dt;
      }
      // just switched sides (still swinging over): pull a bit harder so the car changes direction sooner
      const flipping = t !== 0 && this.kbFlip && (Math.sign(this.k1) !== Math.sign(t) || this.kbSwitchT < M4.kbFlipTime);
      // steering back against the way the car still points (switching sides, straightening out of a lane
      // change): pull harder until it points down the road again, so the car swings over without a heavy delay
      let counter = 1;
      if (t !== 0 && M4.kbCounter > 1 && car.u > 9) {
        const p = ROAD.project(car.x, car.z), eYaw = U.wrap(car.yaw - ROAD.yaw(p.s));   // (car heading vs the road)
        if (Math.sign(t) !== Math.sign(eYaw) && Math.abs(eYaw) > 0.004) counter = U.lerp(1, M4.kbCounter, U.smooth(0.004, 0.03, Math.abs(eYaw)));
      }
      const target = t === 0 ? 0 : t * this.key * Math.max(flipping ? M4.kbFlipBoost : 1, counter);
      // letting go: drops away quickly, then the last little bit of turn slides gently back to centre
      const wRet = U.lerp(M4.kbReturnTail, M4.kbReturn, U.smooth(0, M4.kbTailAt * 2, Math.abs(this.k1)));
      const w = t === 0 ? wRet : flipping || counter > 1 ? M4.kbFlipSmooth : M4.kbSmooth;
      // the keyboard's higher cornering ceiling only while swinging back / straightening, so ordinary held
      // turns stay exactly as sharp as before
      // (a fresh press gets extra grip for its first moments - a strong initial turn - fading back to the normal
      //  ceiling by ~0.6 s, so long held turns stay as they were)
      this.kbHeld = t === 0 ? 0 : (this.kbHeld || 0) + dt;
      const pressCap = M4.kbPressCap > 0 ? M4.turnG + (M4.kbPressCap - M4.turnG) * (1 - U.smooth(0.25, 0.6, this.kbHeld)) : 0;
      this.kbCap = counter > 1 || t === 0 ? M4.kbTurnCap : pressCap;
      if (M4.kbEase > 0) {
        // eased steering: the steering speeds up into a turn and slows as it arrives, like hands on a real wheel
        // (critically damped - no overshoot, no instant kick when a key goes down or comes up)
        const wn = w * M4.kbEase, acc = wn * wn * (target - this.k1) - 2 * wn * (this.k1v || 0);
        this.k1v = (this.k1v || 0) + acc * dt;
        this.k1 += this.k1v * dt;
      } else {
        const was = this.k1;
        this.k1 += (target - this.k1) * (1 - Math.exp(-dt * w));
        // hand speed: the steering can only move so fast (a full turn's worth in 1 / kbSlew s), so a switch from
        // one side to the other is a quick sweep, not a snap - the sideways force builds and fades like a real car
        if (M4.kbSlew > 0) this.k1 = was + U.clamp(this.k1 - was, -M4.kbSlew * dt, M4.kbSlew * dt);
        this.k1v = 0;
      }
      if (this._kbKeys !== M4.kbTurnG) { this._kbKeys = M4.kbTurnG; this._kbG = mcurve(M4.kbTurnG); }
      const kbSens = settings.kbSens || 1;   // keyboard has its own sensitivity (the wheel's slider doesn't touch it)
      const v = Math.max(spd, 1), turn = this._kbG(spd * 3.6) * 9.81 * kbSens;   // full-key sideways accel (m/s^2)
      const full = Math.min(M4.kbLowLock, Math.atan(M4.wheelbase * turn / (v * v)));   // wheel angle that gives it
      // straighten-out help (Max control): with no key held the car steers itself back in line with the
      // road's curve, so after a lane change or a swerve you don't have to counter-steer to recover.
      // Pressing any key hands control straight back.
      // (this IS lane assist for keyboard / gamepad: Settings "Lane assist (keyboard / gamepad)", 100% by default
      //  = the full tuned help, 0% = off - the car keeps whatever angle you leave it at)
      let alignT = 0;
      const kbAssist = settings.laneCentre ? 1 : settings.assistKb ?? 1;
      if (t === 0 && M4.kbAlign * kbAssist > 0 && car.u > 9) {
        const p = ROAD.project(car.x, car.z), eYaw = U.wrap(car.yaw - ROAD.yaw(p.s));
        if (Math.abs(eYaw) < 0.6 && p.d > ROAD.edgeL - 3 && p.d < ROAD.edgeR + 3) {
          const us = 1 + M4.usK * car.u * car.u;
          const ang = Math.atan(M4.wheelbase * ROAD.kappa(p.s) * us) - M4.wheelbase * us * eYaw / (M4.kbAlignTau * car.u);
          alignT = M4.kbAlign * kbAssist * U.clamp(ang, -M4.kbAlignMax * full, M4.kbAlignMax * full);
        }
      }
      const wA = t === 0 ? M4.kbReturn : M4.kbSmooth * 2;
      if (M4.kbEase > 0) {                       // (the straighten-up help eases in and out the same way)
        const wn = wA * M4.kbEase, acc = wn * wn * (alignT - (this.kAl || 0)) - 2 * wn * (this.kAlv || 0);
        this.kAlv = (this.kAlv || 0) + acc * dt;
        this.kAl = (this.kAl || 0) + this.kAlv * dt;
      } else this.kAl = (this.kAl || 0) + (alignT - (this.kAl || 0)) * (1 - Math.exp(-dt * wA));
      drv = this.k1 * full + this.kAl;
      intent = Math.abs(t);
      this.assistPct = kbAssist;                 // (HUD: "LANE ASSIST 100%", lit while it's straightening the car)
      this.kbAssisting = t === 0 && Math.abs(this.kAl) > 0.0005;
    }
    // keyboard: its own grip ceilings while turning / swinging back (blended, never switched in one step); wheel = M4.turnG
    if (wheel) { car.turnCapG = 0; this.capF = 0; }
    else {
      const want = this.kbCap || M4.turnG;
      this.capF = this.capF ? this.capF + (want - this.capF) * (1 - Math.exp(-dt * (M4.kbCapBlend || 1e9))) : want;
      car.turnCapG = this.capF;
    }
    drv = U.clamp(drv, -M4.maxLock, M4.maxLock);

    // ---- lane assist ----
    // Keeps the car lined up with the road's curve (wherever you are across it - it does NOT pull you
    // into a lane). The moment you steer it lets go completely, and it only eases back in once your
    // steering has settled, so it never fights a turn or a quick left-right weave.
    // (settings.laneCentre: also holds the nearest lane - only used while the menu is open on a server)
    // This road-following assist is the STEERING WHEEL's lane assist (Settings "Lane assist (steering wheel)");
    // keyboard / gamepad have their own (the straighten-up help above), so it stays out of their way.
    const S = wheel || settings.laneCentre ? settings.assist : 0;
    if (wheel) this.assistPct = settings.assist;
    let out = drv;
    this.assistActive = !wheel && this.kbAssisting ? 1 : 0;
    const steering = intent > 0.01 || (!wheel && Math.abs(this.k1) > 0.03);
    this.assistGate = steering ? 0 : Math.min(1, (this.assistGate ?? 1) + dt / M4.assistBack);
    if (S > 0 && car.u > 9 && this.assistGate > 0) {
      const p = ROAD.project(car.x, car.z);
      const ry = ROAD.yaw(p.s), kap = ROAD.kappa(p.s);
      const eYaw = U.wrap(car.yaw - ry);
      if (Math.abs(eYaw) < 0.45 && p.d > ROAD.edgeL - 1 && p.d < ROAD.edgeR + 1) {
        let eDes = 0;                                                   // heading: along the road
        if (settings.laneCentre) {
          const vlat = car.u * Math.sin(eYaw) + car.v * Math.cos(eYaw);
          let lane = ROAD.nearestLane(p.d + vlat * 0.6);
          if (ZONES.closedAhead(lane, p.s, 150)) lane += lane === 0 ? 1 : -1;   // never a lane closed just ahead
          const vdes = U.clamp(-(p.d - ROAD.lane(lane)) * 1.8, -4, 4);  // m/s back toward lane centre
          eDes = Math.asin(U.clamp(vdes / car.u, -0.3, 0.3));
        }
        const us = 1 + M4.usK * car.u * car.u;                          // match the car's understeer
        const ff = Math.atan(M4.wheelbase * kap * us);                  // follow the curve
        // steering that corrects the heading error over ~0.7 s, scaled for speed
        const la = U.clamp(ff + M4.wheelbase * us * (eDes - eYaw) / (0.4 * car.u), -0.15, 0.15);
        const g = this.assistGate, w = (1 - (1 - S) * (1 - S)) * g * g * (3 - 2 * g);   // eases back in smoothly
        out = drv + w * (la - drv);
        this.assistActive = w;
      }
    }
    car.steer = U.clamp(out, -M4.maxLock, M4.maxLock);
  }
}
