import { BuiltTrack, FEET_PER_UNIT, Frame, GRAVITY, METERS_PER_UNIT, MPH_PER_MPS, frameAt, makeFrame } from './track';

export type CoasterMaterial = 'metal' | 'wood' | 'plastic';

export interface SimSettings {
  gravity: number; // multiplier on 9.81
  friction: number; // rolling resistance coefficient
  drag: number; // air drag coefficient
  liftSpeed: number; // chain lift / station speed (m/s)
  launch: number; // launch speed leaving the station (m/s)
  brakeForce: number; // m/s^2
  boostForce: number; // m/s^2
  material?: CoasterMaterial;
  gForceBuffer?: number; // 0.0 to 0.8: softens felt passenger G-forces without altering train velocity
}

export const DEFAULT_SETTINGS: SimSettings = {
  gravity: 1,
  friction: 0.0065, // realistic steel wheels on tubular rails (with wheel rolling drag)
  drag: 0.00045, // realistic aerodynamic drag profile for train
  liftSpeed: 5.5, // ~12.3 mph chain lift speed
  launch: 7.5, // ~16.8 mph station dispatch drive
  brakeForce: 7.5, // ~0.76 G deceleration
  boostForce: 13, // ~1.33 G linear induction motor boost
  material: 'metal',
  gForceBuffer: 0.25, // 25% G-force dampener (softens spikes without reducing speed)
};

export type Phase = 'station' | 'riding' | 'finished';

export interface TelemetryPoint {
  t: number; // time in seconds from dispatch
  speed: number; // speed in mph
  g: number; // vertical G-force
  lat?: number; // lateral G-force
  height: number; // elevation in feet
  s: number; // track distance
}

export interface SimState {
  s: number;
  v: number;
  phase: Phase;
  timer: number;
  g: number;
  lat: number;
  speed: number; // imperial: mph
  height: number; // imperial: feet
  runTime: number;
  airtime: number;
  maxSpeed: number; // imperial: mph
  maxG: number;
  laps: number;
  event: string;
  eventT: number;
  shake: number;
  telemetry: TelemetryPoint[];
  lastTelemetryT: number;
}

export const STATION_LEN = 38;

export function makeSim(): SimState {
  return {
    s: 0,
    v: 0,
    phase: 'station',
    timer: 0,
    g: 1,
    lat: 0,
    speed: 0,
    height: 0,
    runTime: 0,
    airtime: 0,
    maxSpeed: 0,
    maxG: 1,
    laps: 0,
    event: 'Dispatching…',
    eventT: 0,
    shake: 0,
    telemetry: [],
    lastTelemetryT: 0,
  };
}

export function resetSim(st: SimState) {
  st.s = 0;
  st.v = 0;
  st.phase = 'station';
  st.timer = 0;
  st.runTime = 0;
  st.airtime = 0;
  st.maxSpeed = 0;
  st.maxG = 1;
  st.g = 1;
  st.lat = 0;
  st.speed = 0;
  st.event = 'Dispatching…';
  st.eventT = 1.2;
  st.shake = 0;
  st.telemetry = [];
  st.lastTelemetryT = 0;
}

const f: Frame = makeFrame();

/**
 * Precomputes the entire ride speed profile and telemetry ahead of time.
 * Runs deterministic simulation along the built track from station rollout to final brake run.
 */
