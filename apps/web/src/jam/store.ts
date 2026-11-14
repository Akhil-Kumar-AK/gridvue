import { create } from 'zustand';
import { centerOf, newId, resolveEnd, validateBoard, type BoardData, type Box, type JamItem, type Pt, type ShapeKind, type Route, type PenKind } from '@layr/core';

export type Tool = 'select' | 'hand' | 'sticky' | 'shape' | 'connector' | 'text' | 'pen' | 'marker' | 'highlighter' | 'eraser' | 'section' | 'stamp' | 'table' | 'code' | 'comment' | 'vote' | 'link';

/** Board document with snapshot undo/redo. Mutations happen in place inside change(); a gesture groups many changes into one undo step. */
export class JamStore {
  board: BoardData; version = 0;
  private undoStack: string[] = []; private redoStack: string[] = [];
  private listeners = new Set<() => void>(); onChange: (() => void) | null = null;
  private gesture: { before: string; changed: boolean } | null = null;
  constructor(board: BoardData) { this.board = board; }
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  private emit(userEdit: boolean) { this.version++; this.listeners.forEach(l => l()); if (userEdit) this.onChange?.(); }
  get canUndo() { return this.undoStack.length > 0; } get canRedo() { return this.redoStack.length > 0; }

  begin() { if (!this.gesture) this.gesture = { before: JSON.stringify(this.board), changed: false }; }
  end() { const g = this.gesture; this.gesture = null; if (g?.changed) { this.undoStack.push(g.before); if (this.undoStack.length > 100) this.undoStack.shift(); this.redoStack = []; } }
  change(fn: (b: BoardData) => void) {
    const own = !this.gesture; if (own) this.begin();
    fn(this.board); this.cleanup(); this.gesture!.changed = true;
    if (own) this.end();
    this.emit(true);
  }
  /** Drop dangling references after any edit. */
  private cleanup() {
    const b = this.board;
    b.order = b.order.filter(id => b.items[id]);
    for (const id of Object.keys(b.items)) if (!b.order.includes(id)) delete b.items[id];
    for (const it of Object.values(b.items)) {
      if (it.parent && b.items[it.parent]?.kind !== 'section') delete it.parent;
      if (it.kind === 'connector') for (const e of [it.from!, it.to!]) if (e.id && !b.items[e.id]) { delete e.id; delete e.side; }
    }
    b.comments = b.comments.filter(c => !c.itemId || b.items[c.itemId]);
  }
  undo() { const s = this.undoStack.pop(); if (!s) return false; this.redoStack.push(JSON.stringify(this.board)); this.board = JSON.parse(s); this.emit(true); return true; }
  redo() { const s = this.redoStack.pop(); if (!s) return false; this.undoStack.push(JSON.stringify(this.board)); this.board = JSON.parse(s); this.emit(true); return true; }
  replaceVersion() { this.emit(false); }
  replace(b: BoardData) { this.board = b; this.undoStack = []; this.redoStack = []; this.emit(false); }

