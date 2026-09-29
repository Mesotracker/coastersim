import { BuiltTrack, FEET_PER_UNIT, Frame, GRAVITY, METERS_PER_UNIT, MPH_PER_MPS, frameAt, makeFrame } from './track';

export type CoasterMaterial = 'metal' | 'wood' | 'plastic';

export interface SimSettings {
  gravity: number; // multiplier on standard gravity (9.80665 m/s²)
  friction: number; // rolling resistance coefficient
  drag: number; // air drag coefficient
  liftSpeed: number; // chain lift / station speed (m/s)
  launch: number; // launch speed leaving the station (m/s)
  brakeForce: number; // m/s^2
  boostForce: number; // m/s^2
  material?: CoasterMaterial;
  /** Seat/restraint compliance applied only to displayed rider loads. 0 = raw physical G. */
  gForceBuffer?: number;
}

export const DEFAULT_SETTINGS: SimSettings = {
  gravity: 1,
  friction: 0.0065, // polyurethane wheel + bearing rolling resistance under load
  drag: 0.00045, // CdA/(2m), producing quadratic SI acceleration in m/s²
  liftSpeed: 3.2, // ~7.2 mph, representative modern chain-lift speed
  launch: 2.8, // ~6.3 mph station drive-tire dispatch
  brakeForce: 4.5, // ~0.46 G service-brake deceleration
  boostForce: 9.5, // ~0.97 G LSM/LIM launch acceleration
  material: 'metal',
  gForceBuffer: 0, // telemetry defaults to raw, physically calculated rider forces
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

export interface TrackFeasibility {
  status: 'ok' | 'warning' | 'error';
  message: string;
  problemPieceIndex: number | null;
  minSpeedMph: number;
  minSpeedPieceIndex: number | null;
  isRollback: boolean;
}

const f: Frame = makeFrame();

// Coaster wheelsets are a small fraction of total train mass. This is the
// translational share of gravity after accounting for wheel rotational inertia.
const WHEEL_INERTIA_EFFICIENCY = 0.985;

function smoothstep01(v: number) {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
}

/** Smoothly engages brakes/LSMs at section boundaries instead of applying an impossible force step. */
function poweredSectionEnvelope(track: BuiltTrack, frame: Frame): number {
  const range = track.pieceRanges[frame.piece];
  if (!range) return 1;
  const s0 = track.samples[range.start]?.s ?? frame.s;
  const s1 = track.samples[range.end]?.s ?? frame.s;
  const span = Math.max(1, s1 - s0);
  const edge = Math.min(12, span * 0.18);
  return smoothstep01((frame.s - s0) / edge) * smoothstep01((s1 - frame.s) / edge);
}

/**
 * Longitudinal train acceleration in SI units. Both live playback and offline
 * telemetry call this exact function, keeping the predicted and rendered ride
 * numerically consistent at every playback speed.
 */
function longitudinalAcceleration(
  track: BuiltTrack,
  cfg: SimSettings,
  posS: number,
  velV: number,
  out: Frame,
): number {
  frameAt(track, posS, out);
  const g = GRAVITY * cfg.gravity;
  const sinP = Math.sin(out.pitch);
  const cosP = Math.cos(out.pitch);

  // Gravity along the tangent, corrected for wheel rotational inertia.
  let accel = -g * sinP * WHEEL_INERTIA_EFFICIENCY;

  // Aerodynamic drag: a = CdA/(2m) * v², opposing motion.
  accel -= cfg.drag * velV * Math.abs(velV);

  // Rolling resistance rises with the resultant running/guide/upstop wheel load.
  const kappaM = out.kappa / METERS_PER_UNIT;
  const yawRateM = out.yawRate / METERS_PER_UNIT;
  const vv = velV * velV;
  const aNormVert = g * cosP + vv * kappaM;
  const aNormLat = vv * yawRateM;
  const wheelLoad = Math.hypot(aNormVert, aNormLat);
  if (Math.abs(velV) > 0.04 && out.special !== 3) {
    const effectiveLoad = Math.max(g * 0.2, wheelLoad);
    const materialFactor = cfg.material === 'wood' ? 1.45 : cfg.material === 'plastic' ? 0.9 : 1;
    accel -= cfg.friction * materialFactor * effectiveLoad * Math.sign(velV);
  }

  const poweredEnvelope = poweredSectionEnvelope(track, out);
  if (out.special === 1 && velV > 5.5) {
    accel -= cfg.brakeForce * poweredEnvelope;
  } else if (out.special === 2 && velV > -0.5) {
    const pDef = track.pieces?.[out.piece];
    const intensity = pDef?.boostIntensity ?? (pDef?.kind === 'boost' ? pDef.power : 1);
    accel += cfg.boostForce * intensity * poweredEnvelope;
  }

  // Drive tires use proportional control, avoiding a discontinuity at target speed.
  if (posS < STATION_LEN * 0.75 && velV < cfg.launch) {
    accel += Math.max(0, (cfg.launch - velV) * 3.8);
  }

  // Chain dog / anti-rollback control. The clamp in the integrator prevents slip-back.
  if (posS < track.liftEnd && velV < cfg.liftSpeed) {
    accel = Math.max(accel, (cfg.liftSpeed - velV) * 4.5);
  }

  return accel;
}

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
  feasibility: TrackFeasibility;
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
      feasibility: {
        status: 'ok',
        message: 'Ready to analyze track feasibility',
        problemPieceIndex: null,
        minSpeedMph: 0,
        minSpeedPieceIndex: null,
        isRollback: false,
      },
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

  const dt = 1 / 240; // matches live solver: deterministic 240 Hz integration
  const maxSimSteps = 240 * 300; // max 5 minutes simulation cap
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

  const getAccel = (posS: number, velV: number): number =>
    longitudinalAcceleration(track, cfg, posS, velV, tempF);

  let minSpeedAfterLift = Infinity;
  let minSpeedPieceIdx: number | null = null;
  let rollbackDetected = false;
  let rollbackPieceIdx: number | null = null;

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
        if (!rollbackDetected) {
          rollbackDetected = true;
          rollbackPieceIdx = tempF.piece;
        }
        break;
      }
      v = Math.max(v, 0.8);
    }

    if (Math.abs(v) < 0.25 && s > track.liftEnd) {
      stallTimer += dt;
      if (stallTimer > 2.0) {
        stalled = true;
        if (!rollbackDetected) {
          rollbackDetected = true;
          rollbackPieceIdx = tempF.piece;
        }
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

    // Optional seat/restraint compliance; zero reports the raw physical rider load.
    const bufferFactor = Math.max(0, Math.min(0.85, cfg.gForceBuffer ?? 0));
    const vertG = 1.0 + (rawVertG - 1.0) * (1.0 - bufferFactor);
    const latG = rawLatG * (1.0 - bufferFactor);

    const spd = Math.abs(v) * MPH_PER_MPS;
    const heightFt = Math.max(0, (tempF.y - track.groundY) * FEET_PER_UNIT);

    if (spd > maxSpeed) maxSpeed = spd;
    if (vertG > maxG) maxG = vertG;
    if (Math.abs(latG) > maxLat) maxLat = Math.abs(latG);
    if (tempF.special === 3 || vertG < 0.2) airtime += dt;

    if (s > track.liftEnd + 4) {
      if (spd < minSpeedAfterLift) {
        minSpeedAfterLift = spd;
        minSpeedPieceIdx = tempF.piece;
      }
      if (v < -0.3 && !rollbackDetected) {
        rollbackDetected = true;
        rollbackPieceIdx = tempF.piece;
        stalled = true;
        break;
      }
    }

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

  const problemPiece = rollbackPieceIdx ?? (stalled ? tempF.piece : (minSpeedAfterLift < 4.5 ? minSpeedPieceIdx : null));
  const isError = stalled || rollbackDetected || (s < track.length * 0.92);
  const isWarning = !isError && minSpeedAfterLift < 4.5;

  let feasibilityStatus: 'ok' | 'warning' | 'error' = 'ok';
  let feasibilityMessage = '';

  const pieceName = (problemPiece != null && track.pieces && track.pieces[problemPiece])
    ? track.pieces[problemPiece].kind
    : 'slope';

  if (isError) {
    feasibilityStatus = 'error';
    feasibilityMessage = `Rollback Failure at Piece #${(problemPiece ?? 0) + 1} (${pieceName}): Slope hill crest exceeds train kinetic energy`;
  } else if (isWarning) {
    feasibilityStatus = 'warning';
    feasibilityMessage = `Severe Slowdown at Piece #${(problemPiece ?? 0) + 1} (${pieceName}): Speed drops to ${minSpeedAfterLift.toFixed(1)} mph (risk of valleying)`;
  } else {
    feasibilityStatus = 'ok';
    const minMph = isFinite(minSpeedAfterLift) ? minSpeedAfterLift.toFixed(1) : maxSpeed.toFixed(1);
    feasibilityMessage = `Feasibility Nominal • Full circuit cleared • Min speed ${minMph} mph (Piece #${(minSpeedPieceIdx ?? 0) + 1})`;
  }

  const feasibility: TrackFeasibility = {
    status: feasibilityStatus,
    message: feasibilityMessage,
    problemPieceIndex: isError || isWarning ? problemPiece : null,
    minSpeedMph: isFinite(minSpeedAfterLift) ? minSpeedAfterLift : 0,
    minSpeedPieceIndex: minSpeedPieceIdx,
    isRollback: isError,
  };

  return {
    telemetry: pts,
    maxSpeed,
    maxG,
    maxLat,
    totalDuration: runTime,
    airtime,
    stalled,
    feasibility,
  };
}

/**
 * Instantly synchronizes coaster train position, velocity estimate, height, and G-forces.
 */
export function seekSim(
  st: SimState,
  track: BuiltTrack,
  targetS: number,
  cfg?: SimSettings,
  profile: readonly TelemetryPoint[] = st.telemetry,
) {
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

  // Match the deterministic precomputed profile so scrubbing restores time,
  // velocity and force—not merely an energy-based speed guess.
  let matched: TelemetryPoint | null = null;
  if (profile.length > 0) {
    let lo = 0;
    let hi = profile.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (profile[mid].s < clampedS) lo = mid + 1;
      else hi = mid;
    }
    const a = profile[Math.max(0, lo - 1)];
    const b = profile[lo];
    matched = !a || Math.abs(b.s - clampedS) <= Math.abs(a.s - clampedS) ? b : a;
    if (Math.abs(matched.s - clampedS) > 30) matched = null;
  }

  if (matched) {
    st.speed = matched.speed;
    st.v = matched.speed / MPH_PER_MPS;
    st.runTime = matched.t;
    st.g = matched.g;
    st.lat = matched.lat ?? 0;
    st.height = matched.height;
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

  if (!matched) {
    const kappaM = f.kappa / METERS_PER_UNIT;
    const yawRateM = f.yawRate / METERS_PER_UNIT;
    const vv = st.v * st.v;
    const g = GRAVITY * (cfg?.gravity ?? 1);
    const aNormVert = g * Math.cos(f.pitch) + vv * kappaM;
    const aNormLat = vv * yawRateM;
    const cosB = Math.cos(f.bank);
    const sinB = Math.sin(f.bank);
    const rawG = (aNormVert * cosB + aNormLat * sinB) / g;
    const rawLat = (aNormLat * cosB - aNormVert * sinB) / g;
    const compliance = Math.max(0, Math.min(0.85, cfg?.gForceBuffer ?? 0));
    st.g = 1 + (rawG - 1) * (1 - compliance);
    st.lat = rawLat * (1 - compliance);
  }

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
  const sub = Math.max(1, Math.min(120, Math.ceil(dt / (1 / 240))));
  const h = dt / sub;

  const calcAccel = (posS: number, velV: number): number =>
    longitudinalAcceleration(track, cfg, posS, velV, f);

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

  // Optional seat/restraint compliance; zero reports the raw physical rider load.
  const bufferFactor = Math.max(0, Math.min(0.85, cfg.gForceBuffer ?? 0));
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