export function precomputeFullRideTelemetry(
  track: BuiltTrack,
  cfg: SimSettings,
): {
  telemetry: TelemetryPoint[];
  maxSpeed: number;
  maxG: number;
  maxLat: number;
  totalDuration: number;
  airtime: number;
  stalled: boolean;
} {
  if (!track || track.length < 8) {
    return {
      telemetry: [],
      maxSpeed: 0,
      maxG: 1,
      maxLat: 0,
      totalDuration: 0,
      airtime: 0,
      stalled: false,
    };
  }

  const g = GRAVITY * cfg.gravity;
  const tempF: Frame = makeFrame();
  const pts: TelemetryPoint[] = [];

  let s = 0;
  let v = 1.5; // Initial station dispatch speed (m/s)
  let runTime = 0;
  let maxSpeed = 0;
  let maxG = 1;
  let maxLat = 0;
  let airtime = 0;
  let lastSampleT = -1;
  let stallTimer = 0;
  let stalled = false;

  const dt = 1 / 120; // 120Hz high-precision integration step
  const maxSimSteps = 120 * 300; // max 5 minutes simulation cap
  let step = 0;

  // Initial station point
  frameAt(track, 0, tempF);
  const startH = Math.max(0, (tempF.y - track.groundY) * FEET_PER_UNIT);
  pts.push({
    t: 0,
    speed: Math.round(v * MPH_PER_MPS * 10) / 10,
    g: 1,
    lat: 0,
    height: Math.round(startH),
    s: 0,
  });

  const getAccel = (posS: number, velV: number): number => {
    frameAt(track, posS, tempF);
    const sinP = Math.sin(tempF.pitch);
    const cosP = Math.cos(tempF.pitch);

    // Mechanical wheel rotational inertia factor: ~0.94 of gravitational acceleration converts to linear track speed
    let accel = -g * sinP * 0.94;
    accel -= cfg.drag * velV * Math.abs(velV);

    const kappaM = tempF.kappa / METERS_PER_UNIT;
    const yawRateM = tempF.yawRate / METERS_PER_UNIT;
    const vv = velV * velV;
    const aNormVert = g * cosP + vv * kappaM;
    const aNormLat = vv * yawRateM;
    const aNormTotal = Math.sqrt(aNormVert * aNormVert + aNormLat * aNormLat);

    if (Math.abs(velV) > 0.04) {
      if (tempF.special !== 3) {
        const effLoad = Math.max(g * 0.2, aNormTotal);
        const matMult = cfg.material === 'wood' ? 1.45 : cfg.material === 'plastic' ? 0.9 : 1.0;
        accel -= cfg.friction * matMult * effLoad * Math.sign(velV);
      }
    }

    if (tempF.special === 1) {
      // Trim brakes
      if (velV > 5.5) accel -= cfg.brakeForce;
    } else if (tempF.special === 2 && velV > -0.5) {
      // Boost
      accel += cfg.boostForce;
    }

    if (posS < STATION_LEN * 0.75 && velV < cfg.launch) {
      accel += Math.max(0, (cfg.launch - velV) * 3.8);
    }

    if (posS < track.liftEnd && velV < cfg.liftSpeed) {
      accel = Math.max(accel, (cfg.liftSpeed - velV) * 4.5);
    }

    return accel;
  };

  while (s < track.length && step < maxSimSteps) {
    step++;
    runTime += dt;

    // Midpoint Runge-Kutta
    const a1 = getAccel(s, v);
    const midS = Math.max(0, Math.min(track.length, s + (0.5 * v * dt) / METERS_PER_UNIT));
    const midV = v + 0.5 * a1 * dt;
    const a2 = getAccel(midS, midV);

    if (s < track.liftEnd && v < cfg.liftSpeed && a2 < 0) {
      v = Math.min(cfg.liftSpeed, v + 8 * dt);
    } else {
      v += a2 * dt;
    }

    v = Math.max(-250, Math.min(800, v));
    s += (v * dt) / METERS_PER_UNIT;

    if (s <= 0) {
      s = 0;
      if (v < -0.5) {
        stalled = true;
        break;
      }
      v = Math.max(v, 0.8);
    }

    if (Math.abs(v) < 0.25 && s > track.liftEnd) {
      stallTimer += dt;
      if (stallTimer > 2.0) {
        stalled = true;
        break;
      }
    } else {
      stallTimer = 0;
    }

    frameAt(track, Math.min(track.length, s), tempF);
    const kappaM = tempF.kappa / METERS_PER_UNIT;
    const yawRateM = tempF.yawRate / METERS_PER_UNIT;
    const vv = v * v;
    const aNormVert = g * Math.cos(tempF.pitch) + vv * kappaM;
    const aNormLat = vv * yawRateM;
    const cosB = Math.cos(tempF.bank);
    const sinB = Math.sin(tempF.bank);
    
    // Raw physical G-forces before buffering
    const rawVertG = (aNormVert * cosB + aNormLat * sinB) / g;
    const rawLatG = (aNormLat * cosB - aNormVert * sinB) / g;

    // G-Force Buffer: dampens dynamic deviation from 1.0G (comfort dampening without affecting train velocity)
    const bufferFactor = Math.max(0, Math.min(0.85, cfg.gForceBuffer ?? 0.25));
    const vertG = 1.0 + (rawVertG - 1.0) * (1.0 - bufferFactor);
    const latG = rawLatG * (1.0 - bufferFactor);

    const spd = Math.abs(v) * MPH_PER_MPS;
    const heightFt = Math.max(0, (tempF.y - track.groundY) * FEET_PER_UNIT);

    if (spd > maxSpeed) maxSpeed = spd;
    if (vertG > maxG) maxG = vertG;
    if (Math.abs(latG) > maxLat) maxLat = Math.abs(latG);
    if (tempF.special === 3 || vertG < 0.2) airtime += dt;

    // Record telemetry point every 0.08s (~12.5 Hz sample rate)
    if (runTime - lastSampleT >= 0.08 || s >= track.length) {
      lastSampleT = runTime;
      pts.push({
        t: Math.round(runTime * 100) / 100,
        speed: Math.round(spd * 10) / 10,
        g: Math.round(vertG * 100) / 100,
        lat: Math.round(latG * 100) / 100,
        height: Math.round(heightFt),
        s: Math.round(s),
      });
    }
  }

  return {
    telemetry: pts,
    maxSpeed,
    maxG,
    maxLat,
    totalDuration: runTime,
    airtime,
    stalled,
  };
}

