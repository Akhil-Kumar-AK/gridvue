import type { PathPoint, VectorPath } from './model';
import type { Pt, Rect } from './geometry';

type Seg = { p0: Pt; c1: Pt; c2: Pt; p1: Pt };

export const corner = (x: number, y: number): PathPoint => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });
export const segmentCount = (p: VectorPath) => (p.closed ? p.points.length : Math.max(0, p.points.length - 1));
export function segment(path: VectorPath, i: number): Seg {
  const a = path.points[i], b = path.points[(i + 1) % path.points.length];
  return { p0: { x: a.x, y: a.y }, c1: { x: a.x + a.ox, y: a.y + a.oy }, c2: { x: b.x + b.ix, y: b.y + b.iy }, p1: { x: b.x, y: b.y } };
}
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export function bezierAt(s: Seg, t: number): Pt {
  const a = lerp(s.p0, s.c1, t), b = lerp(s.c1, s.c2, t), c = lerp(s.c2, s.p1, t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

/** Polyline approximation (uniform parameter sampling; straight segments stay single). */
export function flatten(path: VectorPath, steps = 16): Pt[] {
  const out: Pt[] = [];
  const n = segmentCount(path);
  if (!path.points.length) return out;
  out.push({ x: path.points[0].x, y: path.points[0].y });
  for (let i = 0; i < n; i++) {
    const s = segment(path, i);
    const straight = s.c1.x === s.p0.x && s.c1.y === s.p0.y && s.c2.x === s.p1.x && s.c2.y === s.p1.y;
    if (straight) out.push(s.p1);
    else for (let k = 1; k <= steps; k++) out.push(bezierAt(s, k / steps));
  }
  return out;
}
export function pathBounds(path: VectorPath): Rect {
  const pts = flatten(path, 24);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function translatePath(path: VectorPath, dx: number, dy: number): VectorPath {
  return { ...path, points: path.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) };
}
export function scalePath(path: VectorPath, sx: number, sy: number): VectorPath {
  return { ...path, points: path.points.map(p => ({ x: p.x * sx, y: p.y * sy, ix: p.ix * sx, iy: p.iy * sy, ox: p.ox * sx, oy: p.oy * sy })) };
}

export function distToSegment(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { d: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t };
}
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) inside = !inside;
  return inside;
}

/** Closest point on the path: segment index, curve parameter and distance. */
export function nearestOnPath(path: VectorPath, p: Pt): { seg: number; t: number; dist: number; point: Pt } | null {
  let best: { seg: number; t: number; dist: number; point: Pt } | null = null;
  const n = segmentCount(path), steps = 24;
  for (let i = 0; i < n; i++) {
    const s = segment(path, i);
    let prev = s.p0;
    for (let k = 1; k <= steps; k++) {
      const cur = bezierAt(s, k / steps);
      const r = distToSegment(p, prev, cur);
      if (!best || r.d < best.dist) { const tt = (k - 1 + r.t) / steps; best = { seg: i, t: tt, dist: r.d, point: bezierAt(s, tt) }; }
      prev = cur;
    }
  }
  return best;
}

/** Split segment `seg` at parameter t (de Casteljau) and return the path with a new smooth-preserving anchor. */
export function insertPoint(path: VectorPath, seg: number, t: number): { path: VectorPath; index: number } {
  const s = segment(path, seg);
  const a = lerp(s.p0, s.c1, t), b = lerp(s.c1, s.c2, t), c = lerp(s.c2, s.p1, t), d = lerp(a, b, t), e = lerp(b, c, t), m = lerp(d, e, t);
  const pts = path.points.map(p => ({ ...p }));
  const i0 = seg, i1 = (seg + 1) % pts.length;
  pts[i0] = { ...pts[i0], ox: a.x - pts[i0].x, oy: a.y - pts[i0].y };
  pts[i1] = { ...pts[i1], ix: c.x - pts[i1].x, iy: c.y - pts[i1].y };
  const np: PathPoint = { x: m.x, y: m.y, ix: d.x - m.x, iy: d.y - m.y, ox: e.x - m.x, oy: e.y - m.y };
  const at = seg + 1;
  pts.splice(at, 0, np);
  return { path: { ...path, points: pts }, index: at };
}

/** Delete anchors; neighbours keep their own handles. Returns null when fewer than 2 anchors would remain. */
export function deletePoints(path: VectorPath, idx: number[]): VectorPath | null {
  const pts = path.points.filter((_, i) => !idx.includes(i));
  return pts.length < 2 ? null : { ...path, points: pts };
}

/** Make an anchor smooth (handles along the neighbours' direction) or sharp (no handles). */
export function setSmooth(path: VectorPath, i: number, smooth: boolean): VectorPath {
  const pts = path.points.map(p => ({ ...p }));
  const p = pts[i], n = pts.length;
  if (!smooth) { pts[i] = { ...p, ix: 0, iy: 0, ox: 0, oy: 0 }; return { ...path, points: pts }; }
  const prev = path.closed || i > 0 ? pts[(i - 1 + n) % n] : null, next = path.closed || i < n - 1 ? pts[(i + 1) % n] : null;
  const ref = prev && next ? { x: next.x - prev.x, y: next.y - prev.y } : next ? { x: next.x - p.x, y: next.y - p.y } : prev ? { x: p.x - prev.x, y: p.y - prev.y } : { x: 1, y: 0 };
  const len = Math.hypot(ref.x, ref.y) || 1, ux = ref.x / len, uy = ref.y / len;
  const dPrev = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) / 3 : 20, dNext = next ? Math.hypot(next.x - p.x, next.y - p.y) / 3 : 20;
  pts[i] = { ...p, ix: -ux * dPrev, iy: -uy * dPrev, ox: ux * dNext, oy: uy * dNext };
  return { ...path, points: pts };
}
export const isSmooth = (p: PathPoint) => p.ix !== 0 || p.iy !== 0 || p.ox !== 0 || p.oy !== 0;

/** Ramer–Douglas–Peucker simplification. */
export function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  let dmax = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const d = distToSegment(pts[i], a, b).d; if (d > dmax) { dmax = d; idx = i; } }
  if (dmax <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}
/** Turn a polyline into an open path with Catmull–Rom derived bezier handles. */
export function smoothPolyline(pts: Pt[]): VectorPath {
  const n = pts.length;
  const points: PathPoint[] = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const tx = (b.x - a.x) / 6, ty = (b.y - a.y) / 6;
    return { x: p.x, y: p.y, ix: i === 0 ? 0 : -tx, iy: i === 0 ? 0 : -ty, ox: i === n - 1 ? 0 : tx, oy: i === n - 1 ? 0 : ty };
  });
  return { points, closed: false };
}
