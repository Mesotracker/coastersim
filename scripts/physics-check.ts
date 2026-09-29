import { DEFAULT_SETTINGS, makeSim, precomputeFullRideTelemetry, stepSim } from '../src/lib/physics';
import { PRESETS, buildTrack, defaultTrack } from '../src/lib/track';

function liveRun(frameDt: number) {
  const track = buildTrack(PRESETS[0].build());
  const state = makeSim();
  let elapsed = 0;
  while (elapsed < 300 && state.phase !== 'finished') {
    stepSim(state, track, frameDt, DEFAULT_SETTINGS);
    elapsed += frameDt;
  }
  return { state, track };
}

const at30 = liveRun(1 / 30);
const at144 = liveRun(1 / 144);
const predicted = precomputeFullRideTelemetry(at30.track, DEFAULT_SETTINGS);

const speedDrift = Math.abs(at30.state.maxSpeed - at144.state.maxSpeed);
const timeDrift = Math.abs(at30.state.runTime - at144.state.runTime);
const predictedSpeedDrift = Math.abs(predicted.maxSpeed - at144.state.maxSpeed);
const scenicRide = precomputeFullRideTelemetry(buildTrack(defaultTrack()), DEFAULT_SETTINGS);

console.log('Physics invariance audit');
console.table({
  '30 fps playback': { duration_s: at30.state.runTime.toFixed(3), max_mph: at30.state.maxSpeed.toFixed(3), phase: at30.state.phase },
  '144 fps playback': { duration_s: at144.state.runTime.toFixed(3), max_mph: at144.state.maxSpeed.toFixed(3), phase: at144.state.phase },
  '240 Hz precompute': { duration_s: predicted.totalDuration.toFixed(3), max_mph: predicted.maxSpeed.toFixed(3), phase: predicted.stalled ? 'stalled' : 'complete' },
});

console.log('\nPreset feasibility background check');
for (const preset of PRESETS) {
  const result = precomputeFullRideTelemetry(buildTrack(preset.build()), DEFAULT_SETTINGS);
  console.log(`${result.feasibility.status.padEnd(7)} ${preset.name.padEnd(34)} ${result.maxSpeed.toFixed(1).padStart(6)} mph  ${result.totalDuration.toFixed(1).padStart(6)} s`);
}
console.log(`\nWater coupling audit · scenic duration ${scenicRide.totalDuration.toFixed(2)} s vs dry ${predicted.totalDuration.toFixed(2)} s · ${scenicRide.feasibility.status}`);

if (at30.state.phase !== 'finished' || at144.state.phase !== 'finished') {
  throw new Error('Reference ride did not complete during live-solver audit.');
}
if (speedDrift > 0.08 || timeDrift > 0.08 || predictedSpeedDrift > 0.15) {
  throw new Error(`Solver invariance exceeded tolerance: speed=${speedDrift}, time=${timeDrift}, predicted=${predictedSpeedDrift}`);
}
if (scenicRide.feasibility.status === 'error' || scenicRide.totalDuration <= predicted.totalDuration + 0.2) {
  throw new Error('Waterfall coupling audit failed to produce a safe, measurable speed loss.');
}
console.log(`\nPASS · frame-rate drift ${speedDrift.toFixed(4)} mph / ${timeDrift.toFixed(4)} s · prediction drift ${predictedSpeedDrift.toFixed(4)} mph`);
