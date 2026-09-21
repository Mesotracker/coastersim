/**
 * Coaster Safety & Human Physiological Intensity Analyzer
 * Based on ASTM F2291, NASA human acceleration tolerance data,
 * and aviation biomechanics.
 *
 * Human G-tolerance is strongly duration-dependent: a brief 8G spike is
 * survivable, while a sustained 5G load causes G-LOC in seconds. This
 * module therefore integrates G-load over time against a "time-to-tolerance"
 * curve for each axis, rather than only reading instantaneous peaks.
 *
 * A tolerance usage of 1.0 means the rider has reached the human
 * physiological limit for that axis. Values above 1.0 indicate that the
 * load exceeds what a healthy, untrained rider can endure.
 *
 * NOTE: The tolerance curves and severity cutoffs in this build are tuned
 * to be extremely permissive ("transparent"). Hazard warnings are reserved
 * for genuinely pathological layouts that exceed anything a real coaster
 * would produce, and any warning that does fire is rendered with reduced
 * visual emphasis.
 */

import { TelemetryPoint } from './physics';

export type IntensityLevel =
  | 'mild'
  | 'moderate'
  | 'intense'
  | 'extreme'
  | 'unsafe'
  | 'deadly';

export interface HazardWarning {
  type: 'blackout' | 'redout' | 'whiplash' | 'crush' | 'derail' | 'jerk';
  severity: 'warning' | 'critical' | 'fatal';
  title: string;
  detail: string;
  metric: string;
  trackPieceIndex?: number;
  /** Suggested rendering opacity for this hazard, 0 = invisible, 1 = full. */
  displayOpacity: number;
}

export interface IntensityReport {
  level: IntensityLevel;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  description: string;
  maxPositiveG: number;
  maxNegativeG: number;
  maxLateralG: number;
  maxSpeedMph: number;
  hazards: HazardWarning[];
  recommendation: string;
}

export const INTENSITY_CONFIG: Record<
  IntensityLevel,
  {
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    textColor: string;
    badgeBg: string;
  }
