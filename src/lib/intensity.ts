/**
 * Coaster Safety & Human Physiological Intensity Analyzer
 * Based on ASTM F2291, NASA human acceleration tolerance data,
 * and aviation biomechanics.
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
    badgeBg: 'bg-orange-100 text-orange-950 border-orange-400 animate-pulse',
  },
  deadly: {
    label: '☠️ DEADLY',
    color: '#dc2626',
    bgColor: '#fef2f2',
    borderColor: '#fca5a5',
    textColor: '#991b1b',
    badgeBg: 'bg-rose-900 text-white border-rose-600 animate-bounce',
  },
};

/**
 * Evaluates the full ride speed & acceleration telemetry and computes
 * the physiological intensity and medical hazard breakdown.
 */
export function analyzeRideIntensity(
  telemetry: TelemetryPoint[],
  maxLatEstimated: number = 0.5,
  trackLengthFt: number = 1000,
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

  let maxPosG = 1.0;
  let minG = 1.0;
  let maxSpeed = 0;
  const hazards: HazardWarning[] = [];

  for (let i = 0; i < telemetry.length; i++) {
    const pt = telemetry[i];
    if (pt.g > maxPosG) maxPosG = pt.g;
    if (pt.g < minG) minG = pt.g;
    if (pt.speed > maxSpeed) maxSpeed = pt.speed;
  }

  // Derive peak negative airtime G
  const negG = minG;
  const latG = Math.max(0.2, maxLatEstimated);

  // Check for DEADLY thresholds (lethal trauma)
  let isDeadly = false;
  let isUnsafe = false;

  // 1. Catastrophic Positive G Compression
  if (maxPosG >= 8.5) {
    isDeadly = true;
    hazards.push({
      type: 'crush',
      severity: 'fatal',
      title: 'Lethal Spinal & Cardiac Collapse (+8.5G+)',
      detail: `Crushing +${maxPosG.toFixed(1)}G exceeds human thoracic and vertebral tolerance. Causes burst fractures of the spine and acute cardiac arrest due to zero venous return.`,
      metric: `+${maxPosG.toFixed(1)}G Vertical`,
    });
  } else if (maxPosG >= 6.0) {
    isUnsafe = true;
    hazards.push({
      type: 'blackout',
      severity: 'critical',
      title: 'Severe G-LOC & Retinal Blackout (+6.0G+)',
      detail: `+${maxPosG.toFixed(1)}G drains arterial blood from the brain and eyes, inducing greyout and total loss of consciousness (G-LOC).`,
      metric: `+${maxPosG.toFixed(1)}G Vertical`,
    });
  }

  // 2. Catastrophic Negative G Redout
  if (negG <= -3.0) {
    isDeadly = true;
    hazards.push({
      type: 'redout',
      severity: 'fatal',
      title: 'Fatal Cerebral Hemorrhage (-3.0G)',
      detail: `${negG.toFixed(1)}G negative airtime produces extreme cephalic intravascular hypertension, resulting in fatal hemorrhagic stroke and skull base detachment.`,
      metric: `${negG.toFixed(1)}G Negative`,
    });
  } else if (negG <= -1.6) {
    isUnsafe = true;
    hazards.push({
      type: 'redout',
      severity: 'critical',
      title: 'Dangerous Redout & Vascular Trauma (-1.6G)',
      detail: `${negG.toFixed(1)}G forces blood into the eyes and cranium, rupturing facial capillaries and causing severe retinal redout.`,
      metric: `${negG.toFixed(1)}G Negative`,
    });
  }

  // 3. Catastrophic Lateral Shear / Whiplash
  if (latG >= 3.8) {
    isDeadly = true;
    hazards.push({
      type: 'whiplash',
      severity: 'fatal',
      title: 'Internal Decapitation / Cervical Spine Severance (3.8G+ Lat)',
      detail: `${latG.toFixed(1)}G unbanked lateral shear produces violent atlanto-occipital dislocation and brainstem transection.`,
      metric: `${latG.toFixed(1)}G Lateral`,
    });
  } else if (latG >= 2.3) {
    isUnsafe = true;
    hazards.push({
      type: 'whiplash',
      severity: 'critical',
      title: 'Severe Cervical Whiplash (2.3G+ Lat)',
      detail: `${latG.toFixed(1)}G lateral force overwhelms human neck musculature, causing cervical ligament tears and head-restraint trauma.`,
      metric: `${latG.toFixed(1)}G Lateral`,
    });
  }

  // 4. Extreme Velocity Hazard with abrupt radius
  if (maxSpeed >= 120 && (maxPosG > 5.5 || latG > 1.8)) {
    isUnsafe = true;
    hazards.push({
      type: 'jerk',
      severity: 'warning',
      title: 'Supersonic Kinetic Stress (120+ mph)',
      detail: `At ${maxSpeed.toFixed(0)} mph, minute track curvature variations exert massive kinetic shockwaves on train bogies and riders.`,
      metric: `${maxSpeed.toFixed(0)} mph`,
    });
  }

  let level: IntensityLevel = 'mild';
  let description = '';
  let recommendation = '';

  if (isDeadly) {
    level = 'deadly';
    description =
      'LETHAL FORCES: This rollercoaster produces fatal G-forces that cause cervical spine severance, hemorrhagic stroke, or total cardiac collapse.';
    recommendation =
      'EMERGENCY REPROFILE: Widen the valley radii on drops to cut positive Gs below 5.5G, bank sharp turns to eliminate deadly lateral whipping, and smooth sharp crests to prevent redouts.';
  } else if (isUnsafe) {
    level = 'unsafe';
    description =
      'DANGEROUS / NON-COMPLIANT: Exceeds ASTM F2291 human physiological limits. Riders will experience G-LOC blackout, extreme redout, or severe neck sprains.';
    recommendation =
      'Add trim brakes, increase curve radius, or increase heartline banking to bring forces into the safe zone.';
  } else if (maxPosG >= 4.8 || negG <= -0.8 || latG >= 1.6 || maxSpeed >= 78) {
    level = 'extreme';
    description =
      'Hypercoaster intensity at the upper envelope of safe commercial theme park rides. Noticeable greyout risk on sustained turns and intense ejector airtime.';
    recommendation =
      'Forces are within expert thrill limits. Ensure proper over-the-shoulder or high-retention lap bar restraints.';
  } else if (maxPosG >= 3.6 || negG <= 0.0 || latG >= 1.0 || maxSpeed >= 55) {
    level = 'intense';
    description =
      'Energetic and thrilling coaster featuring forceful inversions, firm positive Gs, and clean ejector/floater airtime.';
    recommendation = 'Excellent balance of thrill, comfort, and pacing.';
  } else if (maxPosG >= 2.4 || maxSpeed >= 38 || trackLengthFt > 800) {
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
