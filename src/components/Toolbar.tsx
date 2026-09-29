import { PIECE_DEFS, PIECE_ORDER, PieceKind, SceneryKind } from '../lib/track';

interface Props {
  onAdd: (kind: PieceKind) => void;
  onAddScenery: (kind: SceneryKind) => void;
}

const SCENERY_BLOCKS: { kind: SceneryKind; label: string; hint: string; color: string; glyph: string }[] = [
  { kind: 'waterPool', label: 'Water Pool', hint: 'Detached, draggable ground-clipped water feature', color: '#38bdf8', glyph: 'M3 15c3-3 5 3 8 0s5 3 10 0 M4 19c3-2 5 2 8 0s5 2 8 0 M12 3c-3 4-4 6-4 8' },
  { kind: 'cave', label: 'Rock Cave', hint: 'Track tunnel with customizable internal lamps', color: '#a8a29e', glyph: 'M3 20V11C3 5 7 2 12 2s9 3 9 9v9 M8 20v-8c0-3 2-5 4-5s4 2 4 5v8' },
  { kind: 'waterfall', label: 'Waterfall', hint: 'Cave-layered water curtain with spray and slight speed loss', color: '#60a5fa', glyph: 'M7 3h10 M9 3c0 7-3 8-3 13 M12 3c0 8-2 10-2 17 M15 3c0 7 3 8 3 13 M5 21c3-2 5 2 8 0s4 1 6-1' },
];

export default function Toolbar({ onAdd, onAddScenery }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1.5 scroll-smooth snap-x" aria-label="Track piece presets">
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
            className="group flex w-[78px] sm:w-[84px] shrink-0 snap-start cursor-pointer sm:cursor-grab flex-col items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-1.5 sm:px-2 py-2 sm:py-2.5 text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md active:cursor-grabbing active:translate-y-0"
          >
            <span
              className="flex h-7 w-full sm:h-8 items-center justify-center rounded-lg transition-transform group-hover:scale-105"
              style={{ backgroundColor: `${def.color}1a`, color: def.color }}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 sm:h-5 sm:w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.3}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={def.glyph} />
              </svg>
            </span>
            <span className="text-[11px] sm:text-xs font-bold tracking-tight text-slate-700 group-hover:text-slate-900">
              {def.label}
            </span>
          </button>
        );
      })}
      <div className="mx-1 h-16 w-px shrink-0 self-center bg-amber-400/30" aria-hidden="true" />
      {SCENERY_BLOCKS.map((block) => (
        <button
          key={block.kind}
          title={`${block.label} — ${block.hint}\n(Click to place, then drag on the environment map)`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/coaster-scenery', block.kind);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => onAddScenery(block.kind)}
          className="group flex w-[84px] shrink-0 snap-start cursor-pointer sm:cursor-grab flex-col items-center gap-1.5 rounded-xl border border-amber-400/25 bg-amber-400/5 px-2 py-2 sm:py-2.5 text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-amber-300/60 hover:bg-amber-400/10 hover:shadow-md"
        >
          <span
            className="flex h-7 w-full sm:h-8 items-center justify-center rounded-lg transition-transform group-hover:scale-105"
            style={{ backgroundColor: `${block.color}20`, color: block.color }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 sm:h-5 sm:w-5" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
              <path d={block.glyph} />
            </svg>
          </span>
          <span className="text-[11px] sm:text-xs font-bold tracking-tight text-slate-700 group-hover:text-amber-200">
            {block.label}
          </span>
        </button>
      ))}
    </div>
  );
}
