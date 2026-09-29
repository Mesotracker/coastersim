import { Copy, Droplets, Lightbulb, Mountain, Trash2, Waves } from 'lucide-react';
import { BuiltTrack, SceneryBlock } from '../lib/track';

interface Props {
  block: SceneryBlock | null;
  built: BuiltTrack;
  onUpdate: (id: string, patch: Partial<SceneryBlock>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

function Field({ label, value, min, max, step, suffix, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
        <span className="font-mono text-[10px] font-bold text-amber-300">{value.toFixed(step < 0.1 ? 2 : 1)}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 w-full cursor-pointer" />
    </label>
  );
}

export default function SceneryInspector({ block, built, onUpdate, onDelete, onDuplicate }: Props) {
  if (!block) {
    return (
      <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-amber-400/25 bg-amber-400/5 px-5 text-center text-xs text-slate-500">
        Select a water pool, cave, or waterfall on the environment map—or add one from the Building Blocks palette.
      </div>
    );
  }

  const meta = block.kind === 'waterPool'
    ? { title: 'Water Pool', description: 'Detached from the coaster and clamped just above terrain.', Icon: Droplets, color: '#38bdf8' }
    : block.kind === 'cave'
      ? { title: 'Rock Cave', description: 'A polygonal tunnel envelope that can surround below-grade track.', Icon: Mountain, color: '#a8a29e' }
      : { title: 'Waterfall', description: 'A physical water curtain with ballistic spray and mild speed loss.', Icon: Waves, color: '#60a5fa' };
  const Icon = meta.Icon;
  const mapRange = Math.max(800, built.radius3 * 3.5);
  const caves = built.scenery.filter((item) => item.kind === 'cave');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-white/10" style={{ color: meta.color, background: `${meta.color}18` }}>
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-black text-slate-900">{meta.title}</div>
            <p className="truncate text-[10px] text-slate-500">{meta.description}</p>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onDuplicate(block.id)} title="Duplicate block" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:text-amber-300"><Copy className="h-3.5 w-3.5" /></button>
          <button onClick={() => onDelete(block.id)} title="Delete block" className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-rose-400 hover:bg-rose-500/20"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {block.kind === 'waterPool' ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Field label="World X" value={block.x} min={-mapRange} max={mapRange} step={2} onChange={(x) => onUpdate(block.id, { x })} />
          <Field label="World Z" value={block.z} min={-mapRange} max={mapRange} step={2} onChange={(z) => onUpdate(block.id, { z })} />
          <Field label="Pool Radius" value={block.scale} min={0.45} max={4} step={0.05} suffix="×" onChange={(scale) => onUpdate(block.id, { scale })} />
          <Field label="Above Ground" value={block.elevation} min={0.05} max={2.5} step={0.05} suffix=" u" onChange={(elevation) => onUpdate(block.id, { elevation })} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Attached Track Segment</span>
            <select value={Math.max(0, Math.min(built.pieces?.length ? built.pieces.length - 1 : 0, block.pieceIndex ?? 0))} onChange={(e) => onUpdate(block.id, { pieceIndex: Number(e.target.value) })} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold">
              {(built.pieces ?? []).map((piece, index) => <option key={piece.id} value={index}>#{index + 1} · {piece.kind}</option>)}
            </select>
          </label>
          <Field label={block.kind === 'cave' ? 'Tunnel Radius' : 'Curtain Width'} value={block.scale} min={0.55} max={2.5} step={0.05} suffix="×" onChange={(scale) => onUpdate(block.id, { scale })} />
          {block.kind === 'waterfall' ? (
            <Field label="Water Flow" value={block.flow ?? 1} min={0.2} max={2} step={0.05} suffix="×" onChange={(flow) => onUpdate(block.id, { flow })} />
          ) : (
            <Field label="Lamp Density" value={block.lampDensity ?? 1} min={0.4} max={2} step={0.1} suffix="×" onChange={(lampDensity) => onUpdate(block.id, { lampDensity })} />
          )}
        </div>
      )}

      {block.kind === 'cave' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
            <input type="checkbox" checked={block.lamps !== false} onChange={(e) => onUpdate(block.id, { lamps: e.target.checked })} />
            <Lightbulb className="h-3.5 w-3.5 text-amber-300" /> Internal Lamps
          </label>
          <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Lamp color
            <input type="color" value={block.lampColor ?? '#f2c14e'} onChange={(e) => onUpdate(block.id, { lampColor: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" />
          </label>
          <span className="ml-auto text-[10px] text-slate-500">Rock shell follows the complete selected segment, including underground geometry.</span>
        </div>
      )}

      {block.kind === 'waterfall' && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Layer beneath cave</span>
            <select value={block.parentId ?? ''} onChange={(e) => onUpdate(block.id, { parentId: e.target.value || undefined })} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold">
              <option value="">No cave parent</option>
              {caves.map((cave) => <option key={cave.id} value={cave.id}>Cave on piece #{(cave.pieceIndex ?? 0) + 1}</option>)}
            </select>
          </label>
          <div className="self-end rounded-lg bg-sky-500/10 px-3 py-2 text-[10px] font-bold text-sky-300 ring-1 ring-sky-400/20">
            Estimated loss: {((block.flow ?? 1) * 0.75).toFixed(1)}–{((block.flow ?? 1) * 1.6).toFixed(1)} mph
          </div>
        </div>
      )}
    </div>
  );
}
