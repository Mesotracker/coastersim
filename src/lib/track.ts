/**
 * Track model + geometry builder.
 *
 * The 2D editor is a side view: x = track forward distance, y = elevation.
 * Horizontal turns (curve pieces) bend the track in 3D (yaw).
 * Every piece starts with a smooth transition arc onto its target pitch,
 * ensuring C1 tangent continuity across the entire circuit.
 */

export type PieceKind =
  | 'straight'
  | 'up'
  | 'down'
  | 'curveL'
  | 'curveR'
  | 'hill'
  | 'valley'
  | 'loop'
  | 'zeroGRoll'
  | 'corkscrew'
  | 'immelmann'
  | 'jump'
  | 'brake'
  | 'boost';

export type Special = 0 | 1 | 2 | 3; // none | brake | boost | jump

export interface Piece {
  id: string;
  kind: PieceKind;
  /** length multiplier 0.4 – 2.4 */
  len: number;
  /** pitch / yaw strength multiplier 0.2 – 1.8 */
  power: number;
  /** extra pitch offset in degrees (-75 … 75) */
  rot: number;
}

export interface TrackDef {
  origin: { x: number; y: number };
  startPitch: number; // degrees
  pieces: Piece[];
}

export interface Seg {
  len: number;
  pitch: number; // degrees turned over the segment
  yaw: number; // degrees turned over the segment
  roll?: number; // degrees rolled (heartline banking twist)
}

export interface PieceDef {
  label: string;
  color: string;
  hint: string;
  special?: Special;
  /** absolute pitch the piece settles onto (deg) */
  target: number;
  /** does `power` scale the target pitch? (slopes yes, flats no) */
  targetScales?: boolean;
  body: Seg[];
  glyph: string;
}

