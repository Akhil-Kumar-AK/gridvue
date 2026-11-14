import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { newId, alignPatches, centerOf, fitStroke, groupMembers, hitItem, itemBox, itemsInRect, makeItem, pick, resolveEnd, rotateAround, sectionAt, selectionBox, timerLeft, toLocal, votesUsed, SECTION_TITLE_H, tableSize, type BoardData, type Box, type End, type JamItem, type Pt, type Side } from '@layr/core';
import { JamStore, useJam, type Tool } from './store';
import { connectHandles, drawBoard, fitText, handlesFor, selectionFrame, type HandleKind } from './render';
import { useEditor } from '../editor/state';
import type { JamSession } from './session';

const MIN_ZOOM = 0.05, MAX_ZOOM = 8;
type Drag =
  | { t: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { t: 'move'; start: Pt; orig: Map<string, { x: number; y: number; pts?: number[] }>; ids: string[]; moved: boolean; box: Box; copy: boolean; clickId?: string }
  | { t: 'resize'; h: HandleKind; start: Pt; orig: Map<string, JamItem>; frame: { box: Box; rot: number }; ids: string[] }
  | { t: 'rotate'; center: Pt; startAng: number; orig: Map<string, JamItem>; ids: string[] }
  | { t: 'marquee'; start: Pt; base: string[]; additive: boolean }
  | { t: 'create'; tool: Tool; start: Pt }
  | { t: 'stroke'; id: string | null; pts: number[]; pen: 'pen' | 'marker' | 'highlighter' }
  | { t: 'erase'; hit: Set<string> }
  | { t: 'connector'; id: string; fromEnd: boolean; start: Pt; isNew: boolean }
  | { t: 'cp'; side: Exclude<Side, 'auto'>; from: string; start: Pt };

export interface CanvasApi {
  screenToWorld(p: Pt): Pt; worldToScreen(p: Pt): Pt; size(): { w: number; h: number };
  zoomTo(z: number, around?: Pt): void; fit(ids?: string[]): void; startEdit(id: string, cell?: [number, number]): void; place(items: JamItem[]): void; insertImage(file: File, at?: Pt): Promise<void>;
  viewportCenter(): Pt; repaint(): void; el(): HTMLCanvasElement | null; connectedCopy(id: string, side: Exclude<Side, 'auto'>): string | null;
}

function clampZoom(z: number) { return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)); }
function snapRound(n: number) { return Math.round(n); }

