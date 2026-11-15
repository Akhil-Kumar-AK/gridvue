import { DocStore } from './store';
import { newId, type Animation, type DocumentData, type Easing, type Interaction, type ProtoAction, type SceneNode, type Trigger, type Variable } from './model';
import { setVariableValue } from './tokenCommands';
import { createInstance as _ci, setInstanceVariant } from './commands';
import { hitChain, worldBounds, type Pt, type Rect } from './geometry';
import { modeFor, resolveVariable } from './tokens';

void _ci;

// =============== expressions ===============
export class ExprError extends Error {}
type Val = string | number | boolean;
type Tok = { k: 'num' | 'str' | 'var' | 'op' | 'id'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{') { const j = src.indexOf('}', i); if (j < 0) throw new ExprError('Unclosed {variable}'); out.push({ k: 'var', v: src.slice(i + 1, j).trim() }); i = j + 1; continue; }
    if (c === '"' || c === "'") { let j = i + 1, s = ''; while (j < src.length && src[j] !== c) s += src[j++]; if (j >= src.length) throw new ExprError('Unclosed string'); out.push({ k: 'str', v: s }); i = j + 1; continue; }
    const num = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (num) { out.push({ k: 'num', v: num[0] }); i += num[0].length; continue; }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { out.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/%<>()!'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    const id = /^[A-Za-z_]\w*/.exec(src.slice(i));
    if (id) { out.push({ k: 'id', v: id[0] }); i += id[0].length; continue; }
    throw new ExprError(`Unexpected "${c}"`);
  }
  return out;
}

/** Safe expression evaluator: numbers, "strings", true/false, {variable names}, + - * / %, comparisons, && || !, parentheses. */
export function evaluate(src: string, lookup: (name: string) => Val | undefined): Val {
  const t = tokenize(src); let p = 0;
  const peek = () => t[p], eat = (v?: string) => { const x = t[p]; if (!x || (v && x.v !== v)) throw new ExprError(`Expected ${v ?? 'a value'}`); p++; return x; };
  const num = (v: Val) => { if (typeof v !== 'number') throw new ExprError('Expected a number'); return v; };
  const prim = (): Val => {
    const x = peek(); if (!x) throw new ExprError('Unexpected end');
    if (x.k === 'num') { p++; return Number(x.v); }
    if (x.k === 'str') { p++; return x.v; }
    if (x.k === 'var') { p++; const v = lookup(x.v); if (v === undefined) throw new ExprError(`Unknown variable {${x.v}}`); return v; }
    if (x.k === 'id' && (x.v === 'true' || x.v === 'false')) { p++; return x.v === 'true'; }
    if (x.k === 'op' && x.v === '(') { p++; const v = or(); eat(')'); return v; }
    if (x.k === 'op' && x.v === '-') { p++; return -num(prim()); }
    if (x.k === 'op' && x.v === '!') { p++; return !prim(); }
    throw new ExprError(`Unexpected "${x.v}"`);
  };
  const bin = (next: () => Val, ops: string[], f: (op: string, a: Val, b: Val) => Val) => () => { let a = next(); while (peek()?.k === 'op' && ops.includes(peek()!.v)) { const op = eat().v; a = f(op, a, next()); } return a; };
  const mul = bin(prim, ['*', '/', '%'], (o, a, b) => (o === '*' ? num(a) * num(b) : o === '/' ? (num(b) === 0 ? (() => { throw new ExprError('Division by zero'); })() : num(a) / num(b)) : num(a) % num(b)));
  const add = bin(mul, ['+', '-'], (o, a, b) => (o === '+' ? (typeof a === 'number' && typeof b === 'number' ? a + b : String(a) + String(b)) : num(a) - num(b)));
  const cmp = bin(add, ['<', '<=', '>', '>='], (o, a, b) => (o === '<' ? num(a) < num(b) : o === '<=' ? num(a) <= num(b) : o === '>' ? num(a) > num(b) : num(a) >= num(b)));
  const eq = bin(cmp, ['==', '!='], (o, a, b) => (o === '==' ? a === b : a !== b));
  const and = bin(eq, ['&&'], (_o, a, b) => !!a && !!b);
  const or = bin(and, ['||'], (_o, a, b) => !!a || !!b);
  const v = or();
  if (p < t.length) throw new ExprError(`Unexpected "${t[p].v}"`);
  return v;
}

