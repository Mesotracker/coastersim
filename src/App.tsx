import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Upload,
  Play,
  Pause,
  RotateCcw,
  Undo2,
  Trash2,
  Sparkles,
  LayoutGrid,
  Columns,
  Maximize2,
  Activity,
} from 'lucide-react';
import Editor2D from './components/Editor2D';
import Ride3D, { CamMode } from './components/Ride3D';
import Toolbar from './components/Toolbar';
import Inspector from './components/Inspector';
import HUD, { HudData } from './components/HUD';
import SpeedGraph from './components/SpeedGraph';
import ImportExportModal from './components/ImportExportModal';
import {
  FEET_PER_UNIT,
  FT_PER_M,
  MPH_PER_MPS,
  PRESETS,
  Piece,
  PieceKind,
  TrackDef,
  buildTrack,
  defaultTrack,
  newPiece,
} from './lib/track';
import { DEFAULT_SETTINGS, SimSettings, makeSim, resetSim, stepSim } from './lib/physics';
import { THEMES, Theme } from './lib/themes';

type Tab = 'piece' | 'physics' | 'telemetry' | 'style';
type LayoutMode = 'balanced' | 'wide-ride' | 'focus-designer';

const emptyHud: HudData = {
  speed: 0,
  g: 1,
  lat: 0,
  height: 0,
  airtime: 0,
  runTime: 0,
  maxSpeed: 0,
  maxG: 1,
  progress: 0,
  phase: 'station',
  event: '',
  eventT: 0,
  laps: 0,
  telemetry: [],
};

