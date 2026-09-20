import { PIECE_DEFS, Piece, TrackDef } from '../lib/track';

interface Props {
  track: TrackDef;
  index: number | null;
  lengthFt: number;
  onUpdate: (index: number, patch: Partial<Piece>) => void;
  onDelete: (index: number) => void;
  onDuplicate: (index: number) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onSelect: (i: number | null) => void;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
        <span className="font-mono text-xs font-semibold text-slate-800">
          {value.toFixed(step < 0.1 ? 2 : 1)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-blue-600 outline-none transition-colors hover:bg-slate-300 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:shadow-md"
      />
    </label>
  );
}

export default function Inspector({
  track,
  index,
  lengthFt,
  onUpdate,
  onDelete,
  onDuplicate,
  onMove,
  onSelect,
}: Props) {
  const piece = index != null ? track.pieces[index] : undefined;

  if (!piece || index == null) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4">
        <p className="text-xs leading-relaxed text-slate-500">
          <span className="font-bold text-slate-700">No track piece selected.</span> Click any section of
          track in the 2D designer to tune its length, steepness, or banking. You can also drag end-nodes
          directly to reshape, or drag the station marker to relocate the coaster circuit.
        </p>
      </div>
    );
  }

  const def = PIECE_DEFS[piece.kind];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg shadow-sm"
          style={{ backgroundColor: `${def.color}1f`, color: def.color }}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4.5 w-4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={def.glyph} />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 truncate">
            <span className="text-sm font-bold text-slate-900">{def.label}</span>
            <span className="font-mono text-xs font-semibold text-slate-400">#{index + 1}</span>
          </div>
          <div className="truncate text-xs font-medium text-slate-500">
            {lengthFt.toFixed(1)} ft · {def.hint.toLowerCase()}
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
            title="Move earlier in circuit"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-30"
          >
            ‹
          </button>
          <button
            onClick={() => onMove(index, 1)}
            disabled={index === track.pieces.length - 1}
            title="Move later in circuit"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                <span>🚀 Mid-Air Jump</span>
                <span className="rounded bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-800">
                  Key: E
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-amber-700">
                {piece.kind === 'jump'
                  ? 'Track gap cut out with ballistic jump launch & receiving hopper.'
                  : 'Convert this section into a physical jump gap with zero rail friction.'}
              </p>
            </div>
            {piece.kind === 'jump' ? (
              <button
                onClick={() => onUpdate(index, { kind: 'straight' })}
                className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-bold text-amber-800 shadow-xs transition hover:bg-amber-100"
              >
                Restore Track
              </button>
            ) : (
              <button
                onClick={() => onUpdate(index, { kind: 'jump' })}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-amber-600 active:scale-95"
              >
                Jump [E]
              </button>
            )}
          </div>
        </div>

        <Slider
          label="Length Factor"
          value={piece.len}
          min={0.4}
          max={2.4}
          step={0.05}
          suffix="×"
          onChange={(v) => onUpdate(index, { len: v })}
        />
        <Slider
          label={
            piece.kind === 'curveL' || piece.kind === 'curveR'
              ? 'Turn Radius'
              : piece.kind === 'loop'
                ? 'Loop Scale'
                : 'Steepness'
          }
          value={piece.power}
          min={0.2}
          max={1.8}
          step={0.05}
          suffix="×"
          onChange={(v) => onUpdate(index, { power: v })}
        />
        <Slider
          label="Lateral Rotation"
          value={piece.rot}
          min={-75}
          max={75}
          step={1}
          suffix="°"
          onChange={(v) => onUpdate(index, { rot: v })}
        />
      </div>

      <div className="mt-3.5 flex gap-2">
        <button
          onClick={() => onDuplicate(index)}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Duplicate
        </button>
        <button
          onClick={() => onUpdate(index, { len: 1, power: 1, rot: 0 })}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Reset
        </button>
        <button
          onClick={() => {
            onDelete(index);
            onSelect(null);
          }}
          className="flex-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-100"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