export const PIECE_DEFS: Record<PieceKind, PieceDef> = {
  straight: {
    label: 'Straight',
    color: '#64748b',
    hint: 'Level run of track',
    target: 0,
    glyph: 'M2 12h20',
    body: [{ len: 62, pitch: 0, yaw: 0 }],
  },
  up: {
    label: 'Up Slope',
    color: '#22c55e',
    hint: 'Climb — trades speed for height',
    target: 32,
    targetScales: true,
    glyph: 'M2 19L22 6',
    body: [{ len: 48, pitch: 0, yaw: 0 }],
  },
  down: {
    label: 'Down Slope',
    color: '#f97316',
    hint: 'Drop — gravity builds speed',
    target: -32,
    targetScales: true,
    glyph: 'M2 6l20 13',
    body: [{ len: 48, pitch: 0, yaw: 0 }],
  },
  curveL: {
    label: 'Curve L',
    color: '#0ea5e9',
    hint: 'Banked left turn',
    target: 0,
    glyph: 'M3 18c6 0 12-4 18-12',
    body: [{ len: 104, pitch: 0, yaw: -54 }],
  },
  curveR: {
    label: 'Curve R',
    color: '#06b6d4',
    hint: 'Banked right turn',
    target: 0,
    glyph: 'M3 6c6 0 12 4 18 12',
    body: [{ len: 104, pitch: 0, yaw: 54 }],
  },
  hill: {
    label: 'Hill',
    color: '#a855f7',
    hint: 'Crest — airtime over the top',
    target: 0,
    glyph: 'M2 19C8 19 8 6 12 6s4 13 10 13',
    body: [
      { len: 42, pitch: 34, yaw: 0 },
      { len: 136, pitch: -68, yaw: 0 },
      { len: 42, pitch: 34, yaw: 0 },
    ],
  },
  valley: {
    label: 'Valley',
    color: '#ec4899',
    hint: 'Dip — heavy positive G',
    target: 0,
    glyph: 'M2 6c6 0 6 13 10 13s4-13 10-13',
    body: [
      { len: 42, pitch: -34, yaw: 0 },
      { len: 140, pitch: 68, yaw: 0 },
      { len: 42, pitch: -34, yaw: 0 },
    ],
  },
  loop: {
    label: 'Loop',
    color: '#ef4444',
    hint: 'Vertical loop — 360° inversion',
    target: 0,
    glyph: 'M2 18h4a6 6 0 1 1 6 0h6',
    body: [
      { len: 22, pitch: 0, yaw: 0 },
      { len: 74, pitch: 66, yaw: 0 },
      { len: 86, pitch: 228, yaw: 0 },
      { len: 74, pitch: 66, yaw: 0 },
      { len: 22, pitch: 0, yaw: 0 },
    ],
  },
  zeroGRoll: {
    label: 'Zero-G Roll',
    color: '#8b5cf6',
    hint: 'Parabolic airtime crest with full 360° weightless heartline roll',
    target: 0,
    glyph: 'M2 19c6 0 6-13 10-13s4 13 10 13 M8 12a4 4 0 1 0 8 0',
    body: [
      { len: 36, pitch: 28, yaw: 0, roll: 70 },
      { len: 82, pitch: -56, yaw: 0, roll: 220 },
      { len: 36, pitch: 28, yaw: 0, roll: 70 },
    ],
  },
  corkscrew: {
    label: 'Corkscrew',
    color: '#06b6d4',
    hint: '360° twist inversion combined with a banked lateral curve',
    target: 0,
    glyph: 'M2 18c4 0 6-8 10-8s4 8 10 8 M8 14c2-4 6-4 8 0',
    body: [
      { len: 34, pitch: 26, yaw: 22, roll: 90 },
      { len: 62, pitch: -52, yaw: 46, roll: 180 },
      { len: 34, pitch: 26, yaw: 22, roll: 90 },
    ],
  },
  immelmann: {
    label: 'Immelmann',
    color: '#ec4899',
    hint: 'Half vertical loop into a 180° twist turnaround',
    target: 0,
    glyph: 'M2 18h4c2 0 4-6 6-12 2 6 4 12 6 12h4 M8 9l8 6',
    body: [
      { len: 20, pitch: 0, yaw: 0, roll: 0 },
      { len: 52, pitch: 65, yaw: 35, roll: 90 },
      { len: 64, pitch: 45, yaw: 110, roll: 180 },
      { len: 52, pitch: -65, yaw: 35, roll: 90 },
      { len: 20, pitch: -45, yaw: 0, roll: 0 },
    ],
  },
  jump: {
    label: 'Mid-Air Jump',
    color: '#0284c7',
    hint: 'Ramps up and launches train across an open mid-air leap gap (Press E)',
    special: 3,
    target: 0,
    glyph: 'M2 18l6-6 M16 12l6 6 M8 7l8 2',
    body: [
      { len: 26, pitch: 26, yaw: 0 },
      { len: 48, pitch: -38, yaw: 0 },
      { len: 26, pitch: 12, yaw: 0 },
    ],
  },
  brake: {
    label: 'Brake',
    color: '#f43f5e',
    hint: 'Trim brakes slow the train down',
    special: 1,
    target: 0,
    glyph: 'M4 12h16M8 7v10M16 7v10',
    body: [{ len: 56, pitch: 0, yaw: 0 }],
  },
  boost: {
    label: 'Boost',
    color: '#facc15',
    hint: 'Launch section — adds thrust',
    special: 2,
    target: 0,
    glyph: 'M13 2L4 14h6l-1 8 9-12h-6z',
    body: [{ len: 56, pitch: 0, yaw: 0 }],
  },
};

export const PIECE_ORDER: PieceKind[] = [
  'straight',
  'up',
  'down',
  'curveL',
  'curveR',
  'hill',
  'valley',
  'loop',
  'zeroGRoll',
  'corkscrew',
  'immelmann',
  'jump',
  'brake',
  'boost',
];

/** Physical conversion constants */
export const METERS_PER_UNIT = 0.44;
export const FEET_PER_METER = 3.28084;
export const FEET_PER_UNIT = METERS_PER_UNIT * FEET_PER_METER; // ~1.4435 ft per unit
export const MPH_PER_MPS = 2.236936; // 1 m/s = 2.23694 mph
export const FT_PER_M = 3.28084;
export const GRAVITY = 9.81;

export interface Sample {
  s: number;
  x: number;
  y: number;
  pitch: number; // radians, + = climbing
  yaw: number; // radians
  roll: number; // radians (accumulated banking twist)
  kappa: number; // pitch curvature rad / unit
  yawRate: number; // rad / unit
  bank: number; // radians
  px: number;
  py: number;
  pz: number;
  piece: number;
  special: Special;
}

export interface BuiltTrack {
  samples: Sample[];
  pieceRanges: { start: number; end: number }[];
  nodes: { x: number; y: number; pitch: number }[];
  length: number;
  maxHeight: number;
  groundY: number;
  /** arc length where the chain lift lets go */
  liftEnd: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  tan: Float32Array;
  nor: Float32Array;
  center3: { x: number; z: number };
  radius3: number;
}

