import { useState } from 'react';
import { Sun, Sunset, Moon, CloudRain, Crosshair } from 'lucide-react';
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
    <div className="rounded-xl bg-black/50 px-3 py-1.5 backdrop-blur-md ring-1 ring-white/15 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wider text-white/70">{label}</div>
      <div className="font-mono text-sm sm:text-base font-bold leading-tight" style={{ color: accent ?? '#fff' }}>
        {value}
      </div>
    </div>
  );
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
}: {
  hud: HudData;
  camMode: CamMode;
  setCamMode: (m: CamMode) => void;
  weather: WeatherType;
  setWeather: (w: WeatherType) => void;
  aerialFollow: boolean;
  setAerialFollow: (v: boolean | ((prev: boolean) => boolean)) => void;
  playing: boolean;
}) {
  const [showGraph, setShowGraph] = useState(false);
  // Imperial speed bar (max scale ~90 mph)
  const speedPct = Math.min(1, hud.speed / 90);
  const gColor = hud.g > 3.5 ? '#f87171' : hud.g < 0.2 ? '#38bdf8' : '#fff';

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* Speed vignette on high velocity */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: Math.max(0, speedPct - 0.35) * 1.4,
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0) 38%, rgba(0,0,0,0.55) 100%)',
        }}
      />

      {/* Top-left imperial telemetry */}
      <div className="absolute left-3 top-3 flex flex-col gap-1.5">
        <div className="rounded-xl bg-black/45 px-3 py-2 backdrop-blur-sm ring-1 ring-white/15">
          <div className="text-[9px] font-semibold uppercase tracking-widest text-white/60">Speed</div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-3xl font-black leading-none text-white tabular-nums">
              {hud.speed.toFixed(0)}
            </span>
            <span className="text-[11px] font-bold text-amber-400">mph</span>
          </div>
          <div className="mt-1.5 h-1.5 w-32 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full transition-[width] duration-100"
              style={{
                width: `${speedPct * 100}%`,
                background: 'linear-gradient(90deg,#34d399,#fbbf24,#f43f5e)',
              }}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="G-force" value={`${hud.g.toFixed(2)} g`} accent={gColor} />
          <Stat label="Elevation" value={`${hud.height.toFixed(0)} ft`} />
          <Stat label="Airtime" value={`${hud.airtime.toFixed(1)} s`} accent="#7dd3fc" />
          <Stat label="Time" value={`${hud.runTime.toFixed(1)} s`} />
        </div>
      </div>

      {/* Top-right camera modes, weather selector & graph toggle */}
      <div className="pointer-events-auto absolute right-3 top-3 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowGraph((v) => !v)}
            title="Toggle speed graph over time"
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold backdrop-blur-sm ring-1 transition ${
              showGraph
                ? 'bg-sky-500 text-white ring-sky-300 shadow-md shadow-sky-500/30'
                : 'bg-black/45 text-white/80 ring-white/15 hover:bg-black/60 hover:text-white'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M18 9l-5 5-4-4-6 6" />
            </svg>
            <span>Speed Graph</span>
          </button>

          <div className="flex gap-1 rounded-lg bg-black/45 p-1 backdrop-blur-sm ring-1 ring-white/15">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setCamMode(m.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${
                  camMode === m.id ? 'bg-white text-slate-900 shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Weather & Time of Day selector */}
        <div className="flex items-center gap-1 rounded-lg bg-black/45 p-1 backdrop-blur-sm ring-1 ring-white/15">
          <span className="px-1.5 text-[9px] font-bold uppercase tracking-wider text-white/50">Weather</span>
          {WEATHERS.map((w) => {
            const Icon = w.icon;
            const active = weather === w.id;
            return (
              <button
                key={w.id}
                onClick={() => setWeather(w.id)}
                title={`Set atmosphere to ${w.label}`}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition ${
                  active
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-3 w-3" />
                <span>{w.label}</span>
              </button>
            );
          })}
        </div>

        {/* Aerial Drone active control indicator */}
        {camMode === 'orbit' && (
          <div className="flex items-center gap-2 rounded-xl bg-slate-950/80 px-3 py-1.5 text-[11px] font-medium text-white/90 shadow-lg backdrop-blur-md ring-1 ring-white/15">
            <div className="flex items-center gap-1.5 text-sky-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
              </span>
              <span className="font-bold">Movable Drone</span>
            </div>
            <span className="text-white/40">|</span>
            <span className="text-white/70 hidden sm:inline">Drag to steer · Wheel zoom</span>
            <button
              onClick={() => setAerialFollow((prev) => !prev)}
              className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold transition ${
                aerialFollow
                  ? 'bg-sky-500/30 text-sky-200 ring-1 ring-sky-400/40'
                  : 'bg-white/10 text-white/60 hover:text-white'
              }`}
            >
              <Crosshair className="h-3 w-3" />
              <span>{aerialFollow ? 'Tracking Car' : 'Free Orbit'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Floating Speed Graph Overlay (when toggled on) */}
      {showGraph && (
        <div className="pointer-events-auto absolute left-3 bottom-14 z-20 w-[360px] rounded-2xl border border-white/20 bg-slate-900/85 p-3 text-slate-100 shadow-2xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-bold tracking-tight text-white">Live Speed Telemetry</span>
            </div>
            <button
              onClick={() => setShowGraph(false)}
              className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white transition"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <SpeedGraph
            telemetry={hud.telemetry}
            currentTime={hud.runTime}
            currentSpeed={hud.speed}
            maxSpeed={hud.maxSpeed}
            airtime={hud.airtime}
            compact={true}
          />
        </div>
      )}

      {/* G-force meter bar */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2">
        <div className="relative h-40 w-2.5 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
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

      {/* Bottom track progress & stats */}
      <div className="absolute bottom-3 left-3 right-3">
        <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-white/80">
          <span className="rounded bg-black/40 px-2 py-0.5 backdrop-blur-sm ring-1 ring-white/10">
            {hud.phase === 'station' ? 'IN STATION' : hud.phase === 'finished' ? 'BRAKE RUN' : 'ON RIDE'}
            {hud.laps > 0 ? ` · run ${hud.laps + 1}` : ''}
          </span>
          <span className="rounded bg-black/40 px-2 py-0.5 backdrop-blur-sm ring-1 ring-white/10">
            top {hud.maxSpeed.toFixed(0)} mph · peak {hud.maxG.toFixed(1)} g
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400"
            style={{ width: `${Math.max(0, Math.min(100, hud.progress * 100))}%` }}
          />
        </div>
      </div>

      {/* Event banner */}
      {hud.eventT > 0 && (
        <div className="absolute left-1/2 top-[18%] -translate-x-1/2">
          <div
            className="rounded-full bg-black/60 px-4 py-1.5 text-sm font-black uppercase tracking-wider text-white shadow-lg ring-1 ring-white/15 backdrop-blur-sm"
            style={{ opacity: Math.min(1, hud.eventT * 1.6) }}
          >
            {hud.event}
          </div>
        </div>
      )}

      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/25 backdrop-blur-[1px]">
          <div className="rounded-xl bg-black/60 px-5 py-3 text-center ring-1 ring-white/15">
            <div className="text-sm font-black uppercase tracking-widest text-white">Paused</div>
            <div className="mt-0.5 text-[11px] text-white/70">Press Play (or Space) to ride</div>
          </div>
        </div>
      )}
    </div>
  );
}
