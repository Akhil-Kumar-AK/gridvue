/**
 * Whiteboard ("jam") document model — DOM-free so the server can validate it and the web app can render it.
 * A board is a flat map of items plus a z-order list. Connectors reference items by id; sections contain items by `parent`.
 */
import { newId } from './model';
import { rad, type Pt } from './geometry';

export const JAM_VERSION = 1;
export const JAM_LIMITS = { items: 20000, text: 20000, pts: 40000, imageBytes: 3_000_000, coord: 1e7, comments: 2000 };

export type ItemKind = 'sticky' | 'shape' | 'text' | 'connector' | 'stroke' | 'section' | 'emoji' | 'table' | 'code' | 'image' | 'link' | 'timer';
export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'diamond' | 'triangle' | 'triangleDown' | 'parallelogram' | 'trapezoid' | 'pentagon' | 'hexagon' | 'octagon' | 'star' | 'plus' | 'cylinder' | 'speech' | 'arrowRight' | 'arrowLeft';
export type Side = 'auto' | 't' | 'r' | 'b' | 'l';
export type Cap = 'none' | 'arrow' | 'triangle' | 'diamond' | 'circle' | 'bar';
export type Route = 'straight' | 'elbow' | 'curve';
export type Dash = 'solid' | 'dashed' | 'dotted';
export type PenKind = 'pen' | 'marker' | 'highlighter';
export interface End { id?: string; side?: Side; x?: number; y?: number }

export const ITEM_KINDS: ItemKind[] = ['sticky', 'shape', 'text', 'connector', 'stroke', 'section', 'emoji', 'table', 'code', 'image', 'link', 'timer'];
export const SHAPE_KINDS: ShapeKind[] = ['rect', 'round', 'ellipse', 'diamond', 'triangle', 'triangleDown', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'star', 'plus', 'cylinder', 'speech', 'arrowRight', 'arrowLeft'];
export const CAPS: Cap[] = ['none', 'arrow', 'triangle', 'diamond', 'circle', 'bar'];
export const STICKY_COLORS = ['#ffe066', '#ffb86b', '#ff8f8f', '#f4a6d7', '#c9a7ff', '#8fb8ff', '#7fe0e0', '#8fe39a', '#d9dde3', '#ffffff'];
export const SHAPE_COLORS = ['#ffffff', '#ffe066', '#ffb86b', '#ff8f8f', '#f4a6d7', '#c9a7ff', '#8fb8ff', '#7fe0e0', '#8fe39a', '#d9dde3', '#2b2b2b'];
export const INK_COLORS = ['#1e1e1e', '#e5484d', '#f76b15', '#f5c400', '#30a46c', '#0d99ff', '#7c5cff', '#d6409f'];

export interface JamItem {
  id: string; kind: ItemKind; x: number; y: number; w: number; h: number; rot: number;
  locked?: boolean; group?: string; parent?: string; fixedW?: boolean;
  text?: string; color?: string; stroke?: string; strokeW?: number; dash?: Dash;
  fontSize?: number; textColor?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; align?: 'left' | 'center' | 'right';
  shape?: ShapeKind;
  from?: End; to?: End; route?: Route; capStart?: Cap; capEnd?: Cap;
  pts?: number[]; pen?: PenKind;
  cells?: string[][]; colW?: number[]; rowH?: number[];
  lang?: string; src?: string; url?: string; emoji?: string;
  duration?: number; startedAt?: number | null; pausedLeft?: number | null;
  votes?: Record<string, number>; author?: string; createdAt?: number;
}
export interface JamComment { id: string; x: number; y: number; itemId?: string; author: string; text: string; at: number; resolved?: boolean; replies?: { author: string; text: string; at: number }[] }
export interface BoardData {
  kind: 'jam'; version: number;
  items: Record<string, JamItem>; order: string[];
  comments: JamComment[]; grid: 'dots' | 'lines' | 'none';
  voting?: { active: boolean; perUser: number; hidden: boolean };
}

export class BoardError extends Error {}

export function emptyBoard(): BoardData { return { kind: 'jam', version: JAM_VERSION, items: {}, order: [], comments: [], grid: 'dots' }; }
export function isBoard(d: unknown): d is BoardData { return !!d && typeof d === 'object' && (d as BoardData).kind === 'jam'; }

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const fail = (m: string): never => { throw new BoardError(m); };

