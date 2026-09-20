import { useCallback, useMemo, useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon } from 'lucide-react';
import { TelemetryPoint } from '../lib/physics';

interface Props {
  telemetry: TelemetryPoint[];
  currentTime: number;
  currentSpeed: number;
  maxSpeed: number;
  airtime: number;
  compact?: boolean;
}

export default function SpeedGraph({
  telemetry,
  currentTime,
  currentSpeed,
  maxSpeed,
  airtime,
  compact = false,
}: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Derive metrics
  const avgSpeed = useMemo(() => {
    if (telemetry.length === 0) return 0;
    const sum = telemetry.reduce((acc, p) => acc + p.speed, 0);
    return sum / telemetry.length;
  }, [telemetry]);

  const peakPoint = useMemo(() => {
    if (telemetry.length === 0) return null;
    let maxP = telemetry[0];
    for (const p of telemetry) {
      if (p.speed > maxP.speed) maxP = p;
    }
    return maxP;
  }, [telemetry]);

  // Export telemetry as CSV file
  const handleDownloadCSV = useCallback(() => {
    const rows = [
      ['Time (s)', 'Speed (mph)', 'G-Force (g)', 'Elevation (ft)', 'Track Distance (m)'],
    ];

    if (telemetry.length === 0) {
      // Provide single row with current telemetry point
      rows.push([
        currentTime.toFixed(2),
        currentSpeed.toFixed(1),
        '1.00',
        '0',
        '0',
      ]);
    } else {
      for (const pt of telemetry) {
        rows.push([
          pt.t.toFixed(2),
          pt.speed.toFixed(1),
          pt.g.toFixed(2),
          pt.height.toString(),
          pt.s.toString(),
        ]);
      }
    }

    const csvContent = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `coaster-speed-telemetry-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExporting('CSV exported!');
    setTimeout(() => setExporting(null), 2200);
  }, [telemetry, currentTime, currentSpeed]);

  // Export graph as high-resolution PNG image
  const handleDownloadPNG = useCallback(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    try {
      setExporting('Rendering PNG…');
      // Create high-res canvas (1200 x 640)
      const exportWidth = 1200;
      const exportHeight = 640;
      const canvas = document.createElement('canvas');
      canvas.width = exportWidth;
      canvas.height = exportHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Dark executive presentation styling
      ctx.fillStyle = '#0f172a'; // slate-900
      ctx.fillRect(0, 0, exportWidth, exportHeight);

      // Card container
      ctx.fillStyle = '#1e293b'; // slate-800
      ctx.beginPath();
      ctx.roundRect(30, 30, exportWidth - 60, exportHeight - 60, 16);
      ctx.fill();

      // Title & Branding
      ctx.font = 'bold 26px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('COASTER FORGE — SPEED & G-FORCE TELEMETRY', 60, 78);

      // Subtitle Stats
      ctx.font = '15px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(
        `Peak: ${maxSpeed.toFixed(0)} mph  |  Avg: ${avgSpeed.toFixed(0)} mph  |  Airtime: ${airtime.toFixed(1)}s  |  Samples: ${telemetry.length}`,
        60,
        106,
      );

      // Serialize SVG
      const svgString = new XMLSerializer().serializeToString(svgEl);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const DOMURL = window.URL || window.webkitURL || window;
      const url = DOMURL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        // Draw the SVG graph inside the canvas container
        const chartX = 60;
        const chartY = 130;
        const chartW = exportWidth - 120;
        const chartH = exportHeight - 180;

        ctx.drawImage(img, chartX, chartY, chartW, chartH);
        DOMURL.revokeObjectURL(url);

        // Watermark timestamp
        ctx.font = '12px monospace';
        ctx.fillStyle = '#64748b';
        ctx.fillText(`Exported ${new Date().toLocaleString()}`, exportWidth - 280, exportHeight - 45);

        // Trigger PNG download
        canvas.toBlob((blob) => {
          if (!blob) return;
          const a = document.createElement('a');
          a.download = `coaster-speed-profile-${new Date().toISOString().slice(0, 10)}.png`;
          a.href = URL.createObjectURL(blob);
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setExporting('PNG downloaded!');
          setTimeout(() => setExporting(null), 2200);
        }, 'image/png');
      };
      img.src = url;
    } catch {
      setExporting(null);
    }
  }, [maxSpeed, avgSpeed, airtime, telemetry.length]);

  // Graph dimensions
  const width = compact ? 340 : 540;
  const height = compact ? 130 : 200;
  const padLeft = 38;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 26;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // X scale: time (at least 10s, or max timestamp + 2s)
  const maxT = Math.max(10, Math.ceil((telemetry[telemetry.length - 1]?.t ?? currentTime ?? 10) / 5) * 5);
  // Y scale: speed in mph (at least 40 mph, or ceil to next 20 mph)
  const maxSpd = Math.max(40, Math.ceil((Math.max(maxSpeed, currentSpeed) + 10) / 20) * 20);

  const getX = (t: number) => padLeft + (Math.max(0, Math.min(maxT, t)) / maxT) * chartW;
  const getY = (spd: number) => padTop + chartH - (Math.max(0, Math.min(maxSpd, spd)) / maxSpd) * chartH;

  // Build SVG path
  const pathD = useMemo(() => {
    if (telemetry.length === 0) return '';
    let d = '';
    telemetry.forEach((pt, i) => {
      const x = getX(pt.t);
      const y = getY(pt.speed);
      if (i === 0) d += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      else d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return d;
  }, [telemetry, maxT, maxSpd, chartW, chartH]);

  const areaD = useMemo(() => {
    if (!pathD || telemetry.length === 0) return '';
    const firstX = getX(telemetry[0].t);
    const lastX = getX(telemetry[telemetry.length - 1].t);
    const baseY = getY(0);
    return `${pathD} L ${lastX.toFixed(1)} ${baseY.toFixed(1)} L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`;
  }, [pathD, telemetry, maxT, maxSpd, chartW, chartH]);

  // Current train scrubber position
  const currentX = getX(currentTime);
  const currentY = getY(currentSpeed);

  // Y-axis ticks (e.g. 0, 20, 40, 60...)
  const yTicks = useMemo(() => {
    const step = maxSpd <= 60 ? 20 : maxSpd <= 100 ? 25 : 30;
    const ticks: number[] = [];
    for (let s = 0; s <= maxSpd; s += step) {
      ticks.push(s);
    }
    return ticks;
  }, [maxSpd]);

  // X-axis ticks (every 5 or 10s)
  const xTicks = useMemo(() => {
    const step = maxT <= 20 ? 5 : maxT <= 50 ? 10 : 15;
    const ticks: number[] = [];
    for (let t = 0; t <= maxT; t += step) {
      ticks.push(t);
    }
    return ticks;
  }, [maxT]);

  // Hovered point data
  const hoveredPoint = hoverIndex !== null && telemetry[hoverIndex] ? telemetry[hoverIndex] : null;

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (telemetry.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    const clampedX = Math.max(padLeft, Math.min(width - padRight, svgX));
    const targetT = ((clampedX - padLeft) / chartW) * maxT;

    // Find nearest point by time
    let bestI = 0;
    let bestDist = Infinity;
    for (let i = 0; i < telemetry.length; i++) {
      const dist = Math.abs(telemetry[i].t - targetT);
      if (dist < bestDist) {
        bestDist = dist;
        bestI = i;
      }
    }
    setHoverIndex(bestI);
  };

  return (
    <div className={`flex flex-col select-none ${compact ? 'gap-1.5' : 'gap-2.5'}`}>
      {/* Metrics Row */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-2.5 py-1.5 backdrop-blur-sm">
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Speed</div>
          <div className="font-mono text-sm font-black text-sky-600">
            {currentSpeed.toFixed(0)} <span className="text-[10px] font-semibold text-slate-500">mph</span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-2.5 py-1.5 backdrop-blur-sm">
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Peak</div>
          <div className="font-mono text-sm font-black text-amber-600">
            {maxSpeed.toFixed(0)} <span className="text-[10px] font-semibold text-slate-500">mph</span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-2.5 py-1.5 backdrop-blur-sm">
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Average</div>
          <div className="font-mono text-sm font-black text-emerald-600">
            {avgSpeed.toFixed(0)} <span className="text-[10px] font-semibold text-slate-500">mph</span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-2.5 py-1.5 backdrop-blur-sm">
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Airtime</div>
          <div className="font-mono text-sm font-black text-indigo-600">
            {airtime.toFixed(1)} <span className="text-[10px] font-semibold text-slate-500">s</span>
          </div>
        </div>
      </div>

      {/* SVG Chart */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-inner">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto block cursor-crosshair touch-none"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="speedAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.38" />
              <stop offset="60%" stopColor="#38bdf8" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="speedLineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#0284c7" />
              <stop offset="50%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
          </defs>

          {/* Grid lines: Y axis */}
          {yTicks.map((spd) => {
            const y = getY(spd);
            return (
              <g key={`y-${spd}`}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeWidth="1"
                  strokeDasharray={spd === 0 ? undefined : '3 3'}
                />
                <text
                  x={padLeft - 6}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-slate-400 font-mono text-[9px] font-semibold"
                >
                  {spd}
                </text>
              </g>
            );
          })}

          {/* Grid lines: X axis */}
          {xTicks.map((t) => {
            const x = getX(t);
            return (
              <g key={`x-${t}`}>
                <line
                  x1={x}
                  y1={padTop}
                  x2={x}
                  y2={height - padBottom}
                  stroke="#f1f5f9"
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={height - padBottom + 14}
                  textAnchor="middle"
                  className="fill-slate-400 font-mono text-[9px] font-semibold"
                >
                  {t}s
                </text>
              </g>
            );
          })}

          {/* Axis Labels */}
          <text
            x={padLeft - 4}
            y={padTop - 5}
            textAnchor="end"
            className="fill-slate-500 font-sans text-[8px] font-bold uppercase tracking-wider"
          >
            mph
          </text>
          <text
            x={width - padRight}
            y={height - 5}
            textAnchor="end"
            className="fill-slate-400 font-sans text-[8px] font-medium"
          >
            Time (s)
          </text>

          {/* Area Fill */}
          {areaD && <path d={areaD} fill="url(#speedAreaGrad)" />}

          {/* Speed Curve */}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke="url(#speedLineGrad)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Peak Speed Marker */}
          {peakPoint && peakPoint.speed > 5 && (
            <g transform={`translate(${getX(peakPoint.t)}, ${getY(peakPoint.speed)})`}>
              <circle r="4" fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />
              <rect
                x="-22"
                y="-18"
                width="44"
                height="14"
                rx="4"
                fill="#1e293b"
                opacity="0.9"
              />
              <text
                x="0"
                y="-8"
                textAnchor="middle"
                className="fill-amber-400 font-mono text-[8px] font-bold"
              >
                {peakPoint.speed.toFixed(0)} mph
              </text>
            </g>
          )}

          {/* Real-time Train Scrubber Indicator */}
          {telemetry.length > 0 && currentTime <= maxT && (
            <g>
              <line
                x1={currentX}
                y1={padTop}
                x2={currentX}
                y2={height - padBottom}
                stroke="#0284c7"
                strokeWidth="1.5"
                strokeDasharray="2 2"
                opacity="0.75"
              />
              <circle cx={currentX} cy={currentY} r="4.5" fill="#0284c7" stroke="#ffffff" strokeWidth="2" />
              <circle cx={currentX} cy={currentY} r="9" fill="#0284c7" opacity="0.2" />
            </g>
          )}

          {/* Interactive Hover Tooltip */}
          {hoveredPoint && (
            <g transform={`translate(${getX(hoveredPoint.t)}, ${getY(hoveredPoint.speed)})`}>
              <line
                x1="0"
                y1={padTop - getY(hoveredPoint.speed)}
                x2="0"
                y2={height - padBottom - getY(hoveredPoint.speed)}
                stroke="#64748b"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle r="5" fill="#2563eb" stroke="#ffffff" strokeWidth="2" />
              {/* Tooltip Card */}
              <g
                transform={`translate(${
                  getX(hoveredPoint.t) > width - 110 ? -100 : 8
                }, ${getY(hoveredPoint.speed) > height - 70 ? -52 : -20})`}
              >
                <rect
                  width="96"
                  height="48"
                  rx="6"
                  fill="#0f172a"
                  opacity="0.92"
                  filter="drop-shadow(0 4px 6px rgba(0,0,0,0.15))"
                />
                <text x="8" y="14" className="fill-slate-300 font-mono text-[9px]">
                  T: <tspan className="fill-white font-bold">{hoveredPoint.t.toFixed(1)}s</tspan>
                </text>
                <text x="8" y="27" className="fill-sky-400 font-mono text-[9px] font-bold">
                  {hoveredPoint.speed.toFixed(1)} mph
                </text>
                <text x="8" y="40" className="fill-slate-300 font-mono text-[8.5px]">
                  G: <tspan className="fill-amber-300">{hoveredPoint.g.toFixed(2)}g</tspan> · <tspan className="fill-emerald-300">{hoveredPoint.height}ft</tspan>
                </text>
              </g>
            </g>
          )}

          {/* Empty State message */}
          {telemetry.length === 0 && (
            <text
              x={width / 2}
              y={height / 2}
              textAnchor="middle"
              className="fill-slate-400 font-sans text-[11px] font-medium"
            >
              Start ride to record speed trace…
            </text>
          )}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 px-0.5 text-[11px]">
        <div className="flex items-center gap-1.5 text-slate-500 text-[10px]">
          <span>Hover curve for data</span>
          <span className="font-mono text-slate-400">·</span>
          <span className="font-mono font-medium text-slate-600">{telemetry.length} samples</span>
          {exporting && (
            <span className="ml-1 animate-pulse rounded-md bg-blue-50 px-1.5 py-0.5 font-sans font-bold text-blue-600">
              {exporting}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleDownloadPNG}
            title="Download high-resolution speed graph image (PNG)"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 hover:text-slate-900 active:scale-95"
          >
            <ImageIcon className="h-3.5 w-3.5 text-sky-600" />
            <span>Download PNG</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadCSV}
            title="Export full telemetry data as CSV table (Excel / Google Sheets)"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 hover:text-slate-900 active:scale-95"
          >
            <FileText className="h-3.5 w-3.5 text-emerald-600" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>
    </div>
  );
}