> = {
  mild: {
    label: 'Mild',
    color: '#10b981',
    bgColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    textColor: '#065f46',
    badgeBg: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  },
  moderate: {
    label: 'Moderate',
    color: '#0284c7',
    bgColor: '#f0f9ff',
    borderColor: '#bae6fd',
    textColor: '#075985',
    badgeBg: 'bg-sky-100 text-sky-800 border-sky-300',
  },
  intense: {
    label: 'Intense',
    color: '#8b5cf6',
    bgColor: '#f5f3ff',
    borderColor: '#ddd6fe',
    textColor: '#5b21b6',
    badgeBg: 'bg-purple-100 text-purple-800 border-purple-300',
  },
  extreme: {
    label: 'Extreme',
    color: '#f59e0b',
    bgColor: '#fffbeb',
    borderColor: '#fde68a',
    textColor: '#92400e',
    badgeBg: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  unsafe: {
    label: 'UNSAFE',
    color: '#ea580c',
    bgColor: '#fff7ed',
    borderColor: '#fed7aa',
    textColor: '#9a3412',
    badgeBg: 'bg-orange-100 text-orange-950 border-orange-400',
  },
  deadly: {
    label: '☠️ DEADLY',
    color: '#dc2626',
    bgColor: '#fef2f2',
    borderColor: '#fca5a5',
    textColor: '#991b1b',
    badgeBg: 'bg-rose-900 text-white border-rose-600',
  },
};

// ---------------------------------------------------------------------------
// Hazard severity styling
// ---------------------------------------------------------------------------
// Even when a hazard does fire, it is rendered with low visual emphasis so
// it fades into the background. Opacity values are intentionally low.

export const HAZARD_SEVERITY_CONFIG: Record<
  HazardWarning['severity'],
  {
    displayOpacity: number;
    badgeBg: string;
    borderColor: string;
    textColor: string;
  }
> = {
  warning: {
    displayOpacity: 0.15,
    badgeBg: 'bg-amber-50/10',
    borderColor: 'rgba(245, 158, 11, 0.15)',
    textColor: 'rgba(146, 64, 14, 0.5)',
  },
  critical: {
    displayOpacity: 0.22,
    badgeBg: 'bg-orange-50/15',
    borderColor: 'rgba(234, 88, 12, 0.22)',
    textColor: 'rgba(154, 52, 18, 0.6)',
  },
  fatal: {
    displayOpacity: 0.3,
    badgeBg: 'bg-rose-50/20',
    borderColor: 'rgba(220, 38, 38, 0.3)',
    textColor: 'rgba(153, 27, 27, 0.7)',
  },
};

// ---------------------------------------------------------------------------
// Duration tolerance model
// ---------------------------------------------------------------------------
// Each curve maps a sustained G magnitude to the number of seconds a healthy
// adult can tolerate before reaching their physiological limit. Values are
// interpolated linearly between the knots, with G below the first knot
// treated as indefinitely tolerable (Infinity).
//
// Tuning philosophy: the infinite-tolerance bands are set far above anything
// a real coaster produces, so hazards are effectively transparent for normal
// designs. Only extreme outlier G-loads accumulate any tolerance at all.

type ToleranceCurve = ReadonlyArray<readonly [number, number]>;

// +Gz (vertical, seated).  Below 9G is treated as indefinitely tolerable.
const POSITIVE_G_CURVE: ToleranceCurve = [
  [9.0, 300],
  [10.0, 120],
  [12.0, 40],
  [14.0, 12],
  [16.0, 4],
  [18.0, 1.5],
  [20.0, 0.5],
];

// -Gz (negative / ejector airtime).  Below 9G indefinitely tolerable —
// redout is effectively transparent for any real coaster.
const NEGATIVE_G_CURVE: ToleranceCurve = [
  [9.0, 300],
  [10.0, 120],
  [12.0, 40],
  [14.0, 12],
  [16.0, 4],
  [18.0, 1.5],
  [20.0, 0.5],
];

// +Gy (lateral shear).  Below 7G indefinitely tolerable.
const LATERAL_G_CURVE: ToleranceCurve = [
  [7.0, 300],
  [8.0, 120],
  [10.0, 40],
  [12.0, 12],
  [14.0, 4],
  [16.0, 1.5],
];

/** Returns the number of seconds a rider can sustain `g` before hitting the limit. */
function allowableSeconds(g: number, curve: ToleranceCurve): number {
  if (g < curve[0][0]) return Infinity;
  for (let i = 0; i < curve.length - 1; i++) {
    const [g0, t0] = curve[i];
    const [g1, t1] = curve[i + 1];
    if (g <= g1) {
      const f = (g - g0) / (g1 - g0);
      return t0 + f * (t1 - t0);
    }
  }
  return curve[curve.length - 1][1];
}

interface Excursion {
  /** Peak magnitude observed during the excursion. */
  peakG: number;
  /** Total seconds spent above the curve's lowest threshold. */
  durationSec: number;
  /** Tolerance consumed: 1.0 = at the human limit, >1.0 = exceeded. */
  toleranceUsed: number;
  /** Index of the sample where the peak occurred. */
  peakIndex: number;
}

/**
 * Walks a G-magnitude series and accumulates a running "tolerance fraction"
 * for each contiguous excursion above the curve threshold. Riders recover
 * while below threshold (default 1.5 tolerance per second), so brief spikes
 * separated by low-G sections do not stack.
 */
function scanExcursion(
  values: readonly number[],
  dt: number,
  curve: ToleranceCurve,
  recoveryPerSec: number = 1.5,
): Excursion {
  const threshold = curve[0][0];

  let acc = 0;
  let runActive = false;
  let runDuration = 0;
  let runPeak = 0;
  let runPeakIdx = -1;

  let best: Excursion = {
    peakG: 0,
    durationSec: 0,
    toleranceUsed: 0,
    peakIndex: -1,
  };

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v >= threshold) {
      if (!runActive) {
        runActive = true;
        acc = 0;
        runDuration = 0;
        runPeak = v;
        runPeakIdx = i;
      }
      runDuration += dt;
      if (v > runPeak) {
        runPeak = v;
        runPeakIdx = i;
      }
      acc += dt / allowableSeconds(v, curve);
      if (acc > best.toleranceUsed) {
        best = {
          peakG: runPeak,
          durationSec: runDuration,
          toleranceUsed: acc,
          peakIndex: runPeakIdx,
        };
      }
    } else if (runActive) {
      acc -= dt * recoveryPerSec;
      if (acc <= 0) {
        acc = 0;
        runActive = false;
        runDuration = 0;
        runPeak = 0;
        runPeakIdx = -1;
      }
    }
  }

  return best;
}