export function validateBoard(b: unknown): asserts b is BoardData {
  if (!b || typeof b !== 'object') return fail('Board must be an object');
  const d = b as BoardData;
  if (d.kind !== 'jam') fail('Not a whiteboard document');
  if (d.version !== JAM_VERSION) fail(`Unsupported whiteboard version ${String(d.version)}`);
  if (!d.items || typeof d.items !== 'object' || Array.isArray(d.items)) fail('items must be an object');
  if (!Array.isArray(d.order)) fail('order must be an array');
  if (!['dots', 'lines', 'none'].includes(d.grid)) fail('Invalid grid');
  const ids = Object.keys(d.items);
  if (ids.length > JAM_LIMITS.items) fail('Too many items on one board');
  if (d.order.length !== ids.length || new Set(d.order).size !== d.order.length || d.order.some(i => !(i in d.items))) fail('order must list every item exactly once');
  for (const id of ids) {
    const it = d.items[id];
    if (!it || typeof it !== 'object' || it.id !== id) fail(`Item ${id} has a mismatched id`);
    if (!ITEM_KINDS.includes(it.kind)) fail(`Item ${id}: unknown kind`);
    for (const k of ['x', 'y', 'w', 'h', 'rot'] as const) if (!isNum(it[k]) || Math.abs(it[k]) > JAM_LIMITS.coord) fail(`Item ${id}: ${k} must be a finite number`);
    if (it.w < 0 || it.h < 0) fail(`Item ${id}: negative size`);
    for (const k of ['text', 'code', 'lang', 'emoji', 'color', 'stroke', 'textColor', 'author'] as const) { const v = (it as any)[k]; if (v !== undefined && (typeof v !== 'string' || v.length > JAM_LIMITS.text)) fail(`Item ${id}: ${k} must be a short string`); }
    if (it.shape !== undefined && !SHAPE_KINDS.includes(it.shape)) fail(`Item ${id}: unknown shape`);
    if (it.kind === 'shape' && !it.shape) fail(`Item ${id}: shape missing`);
    if (it.kind === 'connector') {
      for (const e of [it.from, it.to]) {
        if (!e || typeof e !== 'object') return fail(`Item ${id}: connector ends missing`);
        if (e.id !== undefined) { if (!(e.id in d.items) || d.items[e.id].kind === 'connector' || e.id === id) fail(`Item ${id}: connector points at a missing item`); }
        else if (!isNum(e.x) || !isNum(e.y)) fail(`Item ${id}: free connector end needs x and y`);
      }
      if (it.route && !['straight', 'elbow', 'curve'].includes(it.route)) fail(`Item ${id}: unknown route`);
      for (const c of [it.capStart, it.capEnd]) if (c !== undefined && !CAPS.includes(c)) fail(`Item ${id}: unknown cap`);
    }
    if (it.kind === 'stroke') {
      if (!Array.isArray(it.pts) || it.pts.length < 2 || it.pts.length % 2 || it.pts.length > JAM_LIMITS.pts || it.pts.some(n => !isNum(n))) fail(`Item ${id}: invalid stroke points`);
    }
    if (it.kind === 'table') {
      const c = it.cells;
      if (!Array.isArray(c) || !c.length || c.length > 60 || c.some(r => !Array.isArray(r) || r.length !== c[0].length || r.length < 1 || r.length > 40 || r.some(s => typeof s !== 'string' || s.length > 2000))) fail(`Item ${id}: invalid table`);
      if (!Array.isArray(it.colW) || it.colW.length !== c![0].length || it.colW.some(n => !isNum(n) || n <= 0)) fail(`Item ${id}: invalid column widths`);
      if (!Array.isArray(it.rowH) || it.rowH.length !== c!.length || it.rowH.some(n => !isNum(n) || n <= 0)) fail(`Item ${id}: invalid row heights`);
    }
    if (it.kind === 'image' && !(typeof it.src === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(it.src) && it.src.length <= JAM_LIMITS.imageBytes * 1.4)) fail(`Item ${id}: image must be an embedded png/jpeg/gif/webp`);
    if (it.kind === 'link' && !(typeof it.url === 'string' && /^https?:\/\//i.test(it.url) && it.url.length < 2048)) fail(`Item ${id}: link must be an http(s) URL`);
    if (it.parent !== undefined && (!(it.parent in d.items) || d.items[it.parent].kind !== 'section' || it.parent === id)) fail(`Item ${id}: parent must be a section`);
    if (it.kind === 'timer' && !(isNum(it.duration) && it.duration > 0 && it.duration <= 86_400_000)) fail(`Item ${id}: invalid timer`);
    if (it.votes) for (const [u, n] of Object.entries(it.votes)) if (!isNum(n) || n < 0 || n > 1000 || u.length > 200) fail(`Item ${id}: invalid votes`);
  }
  if (!Array.isArray(d.comments) || d.comments.length > JAM_LIMITS.comments) fail('Invalid comments');
  for (const c of d.comments) if (!c || typeof c.id !== 'string' || !isNum(c.x) || !isNum(c.y) || typeof c.text !== 'string' || c.text.length > 5000 || typeof c.author !== 'string') fail('Invalid comment');
}

// ---------- creation defaults ----------
export function makeItem(kind: ItemKind, x: number, y: number, extra: Partial<JamItem> = {}): JamItem {
  const base: JamItem = { id: newId('j'), kind, x, y, w: 0, h: 0, rot: 0 };
  switch (kind) {
    case 'sticky': Object.assign(base, { w: 168, h: 168, color: STICKY_COLORS[0], text: '', fontSize: 18 }); break;
    case 'shape': Object.assign(base, { w: 140, h: 100, shape: 'rect', color: '#ffffff', stroke: '#1e1e1e', strokeW: 2, text: '', fontSize: 16, align: 'center', dash: 'solid' }); break;
    case 'text': Object.assign(base, { w: 160, h: 28, text: '', fontSize: 20, textColor: '#1e1e1e', align: 'left' }); break;
    case 'connector': Object.assign(base, { route: 'elbow', capStart: 'none', capEnd: 'arrow', stroke: '#1e1e1e', strokeW: 2, dash: 'solid', from: { x, y }, to: { x: x + 120, y } }); break;
    case 'stroke': Object.assign(base, { pen: 'pen', stroke: '#1e1e1e', strokeW: 3, pts: [0, 0] }); break;
    case 'section': Object.assign(base, { w: 480, h: 320, text: 'Section', color: '#8fb8ff' }); break;
    case 'emoji': Object.assign(base, { w: 56, h: 56, emoji: '👍' }); break;
    case 'table': Object.assign(base, { cells: [['', '', ''], ['', '', ''], ['', '', '']], colW: [120, 120, 120], rowH: [40, 40, 40], w: 360, h: 120, color: '#ffffff', stroke: '#1e1e1e', fontSize: 14 }); break;
    case 'code': Object.assign(base, { w: 360, h: 180, text: '', lang: 'javascript', fontSize: 13 }); break;
    case 'image': Object.assign(base, { w: 240, h: 160 }); break;
    case 'link': Object.assign(base, { w: 280, h: 72, url: 'https://', text: '' }); break;
    case 'timer': Object.assign(base, { w: 220, h: 84, duration: 300_000, startedAt: null, pausedLeft: null }); break;
  }
  return Object.assign(base, extra);
}

export function tableSize(it: JamItem): { w: number; h: number } { return { w: (it.colW ?? []).reduce((a, b) => a + b, 0), h: (it.rowH ?? []).reduce((a, b) => a + b, 0) }; }

// ---------- geometry ----------
export function rotateAround(p: Pt, c: Pt, deg: number): Pt {
  if (!deg) return p;
  const r = rad(deg), cs = Math.cos(r), sn = Math.sin(r), dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}
export const centerOf = (it: JamItem): Pt => ({ x: it.x + it.w / 2, y: it.y + it.h / 2 });
export function toLocal(it: JamItem, p: Pt): Pt { return rotateAround(p, centerOf(it), -it.rot); }
export function cornersOf(it: JamItem): Pt[] {
  const c = centerOf(it);
  return [{ x: it.x, y: it.y }, { x: it.x + it.w, y: it.y }, { x: it.x + it.w, y: it.y + it.h }, { x: it.x, y: it.y + it.h }].map(p => rotateAround(p, c, it.rot));
}
export interface Box { x: number; y: number; w: number; h: number }
export function boxOfPoints(ps: Pt[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return ps.length ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}
export const unionBox = (a: Box | null, b: Box): Box => { if (!a) return b; const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y); return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 }; };

export function strokePoints(it: JamItem): Pt[] { const p = it.pts ?? []; const out: Pt[] = []; for (let i = 0; i < p.length; i += 2) out.push({ x: it.x + p[i], y: it.y + p[i + 1] }); return out; }
/** Recompute x/y/w/h of a stroke from its points (points stay relative to x,y). */
export function fitStroke(it: JamItem): JamItem {
  const ps = strokePoints(it); const b = boxOfPoints(ps);
  const pts: number[] = []; for (const p of ps) pts.push(p.x - b.x, p.y - b.y);
  return { ...it, x: b.x, y: b.y, w: b.w, h: b.h, pts };
}

const SIDE_VEC: Record<Exclude<Side, 'auto'>, Pt> = { t: { x: 0, y: -1 }, r: { x: 1, y: 0 }, b: { x: 0, y: 1 }, l: { x: -1, y: 0 } };
export function sidePoint(it: JamItem, side: Exclude<Side, 'auto'>): Pt {
  const p = side === 't' ? { x: it.x + it.w / 2, y: it.y } : side === 'b' ? { x: it.x + it.w / 2, y: it.y + it.h } : side === 'l' ? { x: it.x, y: it.y + it.h / 2 } : { x: it.x + it.w, y: it.y + it.h / 2 };
  return rotateAround(p, centerOf(it), it.rot);
}
export function sideNormal(it: JamItem, side: Exclude<Side, 'auto'>): Pt { const v = SIDE_VEC[side]; return rotateAround(v, { x: 0, y: 0 }, it.rot); }
function nearestSide(it: JamItem, toward: Pt): Exclude<Side, 'auto'> {
  let best: Exclude<Side, 'auto'> = 'r', bd = Infinity;
  for (const s of ['t', 'r', 'b', 'l'] as const) { const p = sidePoint(it, s); const d = (p.x - toward.x) ** 2 + (p.y - toward.y) ** 2; if (d < bd) { bd = d; best = s; } }
  return best;
}
export interface Anchor { p: Pt; n: Pt; side?: Exclude<Side, 'auto'> }
export function resolveEnd(board: BoardData, e: End, other: Pt): Anchor {
  const it = e.id ? board.items[e.id] : undefined;
  if (!it) return { p: { x: e.x ?? 0, y: e.y ?? 0 }, n: { x: 0, y: 0 } };
  const side = e.side && e.side !== 'auto' ? e.side : nearestSide(it, other);
  return { p: sidePoint(it, side), n: sideNormal(it, side), side };
}
function otherPoint(board: BoardData, e: End): Pt { const it = e.id ? board.items[e.id] : undefined; return it ? centerOf(it) : { x: e.x ?? 0, y: e.y ?? 0 }; }

export interface Route2 { pts: Pt[]; curve: boolean }
const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
function simplify(ps: Pt[]): Pt[] {
  const o: Pt[] = [];
  for (const p of ps) { if (o.length && same(o[o.length - 1], p)) continue; o.push(p); }
  for (let i = 1; i < o.length - 1;) {
    const a = o[i - 1], b = o[i], c = o[i + 1];
    if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01)) o.splice(i, 1); else i++;
  }
  return o;
}
export function routeConnector(board: BoardData, c: JamItem): Route2 {
  const from = c.from!, to = c.to!;
  const a = resolveEnd(board, from, otherPoint(board, to)), b = resolveEnd(board, to, otherPoint(board, from));
  const route = c.route ?? 'straight';
  if (route === 'straight') return { pts: [a.p, b.p], curve: false };
  if (route === 'curve') {
    const d = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y), k = Math.max(30, d / 2.5);
    const dirA = a.n.x || a.n.y ? a.n : norm({ x: b.p.x - a.p.x, y: b.p.y - a.p.y }), dirB = b.n.x || b.n.y ? b.n : norm({ x: a.p.x - b.p.x, y: a.p.y - b.p.y });
    return { pts: [a.p, { x: a.p.x + dirA.x * k, y: a.p.y + dirA.y * k }, { x: b.p.x + dirB.x * k, y: b.p.y + dirB.y * k }, b.p], curve: true };
  }
  // orthogonal: leave and enter along the side normals, snapped to the dominant axis
  const axis = (n: Pt, fallback: Pt): Pt => (n.x || n.y ? (Math.abs(n.x) >= Math.abs(n.y) ? { x: Math.sign(n.x), y: 0 } : { x: 0, y: Math.sign(n.y) }) : fallback);
  const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y;
  const da = axis(a.n, Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 });
  const db = axis(b.n, Math.abs(dx) >= Math.abs(dy) ? { x: -(Math.sign(dx) || 1), y: 0 } : { x: 0, y: -(Math.sign(dy) || 1) });
  const off = 24;
  const a1 = { x: a.p.x + da.x * off, y: a.p.y + da.y * off }, b1 = { x: b.p.x + db.x * off, y: b.p.y + db.y * off };
  const mid: Pt[] = [];
  if (da.x && db.x) { const mx = (a1.x + b1.x) / 2; mid.push({ x: mx, y: a1.y }, { x: mx, y: b1.y }); }
  else if (da.y && db.y) { const my = (a1.y + b1.y) / 2; mid.push({ x: a1.x, y: my }, { x: b1.x, y: my }); }
  else if (da.x) mid.push({ x: b1.x, y: a1.y });
  else mid.push({ x: a1.x, y: b1.y });
  return { pts: simplify([a.p, a1, ...mid, b1, b.p]), curve: false };
}
export function cubicAt(p: Pt[], t: number): Pt {
  const u = 1 - t; const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: p[0].x * w[0] + p[1].x * w[1] + p[2].x * w[2] + p[3].x * w[3], y: p[0].y * w[0] + p[1].y * w[1] + p[2].y * w[2] + p[3].y * w[3] };
}
export function flattenRoute(r: Route2, steps = 24): Pt[] { if (!r.curve) return r.pts; const o: Pt[] = []; for (let i = 0; i <= steps; i++) o.push(cubicAt(r.pts, i / steps)); return o; }
function norm(v: Pt): Pt { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; }
export function polyMid(ps: Pt[]): Pt {
  let total = 0; for (let i = 1; i < ps.length; i++) total += Math.hypot(ps[i].x - ps[i - 1].x, ps[i].y - ps[i - 1].y);
  let at = total / 2;
  for (let i = 1; i < ps.length; i++) { const l = Math.hypot(ps[i].x - ps[i - 1].x, ps[i].y - ps[i - 1].y); if (at <= l && l > 0) { const t = at / l; return { x: ps[i - 1].x + (ps[i].x - ps[i - 1].x) * t, y: ps[i - 1].y + (ps[i].y - ps[i - 1].y) * t }; } at -= l; }
  return ps[0] ?? { x: 0, y: 0 };
}