const DEG = Math.PI / 180;
const STEP = 1.6;

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

function normalize3(v: number[]) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross3(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Sub-segments for a piece, given the pitch (deg) the train arrives with.
 * Angle difference is normalized so that pieces added after loops (360°)
 * don't generate massive multi-hundred-unit reverse-pitch transition loops.
 */
export function segsFor(piece: Piece, entryPitch = 0): Seg[] {
  const def = PIECE_DEFS[piece.kind] || PIECE_DEFS.straight;
  const out: Seg[] = [];
  const target = clamp(def.target * (def.targetScales ? piece.power : 1) + piece.rot, -82, 82);

  // Normalize delta to [-180, 180] so loops (or multi-turn pitch) exit seamlessly
  let d = target - entryPitch;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;

  if (Math.abs(d) > 0.4) {
    out.push({ len: Math.max(22, Math.abs(d) * 2.2), pitch: d, yaw: 0, roll: 0 });
  }

  // Exact inversion elements (loops, zero-G rolls, corkscrews, immelmanns) maintain precision geometry
  const isFixed =
    piece.kind === 'loop' ||
    piece.kind === 'zeroGRoll' ||
    piece.kind === 'corkscrew' ||
    piece.kind === 'immelmann';

  for (const s of def.body) {
    out.push({
      len: Math.max(4, s.len * piece.len),
      pitch: isFixed ? s.pitch : s.pitch * piece.power,
      yaw: isFixed ? s.yaw : s.yaw * piece.power,
      roll: s.roll ?? 0,
    });
  }
  return out;
}

export function buildTrack(track: TrackDef): BuiltTrack {
  const samples: Sample[] = [];
  const pieceRanges: { start: number; end: number }[] = [];
  const nodes: { x: number; y: number; pitch: number }[] = [];

  let s = 0;
  let x = track.origin.x;
  let y = track.origin.y;
  let pitch = track.startPitch * DEG;
  let yaw = 0;
  let roll = 0;
  let px = 0;
  let py = track.origin.y;
  let pz = 0;

  let minX = x;
  let maxX = x;
  let minY = y;
  let maxY = y;
  let minPX = 0;
  let maxPX = 0;
  let minPZ = 0;
  let maxPZ = 0;

  const push = (piece: number, special: Special, kappa: number, yawRate: number) => {
    samples.push({ s, x, y, pitch, yaw, roll, kappa, yawRate, bank: 0, px, py, pz, piece, special });
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (px < minPX) minPX = px;
    if (px > maxPX) maxPX = px;
    if (pz < minPZ) minPZ = pz;
    if (pz > maxPZ) maxPZ = pz;
  };

  for (let pi = 0; pi < track.pieces.length; pi++) {
    const piece = track.pieces[pi];
    const def = PIECE_DEFS[piece.kind] || PIECE_DEFS.straight;
    const special = def.special ?? 0;
    const start = samples.length;

    // Normalize entry angle to [-180, 180] degrees so subsequent pieces connect without glitching
    let currentDeg = pitch / DEG;
    while (currentDeg > 180) currentDeg -= 360;
    while (currentDeg < -180) currentDeg += 360;

    for (const seg of segsFor(piece, currentDeg)) {
      const len = Math.max(2, seg.len);
      const n = Math.max(2, Math.ceil(len / STEP));
      const ds = len / n;
      const kappa = (seg.pitch * DEG) / len;
      const yawRate = (seg.yaw * DEG) / len;
      const rollRate = ((seg.roll ?? 0) * DEG) / len;
      for (let i = 0; i < n; i++) {
        push(pi, special, kappa, yawRate);
        const h = Math.cos(pitch) * ds;
        const vUp = Math.sin(pitch) * ds;
        x += h;
        y += vUp;
        px += Math.cos(yaw) * h;
        pz += Math.sin(yaw) * h;
        py += vUp;
        pitch += kappa * ds;
        yaw += yawRate * ds;
        roll += rollRate * ds;
        s += ds;
      }
    }

    // Normalize pitch angle at the end of each piece so multi-revolution loops cleanly transition
    while (pitch > Math.PI) pitch -= Math.PI * 2;
    while (pitch < -Math.PI) pitch += Math.PI * 2;

    // Normalize roll angle if it made full rotations
    while (roll >= Math.PI * 2) roll -= Math.PI * 2;
    while (roll <= -Math.PI * 2) roll += Math.PI * 2;

    pieceRanges.push({ start, end: Math.max(start, samples.length - 1) });
    nodes.push({ x, y, pitch });
  }
  push(Math.max(0, track.pieces.length - 1), 0, 0, 0);

  const n = samples.length;

  // ---- banking (baked from horizontal curvature + procedural roll twist) ---
  const raw = new Float32Array(n);
  const vRef = 24; // m/s realistic mid-ride speed used to bake the banking (54 mph)
  for (let i = 0; i < n; i++) {
    const yawPerMeter = samples[i].yawRate / METERS_PER_UNIT;
    raw[i] = clamp(Math.atan2(vRef * vRef * yawPerMeter, GRAVITY), -1.05, 1.05);
  }
  const win = 12;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let k = -win; k <= win; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      sum += raw[j];
      cnt++;
    }
    // Centrifugal curvature bank plus procedural heartline roll twist
    samples[i].bank = sum / cnt + samples[i].roll;
  }

  // ---- 3D frames via parallel transport -----------------------------------
  const tan = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(n - 1, i + 1)];
    let t = normalize3([b.px - a.px, b.py - a.py, b.pz - a.pz]);
    if (!isFinite(t[0]) || (t[0] === 0 && t[1] === 0 && t[2] === 0)) t = [1, 0, 0];
    tan[i * 3] = t[0];
    tan[i * 3 + 1] = t[1];
    tan[i * 3 + 2] = t[2];
  }
  let nPrev = [0, 1, 0];
  {
    const t0 = [tan[0], tan[1], tan[2]];
    const r = normalize3(cross3(t0, [0, 1, 0]));
    const guess = normalize3(cross3(r, t0));
    if (isFinite(guess[0])) nPrev = guess;
  }
  for (let i = 0; i < n; i++) {
    const t = [tan[i * 3], tan[i * 3 + 1], tan[i * 3 + 2]];
    const d = nPrev[0] * t[0] + nPrev[1] * t[1] + nPrev[2] * t[2];
    let nv = normalize3([nPrev[0] - t[0] * d, nPrev[1] - t[1] * d, nPrev[2] - t[2] * d]);
    if (!isFinite(nv[0])) nv = [0, 1, 0];
    nPrev = nv;
    nor[i * 3] = nv[0];
    nor[i * 3 + 1] = nv[1];
    nor[i * 3 + 2] = nv[2];
  }

  // ---- chain lift: runs from the station up to the first descent ----------
  let liftEnd = 0;
  const maxLift = s * 0.55;
  for (let i = 0; i < n; i++) {
    const sm = samples[i];
    if (sm.s > maxLift) break;
    const kind = track.pieces[sm.piece]?.kind;
    if (kind === 'loop' || sm.special !== 0) break;
    if (sm.s > 8 && Math.sin(sm.pitch) < -0.03) break;
    liftEnd = sm.s;
  }
  liftEnd = Math.max(Math.min(38, s * 0.3), liftEnd);

  const cx = (minPX + maxPX) / 2;
  const cz = (minPZ + maxPZ) / 2;
  const radius3 = Math.max(90, Math.hypot(maxPX - minPX, maxPZ - minPZ) / 2);

  return {
    samples,
    pieceRanges,
    nodes,
    length: s,
    maxHeight: maxY,
    groundY: Math.min(0, minY - 7),
    liftEnd,
    bounds: { minX, maxX, minY, maxY },
    tan,
    nor,
    center3: { x: cx, z: cz },
    radius3,
  };
}