// =============== easing ===============
const BEZ: Record<string, [number, number, number, number]> = {
  EASE_IN: [0.42, 0, 1, 1], EASE_OUT: [0, 0, 0.58, 1], EASE_IN_OUT: [0.42, 0, 0.58, 1],
  EASE_IN_BACK: [0.3, -0.05, 0.7, -0.5], EASE_OUT_BACK: [0.34, 1.56, 0.64, 1], EASE_IN_OUT_BACK: [0.7, -0.4, 0.4, 1.4],
};
function cubic(x1: number, y1: number, x2: number, y2: number, t: number): number {
  if (t <= 0) return 0; if (t >= 1) return 1;
  const bx = (s: number) => 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3;
  const by = (s: number) => 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3;
  let lo = 0, hi = 1, s = t;
  for (let i = 0; i < 24; i++) { s = (lo + hi) / 2; if (bx(s) < t) lo = s; else hi = s; }
  return by(s);
}
/** Progress after easing, for raw progress t in [0,1]. */
export function ease(e: Easing, t: number): number {
  if (e === 'LINEAR') return Math.min(1, Math.max(0, t));
  if (e === 'SPRING') { const x = Math.min(1, Math.max(0, t)); return x >= 1 ? 1 : 1 - Math.exp(-6 * x) * Math.cos(10 * x); }
  const b = typeof e === 'object' ? e.bezier : BEZ[e];
  return cubic(b[0], b[1], b[2], b[3], t);
}

// =============== defaults + editing commands ===============
export const DEFAULT_ANIM: Animation = { type: 'SMART_ANIMATE', easing: 'EASE_OUT', duration: 300 };
export const INSTANT: Animation = { type: 'INSTANT', easing: 'LINEAR', duration: 0 };

export function newAction(type: ProtoAction['type'], to = ''): ProtoAction {
  const anim = { ...DEFAULT_ANIM };
  switch (type) {
    case 'NAVIGATE': return { type, to, anim };
    case 'OVERLAY_OPEN': case 'OVERLAY_SWAP': return { type, to, anim: { type: 'DISSOLVE', easing: 'EASE_OUT', duration: 200 }, position: 'CENTER', closeOnOutside: true, backdrop: true };
    case 'OVERLAY_CLOSE': return { type, anim: { type: 'DISSOLVE', easing: 'EASE_OUT', duration: 200 } };
    case 'BACK': return { type, anim };
    case 'SCROLL_TO': return { type, to, anim: { type: 'INSTANT', easing: 'EASE_OUT', duration: 300 } };
    case 'LINK': return { type, url: 'https://' };
    case 'WHITEBOARD': return { type, fileId: '', fileName: '' };
    case 'CHANGE_TO': return { type, to, anim: { type: 'SMART_ANIMATE', easing: 'EASE_OUT', duration: 200 } };
    case 'SET_VAR': return { type, variableId: to, expr: '' };
    case 'CONDITIONAL': return { type, branches: [{ cond: 'true', actions: [] }], otherwise: [] };
  }
}
export const newInteraction = (trigger: Trigger = { type: 'CLICK' }, actions: ProtoAction[] = []): Interaction => ({ id: newId('int'), trigger, actions });

