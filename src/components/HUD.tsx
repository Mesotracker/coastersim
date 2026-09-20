import { useState, useRef, useEffect } from 'react';
import {
  Sun,
  Sunset,
  Moon,
  CloudRain,
  Crosshair,
  Play,
  Pause,
  RotateCcw,
  FastForward,
} from 'lucide-react';
import { CamMode, WeatherType } from './Ride3D';
import SpeedGraph from './SpeedGraph';
import { TelemetryPoint } from '../lib/physics';

export interface HudData {
  speed: number; // in mph
  g: number;
  lat: number;
  height: number; // in feet
  airtime: number;
  runTime: number;
  maxSpeed: number; // in mph
  maxG: number;
  progress: number;
  phase: string;
  event: string;
  eventT: number;
  laps: number;
  telemetry: TelemetryPoint[];
}

const MODES: { id: CamMode; label: string }[] = [
  { id: 'pov', label: 'POV' },
  { id: 'chase', label: 'Chase' },
  { id: 'orbit', label: 'Aerial' },
];

const WEATHERS: { id: WeatherType; label: string; icon: typeof Sun }[] = [
  { id: 'day', label: 'Day', icon: Sun },
  { id: 'sunset', label: 'Sunset', icon: Sunset },
  { id: 'night', label: 'Night', icon: Moon },
  { id: 'storm', label: 'Storm', icon: CloudRain },
];

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-black/55 px-2.5 sm:px-3 py-1.5 backdrop-blur-md ring-1 ring-white/15 shadow-sm">
      <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-white/70">{label}</div>
      <div className="font-mono text-xs sm:text-base font-bold leading-tight" style={{ color: accent ?? '#fff' }}>
        {value}
      </div>
    </div>
  );
}

interface HUDProps {
  hud: HudData;
  camMode: CamMode;
  setCamMode: (m: CamMode) => void;
  weather: WeatherType;
  setWeather: (w: WeatherType) => void;
  aerialFollow: boolean;
  setAerialFollow: (v: boolean | ((prev: boolean) => boolean)) => void;
  playing: boolean;
  onTogglePlay?: () => void;
  onRestart?: () => void;
  onSeek?: (progress: number) => void;
  simSpeed?: number;
  setSimSpeed?: (speed: number) => void;
  trackLengthFt?: number;
}

