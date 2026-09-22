import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Upload, Copy, Check, FileCode, AlertCircle, X, Sparkles, Sliders } from 'lucide-react';
import { TrackDef, Piece, PieceKind } from '../lib/track';
import { SimSettings } from '../lib/physics';
import { Theme } from '../lib/themes';

export interface CoasterProject {
  format: 'coaster-forge';
  version: string;
  name: string;
  exportedAt: string;
  stats?: {
    pieces: number;
    lengthFt?: number;
    heightFt?: number;
    maxSpeedMph?: number;
  };
  track: TrackDef;
  settings?: SimSettings;
  theme?: Theme;
}

export interface PhysicsSettingsExport {
  format: 'coaster-physics-settings';
  version: string;
  name: string;
  exportedAt: string;
  settings: SimSettings;
}

interface Props {
  isOpen: boolean;
  initialMode: 'export' | 'import';
  initialImportText?: string;
  onClose: () => void;
  track: TrackDef;
  settings: SimSettings;
  theme: Theme;
  stats: {
    lengthFt: number;
    heightFt: number;
    maxSpeedMph: number;
  };
  onImport: (data: {
    track: TrackDef;
    settings?: SimSettings;
    theme?: Theme;
    name?: string;
    isSettingsOnly?: boolean;
  }) => void;
}

function normalizePieceKind(raw: any): PieceKind {
  if (typeof raw !== 'string') return 'straight';
  const clean = raw.toLowerCase().replace(/[-_\s]/g, '');

  if (/^(straight|flat|level|station|platform|track)$/.test(clean)) return 'straight';
  if (/^(up|lift|chain|chainlift|climb|incline|ascent|steepup)$/.test(clean)) return 'up';
  if (/^(down|drop|dive|descent|decline|steepdown)$/.test(clean)) return 'down';
  if (/^(curvel|left|turnleft|turnl|bankleft|curveleft)$/.test(clean)) return 'curveL';
  if (/^(curver|right|turnright|turnr|bankright|curveright)$/.test(clean)) return 'curveR';
  if (/^(hill|camelback|airtime|airtimehill|crest|bunnyhop|hop)$/.test(clean)) return 'hill';
  if (/^(valley|dip|trough|compression|bottom)$/.test(clean)) return 'valley';
  if (/^(loop|verticalloop|vertical_loop|inversion|looping)$/.test(clean)) return 'loop';
  if (/^(zerogroll|zerog|barrelroll|roll|heartline|heartlineroll|inlineroll|inline)$/.test(clean)) return 'zeroGRoll';
  if (/^(corkscrew|cork_screw|screw|flatspin)$/.test(clean)) return 'corkscrew';
  if (/^(immelmann|immelman|diveloop|dive_loop|halfloop)$/.test(clean)) return 'immelmann';
  if (/^(jump|airjump|gap)$/.test(clean)) return 'jump';
  if (/^(boost|booster|launch|lsm|accelerator|acceleration)$/.test(clean)) return 'boost';
  if (/^(brake|brakes|trim|trimbrake|stationbrake|finbrake)$/.test(clean)) return 'brake';

  return 'straight';
}

function parseJsonLenient(raw: string): any {
  let text = raw.replace(/^\uFEFF/, '').trim();
  // Strip markdown code fences
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  // Strip comments
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  text = text.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // Strip trailing commas before closing braces or brackets
  text = text.replace(/,\s*([\]}])/g, '$1');

  try {
    return JSON.parse(text);
  } catch (err1) {
    try {
      // Attempt relaxed JSON: convert unquoted keys and single quotes
      const relaxed = text
        .replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
        .replace(/:\s*'([^']*)'/g, ':"$1"')
        .replace(/,\s*([\]}])/g, '$1');
      return JSON.parse(relaxed);
    } catch {
      throw err1;
    }
  }
}