function MiniSlider({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
        <span className="font-mono text-xs font-semibold text-slate-800">{fmt ? fmt(value) : value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600 outline-none transition-colors hover:bg-slate-300 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:shadow"
      />
    </label>
  );
}

export default function App() {
  const [track, setTrack] = useState<TrackDef>(() => defaultTrack());
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [settings, setSettings] = useState<SimSettings>(DEFAULT_SETTINGS);
  const [theme, setTheme] = useState<Theme>(THEMES[0]);
  const [camMode, setCamMode] = useState<CamMode>('pov');
  const [snap, setSnap] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
  const [tab, setTab] = useState<Tab>('piece');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('balanced');
  const [hud, setHud] = useState<HudData>(emptyHud);
  const [hoveredPiece, setHoveredPiece] = useState<number | null>(null);
  const hoveredPieceRef = useRef<number | null>(null);
  hoveredPieceRef.current = hoveredPiece;
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [importExportMode, setImportExportMode] = useState<'export' | 'import'>('export');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 3200);
  }, []);

  const handleSelectMaterial = useCallback(
    (mat: 'metal' | 'wood' | 'plastic') => {
      const defaultFriction = mat === 'wood' ? 0.012 : mat === 'plastic' ? 0.005 : 0.007;
      setSettings((prev) => ({
        ...prev,
        material: mat,
        friction: defaultFriction,
      }));
      showToast(`Track Material set to ${mat.toUpperCase()} (Friction: ${defaultFriction})`);
    },
    [showToast],
  );

  const built = useMemo(() => buildTrack(track), [track]);

  const simRef = useRef(makeSim());
  const builtRef = useRef(built);
  builtRef.current = built;
  const cfgRef = useRef(settings);
  cfgRef.current = settings;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const historyRef = useRef<{ stack: TrackDef[]; t: number }>({ stack: [], t: 0 });

  // ------------------------------------------------------------ simulation loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (playingRef.current) stepSim(simRef.current, builtRef.current, dt, cfgRef.current);
      acc += dt;
      if (acc > 0.033) {
        acc = 0;
        const s = simRef.current;
        setHud({
          speed: s.speed,
          g: s.g,
          lat: s.lat,
          height: s.height,
          airtime: s.airtime,
          runTime: s.runTime,
          maxSpeed: s.maxSpeed,
          maxG: s.maxG,
          progress: builtRef.current.length > 0 ? s.s / builtRef.current.length : 0,
          phase: s.phase,
          event: s.event,
          eventT: s.eventT,
          laps: s.laps,
          telemetry: s.telemetry.slice(-300), // pass fresh telemetry slice for reactive graph
        });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ------------------------------------------------------------ track edits
  const pushHistory = useCallback((prev: TrackDef) => {
    const h = historyRef.current;
    const now = performance.now();
    if (now - h.t > 350) {
      h.stack.push(prev);
      if (h.stack.length > 40) h.stack.shift();
    }
    h.t = now;
  }, []);

  const applyTrack = useCallback(
    (next: TrackDef) => {
      setTrack((prev) => {
        pushHistory(prev);
        return next;
      });
    },
    [pushHistory],
  );

  const handleChange = useCallback(
    (next: TrackDef) => {
      applyTrack(next);
    },
    [applyTrack],
  );

  const insertPiece = useCallback(
    (kind: PieceKind, index: number) => {
      setTrack((prev) => {
        pushHistory(prev);
        const pieces = prev.pieces.slice();
        const i = Math.max(0, Math.min(pieces.length, index));
        pieces.splice(i, 0, newPiece(kind));
        setSelected(i);
        setTab('piece');
        return { ...prev, pieces };
      });
    },
    [pushHistory],
  );

  const addPiece = useCallback(
    (kind: PieceKind) => {
      const at = selected == null ? track.pieces.length : selected + 1;
      insertPiece(kind, at);
    },
    [insertPiece, selected, track.pieces.length],
  );

  const updatePiece = useCallback(
    (index: number, patch: Partial<Piece>) => {
      setTrack((prev) => {
        pushHistory(prev);
        const pieces = prev.pieces.slice();
        if (!pieces[index]) return prev;
        pieces[index] = { ...pieces[index], ...patch };
        return { ...prev, pieces };
      });
    },
    [pushHistory],
  );

  const deletePiece = useCallback(
    (index: number) => {
      setTrack((prev) => {
        pushHistory(prev);
        const pieces = prev.pieces.slice();
        pieces.splice(index, 1);
        return { ...prev, pieces };
      });
      setSelected((s) => (s == null ? null : Math.max(0, Math.min(s, track.pieces.length - 2))));
    },
    [pushHistory, track.pieces.length],
  );

  const duplicatePiece = useCallback(
    (index: number) => {
      setTrack((prev) => {
        pushHistory(prev);
        const pieces = prev.pieces.slice();
        const src = pieces[index];
        if (!src) return prev;
        pieces.splice(index + 1, 0, { ...src, id: newPiece(src.kind).id });
        return { ...prev, pieces };
      });
      setSelected(index + 1);
    },
    [pushHistory],
  );

  const movePiece = useCallback(
    (index: number, dir: -1 | 1) => {
      setTrack((prev) => {
        pushHistory(prev);
        const pieces = prev.pieces.slice();
        const j = index + dir;
        if (j < 0 || j >= pieces.length) return prev;
        const tmp = pieces[index];
        pieces[index] = pieces[j];
        pieces[j] = tmp;
        return { ...prev, pieces };
      });
      setSelected(index + dir);
    },
    [pushHistory],
  );

  const loadPreset = useCallback(
    (i: number) => {
      const p = PRESETS[i];
      if (!p) return;
      setTrack(p.build());
      if (p.themeName) {
        const found = THEMES.find((th) => th.name.toLowerCase().includes(p.themeName!.toLowerCase()));
        if (found) setTheme(found);
      }
      setSelected(null);
      resetSim(simRef.current);
      setFitSignal((f) => f + 1);
      showToast(`Loaded preset: ${p.name}`);
    },
    [showToast],
  );

  const clearTrack = useCallback(() => {
    setTrack((prev) => {
      pushHistory(prev);
      return { ...prev, pieces: [] };
    });
    setSelected(null);
    resetSim(simRef.current);
    showToast('Circuit cleared');
  }, [pushHistory, showToast]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    const prev = h.stack.pop();
    if (prev) {
      setTrack(prev);
      setSelected(null);
      showToast('Action undone');
    }
  }, [showToast]);

  const restart = useCallback(() => {
    resetSim(simRef.current);
    setPlaying(true);
  }, []);

  const handleImportCoaster = useCallback(
    (data: { track: TrackDef; settings?: SimSettings; theme?: Theme; name?: string }) => {
      pushHistory(track);
      setTrack(data.track);
      if (data.settings) setSettings(data.settings);
      if (data.theme) setTheme(data.theme);
      setSelected(null);
      resetSim(simRef.current);
      setFitSignal((f) => f + 1);
      showToast(`Successfully imported: ${data.name || 'Custom Coaster'}`);
    },
    [pushHistory, showToast, track],
  );

  // ------------------------------------------------------------- shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected != null) {
          e.preventDefault();
          deletePiece(selected);
          setSelected(null);
        }
      } else if (e.key === 'Escape') {
        setSelected(null);
      } else if (e.key.toLowerCase() === 'f') {
        setFitSignal((f) => f + 1);
      } else if (e.key.toLowerCase() === 'r') {
        restart();
      } else if (e.key.toLowerCase() === 'e') {
        // "if key e is hit than make the piece touched into a mid air jump"
        const target = selected != null ? selected : hoveredPieceRef.current;
        if (target != null && track.pieces[target]) {
          e.preventDefault();
          const p = track.pieces[target];
          const newKind = p.kind === 'jump' ? 'straight' : 'jump';
          updatePiece(target, { kind: newKind });
          setSelected(target);
          showToast(
            newKind === 'jump'
              ? `Piece #${target + 1} transformed into Mid-Air Jump! 🚀`
              : `Piece #${target + 1} restored to Straight Track`,
          );
        } else if (track.pieces.length > 0) {
          const lastIdx = track.pieces.length - 1;
          updatePiece(lastIdx, { kind: 'jump' });
          setSelected(lastIdx);
          showToast(`Piece #${lastIdx + 1} transformed into Mid-Air Jump! 🚀`);
        }
      } else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deletePiece, restart, selected, showToast, track.pieces, undo, updatePiece]);

  // Imperial unit metrics
  const lengthFt = built.length * FEET_PER_UNIT;
  const heightFt = (built.maxHeight - built.groundY) * FEET_PER_UNIT;
  const selectedLengthFt = (() => {
    if (selected == null) return 0;
    const r = built.pieceRanges[selected];
    if (!r) return 0;
    return (built.samples[r.end].s - built.samples[r.start].s) * FEET_PER_UNIT;
  })();

  // Grouped presets by category for rich dropdown
  const categories = useMemo(() => {
    const cats: Record<string, typeof PRESETS> = {};
    PRESETS.forEach((p) => {
      const c = p.category || 'Classic';
      if (!cats[c]) cats[c] = [];
      cats[c].push(p);
    });
    return cats;
  }, []);

  return (
    <div className="flex h-screen min-h-[700px] flex-col overflow-hidden bg-slate-100 text-slate-900">
      {/* ---------------------------------------------------------- header */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-700 shadow-md shadow-blue-500/20 text-white">
            <svg
              viewBox="0 0 24 24"
              className="h-5.5 w-5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 19h3c0-9 5-13 8.5-13S21 9 21 19" />
              <path d="M2 19c3.5 0 4-6 7-6s3.5 6 7 6" />
              <circle cx="7.5" cy="20.5" r="1.2" />
              <circle cx="16.5" cy="20.5" r="1.2" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base lg:text-lg font-black tracking-tight text-slate-900">Coaster Forge</h1>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 ring-1 ring-blue-200/80">
                PRO 3D
              </span>
            </div>
            <p className="text-xs font-medium text-slate-500">Physics Simulation &amp; Track Designer</p>
          </div>
        </div>

        {/* Imperial Summary Metrics Bar */}
        <div className="hidden items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2 lg:flex">
          <Metric label="Pieces" value={`${track.pieces.length}`} />
          <div className="h-5 w-px bg-slate-200" />
          <Metric label="Length" value={`${lengthFt.toFixed(0)} ft`} />
          <div className="h-5 w-px bg-slate-200" />
          <Metric label="Max Height" value={`${heightFt.toFixed(0)} ft`} />
          <div className="h-5 w-px bg-slate-200" />
          <Metric label="Top Speed" value={`${hud.maxSpeed.toFixed(0)} mph`} />
        </div>

        {/* Action Controls & Presets */}
        <div className="flex items-center gap-2">
          {/* Preset Selector */}
          <div className="relative">
            <select
              className="h-9 cursor-pointer rounded-xl border border-slate-200 bg-white px-3 pr-8 text-xs font-bold text-slate-700 shadow-xs outline-none transition hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value !== '') {
                  const idx = PRESETS.findIndex((p) => p.id === e.target.value);
                  if (idx !== -1) loadPreset(idx);
                }
                e.target.value = '';
              }}
            >
              <option value="" disabled>
                Coaster Presets ({PRESETS.length})…
              </option>
              {Object.entries(categories).map(([category, list]) => (
                <optgroup key={category} label={`— ${category} Coasters —`}>
                  {list.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Material Quick Selector */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-0.5 shadow-xs">
            <span className="px-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Material</span>
            {(['metal', 'wood', 'plastic'] as const).map((m) => (
              <button
                key={m}
                onClick={() => handleSelectMaterial(m)}
                title={`Coaster Material: ${m.toUpperCase()}\n${
                  m === 'metal'
                    ? 'Tubular steel, high speed, smooth precision track.'
                    : m === 'wood'
                      ? 'Traditional timber coaster, organic track chatter, higher friction.'
                      : 'Polymer/plastic composite, ultra-smooth glide and vibrant styling.'
                }`}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold capitalize transition ${
                  settings.material === m
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span>{m === 'metal' ? '🔩' : m === 'wood' ? '🪵' : '🧱'}</span>
                <span>{m}</span>
              </button>
            ))}
          </div>

          {/* Import / Export JSON Buttons */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-0.5 shadow-xs">
            <button
              onClick={() => {
                setImportExportMode('import');
                setImportExportOpen(true);
              }}
              title="Import Coaster Track (.json)"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100"
            >
              <Upload className="h-3.5 w-3.5 text-blue-600" />
              <span>Import</span>
            </button>
            <button
              onClick={() => {
                setImportExportMode('export');
                setImportExportOpen(true);
              }}
              title="Export Coaster Track (.json)"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100"
            >
              <Download className="h-3.5 w-3.5 text-emerald-600" />
              <span>Export</span>
            </button>
          </div>

          {/* Undo / Clear / Restart Buttons */}
          <button
            onClick={undo}
            title="Undo Edit (Ctrl+Z)"
            className="flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-50 active:bg-slate-100"
          >
            <Undo2 className="h-3.5 w-3.5 text-slate-500" />
            <span className="hidden sm:inline">Undo</span>
          </button>
          <button
            onClick={clearTrack}
            title="Clear All Pieces"
            className="flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-50 active:bg-slate-100"
          >
            <Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-rose-500" />
            <span className="hidden sm:inline">Clear</span>
          </button>
          <button
            onClick={restart}
            title="Restart Coaster from Station (R)"
            className="flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-50 active:bg-slate-100"
          >
            <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
            <span className="hidden sm:inline">Restart</span>
          </button>

          {/* Play / Pause Primary Button */}
          <button
            onClick={() => setPlaying((p) => !p)}
            title="Spacebar to toggle simulation"
            className={`flex h-9 items-center gap-2 rounded-xl px-4 text-xs font-bold text-white shadow-md transition ${
              playing
                ? 'bg-slate-900 shadow-slate-900/20 hover:bg-slate-800'
                : 'bg-emerald-600 shadow-emerald-600/25 hover:bg-emerald-500'
            }`}
          >
            {playing ? (
              <>
                <Pause className="h-3.5 w-3.5 fill-current" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Ride</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="absolute top-18 right-6 z-40 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/90 px-4 py-2.5 text-xs font-bold text-white shadow-xl backdrop-blur-md transition-all">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ------------------------------------------------------------ body */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-3.5 gap-3">
        {/* Layout Mode Bar on desktop */}
        <div className="hidden lg:flex items-center justify-between px-1">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
            <span className="text-slate-700">Desktop Viewport:</span>
            <span>Real-time continuous 60FPS physics engine with Imperial metrics</span>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-xs">
            <button
              onClick={() => setLayoutMode('balanced')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                layoutMode === 'balanced'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Columns className="h-3.5 w-3.5" />
              <span>Balanced (50 / 50)</span>
            </button>
            <button
              onClick={() => setLayoutMode('wide-ride')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                layoutMode === 'wide-ride'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span>Wide 3D Ride</span>
            </button>
            <button
              onClick={() => setLayoutMode('focus-designer')}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                layoutMode === 'focus-designer'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Focus Designer</span>
            </button>
          </div>
        </div>

        {/* Main Resizable Split Workspace */}
        <div
          className={`grid min-h-0 flex-1 grid-cols-1 gap-3.5 overflow-hidden ${
            layoutMode === 'wide-ride'
              ? 'lg:grid-cols-12'
              : layoutMode === 'focus-designer'
                ? 'lg:grid-cols-12'
                : 'lg:grid-cols-2'
          }`}
        >
          {/* ------------------------------------------------- left: designer & workbench */}
          <section
            className={`flex flex-col gap-3 min-h-0 overflow-hidden ${
              layoutMode === 'wide-ride'
                ? 'lg:col-span-5'
                : layoutMode === 'focus-designer'
                  ? 'lg:col-span-7'
                  : ''
            }`}
          >
            {/* Pieces palette */}
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Track Elements
                  </h2>
                  <span className="text-[11px] text-slate-400">Click to append, or drag onto canvas</span>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-600">
                  <input
                    type="checkbox"
                    checked={snap}
                    onChange={(e) => setSnap(e.target.checked)}
                    className="h-3.5 w-3.5 accent-blue-600 rounded cursor-pointer"
                  />
                  <span>Snap angles</span>
                </label>
              </div>
              <Toolbar onAdd={addPiece} />
            </div>

            {/* 2D Canvas Editor */}
            <div className="min-h-[260px] flex-1 overflow-hidden">
              <Editor2D
                track={track}
                built={built}
                simRef={simRef}
                theme={theme}
                selected={selected}
                snap={snap}
                onSelect={(i) => {
                  setSelected(i);
                  if (i != null) setTab('piece');
                }}
                onHoverPiece={setHoveredPiece}
                onChange={handleChange}
                onInsert={insertPiece}
                fitSignal={fitSignal}
              />
            </div>

            {/* Bottom tabbed workbench */}
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
              <div className="mb-3 flex gap-1 rounded-xl bg-slate-100 p-1">
                {(['piece', 'physics', 'telemetry', 'style'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-bold capitalize transition ${
                      tab === t
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {t === 'telemetry' ? 'Speed Graph' : t === 'piece' ? 'Piece Tuning' : t}
                  </button>
                ))}
              </div>

              {tab === 'piece' && (
                <Inspector
                  track={track}
                  index={selected}
                  lengthFt={selectedLengthFt}
                  onUpdate={updatePiece}
                  onDelete={deletePiece}
                  onDuplicate={duplicatePiece}
                  onMove={movePiece}
                  onSelect={setSelected}
                />
              )}

              {tab === 'physics' && (
                <div className="space-y-3.5">
                  {/* Material selection cards */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Coaster Material & Wheel Dynamics
                      </span>
                      <span className="text-[11px] font-medium text-slate-400">
                        Controls rolling resistance, chattering vibration & 3D textures
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {(
                        [
                          {
                            id: 'metal',
                            name: 'Tubular Steel (Metal)',
                            icon: '🔩',
                            badge: 'High Speed',
                            desc: 'Precision steel rails, polyurethane wheels, ultra-low rolling friction.',
                            defaultF: 0.007,
                          },
                          {
                            id: 'wood',
                            name: 'Timber Trestle (Wood)',
                            icon: '🪵',
                            badge: 'High Rumble',
                            desc: 'Laminated timber stack, steel running strips, authentic wooden track chatter.',
                            defaultF: 0.012,
                          },
                          {
                            id: 'plastic',
                            name: 'Polymer Guide (Plastic)',
                            icon: '🧱',
                            badge: 'Ultra Smooth',
                            desc: 'Molded polymer monorail/tubing, high slip coefficient, toy-like vibrance.',
                            defaultF: 0.005,
                          },
                        ] as const
                      ).map((m) => {
                        const active = settings.material === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => handleSelectMaterial(m.id)}
                            className={`flex flex-col text-left rounded-xl border p-2.5 transition ${
                              active
                                ? 'border-blue-600 bg-blue-50/70 shadow-xs ring-1 ring-blue-500'
                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                <span>{m.icon}</span>
                                <span>{m.name}</span>
                              </span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  active
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {m.badge}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                              {m.desc}
                            </p>
                            <div className="mt-2 text-[10px] font-mono font-semibold text-slate-400">
                              Base μ: {m.defaultF}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                    <MiniSlider
                      label="Gravity"
                      value={settings.gravity}
                      min={0.3}
                      max={2}
                      step={0.05}
                      fmt={(v) => `${v.toFixed(2)}×`}
                      onChange={(v) => setSettings((s) => ({ ...s, gravity: v }))}
                    />
                    <MiniSlider
                      label="Friction"
                      value={settings.friction}
                      min={0}
                      max={0.03}
                      step={0.001}
                      fmt={(v) => v.toFixed(3)}
                      onChange={(v) => setSettings((s) => ({ ...s, friction: v }))}
                    />
                    <MiniSlider
                      label="Air Drag"
                      value={settings.drag}
                      min={0}
                      max={0.003}
                      step={0.0001}
                      fmt={(v) => v.toFixed(4)}
                      onChange={(v) => setSettings((s) => ({ ...s, drag: v }))}
                    />
                    <MiniSlider
                      label="Launch Speed"
                      value={settings.launch}
                      min={0}
                      max={45}
                      step={0.5}
                      fmt={(v) => `${(v * MPH_PER_MPS).toFixed(0)} mph`}
                      onChange={(v) => setSettings((s) => ({ ...s, launch: v }))}
                    />
                    <MiniSlider
                      label="Lift Chain"
                      value={settings.liftSpeed}
                      min={2}
                      max={20}
                      step={0.5}
                      fmt={(v) => `${(v * MPH_PER_MPS).toFixed(0)} mph`}
                      onChange={(v) => setSettings((s) => ({ ...s, liftSpeed: v }))}
                    />
                    <MiniSlider
                      label="Boost Thrust"
                      value={settings.boostForce}
                      min={2}
                      max={45}
                      step={0.5}
                      fmt={(v) => `${(v * FT_PER_M).toFixed(0)} ft/s²`}
                      onChange={(v) => setSettings((s) => ({ ...s, boostForce: v }))}
                    />
                    <MiniSlider
                      label="Trim Brakes"
                      value={settings.brakeForce}
                      min={2}
                      max={35}
                      step={0.5}
                      fmt={(v) => `${(v * FT_PER_M).toFixed(0)} ft/s²`}
                      onChange={(v) => setSettings((s) => ({ ...s, brakeForce: v }))}
                    />
                    <div className="flex items-end">
                      <button
                        onClick={() => setSettings(DEFAULT_SETTINGS)}
                        className="w-full rounded-lg border border-slate-200 bg-white py-2 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-50"
                      >
                        Reset Physics
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'telemetry' && (
                <SpeedGraph
                  telemetry={hud.telemetry}
                  currentTime={hud.runTime}
                  currentSpeed={hud.speed}
                  maxSpeed={hud.maxSpeed}
                  airtime={hud.airtime}
                />
              )}

              {tab === 'style' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {THEMES.map((t) => (
                      <button
                        key={t.name}
                        onClick={() => setTheme(t)}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                          theme.name === t.name
                            ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-xs'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="flex gap-1">
                          <span className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10" style={{ background: t.spine }} />
                          <span className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10" style={{ background: t.car }} />
                        </span>
                        {t.name}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {(
                      [
                        ['Rails', 'rail'],
                        ['Spine', 'spine'],
                        ['Ties', 'tie'],
                        ['Train', 'car'],
                      ] as [string, keyof Theme][]
                    ).map(([label, key]) => (
                      <label
                        key={key}
                        className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2"
                      >
                        <input
                          type="color"
                          value={theme[key] as string}
                          onChange={(e) => setTheme((t) => ({ ...t, name: 'Custom', [key]: e.target.value }))}
                          className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                        />
                        <span className="text-xs font-bold text-slate-700">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ---------------------------------------------------- right: 3D Viewport */}
          <section
            className={`relative min-h-[380px] overflow-hidden rounded-2xl border border-slate-200 bg-sky-200 shadow-sm lg:min-h-0 ${
              layoutMode === 'wide-ride'
                ? 'lg:col-span-7'
                : layoutMode === 'focus-designer'
                  ? 'lg:col-span-5'
                  : ''
            }`}
          >
            <Ride3D
              built={built}
              simRef={simRef}
              theme={theme}
              material={settings.material}
              camMode={camMode}
            />
            <HUD hud={hud} camMode={camMode} setCamMode={setCamMode} playing={playing} />
          </section>
        </div>
      </main>

      {/* Import / Export Modal */}
      <ImportExportModal
        isOpen={importExportOpen}
        initialMode={importExportMode}
        onClose={() => setImportExportOpen(false)}
        track={track}
        settings={settings}
        theme={theme}
        stats={{
          lengthFt,
          heightFt,
          maxSpeedMph: hud.maxSpeed,
        }}
        onImport={handleImportCoaster}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="font-mono text-sm font-bold text-slate-800">{value}</div>
    </div>
  );
}
