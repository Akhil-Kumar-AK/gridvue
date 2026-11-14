import {
  apply, align as alignNodes, boundsOfPoints, decompose, defaultNode, duplicate, fitCamera, hitChain, invert, mul, normAngle, rad, reparent, resizeNode,
  screenToWorld, setProps, topLevelOnly, translate, translateWorld, rectContains, rectsIntersect, rotate, unionRects, worldBounds, worldCorners, worldMatrix,
  worldToScreen, zoomAt, addNode, connectTo, topFrameOf, type ProtoAction, refitAncestors, corner, createVector, deletePoints, fitVector, insertPoint, isSmooth, nearestOnPath, pathToParentSpace, setSmooth, setVectorPath,
  simplify, smoothPolyline, solid, pointInPolygon, cutPath, convertToVector, type PathPoint, type VectorPath, type Camera, type Mat, type Pt, type Rect, type SceneNode,
} from '@layr/core';
import { drawChildren } from '../engine/render';
import { autoTextSize } from '../engine/text';
import { useEditor, type Guide, type Tool } from './state';
import type { EditorSession } from './session';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cam: Camera }
  | { kind: 'move'; start: Pt; ids: string[]; origin: Map<string, { x: number; y: number }>; bounds: Rect; moved: boolean; altDup: boolean; axisLock: boolean; parent: string }
  | { kind: 'resize'; handle: [number, number]; ids: string[]; start: Pt; box: Rect; single: boolean; W0?: Mat; node0?: SceneNode; parentInv?: Mat; origin: Map<string, Rect> }
  | { kind: 'rotate'; ids: string[]; center: Pt; startAngle: number; W0: Map<string, Mat>; parentInv: Map<string, Mat> }
  | { kind: 'marquee'; start: Pt; additive: boolean; base: string[] }
  | { kind: 'draw'; tool: Tool; start: Pt; id: string; parent: string; moved: boolean }
  | { kind: 'connect'; node: string }
  | { kind: 'radius'; id: string; corner: 0 | 1 | 2 | 3; W0: Mat }
  | { kind: 'penDrag' }
  | { kind: 'pencil' }
  | { kind: 'lasso' }
  | { kind: 'bend'; id: string; seg: number; start: Pt; path0: VectorPath }
  | { kind: 'vec'; part: 'anchor' | 'in' | 'out'; index: number; start: Pt; id: string; anchors: Map<number, Pt>; tip0?: Pt; W0: Mat; path0: VectorPath };

const HANDLES: [number, number][] = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
const HANDLE_CURSORS = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];

export const DEFAULT_CANVAS_DARK = '#141414', DEFAULT_CANVAS_LIGHT = '#e5e5e5';

/** Closed corner-point path for the star / polygon tools, fitted to a `w`×`h` box. */
function shapePath(tool: 'star' | 'polygon', w: number, h: number): VectorPath {
  const raw: Pt[] = [];
  if (tool === 'polygon') for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3; raw.push({ x: Math.cos(a), y: Math.sin(a) }); }
  else for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.382 : 1; raw.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); }
  const minX = Math.min(...raw.map(p => p.x)), maxX = Math.max(...raw.map(p => p.x)), minY = Math.min(...raw.map(p => p.y)), maxY = Math.max(...raw.map(p => p.y));
  const points: PathPoint[] = raw.map(p => { const x = ((p.x - minX) / (maxX - minX)) * w, y = ((p.y - minY) / (maxY - minY)) * h; return { x, y, ix: 0, iy: 0, ox: 0, oy: 0 }; });
  return { points, closed: true };
}

/** Components, component sets and instances are drawn in purple everywhere on the canvas. */
const COMP = '#9747ff';
const isComp = (n: SceneNode | undefined) => !!n && (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' || n.type === 'INSTANCE');

/** Lines and arrows are selected by their ends, without a frame box around them. */
const isLineLike = (n: SceneNode | undefined) => !!n && (n.type === 'LINE' || (n.type === 'VECTOR' && n.name === 'Arrow' && !!n.path && !n.path.closed && n.path.points.length === 5));

/** Arrow as a single open path: tail → tip, then the two wings (retraced through the tip). */
function arrowPath(a: Pt, b: Pt, weight = 2): VectorPath {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const h = Math.min(Math.max(10, weight * 5), len * 0.45), ang = Math.PI / 6;
  const wing = (s: number): Pt => ({ x: b.x - h * (ux * Math.cos(ang) - s * uy * Math.sin(ang)), y: b.y - h * (uy * Math.cos(ang) + s * ux * Math.sin(ang)) });
  const mk = (p: Pt): PathPoint => ({ x: p.x, y: p.y, ix: 0, iy: 0, ox: 0, oy: 0 });
  return { points: [mk(a), mk(b), mk(wing(1)), mk(b), mk(wing(-1))], closed: false };
}
/** Shift the path so its bounds start at the origin and return the box it occupies. */
function arrowBox(a: Pt, b: Pt, weight: number) {
  const path = arrowPath(a, b, weight);
  const xs = path.points.map(p => p.x), ys = path.points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y), path: { ...path, points: path.points.map(p => ({ ...p, x: p.x - x, y: p.y - y })) } };
}

export class CanvasController {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 0; h = 0; dpr = 1;
  private drag: Drag | null = null;
  private raf = 0;
  private spaceDown = false;
  private titleRects: { id: string; r: Rect }[] = [];
  private devRects: { id: string; r: Rect }[] = [];
  /** Screen rectangle of a frame's title label (for inline rename). */
  titleRect(id: string): Rect | null { return this.titleRects.find(t => t.id === id)?.r ?? null; }
  private lastPointer: Pt = { x: 0, y: 0 };
  /** pen tool: path being drawn, anchors in world space */
  private pen: { pts: PathPoint[]; cursor: Pt } | null = null;
  private pencil: Pt[] | null = null;
  private brush = false;
  private lasso: Pt[] | null = null;
  private connectPt: Pt | null = null;
  readonly accent = '#4f46e5';