/**
 * Instantly synchronizes coaster train position, velocity estimate, height, and G-forces.
 */
export function seekSim(st: SimState, track: BuiltTrack, targetS: number, cfg?: SimSettings) {
  if (track.length <= 0) return;
  const clampedS = Math.max(0, Math.min(track.length, targetS));
  st.s = clampedS;

  frameAt(track, clampedS, f);
  st.height = Math.max(0, (f.y - track.groundY) * FEET_PER_UNIT);

  if (clampedS < 2) {
    st.phase = 'station';
    st.v = 0;
    st.speed = 0;
    st.g = 1;
    st.lat = 0;
    return;
  }

  if (clampedS >= track.length - 0.5) {
    st.phase = 'finished';
    st.v = 2;
    st.speed = 4.5;
    st.g = 1;
    st.lat = 0;
    return;
  }

  st.phase = 'riding';

  // Check if we have a recorded telemetry point near this track distance
  let matchedSpeed: number | null = null;
  if (st.telemetry.length > 0) {
    let bestDist = Infinity;
    for (const pt of st.telemetry) {
      const dist = Math.abs(pt.s - clampedS);
      if (dist < bestDist) {
        bestDist = dist;
        matchedSpeed = pt.speed;
      }
    }
    if (bestDist > 30) matchedSpeed = null;
  }

  if (matchedSpeed !== null) {
    st.speed = matchedSpeed;
    st.v = matchedSpeed / MPH_PER_MPS;
  } else {
    // Lift hill vs drop velocity estimation
    const liftEnd = track.liftEnd;
    const liftSpeed = cfg?.liftSpeed ?? 6;
    if (clampedS < liftEnd) {
      st.v = liftSpeed;
      st.speed = liftSpeed * MPH_PER_MPS;
    } else {
      // Conservation of mechanical energy from peak drop height
      const peakY = track.maxHeight;
      const dropY = Math.max(1, peakY - f.y) * METERS_PER_UNIT;
      const vEst = Math.sqrt(Math.max(16, 2 * GRAVITY * (cfg?.gravity ?? 1) * dropY));
      st.v = Math.min(500, vEst);
      st.speed = st.v * MPH_PER_MPS;
    }
  }

  const kappaM = f.kappa / METERS_PER_UNIT;
  const yawRateM = f.yawRate / METERS_PER_UNIT;
  const vv = st.v * st.v;
  const g = GRAVITY * (cfg?.gravity ?? 1);
  const aNormVert = g * Math.cos(f.pitch) + vv * kappaM;
  const aNormLat = vv * yawRateM;
  const cosB = Math.cos(f.bank);
  const sinB = Math.sin(f.bank);
  st.g = (aNormVert * cosB + aNormLat * sinB) / g;
  st.lat = (aNormLat * cosB - aNormVert * sinB) / g;

  if (st.speed > st.maxSpeed) st.maxSpeed = st.speed;
  if (st.g > st.maxG) st.maxG = st.g;
}

function setEvent(st: SimState, msg: string, dur = 1.6) {
  st.event = msg;
  st.eventT = dur;
}