/** Normalised (0..1) outlines for polygonal shapes. */
export const SHAPE_POLY: Partial<Record<ShapeKind, number[][]>> = {
  rect: [[0, 0], [1, 0], [1, 1], [0, 1]],
  diamond: [[.5, 0], [1, .5], [.5, 1], [0, .5]],
  triangle: [[.5, 0], [1, 1], [0, 1]],
  triangleDown: [[0, 0], [1, 0], [.5, 1]],
  parallelogram: [[.2, 0], [1, 0], [.8, 1], [0, 1]],
  trapezoid: [[.2, 0], [.8, 0], [1, 1], [0, 1]],
  pentagon: [[.5, 0], [1, .38], [.81, 1], [.19, 1], [0, .38]],
  hexagon: [[.25, 0], [.75, 0], [1, .5], [.75, 1], [.25, 1], [0, .5]],
  octagon: [[.3, 0], [.7, 0], [1, .3], [1, .7], [.7, 1], [.3, 1], [0, .7], [0, .3]],
  star: (() => { const o: number[][] = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? .21 : .5, a = -Math.PI / 2 + (i * Math.PI) / 5; o.push([.5 + r * Math.cos(a) / .5 * .5, .5 + r * Math.sin(a) / .5 * .5]); } return o; })(),
  plus: [[.35, 0], [.65, 0], [.65, .35], [1, .35], [1, .65], [.65, .65], [.65, 1], [.35, 1], [.35, .65], [0, .65], [0, .35], [.35, .35]],
  arrowRight: [[0, .25], [.6, .25], [.6, 0], [1, .5], [.6, 1], [.6, .75], [0, .75]],
  arrowLeft: [[1, .25], [.4, .25], [.4, 0], [0, .5], [.4, 1], [.4, .75], [1, .75]],
};

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
export function distToPoly(p: Pt, ps: Pt[]): number { let d = Infinity; for (let i = 1; i < ps.length; i++) d = Math.min(d, distToSeg(p, ps[i - 1], ps[i])); return ps.length === 1 ? Math.hypot(p.x - ps[0].x, p.y - ps[0].y) : d; }

