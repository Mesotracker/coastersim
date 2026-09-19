import { PIECE_DEFS, PIECE_ORDER, PieceKind } from '../lib/track';

interface Props {
  onAdd: (kind: PieceKind) => void;
}

export default function Toolbar({ onAdd }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {PIECE_ORDER.map((kind) => {
        const def = PIECE_DEFS[kind];
        return (
          <button
            key={kind}
            title={`${def.label} — ${def.hint}\n(Click to append, or drag onto the canvas)`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/coaster-piece', kind);
              e.dataTransfer.setData('text/plain', kind);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onAdd(kind)}
            className="group flex w-[84px] cursor-grab flex-col items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-2 py-2.5 text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md active:cursor-grabbing active:translate-y-0"
          >
            <span
              className="flex h-8 w-full items-center justify-center rounded-lg transition-transform group-hover:scale-105"
              style={{ backgroundColor: `${def.color}1a`, color: def.color }}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.3}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={def.glyph} />
              </svg>
            </span>
            <span className="text-xs font-bold tracking-tight text-slate-700 group-hover:text-slate-900">
              {def.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