export function JamCanvas({ session, onApi }: { session: JamSession; onApi: (a: CanvasApi) => void }) {
  const store = session.store;
  useSyncExternalStore(store.subscribe, () => store.version);
  const ui = useJam(); const dark = useEditor(s => s.theme) === 'dark';
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const drag = useRef<Drag | null>(null);
  const draft = useRef<JamItem | null>(null);
  const connectHint = useRef<string | null>(null);
  const spaceDown = useRef(false); const raf = useRef(0); const now = useRef(Date.now());
  const readonly = session.role === 'viewer';
  const pointer = useRef<Pt>({ x: 0, y: 0 }); const apiRef = useRef<CanvasApi | null>(null);

  const cam = ui.camera;
  const toWorld = (p: Pt, c = useJam.getState().camera): Pt => ({ x: p.x / c.zoom + c.x, y: p.y / c.zoom + c.y });
  const toScreen = (p: Pt, c = useJam.getState().camera): Pt => ({ x: (p.x - c.x) * c.zoom, y: (p.y - c.y) * c.zoom });
  const local = (e: { clientX: number; clientY: number }): Pt => { const r = cv.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // ---------- painting ----------
  const paint = () => {
    raf.current = 0; const c = cv.current; if (!c) return; const g = c.getContext('2d'); if (!g) return;
    const s = useJam.getState(); const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(size.w * dpr) || c.height !== Math.round(size.h * dpr)) { c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr); }
    drawBoard(g, store.board, s.camera, size.w, size.h, { dark: useEditor.getState().theme === 'dark', dpr, selection: new Set(s.selection), hover: s.hover, editing: s.editing?.id ?? null, now: Date.now(), meId: s.me.id, chrome: true, marquee: s.marquee, guides: s.guides, onImage: request, connectHint: connectHint.current, draft: draft.current, hideEditingText: true });
  };
  const request = () => { if (!raf.current) raf.current = requestAnimationFrame(paint); };
  useLayoutEffect(request);
  useEffect(() => { const t = setInterval(() => { now.current = Date.now(); if (Object.values(store.board.items).some(i => i.kind === 'timer' && i.startedAt)) request(); }, 250); return () => clearInterval(t); }, [store]);
  useEffect(() => { const el = wrap.current!; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight }); return () => ro.disconnect(); }, []);

  // ---------- API for the shell ----------
  useEffect(() => {
    const api: CanvasApi = {
      screenToWorld: p => toWorld(p), worldToScreen: p => toScreen(p), size: () => ({ w: wrap.current?.clientWidth ?? 800, h: wrap.current?.clientHeight ?? 600 }),
      zoomTo: (z, around) => { const s = useJam.getState(); const a = around ?? { x: (wrap.current?.clientWidth ?? 800) / 2, y: (wrap.current?.clientHeight ?? 600) / 2 }; const w = toWorld(a, s.camera); const nz = clampZoom(z); s.set({ camera: { zoom: nz, x: w.x - a.x / nz, y: w.y - a.y / nz } }); },
      fit: ids => { const b = store.board; const box = selectionBox(b, ids?.length ? ids : b.order); const W = wrap.current?.clientWidth ?? 800, H = wrap.current?.clientHeight ?? 600; if (!box) { useJam.getState().set({ camera: { x: -W / 2, y: -H / 2, zoom: 1 } }); return; } const z = clampZoom(Math.min((W - 160) / Math.max(box.w, 1), (H - 220) / Math.max(box.h, 1), 1.5)); useJam.getState().set({ camera: { zoom: z, x: box.x + box.w / 2 - W / 2 / z, y: box.y + box.h / 2 - H / 2 / z } }); },
      startEdit: (id, cell) => useJam.getState().set({ editing: { id, cell }, selection: [id] }),
      place: items => { store.add(items); useJam.getState().set({ selection: items.filter(i => i.kind !== 'connector').map(i => i.id), tool: 'select' }); },
      viewportCenter: () => toWorld({ x: (wrap.current?.clientWidth ?? 800) / 2, y: (wrap.current?.clientHeight ?? 600) / 2 }),
      repaint: request, el: () => cv.current,
      insertImage: async (file, at) => {
        if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { useEditor.getState().toast('Only PNG, JPEG, GIF and WebP images can be added', 'error'); return; }
        const src = await shrinkImage(file); if (!src) { useEditor.getState().toast('That image is too large to embed', 'error'); return; }
        const im = new Image(); await new Promise<void>(r => { im.onload = () => r(); im.onerror = () => r(); im.src = src; });
        const k = Math.min(1, 480 / Math.max(im.naturalWidth || 1, im.naturalHeight || 1)); const w = Math.max(40, (im.naturalWidth || 240) * k), h = Math.max(40, (im.naturalHeight || 160) * k);
        const p = at ?? api.viewportCenter(); const it = makeItem('image', p.x - w / 2, p.y - h / 2, { w, h, src }); store.add([it], sectionAt(store.board, p)); useJam.getState().set({ selection: [it.id], tool: 'select' });
      },
      connectedCopy: (id, side) => connectedCopy(store, id, side),
    };
    apiRef.current = api; onApi(api);
  }, [store, size.w, size.h]);

  // ---------- helpers ----------
  const tolW = () => 5 / useJam.getState().camera.zoom;
  const expandSel = (ids: string[]) => { const out = new Set<string>(); for (const i of ids) for (const m of groupMembers(store.board, i)) out.add(m); return [...out]; };
  const hitHandle = (p: Pt): HandleKind | null => {
    const s = useJam.getState(); if (readonly || s.editing) return null;
    for (const h of handlesFor(store.board, s.selection, s.camera.zoom)) { const sp = toScreen(h.p, s.camera), q = toScreen(p, s.camera); if (Math.hypot(sp.x - q.x, sp.y - q.y) <= (h.kind === 'rot' ? 9 : 8)) return h.kind; }
    return null;
  };
  const hitConnectHandle = (p: Pt) => { const s = useJam.getState(); if (readonly || s.editing) return null; for (const h of connectHandles(store.board, s.selection, s.camera.zoom)) { const sp = toScreen(h.p, s.camera), q = toScreen(p, s.camera); if (Math.hypot(sp.x - q.x, sp.y - q.y) <= 11) return h; } return null; };
  const hitTarget = (p: Pt, skip?: Set<string>): string | null => { const b = store.board; for (let i = b.order.length - 1; i >= 0; i--) { const it = b.items[b.order[i]]; if (!it || it.kind === 'connector' || it.kind === 'stroke' || skip?.has(it.id)) continue; if (it.kind === 'section') { const q = toLocal(it, p); if (q.x >= it.x && q.x <= it.x + Math.min(it.w, 260) && q.y >= it.y - SECTION_TITLE_H && q.y <= it.y) return it.id; continue; } if (hitItem(b, it, p, 8 / useJam.getState().camera.zoom)) return it.id; } return null; };

  // ---------- pointer ----------
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault(); // keep focus where the tool put it (e.g. a freshly opened text editor)
    if (useJam.getState().editing) { useJam.getState().set({ editing: null }); }
    cv.current!.setPointerCapture(e.pointerId);
    const s = useJam.getState(); const sp = local(e), p = toWorld(sp); pointer.current = p;
    if (e.button === 1 || s.tool === 'hand' || spaceDown.current) { drag.current = { t: 'pan', sx: sp.x, sy: sp.y, cx: s.camera.x, cy: s.camera.y }; return; }
    if (e.button === 2) { // keep multi-selection when right-clicking inside it, otherwise select what is under the pointer
      const id = pick(store.board, p, tolW()); if (id && !s.selection.includes(id)) s.set({ selection: expandSel([id]) }); else if (!id) s.set({ selection: [] }); return;
    }
    if (e.button !== 0) return;
    if (s.panel) s.set({ panel: null });
    if (readonly) { if (s.tool === 'comment') s.set({ composer: { x: p.x, y: p.y } }); else startMarquee(p, e.shiftKey); return; }
    const tool = s.tool;
    if (tool === 'select') {
      const ch = hitConnectHandle(p); if (ch) { drag.current = { t: 'cp', side: ch.side, from: s.selection[0], start: p }; return; }
      const hk = hitHandle(p);
      if (hk) {
        const ids = s.selection;
        if (hk === 'from' || hk === 'to') { store.begin(); drag.current = { t: 'connector', id: ids[0], fromEnd: hk === 'from', start: p, isNew: false }; return; }
        const orig = new Map<string, JamItem>(); for (const id of ids) orig.set(id, structuredClone(store.board.items[id]));
        if (hk === 'rot') { const f = selectionFrame(store.board, ids)!; const c = { x: f.box.x + f.box.w / 2, y: f.box.y + f.box.h / 2 }; store.begin(); drag.current = { t: 'rotate', center: c, startAng: Math.atan2(p.y - c.y, p.x - c.x), orig, ids }; return; }
        const f = selectionFrame(store.board, ids)!; store.begin(); drag.current = { t: 'resize', h: hk, start: p, orig, frame: { box: f.box, rot: f.rot }, ids }; return;
      }
      const id = pick(store.board, p, tolW());
      if (id) {
        const it = store.board.items[id];
        if (it.kind === 'timer' && !it.locked) { const q = toLocal(it, p); if (q.x - it.x < 58 && q.y - it.y < it.h - 20) { toggleTimer(store, it); return; } if (q.x - it.x > it.w - 52 && q.y - it.y < it.h - 20) { store.patch([id], { startedAt: null, pausedLeft: null }); return; } }
        let sel = s.selection;
        if (e.shiftKey) sel = sel.includes(id) ? sel.filter(i => !expandSel([id]).includes(i)) : [...sel, ...expandSel([id])];
        else if (!sel.includes(id)) sel = expandSel([id]);
        s.set({ selection: sel });
        if (e.shiftKey && !sel.includes(id)) return;
        const movable = sel.filter(i => !store.board.items[i]?.locked);
        if (!movable.length) return;
        // sections carry what is parked on them
        const all = new Set(movable); for (const m of movable) if (store.board.items[m].kind === 'section') for (const c of Object.values(store.board.items)) if (c.parent === m) all.add(c.id);
        const orig = new Map<string, { x: number; y: number; pts?: number[] }>(); for (const m of all) { const o = store.board.items[m]; orig.set(m, { x: o.x, y: o.y }); }
        store.begin(); drag.current = { t: 'move', start: p, orig, ids: [...all], moved: false, box: selectionBox(store.board, [...all])!, copy: e.altKey, clickId: !e.shiftKey && s.selection.length > 1 && s.selection.includes(id) ? id : undefined };
        return;
      }
      startMarquee(p, e.shiftKey); return;
    }
    if (tool === 'sticky') { const it = makeItem('sticky', p.x - 84, p.y - 84, { color: s.stickyColor, author: s.me.name }); store.add([it], sectionAt(store.board, p)); s.set({ selection: [it.id], editing: { id: it.id }, tool: 'select' }); return; }
    if (tool === 'text') { const it = makeItem('text', p.x, p.y - 12, { text: '' }); store.add([it], sectionAt(store.board, p)); s.set({ selection: [it.id], editing: { id: it.id }, tool: 'select' }); return; }
    if (tool === 'table') { const it = makeItem('table', p.x - 180, p.y - 60); store.add([it], sectionAt(store.board, p)); s.set({ selection: [it.id], tool: 'select' }); return; }
    if (tool === 'code') { const it = makeItem('code', p.x - 180, p.y - 90); store.add([it], sectionAt(store.board, p)); s.set({ selection: [it.id], editing: { id: it.id }, tool: 'select' }); return; }
    if (tool === 'link') { const it = makeItem('link', p.x - 140, p.y - 36, { url: 'https://', text: '' }); store.add([it], sectionAt(store.board, p)); s.set({ selection: [it.id], tool: 'select' }); window.dispatchEvent(new CustomEvent('jam:edit-link', { detail: it.id })); return; }
    if (tool === 'stamp') { const it = makeItem('emoji', p.x - 28, p.y - 28, { emoji: s.stamp }); store.add([it], sectionAt(store.board, p)); return; }
    if (tool === 'comment') { const id = pick(store.board, p, tolW()); s.set({ composer: { x: p.x, y: p.y, itemId: id ?? undefined } }); return; }
    if (tool === 'vote') { const id = pick(store.board, p, tolW()); if (id) castVote(store, id, e.altKey); return; }
    if (tool === 'shape' || tool === 'section') { store.begin(); drag.current = { t: 'create', tool, start: p }; draft.current = makeItem(tool === 'shape' ? 'shape' : 'section', p.x, p.y, tool === 'shape' ? { shape: s.shape, color: s.shapeFill, w: 1, h: 1 } : { w: 1, h: 1 }); request(); return; }
    if (tool === 'connector') {
      const t = hitTarget(p); const c = makeItem('connector', p.x, p.y, { route: s.route, capEnd: s.connArrow ? 'arrow' : 'none', from: t ? { id: t, side: 'auto' } : { x: p.x, y: p.y }, to: { x: p.x, y: p.y } });
      store.begin(); store.change(b => { b.items[c.id] = c; b.order.push(c.id); }); s.set({ selection: [c.id] });
      drag.current = { t: 'connector', id: c.id, fromEnd: false, start: p, isNew: true }; return;
    }
    if (tool === 'pen' || tool === 'marker' || tool === 'highlighter') {
      drag.current = { t: 'stroke', id: null, pts: [p.x, p.y], pen: tool }; draft.current = makeItem('stroke', p.x, p.y, { pen: tool, stroke: s.penColor, strokeW: s.penWidth, pts: [0, 0] }); request(); return;
    }
    if (tool === 'eraser') { drag.current = { t: 'erase', hit: new Set() }; eraseAt(p); return; }
  };
  const startMarquee = (p: Pt, additive: boolean) => { const s = useJam.getState(); drag.current = { t: 'marquee', start: p, base: additive ? s.selection : [], additive }; if (!additive) s.set({ selection: [] }); };
  const eraseAt = (p: Pt) => { const d = drag.current; if (d?.t !== 'erase') return; const id = pick(store.board, p, 6 / useJam.getState().camera.zoom); if (id && store.board.items[id].kind === 'stroke' && !store.board.items[id].locked) { d.hit.add(id); draft.current = null; store.change(b => { delete b.items[id]; }); } };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = useJam.getState(); const sp = local(e), p = toWorld(sp); pointer.current = p; const d = drag.current;
    if (!d) {
      if (s.tool === 'select') { const id = pick(store.board, p, tolW()); if (id !== s.hover) s.set({ hover: id }); const hk = readonly ? null : hitHandle(p); const ch = hk ? null : hitConnectHandle(p); cv.current!.style.cursor = hk ? (hk === 'rot' ? 'grab' : hk === 'from' || hk === 'to' ? 'crosshair' : 'nwse-resize') : ch ? 'pointer' : id ? 'move' : 'default'; }
      else if (s.hover) s.set({ hover: null });
      if (s.tool === 'connector') { const t = hitTarget(p); if (t !== connectHint.current) { connectHint.current = t; request(); } }
      return;
    }
    if (d.t === 'pan') { s.set({ camera: { ...s.camera, x: d.cx - (sp.x - d.sx) / s.camera.zoom, y: d.cy - (sp.y - d.sy) / s.camera.zoom } }); return; }
    if (d.t === 'marquee') {
      const box: Box = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
      const hit = itemsInRect(store.board, box); s.set({ marquee: box, selection: expandSel([...new Set([...d.base, ...hit])]) }); return;
    }
    if (d.t === 'move') {
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * s.camera.zoom < 3) return;
      if (!d.moved) { d.moved = true; if (d.copy) { const cl = JamStore.clone(store.board, d.ids); store.change(b => { for (const c of cl) { b.items[c.id] = c; b.order.push(c.id); } }); /* the originals stay; the copies are dragged */ const map = new Map<string, { x: number; y: number }>(); cl.forEach((c, i) => map.set(c.id, { x: c.x, y: c.y })); d.orig = map; d.ids = cl.map(c => c.id); useJam.getState().set({ selection: cl.filter(c => c.kind !== 'connector').map(c => c.id) }); } }
      if (!e.metaKey && !e.ctrlKey) { const sn = snapMove(store.board, d.ids, d.box, dx, dy, 6 / s.camera.zoom); dx = sn.dx; dy = sn.dy; useJam.getState().guides.length !== sn.guides.length || sn.guides.length ? s.set({ guides: sn.guides }) : 0; }
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      store.change(b => { for (const id of d.ids) { const o = d.orig.get(id)!, it = b.items[id]; if (it) { it.x = o.x + dx; it.y = o.y + dy; } } });
      // hover a section to show where the item will land
      return;
    }
    if (d.t === 'resize') { store.change(b => resizeItems(b, d, p, e.shiftKey, e.altKey)); return; }
    if (d.t === 'rotate') {
      const ang = Math.atan2(p.y - d.center.y, p.x - d.center.x); let da = ((ang - d.startAng) * 180) / Math.PI; if (e.shiftKey) da = Math.round(da / 15) * 15;
      store.change(b => { for (const id of d.ids) { const o = d.orig.get(id)!, it = b.items[id]; if (!it || it.kind === 'connector') continue; const c = centerOf(o); const nc = rotateAround(c, d.center, da); it.x = nc.x - o.w / 2; it.y = nc.y - o.h / 2; it.rot = (((o.rot + da) % 360) + 360) % 360; if (e.shiftKey && d.ids.length === 1) it.rot = Math.round(it.rot / 15) * 15 % 360; } }); return;
    }
    if (d.t === 'create') {
      const x = Math.min(d.start.x, p.x), y = Math.min(d.start.y, p.y); let w = Math.abs(p.x - d.start.x), h = Math.abs(p.y - d.start.y);
      if (e.shiftKey && d.tool === 'shape') w = h = Math.max(w, h);
      if (draft.current) Object.assign(draft.current, { x: e.shiftKey && d.tool === 'shape' ? (p.x < d.start.x ? d.start.x - w : d.start.x) : x, y: e.shiftKey && d.tool === 'shape' ? (p.y < d.start.y ? d.start.y - h : d.start.y) : y, w, h }); request(); return;
    }
    if (d.t === 'stroke') {
      const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent]; for (const ev of evs.length ? evs : [e.nativeEvent]) { const q = toWorld(local(ev)); const lx = d.pts[d.pts.length - 2], ly = d.pts[d.pts.length - 1]; if (Math.hypot(q.x - lx, q.y - ly) * s.camera.zoom >= 2.5) d.pts.push(q.x, q.y); }
      if (e.shiftKey && d.pts.length >= 4) { d.pts.length = 2; d.pts.push(p.x, p.y); }
      if (draft.current) { draft.current.pts = d.pts.map((v, i) => v - (i % 2 ? d.pts[1] : d.pts[0])); } request(); return;
    }
    if (d.t === 'erase') { eraseAt(p); return; }
    if (d.t === 'connector') {
      const skip = new Set([d.id]); const other = store.board.items[d.id][d.fromEnd ? 'to' : 'from']!; if (other.id) skip.add('');
      const t = hitTarget(p, other.id && !d.isNew ? new Set([d.id]) : skip); connectHint.current = t;
      store.change(b => { const c = b.items[d.id]; c[d.fromEnd ? 'from' : 'to'] = t ? { id: t, side: 'auto' } : { x: snapRound(p.x), y: snapRound(p.y) }; }); return;
    }
    if (d.t === 'cp') {
      const dist = Math.hypot(p.x - d.start.x, p.y - d.start.y) * s.camera.zoom;
      if (dist > 6 && !draft.current) { store.begin(); const c = makeItem('connector', 0, 0, { route: s.route, from: { id: d.from, side: d.side }, to: { x: p.x, y: p.y } }); store.change(b => { b.items[c.id] = c; b.order.push(c.id); }); drag.current = { t: 'connector', id: c.id, fromEnd: false, start: p, isNew: true }; s.set({ selection: [c.id] }); }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = useJam.getState(); const d = drag.current; drag.current = null; try { cv.current!.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    const p = toWorld(local(e));
    if (!d) return;
    s.set({ marquee: null, guides: [] }); connectHint.current = null;
    if (d.t === 'cp') { const id = connectedCopy(store, d.from, d.side, false); // a click duplicates the item on that side; dragging draws a connector instead
       if (id) s.set({ selection: [id], editing: { id } }); return; }
    if (d.t === 'move') {
      if (d.moved) { // drop into / out of sections
        const sel = d.ids.map(i => store.board.items[i]).filter(i => i && i.kind !== 'section' && i.kind !== 'connector' && !d.ids.includes(i.parent ?? ''));
        store.change(b => { for (const it of sel) { const c = centerOf(b.items[it.id]); const sid = sectionAt(b, c, new Set(d.ids)); if (sid) b.items[it.id].parent = sid; else delete b.items[it.id].parent; } });
      }
      else if (d.clickId) s.set({ selection: expandSel([d.clickId]) }); // a plain click inside a multi-selection narrows it
      store.end(); return;
    }
    if (d.t === 'create') {
      const dr = draft.current; draft.current = null; let b: Box = dr ? { x: dr.x, y: dr.y, w: dr.w, h: dr.h } : { x: p.x, y: p.y, w: 0, h: 0 };
      const click = Math.max(b.w, b.h) * s.camera.zoom < 6;
      if (d.tool === 'shape') { const it = makeItem('shape', click ? p.x - 70 : b.x, click ? p.y - 50 : b.y, { shape: s.shape, color: s.shapeFill, w: click ? 140 : Math.max(24, b.w), h: click ? 100 : Math.max(24, b.h) }); store.add([it], sectionAt(store.board, centerOf(it))); s.set({ selection: [it.id], editing: { id: it.id }, tool: 'select' }); }
      else { const it = makeItem('section', click ? p.x - 240 : b.x, click ? p.y - 160 : b.y, { w: click ? 480 : Math.max(80, b.w), h: click ? 320 : Math.max(60, b.h) }); store.add([it]); // adopt items that sit inside it
        store.change(bd => { for (const o of Object.values(bd.items)) if (o.id !== it.id && o.kind !== 'connector' && o.kind !== 'section' && !o.parent) { const c = centerOf(o); if (c.x >= it.x && c.x <= it.x + it.w && c.y >= it.y && c.y <= it.y + it.h) o.parent = it.id; } });
        s.set({ selection: [it.id], editing: { id: it.id }, tool: 'select' }); }
      store.end(); request(); return;
    }
    if (d.t === 'stroke') {
      const dr = draft.current; draft.current = null;
      if (dr && d.pts.length >= 2) { const it = fitStroke({ ...dr, x: 0, y: 0, pts: d.pts }); store.add([it], sectionAt(store.board, centerOf(it))); }
      request(); return;
    }
    if (d.t === 'erase') { store.end(); return; }
    if (d.t === 'connector') {
      const c = store.board.items[d.id];
      if (c && d.isNew) { const dist = Math.hypot(((c.to!.x ?? 0) - (c.from!.x ?? 0)), ((c.to!.y ?? 0) - (c.from!.y ?? 0))); if (!c.from!.id && !c.to!.id && dist < 8) store.change(b => { delete b.items[d.id]; }); else s.set({ tool: 'select' }); }
      store.end(); return;
    }
    if (d.t === 'resize' || d.t === 'rotate') { store.end(); return; }
    if (d.t === 'marquee') { return; }
  };

  const onDouble = (e: React.MouseEvent) => {
    if (readonly) return; const s = useJam.getState(); if (s.tool !== 'select') return; const p = toWorld(local(e)); const id = pick(store.board, p, tolW());
    if (!id) { const it = makeItem('text', p.x, p.y - 12, { text: '' }); store.add([it], sectionAt(store.board, p)); s.set({ selection: [it.id], editing: { id: it.id } }); return; }
    const it = store.board.items[id];
    if (it.locked) return;
    if (it.kind === 'table') { const q = toLocal(it, p); let x = it.x, c = 0; for (; c < it.colW!.length - 1 && q.x > x + it.colW![c]; c++) x += it.colW![c]; let y = it.y, r = 0; for (; r < it.rowH!.length - 1 && q.y > y + it.rowH![r]; r++) y += it.rowH![r]; s.set({ editing: { id, cell: [r, c] } }); return; }
    if (it.kind === 'link') { window.dispatchEvent(new CustomEvent('jam:edit-link', { detail: id })); return; }
    if (['sticky', 'shape', 'text', 'section', 'connector', 'code'].includes(it.kind)) s.set({ editing: { id }, selection: [id] });
    if (it.kind === 'emoji' || it.kind === 'image') return;
  };

  // wheel: pinch / ctrl = zoom, otherwise pan
  useEffect(() => {
    const el = cv.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); const s = useJam.getState(); const sp = local(e);
      if (e.ctrlKey || e.metaKey) { const w = toWorld(sp, s.camera); const nz = clampZoom(s.camera.zoom * Math.exp(-e.deltaY * 0.01)); s.set({ camera: { zoom: nz, x: w.x - sp.x / nz, y: w.y - sp.y / nz } }); }
      else s.set({ camera: { ...s.camera, x: s.camera.x + (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) / s.camera.zoom, y: s.camera.y + (e.shiftKey && !e.deltaX ? 0 : e.deltaY) / s.camera.zoom } });
    };
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => { // space = temporary hand
    const dn = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable))) { spaceDown.current = true; if (cv.current) cv.current.style.cursor = 'grab'; e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { spaceDown.current = false; if (cv.current) cv.current.style.cursor = ''; } };
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up); return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);
  // drag & drop images
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/')); if (f && !readonly) { const w = toWorld(local(e)); void apiRef.current?.insertImage(f, w); } };

  const cursor = ui.tool === 'hand' ? 'grab' : ui.tool === 'select' ? 'default' : ui.tool === 'eraser' ? 'cell' : 'crosshair';
  void cam; void now; void timerLeft; void votesUsed; void alignPatches; void itemBox; void resolveEnd; void tableSize;
  return (
    <div className="jam-canvas" ref={wrap} onDragOver={e => e.preventDefault()} onDrop={onDrop}>
      <canvas ref={cv} style={{ width: size.w, height: size.h, cursor }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={onDouble} onContextMenu={e => e.preventDefault()} aria-label="Whiteboard canvas" data-testid="jam-canvas" />
    </div>
  );
}