export const SECTION_TITLE_H = 30;
/** Does world point p hit the item? tol is in world units (callers divide by zoom). */
export function hitItem(board: BoardData, it: JamItem, p: Pt, tol = 4): boolean {
  if (it.kind === 'connector') return distToPoly(p, flattenRoute(routeConnector(board, it))) <= Math.max(tol, (it.strokeW ?? 2) / 2 + tol);
  if (it.kind === 'stroke') return distToPoly(p, strokePoints(it)) <= (it.strokeW ?? 3) / 2 + tol + (it.pen === 'highlighter' ? 6 : 0);
  const q = toLocal(it, p);
  const inBox = q.x >= it.x - tol && q.x <= it.x + it.w + tol && q.y >= it.y - tol && q.y <= it.y + it.h + tol;
  if (it.kind === 'section') { // only the title tab and the border are grabbable; the inside belongs to what is on it
    const onTitle = q.x >= it.x && q.x <= it.x + Math.min(it.w, 260) && q.y >= it.y - SECTION_TITLE_H && q.y <= it.y;
    const inner = q.x > it.x + tol + 2 && q.x < it.x + it.w - tol - 2 && q.y > it.y + tol + 2 && q.y < it.y + it.h - tol - 2;
    return onTitle || (inBox && !inner);
  }
  if (!inBox) return false;
  if (it.kind === 'shape') {
    const nx = (q.x - it.x) / (it.w || 1), ny = (q.y - it.y) / (it.h || 1);
    if (it.shape === 'ellipse') return ((nx - .5) ** 2 + (ny - .5) ** 2) <= .25 + tol / Math.max(1, Math.min(it.w, it.h));
    const poly = it.shape ? SHAPE_POLY[it.shape] : undefined;
    if (poly && it.shape !== 'rect') return pointInPoly({ x: nx, y: ny }, poly.map(([a, b]) => ({ x: a, y: b })));
  }
  return true;
}

