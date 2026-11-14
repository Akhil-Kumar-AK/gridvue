import type { DocumentData, SceneNode } from './model';
import { isLayoutNode, layoutRootFor, layoutTree, type TextFit } from './layout';
import { enclosingComponent, instancesOf, syncInstance } from './components';
import { syncBindings } from './tokens';

export type Op =
  | { t: 'set'; id: string; props: Partial<SceneNode> }
  | { t: 'insert'; nodes: SceneNode[]; parent: string; index: number }
  | { t: 'remove'; id: string }
  | { t: 'move'; id: string; parent: string; index: number }
  | { t: 'asset'; id: string; asset: DocumentData['assets'][string] | null }
  /** write one entry of doc.styles / doc.variables / doc.collections (null deletes) */
  | { t: 'meta'; kind: 'styles' | 'variables' | 'collections'; id: string; value: unknown | null };

export interface HistoryEntry { label: string; ops: Op[]; inverse: Op[] }

type Listener = () => void;

/** Apply one op to the document; returns the inverse op(s) (in apply order). */
export function applyOp(doc: DocumentData, op: Op): Op[] {
  switch (op.t) {
    case 'set': {
      const n = doc.nodes[op.id];
      if (!n) throw new Error(`set: unknown node ${op.id}`);
      const old: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(op.props)) {
        old[k] = (n as unknown as Record<string, unknown>)[k];
        if (v === undefined) delete (n as unknown as Record<string, unknown>)[k];
        else (n as unknown as Record<string, unknown>)[k] = v;
      }
      return [{ t: 'set', id: op.id, props: old as Partial<SceneNode> }];
    }
    case 'insert': {
      const root = op.nodes[0];
      const parent = doc.nodes[op.parent];
      if (!parent) throw new Error(`insert: unknown parent ${op.parent}`);
      for (const n of op.nodes) {
        if (doc.nodes[n.id]) throw new Error(`insert: duplicate id ${n.id}`);
      }
      for (const n of op.nodes) doc.nodes[n.id] = structuredClone(n);
      doc.nodes[root.id].parent = op.parent;
      parent.children = [...parent.children.slice(0, op.index), root.id, ...parent.children.slice(op.index)];
      return [{ t: 'remove', id: root.id }];
    }
    case 'remove': {
      const n = doc.nodes[op.id];
      if (!n || !n.parent) throw new Error(`remove: cannot remove ${op.id}`);
      const parent = doc.nodes[n.parent];
      const index = parent.children.indexOf(op.id);
      const sub: SceneNode[] = [];
      const walk = (id: string) => { const x = doc.nodes[id]; sub.push(structuredClone(x)); x.children.forEach(walk); };
      walk(op.id);
      parent.children = parent.children.filter(c => c !== op.id);
      for (const s of sub) delete doc.nodes[s.id];
      return [{ t: 'insert', nodes: sub, parent: n.parent, index }];
    }
    case 'move': {
      const n = doc.nodes[op.id];
      if (!n || !n.parent) throw new Error(`move: cannot move ${op.id}`);
      for (let c: SceneNode | undefined = doc.nodes[op.parent]; c; c = c.parent ? doc.nodes[c.parent] : undefined) {
        if (c.id === op.id) throw new Error('move: cannot move a node into its own descendant');
      }
      const from = doc.nodes[n.parent];
      const fromIndex = from.children.indexOf(op.id);
      from.children = from.children.filter(c => c !== op.id);
      const to = doc.nodes[op.parent];
      const idx = Math.max(0, Math.min(op.index, to.children.length));
      to.children = [...to.children.slice(0, idx), op.id, ...to.children.slice(idx)];
      n.parent = op.parent;
      return [{ t: 'move', id: op.id, parent: from.id, index: fromIndex }];
    }
    case 'meta': {
      const bag = doc[op.kind] as Record<string, unknown>;
      const old = bag[op.id] ?? null;
      if (op.value === null) delete bag[op.id]; else bag[op.id] = structuredClone(op.value);
      return [{ t: 'meta', kind: op.kind, id: op.id, value: old }];
    }
    case 'asset': {
      const old = doc.assets[op.id] ?? null;
      if (op.asset) doc.assets[op.id] = op.asset; else delete doc.assets[op.id];
      return [{ t: 'asset', id: op.id, asset: old }];
    }
  }
}

/**
 * Transactional document store. All mutations go through ops; each committed transaction is one
 * undo step. History is LOCAL: with multiplayer (Phase 3) undo will invert only this client's ops.
 */