// ---------- geometry operations ----------
function snapMove(b: BoardData, ids: string[], box: Box, dx: number, dy: number, tol: number) {
  const guides: { x?: number; y?: number }[] = []; const skip = new Set(ids);
  const xs: number[] = [], ys: number[] = [];
  for (const id of b.order) { if (skip.has(id)) continue; const it = b.items[id]; if (it.kind === 'connector' || it.kind === 'stroke') continue; const bb = itemBox(b, it); xs.push(bb.x, bb.x + bb.w / 2, bb.x + bb.w); ys.push(bb.y, bb.y + bb.h / 2, bb.y + bb.h); }
  const mx = [box.x + dx, box.x + dx + box.w / 2, box.x + dx + box.w], my = [box.y + dy, box.y + dy + box.h / 2, box.y + dy + box.h];
  let bx = tol + 1, by = tol + 1, gx: number | undefined, gy: number | undefined;
  for (const a of mx) for (const t of xs) if (Math.abs(a - t) < Math.abs(bx)) { bx = t - a; gx = t; }
  for (const a of my) for (const t of ys) if (Math.abs(a - t) < Math.abs(by)) { by = t - a; gy = t; }
  if (Math.abs(bx) <= tol) { dx += bx; guides.push({ x: gx }); }
  if (Math.abs(by) <= tol) { dy += by; guides.push({ y: gy }); }
  return { dx, dy, guides };
}