export interface Frame {
  s: number;
  x: number;
  y: number;
  pitch: number;
  kappa: number;
  yawRate: number;
  bank: number;
  special: Special;
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
  nx: number;
  ny: number;
  nz: number;
}

const scratch: Frame = {
  s: 0, x: 0, y: 0, pitch: 0, kappa: 0, yawRate: 0, bank: 0, special: 0,
  px: 0, py: 0, pz: 0, tx: 1, ty: 0, tz: 0, nx: 0, ny: 1, nz: 0,
};

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function indexAt(track: BuiltTrack, s: number): number {
  const arr = track.samples;
  const n = arr.length;
  if (n < 2) return 0;
  if (s <= 0) return 0;
  if (s >= track.length) return n - 2;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].s <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function frameAt(track: BuiltTrack, s: number, out: Frame = scratch): Frame {
  const arr = track.samples;
  const i = indexAt(track, s);
  const j = Math.min(arr.length - 1, i + 1);
  const a = arr[i];
  const b = arr[j];
  const span = b.s - a.s || 1;
  const t = clamp((s - a.s) / span, 0, 1);
  out.s = s;
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.pitch = lerpAngle(a.pitch, b.pitch, t);
  out.kappa = a.kappa + (b.kappa - a.kappa) * t;
  out.yawRate = a.yawRate + (b.yawRate - a.yawRate) * t;
  out.bank = a.bank + (b.bank - a.bank) * t;
  out.special = t < 0.5 ? a.special : b.special;
  out.px = a.px + (b.px - a.px) * t;
  out.py = a.py + (b.py - a.py) * t;
  out.pz = a.pz + (b.pz - a.pz) * t;
  const i3 = i * 3;
  const j3 = j * 3;
  out.tx = track.tan[i3] + (track.tan[j3] - track.tan[i3]) * t;
  out.ty = track.tan[i3 + 1] + (track.tan[j3 + 1] - track.tan[i3 + 1]) * t;
  out.tz = track.tan[i3 + 2] + (track.tan[j3 + 2] - track.tan[i3 + 2]) * t;
  out.nx = track.nor[i3] + (track.nor[j3] - track.nor[i3]) * t;
  out.ny = track.nor[i3 + 1] + (track.nor[j3 + 1] - track.nor[i3 + 1]) * t;
  out.nz = track.nor[i3 + 2] + (track.nor[j3 + 2] - track.nor[i3 + 2]) * t;
  const tl = Math.hypot(out.tx, out.ty, out.tz) || 1;
  out.tx /= tl;
  out.ty /= tl;
  out.tz /= tl;
  const nl = Math.hypot(out.nx, out.ny, out.nz) || 1;
  out.nx /= nl;
  out.ny /= nl;
  out.nz /= nl;
  return out;
}