export function itemBox(board: BoardData, it: JamItem): Box {
  if (it.kind === 'connector') return boxOfPoints(flattenRoute(routeConnector(board, it)));
  if (it.kind === 'section') return boxOfPoints([...cornersOf(it), { x: it.x, y: it.y - SECTION_TITLE_H }]);
  return boxOfPoints(cornersOf(it));
}
export const boxesOverlap = (a: Box, b: Box) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
export const boxContains = (a: Box, b: Box) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
export function selectionBox(board: BoardData, ids: string[]): Box | null { let b: Box | null = null; for (const id of ids) { const it = board.items[id]; if (it) b = unionBox(b, itemBox(board, it)); } return b; }

/** Items fully inside a marquee, top-most last. */
export function itemsInRect(board: BoardData, r: Box): string[] {
  return board.order.filter(id => { const it = board.items[id]; return it && !it.locked && boxesOverlap(itemBox(board, it), r) && (it.kind === 'connector' || it.kind === 'section' ? boxContains(r, itemBox(board, it)) : true); });
}
/** Top-most item under p (sections only by title/border). */
export function pick(board: BoardData, p: Pt, tol = 4, skip?: Set<string>): string | null {
  for (let i = board.order.length - 1; i >= 0; i--) { const it = board.items[board.order[i]]; if (it && !skip?.has(it.id) && hitItem(board, it, p, tol)) return it.id; }
  return null;
}
/** Smallest section whose body contains the point (used to drop items into sections). */
export function sectionAt(board: BoardData, p: Pt, skip?: Set<string>): string | null {
  let best: JamItem | null = null;
  for (const id of board.order) { const s = board.items[id]; if (s.kind !== 'section' || skip?.has(id)) continue; if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h && (!best || s.w * s.h < best.w * best.h)) best = s; }
  return best?.id ?? null;
}
export function groupMembers(board: BoardData, id: string): string[] {
  const g = board.items[id]?.group; if (!g) return [id];
  return board.order.filter(i => board.items[i].group === g);
}