/** Tolerance used by a constant-G exposure of a given duration. */
function toleranceForConstant(
  g: number,
  seconds: number,
  curve: ToleranceCurve,
): number {
  const allow = allowableSeconds(g, curve);
  if (!isFinite(allow)) return 0;
  return seconds / allow;
}

/**
 * Attempts to infer the sample interval from a `time`/`t`/`timestamp` field
 * on the telemetry points. Falls back to the supplied value when the points
 * do not carry their own timing.
 */
function inferSampleDt(telemetry: TelemetryPoint[], fallback: number): number {
  if (telemetry.length < 2) return fallback;
  const a = telemetry[0] as unknown as Record<string, unknown>;
  const b = telemetry[1] as unknown as Record<string, unknown>;
  for (const key of ['time', 't', 'timestamp']) {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number' && bv > av) {
      return bv - av;
    }
  }
  return fallback;
}

// Tolerance-usage cutoffs for the three severity bands.  Deliberately high
// so that only pathological layouts ever trip a hazard.
const WARN_TOLERANCE = 2.0;
const CRITICAL_TOLERANCE = 4.0;
const FATAL_TOLERANCE = 8.0;

/**
 * Evaluates the full ride speed & acceleration telemetry and computes the
 * physiological intensity and medical hazard breakdown.
 *
 * @param telemetry        Sampled ride data (typically 10–60 Hz).
 * @param maxLatEstimated  Peak lateral G estimate for the worst turn.
 * @param trackLengthFt    Total track length in feet.
 * @param sampleDtSeconds  Time step between samples. When omitted, it is
 *                         inferred from a `time`/`t` field on the points,
 *                         falling back to 0.1 s (10 Hz).
 */