export class DocStore {
  doc: DocumentData;
  version = 0;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<Listener>();
  private tx: { label: string; ops: Op[]; inverse: Op[]; depth: number } | null = null;
  readonly historyLimit: number;
  /** set by the host so auto layout can size text nodes (needs a canvas/font measurer) */
  textFit?: TextFit;
  private internal = 0;
  private suppress = 0;
  /** Run store writes that mirror a main component (not user edits): they never count as instance overrides. */
  withoutOverrides<T>(fn: () => T): T { this.suppress++; try { return fn(); } finally { this.suppress--; } }

  constructor(doc: DocumentData, historyLimit = 200) { this.doc = doc; this.historyLimit = historyLimit; }

  subscribe(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  private emit() { this.version++; this.listeners.forEach(l => l()); }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack.at(-1)?.label; }
  get redoLabel() { return this.redoStack.at(-1)?.label; }
  get inTransaction() { return this.tx !== null; }

  replaceDocument(doc: DocumentData) { this.doc = doc; this.undoStack = []; this.redoStack = []; this.tx = null; this.emit(); }

  begin(label: string) {
    if (this.tx) { this.tx.depth++; return; }
    this.tx = { label, ops: [], inverse: [], depth: 1 };
  }
  commit() {
    if (!this.tx) return;
    if (--this.tx.depth > 0) return;
    const { label, ops, inverse } = this.tx;
    this.tx = null;
    if (!ops.length) return;
    this.undoStack.push({ label, ops, inverse: inverse.reverse() });
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack = [];
    this.emit();
  }
  /** Revert everything in the open transaction without recording history. */
  rollback() {
    if (!this.tx) return;
    const { inverse } = this.tx;
    this.tx = null;
    for (const op of inverse.reverse()) applyOp(this.doc, op);
    this.emit();
  }

  transact<T>(label: string, fn: () => T): T {
    this.begin(label);
    try { const r = fn(); this.commit(); return r; }
    catch (e) { if (this.tx && this.tx.depth === 1) this.rollback(); else if (this.tx) this.tx.depth--; throw e; }
  }

  /** Apply an op inside the open transaction (or a one-op transaction). */
  apply(op: Op) {
    if (op.t === 'set') { // drop no-op edits so they never create history entries
      const n = this.doc.nodes[op.id];
      if (n && Object.entries(op.props).every(([k, v]) => JSON.stringify((n as unknown as Record<string, unknown>)[k]) === JSON.stringify(v))) return;
    }
    if (!this.tx) { this.transact('Edit', () => this.apply(op)); return; }
    const pre = this.preAffected(op);
    const overrideKeys = op.t === 'set' && !this.suppress ? this.overrideKeys(op) : null;
    const inv = applyOp(this.doc, op);
    this.record(op, inv);
    if (this.internal === 0) {
      this.internal++;
      try {
        if (overrideKeys && overrideKeys.length) {
          const n = this.doc.nodes[(op as Extract<Op, { t: 'set' }>).id];
          this.internalApply({ t: 'set', id: n.id, props: { overrides: [...new Set([...(n.overrides ?? []), ...overrideKeys])] } });
        }
        this.reactive(op, pre);
      } finally { this.internal--; }
    }
    this.emit();
  }

  // ---- derived state: auto layout + component instances (all recorded in the same transaction) ----
  private internalApply(op: Op) { const inv = applyOp(this.doc, op); this.record(op, inv); }

  private preAffected(op: Op): string[] {
    const d = this.doc;
    if (op.t === 'remove') return d.nodes[op.id]?.parent ? [d.nodes[op.id].parent!] : [];
    if (op.t === 'move') return d.nodes[op.id]?.parent ? [d.nodes[op.id].parent!] : [];
    return [];
  }