export default function HUD({
  hud,
  camMode,
  setCamMode,
  weather,
  setWeather,
  aerialFollow,
  setAerialFollow,
  playing,
  onTogglePlay,
  onRestart,
  onSeek,
  simSpeed = 1,
  setSimSpeed,
  trackLengthFt = 1200,
}: HUDProps) {
  const [showGraph, setShowGraph] = useState(false);
  const trackBarRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const [hoverProgress, setHoverProgress] = useState<number | null>(null);

  // Dynamic speedometer gauge scaling (uncapped velocity support for high-speed coasters)
  const maxGaugeSpeed = Math.max(90, Math.ceil((hud.maxSpeed || 90) / 40) * 40);
  const speedPct = Math.min(1, hud.speed / maxGaugeSpeed);
  const gColor = hud.g > 3.5 ? '#f87171' : hud.g < 0.2 ? '#38bdf8' : '#fff';

  const currentProgress = isDragging ? dragProgress : hud.progress;

  // Compute progress ratio (0 to 1) from pointer clientX
  const getPointerProgress = (clientX: number) => {
    if (!trackBarRef.current) return 0;
    const rect = trackBarRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    const p = getPointerProgress(e.clientX);
    setIsDragging(true);
    setDragProgress(p);
    onSeek?.(p);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const p = getPointerProgress(e.clientX);
    setHoverProgress(p);
    if (isDragging) {
      setDragProgress(p);
      onSeek?.(p);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      const p = getPointerProgress(e.clientX);
      onSeek?.(p);
    }
  };

  const handlePointerCancel = () => {
    setIsDragging(false);
  };

  // Preview values for hover / scrub tooltip
  const activeTooltipP = isDragging ? dragProgress : hoverProgress;
  const tooltipDistFt = activeTooltipP !== null ? (activeTooltipP * trackLengthFt).toFixed(0) : '0';

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* Dynamic speed vignette on extreme velocity */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: Math.max(0, speedPct - 0.3) * 1.5,
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0) 38%, rgba(0,0,0,0.6) 100%)',
        }}
      />

      {/* Top-left Telemetry HUD (Speedometer & G-Forces) */}
      <div className="absolute left-2.5 top-2.5 sm:left-3 sm:top-3 flex flex-col gap-1.5 z-10">
        <div className="rounded-xl bg-black/55 px-3 py-2 backdrop-blur-md ring-1 ring-white/15 shadow-md">
          <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-widest text-white/60">
            <span>Speed</span>
            <span className="text-[9px] text-white/40">max {hud.maxSpeed.toFixed(0)}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl sm:text-3xl font-black leading-none text-white tabular-nums">
              {hud.speed.toFixed(0)}
            </span>
            <span className="text-[11px] font-bold text-amber-400">mph</span>
          </div>
          <div className="mt-1.5 h-1.5 w-28 sm:w-32 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full transition-[width] duration-75"
              style={{
                width: `${speedPct * 100}%`,
                background: 'linear-gradient(90deg,#34d399,#fbbf24,#f43f5e)',
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 sm:gap-1.5">
          <Stat label="G-force" value={`${hud.g.toFixed(2)} g`} accent={gColor} />
          <Stat label="Elevation" value={`${hud.height.toFixed(0)} ft`} />
          <Stat label="Airtime" value={`${hud.airtime.toFixed(1)} s`} accent="#7dd3fc" />
          <Stat label="Time" value={`${hud.runTime.toFixed(1)} s`} />
        </div>
      </div>

      {/* Top-right Camera modes, Weather & Tools */}
      <div className="pointer-events-auto absolute right-2.5 top-2.5 sm:right-3 sm:top-3 flex flex-col items-end gap-1.5 sm:gap-2 z-10">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowGraph((v) => !v)}
            title="Toggle speed graph over time"
            className={`hidden sm:flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold backdrop-blur-sm ring-1 transition ${
              showGraph
                ? 'bg-sky-500 text-white ring-sky-300 shadow-md shadow-sky-500/30'
                : 'bg-black/50 text-white/80 ring-white/15 hover:bg-black/70 hover:text-white'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M18 9l-5 5-4-4-6 6" />
            </svg>
            <span>Graph</span>
          </button>

          <div className="flex gap-0.5 rounded-lg bg-black/55 p-1 backdrop-blur-md ring-1 ring-white/15">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setCamMode(m.id)}
                className={`rounded-md px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] font-bold transition ${
                  camMode === m.id ? 'bg-white text-slate-900 shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Weather selector */}
        <div className="flex items-center gap-0.5 sm:gap-1 rounded-lg bg-black/55 p-1 backdrop-blur-md ring-1 ring-white/15">
          <span className="hidden sm:inline px-1.5 text-[9px] font-bold uppercase tracking-wider text-white/50">Sky</span>
          {WEATHERS.map((w) => {
            const Icon = w.icon;
            const active = weather === w.id;
            return (
              <button
                key={w.id}
                onClick={() => setWeather(w.id)}
                title={`Atmosphere: ${w.label}`}
                className={`flex items-center gap-1 rounded-md px-1.5 sm:px-2 py-1 text-[10px] sm:text-[11px] font-bold transition ${
                  active
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden md:inline">{w.label}</span>
              </button>
            );
          })}
        </div>

        {/* Aerial Drone active control indicator */}
        {camMode === 'orbit' && (
          <div className="flex items-center gap-2 rounded-xl bg-slate-950/85 px-2.5 sm:px-3 py-1.5 text-[10px] sm:text-[11px] font-medium text-white/90 shadow-lg backdrop-blur-md ring-1 ring-white/15">
            <div className="flex items-center gap-1.5 text-sky-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
              </span>
              <span className="font-bold">Drone</span>
            </div>
            <span className="text-white/40 hidden sm:inline">|</span>
            <span className="text-white/70 hidden md:inline">Drag to steer · Pinch zoom</span>
            <button
              onClick={() => setAerialFollow((prev) => !prev)}
              className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold transition ${
                aerialFollow
                  ? 'bg-sky-500/30 text-sky-200 ring-1 ring-sky-400/40'
                  : 'bg-white/10 text-white/60 hover:text-white'
              }`}
            >
              <Crosshair className="h-3 w-3" />
              <span>{aerialFollow ? 'Track Car' : 'Free'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Floating Speed Graph Overlay */}
      {showGraph && (
        <div className="pointer-events-auto absolute left-3 bottom-24 z-20 w-[340px] sm:w-[380px] rounded-2xl border border-white/20 bg-slate-900/90 p-3 text-slate-100 shadow-2xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-white">Ride Speed Telemetry</span>
            <button
              onClick={() => setShowGraph(false)}
              className="text-xs text-white/60 hover:text-white"
            >
              ✕
            </button>
          </div>
          <SpeedGraph
            telemetry={hud.telemetry}
            currentTime={hud.runTime}
            currentSpeed={hud.speed}
            maxSpeed={hud.maxSpeed}
            airtime={hud.airtime}
            compact={true}
            onScrub={onSeek}
          />
        </div>
      )}

      {/* Vertical G-force meter bar */}
      <div className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 z-10">
        <div className="relative h-32 sm:h-40 w-2.5 overflow-hidden rounded-full bg-black/55 ring-1 ring-white/15">
          <div className="absolute left-0 right-0 top-[20%] h-px bg-white/25" />
          <div className="absolute left-0 right-0 bottom-[16.6%] h-px bg-white/25" />
          <div
            className="absolute left-0 right-0 rounded-full transition-[height,bottom] duration-75"
            style={{
              bottom: `${16.6}%`,
              height: `${Math.max(0, Math.min(83, (hud.g / 5) * 83))}%`,
              background: hud.g > 3.5 ? '#f87171' : '#4ade80',
            }}
          />
          {hud.g < 0 && (
            <div
              className="absolute left-0 right-0 rounded-full bg-sky-400"
              style={{ top: `${83}%`, height: `${Math.min(16, (-hud.g / 1) * 16)}%` }}
            />
          )}
        </div>
        <div className="mt-1 text-center text-[8px] font-bold uppercase tracking-widest text-white/60">G</div>
      </div>

      {/* Event banner notification */}
      {hud.eventT > 0 && (
        <div className="absolute left-1/2 top-[16%] -translate-x-1/2 z-10 pointer-events-none">
          <div
            className="rounded-full bg-black/70 px-4 py-1.5 text-xs sm:text-sm font-black uppercase tracking-wider text-white shadow-xl ring-1 ring-white/20 backdrop-blur-md"
            style={{ opacity: Math.min(1, hud.eventT * 1.6) }}
          >
            {hud.event}
          </div>
        </div>
      )}

      {/* Subtle non-blocking paused indicator */}
      {!playing && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 z-10">
          <div className="flex items-center gap-2 rounded-full bg-black/65 px-3 py-1 text-xs font-bold uppercase tracking-widest text-amber-300 shadow-lg ring-1 ring-amber-400/30 backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <span>Simulation Paused · Drag Timeline to Scrub</span>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* REPLAY TIMELINE & DRAGGABLE PROGRESS BAR (Touch & Mouse Support)   */}
      {/* ================================================================ */}
      <div className="pointer-events-auto absolute bottom-2.5 sm:bottom-3 left-2 sm:left-3 right-2 sm:right-3 z-20">
        <div className="rounded-2xl border border-white/20 bg-slate-950/85 p-2.5 sm:p-3 text-white shadow-2xl backdrop-blur-md ring-1 ring-black/40">
          {/* Top Row: Replay controls, time status, and telemetry snapshot */}
          <div className="mb-2 flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* Play / Pause Toggle Button */}
              <button
                onClick={onTogglePlay}
                title={playing ? 'Pause Ride (Space)' : 'Play / Resume Ride (Space)'}
                className={`flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl font-bold shadow-md transition active:scale-95 ${
                  playing
                    ? 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                    : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                }`}
              >
                {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
              </button>

              {/* Reset to Station */}
              <button
                onClick={onRestart}
                title="Rewind & Reset to Station (R)"
                className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition active:scale-95"
              >
                <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>

              {/* Playback speed selector */}
              {setSimSpeed && (
                <div className="flex items-center rounded-xl bg-white/10 p-0.5 ring-1 ring-white/10 text-[10px] sm:text-xs font-bold">
                  {([0.5, 1, 2] as const).map((spd) => (
                    <button
                      key={spd}
                      onClick={() => setSimSpeed(spd)}
                      title={`Replay Speed: ${spd}x ${spd < 1 ? '(Slow Motion)' : ''}`}
                      className={`rounded-lg px-2 py-1 transition ${
                        simSpeed === spd
                          ? 'bg-sky-500 text-white shadow-sm'
                          : 'text-white/60 hover:text-white'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              )}

              {/* Phase status badge */}
              <span className="hidden xs:inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2 py-1 text-[10px] sm:text-[11px] font-bold tracking-wide text-white/80">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    hud.phase === 'station'
                      ? 'bg-amber-400'
                      : hud.phase === 'finished'
                        ? 'bg-rose-400'
                        : 'bg-emerald-400'
                  }`}
                />
                <span className="uppercase">
                  {hud.phase === 'station' ? 'Station' : hud.phase === 'finished' ? 'Brake Run' : 'On Ride'}
                </span>
                {hud.laps > 0 && <span className="text-white/40">· Lap {hud.laps + 1}</span>}
              </span>
            </div>

            {/* Right side: Time & Distance Telemetry */}
            <div className="flex items-center gap-2 text-[10px] sm:text-xs font-mono font-bold text-white/90">
              <span className="text-white/60 hidden sm:inline">
                {(currentProgress * trackLengthFt).toFixed(0)} / {trackLengthFt.toFixed(0)} ft
              </span>
              <span className="rounded-lg bg-black/40 px-2 py-1 text-sky-300 ring-1 ring-white/10">
                {hud.runTime.toFixed(1)}s
              </span>
              <span className="hidden md:inline text-white/40">·</span>
              <span className="hidden md:inline text-white/80">
                Peak: <span className="text-amber-300">{hud.maxSpeed.toFixed(0)} mph</span> / <span className="text-rose-300">{hud.maxG.toFixed(1)}g</span>
              </span>
            </div>
          </div>

          {/* Bottom Draggable Scrubber Bar Container */}
          <div
            className="group/timeline relative flex h-7 sm:h-8 items-center cursor-pointer select-none touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={() => {
              if (!isDragging) setHoverProgress(null);
            }}
          >
            {/* Background track */}
            <div
              ref={trackBarRef}
              className="relative h-2.5 sm:h-3 w-full overflow-hidden rounded-full bg-white/15 ring-1 ring-white/10 transition-all group-hover/timeline:h-3 sm:group-hover/timeline:h-3.5"
            >
              {/* Progress filled track */}
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-400 via-teal-300 to-emerald-400 shadow-sm shadow-sky-400/40"
                style={{ width: `${Math.max(0, Math.min(100, currentProgress * 100))}%` }}
              />

              {/* Track section tick marks */}
              <div className="absolute inset-0 flex justify-between px-1 pointer-events-none opacity-30">
                {[0.25, 0.5, 0.75].map((tick) => (
                  <div
                    key={tick}
                    className="absolute top-0 bottom-0 w-px bg-white"
                    style={{ left: `${tick * 100}%` }}
                  />
                ))}
              </div>
            </div>

            {/* Draggable Scrubber Thumb Handle */}
            <div
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex items-center justify-center rounded-full bg-white shadow-xl ring-2 transition-transform ${
                isDragging
                  ? 'h-6 w-6 ring-sky-400 scale-110 shadow-sky-500/60'
                  : 'h-5 w-5 ring-sky-400/80 group-hover/timeline:scale-110 shadow-black/60'
              }`}
              style={{ left: `${Math.max(0, Math.min(100, currentProgress * 100))}%` }}
            >
              <div className="h-2 w-2 rounded-full bg-sky-500" />
            </div>

            {/* Dynamic Scrubbing / Hover Tooltip */}
            {activeTooltipP !== null && (
              <div
                className="pointer-events-none absolute bottom-8 -translate-x-1/2 z-30 flex flex-col items-center animate-in fade-in zoom-in-95 duration-100"
                style={{ left: `${Math.max(3, Math.min(97, activeTooltipP * 100))}%` }}
              >
                <div className="whitespace-nowrap rounded-lg bg-slate-900/95 px-2.5 py-1 text-[10px] sm:text-[11px] font-mono font-bold text-white shadow-xl ring-1 ring-white/20 backdrop-blur-md">
                  <span>{(activeTooltipP * 100).toFixed(0)}%</span>
                  <span className="text-white/40 mx-1">·</span>
                  <span className="text-sky-300">{tooltipDistFt} ft</span>
                  <span className="text-white/40 mx-1">·</span>
                  <span className="text-amber-300">{hud.speed.toFixed(0)} mph</span>
                  <span className="text-white/40 mx-1">·</span>
                  <span style={{ color: gColor }}>{hud.g.toFixed(1)}g</span>
                </div>
                <div className="h-1.5 w-1.5 rotate-45 bg-slate-900 -mt-1 ring-r ring-b ring-white/20" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