  constructor(canvas: HTMLCanvasElement, public session: EditorSession) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    session.requestRender = () => this.requestRender();
  }

  get store() { return this.session.store; }
  get ui() { return useEditor.getState(); }
  get doc() { return this.store.doc; }

  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.requestRender();
  }

  requestRender() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); }); }

  // ---------- coordinates ----------
  private screenPt(e: { clientX: number; clientY: number }): Pt { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  toWorld(s: Pt) { return screenToWorld(this.ui.camera, s); }
  toScreen(p: Pt) { return worldToScreen(this.ui.camera, p); }

  // ---------- camera ----------
  setCamera(c: Camera) { this.ui.set({ camera: c }); this.requestRender(); }
  zoomBy(factor: number, at?: Pt) { const a = at ?? { x: this.w / 2, y: this.h / 2 }; this.setCamera(zoomAt(this.ui.camera, a, this.ui.camera.zoom * factor)); }
  zoomTo(z: number) { this.setCamera(zoomAt(this.ui.camera, { x: this.w / 2, y: this.h / 2 }, z)); }
  zoomToFit() {
    const kids = this.doc.nodes[this.ui.pageId].children.filter(id => this.doc.nodes[id].visible);
    this.setCamera(fitCamera(kids.length ? unionRects(kids.map(k => worldBounds(this.doc, k))) : { x: 0, y: 0, w: 0, h: 0 }, this.w, this.h));
  }
  zoomToSelection() {
    const ids = this.ui.selection;
    if (!ids.length) return this.zoomToFit();
    this.setCamera(fitCamera(unionRects(ids.map(k => worldBounds(this.doc, k))), this.w, this.h));
  }

  // ---------- selection helpers ----------
  private isTopLevel(id: string) { return this.doc.nodes[this.doc.nodes[id].parent!]?.type === 'PAGE'; }
  private select(ids: string[]) { this.ui.set({ selection: ids }); }
  private strictSelectedAncestors(): Set<string> {
    const s = new Set<string>();
    for (const id of this.ui.selection) for (let c = this.doc.nodes[id]?.parent; c; c = this.doc.nodes[c]?.parent) s.add(c);
    return s;
  }
  pickTarget(chain: string[], deep: boolean): string | null {
    if (!chain.length) return null;
    if (deep) return chain[chain.length - 1];
    const anc = this.strictSelectedAncestors();
    for (let i = 0; i < chain.length; i++) {
      const n = this.doc.nodes[chain[i]];
      if ((n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && this.isTopLevel(n.id)) { if (i === chain.length - 1) return null; continue; }
      if (anc.has(n.id) && i < chain.length - 1) continue;
      return n.id;
    }
    return null;
  }
  private titleAt(p: Pt): string | null {
    for (const t of this.titleRects) if (p.x >= t.r.x && p.x <= t.r.x + t.r.w && p.y >= t.r.y && p.y <= t.r.y + t.r.h) return t.id;
    return null;
  }
  private frameAt(world: Pt, exclude: Set<string>): string {
    const chain = hitChain(this.doc, this.ui.pageId, world, 0).filter(id => !exclude.has(id));
    for (let i = chain.length - 1; i >= 0; i--) if (['FRAME', 'COMPONENT', 'COMPONENT_SET'].includes(this.doc.nodes[chain[i]].type)) return chain[i];
    return this.ui.pageId;
  }

  /** Frame (or the page) a dragged-in design-system component should land in at `world`; never inside a component or instance. */
  dropParentAt(world: Pt): string {
    const id = this.frameAt(world, new Set());
    for (let c: SceneNode | undefined = this.doc.nodes[id]; c; c = c.parent ? this.doc.nodes[c.parent] : undefined) if (c.type === 'COMPONENT' || c.type === 'COMPONENT_SET' || c.type === 'INSTANCE') return this.ui.pageId;
    return id;
  }

  // ---------- selection box / handles ----------
  private selectionBox(): { corners: Pt[]; rect: Rect; single: boolean; rotation: number } | null {
    const ids = topLevelOnly(this.store, this.ui.selection);
    if (!ids.length) return null;
    if (ids.length === 1) {
      const n = this.doc.nodes[ids[0]];
      const c = worldCorners(this.doc, ids[0]);
      return { corners: c, rect: boundsOfPoints(c), single: true, rotation: decompose(worldMatrix(this.doc, n.id)).rotation };
    }
    const r = unionRects(ids.map(i => worldBounds(this.doc, i)));
    return { corners: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }], rect: r, single: false, rotation: 0 };
  }
  private handlePoints(box: NonNullable<ReturnType<CanvasController['selectionBox']>>): Pt[] {
    const [a, b, , d] = box.corners; // TL, TR, BR, BL
    const ex = { x: b.x - a.x, y: b.y - a.y }, ey = { x: d.x - a.x, y: d.y - a.y };
    return HANDLES.map(([hx, hy]) => ({ x: a.x + ex.x * hx + ey.x * hy, y: a.y + ex.y * hx + ey.y * hy }));
  }
  private canResizeMulti(ids: string[]) { return ids.every(i => Math.abs(normAngle(decompose(worldMatrix(this.doc, i)).rotation)) < 1e-6); }

  /** Corner-radius handles (inset from each corner) for a single rectangle; frames and sections set radius in the properties panel. */
  private radiusHandles(): { corner: 0 | 1 | 2 | 3; local: Pt; world: Pt }[] | null {
    const ids = topLevelOnly(this.store, this.ui.selection);
    if (ids.length !== 1 || this.ui.mode === 'prototype' || this.ui.vectorEdit) return null;
    const n = this.doc.nodes[ids[0]];
    if (!n || n.type !== 'RECT' || n.locked) return null;
    const z = this.ui.camera.zoom;
    if (n.width * z < 56 || n.height * z < 56) return null;
    const r = (i: number) => Math.min(n.cornerRadii?.[i] ?? n.cornerRadius, Math.min(n.width, n.height) / 2);
    const off = 14 / z, W = worldMatrix(this.doc, n.id);
    const L: Pt[] = [{ x: r(0) + off, y: r(0) + off }, { x: n.width - r(1) - off, y: r(1) + off }, { x: n.width - r(2) - off, y: n.height - r(2) - off }, { x: r(3) + off, y: n.height - r(3) - off }];
    return L.map((local, i) => ({ corner: i as 0 | 1 | 2 | 3, local, world: apply(W, local) }));
  }
  private handleHit(p: Pt): { kind: 'resize'; index: number } | { kind: 'rotate' } | { kind: 'radius'; corner: 0 | 1 | 2 | 3 } | null {
    if (!this.session.canEdit) return null;
    for (const h of this.radiusHandles() ?? []) { const s = this.toScreen(h.world); if (Math.hypot(s.x - p.x, s.y - p.y) <= 7) return { kind: 'radius', corner: h.corner }; }
    const box = this.selectionBox(); if (!box) return null;
    const ids = topLevelOnly(this.store, this.ui.selection);
    const okResize = box.single || this.canResizeMulti(ids);
    const pts = this.handlePoints(box).map(q => this.toScreen(q));
    if (okResize) for (let i = 0; i < pts.length; i++) if (Math.hypot(p.x - pts[i].x, p.y - pts[i].y) <= 7) return { kind: 'resize', index: i };
    // rotate zone: just outside the four corners
    for (const i of [0, 2, 4, 6]) {
      const d = Math.hypot(p.x - pts[i].x, p.y - pts[i].y);
      if (d > 7 && d <= 22 && !this.pointInSelection(p, pts)) return { kind: 'rotate' };
    }
    return null;
  }
  private pointInSelection(p: Pt, pts: Pt[]) {
    const [a, , c] = [pts[0], pts[2], pts[4]];
    void a; void c;
    const poly = [pts[0], pts[2], pts[4], pts[6]];
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) inside = !inside;
    return inside;
  }

  // ---------- pointer events ----------
  onPointerDown(e: PointerEvent) {
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    const p = this.screenPt(e); this.lastPointer = p;
    const world = this.toWorld(p);
    const ui = this.ui;
    if (ui.editingTextId) return; // textarea blur handles commit
    if (ui.menu) ui.set({ menu: null });
    if (e.button === 1 || ui.tool === 'hand' || this.spaceDown) { this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cam: ui.camera }; this.canvas.style.cursor = 'grabbing'; return; }
    if (e.button === 2) { // right click: select what is under the cursor if not already selected
      const t = this.titleAt(p) ?? this.pickTarget(hitChain(this.doc, ui.pageId, world, 4 / ui.camera.zoom), e.metaKey || e.ctrlKey);
      if (t && !ui.selection.includes(t)) this.select([t]);
      return;
    }
    if (e.button !== 0) return;
    if (ui.pickSource) { // choosing a layer for a pattern fill: the click picks, it never selects or drags
      const t = this.titleAt(p) ?? this.pickTarget(hitChain(this.doc, ui.pageId, world, 4 / ui.camera.zoom), e.metaKey || e.ctrlKey);
      const cb = ui.pickSource; ui.set({ pickSource: null });
      if (t) cb(t); else ui.toast('No layer there. The pattern source was not changed.');
      return;
    }
    const canEdit = this.session.canEdit;
    if (ui.mode === 'prototype') { this.protoDown(p, world, e); return; }
    if (ui.tool === 'pen') { if (canEdit) this.penDown(world); else ui.toast('View-only: you cannot edit this file', 'error'); return; }
    if (ui.tool === 'textpath') { if (canEdit) this.beginTextPath(world); else ui.toast('View-only: you cannot edit this file', 'error'); return; }
    if (ui.tool === 'pencil' || ui.tool === 'brush') { if (canEdit) { this.pencil = [world]; this.brush = ui.tool === 'brush'; this.drag = { kind: 'pencil' }; } return; }
    if (ui.vectorEdit && ui.tool === 'select' && canEdit && this.vecDown(p, world, e)) return;
    if (ui.tool !== 'select') { if (canEdit) this.beginDraw(ui.tool, world); else ui.toast('View-only: you cannot edit this file', 'error'); return; }

    const hh = this.handleHit(p);
    if (hh && hh.kind === 'radius') { const id = topLevelOnly(this.store, ui.selection)[0]; this.store.begin('Corner radius'); this.drag = { kind: 'radius', id, corner: hh.corner, W0: worldMatrix(this.doc, id) }; return; }
    if (hh && hh.kind === 'resize') { this.beginResize(hh.index, world); return; }
    if (hh && hh.kind === 'rotate') { this.beginRotate(world); return; }

    const dev = this.devRects.find(d => p.x >= d.r.x && p.x <= d.r.x + d.r.w && p.y >= d.r.y && p.y <= d.r.y + d.r.h);
    if (dev) { ui.toast('Dev Mode (inspect code and specs) is not implemented yet', 'info'); return; }
    const title = this.titleAt(p);
    const target = title ?? this.pickTarget(hitChain(this.doc, ui.pageId, world, 4 / ui.camera.zoom), e.metaKey || e.ctrlKey);
    if (target) {
      if (e.shiftKey) { this.select(ui.selection.includes(target) ? ui.selection.filter(i => i !== target) : [...ui.selection, target]); if (!this.ui.selection.includes(target)) return; }
      else if (!ui.selection.includes(target)) this.select([target]);
      if (canEdit) this.beginMove(world, e.altKey);
    } else {
      if (!e.shiftKey) this.select([]);
      this.drag = { kind: 'marquee', start: world, additive: e.shiftKey, base: e.shiftKey ? [...ui.selection] : [] };
    }
  }

  onPointerMove(e: PointerEvent) {
    const p = this.screenPt(e); this.lastPointer = p;
    const world = this.toWorld(p);
    const d = this.drag;
    if (!d) { if (this.pen) { this.pen.cursor = world; this.requestRender(); return; } this.updateHover(p, world); return; }
    if (d.kind === 'connect') { this.connectPt = world; this.requestRender(); return; }
    if (d.kind === 'radius') { this.doRadius(d, world, e); this.requestRender(); return; }
    if (d.kind === 'penDrag' && this.pen) {
      const last = this.pen.pts.at(-1)!;
      if (Math.hypot(world.x - last.x, world.y - last.y) * this.ui.camera.zoom > 3) { last.ox = world.x - last.x; last.oy = world.y - last.y; last.ix = -last.ox; last.iy = -last.oy; }
      this.pen.cursor = world; this.requestRender(); return;
    }
    if (d.kind === 'pencil' && this.pencil) { const l = this.pencil.at(-1)!; if (Math.hypot(world.x - l.x, world.y - l.y) * this.ui.camera.zoom > 2) this.pencil.push(world); this.requestRender(); return; }
    if (d.kind === 'lasso' && this.lasso) { const l = this.lasso.at(-1)!; if (Math.hypot(world.x - l.x, world.y - l.y) * this.ui.camera.zoom > 2) this.lasso.push(world); this.requestRender(); return; }
    if (d.kind === 'bend') { this.bendMove(d, world); this.requestRender(); return; }
    if (d.kind === 'vec') { this.vecMove(d, world, e); this.requestRender(); return; }
    if (d.kind === 'pan') { const cam = d.cam; this.setCamera({ ...cam, x: cam.x - (e.clientX - d.sx) / cam.zoom, y: cam.y - (e.clientY - d.sy) / cam.zoom }); return; }
    if (d.kind === 'marquee') {
      const r = this.rectOf(d.start, world);
      this.ui.set({ marquee: r });
      const hits = this.marqueeHits(r);
      this.select(d.additive ? [...new Set([...d.base, ...hits])] : hits);
      this.requestRender(); return;
    }
    if (d.kind === 'move') this.doMove(d, world, e);
    if (d.kind === 'resize') this.doResize(d, world, e);
    if (d.kind === 'rotate') this.doRotate(d, world, e);
    if (d.kind === 'draw') this.doDraw(d, world, e);
    this.requestRender();
  }

  onPointerUp(e: PointerEvent) {
    const d = this.drag; this.drag = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* pointer already released */ }
    this.canvas.style.cursor = this.ui.tool === 'hand' || this.spaceDown ? 'grab' : '';
    if (!d) return;
    const world = this.toWorld(this.screenPt(e));
    if (d.kind === 'connect') { this.finishConnect(d.node, world); return; }
    if (d.kind === 'radius') { if (this.store.inTransaction) this.store.commit(); this.requestRender(); return; }
    if (d.kind === 'penDrag') return;
    if (d.kind === 'pencil') { this.finishPencil(); return; }
    if (d.kind === 'lasso') { this.finishLasso(); return; }
    if (d.kind === 'bend') { if (this.store.inTransaction) this.store.commit(); this.requestRender(); return; }
    if (d.kind === 'vec') { if (this.store.inTransaction) this.store.commit(); this.requestRender(); return; }
    if (d.kind === 'marquee') this.ui.set({ marquee: null });
    if (d.kind === 'move') {
      if (d.moved && this.store.inTransaction) {
        // drop into the frame under the pointer (or back to the page) while preserving world position
        const ids = d.ids.filter(id => this.doc.nodes[id]);
        const exclude = new Set(ids.flatMap(id => { const out: string[] = []; const w = (i: string) => { out.push(i); this.doc.nodes[i].children.forEach(w); }; w(id); return out; }));
        const target = this.frameAt(world, exclude);
        const tn = this.doc.nodes[target];
        const flowTarget = !!tn.layout && tn.type !== 'PAGE';
        for (const id of ids) {
          const cur = this.doc.nodes[id].parent!;
          if (flowTarget && !this.doc.nodes[id].absolute) { // drop into / within an auto-layout frame: choose the slot by pointer
            const at = this.flowIndex(target, world, new Set([id]));
            reparent(this.store, [id], target, at, 'Reorder in auto layout');
          } else if (cur !== target && this.doc.nodes[cur].type !== 'GROUP') reparent(this.store, [id], target);
        }
        for (const id of ids) refitAncestors(this.store, id); // groups re-fit once the gesture ends
        this.store.commit();
      } else if (this.store.inTransaction) this.store.rollback();
      this.ui.set({ guides: [] });
    }
    if (d.kind === 'resize' || d.kind === 'rotate') { if (this.store.inTransaction) this.store.commit(); this.ui.set({ guides: [] }); }
    if (d.kind === 'draw') this.endDraw(d, world);
    this.requestRender();
  }

  onDoubleClick(e: MouseEvent) {
    if (this.ui.mode === 'prototype') return;
    if (this.ui.tool === 'pen') { this.finishPen(false); return; }
    if (this.ui.tool !== 'select') return;
    const tId = this.titleAt(this.screenPt(e));
    if (tId && this.session.canEdit) { this.select([tId]); this.ui.set({ renaming: tId }); return; }
    if (this.ui.vectorEdit) {
      const hit = this.vecHit(this.screenPt(e));
      if (hit && hit.part === 'anchor') { const n = this.doc.nodes[this.ui.vectorEdit]; const pt = n.path!.points[hit.index]; setVectorPath(this.store, n.id, setSmooth(n.path!, hit.index, !isSmooth(pt)), isSmooth(pt) ? 'Make corner' : 'Make smooth'); this.requestRender(); return; }
    }
    const p = this.screenPt(e), world = this.toWorld(p);
    const chain = hitChain(this.doc, this.ui.pageId, world, 4 / this.ui.camera.zoom);
    if (!chain.length) return;
    const leaf = this.doc.nodes[chain[chain.length - 1]];
    if (leaf.type === 'VECTOR' && this.session.canEdit) { this.select([leaf.id]); this.startVectorEdit(leaf.id); return; }
    if (leaf.type === 'TEXT' && this.session.canEdit) { this.select([leaf.id]); this.startTextEdit(leaf.id); return; }
    const selIdx = chain.findIndex(id => this.ui.selection.includes(id));
    if (selIdx >= 0 && selIdx < chain.length - 1) this.select([chain[selIdx + 1]]);
    else this.select([chain[chain.length - 1]]);
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = this.screenPt(e);
    if (e.ctrlKey || e.metaKey) this.setCamera(zoomAt(this.ui.camera, p, this.ui.camera.zoom * Math.exp(-e.deltaY * 0.01)));
    else { const c = this.ui.camera; this.setCamera({ ...c, x: c.x + e.deltaX / c.zoom, y: c.y + e.deltaY / c.zoom }); }
  }

  setSpace(down: boolean) {
    this.spaceDown = down;
    if (!this.drag) this.canvas.style.cursor = down || this.ui.tool === 'hand' ? 'grab' : '';
  }

  private updateHover(p: Pt, world: Pt) {
    const ui = this.ui;
    let cursor = ui.tool === 'select' ? '' : ui.tool === 'hand' ? 'grab' : 'crosshair';
    let hover: string | null = null;
    if (ui.tool === 'select') {
      const hh = this.handleHit(p);
      if (hh?.kind === 'resize') cursor = HANDLE_CURSORS[hh.index];
      else if (hh?.kind === 'rotate') cursor = 'alias';
      else hover = this.titleAt(p) ?? this.pickTarget(hitChain(this.doc, ui.pageId, world, 4 / ui.camera.zoom), false);
    }
    this.canvas.style.cursor = cursor;
    if (hover !== ui.hoverId) { ui.set({ hoverId: hover, hoverFrom: hover ? 'canvas' : null }); this.requestRender(); }
  }

  private rectOf(a: Pt, b: Pt): Rect { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }

  private marqueeHits(r: Rect): string[] {
    const out: string[] = [];
    const walk = (id: string) => {
      const n = this.doc.nodes[id];
      if (!n.visible || n.locked) return;
      const b = worldBounds(this.doc, id);
      if (!rectsIntersect(b, r)) return;
      if ((n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && !rectContains(r, b)) { n.children.forEach(walk); return; }
      out.push(id);
    };
    this.doc.nodes[this.ui.pageId].children.forEach(walk);
    return out;
  }

  // ---------- move ----------
  private beginMove(world: Pt, altDup: boolean) {
    const ids = topLevelOnly(this.store, this.ui.selection).filter(i => !this.doc.nodes[i].locked);
    if (!ids.length) return;
    const origin = new Map(ids.map(i => [i, { x: this.doc.nodes[i].x, y: this.doc.nodes[i].y }]));
    this.drag = { kind: 'move', start: world, ids, origin, bounds: unionRects(ids.map(i => worldBounds(this.doc, i))), moved: false, altDup, axisLock: false, parent: this.doc.nodes[ids[0]].parent! };
  }

  private doMove(d: Extract<Drag, { kind: 'move' }>, world: Pt, e: PointerEvent) {
    let dx = world.x - d.start.x, dy = world.y - d.start.y;
    if (!d.moved) { if (Math.hypot(dx, dy) * this.ui.camera.zoom < 3) return; d.moved = true; this.store.begin('Move'); if (d.altDup) { const ids = duplicate(this.store, d.ids); d.ids = ids; d.origin = new Map(ids.map(i => [i, { x: this.doc.nodes[i].x, y: this.doc.nodes[i].y }])); this.select(ids); } }
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const guides: Guide[] = [];
    if (!(e.metaKey || e.ctrlKey)) {
      const s = this.snap(d, dx, dy);
      dx += s.dx; dy += s.dy; guides.push(...s.guides);
    }
    this.ui.set({ guides });
    for (const id of d.ids) {
      const n = this.doc.nodes[id]; const o = d.origin.get(id)!;
      if (this.inFlow(n)) continue; // auto-layout children are placed by the layout; the drop picks their index
      const pm = invert(worldMatrix(this.doc, n.parent!));
      const ld = { x: pm[0] * dx + pm[2] * dy, y: pm[1] * dx + pm[3] * dy };
      this.store.apply({ t: 'set', id, props: { x: o.x + ld.x, y: o.y + ld.y } });
    }
  }

  private inFlow(n: SceneNode) { const p = this.doc.nodes[n.parent!]; return !!p?.layout && !n.absolute && ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(p.type); }
  /** Insert index (bottom→top child order) for a pointer position inside an auto-layout frame. */
  private flowIndex(parentId: string, world: Pt, skip: Set<string>): number {
    const p = this.doc.nodes[parentId];
    const horiz = p.layout!.mode === 'HORIZONTAL';
    const kids = p.children.filter(c => !skip.has(c) && this.doc.nodes[c].visible && !this.doc.nodes[c].absolute);
    let idx = 0;
    for (const c of kids) { const b = worldBounds(this.doc, c); const mid = horiz ? b.x + b.w / 2 : b.y + b.h / 2; if ((horiz ? world.x : world.y) > mid) idx = p.children.indexOf(c) + 1; }
    return idx;
  }

  private snap(d: Extract<Drag, { kind: 'move' }>, dx: number, dy: number): { dx: number; dy: number; guides: Guide[] } {
    const th = 6 / this.ui.camera.zoom;
    const b = { x: d.bounds.x + dx, y: d.bounds.y + dy, w: d.bounds.w, h: d.bounds.h };
    const exclude = new Set(d.ids);
    const parent = this.doc.nodes[d.parent];
    const others: Rect[] = [];
    for (const sib of parent.children) if (!exclude.has(sib) && this.doc.nodes[sib].visible) others.push(worldBounds(this.doc, sib));
    if (parent.type === 'FRAME') others.push(worldBounds(this.doc, parent.id));
    const xs = [b.x, b.x + b.w / 2, b.x + b.w], ys = [b.y, b.y + b.h / 2, b.y + b.h];
    let bx: { d: number; at: number; o: Rect } | null = null, by: { d: number; at: number; o: Rect } | null = null;
    for (const o of others) {
      for (const tx of [o.x, o.x + o.w / 2, o.x + o.w]) for (const x of xs) { const diff = tx - x; if (Math.abs(diff) <= th && (!bx || Math.abs(diff) < Math.abs(bx.d))) bx = { d: diff, at: tx, o }; }
      for (const ty of [o.y, o.y + o.h / 2, o.y + o.h]) for (const y of ys) { const diff = ty - y; if (Math.abs(diff) <= th && (!by || Math.abs(diff) < Math.abs(by.d))) by = { d: diff, at: ty, o }; }
    }
    const guides: Guide[] = [];
    const sx = bx?.d ?? 0, sy = by?.d ?? 0;
    const nb = { x: b.x + sx, y: b.y + sy, w: b.w, h: b.h };
    if (bx) guides.push({ x1: bx.at, x2: bx.at, y1: Math.min(nb.y, bx.o.y), y2: Math.max(nb.y + nb.h, bx.o.y + bx.o.h) });
    if (by) guides.push({ y1: by.at, y2: by.at, x1: Math.min(nb.x, by.o.x), x2: Math.max(nb.x + nb.w, by.o.x + by.o.w) });
    return { dx: sx, dy: sy, guides };
  }

  // ---------- resize ----------
  private beginResize(index: number, world: Pt) {
    const ids = topLevelOnly(this.store, this.ui.selection).filter(i => !this.doc.nodes[i].locked);
    if (!ids.length) return;
    const handle = HANDLES[index];
    this.store.begin('Resize');
    if (ids.length === 1) {
      const n = this.doc.nodes[ids[0]];
      this.drag = { kind: 'resize', handle, ids, start: world, box: { x: n.x, y: n.y, w: n.width, h: n.height }, single: true, W0: worldMatrix(this.doc, n.id), node0: structuredClone(n), parentInv: invert(worldMatrix(this.doc, n.parent!)), origin: new Map() };
    } else {
      const box = unionRects(ids.map(i => worldBounds(this.doc, i)));
      this.drag = { kind: 'resize', handle, ids, start: world, box, single: false, origin: new Map(ids.map(i => [i, worldBounds(this.doc, i)])) };
    }
  }

  private doResize(d: Extract<Drag, { kind: 'resize' }>, world: Pt, e: PointerEvent) {
    const [hx, hy] = d.handle;
    if (d.single) {
      const n0 = d.node0!;
      const p = apply(invert(d.W0!), world);
      const fromCenter = e.altKey;
      let w = n0.width, h = n0.height;
      if (hx === 1) w = fromCenter ? 2 * (p.x - n0.width / 2) : p.x; else if (hx === 0) w = fromCenter ? 2 * (n0.width / 2 - p.x) : n0.width - p.x;
      if (hy === 1) h = fromCenter ? 2 * (p.y - n0.height / 2) : p.y; else if (hy === 0) h = fromCenter ? 2 * (n0.height / 2 - p.y) : n0.height - p.y;
      if (e.shiftKey && n0.width > 0 && n0.height > 0 && n0.type !== 'LINE') {
        const k = hx === 0.5 ? h / n0.height : hy === 0.5 ? w / n0.width : Math.max(w / n0.width, h / n0.height);
        w = n0.width * k; h = n0.height * k;
      }
      w = Math.max(1, w); h = n0.type === 'LINE' ? 0 : Math.max(1, h);
      const a = fromCenter ? { x: n0.width / 2, y: n0.height / 2 } : { x: hx === 0 ? n0.width : hx === 1 ? 0 : n0.width / 2, y: hy === 0 ? n0.height : hy === 1 ? 0 : n0.height / 2 };
      const a2 = fromCenter ? { x: w / 2, y: h / 2 } : { x: hx === 0 ? w : hx === 1 ? 0 : w / 2, y: hy === 0 ? h : hy === 1 ? 0 : h / 2 };
      const P = apply(mul(d.parentInv!, d.W0!), a); // anchor in parent space
      const R = rotate(n0.rotation);
      const off = apply(R, a2);
      const props: Partial<SceneNode> = {};
      if (n0.type === 'TEXT' && n0.text) {
        const t = { ...n0.text };
        if (hx !== 0.5 && t.resize === 'AUTO_WIDTH') t.resize = 'AUTO_HEIGHT';
        if (hy !== 0.5) t.resize = 'FIXED';
        props.text = t;
      }
      this.store.apply({ t: 'set', id: n0.id, props });
      resizeNode(this.store, n0.id, { x: P.x - off.x, y: P.y - off.y, width: w, height: h });
      const cur = this.doc.nodes[n0.id];
      if (cur.type === 'TEXT' && cur.text?.resize === 'AUTO_HEIGHT') { const s = autoTextSize(cur); if (s) this.store.apply({ t: 'set', id: cur.id, props: { height: s.height } }); }
    } else {
      const b = d.box;
      const anchor = { x: hx === 0 ? b.x + b.w : hx === 1 ? b.x : b.x + b.w / 2, y: hy === 0 ? b.y + b.h : hy === 1 ? b.y : b.y + b.h / 2 };
      let sx = hx === 0.5 || b.w === 0 ? 1 : (hx === 1 ? world.x - anchor.x : anchor.x - world.x) / b.w;
      let sy = hy === 0.5 || b.h === 0 ? 1 : (hy === 1 ? world.y - anchor.y : anchor.y - world.y) / b.h;
      if (e.shiftKey) { const k = hx === 0.5 ? sy : hy === 0.5 ? sx : Math.max(sx, sy); sx = hx === 0.5 ? k : k; sy = k; if (hx === 0.5) sx = 1; if (hy === 0.5) sy = 1; }
      sx = Math.max(0.01, sx); sy = Math.max(0.01, sy);
      for (const id of d.ids) {
        const o = d.origin.get(id)!, n = this.doc.nodes[id];
        const nx = anchor.x + (o.x - anchor.x) * sx, ny = anchor.y + (o.y - anchor.y) * sy;
        const cur = worldBounds(this.doc, id);
        translateWorld(this.store, id, nx - cur.x, ny - cur.y);
        resizeNode(this.store, id, { width: Math.max(1, o.w * sx), height: n.type === 'LINE' ? 0 : Math.max(1, o.h * sy) });
        const upd = this.doc.nodes[id];
        if (upd.type === 'TEXT' && upd.text && upd.text.resize !== 'FIXED') this.store.apply({ t: 'set', id, props: { text: { ...upd.text, resize: 'FIXED' } } });
      }
    }
  }

  // ---------- corner radius ----------
  private doRadius(d: Extract<Drag, { kind: 'radius' }>, world: Pt, e: PointerEvent) {
    const n = this.doc.nodes[d.id]; if (!n) return;
    const z = this.ui.camera.zoom, off = 14 / z;
    const q = apply(invert(worldMatrix(this.doc, d.id)), world);
    const x = d.corner === 1 || d.corner === 2 ? n.width - q.x : q.x, y = d.corner === 2 || d.corner === 3 ? n.height - q.y : q.y;
    const max = Math.min(n.width, n.height) / 2;
    const r = Math.round(Math.min(max, Math.max(0, (x + y) / 2 - off)) * 10) / 10;
    if (e.altKey) { // alt: change this corner only
      const base: [number, number, number, number] = n.cornerRadii ? [...n.cornerRadii] : [n.cornerRadius, n.cornerRadius, n.cornerRadius, n.cornerRadius];
      base[d.corner] = r;
      this.store.apply({ t: 'set', id: d.id, props: { cornerRadii: base, cornerRadius: 0 } });
    } else this.store.apply({ t: 'set', id: d.id, props: { cornerRadius: r, cornerRadii: undefined } });
  }

  // ---------- rotate ----------
  private beginRotate(world: Pt) {
    const ids = topLevelOnly(this.store, this.ui.selection).filter(i => !this.doc.nodes[i].locked);
    const box = this.selectionBox(); if (!box || !ids.length) return;
    const center = { x: (box.corners[0].x + box.corners[2].x) / 2, y: (box.corners[0].y + box.corners[2].y) / 2 };
    this.store.begin('Rotate');
    this.drag = { kind: 'rotate', ids, center, startAngle: Math.atan2(world.y - center.y, world.x - center.x), W0: new Map(ids.map(i => [i, worldMatrix(this.doc, i)])), parentInv: new Map(ids.map(i => [i, invert(worldMatrix(this.doc, this.doc.nodes[i].parent!))])) };
  }
  private doRotate(d: Extract<Drag, { kind: 'rotate' }>, world: Pt, e: PointerEvent) {
    let delta = (Math.atan2(world.y - d.center.y, world.x - d.center.x) - d.startAngle) * 180 / Math.PI;
    if (e.shiftKey) delta = Math.round(delta / 15) * 15;
    const R = mul(translate(d.center.x, d.center.y), mul(rotate(delta), translate(-d.center.x, -d.center.y)));
    for (const id of d.ids) {
      const local = mul(d.parentInv.get(id)!, mul(R, d.W0.get(id)!));
      const dec = decompose(local);
      const rotation = normAngle(dec.rotation);
      this.store.apply({ t: 'set', id, props: { x: dec.x, y: dec.y, rotation } });
    }
  }

  // ---------- drawing tools ----------
  private beginDraw(tool: Tool, world: Pt) {
    const parent = this.frameAt(world, new Set());
    const type: 'FRAME' | 'RECT' | 'ELLIPSE' | 'LINE' | 'TEXT' | 'VECTOR' = tool === 'star' || tool === 'polygon' || tool === 'arrow' ? 'VECTOR' : tool === 'frame' || tool === 'section' ? 'FRAME' : tool === 'rect' ? 'RECT' : tool === 'ellipse' ? 'ELLIPSE' : tool === 'line' ? 'LINE' : 'TEXT';
    const pm = invert(worldMatrix(this.doc, parent));
    const lp = apply(pm, world);
    const names: Record<string, string> = { FRAME: 'Frame', RECT: 'Rectangle', ELLIPSE: 'Ellipse', LINE: 'Line', TEXT: 'Text', VECTOR: tool === 'star' ? 'Star' : tool === 'arrow' ? 'Arrow' : 'Polygon' };
    if (tool === 'section') names.FRAME = 'Section';
    const node = defaultNode(type, { name: names[type], x: lp.x, y: lp.y, width: 1, height: type === 'LINE' ? 0 : 1 });
    if (tool === 'section') { node.fills = [solid('#8A8A8A', 0.18)]; node.clipsContent = false; }
    if (type === 'VECTOR' && tool === 'arrow') { node.path = arrowPath({ x: 0, y: 0 }, { x: 1, y: 0 }); node.fills = []; node.strokes = [solid('#000000')]; node.strokeWeight = 2; node.strokeCap = 'ROUND'; node.strokeJoin = 'ROUND'; }
    else if (type === 'VECTOR') { node.path = shapePath(tool as 'star' | 'polygon', 1, 1); node.fills = defaultNode('RECT').fills; node.strokes = []; }
    if (type === 'TEXT') { node.text = { ...node.text!, characters: '' }; node.width = 1; }
    this.store.begin(`Add ${names[type].toLowerCase()}`);
    addNode(this.store, node, parent);
    this.select([node.id]);
    this.drag = { kind: 'draw', tool, start: world, id: node.id, parent, moved: false };
  }
  private doDraw(d: Extract<Drag, { kind: 'draw' }>, world: Pt, e: PointerEvent) {
    const n = this.doc.nodes[d.id];
    if (Math.hypot(world.x - d.start.x, world.y - d.start.y) * this.ui.camera.zoom > 3) d.moved = true;
    if (d.tool === 'arrow') {
      const pm = invert(worldMatrix(this.doc, d.parent));
      const a = apply(pm, d.start); let b = apply(pm, world);
      if (e.shiftKey) { const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * (Math.PI / 12); const len = Math.hypot(b.x - a.x, b.y - a.y); b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len }; }
      const bx = arrowBox(a, b, n.strokeWeight);
      this.store.apply({ t: 'set', id: d.id, props: { x: bx.x, y: bx.y, width: bx.w, height: bx.h, path: bx.path } });
      return;
    }
    if (d.tool === 'line') {
      const pm = invert(worldMatrix(this.doc, d.parent));
      const a = apply(pm, d.start); let b = apply(pm, world);
      if (e.shiftKey) { const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * (Math.PI / 12); const len = Math.hypot(b.x - a.x, b.y - a.y); b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len }; }
      this.store.apply({ t: 'set', id: d.id, props: { x: a.x, y: a.y, width: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), rotation: normAngle((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) } });
      return;
    }
    const pm = invert(worldMatrix(this.doc, d.parent));
    const a = apply(pm, d.start); const b = apply(pm, world);
    let w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (e.shiftKey && d.tool !== 'text') w = h = Math.max(w, h);
    const x = b.x < a.x ? a.x - w : a.x, y = b.y < a.y ? a.y - h : a.y;
    if (d.tool === 'text') { this.store.apply({ t: 'set', id: d.id, props: { x, width: Math.max(1, w), height: Math.max(1, h), y } }); return; }
    if (d.tool === 'star' || d.tool === 'polygon') { this.store.apply({ t: 'set', id: d.id, props: { x, y, width: Math.max(1, w), height: Math.max(1, h), path: shapePath(d.tool, Math.max(1, w), Math.max(1, h)) } }); return; }
    this.store.apply({ t: 'set', id: d.id, props: { x, y, width: Math.max(1, w), height: Math.max(1, h) } });
    void n;
  }
  private endDraw(d: Extract<Drag, { kind: 'draw' }>, world: Pt) {
    void world;
    const n = this.doc.nodes[d.id];
    if (d.tool === 'text') {
      if (d.moved && n.text) this.store.apply({ t: 'set', id: d.id, props: { text: { ...n.text, resize: 'AUTO_HEIGHT' } } });
      this.ui.set({ tool: 'select' });
      this.startTextEdit(d.id, true);
      return;
    }
    if (!d.moved) { // click without drag: default size
      const sizes: Record<string, [number, number]> = { FRAME: [100, 100], RECT: [100, 100], ELLIPSE: [100, 100], LINE: [100, 0] };
      if (d.tool === 'arrow') { const a = { x: n.x, y: n.y }; const bx = arrowBox(a, { x: a.x + 100, y: a.y }, n.strokeWeight); this.store.apply({ t: 'set', id: d.id, props: { x: bx.x, y: bx.y, width: bx.w, height: bx.h, path: bx.path } }); this.store.commit(); this.ui.set({ tool: 'select' }); return; }
      const [w, h] = n.type === 'VECTOR' ? [100, 100] : d.tool === 'section' ? [320, 220] : sizes[n.type]; this.store.apply({ t: 'set', id: d.id, props: n.type === 'VECTOR' ? { width: w, height: h, path: shapePath(d.tool as 'star' | 'polygon', w, h) } : { width: w, height: h } });
    }
    this.store.commit();
    this.ui.set({ tool: 'select' });
  }

  /** Text-on-path: click a vector (pen / pencil / brush / shape) to lay a new text layer along its curve. */
  private beginTextPath(world: Pt) {
    const hit = hitChain(this.doc, this.ui.pageId, world, 6 / this.ui.camera.zoom).map(id => this.doc.nodes[id]).find(n => n?.type === 'VECTOR' && n.path && !n.locked);
    if (!hit || !hit.parent) { this.ui.toast('Click a path (pen, pencil, brush, star…) to put text on it'); return; }
    const base = defaultNode('TEXT', { name: 'Text on path', x: hit.x, y: hit.y, width: Math.max(1, hit.width), height: Math.max(1, hit.height), rotation: hit.rotation });
    base.text = { ...base.text!, characters: 'Text on a path', resize: 'FIXED' };
    base.textPath = JSON.parse(JSON.stringify(hit.path));
    this.store.begin('Add text on path');
    addNode(this.store, base, hit.parent);
    this.store.commit();
    this.ui.set({ tool: 'select', selection: [base.id] });
    this.startTextEdit(base.id);
  }

  // ---------- text editing ----------
  /** `inCreation`: the add-text transaction is still open and is rolled back if the text stays empty. */
  startTextEdit(id: string, inCreation = false) {
    if (!inCreation) this.store.begin('Edit text');
    this.textEditCreated = inCreation;
    this.ui.set({ editingTextId: id, selection: [id] });
    this.requestRender();
  }
  textEditCreated = false;
  endTextEdit(value: string) {
    const id = this.ui.editingTextId; if (!id) return;
    this.ui.set({ editingTextId: null });
    const n = this.doc.nodes[id];
    if (!n) { if (this.store.inTransaction) this.store.rollback(); return; }
    if (value === '' && this.textEditCreated) { this.store.rollback(); this.ui.set({ selection: [] }); }
    else if (value === '') { this.store.rollback(); }
    else {
      this.store.apply({ t: 'set', id, props: { text: { ...n.text!, characters: value }, ...(n.name === 'Text' ? { name: value.split('\n')[0].slice(0, 40) } : {}) } });
      this.session.fitText([id]);
      this.store.commit();
    }
    this.requestRender();
  }
  liveText(id: string, value: string) {
    const n = this.doc.nodes[id]; if (!n?.text) return;
    this.store.apply({ t: 'set', id, props: { text: { ...n.text, characters: value } } });
    this.session.fitText([id]);
  }

  // ---------- keyboard-driven helpers ----------
  nudge(dx: number, dy: number) {
    const ids = topLevelOnly(this.store, this.ui.selection).filter(i => !this.doc.nodes[i].locked);
    if (!ids.length || !this.session.canEdit) return;
    this.store.transact('Nudge', () => { for (const id of ids) translateWorld(this.store, id, dx, dy); });
  }
  alignSelection(mode: Parameters<typeof alignNodes>[2]) { alignNodes(this.store, this.ui.selection, mode); }
  setTool(t: Tool) { if (this.store.inTransaction) return; if (this.pen && t !== 'pen') this.finishPen(false); if (this.ui.vectorEdit && t !== 'select') this.exitVectorEdit(); this.ui.set({ tool: t }); this.canvas.style.cursor = t === 'hand' ? 'grab' : t === 'select' ? '' : 'crosshair'; this.requestRender(); }
  cancelGesture() { if (this.drag) { if (this.store.inTransaction) this.store.rollback(); this.drag = null; this.ui.set({ guides: [], marquee: null }); this.requestRender(); } }

  // ---------- prototype mode ----------
  private connectHandle(id: string): Pt { const b = worldBounds(this.doc, id); return { x: b.x + b.w, y: b.y + b.h / 2 }; }
  private protoDown(p: Pt, world: Pt, e: PointerEvent) {
    const ui = this.ui;
    const sel = topLevelOnly(this.store, ui.selection);
    if (this.session.canEdit && sel.length === 1 && this.doc.nodes[sel[0]].type !== 'PAGE') {
      const h = this.toScreen(this.connectHandle(sel[0]));
      if (Math.hypot(h.x - p.x, h.y - p.y) <= 10) { this.drag = { kind: 'connect', node: sel[0] }; this.connectPt = world; return; }
    }
    const title = this.titleAt(p);
    const target = title ?? this.pickTarget(hitChain(this.doc, ui.pageId, world, 4 / ui.camera.zoom), true); // deep: interactions live on inner layers
    if (target) this.select(e.shiftKey ? (ui.selection.includes(target) ? ui.selection.filter(i => i !== target) : [...ui.selection, target]) : [target]);
    else { if (!e.shiftKey) this.select([]); }
  }
  private finishConnect(node: string, world: Pt) {
    this.drag = null; this.connectPt = null; this.requestRender();
    const chain = hitChain(this.doc, this.ui.pageId, world, 0);
    const dest = chain[0] && ['FRAME', 'COMPONENT', 'COMPONENT_SET'].includes(this.doc.nodes[chain[0]].type) ? chain[0] : null;
    if (!dest) { this.ui.toast('Drop on a top-level frame to connect', 'info'); return; }
    if (dest === topFrameOf(this.doc, node)) { this.ui.toast('A layer cannot navigate to its own frame', 'error'); return; }
    connectTo(this.store, node, dest);
    this.ui.toast(`Connected to ${this.doc.nodes[dest].name}`);
  }
  private protoTargets(n: SceneNode): string[] {
    const out: string[] = [];
    const walk = (a: ProtoAction) => { if ('to' in a && a.to && this.doc.nodes[a.to]) { if (a.type === 'NAVIGATE' || a.type === 'OVERLAY_OPEN' || a.type === 'OVERLAY_SWAP') out.push(a.to); else if (a.type === 'SCROLL_TO') { const f = topFrameOf(this.doc, a.to); if (f) out.push(f); } } if (a.type === 'CONDITIONAL') { a.branches.forEach(b => b.actions.forEach(walk)); a.otherwise.forEach(walk); } };
    for (const i of n.interactions ?? []) i.actions.forEach(walk);
    return out;
  }
  private drawConnections(ctx: CanvasRenderingContext2D) {
    const ui = this.ui, acc = this.accent;
    const walk = (id: string) => {
      const n = this.doc.nodes[id]; if (!n || !n.visible) return;
      for (const dest of n.interactions?.length ? this.protoTargets(n) : []) {
        const a = this.toScreen(this.connectHandle(id)), db = worldBounds(this.doc, dest), b = this.toScreen({ x: db.x, y: db.y + db.h / 2 });
        const sel = ui.selection.includes(id);
        ctx.strokeStyle = sel ? acc : 'rgba(79,70,229,.55)'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = sel ? 2 : 1.5;
        const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - 9, b.y - 5); ctx.lineTo(b.x - 9, b.y + 5); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, Math.PI * 2); ctx.fill();
      }
      n.children.forEach(walk);
    };
    this.doc.nodes[ui.pageId].children.forEach(walk);
    const sel = topLevelOnly(this.store, ui.selection);
    if (sel.length === 1 && this.session.canEdit && this.doc.nodes[sel[0]]) {
      const h = this.toScreen(this.connectHandle(sel[0]));
      ctx.fillStyle = '#fff'; ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(h.x, h.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(h.x - 3, h.y); ctx.lineTo(h.x + 3, h.y); ctx.moveTo(h.x, h.y - 3); ctx.lineTo(h.x, h.y + 3); ctx.stroke();
      if (this.drag?.kind === 'connect' && this.connectPt) { const t = this.toScreen(this.connectPt); ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(t.x, t.y); ctx.stroke(); ctx.setLineDash([]); }
    }
  }

  // ---------- pen / pencil ----------
  get penActive() { return !!this.pen; }
  private penDown(world: Pt) {
    if (!this.pen) this.pen = { pts: [], cursor: world };
    const first = this.pen.pts[0];
    if (first && this.pen.pts.length >= 2 && Math.hypot(world.x - first.x, world.y - first.y) * this.ui.camera.zoom <= 8) { this.finishPen(true); return; }
    this.pen.pts.push(corner(world.x, world.y));
    this.drag = { kind: 'penDrag' };
    this.requestRender();
  }
  /** Finish the path being drawn. `close` joins the last anchor to the first. */
  finishPen(close: boolean) {
    const pen = this.pen; this.pen = null; this.drag = null;
    if (!pen) return;
    const pts: PathPoint[] = [];
    for (const p of pen.pts) { const l = pts.at(-1); if (l && Math.hypot(l.x - p.x, l.y - p.y) < 0.5 / this.ui.camera.zoom) { l.ox = p.ox || l.ox; l.oy = p.oy || l.oy; continue; } pts.push(p); } // double-click adds a duplicate anchor
    this.requestRender();
    if (pts.length < 2) return;
    const parent = this.frameAt({ x: pts[0].x, y: pts[0].y }, new Set());
    const path = pathToParentSpace(this.store, parent, { points: pts, closed: close });
    const id = createVector(this.store, parent, path);
    this.ui.set({ selection: [id], tool: 'select' });
    this.canvas.style.cursor = '';
  }
  private finishPencil() {
    const raw = this.pencil; this.pencil = null; this.drag = null;
    this.requestRender();
    if (!raw || raw.length < 2) return;
    const pts = simplify(raw, 2 / this.ui.camera.zoom);
    if (pts.length < 2) return;
    const parent = this.frameAt(pts[0], new Set());
    const path = pathToParentSpace(this.store, parent, smoothPolyline(pts));
    const o = this.ui.drawOpts[this.brush ? 'brush' : 'pencil'];
    const dashes = o.style === 'dashed' ? [o.size * 2, o.size * 2] : o.style === 'dotted' ? [0.01, o.size * 2] : [];
    const id = createVector(this.store, parent, path, { name: this.brush ? 'Brush' : 'Pencil', fills: [], strokes: [solid(o.color)], strokeWeight: o.size, strokeCap: o.style === 'flat' ? 'NONE' : 'ROUND', dashes });
    this.ui.set({ selection: [id], tool: 'select' });
  }

  // ---------- edit-object tools (the bar above the dock) ----------
  private vecToolDown(tool: 'lasso' | 'paint' | 'bend' | 'cut' | 'erase', p: Pt, world: Pt, id: string): boolean {
    const n = this.doc.nodes[id]; if (!n?.path) return false;
    const W0 = worldMatrix(this.doc, id);
    const hit = this.vecHit(p);
    const near = nearestOnPath(n.path, apply(invert(W0), world));
    const onLine = near && near.dist * this.ui.camera.zoom <= 8 ? near : null;
    if (tool === 'lasso') { this.lasso = [world]; this.drag = { kind: 'lasso' }; return true; }
    if (tool === 'erase') {
      if (hit?.part === 'anchor') {
        const np = deletePoints(n.path, [hit.index]);
        if (!np) { this.exitVectorEdit(); this.store.transact('Delete', () => { this.store.apply({ t: 'remove', id }); }); this.ui.set({ selection: [] }); }
        else { setVectorPath(this.store, id, np, 'Erase anchor'); this.ui.set({ vecSel: [] }); }
      }
      return true;
    }
    if (tool === 'cut') {
      if (onLine) { const ids = cutPath(this.store, id, onLine.seg, onLine.t); this.ui.set({ vecSel: [], selection: ids }); }
      return true;
    }
    if (tool === 'paint') {
      if (n.path.closed || hitChain(this.doc, this.ui.pageId, world, 0).includes(id)) setProps(this.store, [id], { fills: [solid(this.ui.drawOpts.brush.color)] }, 'Paint');
      return true;
    }
    if (tool === 'bend') {
      if (hit?.part === 'anchor') { setVectorPath(this.store, id, setSmooth(n.path, hit.index, !isSmooth(n.path.points[hit.index])), 'Bend anchor'); this.ui.set({ vecSel: [hit.index] }); return true; }
      if (onLine) { this.store.begin('Bend segment'); this.drag = { kind: 'bend', id, seg: onLine.seg, start: world, path0: structuredClone(n.path) }; }
      return true;
    }
    return true;
  }
  private bendMove(d: Extract<Drag, { kind: 'bend' }>, world: Pt) {
    const n = this.doc.nodes[d.id]; if (!n?.path) return;
    const inv = invert(worldMatrix(this.doc, d.id));
    const a0 = apply(inv, d.start), a1 = apply(inv, world);
    const dx = (a1.x - a0.x) * 0.67, dy = (a1.y - a0.y) * 0.67;
    const pts = d.path0.points.map(q => ({ ...q })), cnt = pts.length;
    const A = pts[d.seg], B = pts[(d.seg + 1) % cnt];
    A.ox += dx; A.oy += dy; B.ix += dx; B.iy += dy;
    this.store.apply({ t: 'set', id: d.id, props: { path: { ...n.path, points: pts } } });
    fitVector(this.store, d.id);
  }
  private finishLasso() {
    const poly = this.lasso; this.lasso = null; this.drag = null; this.requestRender();
    const id = this.ui.vectorEdit; const n = id ? this.doc.nodes[id] : null;
    if (!poly || poly.length < 3 || !n?.path) return;
    const W = worldMatrix(this.doc, n.id);
    this.ui.set({ vecSel: n.path.points.map((q, i) => (pointInPolygon(apply(W, q), poly) ? i : -1)).filter(i => i >= 0) });
  }
  /** Edit object: rectangles and ellipses become vectors first (so every point can be edited). */
  editObject() {
    if (this.ui.vectorEdit) { this.exitVectorEdit(); return; }
    const id = this.ui.selection[0]; const n = id ? this.doc.nodes[id] : null;
    if (!n || this.ui.selection.length !== 1 || !this.session.canEdit) return;
    if (n.type !== 'VECTOR' && !convertToVector(this.store, id)) { this.ui.toast('Select a shape or path to edit'); return; }
    this.ui.set({ vecTool: 'move' }); this.startVectorEdit(id);
  }

  // ---------- vector edit mode ----------
  get vectorEditing() { return this.ui.vectorEdit; }
  startVectorEdit(id: string) { if (this.doc.nodes[id]?.type !== 'VECTOR') return; this.ui.set({ vectorEdit: id, vecSel: [], selection: [id], tool: 'select' }); this.requestRender(); }
  exitVectorEdit() { if (this.ui.vectorEdit) { this.ui.set({ vectorEdit: null, vecSel: [] }); this.requestRender(); } }
  private vecWorld(id: string, x: number, y: number): Pt { return apply(worldMatrix(this.doc, id), { x, y }); }
  private vecHit(p: Pt): { part: 'anchor' | 'in' | 'out'; index: number } | null {
    const id = this.ui.vectorEdit; const n = id ? this.doc.nodes[id] : null;
    if (!n?.path) return null;
    const near = (w: Pt) => { const s = this.toScreen(w); return Math.hypot(s.x - p.x, s.y - p.y) <= 7; };
    for (const i of this.ui.vecSel) {
      const a = n.path.points[i]; if (!a) continue;
      if ((a.ox || a.oy) && near(this.vecWorld(n.id, a.x + a.ox, a.y + a.oy))) return { part: 'out', index: i };
      if ((a.ix || a.iy) && near(this.vecWorld(n.id, a.x + a.ix, a.y + a.iy))) return { part: 'in', index: i };
    }
    for (let i = n.path.points.length - 1; i >= 0; i--) if (near(this.vecWorld(n.id, n.path.points[i].x, n.path.points[i].y))) return { part: 'anchor', index: i };
    return null;
  }
  /** Returns true when the click was consumed by path editing. */
  private vecDown(p: Pt, world: Pt, e: PointerEvent): boolean {
    const id = this.ui.vectorEdit!; const n = this.doc.nodes[id];
    if (!n?.path) { this.exitVectorEdit(); return false; }
    if (this.ui.vecTool !== 'move') return this.vecToolDown(this.ui.vecTool, p, world, id);
    const hit = this.vecHit(p);
    const W0 = worldMatrix(this.doc, id);
    if (hit) {
      let sel = this.ui.vecSel;
      if (hit.part === 'anchor') { sel = e.shiftKey ? (sel.includes(hit.index) ? sel.filter(i => i !== hit.index) : [...sel, hit.index]) : sel.includes(hit.index) ? sel : [hit.index]; this.ui.set({ vecSel: sel }); if (!sel.includes(hit.index)) return true; }
      this.store.begin('Edit path');
      const anchors = new Map<number, Pt>(sel.map(i => [i, apply(W0, n.path!.points[i])]));
      const pt = n.path.points[hit.index];
      const tip0 = hit.part === 'out' ? apply(W0, { x: pt.x + pt.ox, y: pt.y + pt.oy }) : hit.part === 'in' ? apply(W0, { x: pt.x + pt.ix, y: pt.y + pt.iy }) : undefined;
      this.drag = { kind: 'vec', part: hit.part, index: hit.index, start: world, id, anchors, tip0, W0, path0: structuredClone(n.path) };
      return true;
    }
    const near = nearestOnPath(n.path, apply(invert(W0), world));
    if (near && near.dist * this.ui.camera.zoom <= 6) { // click on the outline adds an anchor
      const r = insertPoint(n.path, near.seg, near.t);
      setVectorPath(this.store, id, r.path, 'Add anchor');
      this.ui.set({ vecSel: [r.index] });
      return true;
    }
    if (hitChain(this.doc, this.ui.pageId, world, 4 / this.ui.camera.zoom).includes(id)) { if (!e.shiftKey) this.ui.set({ vecSel: [] }); return true; }
    this.exitVectorEdit();
    return false;
  }
  private vecMove(d: Extract<Drag, { kind: 'vec' }>, world: Pt, e: PointerEvent) {
    const n = this.doc.nodes[d.id]; if (!n?.path) return;
    const dx = world.x - d.start.x, dy = world.y - d.start.y;
    const inv = invert(worldMatrix(this.doc, d.id)); // current (the box is re-fitted as points move)
    const pts = n.path.points.map(p => ({ ...p }));
    if (d.part === 'anchor') {
      for (const [i, w0] of d.anchors) { const l = apply(inv, { x: w0.x + dx, y: w0.y + dy }); pts[i] = { ...pts[i], x: l.x, y: l.y }; }
    } else {
      const a = pts[d.index], a0 = apply(worldMatrix(this.doc, d.id), a);
      const tip = apply(inv, { x: d.tip0!.x + dx, y: d.tip0!.y + dy });
      void a0;
      const hx = tip.x - a.x, hy = tip.y - a.y;
      if (d.part === 'out') { a.ox = hx; a.oy = hy; if (!e.altKey) { a.ix = -hx; a.iy = -hy; } }
      else { a.ix = hx; a.iy = hy; if (!e.altKey) { a.ox = -hx; a.oy = -hy; } }
    }
    this.store.apply({ t: 'set', id: d.id, props: { path: { ...n.path, points: pts } } });
    fitVector(this.store, d.id);
  }
  /** Delete selected anchors (the whole layer if fewer than 2 would remain). */
  deleteAnchors() {
    const id = this.ui.vectorEdit; const n = id ? this.doc.nodes[id] : null;
    if (!n?.path || !this.ui.vecSel.length) return false;
    const np = deletePoints(n.path, this.ui.vecSel);
    if (!np) { this.exitVectorEdit(); this.store.transact('Delete', () => { this.store.apply({ t: 'remove', id: n.id }); }); this.ui.set({ selection: [] }); return true; }
    setVectorPath(this.store, n.id, np, 'Delete anchor');
    this.ui.set({ vecSel: [] });
    return true;
  }

  // ---------- rendering ----------
  render() {
    const { w, h, dpr, ctx } = this;
    const ui = this.ui, cam = ui.camera;
    const dark = ui.theme === 'dark';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const page = this.doc.nodes[ui.pageId];
    this.drawBackdrop(ctx, dark);
    if (!page) return;
    ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);
    const view = { x: cam.x, y: cam.y, w: w / cam.zoom, h: h / cam.zoom };
    drawChildren(ctx, this.doc, page.id, { images: this.session.images, scale: dpr * cam.zoom, view, hideTextOf: ui.editingTextId && this.doc.nodes[ui.editingTextId]?.textPath ? null : ui.editingTextId, showGuides: true });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawOverlay(ctx, dark);
  }

  private drawPenPreview(ctx: CanvasRenderingContext2D) {
    const pen = this.pen!, acc = this.accent, P = pen.pts;
    if (!P.length) return;
    const S = (x: number, y: number) => this.toScreen({ x, y });
    ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.beginPath();
    const s0 = S(P[0].x, P[0].y); ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i]; const c1 = S(a.x + a.ox, a.y + a.oy), c2 = S(b.x + b.ix, b.y + b.iy), e = S(b.x, b.y); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y); }
    const l = P[P.length - 1], cur = S(pen.cursor.x, pen.cursor.y);
    if (!this.drag) { ctx.save(); ctx.setLineDash([4, 3]); const c1 = S(l.x + l.ox, l.y + l.oy); ctx.bezierCurveTo(c1.x, c1.y, cur.x, cur.y, cur.x, cur.y); ctx.restore(); }
    ctx.stroke();
    const first = S(P[0].x, P[0].y), closing = P.length >= 2 && Math.hypot(first.x - cur.x, first.y - cur.y) <= 8;
    P.forEach((a, i) => { const s = S(a.x, a.y); ctx.fillStyle = i === 0 && closing ? acc : '#fff'; ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.rect(s.x - 4, s.y - 4, 8, 8); ctx.fill(); ctx.stroke();
      if (a.ox || a.oy) for (const [hx, hy] of [[a.ix, a.iy], [a.ox, a.oy]]) { const h = S(a.x + hx, a.y + hy); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(h.x, h.y); ctx.stroke(); ctx.beginPath(); ctx.arc(h.x, h.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); } });
  }

  /** Flat canvas colour: the page's chosen background, else the default dark / light grey. */
  private drawBackdrop(ctx: CanvasRenderingContext2D, dark: boolean) {
    const page = this.doc.nodes[this.ui.pageId];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = page?.canvasBg ?? (dark ? DEFAULT_CANVAS_DARK : DEFAULT_CANVAS_LIGHT);
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private path(ctx: CanvasRenderingContext2D, pts: Pt[]) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); }

  private drawOverlay(ctx: CanvasRenderingContext2D, dark: boolean) {
    const ui = this.ui, acc = this.accent;
    if (ui.vectorEdit && (!this.doc.nodes[ui.vectorEdit] || ui.selection[0] !== ui.vectorEdit)) { this.ui.set({ vectorEdit: null, vecSel: [] }); }
    if (ui.mode === 'prototype') this.drawConnections(ctx);
    // pen / pencil previews
    if (this.pen) this.drawPenPreview(ctx);
    if (this.pencil && this.pencil.length > 1) { const dop = this.ui.drawOpts[this.brush ? 'brush' : 'pencil']; ctx.strokeStyle = dop.color; ctx.lineWidth = Math.max(1, dop.size * this.ui.camera.zoom); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); this.pencil.forEach((q, i) => { const s = this.toScreen(q); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); ctx.stroke(); }
    if (this.lasso && this.lasso.length > 1) { ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = acc; ctx.lineWidth = 1.2; ctx.beginPath(); this.lasso.forEach((q, i) => { const sp = this.toScreen(q); if (i) ctx.lineTo(sp.x, sp.y); else ctx.moveTo(sp.x, sp.y); }); ctx.closePath(); ctx.fillStyle = 'rgba(79,70,229,.08)'; ctx.fill(); ctx.stroke(); ctx.restore(); }
    // frame titles
    this.titleRects = []; this.devRects = [];
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'bottom';
    for (const id of this.doc.nodes[ui.pageId].children) {
      const n = this.doc.nodes[id];
      if ((n.type !== 'FRAME' && n.type !== 'COMPONENT' && n.type !== 'COMPONENT_SET') || !n.visible) continue;
      const s = this.toScreen({ x: worldMatrix(this.doc, id)[4], y: worldMatrix(this.doc, id)[5] });
      const label = n.name.length > 40 ? n.name.slice(0, 39) + '…' : n.name;
      const tw = ctx.measureText(label).width;
      if (s.x > this.w || s.y < -20 || s.y > this.h + 20) continue;
      const selected = ui.selection.includes(id);
      ctx.fillStyle = isComp(n) ? COMP : selected ? acc : dark ? '#a8a3c8' : '#5d5780';
      ctx.fillText((n.type === 'COMPONENT' ? '◆ ' : n.type === 'COMPONENT_SET' ? '❖ ' : '') + label, s.x, s.y - 4);
      this.titleRects.push({ id, r: { x: s.x, y: s.y - 18, w: tw, h: 16 } });
      if (selected && ui.renaming !== id) { // Dev Mode toggle sits at the frame's top-right, above the edge
        const br = this.toScreen({ x: worldMatrix(this.doc, id)[4] + n.width, y: worldMatrix(this.doc, id)[5] });
        ctx.font = '600 13px ui-monospace, Menlo, monospace'; ctx.fillStyle = acc; ctx.textAlign = 'right'; ctx.fillText('</>', br.x, br.y - 4); ctx.textAlign = 'left'; ctx.font = '11px system-ui, sans-serif';
        this.devRects.push({ id, r: { x: br.x - 30, y: br.y - 20, w: 30, h: 18 } });
      }
      if (n.flowStart) { const lab = '▶ ' + n.flowStart; const bw = ctx.measureText(lab).width + 12; const bx = s.x + tw + 8; ctx.fillStyle = 'rgba(79,70,229,.18)'; ctx.beginPath(); ctx.roundRect(bx, s.y - 21, bw, 17, 8); ctx.fill(); ctx.fillStyle = acc; ctx.fillText(lab, bx + 6, s.y - 7); }
    }
    // hover
    if (ui.hoverId && !ui.selection.includes(ui.hoverId) && this.doc.nodes[ui.hoverId]) {
      ctx.strokeStyle = isComp(this.doc.nodes[ui.hoverId]) ? COMP : acc; ctx.lineWidth = 1.5; this.path(ctx, worldCorners(this.doc, ui.hoverId).map(p => this.toScreen(p))); ctx.stroke();
    }
    // vector edit overlay
    const ve = ui.vectorEdit ? this.doc.nodes[ui.vectorEdit] : null;
    if (ve?.path) {
      const W = worldMatrix(this.doc, ve.id), P = ve.path.points, cnt = P.length;
      const S = (x: number, y: number) => this.toScreen(apply(W, { x, y }));
      ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.beginPath();
      const s0 = S(P[0].x, P[0].y); ctx.moveTo(s0.x, s0.y);
      for (let i = 0; i < (ve.path.closed ? cnt : cnt - 1); i++) { const a = P[i], b = P[(i + 1) % cnt]; const c1 = S(a.x + a.ox, a.y + a.oy), c2 = S(b.x + b.ix, b.y + b.iy), e2 = S(b.x, b.y); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e2.x, e2.y); }
      if (ve.path.closed) ctx.closePath();
      ctx.stroke();
      for (const i of ui.vecSel) {
        const a = P[i]; if (!a) continue; const as = S(a.x, a.y);
        for (const [hx, hy] of [[a.ix, a.iy], [a.ox, a.oy]]) if (hx || hy) { const h = S(a.x + hx, a.y + hy); ctx.strokeStyle = acc; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(as.x, as.y); ctx.lineTo(h.x, h.y); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(h.x, h.y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      }
      P.forEach((a, i) => { const s = S(a.x, a.y); const on = ui.vecSel.includes(i); ctx.fillStyle = on ? acc : '#fff'; ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.beginPath(); if (isSmooth(a)) ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2); else ctx.rect(s.x - 4, s.y - 4, 8, 8); ctx.fill(); ctx.stroke(); });
    }
    // selection
    const tops = ui.vectorEdit ? [] : topLevelOnly(this.store, ui.selection);
    ctx.strokeStyle = acc; ctx.lineWidth = 1;
    for (const id of ui.selection) if (this.doc.nodes[id] && !isLineLike(this.doc.nodes[id])) { ctx.strokeStyle = isComp(this.doc.nodes[id]) ? COMP : acc; this.path(ctx, worldCorners(this.doc, id).map(p => this.toScreen(p))); ctx.stroke(); }
    ctx.strokeStyle = acc;
    const box = this.selectionBox();
    if (box && !ui.editingTextId) {
      const sc = box.corners.map(p => this.toScreen(p));
      const lineNode = box.single && ui.selection.length === 1 ? this.doc.nodes[ui.selection[0]] : undefined;
      if (isLineLike(lineNode)) { // ends only: a dot at the tail and at the tip
        const ends = lineNode!.type === 'LINE' ? [sc[0], sc[1]] : [0, 1].map(k => { const q = lineNode!.path!.points[k]; return this.toScreen(apply(worldMatrix(this.doc, lineNode!.id), { x: q.x, y: q.y })); });
        ctx.fillStyle = '#fff'; ctx.strokeStyle = acc; ctx.lineWidth = 1.5;
        for (const e of ends) { ctx.beginPath(); ctx.arc(e.x, e.y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        ctx.lineWidth = 1;
      } else {
      const tint = box.single && isComp(this.doc.nodes[tops[0]]) ? COMP : acc;
      if (!box.single) { this.path(ctx, sc); ctx.stroke(); }
      if (this.session.canEdit && ui.mode !== 'prototype' && (box.single || this.canResizeMulti(tops))) {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = tint;
        ctx.lineWidth = 1.5; this.handlePoints(box).map(q => this.toScreen(q)).forEach((p, i) => { if (i % 2 === 1) return; /* edge handles stay active but invisible, like Figma */ ctx.beginPath(); ctx.rect(p.x - 3.5, p.y - 3.5, 7, 7); ctx.fill(); ctx.stroke(); }); ctx.lineWidth = 1;
      }
      for (const h of this.radiusHandles() ?? []) { // corner-radius handles
        const s = this.toScreen(h.world);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      }
      // size label
      const b = box.single ? this.doc.nodes[tops[0]] : null;
      const chip = isComp(b ?? undefined) ? COMP : acc;
      const wpx = b ? b.width : box.rect.w, hpx = b ? b.height : box.rect.h;
      const label = `${Math.round(wpx)}  ×  ${Math.round(hpx)}`;
      const bs = boundsOfPoints(sc);
      ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = chip; ctx.beginPath(); ctx.roundRect(bs.x + bs.w / 2 - tw / 2, bs.y + bs.h + 8, tw, 20, 6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, bs.x + bs.w / 2, bs.y + bs.h + 18); ctx.textAlign = 'left';
    }
    // guides
    ctx.strokeStyle = '#f24822'; ctx.lineWidth = 1;
    for (const g of ui.guides) { const a = this.toScreen({ x: g.x1, y: g.y1 }), b = this.toScreen({ x: g.x2, y: g.y2 }); ctx.beginPath(); ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5); ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5); ctx.stroke(); }
    // marquee
    if (ui.marquee) {
      const a = this.toScreen({ x: ui.marquee.x, y: ui.marquee.y }), b = this.toScreen({ x: ui.marquee.x + ui.marquee.w, y: ui.marquee.y + ui.marquee.h });
      ctx.fillStyle = 'rgba(79,70,229,0.1)'; ctx.strokeStyle = acc; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
    }
  }
}
void setProps; void rad;