const SAMPLE_COASTERS = [
  {
    name: 'Giga Hyperion (Airtime Monster)',
    json: JSON.stringify(
      {
        format: 'coaster-forge',
        name: 'Giga Hyperion',
        track: {
          origin: { x: 0, y: 35 },
          startPitch: 0,
          pieces: [
            { kind: 'straight', len: 1.0 },
            { kind: 'up', len: 1.3, power: 1.2 },
            { kind: 'up', len: 1.3, power: 1.2 },
            { kind: 'up', len: 1.3, power: 1.2 },
            { kind: 'down', len: 1.4, power: 1.5 },
            { kind: 'down', len: 1.4, power: 1.5 },
            { kind: 'valley', len: 1.2 },
            { kind: 'hill', len: 1.4, power: 1.2 },
            { kind: 'valley', len: 1.1 },
            { kind: 'curveR', len: 1.2, power: 1.1 },
            { kind: 'curveR', len: 1.2, power: 1.1 },
            { kind: 'hill', len: 1.3, power: 1.15 },
            { kind: 'valley', len: 1.0 },
            { kind: 'curveL', len: 1.2, power: 1.1 },
            { kind: 'curveL', len: 1.2, power: 1.1 },
            { kind: 'hill', len: 1.1 },
            { kind: 'brake', len: 1.3 },
            { kind: 'straight', len: 1.0 },
          ],
        },
        settings: {
          friction: 0.006,
          drag: 0.00035,
          gravity: 9.81,
          trainMassKg: 5000,
          gBuffer: 1.8,
          material: 'metal',
        },
      },
      null,
      2,
    ),
  },
  {
    name: 'Vortex Viper (Multi-Inversion)',
    json: JSON.stringify(
      {
        format: 'coaster-forge',
        name: 'Vortex Viper',
        track: {
          origin: { x: 0, y: 30 },
          startPitch: 0,
          pieces: [
            { kind: 'straight', len: 1.0 },
            { kind: 'boost', len: 1.4 },
            { kind: 'up', len: 1.2, power: 1.4 },
            { kind: 'down', len: 1.2, power: 1.4 },
            { kind: 'valley', len: 1.1 },
            { kind: 'loop', len: 1.1 },
            { kind: 'immelmann', len: 1.1 },
            { kind: 'curveL', len: 1.2, power: 1.1 },
            { kind: 'curveL', len: 1.2, power: 1.1 },
            { kind: 'zeroGRoll', len: 1.0 },
            { kind: 'corkscrew', len: 1.0 },
            { kind: 'brake', len: 1.4 },
            { kind: 'straight', len: 1.0 },
          ],
        },
      },
      null,
      2,
    ),
  },
];

