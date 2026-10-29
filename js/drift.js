'use strict';
// =====================================================================
//  The drift car (Nissan Silvia S15, owners only): its own tyre physics.
//  Every other car keeps the game's normal driving (physics.js, untouched); this only takes over while
//  car.drift is set (main.js: the S15 picked in the Garage, on an owner's account, outside racing).
//  - Full dynamic model: the car's sideways speed and yaw are real states, set by the tyre forces
//  - Rear axle wheel speed is a state too: throttle spins the rear tyres, which takes their sideways grip
//    away (power-over oversteer); the handbrake locks them (with the clutch in)
//  - Combined-slip tyres with a grip peak, then a gentle drop to sliding grip (so a slide holds, but
//    doesn't snap), load transfer front/rear and side to side, tyre load sensitivity
//  - SR20DET-style engine built to ~400 hp, 6-speed, welded-diff style rear axle
//  - Drift control (owner's ask: "as controllable as possible"): once the rear is properly sliding, the drift's
//    angle comes from the throttle and how far you steer into / out of the turn, and moves there smoothly (no
//    snapping back, no spinning past ~55 deg); the steering also bends the path. Works the same for keys and wheels.
//  - Steering wheel: progressive rack (16:1 round the centre, 46 deg full lock); force feedback carries the tyres'
//    self-aligning torque, and while drifting a spring toward a light counter-steer.
// =====================================================================
const DRIFT = {
  name: 'Nissan Silvia S15',
  mass: 1300, Iz: 1900, L: 2.525, a: 1.17, b: 1.355, hcg: 0.46, trackF: 1.48, trackR: 1.47, rw: 0.315,
  // (balanced to push gently at the limit with neutral throttle - steady in a fast corner - and step out from
  //  power, a lift, the handbrake or a flick, like a set-up drift car)
  muF: 1.12, muR: 1.16, loadSens: 0.12, rollF: 0.62,
  gripBoost: 1.3, muX: 1.35,                // extra grip off the throttle when not drifting: turns hard, drives instead of sliding
  aPk: 0.11, kPk: 0.10,          // slip angle (rad, ~6.3 deg) and slip ratio at peak grip (semi-slick drift tyres)
  slide: 0.92, slideEnd: 6,      // grip when fully sliding (of peak), reached at 6x the peak slip (low enough that a slide holds instead of snapping back)
  Iw: 2.4, Ie: 0.20,             // rear wheels + axle, engine + flywheel (kg m^2)
  gears: [0, 3.321, 1.902, 1.308, 1.000, 0.838, 0.720], rev: 3.382, fd: 4.08, eff: 0.9,
  idle: 950, redline: 8000,
  // (owner: it should pick up speed a lot quicker - built to ~540 hp)
  torque: [[0, 200], [1000, 260], [2500, 370], [3500, 530], [4500, 615], [6000, 600], [7000, 545], [7800, 490], [8500, 400]],
  cdA: 0.72, crr: 0.013, down: 0.10,
  brakeG: 1.25, bias: 0.62, hand: 3200,   // footbrake (g, before the tyre limit), front share, handbrake torque (N m)
  lock: 0.80, ratio: 10,         // 46 degrees of front lock (ratio: what the drawn steering wheel turns by)
  ratioC: 16, ratioK: 1.97e-7,   // wheel -> front wheels: 16:1 round the centre, quickening to full lock at 450 deg
  tm: 0.025, tp: 0.045,          // mechanical + tyre (pneumatic) trail: the steering's self-aligning torque
  // drift control (see driftSub): steering span that counts as fully into / out of the turn (rad), the angle with
  // no throttle / per throttle / per steer (rad), deepest angle, how fast it can change (rad/s); path: turn (g) at
  // neutral / per steer, how hard it's held; angle and yaw-rate gains
  dSteerSpan: 0.22, dKeep: 0.95, dPush: 0.32, dScrub: 0, dFfbAt: 0, gripAid: 1.0, dSwing: 0.8, dSwingRate: 3.2, dLiftSwing: 0.75, dSwingMin: 0.6, dWheelSwing: 0.5, dTrimMin: 0.25, dHoldIn: 0.55, dCarryFade: 0.12, dEase: 3.5, dEaseSwing: 9, dPathEase: 5, dBase: 0.18, dThrottle: 0.55, dSteer: 0.25, dMax: 1.15, dBrake: 0.5, dBrakeEntry: 0.078, dBrakeA0: 0.32, dBrakeFar: 0.3, dBrakeFast: 0.3, dPathBrake: 0.45, dBrakeG: 0.4, dMaxLow: 1.35, dRate: 0.9, dPathG: 0.6, dPathSteer: 1.6, dPathK: 1.0, dAngK: 3, dYawK: 7, dPathSlew: 6, dSwingAcc: 12,
  // keys = a pretend wheel: turning speed when a key goes down / after kbWheelRamp s (deg of wheel per s), self-centring
  // (deg/s, and how softly it settles), how hard it can turn while gripping (g), never less than kbWheelMin deg
  kbWheelRate0: 300, kbWheelRate: 800, kbWheelRamp: 0.3, kbWheelBack: 500, kbWheelBackK: 6, kbWheelG: 2.5, kbWheelMin: 150, kbWheelSlow: 2.5,
  kbHands: 16, kbHandsMax: 4.5,  // keys: how quickly the eased steering follows (rad/s natural frequency), fastest hands (rad/s at the wheels)
  kbTurnG: 1.15, kbTurnGOff: 1.45,                 // keys, grip driving: how hard a full key turns (g)
};

const driftTorque = rpm => {
  const t = DRIFT.torque;
  for (let i = 0; i < t.length - 1; i++) if (rpm <= t[i + 1][0]) return t[i][1] + (t[i + 1][1] - t[i][1]) * (rpm - t[i][0]) / (t[i + 1][0] - t[i][0]);
  return t[t.length - 1][1];
};
// grip vs normalised slip (1 = peak): smooth rise, then eases down to sliding grip
const driftCurve = s => (s < 1 ? Math.sin(s * Math.PI / 2) : 1 - (1 - DRIFT.slide) * U.smooth(1, DRIFT.slideEnd, s));