// ---------- arrange / align ----------
export type AlignHow = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export function alignPatches(board: BoardData, ids: string[], how: AlignHow): Record<string, Partial<JamItem>> {
  const its = ids.map(i => board.items[i]).filter(i => i && i.kind !== 'connector' && !i.locked);
  const out: Record<string, Partial<JamItem>> = {}; if (its.length < 2) return out;
  const boxes = its.map(i => itemBox(board, i)); const u = boxes.reduce<Box | null>((a, b) => unionBox(a, b), null)!;
  its.forEach((it, k) => {
    const b = boxes[k]; let dx = 0, dy = 0;
    if (how === 'left') dx = u.x - b.x; else if (how === 'right') dx = u.x + u.w - (b.x + b.w); else if (how === 'hcenter') dx = u.x + u.w / 2 - (b.x + b.w / 2);
    else if (how === 'top') dy = u.y - b.y; else if (how === 'bottom') dy = u.y + u.h - (b.y + b.h); else dy = u.y + u.h / 2 - (b.y + b.h / 2);
    if (dx || dy) out[it.id] = { x: it.x + dx, y: it.y + dy };
  });
  return out;
}
export function distributePatches(board: BoardData, ids: string[], axis: 'h' | 'v'): Record<string, Partial<JamItem>> {
  const its = ids.map(i => board.items[i]).filter(i => i && i.kind !== 'connector' && !i.locked);
  const out: Record<string, Partial<JamItem>> = {}; if (its.length < 3) return out;
  const rows = its.map(i => ({ it: i, b: itemBox(board, i) })).sort((p, q) => (axis === 'h' ? p.b.x - q.b.x : p.b.y - q.b.y));
  const first = rows[0].b, last = rows[rows.length - 1].b;
  const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const used = rows.reduce((s, r) => s + (axis === 'h' ? r.b.w : r.b.h), 0);
  const gap = (span - used) / (rows.length - 1); let at = axis === 'h' ? first.x : first.y;
  for (const r of rows) { const d = at - (axis === 'h' ? r.b.x : r.b.y); if (Math.abs(d) > 0.01) out[r.it.id] = axis === 'h' ? { x: r.it.x + d } : { y: r.it.y + d }; at += (axis === 'h' ? r.b.w : r.b.h) + gap; }
  return out;
}
/** Lay the items out in a tidy grid starting at the top-left of their bounding box. */
export function gridPatches(board: BoardData, ids: string[], columns?: number, gap = 24): Record<string, Partial<JamItem>> {
  const its = ids.map(i => board.items[i]).filter(i => i && i.kind !== 'connector' && i.kind !== 'stroke' && !i.locked);
  const out: Record<string, Partial<JamItem>> = {}; if (its.length < 2) return out;
  const u = its.map(i => itemBox(board, i)).reduce<Box | null>((a, b) => unionBox(a, b), null)!;
  const cols = columns ?? Math.max(1, Math.round(Math.sqrt(its.length)));
  const sorted = [...its].sort((a, b) => a.y - b.y || a.x - b.x);
  const cw = Math.max(...sorted.map(i => i.w)), chh = Math.max(...sorted.map(i => i.h));
  sorted.forEach((it, k) => { out[it.id] = { x: u.x + (k % cols) * (cw + gap), y: u.y + Math.floor(k / cols) * (chh + gap) }; });
  return out;
}

// ---------- voting ----------
export function votesUsed(board: BoardData, userId: string): number { let n = 0; for (const it of Object.values(board.items)) n += it.votes?.[userId] ?? 0; return n; }
export function voteTotal(it: JamItem): number { return Object.values(it.votes ?? {}).reduce((a, b) => a + b, 0); }

/** Timer helper: remaining ms at `now`. */
export function timerLeft(it: JamItem, now: number): number {
  if (it.startedAt) return Math.max(0, (it.pausedLeft ?? it.duration ?? 0) - (now - it.startedAt));
  return it.pausedLeft ?? it.duration ?? 0;
}