  // ---- helpers ----
  add(items: JamItem[], parent?: string | null) { this.change(b => { for (const it of items) { if (parent && it.kind !== 'section' && it.kind !== 'connector') it.parent = parent; b.items[it.id] = it; b.order.push(it.id); } }); }
  patch(ids: string[], p: Partial<JamItem> | ((it: JamItem) => Partial<JamItem>)) { this.change(b => { for (const id of ids) { const it = b.items[id]; if (it) Object.assign(it, typeof p === 'function' ? p(it) : p); } }); }
  remove(ids: string[]) {
    this.change(b => {
      const dead = new Set(ids);
      for (const it of Object.values(b.items)) if (it.kind === 'connector' && !dead.has(it.id)) { // keep connectors, freeing the ends that pointed at removed items
        for (const k of ['from', 'to'] as const) { const e = it[k]!; if (e.id && dead.has(e.id)) { const other = it[k === 'from' ? 'to' : 'from']!; const a = resolveEnd(b, e, other.id && b.items[other.id] ? centerOf(b.items[other.id]) : { x: other.x ?? 0, y: other.y ?? 0 }); it[k] = { x: a.p.x, y: a.p.y }; } }
      }
      for (const id of ids) { delete b.items[id]; }
    });
  }
  reorder(ids: string[], how: 'front' | 'back' | 'forward' | 'backward') {
    this.change(b => {
      const set = new Set(ids); const rest = b.order.filter(i => !set.has(i)), mine = b.order.filter(i => set.has(i));
      if (how === 'front') b.order = [...rest, ...mine]; else if (how === 'back') b.order = [...mine, ...rest];
      else { const o = [...b.order]; const idxs = mine.map(i => o.indexOf(i)); if (how === 'forward') for (const i of idxs.reverse()) { if (i < o.length - 1 && !set.has(o[i + 1])) [o[i], o[i + 1]] = [o[i + 1], o[i]]; } else for (const i of idxs) { if (i > 0 && !set.has(o[i - 1])) [o[i], o[i - 1]] = [o[i - 1], o[i]]; } b.order = o; }
    });
  }
  /** Copies of items with fresh ids; connectors keep links only to items inside the copied set. */
  static clone(b: BoardData, ids: string[], dx = 0, dy = 0): JamItem[] {
    const set = new Set(ids), map = new Map<string, string>();
    const src = b.order.filter(i => set.has(i)).map(i => b.items[i]);
    for (const s of src) map.set(s.id, newId('j'));
    const gmap = new Map<string, string>();
    return src.map(s => {
      const c: JamItem = structuredClone(s); c.id = map.get(s.id)!; c.x += dx; c.y += dy;
      if (c.group) { if (!gmap.has(c.group)) gmap.set(c.group, newId('g')); c.group = gmap.get(c.group); }
      if (c.parent) { if (map.has(c.parent)) c.parent = map.get(c.parent); else delete c.parent; }
      if (c.kind === 'connector') for (const k of ['from', 'to'] as const) { const e = c[k]!; if (e.id && map.has(e.id)) e.id = map.get(e.id)!; else if (e.id) { const a = resolveEnd(b, e, { x: 0, y: 0 }); c[k] = { x: a.p.x + dx, y: a.p.y + dy }; } else { e.x = (e.x ?? 0) + dx; e.y = (e.y ?? 0) + dy; } }
      return c;
    });
  }
  valid(): string | null { try { validateBoard(this.board); return null; } catch (e) { return (e as Error).message; } }
}

export type Panel = null | 'shapes' | 'pens' | 'stamps' | 'templates' | 'more' | 'comments' | 'tmv' | 'export' | 'share' | 'help';
export interface JamUI {
  tool: Tool; shape: ShapeKind; route: Route; connArrow: boolean; moreShapes: boolean; pen: PenKind; penColor: string; penWidth: number; stickyColor: string; stamp: string; shapeFill: string;
  camera: { x: number; y: number; zoom: number }; selection: string[]; editing: { id: string; cell?: [number, number] } | null;
  panel: Panel; hover: string | null; marquee: Box | null; guides: { x?: number; y?: number }[]; saveStatus: 'saved' | 'dirty' | 'saving' | 'conflict' | 'error' | 'readonly'; saveMessage: string;
  me: { id: string; name: string }; composer: { x: number; y: number; itemId?: string } | null; openComment: string | null; showResolved: boolean; follow: boolean; connectFrom: string | null;
  set: (p: Partial<JamUI>) => void;
}
export const useJam = create<JamUI>(set => ({
  tool: 'select', shape: 'rect', route: 'elbow', connArrow: true, moreShapes: false, pen: 'pen', penColor: '#1e1e1e', penWidth: 3, stickyColor: '#ffe066', stamp: '👍', shapeFill: '#ffffff',
  camera: { x: 0, y: 0, zoom: 1 }, selection: [], editing: null, panel: null, hover: null, marquee: null, guides: [], saveStatus: 'saved', saveMessage: '',
  me: { id: 'me', name: 'You' }, composer: null, openComment: null, showResolved: false, follow: false, connectFrom: null,
  set: p => set(p),
}));
export type { Pt };