function resizeItems(b: BoardData, d: Extract<Drag, { t: 'resize' }>, p: Pt, shift: boolean, alt: boolean) {
  const { box, rot } = d.frame; const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const q = rot ? rotateAround(p, c, -rot) : p; // pointer in the frame's own axes
  let x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h; const h = d.h;
  if (h.includes('w')) x0 = Math.min(q.x, x1 - 8); if (h.includes('e')) x1 = Math.max(q.x, x0 + 8);
  if (h.includes('n')) y0 = Math.min(q.y, y1 - 8); if (h.includes('s')) y1 = Math.max(q.y, y0 + 8);
  if (alt) { const dx = h.includes('w') ? box.x - x0 : h.includes('e') ? x1 - (box.x + box.w) : 0, dy = h.includes('n') ? box.y - y0 : h.includes('s') ? y1 - (box.y + box.h) : 0; x0 = box.x - dx; x1 = box.x + box.w + dx; y0 = box.y - dy; y1 = box.y + box.h + dy; }
  const lock = shift || d.ids.some(i => { const k = d.orig.get(i)!.kind; return k === 'sticky' || k === 'emoji' || k === 'image' || k === 'stroke'; }) && h.length === 2;
  if (lock && h.length === 2) { const sx = (x1 - x0) / box.w, sy = (y1 - y0) / box.h, sc = Math.max(sx, sy); const nw = box.w * sc, nh = box.h * sc; if (h.includes('w')) x0 = x1 - nw; else x1 = x0 + nw; if (h.includes('n')) y0 = y1 - nh; else y1 = y0 + nh; }
  // new frame centre/size in world; map each item proportionally
  const nb: Box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; const sx = nb.w / box.w, sy = nb.h / box.h; const nc = { x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 }; const ncw = rot ? rotateAround(nc, c, rot) : nc;
  const shiftC = rot ? { x: ncw.x - nc.x, y: ncw.y - nc.y } : { x: 0, y: 0 };
  for (const id of d.ids) {
    const o = d.orig.get(id)!, it = b.items[id]; if (!it || it.kind === 'connector') continue;
    if (d.ids.length === 1 && o.kind !== 'stroke') {
      it.x = nb.x + shiftC.x; it.y = nb.y + shiftC.y; it.w = nb.w; it.h = nb.h;
      if (rot) { // keep the anchor corner fixed: recompute from rotated centre
        const cc = rotateAround({ x: nb.x + nb.w / 2, y: nb.y + nb.h / 2 }, c, rot); it.x = cc.x - nb.w / 2; it.y = cc.y - nb.h / 2;
      }
      if (it.kind === 'text') { it.fixedW = true; it.h = fitText({ ...it, w: nb.w, fixedW: true }).h; }
      if (it.kind === 'table') { const f = nb.w / (o.w || 1), g = nb.h / (o.h || 1); it.colW = o.colW!.map(v => Math.max(20, v * f)); it.rowH = o.rowH!.map(v => Math.max(20, v * g)); const t = tableSize(it); it.w = t.w; it.h = t.h; }
      if (it.kind === 'sticky') it.h = it.w = Math.max(60, Math.max(nb.w, nb.h));
    } else if (o.kind === 'stroke') {
      const nx = nb.x + (o.x - box.x) * sx, ny = nb.y + (o.y - box.y) * sy; it.x = nx; it.y = ny; it.w = o.w * sx; it.h = o.h * sy; it.pts = o.pts!.map((v, i) => (i % 2 ? v * sy : v * sx));
    } else { const nx = nb.x + (o.x - box.x) * sx, ny = nb.y + (o.y - box.y) * sy; it.x = nx; it.y = ny; it.w = Math.max(8, o.w * sx); it.h = Math.max(8, o.h * sy); if (it.kind === 'sticky') it.h = it.w; if (it.kind === 'table') { it.colW = o.colW!.map(v => v * sx); it.rowH = o.rowH!.map(v => v * sy); const t = tableSize(it); it.w = t.w; it.h = t.h; } }
  }
}