(() => {
  const P = PlayerCar.prototype, base = { step: P.step, ratio: P.ratio, shift: P.shift, bestGear: P.bestGear, place: P.place };
  P.ratio = function (g) { if (!this.drift) return base.ratio.call(this, g); const D = DRIFT; return g > 0 ? D.gears[g] * D.fd : g < 0 ? -D.rev * D.fd : 0; };
  P.bestGear = function (u) {
    if (!this.drift) return base.bestGear.call(this, u);
    for (let g = 1; g <= 6; g++) if (Math.abs(u / DRIFT.rw * this.ratio(g)) * 60 / (2 * Math.PI) < 5800) return g;
    return 6;
  };
  P.shift = function (dir) {
    if (!this.drift) return base.shift.call(this, dir);
    if (this.shiftT > 0) return;
    const ng = U.clamp(this.gear + dir, this.u < 1 ? -1 : 1, 6);
    if (ng === this.gear) return;
    if (dir < 0 && ng > 0 && Math.abs(this.wr || 0) * this.ratio(ng) * 60 / (2 * Math.PI) > DRIFT.redline + 300) return;   // (money-shift protection)
    this.gear = ng; this.shiftT = 0.15;
  };
  P.place = function (s, d, speed) { base.place.call(this, s, d, speed); this.wr = this.u / DRIFT.rw; this.rpmE = DRIFT.idle; this.dOn = false; this.dS = 0; this.bT = 0; this.bV = 0; this.wPS = undefined; this.ffbDrift = 0; };   // (reset / respawn: not drifting)
  P.step = function (dt, inp) {
    if (!this.drift) { this.driftWas = false; return base.step.call(this, dt, inp); }
    if (!this.driftWas) { this.driftWas = true; this.wr = this.u / DRIFT.rw; this.rpmE = this.rpm; this.gear = U.clamp(this.gear, -1, 6); this.ayWT = 0; }
    const n = 2, h = dt / n;
    for (let i = 0; i < n; i++) driftSub(this, h, inp);
  };

  function driftSub(c, h, inp) {
    const D = DRIFT, m = D.mass, g = 9.81, L = D.L;
    let throttle = U.clamp(inp.throttle, 0, 1);
    let brake = 1 - Math.pow(1 - U.clamp(inp.brake, 0, 1), 2.25);
    const hand = false;   // (handbrake drifting: off for now - the owner wants the basics right first; DRIFT.hand is kept for later)
    // ---- reverse: hold the brake at a standstill; in reverse the pedals swap ----
    if (c.gear >= 0 && c.u < 0.5 && brake > 0.3 && throttle < 0.05) { c.revHold = (c.revHold || 0) + h; if (c.revHold > 0.35) { c.gear = -1; c.revHold = 0; } }
    else if (c.gear >= 0) c.revHold = 0;
    if (c.gear < 0) {
      if (c.u > -0.5 && throttle > 0.3 && brake < 0.05) c.gear = 1;
      else { const t = throttle; throttle = brake; brake = t; }
    }
    if (c.shiftT > 0) c.shiftT -= h;
    // throttle help for keys / triggers held flat: a drifter feathers the throttle to keep the rear tyres turning a
    // bit faster than the road (~30%); full throttle in 2nd would just spin them up and bog the drift down.
    // (pedals on a wheel: untouched, your right foot does it)
    if (c.kbThrottle && c.gear > 0) {
      const slipK = (c.wr * D.rw - c.u) / Math.max(Math.abs(c.u), 3);
      const kT = c.kbSlipT ?? 0.3;
      // (smooth: it eases the throttle, it doesn't pulse it)
      c.thrCapT = U.clamp((c.thrCapT ?? 1) + (slipK < kT ? 2.5 : -(slipK - kT) * 30) * h, 0.08, 1);
      c.thrCap = (c.thrCap ?? 1) + (c.thrCapT - (c.thrCap ?? 1)) * (1 - Math.exp(-h * 8));
      throttle = Math.min(throttle, c.thrCap);
    } else { c.thrCap = 1; c.thrCapT = 1; }
    const ratio = c.ratio(c.gear);
    const wheelRpm = Math.abs(c.wr * ratio) * 60 / (2 * Math.PI);

    // ---- automatic gearbox (holds the gear while the rear tyres are spinning - you stay in the drift) ----
    if (!c.manual && c.gear > 0 && c.shiftT <= 0 && !hand) {
      const spinning = Math.abs(c.wr * D.rw - c.u) > 0.12 * Math.max(Math.abs(c.u), 3);
      const sliding = Math.abs(c.v - D.b * c.r) > 0.1 * Math.max(Math.abs(c.u), 3);
      c.slideT = sliding || spinning ? 0.8 : Math.max(0, (c.slideT || 0) - h);   // (and for a moment after)
      const up = throttle > 0.6 ? 7650 : 2700 + throttle * 4200, down = 1500 + throttle * 1500;   // (no big kick-down: it would snap the rear round)
      // drifting: hold the gear (lifting mid-drift must not shift up), except bouncing off the limiter flat out
      const nextRpm = c.gear < 6 ? wheelRpm * D.gears[c.gear + 1] / D.gears[c.gear] : 0;   // (where the next gear lands: never shift into a bog)
      if (c.gear < 6 && nextRpm > 3200 && (c.slideT > 0 ? wheelRpm > D.redline - 40 && throttle > 0.9 : wheelRpm > up)) { c.gear++; c.shiftT = 0.15; }
      else if (c.gear > 1 && wheelRpm < down && (c.slideT <= 0 || wheelRpm < 2300)) {   // (bogging: always shift down)
        const nr = Math.abs(c.wr * c.ratio(c.gear - 1)) * 60 / (2 * Math.PI);
        if (nr < 6800) { c.gear--; c.shiftT = 0.12; }
      }
    }

    // ---- engine + clutch ----
    // clutch open: shifting, neutral, handbrake pulled. Slipping: pulling away (wheels too slow for the engine)
    const open = c.shiftT > 0 || c.gear === 0 || hand;
    let Td = 0, I = D.Iw;
    if (open) {
      const free = D.idle + throttle * (D.redline - D.idle);
      c.rpmE += (free - c.rpmE) * Math.min(1, h * (throttle > 0 ? 9 : 4));
    } else if (wheelRpm < D.idle * 1.25) {
      const launch = D.idle + throttle * 3200;
      c.rpmE += (launch - c.rpmE) * Math.min(1, h * 10);
      Td = throttle * driftTorque(c.rpmE) * ratio * D.eff;   // (slipping clutch: the engine's torque goes through)
    } else {
      c.rpmE = wheelRpm;
      let thr = throttle;
      if (c.rpmE >= D.redline) thr = 0;                   // rev limiter
      const Te = thr * driftTorque(c.rpmE) - (1 - thr) * (20 + c.rpmE * 0.009);
      Td = Te * ratio * D.eff;
      I = D.Iw + D.Ie * ratio * ratio;
    }
    c.rpm = Math.max(D.idle * 0.9, c.rpmE);
    c.limiter = c.rpmE >= D.redline - 20;

    // ---- loads ----
    const spd = Math.hypot(c.u, c.v);
    const aero = D.down * spd * spd;
    const dW = m * (c.axWT || 0) * D.hcg / L;
    const Fzf = Math.max(m * g * D.b / L - dW + aero * 0.45, 800), Fzr = Math.max(m * g * D.a / L + dW + aero * 0.55, 800);
    const dL = m * (c.ayWT || 0) * D.hcg, dLf = dL * D.rollF / D.trackF, dLr = dL * (1 - D.rollF) / D.trackR;
    const axle = (Fz, dLat, mu) => {                     // two tyres with load sensitivity -> the axle's grip (N)
      const z0 = Fz / 2, a1 = Math.max(50, z0 + Math.abs(dLat)), a2 = Math.max(50, z0 - Math.abs(dLat)), r0 = m * g / 4;
      return mu * (a1 * (1 - D.loadSens * (a1 / r0 - 1)) + a2 * (1 - D.loadSens * (a2 / r0 - 1)));
    };
    // off the throttle and not drifting, the tyres bite harder (sharp turn-in, drives through gaps); on the throttle
    // and while drifting they're the drift tyres as they were
    const off = (1 - U.smooth(0.3, 0.9, U.clamp(inp.throttle, 0, 1))) * (1 - (c.dS || 0));
    const gk = 1 + (D.gripBoost - 1) * off;
    const GF = axle(Fzf, dLf, D.muF) * gk, GR = axle(Fzr, dLr, D.muR) * gk;

    // ---- brakes ----
    // (drifting: most of the braking comes through the drift itself - see the drift control - so the front tyres keep
    // their bite and the car steepens like a real one on the left-foot brake, instead of the nose washing out)
    const bF = brake * D.brakeG * m * g * M4.brakeBoost * (1 - 0.75 * (c.dS || 0));   // (Season 1: every car's brakes x1.5)
    // (the footbrake has ABS like every car in the game: it never locks the rear; the handbrake does)
    const Tbr = Math.min(bF * (1 - D.bias), GR * 0.85) * D.rw + (hand ? D.hand : 0);

    // ---- rear tyres: combined slip, wheel speed solved implicitly (stable at any time step) ----
    const vyr = c.v - D.b * c.r, Vr = Math.max(Math.abs(c.u), 3);
    const rearForce = wr => {
      const sx = wr * D.rw - c.u, nx = sx / Vr / D.kPk, ny = vyr / Vr / D.aPk, s = Math.hypot(nx, ny);
      // (the tyres grip harder pulling forward than sideways - muX: the power gets down instead of just spinning)
      if (s < 1e-6) return { fx: 0, fy: 0, kx: GR * D.muX * Math.PI / 2 / (D.kPk * Vr), s: 0 };
      const F = GR * driftCurve(s);
      return { fx: F * D.muX * nx / s, fy: -F * ny / s, kx: Math.abs(sx) > 1e-4 ? F * D.muX * Math.abs(nx) / s / Math.abs(sx) : GR * D.muX * Math.PI / 2 / (D.kPk * Vr), s };
    };
    let R = rearForce(c.wr);
    // I dw/dt = Td - Fx rw - brakes, with Fx = kx (w rw - u)
    let w1 = (I * c.wr + h * (Td + R.kx * D.rw * c.u)) / (I + h * R.kx * D.rw * D.rw);
    const bStep = h * Tbr / (I + h * R.kx * D.rw * D.rw);
    w1 = Math.abs(w1) <= bStep ? 0 : w1 - Math.sign(w1) * bStep;      // brakes / handbrake: can lock, never spin it backwards
    c.wr = w1;
    R = rearForce(c.wr);
    const Fxr = R.fx, Fyr = R.fy;

    // ---- front tyres: free rolling, braking + steering ----
    const d = c.steer, cd = Math.cos(d), sd = Math.sin(d);
    const vyf = c.v + D.a * c.r;
    const vxw = c.u * cd + vyf * sd, vyw = -c.u * sd + vyf * cd;
    const sF = vyw / Math.max(Math.abs(vxw), 3) / D.aPk;
    let fyw = -Math.sign(sF) * GF * driftCurve(Math.abs(sF));
    let fxw = -bF * D.bias * U.clamp(vxw / 0.6, -1, 1);
    const bk = M4.brakeBoost;                             // (Season 1: stopping force x1.5 on every car - braking grip only)
    fxw = U.clamp(fxw, -GF * 0.95 * bk, GF * 0.95 * bk);
    const left = Math.sqrt(Math.max(0, GF * GF - (fxw / bk) * (fxw / bk)));
    if (Math.abs(fyw) > left) fyw = Math.sign(fyw) * left;
    const Fxf = fxw * cd - fyw * sd, Fyf = fxw * sd + fyw * cd;
    // self-aligning torque at the front (steering force feedback): pulls the wheels toward where they're rolling
    const trail = D.tm + D.tp * Math.max(0, 1 - Math.abs(sF));
    c.ffbAlign = U.clamp(-fyw * trail / (m * g * D.b / L * D.muF * (D.tm + D.tp) * 0.55), -1, 1);

    // ---- motion ----
    const drag = 0.5 * 1.225 * D.cdA * spd;
    const roll = D.crr * m * g * U.clamp(c.u / 0.3, -1, 1);
    let Fx = Fxr + Fxf - drag * c.u - roll;
    let Fy = Fyr + Fyf - drag * c.v;
    let Mz = D.a * Fyf - D.b * Fyr;
    // ---- drift control (CarX / Forza style): once the car is properly sliding, you drive the DRIFT, not the
    //      tyres. The angle comes from your right foot and how far you steer into / out of the turn, and it moves
    //      there smoothly (it can't snap back or run away into a spin, max ~55 deg); your steering also bends the
    //      path, so you can tighten or widen the drift while sliding. Same for keys, pads and wheels. ----
    {
      const V = Math.hypot(c.u, c.v), beta = Math.atan2(c.v, Math.max(Math.abs(c.u), 0.5));
      const rearA = Math.atan2(c.v - D.b * c.r, Math.max(Math.abs(c.u), 1));
      const spinK = (c.wr * D.rw - c.u) / Math.max(Math.abs(c.u), 3);
      // how fast the path is turning right now, straight from the forces across the direction of travel
      const wPathNow = V > 0.5 ? (c.u * Fy - c.v * Fx) / (m * V * V) : 0;
      // in: rear well past its grip from power (wheelspin) or a big slide; out: angle nearly gone
      const want = c.u > 0.5 && V > 3.5 && ((Math.abs(rearA) > 0.24 + 0.12 * U.smooth(22, 40, V) && inp.throttle > 0.15) || (Math.abs(rearA) > 0.45 && V > 8) || (Math.abs(rearA) > 0.13 && spinK > 0.25))   /* (no wheelspin: at highway speed it takes a bigger slide) */;
      // brake + a decent turn of the wheel (~75 deg or more) starts a drift: the weight goes onto the nose and the rear goes
      // light, like a real brake-entry. How big it starts depends on how far AND how fast you turned the wheel.
      const sr = Math.abs(c.steer - (c.stPrev ?? c.steer)) / h; c.stPrev = c.steer;
      c.stPeak = Math.max((c.stPeak || 0) * Math.exp(-2.5 * h), sr);          // (how fast the wheel was turned just now, rad/s at the wheels)
      c.brkT = inp.brake > 0.3 ? 0.25 : Math.max(0, (c.brkT || 0) - h);   // (a brake you've only just let go of still counts)
      const a0 = D.dBrakeA0 + D.dBrakeFar * U.smooth(D.dBrakeEntry, D.dBrakeEntry + 0.12, Math.abs(c.steer)) + D.dBrakeFast * U.smooth(0.15, 1.2, c.stPeak);
      // (while a brake entry is starting, turning the wheel further / faster still adds to how far it kicks out)
      if (c.dOn && (c.entryT || 0) > 0 && Math.sign(c.steer) === c.dSide) c.carry = Math.max(c.carry || 0, a0);
      if (!c.dOn && c.brkT > 0 && c.u > 8 && Math.abs(c.steer) > D.dBrakeEntry) {
        c.dOn = true; c.dSide = Math.sign(c.steer); c.bT = Math.max(0, -c.dSide * beta); c.bV = 0;
        c.carry = a0; c.bMem = a0; c.swingT = 0; c.swingTo = 0; c.flipT = 0.5; c.entryT = 0.8;   // (the carry is the angle it swings out to; throttle / steering take it from there)
      }
      if (want && !c.dOn) { c.dOn = true; c.dSide = Math.abs(c.r) > 0.3 ? Math.sign(c.r) : -Math.sign(beta || 1); c.bT = Math.max(0, -c.dSide * beta); c.carry = 0; c.bMem = c.bT; c.swingT = 0; c.swingTo = 0; }   // (the side: which way the car is rotating - at walking pace a tight turn's geometry looks like a slide the other way)
      // (out: the angle is nearly gone and you're not swinging it over to the other side)
      c.flipT = Math.max(0, (c.flipT || 0) - h);
      // (counter-steering hard - on the throttle OR off it - is swinging the car over: never end the drift as it passes straight)
      // (wheel: counter-steer up to ~180 deg of wheel only trims the angle - only a big one, past dWheelSwing, swings over;
      //  keys: a key IS a full counter-steer, so it swings straight away)
      const wheelIn = !c.kbThrottle, csRaw = (c.dSide || 1) * c.steer / D.dSteerSpan, swingAt = wheelIn ? -D.dWheelSwing : -0.2;
      const swinging = c.dOn && (csRaw < swingAt || c.flipT > 0 || (c.swingT || 0) > 0);
      if (c.dOn && ((Math.abs(beta) < 0.05 && Math.abs(rearA) < 0.07 && Math.abs(c.bT || 0) < 0.06 && !swinging) || V < 2.5 || c.u < -0.5 ||
        (Math.abs(c.bT || 0) < 0.04 && inp.throttle < 0.1 && inp.brake < 0.05 && !swinging && (c.carry || 0) < 0.04))) c.dOn = false;   // (off both pedals and wound down: the drift is over)
      c.dS = U.clamp((c.dS || 0) + (c.dOn ? 2.5 : -1.5) * h, 0, 1);   // (fades in / out over ~0.4 / ~0.7 s: no snap when a drift starts or ends)
      if (c.dS > 0) {
        // the car has swung through to a drift the other way (a transition, or flicked across): that's the drift now
        // (a swing counts once the car is really heading over: the angle target has gone the other way, or a big flick)
        if (Math.sign(beta) === c.dSide && (Math.abs(beta) > 0.2 || (c.bT < -0.04 && Math.abs(beta) > 0.03))) {
          // the new drift starts with the swing's depth and, off the throttle, carries it (fading slowly) - throttle takes over
          c.carry = Math.max(Math.abs(beta), -c.bT, c.swingTo || 0);
          c.dSide = -c.dSide; c.bT = Math.max(Math.abs(beta), -c.bT); c.bV = -(c.bV || 0); c.flipT = 0.7; c.bMem = c.carry; c.swingTo = 0; c.swingT = 0; }   // (a moment's grace: the new drift builds before it could count as over)
        const side = c.dSide;                                             // +1 drifting round to the right
        // your steering as it is (a 30-45 deg real counter-steer is out of reach on a wheel): straight = a steady drift,
        // into the turn (+) = more angle and a tighter line, counter-steer (-) = less angle and a wider line
        const cs = side * c.steer / D.dSteerSpan;                         // (your steering against THIS side - read after any switch above)
        const cin = U.clamp(cs, -1, 1);
        // the angle (+ = this side, - = swung over to the other side): mostly your right foot, a bit more steering into
        // the turn. Counter-steer ON the throttle swings the car through into a drift the other way (a transition);
        // counter-steer with the throttle off just straightens it out and the drift ends
        // braking mid-drift (left-foot braking): weight goes forward, the rear goes light - the angle gets steeper and the
        // line tighter while the car slows (it holds the drift on the brake even off the throttle)
        const brk = c.u > 2 ? brake : 0;
        // (on the brake the angle keeps what your throttle was giving it, and the brake adds steepness on top)
        c.thHold = brk > 0.1 ? Math.max(c.thHold || 0, 0) : U.clamp(inp.throttle, 0, 1);
        const thIn = Math.max(U.clamp(inp.throttle, 0, 1), brk > 0.1 ? c.thHold : 0), base = D.dBase * Math.min(1, thIn * 4 + brk * 3) + D.dThrottle * thIn + D.dBrake * brk;   // (fully off the throttle and the brake: the drift dies out)
        // (deepest angle: ~66 deg at speed, up to ~77 deg at walking pace - donuts and swinging round tight hairpins)
        const dMax = U.lerp(D.dMaxLow, D.dMax, U.smooth(8, 16, V));
        // the angle you came in with (it's what a lift-off swing throws the car across with)
        if (cs > swingAt) c.bMem = Math.max(c.bT, (c.bMem || 0) - 0.4 * h);
        // a swing you've already thrown: off the throttle the new drift keeps it, fading slowly (steer into it to hold more)
        c.carry = Math.max(0, (c.carry || 0) - (thIn > 0.2 ? 2 : 1) * D.dCarryFade * h);
        // (wheel: the drift is held by keeping the wheel turned INTO it - the further in, the more of the throttle's angle you
        //  keep; bring the wheel back to straight and the car straightens up, throttle or not. Keys: a key held = into it)
        const hold = wheelIn ? U.smooth(0, D.dHoldIn, cin) : 1;
        let bt = cin >= 0 ? Math.min(Math.max((base + D.dSteer * cin * Math.min(1, thIn * 3 + brk * 3)) * U.lerp(1.45, 1, U.smooth(8, 16, V)) * hold, c.carry * (wheelIn ? ((c.entryT || 0) > 0 ? 1 : hold) : 0.6 + 0.4 * cin)), dMax) :   // (a brake entry kicks out at full strength first)
           (wheelIn ? 0                                                         // wheel: past straight (counter-steer) it just straightens - a big one swings over (below)
                    : Math.max(base * (1 + cin * (1 + D.dSwing * thIn)), -D.dMax * 0.8));
        // counter-steering hard - with the throttle or without it (a lift-off swing) - throws the car over into a drift the other
        // way, about dLiftSwing of the angle it had: the pendulum of a real one when the weight comes off the rear
        // (a firm flick - held for ~0.15 s - commits the swing: let go of the key and the car still carries on over, like a
        //  real lift-off flick; a quick brush of the key just trims the angle)
        const swPull = wheelIn ? U.smooth(D.dWheelSwing, D.dWheelSwing + 0.15, -cs) : U.smooth(0.15, 0.45, -cin);   // (how hard you're asking for the swing)
        c.csT = cs < swingAt ? (c.csT || 0) + h : 0;
        if (cs < swingAt) { const sw = -Math.max(D.dLiftSwing * (c.bMem || 0), D.dSwingMin) * swPull; if (sw < bt) { bt = Math.max(sw, -D.dMax * 0.8); c.swingTo = Math.max(c.swingTo || 0, -bt); if (c.csT > 0.15) c.swingT = 1.6; } }   // (the swing keeps its deepest target as the key / wheel comes back)   // (a swing is always a proper drift on the new side, never a half-hearted lean)
        c.swingT = Math.max(0, (c.swingT || 0) - h);
        if (c.swingT > 0 && (c.swingTo || 0) > 0.05) bt = Math.min(bt, -c.swingTo);
        const rate = cin < -0.3 ? D.dSwingRate : D.dRate;                 // (swinging over is quicker than building angle)
        // the angle eases toward that like a spring with no bounce: it starts moving gently, flows, and settles softly
        // (no sudden starts or stops - the smooth look of a good drift clip)
        c.entryT = Math.max(0, (c.entryT || 0) - h);
        const wn = cin < -0.3 || c.entryT > 0 ? D.dEaseSwing : D.dEase;
        // (and the swing builds up its speed over a moment rather than all at once: no jolt as the car starts across)
        c.bV = U.clamp((c.bV || 0) + U.clamp((wn * wn * (bt - c.bT) - 2 * wn * (c.bV || 0)) * h, -D.dSwingAcc * h, D.dSwingAcc * h), -rate, D.dRate);
        c.bT += c.bV * h;
        if (bt >= 0 && c.bT < 0) { c.bT = 0; c.bV = 0; }                 // (easing never overshoots into a drift the other way)
        const betaT = -side * c.bT;
        const aLat = 9.81 * U.clamp(D.dPathG + D.dPathSteer * cin + D.dPathBrake * brk * (cin > -0.3 ? 1 : 0), -1.0, 1.7);   // (counter-steer: straight on, or even drifting away from the turn)
        // how fast the path turns - eased in and out too, so the line flows instead of jerking with each key press
        // (and it can only swing round so fast: coming out of a donut the other way the line rolls over instead of snapping)
        c.wPS = (c.wPS ?? c.r) + U.clamp((side * aLat / Math.max(V, 7) - (c.wPS ?? c.r)) * (1 - Math.exp(-h * D.dPathEase)), -D.dPathSlew * h, D.dPathSlew * h);
        const wPath = c.wPS;
        const k = c.dS;
        // bend the path: a sideways push (across the direction of travel) toward the turn rate asked for
        const Fp = U.clamp(m * V * D.dPathK * (wPath - wPathNow), -m * 9.81 * 1.5, m * 9.81 * 1.5) * k;
        Fx -= Fp * c.v / Math.max(V, 0.1); Fy += Fp * c.u / Math.max(V, 0.1);
        // hold the angle: yaw toward (path turn rate + correction for the angle error)
        // (a brake entry: the rear's gone light, so it swings out to the angle more firmly - fading back to normal over ~0.8 s)
        const rT = wPath + D.dAngK * (1 + 1.5 * c.entryT / 0.8) * (beta - betaT);
        Mz += U.clamp(D.Iz * D.dYawK * (rT - c.r), -D.Iz * 30, D.Iz * 30) * k;
        // keep the speed up on the throttle: the tyres' scrubbing drag is mostly cancelled while you're on it (lift and it slows)
        const Fv = (Fx * c.u + Fy * c.v) / Math.max(V, 0.1);
        // braking while drifting: a smooth slow-down along the direction of travel (the drift-tyre scrub of a real one)
        if (brk > 0 && V > 2) { const dec = brk * m * 9.81 * D.dBrakeG * k; Fx -= dec * c.u / V; Fy -= dec * c.v / V; }
        // and real drive while drifting: on the throttle the car keeps gaining speed sideways (fading out at high speed)
        if (V > 2) { const push = m * 9.81 * D.dPush * Math.min(1, U.clamp(inp.throttle, 0, 1) * 1.4) * k * U.smooth(8, 11, V) * (1 - U.smooth(30, 47, V)) * (1 - brk); Fx += push * c.u / V; Fy += push * c.v / V; }   // (not at donut speeds, not while braking)
        // at donut speeds a deep slide scrubs speed off (the tyres just smoke): W + a turn from a standstill stays a donut
        if (V > 1) { const scrub = m * 9.81 * D.dScrub * k * (1 - U.smooth(8, 11, V)) * U.smooth(0.5, 0.8, Math.abs(beta)); Fx -= scrub * c.u / V; Fy -= scrub * c.v / V; }
        if (Fv < 0 && V > 3) { const add = -Fv * D.dKeep * Math.min(1, U.clamp(inp.throttle, 0, 1) * 1.8) * k * (1 - brk); Fx += add * c.u / V; Fy += add * c.v / V; }   // (your pedal / key, before the keyboard throttle help)
        // force feedback while drifting: a spring toward a light counter-steer you can actually hold
        c.ffbDrift = U.clamp((-side * D.dFfbAt * D.dSteerSpan - c.steer) * 2.2, -1, 1) * k;
      }
      // off the throttle and not drifting: keep the car tracking where it's going (it drives through a gap instead of
      // stepping out into a slide of its own); fades out on the throttle, so throttle + a turn still kicks a drift off
      {
        const kg = D.gripAid * (1 - c.dS) * (1 - U.smooth(0.2, 0.55, U.clamp(inp.throttle, 0, 1))) * U.smooth(0.03, 0.09, Math.abs(beta)) * (c.u > 3 ? 1 : 0);
        if (kg > 0) Mz += U.clamp(D.Iz * D.dYawK * (wPathNow + D.dAngK * beta - c.r), -D.Iz * 20, D.Iz * 20) * kg;
      }
      if (c.dS <= 0) c.ffbDrift = 0;
      else c.ffbAlign = U.lerp(c.ffbAlign, c.ffbDrift / c.dS, c.dS);   // (force feedback: the drift spring takes over from the tyres while drifting)
      c.drifting = c.dS;
    }
    const u0 = c.u;
    c.r += Mz / D.Iz * h;
    c.v += (Fy / m - c.u * c.r) * h;
    c.u += (Fx / m + c.v * c.r) * h;
    if (brake > 0.02 && throttle < 0.02 && Math.abs(c.u) < 0.08 && Math.abs(c.v) < 0.3 && u0 * c.u <= 0.0064) { c.u = 0; c.wr = 0; }   // (held still by the brakes)
    if (Math.abs(c.u) < 0.05 && Math.abs(c.v) < 0.05 && Math.abs(c.r) < 0.02 && Td === 0 && !hand && brake < 0.02 && throttle < 0.02) c.r *= 0.9;

    // ---- outputs the rest of the game reads ----
    c.rK = c.r; c.wImp = 0;
    c.ax = U.lerp(c.ax, Fx / m, Math.min(1, h * 10));
    c.axWT = U.lerp(c.axWT || 0, Fx / m, Math.min(1, h * 7));
    c.ay = U.lerp(c.ay, Fy / m, Math.min(1, h * 10));
    c.ayWT = U.lerp(c.ayWT || 0, Fy / m, Math.min(1, h * 8));
    const slipV = Math.hypot(c.wr * D.rw - c.u, vyr);          // how fast the rear tyres are scrubbing (m/s)
    c.slipR = slipV; c.slipF = Math.abs(vyw);
    c.spin = U.clamp((Math.abs(c.wr * D.rw - c.u) - 1.5) / 6, 0, 1);
    c.skid = U.clamp(Math.max((slipV - 1.2) / 5, (Math.abs(vyw) - 2) / 6, brake > 0.6 && spd > 8 ? 0.2 + 0.35 * brake : 0), 0, 1);
    c.brakeOn = brake > 0.05 || hand;
    c.driftAngle = Math.abs(c.u) > 2 ? Math.atan2(c.v, Math.abs(c.u)) : 0;
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    c.x += (c.u * sy + c.v * cy) * h;
    c.z += (-c.u * cy + c.v * sy) * h;
    c.yaw = U.wrap(c.yaw + c.r * h);
  }

  // ---- steering (below) ----
  const SC = SteerController.prototype, baseUpdate = SC.update;
  // wheel degrees (0..450) that turn the front wheels by `rad` through the progressive rack
  const wheelDegFor = rad => {
    const D = DRIFT, want = rad * 180 / Math.PI; let lo = 0, hi = 450;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (m / D.ratioC + D.ratioK * m * m * m < want) lo = m; else hi = m; }
    return lo;
  };
  SC.update = function (dt, car, ctl, settings) {
    if (!car.drift) return baseUpdate.call(this, dt, car, ctl, settings);
    const D = DRIFT, sens = settings.sens || 1;
    this.assistActive = 0; this.kbAssisting = false;
    let target;
    // keys: they turn a pretend steering wheel - held, it turns (slowly at first, then quicker); let go, it centres
    // itself like a real one. That wheel then goes through exactly the wheel's steering and drift control below, so a
    // tap is a small correction, feathering the key holds an in-between angle, holding it turns hard.
    const keys = ctl.source !== 'wheel' && !(typeof Input !== 'undefined' && Input.padKind === 'gamepad' && Math.abs(ctl.steer) % 1 > 0);
    let wheelIn = ctl.source === 'wheel' ? ctl.steer : null;
    if (keys) {
      const k = Math.sign(ctl.steer), w = this.vw ?? car.steer / D.lock;   // (wheel position, -1..1 = 450 deg each way)
      const u = Math.abs(car.u), dS = car.dS || 0;
      // how far it can go: drifting, just past the drift control's span (more does nothing but take longer to come back);
      // gripping, about as hard as the tyres can turn (never less than ~110 deg: enough for a brake entry)
      const gripRad = Math.atan(D.L * D.kbWheelG * 9.81 / Math.max(u * u, 1)) + D.aPk * 0.5;
      // (drifting at donut speeds: full lock, like the wheel)
      const cap = U.lerp(Math.max(D.kbWheelMin, wheelDegFor(gripRad)), U.lerp(450, wheelDegFor(D.dSteerSpan * 1.05), U.smooth(8, 12, u)), dS) / 450;
      if (k) {
        this.vwT = Math.sign(this.vwK || 0) === k ? (this.vwT || 0) + dt : 0; this.vwK = k;
        // (it turns against a spring - the further it's turned, the slower it goes: so how much of the time you hold the
        //  key sets how far the wheel sits, evenly, like easing a real wheel in and out)
        // (at parking / donut speeds the hands crank it round quicker, like hand-over-hand on a real wheel)
        const rate = U.lerp(D.kbWheelRate0, D.kbWheelRate, U.smooth(0, D.kbWheelRamp, this.vwT)) / 450 * U.clamp(1 - k * w / cap, 0, 2) * U.lerp(D.kbWheelSlow, 1, U.smooth(4, 10, u));
        this.vw = w + U.clamp(k * cap - w, -rate * dt, rate * dt);
      } else {
        this.vwK = 0; this.vwT = 0;
        this.vw = w - Math.sign(w) * Math.min(Math.abs(w), Math.min(D.kbWheelBack / 450, D.kbWheelBackK * Math.abs(w)) * dt);   // (self-centring, settling softly)
      }
      this.vw = U.clamp(this.vw, -1, 1);
      wheelIn = this.vw;
    } else this.vw = undefined;
    if (wheelIn !== null) {
      // through the rack: no lane assist, no speed-sensitive steering. Progressive ratio: ~16:1 round the centre
      // (calm on the straight, small corrections stay small), quickening to full lock (46 deg) at 450 deg of wheel
      const deg = Math.abs(wheelIn) * 450 * (keys ? 1 : sens);
      target = Math.sign(wheelIn) * (deg / D.ratioC + D.ratioK * deg * deg * deg) * Math.PI / 180;
      this.wheelF = (this.wheelF || 0) + (target - (this.wheelF || 0)) * (1 - Math.exp(-dt * 120));
      car.steer = U.clamp(this.wheelF, -D.lock, D.lock);
      this.dSteer = car.steer; car.kbThrottle = false;
      return;
    }
    // keyboard / gamepad. Grip driving: a key turns the wheels as far as a ~1 g turn needs (full lock at parking
    // speeds), so a tap at 130 km/h is a lane change, not a spin.
    const t = ctl.steer, u = Math.abs(car.u);
    const fwdDir = u > 1 ? Math.atan2(car.v + D.a * car.r, u) : 0;     // where the front axle is going (vs the car)
    // sliding (the physics' drift control is on): the keys steer relative to where the front wheels roll, so a
    // key into the turn = more angle and a tighter line, nothing = a steady drift, the other key = less angle / out
    this.slideF = car.dS || 0;
    const kbG = U.lerp(D.kbTurnGOff, D.kbTurnG, U.smooth(0.3, 0.9, ctl.throttle || 0) + (car.dS || 0) - U.smooth(0.3, 0.9, ctl.throttle || 0) * (car.dS || 0));   // (off the throttle the tyres grip harder: the keys ask for more)
    const grip = Math.atan(D.L * kbG * 9.81 / Math.max(u * u, 1)) + D.aPk * U.lerp(0.5, 0.3, U.smooth(20, 36, u));
    const reach = Math.min(D.lock * 0.78, grip) * (settings.kbSens || 1);
    const gripT = t * reach;
    // (throttle help: how much wheelspin to allow - with a turn held: enough to kick the rear out, and at walking
    //  pace plenty, so W + a turn from a standstill spins it round in donuts; drifting: enough to keep it going)
    let slipT = Math.abs(t) > 0.1 ? U.lerp(2, 0.3, U.smooth(3, 9, u)) : 0.12;
    const driftT = t * D.dSteerSpan;                                   // (drifting: the key IS the steering input the drift control reads)
    if (this.slideF > 0) slipT = U.lerp(2, 0.6, U.smooth(6, 12, u));   // (drifting: enough wheelspin to keep it going - at donut speeds, lots)
    car.kbSlipT = slipT;
    target = U.clamp(U.lerp(gripT, driftT, this.slideF), -D.lock, D.lock);
    car.kbThrottle = true;                                             // (keys can't feather: see the throttle help in driftSub)
    const s0 = this.dSteer ?? car.steer;
    // eased like hands on a wheel (critically damped: starts gently, no overshoot, no snap when a key goes down or up)
    const wn = D.kbHands;
    this.dSteerV = U.clamp((this.dSteerV || 0) + (wn * wn * (target - s0) - 2 * wn * (this.dSteerV || 0)) * dt, -D.kbHandsMax, D.kbHandsMax);
    const s1 = s0 + this.dSteerV * dt;
    this.dSteer = s1;
    car.steer = U.clamp(s1, -D.lock, D.lock);
  };
})();