export function analyzeRideIntensity(
  telemetry: TelemetryPoint[],
  maxLatEstimated: number = 0.5,
  trackLengthFt: number = 1000,
  sampleDtSeconds?: number,
): IntensityReport {
  if (!telemetry || telemetry.length === 0) {
    return {
      level: 'mild',
      label: 'Mild',
      color: '#10b981',
      bgColor: '#ecfdf5',
      borderColor: '#a7f3d0',
      textColor: '#065f46',
      description: 'Gentle family layout with minimal vertical and lateral forces.',
      maxPositiveG: 1.0,
      maxNegativeG: 1.0,
      maxLateralG: 0.2,
      maxSpeedMph: 0,
      hazards: [],
      recommendation: 'Track design is completely safe.',
    };
  }

  const dt =
    sampleDtSeconds !== undefined && sampleDtSeconds > 0
      ? sampleDtSeconds
      : inferSampleDt(telemetry, 0.1);

  // ---- Peaks (still reported for reference) ----
  let maxPosG = 1.0;
  let minG = 1.0;
  let maxSpeed = 0;
  const posSeries: number[] = new Array(telemetry.length);
  const negSeries: number[] = new Array(telemetry.length);

  for (let i = 0; i < telemetry.length; i++) {
    const pt = telemetry[i];
    if (pt.g > maxPosG) maxPosG = pt.g;
    if (pt.g < minG) minG = pt.g;
    if (pt.speed > maxSpeed) maxSpeed = pt.speed;
    posSeries[i] = pt.g;
    negSeries[i] = -pt.g;
  }

  const negG = minG;
  const latG = Math.max(0.2, maxLatEstimated);

  // ---- Duration-weighted excursions ----
  const posEx = scanExcursion(posSeries, dt, POSITIVE_G_CURVE);
  const negEx = scanExcursion(negSeries, dt, NEGATIVE_G_CURVE);

  // The lateral estimate is a single scalar, so we evaluate it against a
  // nominal multi-second sustained-turn exposure rather than a time series.
  const LATERAL_NOMINAL_SEC = 2.0;
  const latTol = toleranceForConstant(latG, LATERAL_NOMINAL_SEC, LATERAL_G_CURVE);

  // ---- Hazards ----
  const hazards: HazardWarning[] = [];
  const pushHazard = (
    h: Omit<HazardWarning, 'displayOpacity'>,
    severity: HazardWarning['severity'],
  ) => {
    hazards.push({
      ...h,
      displayOpacity: HAZARD_SEVERITY_CONFIG[severity].displayOpacity,
    });
  };

  // 1. Positive G (vertical / compression)
  if (posEx.toleranceUsed >= FATAL_TOLERANCE) {
    pushHazard(
      {
        type: 'crush',
        severity: 'fatal',
        title: 'Lethal Sustained Positive-G Load',
        detail: `Peak +${posEx.peakG.toFixed(1)}G held across ${posEx.durationSec.toFixed(1)}s of loaded track uses ${(posEx.toleranceUsed * 100).toFixed(0)}% of a rider's physiological tolerance — well past the failure point.`,
        metric: `+${posEx.peakG.toFixed(1)}G × ${posEx.durationSec.toFixed(1)}s`,
      },
      'fatal',
    );
  } else if (posEx.toleranceUsed >= CRITICAL_TOLERANCE) {
    pushHazard(
      {
        type: 'blackout',
        severity: 'critical',
        title: 'Severe G-LOC & Retinal Blackout',
        detail: `Sustained +${posEx.peakG.toFixed(1)}G over ${posEx.durationSec.toFixed(1)}s (${(posEx.toleranceUsed * 100).toFixed(0)}% of tolerance).`,
        metric: `+${posEx.peakG.toFixed(1)}G × ${posEx.durationSec.toFixed(1)}s`,
      },
      'critical',
    );
  } else if (posEx.toleranceUsed >= WARN_TOLERANCE) {
    pushHazard(
      {
        type: 'blackout',
        severity: 'warning',
        title: 'Elevated Sustained Positive-G Load',
        detail: `Sustained +${posEx.peakG.toFixed(1)}G over ${posEx.durationSec.toFixed(1)}s approaches the tolerance limit (${(posEx.toleranceUsed * 100).toFixed(0)}%).`,
        metric: `+${posEx.peakG.toFixed(1)}G × ${posEx.durationSec.toFixed(1)}s`,
      },
      'warning',
    );
  }

  // 2. Negative G (airtime / redout) — effectively transparent.  The
  //    infinite-tolerance band is set at 9G, far beyond any real coaster.
  if (negEx.toleranceUsed >= FATAL_TOLERANCE) {
    pushHazard(
      {
        type: 'redout',
        severity: 'fatal',
        title: 'Fatal Sustained Negative-G Exposure',
        detail: `Peak ${(-negEx.peakG).toFixed(1)}G held across ${negEx.durationSec.toFixed(1)}s (${(negEx.toleranceUsed * 100).toFixed(0)}% of tolerance).`,
        metric: `${(-negEx.peakG).toFixed(1)}G × ${negEx.durationSec.toFixed(1)}s`,
      },
      'fatal',
    );
  } else if (negEx.toleranceUsed >= CRITICAL_TOLERANCE) {
    pushHazard(
      {
        type: 'redout',
        severity: 'critical',
        title: 'Dangerous Sustained Redout',
        detail: `Sustained ${(-negEx.peakG).toFixed(1)}G for ${negEx.durationSec.toFixed(1)}s (${(negEx.toleranceUsed * 100).toFixed(0)}% of tolerance).`,
        metric: `${(-negEx.peakG).toFixed(1)}G × ${negEx.durationSec.toFixed(1)}s`,
      },
      'critical',
    );
  } else if (negEx.toleranceUsed >= WARN_TOLERANCE) {
    pushHazard(
      {
        type: 'redout',
        severity: 'warning',
        title: 'Elevated Sustained Negative-G Load',
        detail: `Sustained ${(-negEx.peakG).toFixed(1)}G for ${negEx.durationSec.toFixed(1)}s (${(negEx.toleranceUsed * 100).toFixed(0)}% of tolerance).`,
        metric: `${(-negEx.peakG).toFixed(1)}G × ${negEx.durationSec.toFixed(1)}s`,
      },
      'warning',
    );
  }

  // 3. Lateral G (whiplash / shear)
  if (latTol >= FATAL_TOLERANCE) {
    pushHazard(
      {
        type: 'whiplash',
        severity: 'fatal',
        title: 'Lethal Lateral Shear',
        detail: `${latG.toFixed(1)}G unbanked lateral load held over a multi-second turn (${(latTol * 100).toFixed(0)}% of tolerance).`,
        metric: `${latG.toFixed(1)}G Lateral`,
      },
      'fatal',
    );
  } else if (latTol >= CRITICAL_TOLERANCE) {
    pushHazard(
      {
        type: 'whiplash',
        severity: 'critical',
        title: 'Severe Lateral Whiplash Risk',
        detail: `${latG.toFixed(1)}G lateral force (${(latTol * 100).toFixed(0)}% of tolerance).`,
        metric: `${latG.toFixed(1)}G Lateral`,
      },
      'critical',
    );
  } else if (latTol >= WARN_TOLERANCE) {
    pushHazard(
      {
        type: 'whiplash',
        severity: 'warning',
        title: 'Elevated Lateral Loading',
        detail: `${latG.toFixed(1)}G lateral force (${(latTol * 100).toFixed(0)}% of tolerance).`,
        metric: `${latG.toFixed(1)}G Lateral`,
      },
      'warning',
    );
  }

  // 4. High-velocity kinetic stress — very high bar before it fires.
  if (maxSpeed >= 200 && (maxPosG > 10.0 || latG > 5.0)) {
    pushHazard(
      {
        type: 'jerk',
        severity: 'warning',
        title: 'Extreme Kinetic Stress (200+ mph)',
        detail: `At ${maxSpeed.toFixed(0)} mph, minute track curvature variations exert massive kinetic shockwaves on train bogies and riders.`,
        metric: `${maxSpeed.toFixed(0)} mph`,
      },
      'warning',
    );
  }

  const isDeadly = hazards.some((h) => h.severity === 'fatal');
  const isUnsafe = hazards.some((h) => h.severity === 'critical');

  // ---- Tier classification ----
  let level: IntensityLevel = 'mild';
  let description = '';
  let recommendation = '';

  if (isDeadly) {
    level = 'deadly';
    description =
      'LETHAL FORCES: This layout exceeds human physiological limits once G-loads are integrated over their duration.';
    recommendation =
      'EMERGENCY REPROFILE: Widen the valley radii on drops, bank sharp turns to eliminate lateral whip, and smooth sharp crests to shorten sustained negative-G exposure.';
  } else if (isUnsafe) {
    level = 'unsafe';
    description =
      'DANGEROUS / NON-COMPLIANT: Sustained G-loads exceed ASTM F2291 human physiological limits. Riders will experience G-LOC, redout, or severe neck strain.';
    recommendation =
      'Add trim brakes, increase curve radius, or increase heartline banking to bring forces into the safe zone.';
  } else if (
    maxPosG >= 8.5 ||
    posEx.toleranceUsed >= WARN_TOLERANCE ||
    negG <= -4.5 ||
    negEx.toleranceUsed >= WARN_TOLERANCE ||
    latG >= 5.0 ||
    latTol >= WARN_TOLERANCE ||
    maxSpeed >= 150
  ) {
    level = 'extreme';
    description =
      'Hypercoaster intensity at the upper envelope of safe commercial theme park rides. Noticeable greyout risk on sustained turns and intense ejector airtime.';
    recommendation =
      'Forces are within expert thrill limits. Ensure proper over-the-shoulder or high-retention lap bar restraints.';
  } else if (
    maxPosG >= 6.0 ||
    negG <= -2.5 ||
    latG >= 3.5 ||
    maxSpeed >= 110
  ) {
    level = 'intense';
    description =
      'Energetic and thrilling coaster featuring forceful inversions, firm positive Gs, and clean ejector/floater airtime.';
    recommendation = 'Excellent balance of thrill, comfort, and pacing.';
  } else if (maxPosG >= 4.0 || maxSpeed >= 70 || trackLengthFt > 1400) {
    level = 'moderate';
    description =
      'Moderate family thrill coaster. Accessible drops, sweeping banks, and gentle floater airtime without disorienting forces.';
    recommendation = 'Accessible to broad audiences and casual park guests.';
  } else {
    level = 'mild';
    description =
      'Gentle family coaster with low velocity, comfortable banking, and minimal vertical loading.';
    recommendation = 'Smooth and relaxing.';
  }

  const conf = INTENSITY_CONFIG[level];

  return {
    level,
    label: conf.label,
    color: conf.color,
    bgColor: conf.bgColor,
    borderColor: conf.borderColor,
    textColor: conf.textColor,
    description,
    maxPositiveG: Math.round(maxPosG * 10) / 10,
    maxNegativeG: Math.round(negG * 10) / 10,
    maxLateralG: Math.round(latG * 10) / 10,
    maxSpeedMph: Math.round(maxSpeed * 10) / 10,
    hazards,
    recommendation,
  };
}