export function toggleTimer(store: JamStore, it: JamItem) {
  const left = timerLeft(it, Date.now());
  if (it.startedAt && left > 0) store.patch([it.id], { startedAt: null, pausedLeft: left });
  else store.patch([it.id], { startedAt: Date.now(), pausedLeft: left > 0 ? left : it.duration });
}
export function castVote(store: JamStore, id: string, remove: boolean) {
  const ui = useJam.getState(); const b = store.board; const uid = ui.me.id; const it = b.items[id]; if (!it || it.kind === 'connector') return;
  const cur = it.votes?.[uid] ?? 0;
  if (remove) { if (cur > 0) store.change(bd => { const v = bd.items[id].votes ??= {}; v[uid] = cur - 1; if (!v[uid]) delete v[uid]; if (!Object.keys(v).length) delete bd.items[id].votes; }); return; }
  if (!b.voting?.active) { useEditor.getState().toast('Start a voting session first (More → Voting)', 'error'); return; }
  if (votesUsed(b, uid) >= b.voting.perUser) { useEditor.getState().toast(`You have used all ${b.voting.perUser} votes`, 'error'); return; }
  store.change(bd => { (bd.items[id].votes ??= {})[uid] = cur + 1; });
}

/** New item of the same kind next to `id`; with `connect` it is joined by a connector (Tab). The side "+" handles pass connect=false. */
export function connectedCopy(store: JamStore, id: string, side: Exclude<Side, 'auto'>, connect = true): string | null {
  const src = store.board.items[id]; if (!src) return null;
  const gap = 90, dir = { t: [0, -1], r: [1, 0], b: [0, 1], l: [-1, 0] }[side];
  const copy = makeItem(src.kind === 'text' ? 'shape' : src.kind, src.x + dir[0] * (src.w + gap), src.y + dir[1] * (src.h + gap), src.kind === 'text' ? { shape: 'round', w: 140, h: 70 } : { ...structuredClone(src), id: undefined as unknown as string, text: '', group: undefined, votes: undefined, rot: 0 });
  copy.id = newId('j'); copy.rot = 0; delete copy.group; delete copy.votes; delete copy.parent;
  copy.x = src.x + dir[0] * (src.w + gap); copy.y = src.y + dir[1] * (src.h + gap); copy.text = '';
  const opp: Record<string, Exclude<Side, 'auto'>> = { t: 'b', b: 't', l: 'r', r: 'l' };
  const c = makeItem('connector', 0, 0, { route: useJam.getState().route, from: { id, side }, to: { id: copy.id, side: opp[side] } });
  store.begin(); store.add([copy], src.parent ?? null); if (connect) store.change(b => { b.items[c.id] = c; b.order.push(c.id); }); store.end();
  return copy.id;
}

async function shrinkImage(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const im = new Image(); await new Promise<void>((res, rej) => { im.onload = () => res(); im.onerror = () => rej(new Error('bad image')); im.src = url; });
    const max = 1600, k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k)); c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
    const type = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp' ? 'image/png' : 'image/jpeg';
    let out = c.toDataURL(type, 0.85); if (out.length > 2_800_000) out = c.toDataURL('image/jpeg', 0.7);
    return out.length <= 2_800_000 ? out : null;
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}
export type { End };