export function makeFrame(): Frame {
  return { ...scratch };
}

let uid = 0;
export function newPiece(kind: PieceKind): Piece {
  uid += 1;
  return { id: `p${uid}_${Math.random().toString(36).slice(2, 7)}`, kind, len: 1, power: 1, rot: 0 };
}

export function piece(kind: PieceKind, overrides?: Partial<Piece>): Piece {
  const p = newPiece(kind);
  return overrides ? { ...p, ...overrides } : p;
}

function chain(kinds: PieceKind[]): Piece[] {
  return kinds.map((k) => newPiece(k));
}

export interface Preset {
  id: string;
  name: string;
  category: 'Classic' | 'Inversion' | 'Hyper' | 'Launched' | 'Extreme' | 'Family';
  description: string;
  themeName?: string;
  build: () => TrackDef;
}

export const PRESETS: Preset[] = [
  {
    id: 'classic-woodie',
    name: 'Classic Out & Back',
    category: 'Classic',
    description: 'Traditional wooden layout featuring a chain lift hill, sweeping camelback airtime hills, and a return brake run.',
    themeName: 'Classic Woodie',
    build: () => ({
      origin: { x: 0, y: 30 },
      startPitch: 0,
      pieces: [
        piece('straight', { len: 1.2 }),
        piece('up', { len: 1.2 }),
        piece('up', { len: 1.2 }),
        piece('up', { len: 1.2 }),
        piece('down', { len: 1.2, power: 1.2 }),
        piece('down', { len: 1.2, power: 1.2 }),
        piece('valley', { len: 1.1 }),
        piece('hill', { len: 1.3, power: 1.1 }),
        piece('valley', { len: 1.0 }),
        piece('curveL', { len: 1.2, power: 1.1 }),
        piece('curveL', { len: 1.2, power: 1.1 }),
        piece('hill', { len: 1.2 }),
        piece('valley', { len: 1.0 }),
        piece('curveL', { len: 1.2, power: 1.1 }),
        piece('curveL', { len: 1.2, power: 1.1 }),
        piece('hill', { len: 1.0 }),
        piece('brake', { len: 1.2 }),
        piece('straight', { len: 1.0 }),
      ],
    }),
  },
  {
    id: 'loop-machine',
    name: 'Loop Machine',
    category: 'Inversion',
    description: 'High-speed steel multilooper with consecutive 360° vertical loops, booster launch section, and dynamic banked turns.',
    themeName: 'Steel Blue',
    build: () => ({
      origin: { x: 0, y: 30 },
      startPitch: 0,
      pieces: [
        piece('straight', { len: 1.0 }),
        piece('up', { len: 1.1 }),
        piece('up', { len: 1.1 }),
        piece('up', { len: 1.1 }),
        piece('up', { len: 1.1 }),
        piece('down', { len: 1.2, power: 1.3 }),
        piece('down', { len: 1.2, power: 1.3 }),
        piece('down', { len: 1.1, power: 1.2 }),
        piece('loop', { len: 1.1, power: 1.05 }),
        piece('curveR', { len: 1.1, power: 1.0 }),
        piece('hill', { len: 1.1 }),
        piece('boost', { len: 1.2 }),
        piece('loop', { len: 1.05, power: 1.0 }),
        piece('curveR', { len: 1.1, power: 1.0 }),
        piece('valley', { len: 1.1 }),
        piece('brake', { len: 1.1 }),
        piece('straight', { len: 1.0 }),
      ],
    }),
  },
  {
    id: 'airtime-goliath',
    name: 'Airtime Goliath (Hyper)',
    category: 'Hyper',
    description: '200+ ft drops delivering massive sustained negative G-force floating camelbacks and high-speed overbanked turns.',
    themeName: 'Inferno',
    build: () => ({
      origin: { x: 0, y: 30 },
      startPitch: 0,
      pieces: [
        piece('straight', { len: 1.0 }),
        piece('up', { len: 1.2 }),
        piece('up', { len: 1.2 }),
        piece('up', { len: 1.2 }),
        piece('up', { len: 1.2 }),
        piece('up', { len: 1.2 }),
        piece('down', { len: 1.3, power: 1.3 }),
        piece('down', { len: 1.3, power: 1.3 }),
        piece('valley', { len: 1.2 }),
        piece('hill', { len: 1.4, power: 1.2 }),
        piece('valley', { len: 1.1 }),
        piece('hill', { len: 1.3, power: 1.15 }),
        piece('curveL', { len: 1.2, power: 1.1 }),
        piece('curveL', { len: 1.2, power: 1.1 }),
        piece('boost', { len: 1.2 }),
        piece('hill', { len: 1.2, power: 1.1 }),
        piece('valley', { len: 1.0 }),
        piece('hill', { len: 1.1 }),
        piece('brake', { len: 1.3 }),
        piece('straight', { len: 1.0 }),
      ],
    }),
  },
  {
    id: 'top-thrill-rocket',
    name: 'Top Thrill Rocket (Launch)',
    category: 'Launched',
    description: 'High-powered magnetic straight launch accelerating to 80+ mph, 90° vertical ascent tower, top hat zero-G crest, and 90° diving plunge.',
    themeName: 'Neon Cyber',
    build: () => ({
      origin: { x: 0, y: 24 },
      startPitch: 0,
      pieces: [
        piece('straight', { len: 1.0 }),
        piece('boost', { len: 1.5 }),
        piece('boost', { len: 1.5 }),
        piece('up', { len: 1.2, power: 1.5 }),
        piece('up', { len: 1.2, power: 1.5 }),
        piece('hill', { len: 1.1, power: 1.1 }),
        piece('down', { len: 1.2, power: 1.5 }),
        piece('down', { len: 1.2, power: 1.5 }),
        piece('valley', { len: 1.3 }),
        piece('curveR', { len: 1.2, power: 1.1 }),
        piece('curveR', { len: 1.2, power: 1.1 }),
        piece('hill', { len: 1.3, power: 1.1 }),
        piece('brake', { len: 1.4 }),
        piece('brake', { len: 1.2 }),
        piece('straight', { len: 1.0 }),
      ],
    }),
  },
  {
    id: 'zero-g-phantom',
    name: 'Phantom Zero-G & Corkscrew',
    category: 'Inversion',
    description: 'B&M style custom floorless coaster with a 140 ft drop, soaring weightless Zero-G Roll, towering Immelmann turnaround, and high-speed Corkscrews.',
    themeName: 'Neon Cyber',
    build: () => ({
      origin: { x: 0, y: 32 },
      startPitch: 0,
      pieces: [
        piece('straight', { len: 1.0 }),
        piece('up', { len: 1.2 }),
        piece('up', { len: 1.2 }),
        piece('up', { len: 1.2 }),
        piece('down', { len: 1.3, power: 1.3 }),
        piece('down', { len: 1.3, power: 1.3 }),
        piece('zeroGRoll', { len: 1.1 }),
        piece('valley', { len: 1.1 }),
        piece('immelmann', { len: 1.05 }),
        piece('boost', { len: 1.1 }),
        piece('corkscrew', { len: 1.1 }),
        piece('curveR', { len: 1.2, power: 1.0 }),
        piece('hill', { len: 1.1, power: 1.0 }),
        piece('corkscrew', { len: 1.05 }),
        piece('curveL', { len: 1.1, power: 1.0 }),
        piece('brake', { len: 1.3 }),
        piece('straight', { len: 1.0 }),
      ],
    }),
  },
  {
    id: 'cobra-blitz',
    name: 'Cobra Roll & Corkscrew',
    category: 'Inversion',
    description: 'Steel speed demon with a towering vertical loop, fast turnaround sweep, high-speed Corkscrew, weightless Zero-G roll, and terrain-hugging curves.',
    themeName: 'Viper',
    build: () => ({
      origin: { x: 0, y: 30 },
      startPitch: 0,
      pieces: [
        piece('straight', { len: 1.0 }),
        piece('up', { len: 1.1 }),
        piece('up', { len: 1.1 }),
        piece('up', { len: 1.1 }),
        piece('down', { len: 1.2, power: 1.2 }),
        piece('down', { len: 1.2, power: 1.2 }),
        piece('loop', { len: 1.1, power: 1.1 }),
        piece('curveL', { len: 1.1, power: 1.0 }),
        piece('zeroGRoll', { len: 1.05 }),
        piece('curveL', { len: 1.1, power: 1.0 }),
        piece('boost', { len: 1.2 }),
        piece('corkscrew', { len: 1.1 }),
        piece('valley', { len: 1.1 }),
        piece('curveR', { len: 1.2, power: 1.1 }),
        piece('curveR', { len: 1.2, power: 1.1 }),
        piece('brake', { len: 1.2 }),
        piece('straight', { len: 1.0 }),
      ],
    }),
  },
  {
    id: 'dive-coaster',
    name: 'The Dive Coaster (90° Cliff)',
    category: 'Extreme',
    description: 'High vertical lift, holding brake cliffhanger, sheer 90-degree vertical dive into a massive Immelmann loop and high-banked helix.',
    themeName: 'Obsidian Gold',
    build: () => ({
      origin: { x: 0, y: 40 },
      startPitch: 0,
      pieces: [
        piece('straight', { len: 0.8 }),
        piece('up', { len: 1.3 }),
        piece('up', { len: 1.3 }),
        piece('up', { len: 1.3 }),
        piece('brake', { len: 0.7 }),
        piece('down', { len: 1.4, power: 1.7 }),
        piece('down', { len: 1.4, power: 1.7 }),
        piece('valley', { len: 1.2 }),
        piece('immelmann', { len: 1.1 }),
        piece('curveR', { len: 1.2, power: 1.1 }),
        piece('curveR', { len: 1.2, power: 1.1 }),
        piece('zeroGRoll', { len: 1.0 }),
        piece('brake', { len: 1.4 }),
        piece('straight', { len: 1.0 }),
      ],
    }),
  },
  {
    id: 'wild-mouse',
    name: 'Wild Mouse Switchbacks',
    category: 'Classic',
    description: 'Carnival park legend with rapid unbanked 180° hairpin switchback turns, sudden sharp dips, and rapid bunny hops.',
    themeName: 'Pastel Pop',
    build: () => ({
      origin: { x: 0, y: 32 },
      startPitch: 0,
      pieces: [
        piece('straight', { len: 1.0 }),
        piece('up', { len: 1.1 }),
        piece('up', { len: 1.1 }),
        piece('up', { len: 1.1 }),
        piece('curveL', { len: 0.9, power: 1.3 }),
        piece('curveL', { len: 0.9, power: 1.3 }),
        piece('down', { len: 0.9, power: 1.2 }),
        piece('hill', { len: 0.9 }),
        piece('curveR', { len: 0.9, power: 1.3 }),
        piece('curveR', { len: 0.9, power: 1.3 }),
        piece('down', { len: 0.9, power: 1.2 }),
        piece('valley', { len: 0.9 }),
        piece('curveL', { len: 0.9, power: 1.3 }),
        piece('curveL', { len: 0.9, power: 1.3 }),
        piece('hill', { len: 0.8 }),
        piece('valley', { len: 0.8 }),
        piece('hill', { len: 0.8 }),
        piece('brake', { len: 1.0 }),
        piece('straight', { len: 1.0 }),
      ],
    }),
  },
  {
    id: 'euro-fighter',
    name: 'Euro-Fighter Beyond-Vertical',
    category: 'Extreme',
    description: 'Compact steel powerhouse with vertical tower lift, beyond-vertical 97° drop, giant vertical loop, and tight twisting airtime rolls.',
    themeName: 'Inferno',
    build: () => ({
      origin: { x: 0, y: 30 },
      startPitch: 0,
      pieces: [
        piece('straight', { len: 1.0 }),
        piece('up', { len: 1.2, power: 1.4 }),
        piece('up', { len: 1.2, power: 1.4 }),
        piece('up', { len: 1.2, power: 1.4 }),
        piece('down', { len: 1.3, power: 1.5 }),
        piece('down', { len: 1.3, power: 1.5 }),
        piece('loop', { len: 1.15, power: 1.1 }),
        piece('curveL', { len: 1.1, power: 1.1 }),
        piece('hill', { len: 1.2 }),
        piece('curveL', { len: 1.1, power: 1.1 }),
        piece('boost', { len: 1.1 }),
        piece('loop', { len: 1.05, power: 1.0 }),
        piece('valley', { len: 1.1 }),
        piece('brake', { len: 1.2 }),
        piece('straight', { len: 1.0 }),
      ],
    }),
  },
  {
    id: 'twister-helix',
    name: 'Twister & Double Helix',
    category: 'Hyper',
    description: 'Interlocking figure-eight layout with intense positive G-force spiral helixes, speed valleys, and sweeping parabolic flybys.',
    themeName: 'Steel Blue',
    build: () => ({
      origin: { x: 0, y: 30 },
      startPitch: 0,
      pieces: [
        piece('straight', { len: 1.0 }),
        piece('up', { len: 1.1 }),
        piece('up', { len: 1.1 }),
        piece('up', { len: 1.1 }),
        piece('curveL', { len: 1.1, power: 1.1 }),
        piece('down', { len: 1.2, power: 1.2 }),
        piece('down', { len: 1.2, power: 1.2 }),
        piece('valley', { len: 1.1 }),
        piece('curveL', { len: 1.2, power: 1.2 }),
        piece('curveL', { len: 1.2, power: 1.2 }),
        piece('hill', { len: 1.3, power: 1.1 }),
        piece('curveR', { len: 1.2, power: 1.2 }),
        piece('curveR', { len: 1.2, power: 1.2 }),
        piece('valley', { len: 1.1 }),
        piece('hill', { len: 1.1 }),
        piece('brake', { len: 1.2 }),
        piece('straight', { len: 1.0 }),
      ],
    }),
  },
  {
    id: 'family-dragon',
    name: 'Dragon Junior Family Coaster',
    category: 'Family',
    description: 'Smooth, approachable family coaster with gentle hills, broad banked carousel turns, and mild floating airtime.',
    themeName: 'Classic Woodie',
    build: () => ({
      origin: { x: 0, y: 28 },
      startPitch: 0,
      pieces: [
        piece('straight', { len: 1.0 }),
        piece('up', { len: 1.0 }),
        piece('up', { len: 1.0 }),
        piece('down', { len: 1.0, power: 0.9 }),
        piece('down', { len: 1.0, power: 0.9 }),
        piece('hill', { len: 1.1, power: 0.8 }),
        piece('curveL', { len: 1.1, power: 0.9 }),
        piece('curveL', { len: 1.1, power: 0.9 }),
        piece('valley', { len: 1.0 }),
        piece('hill', { len: 1.0, power: 0.8 }),
        piece('curveL', { len: 1.1, power: 0.9 }),
        piece('curveL', { len: 1.1, power: 0.9 }),
        piece('brake', { len: 1.1 }),
        piece('straight', { len: 1.0 }),
      ],
    }),
  },
];

export function defaultTrack(): TrackDef {
  return PRESETS[0].build();
}