export function addInteraction(store: DocStore, nodeId: string, i: Interaction = newInteraction()): string {
  store.transact('Add interaction', () => store.apply({ t: 'set', id: nodeId, props: { interactions: [...(store.doc.nodes[nodeId].interactions ?? []), i] } }));
  return i.id;
}
export function updateInteraction(store: DocStore, nodeId: string, id: string, patch: Partial<Interaction>) {
  store.transact('Edit interaction', () => store.apply({ t: 'set', id: nodeId, props: { interactions: (store.doc.nodes[nodeId].interactions ?? []).map(x => (x.id === id ? { ...x, ...patch } : x)) } }));
}
export function removeInteraction(store: DocStore, nodeId: string, id: string) {
  store.transact('Remove interaction', () => { const l = (store.doc.nodes[nodeId].interactions ?? []).filter(x => x.id !== id); store.apply({ t: 'set', id: nodeId, props: { interactions: l.length ? l : undefined } }); });
}
/** Drag-to-connect: on click → navigate to the destination frame. */
export function connectTo(store: DocStore, nodeId: string, destFrameId: string): string {
  return addInteraction(store, nodeId, newInteraction({ type: 'CLICK' }, [newAction('NAVIGATE', destFrameId)]));
}
export function setFlowStart(store: DocStore, frameId: string, name: string | undefined) {
  store.transact(name ? 'Add flow starting point' : 'Remove flow starting point', () => store.apply({ t: 'set', id: frameId, props: { flowStart: name } }));
}

