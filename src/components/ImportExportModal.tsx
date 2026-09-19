import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Upload, Copy, Check, FileCode, AlertCircle, X, Sparkles } from 'lucide-react';
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
  }) => void;
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
      settings,
      theme,
    };
    return JSON.stringify(project, null, 2);
  }, [coasterName, track, settings, theme, stats]);

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

  // Download .json file
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

  // Validate and parse raw imported JSON string
  const parseImportData = (rawText: string) => {
    setImportError(null);
    if (!rawText.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(rawText);
      let targetTrack: TrackDef | null = null;
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
          origin: parsed.origin || { x: 0, y: 30 },
          startPitch: typeof parsed.startPitch === 'number' ? parsed.startPitch : 0,
          pieces: parsed.pieces,
        };
      } else {
        setImportError('Invalid JSON structure: could not locate "pieces" array in coaster data.');
        return null;
      }

      if (!targetTrack) {
        setImportError('Invalid coaster track definition.');
        return null;
      }

      // Sanitize pieces
      const validKinds: Set<string> = new Set([
        'straight',
        'up',
        'down',
        'hill',
        'valley',
        'curveL',
        'curveR',
        'loop',
        'boost',
        'brake',
      ]);

      const sanitizedPieces: Piece[] = targetTrack.pieces.map((p: any, idx: number) => {
        const kind: PieceKind = validKinds.has(p.kind) ? p.kind : 'straight';
        return {
          id: p.id || `imp_${idx}_${Math.random().toString(36).slice(2, 6)}`,
          kind,
          len: typeof p.len === 'number' && p.len > 0.1 ? Math.min(3, p.len) : 1,
          power: typeof p.power === 'number' && p.power > 0.1 ? Math.min(2.5, p.power) : 1,
          rot: typeof p.rot === 'number' ? Math.max(-90, Math.min(90, p.rot)) : 0,
        };
      });

      if (sanitizedPieces.length === 0) {
        setImportError('The track file contains no track pieces.');
        return null;
      }

      const finalTrack: TrackDef = {
        origin: {
          x: typeof targetTrack.origin?.x === 'number' ? targetTrack.origin.x : 0,
          y: typeof targetTrack.origin?.y === 'number' ? targetTrack.origin.y : 30,
        },
        startPitch: typeof targetTrack.startPitch === 'number' ? targetTrack.startPitch : 0,
        pieces: sanitizedPieces,
      };

      return {
        track: finalTrack,
        settings: targetSettings,
        theme: targetTheme,
        name: importedName,
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
                <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-600" />
                    <span className="font-bold text-emerald-900">
                      Valid track detected: {currentParsed.name || 'Imported Coaster'}
                    </span>
                  </div>
                  <span className="font-mono font-semibold text-emerald-800">
                    {currentParsed.track.pieces.length} pieces
                  </span>
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
              Load Coaster
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
