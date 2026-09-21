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
  switch (clean) {
    case 'straight':
    case 'flat':
      return 'straight';
    case 'up':
    case 'climb':
    case 'lift':
    case 'lifthill':
      return 'up';
    case 'down':
    case 'drop':
    case 'dive':
      return 'down';
    case 'curvel':
    case 'left':
    case 'turnleft':
      return 'curveL';
    case 'curver':
    case 'right':
    case 'turnright':
      return 'curveR';
    case 'hill':
    case 'camelback':
    case 'airtimehill':
      return 'hill';
    case 'valley':
    case 'dip':
      return 'valley';
    case 'loop':
    case 'verticalloop':
      return 'loop';
    case 'zerogroll':
    case 'zerog':
    case 'barrelroll':
      return 'zeroGRoll';
    case 'corkscrew':
    case 'screw':
      return 'corkscrew';
    case 'immelmann':
    case 'immelman':
      return 'immelmann';
    case 'jump':
    case 'gap':
    case 'airjump':
      return 'jump';
    case 'boost':
    case 'booster':
    case 'launch':
    case 'lsm':
      return 'boost';
    case 'brake':
    case 'brakes':
    case 'trim':
      return 'brake';
    default:
      return 'straight';
  }
}

function cleanJsonString(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  // Strip trailing commas before } or ]
  text = text.replace(/,\s*([\]}])/g, '$1');
  return text;
}

export default function ImportExportModal({
  isOpen,
  initialMode,
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
  const [pasteText, setPasteText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setCopied(false);
      setPasteText('');
      setImportError(null);
    }
  }, [isOpen, initialMode]);

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
      const cleaned = cleanJsonString(rawText);
      const parsed = JSON.parse(cleaned);

      // Case 0: Standalone Physics Settings JSON
      if (
        parsed.format === 'coaster-physics-settings' ||
        (parsed.settings && typeof parsed.settings.friction === 'number') ||
        (typeof parsed.friction === 'number' && typeof parsed.gravity === 'number')
      ) {
        const targetSettings: SimSettings = parsed.settings || parsed;
        return {
          track,
          settings: targetSettings,
          theme: undefined,
          name: parsed.name || 'Custom Physics Settings',
          isSettingsOnly: true,
        };
      }

      let targetTrack: { origin?: any; startPitch?: any; pieces: any[] } | null = null;
      let targetSettings: SimSettings | undefined;
      let targetTheme: Theme | undefined;
      let importedName: string | undefined;

      // Case 1: Full CoasterProject format
      if (parsed.track && Array.isArray(parsed.track.pieces)) {
        targetTrack = parsed.track;
        targetSettings = parsed.settings;
        targetTheme = parsed.theme;
        importedName = parsed.name;
      }
      // Case 2: Bare TrackDef ({ origin, startPitch, pieces })
      else if (Array.isArray(parsed.pieces)) {
        targetTrack = {
          origin: parsed.origin,
          startPitch: parsed.startPitch,
          pieces: parsed.pieces,
        };
        targetSettings = parsed.settings;
        targetTheme = parsed.theme;
        importedName = parsed.name;
      }
      // Case 3: Direct Array of pieces [ { kind: 'straight' }, ... ] or [ "straight", "loop", ... ]
      else if (Array.isArray(parsed)) {
        targetTrack = {
          origin: { x: 0, y: 30 },
          startPitch: 0,
          pieces: parsed,
        };
      } else {
        setImportError('Invalid JSON format: could not locate track "pieces" or physics "settings".');
        return null;
      }

      if (!targetTrack) {
        setImportError('Invalid coaster track definition.');
        return null;
      }

      // Sanitize pieces
      const sanitizedPieces: Piece[] = targetTrack.pieces.map((p: any, idx: number) => {
        if (typeof p === 'string') {
          return {
            id: `imp_${idx}_${Math.random().toString(36).slice(2, 6)}`,
            kind: normalizePieceKind(p),
            len: 1,
            power: 1,
            rot: 0,
          };
        }
        const rawKind = p?.kind || p?.type || 'straight';
        const kind = normalizePieceKind(rawKind);
        const lenVal = typeof p?.len === 'number' ? p.len : parseFloat(p?.len);
        const powerVal = typeof p?.power === 'number' ? p.power : parseFloat(p?.power);
        const rotVal = typeof p?.rot === 'number' ? p.rot : parseFloat(p?.rot);

        return {
          id: p?.id || `imp_${idx}_${Math.random().toString(36).slice(2, 6)}`,
          kind,
          len: !isNaN(lenVal) && lenVal > 0.1 ? Math.min(3, Math.max(0.2, lenVal)) : 1,
          power: !isNaN(powerVal) && powerVal > 0.1 ? Math.min(2.5, Math.max(0.1, powerVal)) : 1,
          rot: !isNaN(rotVal) ? Math.max(-90, Math.min(90, rotVal)) : 0,
        };
      });

      if (sanitizedPieces.length === 0) {
        setImportError('The track file contains no track pieces.');
        return null;
      }

      let originX = 0;
      let originY = 30;
      if (targetTrack.origin) {
        if (Array.isArray(targetTrack.origin)) {
          originX = Number(targetTrack.origin[0]) || 0;
          originY = Number(targetTrack.origin[1]) || 30;
        } else {
          originX = typeof targetTrack.origin.x === 'number' ? targetTrack.origin.x : (parseFloat(targetTrack.origin.x) || 0);
          originY = typeof targetTrack.origin.y === 'number' ? targetTrack.origin.y : (parseFloat(targetTrack.origin.y) || 30);
        }
      }

      const finalTrack: TrackDef = {
        origin: { x: originX, y: originY },
        startPitch: typeof targetTrack.startPitch === 'number' ? targetTrack.startPitch : (parseFloat(targetTrack.startPitch) || 0),
        pieces: sanitizedPieces,
      };

      return {
        track: finalTrack,
        settings: targetSettings,
        theme: targetTheme,
        name: importedName,
        isSettingsOnly: false,
      };
    } catch (err: any) {
      setImportError(`JSON Syntax Error: ${err?.message || 'Invalid JSON'}`);
      return null;
    }
  };

  const currentParsed = useMemo(() => {
    if (mode !== 'import' || !pasteText) return null;
    return parseImportData(pasteText);
  }, [mode, pasteText]);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
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
  };

  const readFile = (file: File) => {
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
                    ? 'border-blue-500 bg-blue-50/70'
                    : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 shadow-sm">
                  <Upload className="h-6 w-6" />
                </div>
                <div className="mt-3 text-sm font-bold text-slate-800">Drop a coaster .json file here</div>
                <p className="mt-1 text-xs text-slate-500">or click to browse from your computer</p>
              </div>

              {/* Paste Text Area */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
                  Or Paste JSON Text
                </label>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder='Paste valid Coaster Forge JSON or raw track object here...'
                  rows={5}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 shadow-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
                />
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
                          ? `Valid Physics Settings: ${currentParsed.name || 'Custom Physics'}`
                          : `Valid Track: ${currentParsed.name || 'Imported Coaster'}`}
                      </span>
                    </div>
                    {!currentParsed.isSettingsOnly && (
                      <span className="font-mono font-semibold text-emerald-800">
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
              disabled={!pasteText.trim() || !!importError}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-blue-200 hover:bg-blue-500 disabled:opacity-40"
            >
              <Upload className="h-4 w-4" />
              {currentParsed?.isSettingsOnly ? 'Apply Settings' : 'Load Coaster'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