  /** Properties of an instance node that become local overrides when edited by the user. */
  private overrideKeys(op: Extract<Op, { t: 'set' }>): string[] {
    const n = this.doc.nodes[op.id];
    if (!n || (!n.sourceId && !(n.type === 'INSTANCE' && n.componentId))) return [];
    const skip = new Set(['overrides', 'sourceId', 'componentId', 'propValues', 'variant', 'props', 'bind', ...(n.componentId ? ['x', 'y', 'name', 'absolute', 'sizingH', 'sizingV', 'locked', 'visible'] : [])]);
    return Object.entries(op.props).filter(([k, v]) => !skip.has(k) && JSON.stringify((n as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)).map(([k]) => k);
  }

  private reactive(op: Op, pre: string[]) {
    const d = this.doc;
    const touched: string[] = [];
    const LAYOUT_KEYS = ['x', 'y', 'width', 'height', 'layout', 'sizingH', 'sizingV', 'absolute', 'visible', 'text', 'type'];
    if (op.t === 'set') { if (Object.keys(op.props).some(k => LAYOUT_KEYS.includes(k))) touched.push(op.id); }
    else if (op.t === 'insert') touched.push(op.nodes[0].id, op.parent);
    else if (op.t === 'remove') touched.push(...pre);
    else if (op.t === 'move') touched.push(...pre, op.parent, op.id);
    const compTouched = op.t === 'set' ? [op.id] : touched.slice();
    const live = (ids: string[]) => ids.filter(i => d.nodes[i]);
    const set = (id: string, props: Partial<SceneNode>) => this.internalApply({ t: 'set', id, props });
    // styles + variable bindings first: they can change geometry, which layout and instances then pick up
    const BIND_KEYS = ['styleRefs', 'varBindings', 'modeOverrides'];
    let bindRoots: string[] = [];
    if (op.t === 'meta') bindRoots = [d.rootId];
    else if (op.t === 'set' && Object.keys(op.props).some(k => BIND_KEYS.includes(k))) bindRoots = [op.id];
    else if (op.t === 'insert') bindRoots = [op.nodes[0].id];
    else if (op.t === 'move') bindRoots = [op.id]; // a new ancestor chain can mean a new variable mode
    if (bindRoots.length) {
      const changed = syncBindings(d, live(bindRoots), set);
      touched.push(...changed); compTouched.push(...changed);
    }
    const runLayout = (ids: string[]) => { const roots = new Set<string>(); for (const i of live(ids)) { const r = layoutRootFor(d, i); if (r) roots.add(r); } roots.forEach(r => d.nodes[r] && layoutTree(d, r, set, this.textFit)); };

    runLayout(touched);
    const comps = new Set<string>();
    // an instance whose component or property values changed re-syncs itself
    const selfSync: string[] = [];
    if (op.t === 'set' && d.nodes[op.id]?.type === 'INSTANCE' && ('propValues' in op.props || 'componentId' in op.props)) selfSync.push(op.id);
    for (const i of live(compTouched)) {
      const c = enclosingComponent(d, i); if (c) comps.add(c);
      if (d.nodes[i].type === 'COMPONENT_SET') for (const v of d.nodes[i].children) if (d.nodes[v].type === 'COMPONENT') comps.add(v); // set-level change (e.g. property defaults)
    }
    const ops = {
      set,
      insert: (nodes: SceneNode[], parent: string, index: number) => this.internalApply({ t: 'insert', nodes, parent, index }),
      remove: (id: string) => this.internalApply({ t: 'remove', id }),
      move: (id: string, parent: string, index: number) => this.internalApply({ t: 'move', id, parent, index }),
    };
    for (const id of selfSync) { if (!d.nodes[id]) continue; syncInstance(d, id, ops); syncBindings(d, [id], set); runLayout([id, ...d.nodes[id].children]); }
    for (const c of comps) {
      for (const inst of instancesOf(d, c)) {
        syncInstance(d, inst.id, ops);
        syncBindings(d, [inst.id], set); // instances resolve variables in their own context (mode)
        if (isLayoutNode(d.nodes[inst.id]) || d.nodes[inst.id]) runLayout([inst.id, ...d.nodes[inst.id].children]);
      }
    }
  }

  private record(op: Op, inv: Op[]) {
    const tx = this.tx!;
    if (op.t === 'set') {
      // coalesce into an earlier set on the same node within the trailing run of set ops
      for (let i = tx.ops.length - 1; i >= 0 && tx.ops[i].t === 'set'; i--) {
        const prev = tx.ops[i] as Extract<Op, { t: 'set' }>;
        if (prev.id !== op.id) continue;
        Object.assign(prev.props, op.props);
        const pinv = tx.inverse[i] as Extract<Op, { t: 'set' }>;
        for (const [k, v] of Object.entries((inv[0] as Extract<Op, { t: 'set' }>).props)) if (!(k in pinv.props)) (pinv.props as Record<string, unknown>)[k] = v;
        return;
      }
    }
    tx.ops.push(structuredClone(op));
    tx.inverse.push(...inv);
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    for (const op of e.inverse) applyOp(this.doc, op);
    this.redoStack.push(e);
    this.emit();
    return true;
  }
  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    for (const op of e.ops) applyOp(this.doc, op);
    this.undoStack.push(e);
    this.emit();
    return true;
  }
}
