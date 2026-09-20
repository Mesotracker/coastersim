import { useCallback, useEffect, useRef } from 'react';
import {
  BuiltTrack,
  PIECE_DEFS,
  Piece,
  PieceKind,
  TrackDef,
  frameAt,
  indexAt,
  makeFrame,
  segsFor,
} from '../lib/track';
import { SimState } from '../lib/physics';
import { Theme } from '../lib/themes';

interface Props {
  track: TrackDef;
  built: BuiltTrack;
  simRef: React.RefObject<SimState>;
  theme: Theme;
  selected: number | null;
  snap: boolean;
  onSelect: (index: number | null) => void;
  onHoverPiece?: (index: number | null) => void;
  onChange: (t: TrackDef, commit?: boolean) => void;
  onInsert: (kind: PieceKind, index: number) => void;
  fitSignal: number;
}

interface View {
  cx: number;
  cy: number;
  zoom: number;
}

type DragMode =
  | { type: 'none' }
  | { type: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { type: 'origin'; ox: number; oy: number }
  | {
      type: 'node';
      index: number;
      startX: number;
      startY: number;
      chordAngle: number;
      chordLen: number;
      rot0: number;
      len0: number;
      moved: boolean;
    };

const RAD = 180 / Math.PI;
const frame = makeFrame();

export default function Editor2D(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ cx: 260, cy: 90, zoom: 1 });
  const sizeRef = useRef({ w: 800, h: 600, dpr: 1 });
  const dragRef = useRef<DragMode>({ type: 'none' });
  const hoverRef = useRef<{ piece: number | null; node: number | null; origin: boolean }>({
    piece: null,
    node: null,
    origin: false,
  });
  const dropRef = useRef<{ index: number; x: number; y: number } | null>(null);
  const pRef = useRef(props);
  pRef.current = props;

  // ---------------------------------------------------------------- helpers
  const toWorld = useCallback((sx: number, sy: number) => {
    const { w, h } = sizeRef.current;
    const v = viewRef.current;
    return { x: v.cx + (sx - w / 2) / v.zoom, y: v.cy - (sy - h / 2) / v.zoom };
  }, []);

  const fit = useCallback(() => {
    const b = pRef.current.built.bounds;
    const { w, h } = sizeRef.current;
    const bw = Math.max(200, b.maxX - b.minX + 160);
    const bh = Math.max(160, b.maxY - b.minY + 160);
    const zoom = Math.max(0.1, Math.min(2.2, Math.min(w / bw, h / bh)));
    viewRef.current = {
      cx: (b.minX + b.maxX) / 2,
      cy: (b.minY + b.maxY) / 2 + 10,
      zoom,
    };
  }, []);

  useEffect(() => {
    fit();
  }, [props.fitSignal, fit]);

  // ------------------------------------------------------------ sizing loop
  useEffect(() => {
    const el = wrapRef.current!;
    const cv = canvasRef.current!;
    let firstFit = true;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { w: r.width, h: r.height, dpr };
      cv.width = Math.max(1, Math.floor(r.width * dpr));
      cv.height = Math.max(1, Math.floor(r.height * dpr));
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      if (firstFit && r.width > 10) {
        firstFit = false;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // --------------------------------------------------------------- painting
  useEffect(() => {
    let raf = 0;
    const cv = canvasRef.current!;
    const ctx = cv.getContext('2d')!;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { w, h, dpr } = sizeRef.current;
      const v = viewRef.current;
      const { built, theme, selected, track } = pRef.current;
      const sim = pRef.current.simRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const X = (wx: number) => (wx - v.cx) * v.zoom + w / 2;
      const Y = (wy: number) => h / 2 - (wy - v.cy) * v.zoom;

      // background
      const grd = ctx.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#f8fafc');
      grd.addColorStop(1, '#eef2f7');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);

      // grid
      const minor = 20;
      const step = minor * v.zoom;
      if (step > 5) {
        const x0 = Math.floor((v.cx - w / 2 / v.zoom) / minor) * minor;
        const x1 = v.cx + w / 2 / v.zoom;
        const y0 = Math.floor((v.cy - h / 2 / v.zoom) / minor) * minor;
        const y1 = v.cy + h / 2 / v.zoom;
        ctx.lineWidth = 1;
        for (let gx = x0; gx <= x1; gx += minor) {
          const major = Math.abs(gx % 100) < 0.01;
          ctx.strokeStyle = major ? 'rgba(100,116,139,0.20)' : 'rgba(100,116,139,0.09)';
          ctx.beginPath();
          ctx.moveTo(Math.round(X(gx)) + 0.5, 0);
          ctx.lineTo(Math.round(X(gx)) + 0.5, h);
          ctx.stroke();
        }
        for (let gy = y0; gy <= y1; gy += minor) {
          const major = Math.abs(gy % 100) < 0.01;
          ctx.strokeStyle = major ? 'rgba(100,116,139,0.20)' : 'rgba(100,116,139,0.09)';
          ctx.beginPath();
          ctx.moveTo(0, Math.round(Y(gy)) + 0.5);
          ctx.lineTo(w, Math.round(Y(gy)) + 0.5);
          ctx.stroke();
        }
      }

      // ground
      const groundY = built.groundY;
      const gy0 = Y(groundY);
      ctx.fillStyle = 'rgba(74,222,128,0.16)';
      ctx.fillRect(0, gy0, w, h - gy0);
      ctx.strokeStyle = 'rgba(22,163,74,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, gy0 + 0.5);
      ctx.lineTo(w, gy0 + 0.5);
      ctx.stroke();

      const S = built.samples;
      const n = S.length;
      if (n < 2) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '600 14px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Drag a track piece here to start building', w / 2, h / 2);
        return;
      }

      // supports (only where track is right-side up, avoiding spearing through loop apex)
      ctx.strokeStyle = 'rgba(148,163,184,0.75)';
      ctx.lineWidth = Math.max(1, 2 * v.zoom);
      const supportEvery = Math.max(6, Math.round(30 / (S[1].s - S[0].s || 1.6)));
      for (let i = 0; i < n; i += supportEvery) {
        const p = S[i];
        if (p.y - groundY < 7) continue;
        const cosP = Math.cos(p.pitch);
        if (cosP < 0.2) continue; // Don't draw columns through inverted loops!
        ctx.beginPath();
        ctx.moveTo(X(p.x), Y(p.y));
        ctx.lineTo(X(p.x), Y(groundY));
        ctx.stroke();
      }

      // ties
      ctx.strokeStyle = theme.tie;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = Math.max(1, 2.2 * v.zoom);
      const tieEvery = Math.max(2, Math.round(7 / (S[1].s - S[0].s || 1.6)));
      for (let i = 0; i < n; i += tieEvery) {
        const p = S[i];
        const nx = -Math.sin(p.pitch);
        const ny = Math.cos(p.pitch);
        const L = 5.2;
        ctx.beginPath();
        ctx.moveTo(X(p.x - nx * L), Y(p.y - ny * L));
        ctx.lineTo(X(p.x + nx * L), Y(p.y + ny * L));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // spine
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const path = new Path2D();
      path.moveTo(X(S[0].x), Y(S[0].y));
      for (let i = 1; i < n; i++) path.lineTo(X(S[i].x), Y(S[i].y));
      ctx.strokeStyle = theme.spine;
      ctx.lineWidth = Math.max(2.5, 7 * v.zoom);
      ctx.stroke(path);
      ctx.strokeStyle = theme.rail;
      ctx.lineWidth = Math.max(1, 2.6 * v.zoom);
      ctx.stroke(path);

      // special sections + selection overlay
      const strokeRange = (a: number, b: number, color: string, width: number, alpha = 1) => {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(X(S[a].x), Y(S[a].y));
        for (let i = a + 1; i <= b; i++) ctx.lineTo(X(S[i].x), Y(S[i].y));
        ctx.stroke();
        ctx.globalAlpha = 1;
      };

      built.pieceRanges.forEach((r, i) => {
        const piece = track.pieces[i];
        if (!piece) return;
        const def = PIECE_DEFS[piece.kind];
        if (def.special) {
          strokeRange(r.start, r.end, def.special === 1 ? '#f43f5e' : '#facc15', Math.max(3, 9 * v.zoom), 0.9);
          strokeRange(r.start, r.end, '#ffffff', Math.max(1, 2 * v.zoom), 0.7);
        }
        if (
          piece.kind === 'curveL' ||
          piece.kind === 'curveR' ||
          piece.kind === 'zeroGRoll' ||
          piece.kind === 'corkscrew' ||
          piece.kind === 'immelmann'
        ) {
          ctx.setLineDash(
            piece.kind === 'zeroGRoll' || piece.kind === 'corkscrew' || piece.kind === 'immelmann'
              ? [4, 4]
              : [6, 6],
          );
          strokeRange(r.start, r.end, def.color, Math.max(2, 4 * v.zoom), 0.95);
          ctx.setLineDash([]);
        }
        if (i === hoverRef.current.piece && i !== selected) {
          strokeRange(r.start, r.end, '#0f172a', Math.max(3, 10 * v.zoom), 0.14);
        }
      });

      // chain-lift zone
      const liftIdx = indexAt(built, built.liftEnd);
      if (liftIdx > 2) {
        ctx.setLineDash([3, 6]);
        strokeRange(0, liftIdx, '#0f172a', Math.max(1.4, 2.6 * v.zoom), 0.5);
        ctx.setLineDash([]);
        const mid = S[Math.floor(liftIdx / 2)];
        if (v.zoom > 0.35) {
          ctx.fillStyle = 'rgba(15,23,42,0.55)';
          ctx.font = '700 9px ui-sans-serif, system-ui';
          ctx.textAlign = 'center';
          ctx.fillText('CHAIN LIFT', X(mid.x), Y(mid.y) - 12);
        }
      }

      if (selected != null && built.pieceRanges[selected]) {
        const r = built.pieceRanges[selected];
        strokeRange(r.start, r.end, '#2563eb', Math.max(5, 14 * v.zoom), 0.22);
        strokeRange(r.start, r.end, '#2563eb', Math.max(1.5, 3 * v.zoom), 0.9);
      }

      // station platform
      const o = S[0];
      ctx.fillStyle = '#334155';
      const pw = 30 * v.zoom;
      const ph = 5 * v.zoom;
      ctx.fillRect(X(o.x) - pw * 0.15, Y(o.y) + 3 * v.zoom, pw, ph);
      ctx.fillStyle = '#0f172a';
      ctx.font = `600 ${Math.max(9, 10 * Math.min(1.4, v.zoom))}px ui-sans-serif, system-ui`;
      ctx.textAlign = 'left';
      ctx.fillText('STATION', X(o.x) - 2, Y(o.y) + 20 * Math.min(1.2, v.zoom));

      // nodes
      const nodeR = Math.max(3.2, 4.6 * Math.min(1.6, v.zoom));
      const drawNode = (x: number, y: number, active: boolean, big = false) => {
        ctx.beginPath();
        ctx.arc(X(x), Y(y), big ? nodeR * 1.5 : nodeR, 0, Math.PI * 2);
        ctx.fillStyle = active ? '#2563eb' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = active ? '#1d4ed8' : '#475569';
        ctx.stroke();
      };
      drawNode(S[0].x, S[0].y, hoverRef.current.origin, hoverRef.current.origin);
      built.nodes.forEach((nd, i) => {
        const isSel = i === selected;
        drawNode(nd.x, nd.y, isSel || hoverRef.current.node === i, isSel);
      });

      // selected handle ring
      if (selected != null && built.nodes[selected]) {
        const nd = built.nodes[selected];
        ctx.beginPath();
        ctx.arc(X(nd.x), Y(nd.y), nodeR * 3.2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(37,99,235,0.55)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // insertion marker while dragging a new piece in
      if (dropRef.current) {
        const d = dropRef.current;
        ctx.beginPath();
        ctx.arc(X(d.x), Y(d.y), nodeR * 3.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(37,99,235,0.18)';
        ctx.fill();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#1d4ed8';
        ctx.font = '700 11px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('insert here', X(d.x), Y(d.y) - nodeR * 5);
      }

      // labels on selected / hovered piece
      const labelFor = (i: number) => {
        const piece = track.pieces[i];
        const r = built.pieceRanges[i];
        if (!piece || !r) return;
        const mid = S[Math.floor((r.start + r.end) / 2)];
        const def = PIECE_DEFS[piece.kind];
        const tx = X(mid.x);
        const ty = Y(mid.y) - 18;
        ctx.font = '700 11px ui-sans-serif, system-ui';
        const label = piece.kind === 'jump' ? `${def.label} 🚀` : `${def.label}  [E: Jump]`;
        const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = piece.kind === 'jump' ? 'rgba(245,158,11,0.95)' : 'rgba(15,23,42,0.88)';
        ctx.beginPath();
        ctx.roundRect(tx - tw / 2, ty - 11, tw, 18, 9);
        ctx.fill();
        ctx.fillStyle = piece.kind === 'jump' ? '#0f172a' : '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(label, tx, ty + 2);
      };
      if (selected != null) labelFor(selected);
      else if (hoverRef.current.piece != null) labelFor(hoverRef.current.piece);

      // train
      if (built.length > 4) {
        const carLen = 13;
        for (let c = 0; c < 3; c++) {
          const cs = sim.s - c * (carLen + 2.5);
          if (cs < 0) continue;
          frameAt(built, cs, frame);
          ctx.save();
          ctx.translate(X(frame.x), Y(frame.y));
          ctx.rotate(-frame.pitch);
          const cw = carLen * v.zoom;
          const ch = Math.max(4, 8 * v.zoom);
          ctx.fillStyle = c === 0 ? theme.car : '#1e293b';
          ctx.beginPath();
          ctx.roundRect(-cw / 2, -ch - 1.5 * v.zoom, cw, ch, 2.5);
          ctx.fill();
          ctx.strokeStyle = 'rgba(15,23,42,0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        }
        // speed halo
        frameAt(built, sim.s, frame);
        const glow = Math.min(1, sim.speed / 70); // 70 mph
        ctx.beginPath();
        ctx.arc(X(frame.x), Y(frame.y), 10 + 16 * glow, 0, Math.PI * 2);
        const rg = ctx.createRadialGradient(
          X(frame.x), Y(frame.y), 2,
          X(frame.x), Y(frame.y), 10 + 16 * glow,
        );
        rg.addColorStop(0, `rgba(250,204,21,${0.35 * glow + 0.12})`);
        rg.addColorStop(1, 'rgba(250,204,21,0)');
        ctx.fillStyle = rg;
        ctx.fill();
      }

      // top-down minimap
      const MM = 104;
      const pad = 10;
      const mx = w - MM - pad;
      const my = pad;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.strokeStyle = 'rgba(148,163,184,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(mx, my, MM, MM, 8);
      ctx.fill();
      ctx.stroke();
      let miX = Infinity;
      let maX = -Infinity;
      let miZ = Infinity;
      let maZ = -Infinity;
      for (let i = 0; i < n; i += 3) {
        const p = S[i];
        if (p.px < miX) miX = p.px;
        if (p.px > maX) maX = p.px;
        if (p.pz < miZ) miZ = p.pz;
        if (p.pz > maZ) maZ = p.pz;
      }
      const spanX = Math.max(40, maX - miX);
      const spanZ = Math.max(40, maZ - miZ);
      const sc = (MM - 22) / Math.max(spanX, spanZ);
      const mcx = mx + MM / 2 - ((miX + maX) / 2) * sc;
      const mcy = my + MM / 2 - ((miZ + maZ) / 2) * sc;
      ctx.beginPath();
      for (let i = 0; i < n; i += 2) {
        const p = S[i];
        const sxp = mcx + p.px * sc;
        const syp = mcy + p.pz * sc;
        if (i === 0) ctx.moveTo(sxp, syp);
        else ctx.lineTo(sxp, syp);
      }
      ctx.strokeStyle = theme.spine;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      frameAt(built, sim.s, frame);
      ctx.beginPath();
      ctx.arc(mcx + frame.px * sc, mcy + frame.pz * sc, 3, 0, Math.PI * 2);
      ctx.fillStyle = theme.car;
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(71,85,105,0.85)';
      ctx.font = '700 8px ui-sans-serif, system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('TOP VIEW', mx + 7, my + 12);
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ------------------------------------------------------------ interaction
  const pickAt = useCallback((sx: number, sy: number) => {
    const { built } = pRef.current;
    const v = viewRef.current;
    const wp = toWorld(sx, sy);
    const tol = 12 / v.zoom;
    // origin
    if (Math.hypot(built.samples[0].x - wp.x, built.samples[0].y - wp.y) < tol) {
      return { origin: true, node: null as number | null, piece: null as number | null };
    }
    let node: number | null = null;
    let best = tol;
    built.nodes.forEach((nd, i) => {
      const d = Math.hypot(nd.x - wp.x, nd.y - wp.y);
      if (d < best) {
        best = d;
        node = i;
      }
    });
    if (node !== null) return { origin: false, node, piece: node };
    // piece body
    let piece: number | null = null;
    let bestD = 14 / v.zoom;
    const S = built.samples;
    for (let i = 0; i < S.length; i += 2) {
      const d = Math.hypot(S[i].x - wp.x, S[i].y - wp.y);
      if (d < bestD) {
        bestD = d;
        piece = S[i].piece;
      }
    }
    return { origin: false, node: null, piece };
  }, [toWorld]);

  const startNodeDrag = useCallback((index: number, grab: { x: number; y: number }) => {
    const { built, track } = pRef.current;
    const piece = track.pieces[index];
    if (!piece) return;
    const startPt =
      index === 0 ? { x: built.samples[0].x, y: built.samples[0].y } : built.nodes[index - 1];
    const dx = grab.x - startPt.x;
    const dy = grab.y - startPt.y;
    const dist = Math.hypot(dx, dy);
    dragRef.current = {
      type: 'node',
      index,
      startX: startPt.x,
      startY: startPt.y,
      chordAngle: Math.atan2(dy, dx),
      chordLen: Math.max(14, dist),
      rot0: piece.rot,
      len0: piece.len,
      moved: dist > 14,
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const hit = pickAt(sx, sy);
      if (e.button === 1 || e.shiftKey || (!hit.origin && hit.piece === null)) {
        const v = viewRef.current;
        dragRef.current = { type: 'pan', sx, sy, cx: v.cx, cy: v.cy };
        if (!hit.origin && hit.piece === null) pRef.current.onSelect(null);
        return;
      }
      if (hit.origin) {
        const wp = toWorld(sx, sy);
        dragRef.current = {
          type: 'origin',
          ox: pRef.current.track.origin.x - wp.x,
          oy: pRef.current.track.origin.y - wp.y,
        };
        pRef.current.onSelect(null);
        return;
      }
      if (hit.piece !== null) {
        pRef.current.onSelect(hit.piece);
        startNodeDrag(hit.piece, toWorld(sx, sy));
      }
    },
    [pickAt, startNodeDrag, toWorld],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const d = dragRef.current;
      const { track, snap } = pRef.current;

      if (d.type === 'none') {
        const hit = pickAt(sx, sy);
        hoverRef.current = { piece: hit.piece, node: hit.node, origin: hit.origin };
        pRef.current.onHoverPiece?.(hit.piece);
        return;
      }
      if (d.type === 'pan') {
        const v = viewRef.current;
        v.cx = d.cx - (sx - d.sx) / v.zoom;
        v.cy = d.cy + (sy - d.sy) / v.zoom;
        return;
      }
      const wp = toWorld(sx, sy);
      if (d.type === 'origin') {
        let nx = wp.x + d.ox;
        let ny = wp.y + d.oy;
        if (snap) {
          nx = Math.round(nx / 10) * 10;
          ny = Math.round(ny / 10) * 10;
        }
        pRef.current.onChange({ ...track, origin: { x: nx, y: Math.max(0, ny) } });
        return;
      }
      if (d.type === 'node') {
        const piece = track.pieces[d.index];
        if (!piece || !d.moved) return;
        const vx = wp.x - d.startX;
        const vy = wp.y - d.startY;
        const dist = Math.hypot(vx, vy);
        if (dist < 6) return;
        const ang = Math.atan2(vy, vx);
        let diff = (ang - d.chordAngle) * RAD;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;
        let rot = d.rot0 + diff;
        rot = Math.max(-75, Math.min(75, rot));
        if (snap) rot = Math.round(rot / 5) * 5;
        let len = piece.len;
        if (piece.kind !== 'loop') {
          len = Math.max(0.4, Math.min(2.4, d.len0 * (dist / d.chordLen)));
          if (snap) len = Math.round(len * 10) / 10;
        }
        const next: Piece = { ...piece, rot: Math.round(rot * 10) / 10, len };
        const pieces = track.pieces.slice();
        pieces[d.index] = next;
        d.moved = true;
        pRef.current.onChange({ ...track, pieces });
      }
    },
    [pickAt, toWorld],
  );

  const endDrag = useCallback(() => {
    dragRef.current = { type: 'none' };
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = toWorld(sx, sy);
    const v = viewRef.current;
    const factor = Math.exp(-e.deltaY * 0.0014);
    v.zoom = Math.max(0.12, Math.min(3.2, v.zoom * factor));
    const after = toWorld(sx, sy);
    v.cx += before.x - after.x;
    v.cy += before.y - after.y;
  }, [toWorld]);

  // ---- drag & drop from the palette ---------------------------------------
  const computeDropIndex = useCallback(
    (sx: number, sy: number) => {
      const { built } = pRef.current;
      const wp = toWorld(sx, sy);
      let bestI = built.nodes.length - 1;
      let bestD = Infinity;
      const pts = [
        { x: built.samples[0].x, y: built.samples[0].y, i: -1 },
        ...built.nodes.map((nd, i) => ({ x: nd.x, y: nd.y, i })),
      ];
      let bx = pts[pts.length - 1]?.x ?? 0;
      let by = pts[pts.length - 1]?.y ?? 0;
      for (const p of pts) {
        const d = Math.hypot(p.x - wp.x, p.y - wp.y);
        if (d < bestD) {
          bestD = d;
          bestI = p.i;
          bx = p.x;
          by = p.y;
        }
      }
      return { index: bestI + 1, x: bx, y: by };
    },
    [toWorld],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      dropRef.current = computeDropIndex(e.clientX - rect.left, e.clientY - rect.top);
    },
    [computeDropIndex],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = (e.dataTransfer.getData('text/coaster-piece') ||
        e.dataTransfer.getData('text/plain')) as PieceKind;
      const d = dropRef.current;
      dropRef.current = null;
      if (!kind || !PIECE_DEFS[kind]) return;
      pRef.current.onInsert(kind, d ? d.index : pRef.current.track.pieces.length);
    },
    [],
  );

  const cursor =
    dragRef.current.type === 'pan'
      ? 'grabbing'
      : hoverRef.current.origin || hoverRef.current.node !== null
        ? 'grab'
        : 'default';

  const zoomBy = (factor: number) => {
    const v = viewRef.current;
    v.zoom = Math.max(0.12, Math.min(3.2, v.zoom * factor));
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-inner"
      onDragOver={onDragOver}
      onDragLeave={() => (dropRef.current = null)}
      onDrop={onDrop}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      />
      <div className="pointer-events-none absolute bottom-3 left-3 hidden rounded-xl bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200/80 backdrop-blur md:block">
        <span className="text-slate-900 font-bold">2D Layout:</span> Drag piece to reshape · Drag station to move · Scroll to zoom · Shift+drag to pan
      </div>
      <div className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-xl bg-white/95 p-1 shadow-md ring-1 ring-slate-200/80 backdrop-blur">
        <button
          onClick={() => zoomBy(1.25)}
          title="Zoom In"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
        >
          +
        </button>
        <button
          onClick={() => zoomBy(0.8)}
          title="Zoom Out"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
        >
          −
        </button>
        <div className="h-4 w-px bg-slate-200" />
        <button
          onClick={() => fit()}
          title="Fit Track to Viewport (F)"
          className="rounded-lg px-2.5 py-1 text-xs font-bold text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
        >
          Fit View
        </button>
      </div>
    </div>
  );
}

export function pieceLength(p: Piece) {
  return segsFor(p).reduce((a, s) => a + s.len, 0);
}