// ---------- tyre smoke + skid marks (the drift car only; drawn for your own car) ----------
const DriftFx = (() => {
  let scene = null, smoke = [], next = 0, marks = null, mPos = null, mCol = null, mIdx = 0, acc = [0, 0];
  const MAXP = 140, MAXQ = 700, last = [null, null], _w = new THREE.Vector3();
  function init(sc) {
    scene = sc;
    // low-poly puffs like the sky's clouds (same shapes, flat shaded), very see-through
    const geos = [new THREE.IcosahedronGeometry(0.5, 0), new THREE.DodecahedronGeometry(0.5, 0)];
    for (let i = 0; i < MAXP; i++) {
      const s = new THREE.Mesh(geos[i % 2], new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xb8c8d8, emissiveIntensity: 0.55, flatShading: true, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; s.renderOrder = 2; s.frustumCulled = false; scene.add(s);
      smoke.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1, sq: 1, spin: 0 });
    }
    // skid marks: one ring buffer of quads on the road (alpha per vertex, so old marks can be faint)
    const geo = new THREE.BufferGeometry();
    mPos = new Float32Array(MAXQ * 6 * 3); mCol = new Float32Array(MAXQ * 6 * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(mPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(mCol, 4).setUsage(THREE.DynamicDrawUsage));
    marks = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0c0c0d, vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
    marks.frustumCulled = false; marks.renderOrder = 1; scene.add(marks);
  }
  function puff(x, z, vx, vz, k) {
    const p = smoke[next]; next = (next + 1) % MAXP;
    p.life = 0; p.max = 2.2 + Math.random() * 1.4; p.size = 0.6 + Math.random() * 0.4;   // (big, slow, lingering clouds)
    p.vx = vx * 0.18 + (Math.random() - 0.5) * 1.2; p.vz = vz * 0.18 + (Math.random() - 0.5) * 1.2; p.vy = 0.35 + Math.random() * 0.4;
    p.k = k; p.s.position.set(x + (Math.random() - 0.5) * 0.2, 0.25, z + (Math.random() - 0.5) * 0.2); p.s.visible = true;
    p.s.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); p.sq = 0.6 + Math.random() * 0.25; p.spin = (Math.random() - 0.5) * 0.8;
  }
  function mark(i, x, z, k) {
    const l = last[i];
    if (!l || k <= 0) { last[i] = k > 0 ? { x, z, k } : null; return; }
    const dx = x - l.x, dz = z - l.z, d = Math.hypot(dx, dz);
    if (d < 0.25) return;
    if (d > 3) { last[i] = { x, z, k }; return; }                     // (teleported / reset: start a new mark)
    const nx = -dz / d * 0.11, nz = dx / d * 0.11, y = 0.056;   // (just above the road and its lane lines)
    const q = [[l.x - nx, l.z - nz, l.k], [l.x + nx, l.z + nz, l.k], [x + nx, z + nz, k], [x - nx, z - nz, k]];
    const o = mIdx * 6;
    [0, 1, 2, 0, 2, 3].forEach((c, j) => {
      mPos.set([q[c][0], y, q[c][1]], (o + j) * 3);
      mCol.set([1, 1, 1, Math.min(0.6, q[c][2] * 0.6)], (o + j) * 4);
    });
    mIdx = (mIdx + 1) % MAXQ;
    marks.geometry.attributes.position.needsUpdate = true; marks.geometry.attributes.color.needsUpdate = true;
    last[i] = { x, z, k };
  }
  function update(dt, car, vis) {
    if (!scene) return;
    for (const p of smoke) {
      if (!p.s.visible) continue;
      p.life += dt;
      if (p.life >= p.max) { p.s.visible = false; continue; }
      const t = p.life / p.max;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.vx *= Math.exp(-1.5 * dt); p.vz *= Math.exp(-1.5 * dt);
      const sz = p.size + Math.sqrt(t) * 3; p.s.scale.set(sz, sz * p.sq, sz); p.s.rotation.y += p.spin * dt;
      p.s.material.opacity = 0.065 * p.k * Math.min(1, t / 0.1) * Math.pow(1 - t, 1.6);   // (faint: you can always see through it)
    }
    if (!car.drift || dt <= 0) { last[0] = last[1] = null; return; }
    // the rear tyres: how hard they're scrubbing (m/s of slip) -> smoke and black marks
    const k = U.clamp(((car.slipR || 0) - 2.5) / 7, 0, 1), km = U.clamp(((car.slipR || 0) - 1.8) / 4, 0, 1);
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw), vx = car.u * sy + car.v * cy, vz = -car.u * cy + car.v * sy;
    let i = 0;
    vis.root.updateMatrixWorld(true);
    for (const w of vis.wheels) {
      if (w.front) continue;
      w.pivot.getWorldPosition(_w);
      mark(i, _w.x, _w.z, km);
      acc[i] += k * 32 * dt;
      while (acc[i] >= 1) { acc[i] -= 1; puff(_w.x, _w.z, vx, vz, 0.5 + k * 0.5); }
      i++;
    }
  }
  // floating origin (main.js): everything moves with the world
  function shift(dz) {
    if (!scene) return;
    for (const p of smoke) p.s.position.z += dz;
    for (let i = 2; i < mPos.length; i += 3) mPos[i] += dz;
    marks.geometry.attributes.position.needsUpdate = true;
    for (const l of last) if (l) l.z += dz;
  }
  return { init, update, shift };
})();