/** Advance the simulation by dt seconds. Uses Imperial units for all user telemetry. */
export function stepSim(st: SimState, track: BuiltTrack, dt: number, cfg: SimSettings) {
  const g = GRAVITY * cfg.gravity;
  st.eventT = Math.max(0, st.eventT - dt);

  if (track.length < 8) return;

  if (st.phase === 'station') {
    st.timer += dt;
    st.s = 0;
    st.v = 0;
    if (st.timer > 0.8) {
      st.phase = 'riding';
      st.timer = 0;
      st.runTime = 0;
      st.airtime = 0;
      st.maxSpeed = 0;
      st.maxG = 1;
      st.v = 1.5; // Initial station rollout
      st.telemetry = [];
      st.lastTelemetryT = 0;
      setEvent(st, 'Dispatch!', 1.2);
    }
    frameAt(track, 0, f);
    st.height = (f.y - track.groundY) * FEET_PER_UNIT;
    st.speed = 0;
    st.g = 1;
    st.lat = 0;
    return;
  }

  if (st.phase === 'finished') {
    st.timer += dt;
    st.v *= Math.max(0, 1 - dt * 2.8);
    st.speed = Math.abs(st.v) * MPH_PER_MPS;
    if (st.timer > 2.0) {
      st.laps += 1;
      resetSim(st);
    }
    return;
  }

  // ---- riding physics with 240Hz sub-stepping & midpoint integration --------
  // Fixed sub-step for rock-solid stability and deterministic clock timing
  const sub = Math.max(1, Math.min(24, Math.ceil(dt / (1 / 240))));
  const h = dt / sub;

  // Helper to compute acceleration at distance s with velocity v
  const calcAccel = (posS: number, velV: number): number => {
    frameAt(track, posS, f);
    const sinP = Math.sin(f.pitch);
    const cosP = Math.cos(f.pitch);

    // Gravity along track tangent: +pitch = climbing, so -g*sin(pitch)
    // Mechanical wheel rotational inertia factor: ~0.94 of gravitational acceleration converts to linear track speed
    let accel = -g * sinP * 0.94;

    // Aerodynamic quadratic drag: a_drag = -C_drag * v * |v|
    accel -= cfg.drag * velV * Math.abs(velV);

    // Centripetal acceleration in vertical and lateral directions (m/s^2)
    const kappaM = f.kappa / METERS_PER_UNIT;
    const yawRateM = f.yawRate / METERS_PER_UNIT;
    const vv = velV * velV;
    const aNormVert = g * cosP + vv * kappaM;
    const aNormLat = vv * yawRateM;

    // Total wheel contact load on running, guide, and upstop wheels:
    const aNormTotal = Math.sqrt(aNormVert * aNormVert + aNormLat * aNormLat);

    // Rolling resistance: wheel bearing & polyurethane compression
    if (Math.abs(velV) > 0.04) {
      // In mid-air jump flight, rolling contact drops to 0!
      if (f.special === 3) {
        // Pure ballistic glide
      } else {
        // Minimum normal force ensures realistic coasting even at zero-G crest
        const effLoad = Math.max(g * 0.2, aNormTotal);
        const matMult = cfg.material === 'wood' ? 1.45 : cfg.material === 'plastic' ? 0.9 : 1.0;
        accel -= cfg.friction * matMult * effLoad * Math.sign(velV);
      }
    }

    // Special track sections
    if (f.special === 1) {
      // Trim brakes: magnetic eddy-current or friction calipers
      const targetBrakeSpeed = 5.5; // m/s (~12 mph)
      if (velV > targetBrakeSpeed) {
        accel -= cfg.brakeForce;
      }
    } else if (f.special === 2 && velV > -0.5) {
      // Linear induction motor (LSM) launch thrust - uncapped for extreme acceleration
      if (velV < 500) {
        accel += cfg.boostForce;
      }
    }

    // Station dispatch drive tire kicker zone
    if (posS < STATION_LEN * 0.75 && velV < cfg.launch) {
      accel += Math.max(0, (cfg.launch - velV) * 3.8);
    }

    // Mechanical chain lift hill
    if (posS < track.liftEnd) {
      if (velV < cfg.liftSpeed) {
        // Motor dog engagement pushes train steadily up the incline
        accel = Math.max(accel, (cfg.liftSpeed - velV) * 4.5);
      }
    }

    return accel;
  };

  for (let i = 0; i < sub; i++) {
    // 2nd-order Runge-Kutta / Midpoint Integration
    const a1 = calcAccel(st.s, st.v);
    const midS = Math.max(0, Math.min(track.length, st.s + (0.5 * st.v * h) / METERS_PER_UNIT));
    const midV = st.v + 0.5 * a1 * h;
    const a2 = calcAccel(midS, midV);

    // Chain lift clamping (train cannot slip backwards through anti-rollbacks)
    if (st.s < track.liftEnd && st.v < cfg.liftSpeed && a2 < 0) {
      st.v = Math.min(cfg.liftSpeed, st.v + 8 * h);
    } else {
      st.v += a2 * h;
    }

    // Dynamic velocity clamp: allows supersonic/extreme coaster speeds (no 168 mph ceiling)
    st.v = Math.max(-250, Math.min(800, st.v));
    st.s += (st.v * h) / METERS_PER_UNIT;

    if (st.s <= 0) {
      st.s = 0;
      if (st.v < -0.5) {
        setEvent(st, 'Rolled back — needs more speed', 2.4);
        st.phase = 'station';
        st.timer = -0.5;
        st.v = 0;
        return;
      }
      st.v = Math.max(st.v, 0.8);
    }

    if (st.s >= track.length) {
      st.s = track.length;
      st.phase = 'finished';
      st.timer = 0;
      setEvent(st, 'Ride complete!', 2.4);
      break;
    }
  }

  st.runTime += dt;
  frameAt(track, st.s, f);

  // Exact passenger G-force in the car's local banked frame
  const kappaM = f.kappa / METERS_PER_UNIT;
  const yawRateM = f.yawRate / METERS_PER_UNIT;
  const vv = st.v * st.v;
  const aNormVert = g * Math.cos(f.pitch) + vv * kappaM;
  const aNormLat = vv * yawRateM;

  // Passenger seat coordinates: +G pushes into seat; lateral G pushes sideways
  const bank = f.bank;
  const cosB = Math.cos(bank);
  const sinB = Math.sin(bank);
  const rawVertG = (aNormVert * cosB + aNormLat * sinB) / g;
  const rawLatG = (aNormLat * cosB - aNormVert * sinB) / g;

  // G-Force Buffer: dampens dynamic deviation from 1.0G (comfort dampening without affecting train velocity)
  const bufferFactor = Math.max(0, Math.min(0.85, cfg.gForceBuffer ?? 0.25));
  st.g = 1.0 + (rawVertG - 1.0) * (1.0 - bufferFactor);
  st.lat = rawLatG * (1.0 - bufferFactor);

  // Imperial speed in mph
  st.speed = Math.abs(st.v) * MPH_PER_MPS;
  // Imperial height in feet
  st.height = Math.max(0, (f.y - track.groundY) * FEET_PER_UNIT);

  if (st.speed > st.maxSpeed) st.maxSpeed = st.speed;
  if (st.g > st.maxG) st.maxG = st.g;

  // Airtime detection (< 0.2G) & Jump Leap
  if (f.special === 3 && st.phase === 'riding') {
    st.airtime += dt;
    if (st.eventT <= 0.25 || st.event !== 'MID-AIR JUMP! 🚀') {
      setEvent(st, 'MID-AIR JUMP! 🚀', 1.0);
    }
  } else if (st.g < 0.2 && st.phase === 'riding') {
    st.airtime += dt;
    if (st.eventT <= 0 && st.g < 0.05 && st.speed > 16) {
      setEvent(st, 'AIRTIME!', 0.9);
    }
  }

  // Record telemetry point for the speed graph over time (smooth ~12 Hz sampling)
  if (st.phase === 'riding' && st.runTime - st.lastTelemetryT >= 0.08) {
    st.lastTelemetryT = st.runTime;
    st.telemetry.push({
      t: Math.round(st.runTime * 100) / 100,
      speed: Math.round(st.speed * 10) / 10,
      g: Math.round(st.g * 100) / 100,
      lat: Math.round(st.lat * 100) / 100,
      height: Math.round(st.height),
      s: Math.round(st.s),
    });
    if (st.telemetry.length > 1500) st.telemetry.shift();
  }

  // Stall detection
  if (Math.abs(st.v) < 0.25 && st.s > track.liftEnd) {
    st.timer += dt;
    if (st.timer > 1.8) {
      setEvent(st, 'Train stalled — returning to station', 2.6);
      st.phase = 'station';
      st.timer = -0.8;
      st.s = 0;
      st.v = 0;
    }
  } else {
    st.timer = 0;
  }

  // High-frequency harmonic vibration intensity (realistic rail chatter at high speed & load)
  const matShakeFactor = cfg.material === 'wood' ? 1.65 : cfg.material === 'plastic' ? 0.55 : 1.0;
  const speedRatio = Math.max(0, (st.speed - 25) / 55);
  const gRatio = Math.max(0, Math.abs(st.g - 1) - 1.2) * 0.15;
  const baseShake = Math.min(1, speedRatio * 0.85 + gRatio) * matShakeFactor;
  // While airborne in mid-air jump, track contact vibration drops to near-zero!
  const targetShake = f.special === 3 ? 0.03 : baseShake;
  st.shake += (targetShake - st.shake) * Math.min(1, dt * 5);
}