export default function ImportExportModal({
  isOpen,
  initialMode,
  initialImportText,
  onClose,
  track,
  settings,
  theme,
  stats,
  onImport,
}: Props) {
  const [mode, setMode] = useState<'export' | 'import'>(initialMode);
  const [coasterName, setCoasterName] = useState('My Custom Coaster');
  const [includeSettings, setIncludeSettings] = useState(true);
  const [includeTheme, setIncludeTheme] = useState(true);
  const [copied, setCopied] = useState(false);
  const [pasteText, setPasteText] = useState(initialImportText || '');
  const [importError, setImportError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setCopied(false);
      setPasteText(initialImportText || '');
      setImportError(null);
    }
  }, [isOpen, initialMode, initialImportText]);

  // Generate full export project
  const exportJson = useMemo(() => {
    const project: CoasterProject = {
      format: 'coaster-forge',
      version: '1.0',
      name: coasterName.trim() || 'Custom Coaster',
      exportedAt: new Date().toISOString(),
      stats: {
        pieces: track.pieces.length,
        lengthFt: Math.round(stats.lengthFt),
        heightFt: Math.round(stats.heightFt),
        maxSpeedMph: Math.round(stats.maxSpeedMph),
      },
      track,
      ...(includeSettings ? { settings } : {}),
      ...(includeTheme ? { theme } : {}),
    };
    return JSON.stringify(project, null, 2);
  }, [coasterName, track, settings, theme, stats, includeSettings, includeTheme]);

  // Copy to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = exportJson;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Download coaster .json file
  const handleDownload = () => {
    const slug = (coasterName.trim() || 'coaster')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const blob = new Blob([exportJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'coaster'}-track.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Download physics settings only .json file
  const handleDownloadSettingsOnly = () => {
    const physicsExport: PhysicsSettingsExport = {
      format: 'coaster-physics-settings',
      version: '1.0',
      name: `${coasterName.trim() || 'Coaster'} Physics Settings`,
      exportedAt: new Date().toISOString(),
      settings,
    };
    const jsonStr = JSON.stringify(physicsExport, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'coaster-physics-settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Validate and parse raw imported JSON string
  const parseImportData = (rawText: string) => {
    setImportError(null);
    if (!rawText.trim()) {
      return null;
    }
    try {
      const parsed = parseJsonLenient(rawText);
      if (!parsed || typeof parsed !== 'object') {
        setImportError('Invalid JSON format: expected a JSON object or array.');
        return null;
      }

      // Step 1: Detect track pieces first across all possible structures!
      let rawPieces: any[] | null = null;
      let targetTrackOrigin: any = null;
      let targetStartPitch: any = null;
      let targetSettings: SimSettings | undefined = undefined;
      let targetTheme: Theme | undefined = undefined;
      let importedName: string | undefined = undefined;

      // Check standard format: { track: { pieces: [...] }, ... }
      if (parsed.track && Array.isArray(parsed.track.pieces)) {
        rawPieces = parsed.track.pieces;
        targetTrackOrigin = parsed.track.origin;
        targetStartPitch = parsed.track.startPitch;
        targetSettings = parsed.settings;
        targetTheme = parsed.theme;
        importedName = parsed.name;
      }
      // Check bare track: { pieces: [...] }
      else if (Array.isArray(parsed.pieces)) {
        rawPieces = parsed.pieces;
        targetTrackOrigin = parsed.origin;
        targetStartPitch = parsed.startPitch;
        targetSettings = parsed.settings;
        targetTheme = parsed.theme;
        importedName = parsed.name;
      }
      // Check direct array of pieces: [ ... ]
      else if (Array.isArray(parsed)) {
        rawPieces = parsed;
      }
      // Check nested coaster object: { coaster: { track: { pieces: [...] } } } or { coaster: { pieces: [...] } }
      else if (parsed.coaster) {
        if (parsed.coaster.track && Array.isArray(parsed.coaster.track.pieces)) {
          rawPieces = parsed.coaster.track.pieces;
          targetTrackOrigin = parsed.coaster.track.origin;
          targetStartPitch = parsed.coaster.track.startPitch;
        } else if (Array.isArray(parsed.coaster.pieces)) {
          rawPieces = parsed.coaster.pieces;
          targetTrackOrigin = parsed.coaster.origin;
          targetStartPitch = parsed.coaster.startPitch;
        } else if (Array.isArray(parsed.coaster)) {
          rawPieces = parsed.coaster;
        }
        targetSettings = parsed.settings || parsed.coaster.settings;
        targetTheme = parsed.theme || parsed.coaster.theme;
        importedName = parsed.name || parsed.coaster.name;
      }
      // Check elements or segments or layout: { elements: [...] } or { segments: [...] }
      else if (Array.isArray(parsed.elements)) {
        rawPieces = parsed.elements;
        targetTrackOrigin = parsed.origin;
        targetStartPitch = parsed.startPitch;
        targetSettings = parsed.settings;
        targetTheme = parsed.theme;
        importedName = parsed.name;
      } else if (Array.isArray(parsed.segments)) {
        rawPieces = parsed.segments;
        targetTrackOrigin = parsed.origin;
        targetStartPitch = parsed.startPitch;
        targetSettings = parsed.settings;
        targetTheme = parsed.theme;
        importedName = parsed.name;
      } else if (Array.isArray(parsed.layout)) {
        rawPieces = parsed.layout;
        targetTrackOrigin = parsed.origin;
        targetStartPitch = parsed.startPitch;
        targetSettings = parsed.settings;
        targetTheme = parsed.theme;
        importedName = parsed.name;
      } else if (parsed.data && Array.isArray(parsed.data.pieces)) {
        rawPieces = parsed.data.pieces;
        targetTrackOrigin = parsed.data.origin;
        targetStartPitch = parsed.data.startPitch;
        targetSettings = parsed.settings || parsed.data.settings;
        targetTheme = parsed.theme || parsed.data.theme;
        importedName = parsed.name || parsed.data.name;
      }

      // Step 2: If NO track pieces found, check if this is a Standalone Physics Settings file
      if (!rawPieces || rawPieces.length === 0) {
        const isPhysicsSettings =
          parsed.format === 'coaster-physics-settings' ||
          (parsed.settings && typeof parsed.settings.friction === 'number') ||
          (typeof parsed.friction === 'number' && typeof parsed.gravity === 'number');

        if (isPhysicsSettings) {
          const rawPhys = parsed.settings || parsed;
          const physSettings: SimSettings = {
            friction: typeof rawPhys.friction === 'number' ? rawPhys.friction : (parseFloat(rawPhys.friction) || settings.friction),
            drag: typeof rawPhys.drag === 'number' ? rawPhys.drag : (parseFloat(rawPhys.drag) || settings.drag),
            gravity: typeof rawPhys.gravity === 'number' ? rawPhys.gravity : (parseFloat(rawPhys.gravity) || settings.gravity),
            liftSpeed: typeof rawPhys.liftSpeed === 'number' ? rawPhys.liftSpeed : (parseFloat(rawPhys.liftSpeed) || settings.liftSpeed),
            launch: typeof rawPhys.launch === 'number' ? rawPhys.launch : (parseFloat(rawPhys.launch) || settings.launch),
            brakeForce: typeof rawPhys.brakeForce === 'number' ? rawPhys.brakeForce : (parseFloat(rawPhys.brakeForce) || settings.brakeForce),
            boostForce: typeof rawPhys.boostForce === 'number' ? rawPhys.boostForce : (parseFloat(rawPhys.boostForce) || settings.boostForce),
            gForceBuffer: typeof (rawPhys.gForceBuffer ?? rawPhys.gBuffer) === 'number' ? (rawPhys.gForceBuffer ?? rawPhys.gBuffer) : (parseFloat(rawPhys.gForceBuffer ?? rawPhys.gBuffer) || settings.gForceBuffer),
            material: ['metal', 'wood', 'plastic'].includes(rawPhys.material) ? rawPhys.material : settings.material,
          };
          return {
            track,
            settings: physSettings,
            theme: undefined,
            name: parsed.name || 'Custom Physics Settings',
            isSettingsOnly: true,
          };
        }

        setImportError('Invalid coaster JSON: Could not find any track "pieces" or physics "settings".');
        return null;
      }

      // Step 3: Sanitize and normalize all pieces (including boostIntensity)
      const sanitizedPieces: Piece[] = rawPieces.map((p: any, idx: number) => {
        if (typeof p === 'string') {
          return {
            id: `imp_${idx}_${Math.random().toString(36).slice(2, 6)}`,
            kind: normalizePieceKind(p),
            len: 1,
            power: 1,
            rot: 0,
          };
        }
        const rawKind = p?.kind || p?.type || p?.piece || p?.element || 'straight';
        const kind = normalizePieceKind(rawKind);
        const lenVal = typeof p?.len === 'number' ? p.len : parseFloat(p?.len ?? p?.length ?? p?.scale);
        const powerVal = typeof p?.power === 'number' ? p.power : parseFloat(p?.power ?? p?.pitch ?? p?.intensity);
        const rotVal = typeof p?.rot === 'number' ? p.rot : parseFloat(p?.rot ?? p?.rotation ?? p?.yaw ?? p?.angle);

        // Parse piece-specific boost intensity
        const rawBoost = p?.boostIntensity ?? p?.boost_intensity ?? (kind === 'boost' ? (p?.intensity ?? p?.power) : undefined);
        const boostVal = typeof rawBoost === 'number' ? rawBoost : parseFloat(rawBoost);
        const boostIntensity = !isNaN(boostVal) && boostVal > 0 ? Math.min(3.0, Math.max(0.2, boostVal)) : undefined;

        return {
          id: p?.id ? String(p.id) : `imp_${idx}_${Math.random().toString(36).slice(2, 6)}`,
          kind,
          len: !isNaN(lenVal) && lenVal > 0.1 ? Math.min(3, Math.max(0.2, lenVal)) : 1,
          power: !isNaN(powerVal) && powerVal > 0.1 ? Math.min(2.5, Math.max(0.1, powerVal)) : 1,
          rot: !isNaN(rotVal) ? Math.max(-90, Math.min(90, rotVal)) : 0,
          ...(boostIntensity !== undefined ? { boostIntensity } : {}),
        };
      });

      if (sanitizedPieces.length === 0) {
        setImportError('The track file contains no track pieces.');
        return null;
      }

      let originX = 0;
      let originY = 30;
      if (targetTrackOrigin) {
        if (Array.isArray(targetTrackOrigin)) {
          originX = Number(targetTrackOrigin[0]) || 0;
          originY = Number(targetTrackOrigin[1]) || 30;
        } else {
          originX = typeof targetTrackOrigin.x === 'number' ? targetTrackOrigin.x : (parseFloat(targetTrackOrigin.x) || 0);
          originY = typeof targetTrackOrigin.y === 'number' ? targetTrackOrigin.y : (parseFloat(targetTrackOrigin.y) || 30);
        }
      }

      // Extract and sanitize gravity, friction, and full physics configuration
      let finalSettings: SimSettings | undefined = undefined;
      const rawSettingsSource = targetSettings || parsed.settings || parsed.physics || (typeof parsed.friction === 'number' || typeof parsed.gravity === 'number' ? parsed : undefined);
      if (rawSettingsSource && typeof rawSettingsSource === 'object') {
        const parseNum = (v: any, fallback: number) => {
          const n = typeof v === 'number' ? v : parseFloat(v);
          return !isNaN(n) ? n : fallback;
        };
        finalSettings = {
          friction: parseNum(rawSettingsSource.friction, settings.friction),
          drag: parseNum(rawSettingsSource.drag, settings.drag),
          gravity: parseNum(rawSettingsSource.gravity, settings.gravity),
          liftSpeed: parseNum(rawSettingsSource.liftSpeed, settings.liftSpeed),
          launch: parseNum(rawSettingsSource.launch, settings.launch),
          brakeForce: parseNum(rawSettingsSource.brakeForce, settings.brakeForce),
          boostForce: parseNum(rawSettingsSource.boostForce, settings.boostForce),
          gForceBuffer: parseNum(rawSettingsSource.gForceBuffer ?? rawSettingsSource.gBuffer, settings.gForceBuffer ?? 0.25),
          material: ['metal', 'wood', 'plastic'].includes(rawSettingsSource.material) ? rawSettingsSource.material : settings.material,
        };
      }

      const finalTrack: TrackDef = {
        origin: { x: originX, y: originY },
        startPitch: typeof targetStartPitch === 'number' ? targetStartPitch : (parseFloat(targetStartPitch) || 0),
        pieces: sanitizedPieces,
      };

      return {
        track: finalTrack,
        settings: finalSettings,
        theme: targetTheme,
        name: importedName || parsed.name,
        isSettingsOnly: false,
      };
    } catch (err: any) {
      setImportError(`JSON Parse Error: ${err?.message || 'Invalid JSON syntax'}`);
      return null;
    }
  };

  const currentParsed = useMemo(() => {
    if (mode !== 'import' || !pasteText) return null;
    return parseImportData(pasteText);
  }, [mode, pasteText]);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      readFile(file);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      readFile(file);
    }
    // reset input value so re-selecting same file triggers onChange
    e.target.value = '';
  };

  const readFile = (file: File) => {
    setImportError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setPasteText(content);
      }
    };
    reader.onerror = () => {
      setImportError('Failed to read file from disk.');
    };
    reader.readAsText(file);
  };

  const executeImport = () => {
    const parsed = parseImportData(pasteText);
    if (!parsed) return;
    onImport(parsed);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <FileCode className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Track JSON Import &amp; Export</h3>
              <p className="text-xs text-slate-500">Save your coaster creations or load community tracks</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50/75 px-6 pt-3">
          <button
            onClick={() => setMode('export')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition ${
              mode === 'export'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Download className="h-4 w-4" />
            Export Coaster (.json)
          </button>
          <button
            onClick={() => setMode('import')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-bold transition ${
              mode === 'import'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Upload className="h-4 w-4" />
            Import Coaster (.json)
          </button>
        </div>

        {/* Body Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {mode === 'export' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                  Coaster Name
                </label>
                <input
                  type="text"
                  value={coasterName}
                  onChange={(e) => setCoasterName(e.target.value)}
                  placeholder="E.g., Lightning Rod, Nitro, Hyperion..."
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              {/* Stats Summary Card */}
              <div className="grid grid-cols-4 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Pieces</div>
                  <div className="text-sm font-bold font-mono text-slate-800">{track.pieces.length}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Length</div>
                  <div className="text-sm font-bold font-mono text-slate-800">{Math.round(stats.lengthFt)} ft</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Peak Height</div>
                  <div className="text-sm font-bold font-mono text-slate-800">{Math.round(stats.heightFt)} ft</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Top Speed</div>
                  <div className="text-sm font-bold font-mono text-slate-800">{Math.round(stats.maxSpeedMph)} mph</div>
                </div>
              </div>

              {/* Optional Settings Toggles */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/75 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Export JSON Options
                  </span>
                  <button
                    type="button"
                    onClick={handleDownloadSettingsOnly}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-xs hover:bg-slate-50 hover:text-blue-600"
                    title="Export friction, drag, and G-buffer as a standalone settings JSON file"
                  >
                    <Sliders className="h-3 w-3 text-blue-600" />
                    <span>Save Physics Settings (.json)</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5 font-medium text-slate-700 transition hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={includeSettings}
                      onChange={(e) => setIncludeSettings(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <div className="font-bold text-slate-800">Save Physics Settings</div>
                      <div className="text-[10px] text-slate-500">Friction, drag, gravity &amp; G-buffer</div>
                    </div>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5 font-medium text-slate-700 transition hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={includeTheme}
                      onChange={(e) => setIncludeTheme(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <div className="font-bold text-slate-800">Save Color Theme</div>
                      <div className="text-[10px] text-slate-500">Rails, spine, ties &amp; car colors</div>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">JSON Payload</span>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-600">Copied to Clipboard!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy JSON</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="max-h-56 overflow-auto rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs font-mono text-emerald-400 shadow-inner">
                  <pre className="whitespace-pre-wrap">{exportJson}</pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Drag & Drop Area */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition ${
                  isDragOver
                    ? 'border-blue-500 bg-blue-50/80 shadow-inner'
                    : 'border-slate-200 bg-slate-50/60 hover:border-blue-400 hover:bg-slate-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.txt,application/json,text/plain"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 shadow-sm">
                  <Upload className="h-6 w-6" />
                </div>
                <div className="mt-3 text-sm font-bold text-slate-800">Drop a coaster .json file here</div>
                <p className="mt-1 text-xs text-slate-500">or click to browse from your computer</p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50"
                >
                  Browse Files...
                </button>
              </div>

              {/* Paste Text Area */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                    Or Paste JSON Text
                  </label>
                  {pasteText && (
                    <button
                      type="button"
                      onClick={() => {
                        setPasteText('');
                        setImportError(null);
                      }}
                      className="text-[11px] font-semibold text-slate-400 hover:text-rose-600"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder='Paste valid Coaster Forge JSON, TrackDef object, or pieces array here...'
                  rows={5}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 shadow-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
                />
              </div>

              {/* Quick Preset Samples to test instantly */}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sample JSONs:</span>
                {SAMPLE_COASTERS.map((sample) => (
                  <button
                    key={sample.name}
                    type="button"
                    onClick={() => {
                      setPasteText(sample.json);
                      setImportError(null);
                    }}
                    className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition"
                  >
                    + {sample.name}
                  </button>
                ))}
              </div>

              {/* Status / Preview */}
              {importError && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{importError}</span>
                </div>
              )}

              {currentParsed && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-emerald-600" />
                      <span className="font-bold text-emerald-900">
                        {currentParsed.isSettingsOnly
                          ? `Ready to Apply: ${currentParsed.name || 'Custom Physics'}`
                          : `Ready to Load: ${currentParsed.name || 'Custom Coaster'}`}
                      </span>
                    </div>
                    {!currentParsed.isSettingsOnly && (
                      <span className="rounded-md bg-emerald-100 px-2 py-0.5 font-mono text-xs font-bold text-emerald-800">
                        {currentParsed.track.pieces.length} pieces
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 px-1 text-[11px] text-slate-600">
                    {currentParsed.settings && (
                      <span className="flex items-center gap-1 font-medium text-blue-700">
                        <Sliders className="h-3 w-3 text-blue-600" /> Includes physics settings (Friction, Drag, G-Buffer)
                      </span>
                    )}
                    {currentParsed.theme && (
                      <span className="font-medium text-purple-700">
                        • Includes custom color theme
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          {mode === 'export' ? (
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-blue-200 hover:bg-blue-500"
              >
                <Download className="h-4 w-4" />
                Download File
              </button>
            </div>
          ) : (
            <button
              onClick={executeImport}
              disabled={!pasteText.trim() || !!importError || !currentParsed}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-blue-200 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Upload className="h-4 w-4" />
              {currentParsed?.isSettingsOnly
                ? 'Apply Physics Settings'
                : currentParsed
                  ? `Load Coaster (${currentParsed.track.pieces.length} pieces)`
                  : 'Load Coaster'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
