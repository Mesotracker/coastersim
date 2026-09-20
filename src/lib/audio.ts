/**
 * Dynamic Web Audio Synthesizer for Coaster Simulation
 * Synthesizes procedural wheel roar, chain lift ratchets, aerodynamic wind rush,
 * brake friction, booster motor whine, and physiological danger cues.
 */

import { SimState, SimSettings } from './physics';
import { BuiltTrack } from './track';

class CoasterAudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.7;

  // Master Gain Node
  private masterGain: GainNode | null = null;

  // Noise Buffer (White / Pink Noise for roar and wind)
  private noiseBuffer: AudioBuffer | null = null;

  // Wheel Roar Nodes
  private roarSource: AudioBufferSourceNode | null = null;
  private roarFilter: BiquadFilterNode | null = null;
  private roarGain: GainNode | null = null;
  private roarSubOsc: OscillatorNode | null = null;
  private roarSubGain: GainNode | null = null;

  // Wind Slipstream Nodes
  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  // Brake Nodes
  private brakeSource: AudioBufferSourceNode | null = null;
  private brakeFilter: BiquadFilterNode | null = null;
  private brakeGain: GainNode | null = null;

  // Booster / LSM Whine Nodes
  private boostOsc: OscillatorNode | null = null;
  private boostGain: GainNode | null = null;

  // Physiological Danger (Heartbeat & Tinnitus) Nodes
  private tinnitusOsc: OscillatorNode | null = null;
  private tinnitusGain: GainNode | null = null;
  private lastHeartbeatT: number = 0;

  // Chain lift timing
  private lastLiftClankT: number = 0;

  private isInitialized: boolean = false;

  constructor() {
    // Load saved mute / volume preferences from localStorage if present
    try {
      const savedMute = localStorage.getItem('coaster_muted');
      if (savedMute !== null) this.isMuted = savedMute === 'true';
      const savedVol = localStorage.getItem('coaster_volume');
      if (savedVol !== null) this.volume = parseFloat(savedVol);
    } catch {}
  }

  public init() {
    if (this.isInitialized) return;

    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      this.ctx = new AudioContextClass();

      // Master Gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Generate 5-second seamless noise buffer
      const sampleRate = this.ctx.sampleRate;
      const bufferLen = sampleRate * 5;
      this.noiseBuffer = this.ctx.createBuffer(1, bufferLen, sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferLen; i++) {
        const white = Math.random() * 2 - 1;
        // Pink noise approximation
        lastOut = (lastOut * 0.95 + white * 0.05);
        data[i] = lastOut * 3.5;
      }

      // Setup Wheel Roar
      this.roarSource = this.ctx.createBufferSource();
      this.roarSource.buffer = this.noiseBuffer;
      this.roarSource.loop = true;

      this.roarFilter = this.ctx.createBiquadFilter();
      this.roarFilter.type = 'bandpass';
      this.roarFilter.frequency.value = 180;
      this.roarFilter.Q.value = 2.2;

      this.roarGain = this.ctx.createGain();
      this.roarGain.gain.value = 0.0001;

      this.roarSource.connect(this.roarFilter);
      this.roarFilter.connect(this.roarGain);
      this.roarGain.connect(this.masterGain);
      this.roarSource.start(0);

      // Sub-bass wheel rumble oscillator
      this.roarSubOsc = this.ctx.createOscillator();
      this.roarSubOsc.type = 'triangle';
      this.roarSubOsc.frequency.value = 48;
      this.roarSubGain = this.ctx.createGain();
      this.roarSubGain.gain.value = 0.0001;
      this.roarSubOsc.connect(this.roarSubGain);
      this.roarSubGain.connect(this.masterGain);
      this.roarSubOsc.start(0);

      // Setup Wind Rush
      this.windSource = this.ctx.createBufferSource();
      this.windSource.buffer = this.noiseBuffer;
      this.windSource.loop = true;

      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'highpass';
      this.windFilter.frequency.value = 650;
      this.windFilter.Q.value = 0.8;

      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0.0001;

      this.windSource.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.masterGain);
      this.windSource.start(0);

      // Setup Brake Screech
      this.brakeSource = this.ctx.createBufferSource();
      this.brakeSource.buffer = this.noiseBuffer;
      this.brakeSource.loop = true;

      this.brakeFilter = this.ctx.createBiquadFilter();
      this.brakeFilter.type = 'bandpass';
      this.brakeFilter.frequency.value = 2400;
      this.brakeFilter.Q.value = 6.0;

      this.brakeGain = this.ctx.createGain();
      this.brakeGain.gain.value = 0.0001;

      this.brakeSource.connect(this.brakeFilter);
      this.brakeFilter.connect(this.brakeGain);
      this.brakeGain.connect(this.masterGain);
      this.brakeSource.start(0);

      // Setup Booster / Launch Stator Whine
      this.boostOsc = this.ctx.createOscillator();
      this.boostOsc.type = 'sawtooth';
      this.boostOsc.frequency.value = 220;
      this.boostGain = this.ctx.createGain();
      this.boostGain.gain.value = 0.0001;
      this.boostOsc.connect(this.boostGain);
      this.boostGain.connect(this.masterGain);
      this.boostOsc.start(0);

      // Setup Physiological Danger Tinnitus Ringing
      this.tinnitusOsc = this.ctx.createOscillator();
      this.tinnitusOsc.type = 'sine';
      this.tinnitusOsc.frequency.value = 3920; // high frequency ringing
      this.tinnitusGain = this.ctx.createGain();
      this.tinnitusGain.gain.value = 0.0001;
      this.tinnitusOsc.connect(this.tinnitusGain);
      this.tinnitusGain.connect(this.masterGain);
      this.tinnitusOsc.start(0);

      this.isInitialized = true;
    } catch (e) {
      console.warn('Coaster Audio initialization skipped:', e);
    }
  }

  public resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  /**
   * Main per-frame audio synthesis updater
   */
  public update(
    sim: SimState,
    track: BuiltTrack,
    cfg: SimSettings,
    playing: boolean,
  ) {
    if (!this.isInitialized || !this.ctx || this.isMuted || !playing) {
      if (this.masterGain && this.ctx && !this.isMuted && !playing) {
        // Softly fade out on pause
        this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      }
      return;
    }

    this.resume();

    const now = this.ctx.currentTime;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.volume, now, 0.04);
    }

    const speed = Math.abs(sim.speed); // mph
    const g = sim.g;
    const s = sim.s;

    // Check special track piece at train's front position
    let special = 0;
    if (track && track.samples && track.samples.length > 0) {
      const idx = Math.min(
        track.samples.length - 1,
        Math.max(0, Math.floor(s / (track.samples[1]?.s - track.samples[0]?.s || 1))),
      );
      special = track.samples[idx]?.special ?? 0;
    }

    const isOnLift = s < track.liftEnd && speed < 18 && speed > 0.5;

    // 1. Wheel Track Roar Synthesis
    if (this.roarFilter && this.roarGain && this.roarSubOsc && this.roarSubGain) {
      // Bandpass frequency scales with speed
      const targetFreq = Math.min(850, 110 + speed * 6.5);
      this.roarFilter.frequency.setTargetAtTime(targetFreq, now, 0.06);

      // Gain scales with speed and vertical track loading
      const gFactor = Math.min(2.5, Math.max(0.4, Math.abs(g)));
      const targetRoarGain = Math.min(0.42, (speed / 100) * 0.32 * gFactor);
      this.roarGain.gain.setTargetAtTime(targetRoarGain, now, 0.05);

      // Sub-bass structural hum
      const subFreq = Math.min(120, 32 + speed * 1.2);
      this.roarSubOsc.frequency.setTargetAtTime(subFreq, now, 0.06);
      this.roarSubGain.gain.setTargetAtTime(Math.min(0.24, targetRoarGain * 0.7), now, 0.05);
    }

    // 2. Wind Slipstream Synthesis
    if (this.windFilter && this.windGain) {
      const windFreq = Math.min(3200, 450 + speed * 18);
      this.windFilter.frequency.setTargetAtTime(windFreq, now, 0.08);

      // Wind ramps up nonlinearly above 28 mph
      const windIntensity = Math.max(0, (speed - 28) / 80);
      const targetWindGain = Math.min(0.38, Math.pow(windIntensity, 1.4) * 0.38);
      this.windGain.gain.setTargetAtTime(targetWindGain, now, 0.07);
    }

    // 3. Chain Lift Ratchet Clank Sound
    if (isOnLift) {
      const clankInterval = Math.max(0.12, 0.55 / (cfg.liftSpeed * 0.4 || 1));
      if (now - this.lastLiftClankT >= clankInterval) {
        this.lastLiftClankT = now;
        this.triggerChainClank();
      }
    }

    // 4. Brake Screech Synthesis
    if (this.brakeGain && this.brakeFilter) {
      const isBraking = special === 1 && speed > 3.0;
      const brakeVolume = isBraking ? Math.min(0.28, (speed / 45) * 0.28) : 0.0001;
      this.brakeGain.gain.setTargetAtTime(brakeVolume, now, 0.04);
      if (isBraking) {
        this.brakeFilter.frequency.setTargetAtTime(1800 + Math.random() * 800, now, 0.02);
      }
    }

    // 5. Booster / Launch Whine Synthesis
    if (this.boostGain && this.boostOsc) {
      const isBoosting = special === 2 && speed > 1.0;
      const boostVolume = isBoosting ? 0.18 : 0.0001;
      this.boostGain.gain.setTargetAtTime(boostVolume, now, 0.03);
      if (isBoosting) {
        const pitch = Math.min(1400, 180 + speed * 18);
        this.boostOsc.frequency.setTargetAtTime(pitch, now, 0.03);
      }
    }

    // 6. Physiological Danger Alerts (Unsafe & Deadly G-force cues)
    // Tinnitus high-frequency tone triggers when G-forces exceed safe thresholds
    if (this.tinnitusGain) {
      const isExtremePosG = g > 5.8;
      const isExtremeNegG = g < -1.6;
      const isExtremeLatG = Math.abs(sim.lat) > 2.4;
      const isInDanger = isExtremePosG || isExtremeNegG || isExtremeLatG;

      if (isInDanger) {
        const dangerLevel = Math.max(
          isExtremePosG ? (g - 5.8) / 3.0 : 0,
          isExtremeNegG ? (-1.6 - g) / 1.5 : 0,
          isExtremeLatG ? (Math.abs(sim.lat) - 2.4) / 1.5 : 0,
        );
        const tinnitusVol = Math.min(0.22, Math.max(0.04, dangerLevel * 0.22));
        this.tinnitusGain.gain.setTargetAtTime(tinnitusVol, now, 0.05);

        // Heavy cardiac thump when in deadly zones
        if (g > 6.8 || g < -2.2 || Math.abs(sim.lat) > 3.2) {
          if (now - this.lastHeartbeatT > 0.55) {
            this.lastHeartbeatT = now;
            this.triggerHeartbeat();
          }
        }
      } else {
        this.tinnitusGain.gain.setTargetAtTime(0.0001, now, 0.1);
      }
    }
  }

  /**
   * Triggers a realistic mechanical chain lift dog-and-pawl ratchet click
   */
  private triggerChainClank() {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const clickGain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      // Sharp metallic strike
      osc.type = 'square';
      osc.frequency.setValueAtTime(620 + Math.random() * 80, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.035);

      filter.type = 'bandpass';
      filter.frequency.value = 1400;
      filter.Q.value = 4.5;

      clickGain.gain.setValueAtTime(0.18, now);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

      osc.connect(filter);
      filter.connect(clickGain);
      clickGain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.045);
    } catch {}
  }

  /**
   * Triggers a deep muffled physiological heartbeat thump for Unsafe / Deadly forces
   */
  private triggerHeartbeat() {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(64, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.12);

      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.2);
    } catch {}
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    try {
      localStorage.setItem('coaster_muted', String(muted));
    } catch {}
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.03);
    }
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    try {
      localStorage.setItem('coaster_volume', String(this.volume));
    } catch {}
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public stop() {
    if (!this.ctx) return;
    try {
      if (this.masterGain) {
        this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
      }
    } catch {}
  }

  public getVolume(): number {
    return this.volume;
  }
}

export const audioEngine = new CoasterAudioEngine();