/** Frames that can be a navigation destination: top-level frames of the page containing `nodeId`. */
export function topFrames(doc: DocumentData, pageId: string): SceneNode[] {
  return doc.nodes[pageId].children.map(c => doc.nodes[c]).filter(n => n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET');
}
export function flows(doc: DocumentData): { name: string; frameId: string; pageId: string }[] {
  const out: { name: string; frameId: string; pageId: string }[] = [];
  for (const pid of doc.nodes[doc.rootId].children) for (const f of topFrames(doc, pid)) if (f.flowStart) out.push({ name: f.flowStart, frameId: f.id, pageId: pid });
  return out;
}
export function topFrameOf(doc: DocumentData, id: string): string | null {
  let cur: SceneNode | undefined = doc.nodes[id], top: string | null = null;
  for (; cur; cur = cur.parent ? doc.nodes[cur.parent] : undefined) if (cur.parent && doc.nodes[cur.parent].type === 'PAGE') top = cur.id;
  return top;
}

// =============== runtime ===============
export type TriggerEvent = { type: Exclude<Trigger['type'], 'KEY' | 'DELAY'> } | { type: 'KEY'; key: string };

export type Transition =
  | { kind: 'navigate'; from: string; to: string; anim: Animation }
  | { kind: 'overlayOpen'; frame: string; anim: Animation; position: string; backdrop: boolean; closeOnOutside: boolean; anchor?: Rect }
  | { kind: 'overlayClose'; frame: string; anim: Animation }
  | { kind: 'scroll'; frame: string; from: Pt; to: Pt; anim: Animation }
  | { kind: 'change'; frame: string; anim: Animation; before: DocumentData }
  | { kind: 'link'; url: string }
  | { kind: 'whiteboard'; fileId: string; fileName: string }
  | { kind: 'error'; message: string };

export function reverseAnim(a: Animation): Animation {
  const flip = { LEFT: 'RIGHT', RIGHT: 'LEFT', TOP: 'BOTTOM', BOTTOM: 'TOP' } as const;
  const t = ({ MOVE_IN: 'MOVE_OUT', MOVE_OUT: 'MOVE_IN', SLIDE_IN: 'SLIDE_OUT', SLIDE_OUT: 'SLIDE_IN' } as Record<string, Animation['type']>)[a.type] ?? a.type;
  return { ...a, type: t, direction: a.direction ? flip[a.direction] : a.direction };
}

interface HistoryEntry { frame: string; anim: Animation }
export interface Overlay { frame: string; anchor?: Rect; position: string; backdrop: boolean; closeOnOutside: boolean; anim: Animation }

/**
 * Prototype state machine. Works on a private clone of the document so playing never edits the design.
 * It decides what happens (and mutates runtime state: current frame, overlays, scroll, variables, instance variants);
 * the player only animates the returned transitions.
 */
export class PrototypeRuntime {
  readonly store: DocStore;
  frame: string;
  overlays: Overlay[] = [];
  scroll: Record<string, Pt> = {};
  private history: HistoryEntry[] = [];
  readonly startFrame: string;
  private guard = 0;

  constructor(doc: DocumentData, startFrame: string) {
    this.store = new DocStore(structuredClone(doc));
    this.startFrame = startFrame; this.frame = startFrame;
  }
  get doc() { return this.store.doc; }
  restart() { this.frame = this.startFrame; this.overlays = []; this.history = []; this.scroll = {}; }
  get canGoBack() { return this.overlays.length > 0 || this.history.length > 0; }

  /** Variable lookup by `Name` or `Collection/Name`, resolved in the default mode. */
  variableValue(name: string): Val | undefined {
    const d = this.doc;
    const matches = Object.values(d.variables).filter(v => v.name === name || `${d.collections[v.collectionId]?.name}/${v.name}` === name);
    if (matches.length !== 1) return undefined;
    return resolveVariable(d, matches[0].id, c => modeFor(d, this.frame, c));
  }
  evalExpr(src: string): Val { return evaluate(src, n => this.variableValue(n)); }

  /** Nodes under the visible layers (top overlay first, then the current frame) at a point in the frame's own coordinates. */
  hitChainAt(p: Pt): { chain: string[]; frame: string; overlayIndex: number } {
    for (let i = this.overlays.length - 1; i >= -1; i--) {
      const f = i >= 0 ? this.overlays[i].frame : this.frame;
      const fn = this.doc.nodes[f]; if (!fn) continue;
      const off = i >= 0 ? this.overlayOrigin(i) : { x: 0, y: 0 };
      const world = { x: fn.x + (p.x - off.x) + 0, y: fn.y + (p.y - off.y) };
      const sc = this.scroll[f] ?? { x: 0, y: 0 };
      const inFrame = p.x >= off.x && p.y >= off.y && p.x <= off.x + fn.width && p.y <= off.y + fn.height;
      if (!inFrame) { if (i >= 0 && this.overlays[i].backdrop) return { chain: [], frame: f, overlayIndex: i }; continue; }
      // test the frame's children directly: scrolled content may lie outside the frame's own box
      const chain = [f, ...hitChain(this.doc, f, { x: world.x + sc.x, y: world.y + sc.y }, 0)];
      return { chain, frame: f, overlayIndex: i };
    }
    return { chain: [], frame: this.frame, overlayIndex: -1 };
  }
  /** Top-left of overlay i inside the viewport (current frame coordinates). */
  overlayOrigin(i: number): Pt {
    const o = this.overlays[i], fn = this.doc.nodes[o.frame], base = this.doc.nodes[this.frame];
    if (!fn || !base) return { x: 0, y: 0 };
    const W = base.width, H = base.height, w = fn.width, h = fn.height;
    switch (o.position) {
      case 'TOP_LEFT': return { x: 0, y: 0 }; case 'TOP_CENTER': return { x: (W - w) / 2, y: 0 }; case 'TOP_RIGHT': return { x: W - w, y: 0 };
      case 'BOTTOM_LEFT': return { x: 0, y: H - h }; case 'BOTTOM_CENTER': return { x: (W - w) / 2, y: H - h }; case 'BOTTOM_RIGHT': return { x: W - w, y: H - h };
      case 'BELOW_TRIGGER': if (o.anchor) return { x: Math.min(Math.max(0, o.anchor.x - base.x), Math.max(0, W - w)), y: Math.min(o.anchor.y - base.y + o.anchor.h, Math.max(0, H - h)) }; return { x: (W - w) / 2, y: (H - h) / 2 };
      default: return { x: (W - w) / 2, y: (H - h) / 2 };
    }
  }

  private match(i: Interaction, e: TriggerEvent) {
    const t = i.trigger;
    if (t.type !== e.type) return false;
    return e.type !== 'KEY' || (t.key ?? '').toLowerCase() === e.key.toLowerCase();
  }
  /** First interaction (deepest layer first, bubbling to ancestors) matching the event. */
  find(chain: string[], e: TriggerEvent): { node: string; interaction: Interaction } | null {
    for (let k = chain.length - 1; k >= 0; k--) { const n = this.doc.nodes[chain[k]]; const it = n?.interactions?.find(x => this.match(x, e)); if (it) return { node: n.id, interaction: it }; }
    return null;
  }
  /** Run the interactions an event triggers (pointer events pass the hit chain). */
  fire(e: TriggerEvent, chain: string[]): Transition[] {
    const hit = this.find(chain, e);
    return hit ? this.run(hit.interaction.actions, hit.node) : [];
  }
  /** Key triggers apply to any layer of the visible frame/overlays. */
  fireKey(key: string): Transition[] {
    const out: Transition[] = [];
    const frames = [this.frame, ...this.overlays.map(o => o.frame)];
    for (const f of frames) { const walk = (id: string): boolean => { const n = this.doc.nodes[id]; const it = n?.interactions?.find(x => this.match(x, { type: 'KEY', key })); if (it) { out.push(...this.run(it.actions, id)); return true; } return n ? n.children.some(walk) : false; }; if (walk(f)) break; }
    return out;
  }
  /** Interactions with an "after delay" trigger in the visible frame and overlays. */
  delayed(): { node: string; interaction: Interaction; ms: number }[] {
    const out: { node: string; interaction: Interaction; ms: number }[] = [];
    for (const f of [this.frame, ...this.overlays.map(o => o.frame)]) { const walk = (id: string) => { const n = this.doc.nodes[id]; if (!n) return; for (const i of n.interactions ?? []) if (i.trigger.type === 'DELAY') out.push({ node: id, interaction: i, ms: Math.max(0, i.trigger.delay ?? 0) }); n.children.forEach(walk); }; walk(f); }
    return out;
  }
  hasHover(chain: string[]) { return chain.some(c => this.doc.nodes[c]?.interactions?.some(i => ['HOVER', 'MOUSE_ENTER', 'MOUSE_LEAVE'].includes(i.trigger.type))); }

  run(actions: ProtoAction[], sourceNode: string): Transition[] {
    const out: Transition[] = [];
    if (++this.guard > 50) { this.guard--; return [{ kind: 'error', message: 'Too many nested actions' }]; }
    try { for (const a of actions) out.push(...this.exec(a, sourceNode)); } finally { this.guard--; }
    return out;
  }

  private exec(a: ProtoAction, src: string): Transition[] {
    const d = this.doc;
    const need = (id: string | undefined, what: string): SceneNode | null => (id && d.nodes[id] ? d.nodes[id] : null) ?? null;
    switch (a.type) {
      case 'NAVIGATE': {
        const to = need(a.to, 'frame'); if (!to) return [{ kind: 'error', message: 'Destination frame no longer exists' }];
        const from = this.frame;
        if (to.id !== from) this.history.push({ frame: from, anim: a.anim });
        this.frame = to.id; this.overlays = [];
        return [{ kind: 'navigate', from, to: to.id, anim: a.anim }];
      }
      case 'OVERLAY_OPEN': case 'OVERLAY_SWAP': {
        const to = need(a.to, 'overlay'); if (!to) return [{ kind: 'error', message: 'Overlay frame no longer exists' }];
        const out: Transition[] = [];
        if (a.type === 'OVERLAY_SWAP' && this.overlays.length) { const top = this.overlays.pop()!; out.push({ kind: 'overlayClose', frame: top.frame, anim: a.anim }); }
        const srcN = d.nodes[src]; const anchor = srcN ? worldBounds(d, src) : undefined;
        const ov: Overlay = { frame: to.id, anchor, position: a.position, backdrop: a.backdrop, closeOnOutside: a.closeOnOutside, anim: a.anim };
        this.overlays.push(ov);
        out.push({ kind: 'overlayOpen', frame: to.id, anim: a.anim, position: a.position, backdrop: a.backdrop, closeOnOutside: a.closeOnOutside, anchor });
        return out;
      }
      case 'OVERLAY_CLOSE': {
        const idx = a.to ? this.overlays.findIndex(o => o.frame === a.to) : this.overlays.length - 1;
        if (idx < 0) { // when fired from inside an overlay close that overlay
          const owner = topFrameOf(d, src); const k = this.overlays.findIndex(o => o.frame === owner);
          if (k < 0) return []; const [o] = this.overlays.splice(k, 1); return [{ kind: 'overlayClose', frame: o.frame, anim: a.anim }];
        }
        const [o] = this.overlays.splice(idx, 1);
        return [{ kind: 'overlayClose', frame: o.frame, anim: a.anim }];
      }
      case 'BACK': {
        if (this.overlays.length) { const o = this.overlays.pop()!; return [{ kind: 'overlayClose', frame: o.frame, anim: o.anim }]; }
        const h = this.history.pop(); if (!h) return [];
        const from = this.frame; this.frame = h.frame;
        return [{ kind: 'navigate', from, to: h.frame, anim: reverseAnim(h.anim) }];
      }
      case 'SCROLL_TO': {
        const target = need(a.to, 'layer'); if (!target) return [{ kind: 'error', message: 'Scroll target no longer exists' }];
        const f = topFrameOf(d, target.id) ?? this.frame; const fn = d.nodes[f];
        const tb = worldBounds(d, target.id);
        const to = { x: Math.max(0, tb.x - fn.x), y: Math.max(0, tb.y - fn.y) };
        const from = this.scroll[f] ?? { x: 0, y: 0 };
        this.scroll[f] = to;
        return [{ kind: 'scroll', frame: f, from, to, anim: a.anim }];
      }
      case 'WHITEBOARD': return a.fileId ? [{ kind: 'whiteboard', fileId: a.fileId, fileName: a.fileName }] : [{ kind: 'error', message: 'Pick a whiteboard for this interaction' }];
      case 'LINK': return /^(https?:|mailto:)/i.test(a.url) ? [{ kind: 'link', url: a.url }] : [{ kind: 'error', message: `Blocked link "${a.url}" (only http, https and mailto are allowed)` }];
      case 'CHANGE_TO': {
        const inst = d.nodes[src]; const to = need(a.to, 'component');
        const target = inst && (inst.type === 'INSTANCE' ? inst : null);
        if (!to || to.type !== 'COMPONENT') return [{ kind: 'error', message: 'Component no longer exists' }];
        if (!target) return [{ kind: 'error', message: '"Change to" works on component instances' }];
        const before = structuredClone(d);
        // switching within the same set keeps overrides; otherwise point the instance at the new component
        const set = to.parent ? d.nodes[to.parent] : null;
        if (set?.type === 'COMPONENT_SET' && d.nodes[target.componentId ?? '']?.parent === set.id) setInstanceVariant(this.store, target.id, to.variant ?? {});
        else this.store.apply({ t: 'set', id: target.id, props: { componentId: to.id } });
        return [{ kind: 'change', frame: topFrameOf(d, src) ?? this.frame, anim: a.anim, before }];
      }
      case 'SET_VAR': {
        const v: Variable | undefined = d.variables[a.variableId];
        if (!v) return [{ kind: 'error', message: 'Variable no longer exists' }];
        try {
          const r = this.evalExpr(a.expr);
          const col = d.collections[v.collectionId];
          const val: Val = v.type === 'FLOAT' ? Number(r) : v.type === 'STRING' ? String(r) : v.type === 'BOOLEAN' ? !!r : String(r);
          if (v.type === 'FLOAT' && !Number.isFinite(val as number)) throw new ExprError('Result is not a number');
          const mode = modeFor(d, this.frame, v.collectionId) || col.modes[0].id;
          if (!setVariableValue(this.store, v.id, mode, val)) throw new ExprError(`Value ${String(val)} is not valid for ${v.type.toLowerCase()} variable ${v.name}`);
        } catch (e) { return [{ kind: 'error', message: (e as Error).message }]; }
        return [];
      }
      case 'CONDITIONAL': {
        for (const b of a.branches) {
          let ok = false;
          try { ok = !!this.evalExpr(b.cond); } catch (e) { return [{ kind: 'error', message: `Condition "${b.cond}": ${(e as Error).message}` }]; }
          if (ok) return this.run(b.actions, src);
        }
        return this.run(a.otherwise, src);
      }
    }
  }
}
