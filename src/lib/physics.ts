import { BuiltTrack, FEET_PER_UNIT, Frame, GRAVITY, METERS_PER_UNIT, MPH_PER_MPS, frameAt, makeFrame } from './track';

export interface SimSettings {
  gravity: number; // multiplier on 9.81
  friction: number; // rolling resistance coefficient
  drag: number; // air drag coefficient
  liftSpeed: number; // chain lift / station speed (m/s)
  launch: number; // launch speed leaving the station (m/s)
  brakeForce: number; // m/s^2
  boostForce: number; // m/s^2
}

export const DEFAULT_SETTINGS: SimSettings = {
  gravity: 1,
  friction: 0.008,
  drag: 0.0006,
  liftSpeed: 10,
  launch: 8,
  brakeForce: 9,
  boostForce: 16,
};

export type Phase = 'station' | 'riding' | 'finished';

export interface TelemetryPoint {
  t: number; // time in seconds from dispatch
  speed: number; // speed in mph
  g: number; // vertical G-force
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
    if (st.timer > 1.0) {
      st.phase = 'riding';
      st.timer = 0;
      st.runTime = 0;
      st.airtime = 0;
      st.maxSpeed = 0;
      st.maxG = 1;
      st.v = Math.max(1, cfg.launch);
      st.telemetry = [];
      st.lastTelemetryT = 0;
      setEvent(st, 'Dispatch!', 1.1);
    }
    frameAt(track, 0, f);
    st.height = (f.y - track.groundY) * FEET_PER_UNIT;
    st.speed = 0;
    st.g = 1;
    return;
  }

  if (st.phase === 'finished') {
    st.timer += dt;
    st.v *= Math.max(0, 1 - dt * 2.4);
    st.speed = Math.abs(st.v) * MPH_PER_MPS;
    if (st.timer > 2.2) {
      st.laps += 1;
      resetSim(st);
    }
    return;
  }

  // ---- riding physics -----------------------------------------------------
  const sub = Math.max(1, Math.min(16, Math.ceil(dt / (1 / 240))));
  const h = dt / sub;
  for (let i = 0; i < sub; i++) {
    frameAt(track, st.s, f);
    const sinP = Math.sin(f.pitch);
    const cosP = Math.cos(f.pitch);

    let a = -g * sinP;
    a -= cfg.drag * st.v * Math.abs(st.v);
    if (Math.abs(st.v) > 0.05) {
      a -= cfg.friction * g * Math.abs(cosP) * Math.sign(st.v);
    }

    if (f.special === 1) {
      // trim brakes
      const target = 6;
      if (st.v > target) a -= cfg.brakeForce;
    } else if (f.special === 2 && st.v > -0.5) {
      if (st.v < 45) a += cfg.boostForce;
    }

    // chain lift / station launch section
    if (st.s < track.liftEnd && st.v < cfg.liftSpeed) {
      st.v = cfg.liftSpeed;
      a = Math.max(a, 0);
    }

    st.v += a * h;
    st.v = Math.max(-45, Math.min(65, st.v));
    st.s += (st.v * h) / METERS_PER_UNIT;

    if (st.s <= 0) {
      st.s = 0;
      if (st.v < -0.5) {
        setEvent(st, 'Rolled back — needs more speed', 2.4);
        st.phase = 'station';
        st.timer = -0.6;
        st.v = 0;
        return;
      }
      st.v = Math.max(st.v, 0.5);
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
  const vv = st.v * st.v;
  st.g = Math.cos(f.pitch) + (vv * f.kappa) / (METERS_PER_UNIT * g);
  st.lat = (vv * f.yawRate) / (METERS_PER_UNIT * g);
  // Imperial speed in mph
  st.speed = Math.abs(st.v) * MPH_PER_MPS;
  // Imperial height in feet
  st.height = Math.max(0, (f.y - track.groundY) * FEET_PER_UNIT);

  if (st.speed > st.maxSpeed) st.maxSpeed = st.speed;
  if (st.g > st.maxG) st.maxG = st.g;
  if (st.g < 0.25 && st.phase === 'riding') {
    st.airtime += dt;
    if (st.eventT <= 0 && st.g < 0.05 && st.speed > 18) setEvent(st, 'AIRTIME!', 0.9);
  }

  // Record telemetry point for the speed graph over time (every ~0.08 seconds)
  if (st.phase === 'riding' && st.runTime - st.lastTelemetryT >= 0.08) {
    st.lastTelemetryT = st.runTime;
    st.telemetry.push({
      t: Math.round(st.runTime * 100) / 100,
      speed: Math.round(st.speed * 10) / 10,
      g: Math.round(st.g * 100) / 100,
      height: Math.round(st.height),
      s: Math.round(st.s),
    });
    // Keep reasonable history buffer (e.g. up to 1500 points = ~2 minutes of ride)
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

  const target = Math.max(0, (st.speed - 30) / 60) + Math.max(0, Math.abs(st.g) - 2.2) * 0.12;
  st.shake += (Math.min(1, target) - st.shake) * Math.min(1, dt * 4);
}
