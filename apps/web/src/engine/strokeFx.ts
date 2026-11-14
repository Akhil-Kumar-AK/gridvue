import { flatten, type SceneNode } from '@layr/core';
import type { BrushId, WidthProfile } from '@layr/core';

export interface Pt { x: number; y: number }
export interface Poly { pts: Pt[]; closed: boolean }

/** Outline of a layer as polylines in its own space (curves sampled). */
export function outlines(n: SceneNode): Poly[] {
  if (n.type === 'LINE') return [{ pts: [{ x: 0, y: 0 }, { x: n.width, y: 0 }], closed: false }];
  if (n.type === 'VECTOR' && n.path) return [n.path, ...(n.subpaths ?? [])].filter(p => p.points.length > 1).map(p => ({ pts: flatten(p, 20), closed: p.closed }));
  if (n.type === 'ELLIPSE') {
    const rx = n.width / 2, ry = n.height / 2, N = 72;
    return [{ pts: Array.from({ length: N }, (_, i) => ({ x: rx + rx * Math.cos((i / N) * Math.PI * 2), y: ry + ry * Math.sin((i / N) * Math.PI * 2) })), closed: true }];
  }
  const w = n.width, h = n.height, r = Math.min(n.cornerRadius, w / 2, h / 2), pts: Pt[] = [];
  if (r < 0.5) pts.push({ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h });
  else for (const [cx, cy, a0] of [[w - r, r, -Math.PI / 2], [w - r, h - r, 0], [r, h - r, Math.PI / 2], [r, r, Math.PI]] as const) for (let k = 0; k <= 6; k++) { const a = a0 + (k / 6) * (Math.PI / 2); pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
  return [{ pts, closed: true }];
}

const lenOf = (pts: Pt[], closed: boolean) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (closed) L += Math.hypot(pts[0].x - pts.at(-1)!.x, pts[0].y - pts.at(-1)!.y); return L; };
/** Evenly spaced samples along a polyline with unit normals. */
export function resample(poly: Poly, step: number): { p: Pt; nx: number; ny: number; t: number; s: number }[] {
  const pts = poly.closed ? [...poly.pts, poly.pts[0]] : poly.pts;
  const L = lenOf(poly.pts, poly.closed);
  if (L < 1e-6) return [];
  const count = Math.max(2, Math.ceil(L / step));
  const out: { p: Pt; nx: number; ny: number; t: number; s: number }[] = [];
  let seg = 0, acc = 0;
  for (let i = 0; i <= count; i++) {
    const target = (i / count) * L;
    while (seg < pts.length - 2 && acc + Math.hypot(pts[seg + 1].x - pts[seg].x, pts[seg + 1].y - pts[seg].y) < target) { acc += Math.hypot(pts[seg + 1].x - pts[seg].x, pts[seg + 1].y - pts[seg].y); seg++; }
    const a = pts[seg], b = pts[seg + 1], sl = Math.hypot(b.x - a.x, b.y - a.y) || 1, f = Math.min(1, Math.max(0, (target - acc) / sl));
    out.push({ p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, nx: -(b.y - a.y) / sl, ny: (b.x - a.x) / sl, t: i / count, s: target });
  }
  return out;
}
/** Smooth deterministic noise in [-1, 1]. */
function noise(x: number, seed = 0): number {
  const h = (i: number) => { const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; };
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

/** Dynamic stroke: the outline is walked in small steps and pushed sideways by a hand-drawn looking wave. */
export function wiggled(poly: Poly, weight: number, d: { frequency: number; wiggle: number; smoothen: number }): Poly {
  const lambda = 120 / (0.25 + (d.frequency / 100) * 3.2), amp = (d.wiggle / 100) * (4 + weight * 2);
  const S = resample(poly, Math.max(1.5, lambda / 10));
  let pts = S.map(q => { const o = amp * (0.75 * Math.sin((q.s / lambda) * Math.PI * 2) + 0.35 * noise(q.s / (lambda * 0.7), 3)); return { x: q.p.x + q.nx * o, y: q.p.y + q.ny * o }; });
  if (poly.closed && pts.length > 2) pts = pts.slice(0, -1);
  for (let k = 0; k < Math.round(d.smoothen / 25); k++) { // light smoothing passes
    const n = pts.length; pts = pts.map((q, i) => { const a = pts[poly.closed ? (i + n - 1) % n : Math.max(0, i - 1)], b = pts[poly.closed ? (i + 1) % n : Math.min(n - 1, i + 1)]; return { x: (a.x + 2 * q.x + b.x) / 4, y: (a.y + 2 * q.y + b.y) / 4 }; }); }
  return { pts, closed: poly.closed };
}

const profile = (kind: WidthProfile | undefined, t: number): number => kind === 'TAPER' ? 1 - 0.85 * t : kind === 'BULGE' ? 0.3 + 0.7 * Math.sin(Math.PI * t) : kind === 'TAPER_BOTH' ? Math.pow(Math.sin(Math.PI * t), 0.65) * 0.95 + 0.05 : 1;
const BRUSH: Record<BrushId, { taper: (t: number) => number; rough: number; grain: number }> = {
  CHARCOAL: { taper: t => 1 - 0.75 * Math.pow(t, 1.6), rough: 0.22, grain: 3.2 },
  MARKER: { taper: t => 0.85 + 0.15 * Math.sin(Math.PI * t) - 0.1 * t, rough: 0.03, grain: 1 },
  CHALK: { taper: () => 1, rough: 0.34, grain: 4.2 },
  INK: { taper: t => Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.5) * 0.92 + 0.08, rough: 0.05, grain: 1.4 },
};
export const BRUSHES: { id: BrushId; label: string }[] = [{ id: 'CHARCOAL', label: 'Charcoal' }, { id: 'MARKER', label: 'Marker' }, { id: 'CHALK', label: 'Chalk' }, { id: 'INK', label: 'Ink' }];

/** Variable-width outline polygon (width profile and brush) for one polyline; fill it with the stroke paint. */
export function widthPolygon(poly: Poly, weight: number, o: { profile?: WidthProfile; flip?: boolean; brush?: { id: BrushId; direction: 'LEFT' | 'RIGHT' } }): Pt[][] {
  const S = resample(poly, Math.max(1, weight / 3));
  if (S.length < 2) return [];
  const br = o.brush ? BRUSH[o.brush.id] : null;
  const left: Pt[] = [], right: Pt[] = [];
  S.forEach((q, i) => {
    let t = q.t; if (o.flip) t = 1 - t;
    let w = weight * profile(o.profile, t);
    if (br) { const bt = o.brush!.direction === 'RIGHT' ? q.t : 1 - q.t; w *= br.taper(bt); }
    const jl = br ? 1 + br.rough * noise(i / br.grain, 1) : 1, jr = br ? 1 + br.rough * noise(i / br.grain, 7) : 1;
    left.push({ x: q.p.x + q.nx * (w / 2) * jl, y: q.p.y + q.ny * (w / 2) * jl });
    right.push({ x: q.p.x - q.nx * (w / 2) * jr, y: q.p.y - q.ny * (w / 2) * jr });
  });
  if (poly.closed) return [left.slice(0, -1), right.slice(0, -1)]; // two loops, filled even-odd as a ring
  return [[...left, ...right.reverse()]];
}
