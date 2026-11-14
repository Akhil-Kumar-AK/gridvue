import type { DocumentData, SceneNode } from './model';
import { flatten, distToSegment, pointInPolygon } from './path';

/** Affine matrix [a b c d e f] mapping (x,y) -> (a x + c y + e, b x + d y + f). */
export type Mat = readonly [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export const rad = (deg: number) => (deg * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return IDENTITY;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
export const apply = (m: Mat, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const rotate = (degrees: number): Mat => { const r = rad(degrees), c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
export const scaleM = (sx: number, sy = sx): Mat => [sx, 0, 0, sy, 0, 0];

export function localMatrix(n: Pick<SceneNode, 'x' | 'y' | 'rotation'>): Mat {
  return mul(translate(n.x, n.y), rotate(n.rotation));
}

/** Matrix mapping node-local coords to page (world) coords. Pages/document contribute identity. */
export function worldMatrix(doc: DocumentData, id: string): Mat {
  const chain: SceneNode[] = [];
  for (let cur: SceneNode | undefined = doc.nodes[id]; cur; cur = cur.parent ? doc.nodes[cur.parent] : undefined) {
    if (cur.type === 'PAGE' || cur.type === 'DOCUMENT') break;
    chain.push(cur);
  }
  let m: Mat = IDENTITY;
  for (let i = chain.length - 1; i >= 0; i--) m = mul(m, localMatrix(chain[i]));
  return m;
}

export function worldCorners(doc: DocumentData, id: string): [Pt, Pt, Pt, Pt] {
  const n = doc.nodes[id], m = worldMatrix(doc, id);
  return [apply(m, { x: 0, y: 0 }), apply(m, { x: n.width, y: 0 }), apply(m, { x: n.width, y: n.height }), apply(m, { x: 0, y: n.height })];
}

export function boundsOfPoints(pts: Pt[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** Axis-aligned world bounds (ignores stroke/effects). */
export function worldBounds(doc: DocumentData, id: string): Rect { return boundsOfPoints(worldCorners(doc, id)); }
export function unionRects(rs: Rect[]): Rect {
  if (!rs.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...rs.map(r => r.x)), y0 = Math.min(...rs.map(r => r.y));
  const x1 = Math.max(...rs.map(r => r.x + r.w)), y1 = Math.max(...rs.map(r => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const rectsIntersect = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
export const rectContains = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Decompose a rotation+translation matrix into x,y,rotation(deg). Assumes no scale/skew. */
export function decompose(m: Mat): { x: number; y: number; rotation: number } {
  return { x: m[4], y: m[5], rotation: deg(Math.atan2(m[1], m[0])) };
}

/** Camera: screen = (world - pan) * zoom. */
export interface Camera { x: number; y: number; zoom: number }
export const worldToScreen = (c: Camera, p: Pt): Pt => ({ x: (p.x - c.x) * c.zoom, y: (p.y - c.y) * c.zoom });
export const screenToWorld = (c: Camera, p: Pt): Pt => ({ x: p.x / c.zoom + c.x, y: p.y / c.zoom + c.y });
export function zoomAt(c: Camera, screen: Pt, nextZoom: number): Camera {
  const z = Math.min(256, Math.max(0.02, nextZoom));
  const w = screenToWorld(c, screen);
  return { zoom: z, x: w.x - screen.x / z, y: w.y - screen.y / z };
}
export function fitCamera(r: Rect, viewW: number, viewH: number, padding = 64, maxZoom = 8): Camera {
  if (r.w <= 0 && r.h <= 0) return { x: -viewW / 2, y: -viewH / 2, zoom: 1 };
  const z = Math.min(maxZoom, Math.max(0.02, Math.min((viewW - padding * 2) / Math.max(r.w, 1), (viewH - padding * 2) / Math.max(r.h, 1))));
  return { zoom: z, x: r.x + r.w / 2 - viewW / 2 / z, y: r.y + r.h / 2 - viewH / 2 / z };
}

/** Point (world) inside node's shape? Tolerance in world units used for lines. */
export function hitNode(doc: DocumentData, id: string, world: Pt, tolerance = 4): boolean {
  const n = doc.nodes[id];
  const p = apply(invert(worldMatrix(doc, id)), world);
  if (n.type === 'LINE') {
    const t = Math.max(0, Math.min(1, p.x / Math.max(n.width, 1e-6)));
    return Math.hypot(p.x - t * n.width, p.y) <= Math.max(tolerance, n.strokeWeight / 2);
  }
  if (n.type === 'VECTOR' && n.path) {
    const poly = flatten(n.path, 16);
    const tol = Math.max(tolerance, n.strokeWeight / 2);
    for (let i = 1; i < poly.length; i++) if (distToSegment(p, poly[i - 1], poly[i]).d <= tol) return true;
    if (n.path.closed && n.path.points.length > 1) { if (distToSegment(p, poly[poly.length - 1], poly[0]).d <= tol) return true; if (n.fills.some(f => f.visible)) return pointInPolygon(p, poly); }
    return false;
  }
  if (n.type === 'ELLIPSE') {
    const rx = n.width / 2, ry = n.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (p.x - rx) / rx, dy = (p.y - ry) / ry;
    return dx * dx + dy * dy <= 1;
  }
  return p.x >= 0 && p.y >= 0 && p.x <= n.width && p.y <= n.height;
}

/** Chain of hits from page child down to deepest leaf at `world`, topmost first at each level. */
export function hitChain(doc: DocumentData, pageId: string, world: Pt, tolerance = 4): string[] {
  let level = doc.nodes[pageId].children;
  const chain: string[] = [];
  while (true) {
    let found: string | null = null;
    for (let i = level.length - 1; i >= 0; i--) {
      const n = doc.nodes[level[i]];
      if (!n.visible || n.locked) continue;
      if (hitNode(doc, n.id, world, tolerance)) { found = n.id; break; }
      // children of non-clipping frames/groups may lie outside the parent's box
      if ((n.type === 'GROUP' || n.type === 'INSTANCE' || ((n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && !n.clipsContent)) && n.children.length) {
        const sub = hitChain(doc, n.id, world, tolerance);
        if (sub.length) return [...chain, n.id, ...sub];
      }
    }
    if (!found) return chain;
    chain.push(found);
    level = doc.nodes[found].children;
    if (!level.length) return chain;
  }
}
