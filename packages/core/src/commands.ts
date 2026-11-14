import { DocStore } from './store';
import { defaultNode, isContainer, newId, type SceneNode } from './model';
import { apply, boundsOfPoints, decompose, invert, localMatrix, mul, rotate, worldBounds, worldMatrix, type Pt, type Rect } from './geometry';

/** Command layer: every function is one logical edit and wraps itself in a transaction. */

export function subtreeIds(store: DocStore, id: string): string[] {
  const out: string[] = [];
  const walk = (i: string) => { out.push(i); store.doc.nodes[i].children.forEach(walk); };
  walk(id);
  return out;
}

export function isAncestor(store: DocStore, anc: string, id: string): boolean {
  for (let c = store.doc.nodes[id]?.parent; c; c = store.doc.nodes[c]?.parent) if (c === anc) return true;
  return false;
}

/** Drop ids whose ancestor is also in the list, and drop root/page nodes. */
export function topLevelOnly(store: DocStore, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter(id => {
    const n = store.doc.nodes[id];
    if (!n || n.type === 'PAGE' || n.type === 'DOCUMENT') return false;
    for (let c = n.parent; c; c = store.doc.nodes[c]?.parent) if (set.has(c)) return false;
    return true;
  });
}

export function pageOf(store: DocStore, id: string): string | null {
  for (let c: SceneNode | undefined = store.doc.nodes[id]; c; c = c.parent ? store.doc.nodes[c.parent] : undefined) if (c.type === 'PAGE') return c.id;
  return null;
}

const GEOM_KEYS = new Set(['x', 'y', 'width', 'height', 'rotation']);

export function addNode(store: DocStore, node: SceneNode, parentId: string, index?: number): string {
  return store.transact(`Add ${node.type.toLowerCase()}`, () => {
    const parent = store.doc.nodes[parentId];
    store.apply({ t: 'insert', nodes: [{ ...node, parent: parentId, children: [] }], parent: parentId, index: index ?? parent.children.length });
    refitAncestors(store, node.id);
    return node.id;
  });
}

export function setProps(store: DocStore, ids: string[], props: Partial<SceneNode>, label = 'Edit properties') {
  store.transact(label, () => {
    for (const id of ids) store.apply({ t: 'set', id, props });
    if (Object.keys(props).some(k => GEOM_KEYS.has(k))) for (const id of ids) refitAncestors(store, id);
  });
}

export function deleteNodes(store: DocStore, ids: string[]) {
  const tops = topLevelOnly(store, ids);
  if (!tops.length) return;
  store.transact('Delete', () => {
    const parents = tops.map(i => store.doc.nodes[i].parent!);
    for (const id of tops) store.apply({ t: 'remove', id });
    for (const p of new Set(parents)) if (store.doc.nodes[p]) refitSelf(store, p);
  });
}

/** Move nodes under a new parent, preserving their world transform. */
export function reparent(store: DocStore, ids: string[], parentId: string, index?: number, label = 'Reparent') {
  const tops = topLevelOnly(store, ids).filter(id => id !== parentId && !isAncestor(store, id, parentId));
  if (!tops.length) return;
  store.transact(label, () => {
    const oldParents = new Set<string>();
    let at = index ?? store.doc.nodes[parentId].children.length;
    for (const id of tops) {
      const n = store.doc.nodes[id];
      oldParents.add(n.parent!);
      const W = worldMatrix(store.doc, id);
      const samePos = n.parent === parentId;
      if (samePos) {
        const cur = store.doc.nodes[parentId].children.indexOf(id);
        store.apply({ t: 'move', id, parent: parentId, index: cur < at ? at - 1 : at });
      } else {
        store.apply({ t: 'move', id, parent: parentId, index: at });
        const local = mul(invert(worldMatrix(store.doc, parentId)), W);
        const d = decompose(local);
        store.apply({ t: 'set', id, props: { x: d.x, y: d.y, rotation: normAngle(d.rotation) } });
      }
      at++;
    }
    for (const p of oldParents) refitSelf(store, p);
    refitSelf(store, parentId);
    refitAncestors(store, tops[0]);
  });
}

export const normAngle = (a: number) => { const r = ((a % 360) + 360) % 360; return Math.abs(r - 360) < 1e-9 ? 0 : Math.round(r * 1e9) / 1e9; };

export function duplicate(store: DocStore, ids: string[]): string[] {
  const tops = topLevelOnly(store, ids);
  const out: string[] = [];
  store.transact('Duplicate', () => {
    for (const id of tops) {
      const n = store.doc.nodes[id];
      const parent = store.doc.nodes[n.parent!];
      const map = new Map<string, string>();
      const nodes: SceneNode[] = [];
      for (const sid of subtreeIds(store, id)) { map.set(sid, newId()); }
      for (const sid of subtreeIds(store, id)) {
        const c = structuredClone(store.doc.nodes[sid]);
        c.id = map.get(sid)!;
        c.parent = c.parent && map.has(c.parent) ? map.get(c.parent)! : c.parent;
        c.children = c.children.map(x => map.get(x)!);
        nodes.push(c);
      }
      nodes[0].name = n.name;
      store.apply({ t: 'insert', nodes, parent: parent.id, index: parent.children.indexOf(id) + 1 });
      out.push(nodes[0].id);
    }
  });
  return out;
}

export function reorder(store: DocStore, ids: string[], mode: 'front' | 'back' | 'forward' | 'backward') {
  const tops = topLevelOnly(store, ids);
  if (!tops.length) return;
  store.transact('Reorder', () => {
    const byParent = new Map<string, string[]>();
    for (const id of tops) { const p = store.doc.nodes[id].parent!; byParent.set(p, [...(byParent.get(p) ?? []), id]); }
    for (const [p, sel] of byParent) {
      const order = [...store.doc.nodes[p].children];
      const selSet = new Set(sel);
      const rest = order.filter(c => !selSet.has(c));
      const picked = order.filter(c => selSet.has(c));
      let next: string[];
      if (mode === 'front') next = [...rest, ...picked];
      else if (mode === 'back') next = [...picked, ...rest];
      else {
        next = [...order];
        const idxs = picked.map(c => next.indexOf(c));
        if (mode === 'forward') { for (const i of idxs.reverse()) { const cur = next.indexOf(order[i]); if (cur < next.length - 1 && !selSet.has(next[cur + 1])) [next[cur], next[cur + 1]] = [next[cur + 1], next[cur]]; } }
        else { for (const i of idxs) { const cur = next.indexOf(order[i]); if (cur > 0 && !selSet.has(next[cur - 1])) [next[cur], next[cur - 1]] = [next[cur - 1], next[cur]]; } }
      }
      next.forEach((id, i) => { if (store.doc.nodes[p].children[i] !== id) store.apply({ t: 'move', id, parent: p, index: i }); });
    }
  });
}

export function groupNodes(store: DocStore, ids: string[], type: 'GROUP' | 'FRAME' = 'GROUP'): string | null {
  const tops = topLevelOnly(store, ids);
  if (!tops.length) return null;
  return store.transact(type === 'GROUP' ? 'Group' : 'Frame selection', () => {
    const parentId = store.doc.nodes[tops[0]].parent!;
    const siblings = store.doc.nodes[parentId].children;
    const index = Math.max(...tops.map(t => siblings.indexOf(t))) + 1;
    const g = defaultNode(type, { name: type === 'GROUP' ? 'Group' : 'Frame', width: 1, height: 1, fills: type === 'FRAME' ? [] : [], clipsContent: type === 'FRAME' });
    // bounds in parent space
    const pm = invert(worldMatrix(store.doc, parentId));
    const pts: Pt[] = [];
    for (const t of tops) { const n = store.doc.nodes[t]; const lm = localMatrix(n); for (const c of [{ x: 0, y: 0 }, { x: n.width, y: 0 }, { x: n.width, y: n.height }, { x: 0, y: n.height }]) pts.push(apply(lm, c)); }
    void pm;
    const b = boundsOfPoints(pts);
    g.x = b.x; g.y = b.y; g.width = Math.max(b.w, 1); g.height = Math.max(b.h, 1);
    store.apply({ t: 'insert', nodes: [g], parent: parentId, index: Math.min(index, siblings.length) });
    // reparent (all share parentId only if same parent; otherwise world-preserving reparent handles it)
    const sorted = [...tops].sort((a, c) => siblings.indexOf(a) - siblings.indexOf(c));
    for (const t of sorted) {
      const n = store.doc.nodes[t];
      if (n.parent !== parentId) { reparent(store, [t], g.id); continue; }
      store.apply({ t: 'move', id: t, parent: g.id, index: store.doc.nodes[g.id].children.length });
      store.apply({ t: 'set', id: t, props: { x: n.x - g.x, y: n.y - g.y } }); // valid since group rotation = 0 at creation
    }
    if (type === 'GROUP') fitGroup(store, g.id);
    refitAncestors(store, g.id);
    return g.id;
  });
}

export function ungroupNodes(store: DocStore, ids: string[]): string[] {
  const out: string[] = [];
  store.transact('Ungroup', () => {
    for (const id of topLevelOnly(store, ids)) {
      const g = store.doc.nodes[id];
      if (!g || (g.type !== 'GROUP' && g.type !== 'FRAME')) continue;
      const parent = store.doc.nodes[g.parent!];
      const at = parent.children.indexOf(id);
      const kids = [...g.children];
      reparent(store, kids, parent.id, at + 1, 'Ungroup');
      if (store.doc.nodes[id]) store.apply({ t: 'remove', id });
      out.push(...kids);
    }
  });
  return out;
}

/** Recompute a GROUP's box from its children (keeps children world-stable). */
export function fitGroup(store: DocStore, id: string) {
  const g = store.doc.nodes[id];
  if (!g || g.type !== 'GROUP' || !g.children.length) return;
  const pts: Pt[] = [];
  for (const c of g.children) { const n = store.doc.nodes[c]; const lm = localMatrix(n); for (const p of [{ x: 0, y: 0 }, { x: n.width, y: 0 }, { x: n.width, y: n.height }, { x: 0, y: n.height }]) pts.push(apply(lm, p)); }
  const b = boundsOfPoints(pts);
  const eps = 1e-6;
  if (Math.abs(b.x) < eps && Math.abs(b.y) < eps && Math.abs(b.w - g.width) < eps && Math.abs(b.h - g.height) < eps) return;
  const off = apply(rotate(g.rotation), { x: b.x, y: b.y });
  store.apply({ t: 'set', id, props: { x: g.x + off.x, y: g.y + off.y, width: b.w, height: b.h } });
  if (Math.abs(b.x) > eps || Math.abs(b.y) > eps) for (const c of g.children) { const n = store.doc.nodes[c]; store.apply({ t: 'set', id: c, props: { x: n.x - b.x, y: n.y - b.y } }); }
}
function refitSelf(store: DocStore, id: string) {
  const n = store.doc.nodes[id];
  if (!n) return;
  if (n.type === 'GROUP' && !n.children.length) { store.apply({ t: 'remove', id }); const p = n.parent; if (p) refitSelf(store, p); return; }
  fitGroup(store, id);
  if (n.parent) refitAncestors(store, id);
}
export function refitAncestors(store: DocStore, id: string) {
  for (let c = store.doc.nodes[id]?.parent; c; c = store.doc.nodes[c]?.parent) {
    const n = store.doc.nodes[c];
    if (!n || n.type !== 'GROUP') break;
    fitGroup(store, c);
  }
}

/** Resize a node; GROUP children (and nested groups) are scaled proportionally. */
import { scalePath } from './path';
export function resizeNode(store: DocStore, id: string, props: { x?: number; y?: number; width: number; height: number }) {
  const n = store.doc.nodes[id];
  const w = Math.max(props.width, 0), h = n.type === 'LINE' ? 0 : Math.max(props.height, 0);
  const sx = n.width > 0 ? w / n.width : 1, sy = n.height > 0 ? h / n.height : 1;
  const sizing: Partial<SceneNode> = {};
  if (Math.abs(w - n.width) > 1e-6 && n.sizingH && n.sizingH !== 'FIXED') sizing.sizingH = 'FIXED'; // manual resize leaves hug/fill
  if (Math.abs(h - n.height) > 1e-6 && n.sizingV && n.sizingV !== 'FIXED') sizing.sizingV = 'FIXED';
  store.apply({ t: 'set', id, props: { ...sizing, ...(props.x !== undefined ? { x: props.x } : {}), ...(props.y !== undefined ? { y: props.y } : {}), width: w, height: h } });
  if (n.type === 'GROUP') scaleChildren(store, id, sx, sy);
  if (n.type === 'VECTOR' && n.path && (sx !== 1 || sy !== 1)) store.apply({ t: 'set', id, props: { path: scalePath(n.path, sx, sy) } });
}
function scaleChildren(store: DocStore, id: string, sx: number, sy: number) {
  for (const c of store.doc.nodes[id].children) {
    const n = store.doc.nodes[c];
    store.apply({ t: 'set', id: c, props: { x: n.x * sx, y: n.y * sy, width: n.width * sx, height: n.type === 'LINE' ? 0 : n.height * sy, ...(n.type === 'VECTOR' && n.path ? { path: scalePath(n.path, sx, sy) } : {}) } });
    if (n.type === 'GROUP') scaleChildren(store, c, sx, sy);
  }
}

/** Translate a node by a world-space vector, converting into its parent's space. */
export function translateWorld(store: DocStore, id: string, dx: number, dy: number) {
  const n = store.doc.nodes[id];
  const pm = invert(worldMatrix(store.doc, n.parent!));
  const d = { x: pm[0] * dx + pm[2] * dy, y: pm[1] * dx + pm[3] * dy };
  store.apply({ t: 'set', id, props: { x: n.x + d.x, y: n.y + d.y } });
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export function align(store: DocStore, ids: string[], mode: AlignMode) {
  const tops = topLevelOnly(store, ids);
  if (!tops.length) return;
  store.transact('Align', () => {
    let ref: Rect;
    if (tops.length === 1) {
      const p = store.doc.nodes[store.doc.nodes[tops[0]].parent!];
      if (p.type === 'PAGE') return;
      ref = worldBounds(store.doc, p.id);
    } else {
      const bs = tops.map(i => worldBounds(store.doc, i));
      const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
      ref = { x: x0, y: y0, w: Math.max(...bs.map(b => b.x + b.w)) - x0, h: Math.max(...bs.map(b => b.y + b.h)) - y0 };
    }
    for (const id of tops) {
      const b = worldBounds(store.doc, id);
      let dx = 0, dy = 0;
      if (mode === 'left') dx = ref.x - b.x;
      if (mode === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
      if (mode === 'right') dx = ref.x + ref.w - (b.x + b.w);
      if (mode === 'top') dy = ref.y - b.y;
      if (mode === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
      if (mode === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
      translateWorld(store, id, dx, dy);
    }
    for (const id of tops) refitAncestors(store, id);
  });
}

export function distribute(store: DocStore, ids: string[], axis: 'h' | 'v') {
  const tops = topLevelOnly(store, ids);
  if (tops.length < 3) return;
  store.transact('Distribute', () => {
    const items = tops.map(id => ({ id, b: worldBounds(store.doc, id) }));
    const pos = (r: Rect) => (axis === 'h' ? r.x : r.y), size = (r: Rect) => (axis === 'h' ? r.w : r.h);
    items.sort((a, b) => pos(a.b) - pos(b.b));
    const start = pos(items[0].b), end = pos(items.at(-1)!.b) + size(items.at(-1)!.b);
    const gap = (end - start - items.reduce((s, i) => s + size(i.b), 0)) / (items.length - 1);
    let cursor = start;
    for (const it of items) {
      const d = cursor - pos(it.b);
      translateWorld(store, it.id, axis === 'h' ? d : 0, axis === 'v' ? d : 0);
      cursor += size(it.b) + gap;
    }
    for (const it of items) refitAncestors(store, it.id);
  });
}

export function renameNode(store: DocStore, id: string, name: string) { setProps(store, [id], { name }, 'Rename'); }
export { isContainer };

// ---------------- auto layout ----------------
import { inferLayout } from './layout';
import { enclosingComponent, enclosingInstance } from './components';
import type { AutoLayout, Sizing } from './model';

export const DEFAULT_LAYOUT: AutoLayout = { mode: 'VERTICAL', gap: 10, padT: 10, padR: 10, padB: 10, padL: 10, primaryAlign: 'MIN', counterAlign: 'MIN' };

/** Add auto layout to a frame-like node, or wrap a selection into a new auto-layout frame. Returns the frame id. */
export function addAutoLayout(store: DocStore, ids: string[]): string | null {
  const tops = topLevelOnly(store, ids);
  if (!tops.length) return null;
  return store.transact('Add auto layout', () => {
    let fid: string;
    const first = store.doc.nodes[tops[0]];
    if (tops.length === 1 && (first.type === 'FRAME' || first.type === 'COMPONENT' || first.type === 'INSTANCE')) fid = first.id;
    else {
      const g = groupNodes(store, tops, 'FRAME');
      if (!g) return null;
      fid = g;
      store.apply({ t: 'set', id: fid, props: { name: 'Auto layout', fills: [], clipsContent: false } });
    }
    const { mode, order } = inferLayout(store.doc, fid);
    // keep visual order: re-stack children by position, then apply layout (frame hugs its content)
    order.forEach((cid, i) => { if (store.doc.nodes[fid].children[i] !== cid) store.apply({ t: 'move', id: cid, parent: fid, index: i }); });
    store.apply({ t: 'set', id: fid, props: { layout: { ...DEFAULT_LAYOUT, mode }, sizingH: 'HUG', sizingV: 'HUG' } });
    return fid;
  });
}

export function removeAutoLayout(store: DocStore, ids: string[]) {
  store.transact('Remove auto layout', () => {
    for (const id of ids) { const n = store.doc.nodes[id]; if (n?.layout) store.apply({ t: 'set', id, props: { layout: undefined, sizingH: undefined, sizingV: undefined } }); }
  });
}

export function setLayout(store: DocStore, ids: string[], patch: Partial<AutoLayout>, label = 'Edit auto layout') {
  store.transact(label, () => { for (const id of ids) { const n = store.doc.nodes[id]; if (n?.layout) store.apply({ t: 'set', id, props: { layout: { ...n.layout, ...patch } } }); } });
}
export function setSizing(store: DocStore, ids: string[], axis: 'H' | 'V', value: Sizing) {
  store.transact('Resizing', () => { for (const id of ids) store.apply({ t: 'set', id, props: axis === 'H' ? { sizingH: value } : { sizingV: value } }); });
}

// ---------------- components ----------------
import { syncInstance } from './components';

/** Turn the selection into a main component (a lone frame/group converts in place; otherwise it is framed first). */
export function createComponent(store: DocStore, ids: string[]): string | null {
  const tops = topLevelOnly(store, ids).filter(i => !enclosingInstance(store.doc, i));
  if (!tops.length) return null;
  return store.transact('Create component', () => {
    let id = tops[0];
    const n = store.doc.nodes[id];
    if (tops.length > 1 || !(n.type === 'FRAME' || n.type === 'GROUP')) {
      const g = groupNodes(store, tops, 'FRAME'); if (!g) return null; id = g;
      store.apply({ t: 'set', id, props: { name: tops.length === 1 ? n.name : 'Component' } });
    }
    const cur = store.doc.nodes[id];
    store.apply({ t: 'set', id, props: { type: 'COMPONENT', clipsContent: cur.type === 'GROUP' ? false : cur.clipsContent } });
    return id;
  });
}

/** Create an instance of a main component (placed beside it unless a position is given). */
export function createInstance(store: DocStore, componentId: string, at?: { parent?: string; x?: number; y?: number }): string | null {
  const main = store.doc.nodes[componentId];
  if (!main || main.type !== 'COMPONENT') return null;
  return store.transact('Create instance', () => {
    const inSet = store.doc.nodes[main.parent!]?.type === 'COMPONENT_SET';
    const anchor = inSet ? store.doc.nodes[main.parent!] : main;
    const parent = at?.parent ?? anchor.parent!;
    const node: SceneNode = { ...structuredClone(main), id: newId(), type: 'INSTANCE', parent, children: [], componentId, sourceId: undefined, overrides: [], name: main.name };
    delete node.sourceId;
    node.x = at?.x ?? anchor.x + anchor.width + 40; node.y = at?.y ?? anchor.y;
    delete node.variant; delete node.props; delete node.bind;
    store.apply({ t: 'insert', nodes: [node], parent, index: store.doc.nodes[parent].children.length });
    // materialise children from the main component
    const ops = {
      set: (id: string, props: Partial<SceneNode>) => store.apply({ t: 'set', id, props }),
      insert: (nodes: SceneNode[], p: string, index: number) => store.apply({ t: 'insert', nodes, parent: p, index }),
      remove: (id: string) => store.apply({ t: 'remove', id }),
      move: (id: string, p: string, index: number) => store.apply({ t: 'move', id, parent: p, index }),
    };
    store.withoutOverrides(() => { syncInstance(store.doc, node.id, ops); syncBindings(store.doc, [node.id], ops.set); }); // resolve variables/styles in the instance's own context
    refitAncestors(store, node.id);
    return node.id;
  });
}

/** Detach an instance: it becomes a plain frame and stops following the main component. */
export function detachInstance(store: DocStore, ids: string[]): string[] {
  const out: string[] = [];
  store.transact('Detach instance', () => {
    for (const id of topLevelOnly(store, ids)) {
      const root = store.doc.nodes[id];
      if (root?.type !== 'INSTANCE') continue;
      const walk = (nid: string, top: boolean) => {
        const n = store.doc.nodes[nid];
        const props: Partial<SceneNode> = { sourceId: undefined, overrides: undefined };
        if (top) { props.type = 'FRAME'; props.componentId = undefined; }
        if (!top && n.type === 'INSTANCE') { store.apply({ t: 'set', id: nid, props: { sourceId: undefined, overrides: undefined } }); return; }
        store.apply({ t: 'set', id: nid, props });
        n.children.forEach(c => walk(c, false));
      };
      walk(id, true);
      out.push(id);
    }
  });
  return out;
}

export function resetOverrides(store: DocStore, ids: string[]) {
  store.transact('Reset overrides', () => {
    for (const id of topLevelOnly(store, ids)) {
      const inst = enclosingInstance(store.doc, id);
      if (!inst) continue;
      const walk = (nid: string) => { const n = store.doc.nodes[nid]; if (n.overrides?.length) store.apply({ t: 'set', id: nid, props: { overrides: [] } }); n.children.forEach(walk); };
      walk(inst.id);
      // re-sync from main
      const ops = {
        set: (nid: string, props: Partial<SceneNode>) => store.apply({ t: 'set', id: nid, props }),
        insert: (nodes: SceneNode[], p: string, index: number) => store.apply({ t: 'insert', nodes, parent: p, index }),
        remove: (nid: string) => store.apply({ t: 'remove', id: nid }),
        move: (nid: string, p: string, index: number) => store.apply({ t: 'move', id: nid, parent: p, index }),
      };
      store.withoutOverrides(() => { syncInstance(store.doc, inst.id, ops); syncBindings(store.doc, [inst.id], ops.set); });
    }
  });
}
void enclosingComponent;

// ---------------- variants and component properties ----------------
import { propDefsFor, variantName, variantProperties } from './components';
import { syncBindings } from './tokens';
import type { PropDef } from './model';

const pathOf = (store: DocStore, rootId: string, id: string): string => {
  const names: string[] = [];
  for (let c: string | null = id; c && c !== rootId; c = store.doc.nodes[c].parent) names.unshift(store.doc.nodes[c].name);
  return names.join('/');
};

/** Combine components into a component set; each gets variant value "Variant N" for a new property "Property 1". */
export function createComponentSet(store: DocStore, ids: string[]): string | null {
  const comps = topLevelOnly(store, ids).filter(i => store.doc.nodes[i].type === 'COMPONENT' && store.doc.nodes[store.doc.nodes[i].parent!].type !== 'COMPONENT_SET');
  if (!comps.length) return null;
  return store.transact('Combine as variants', () => {
    const g = groupNodes(store, comps, 'FRAME');
    if (!g) return null;
    comps.forEach((c, i) => {
      const v = { 'Property 1': `Variant ${i + 1}` };
      store.apply({ t: 'set', id: c, props: { variant: v, name: variantName(v) } });
    });
    store.apply({ t: 'set', id: g, props: { type: 'COMPONENT_SET', name: store.doc.nodes[comps[0]].name.includes('=') ? 'Component set' : 'Component set', fills: [], clipsContent: false, strokes: [{ type: 'SOLID', color: '#9747FF', opacity: 1, visible: true }], strokeWeight: 1, strokeAlign: 'INSIDE', layout: { ...DEFAULT_LAYOUT, mode: 'HORIZONTAL', gap: 16, padT: 24, padR: 24, padB: 24, padL: 24 }, sizingH: 'HUG', sizingV: 'HUG' } });
    return g;
  });
}

/** Add a variant by duplicating `fromId` (default: last variant); the first property gets a new unique value. */
export function addVariant(store: DocStore, setId: string, fromId?: string): string | null {
  const set = store.doc.nodes[setId];
  if (set?.type !== 'COMPONENT_SET' || !set.children.length) return null;
  return store.transact('Add variant', () => {
    const src = fromId ?? set.children[set.children.length - 1];
    const [copy] = duplicate(store, [src]);
    const props = variantProperties(store.doc, setId);
    const v = { ...(store.doc.nodes[src].variant ?? {}) };
    const first = props[0]?.name ?? 'Property 1';
    let n = props[0]?.values.length ?? 1, val = `Variant ${n + 1}`;
    while (props[0]?.values.includes(val)) val = `Variant ${++n + 1}`;
    v[first] = val;
    store.apply({ t: 'set', id: copy, props: { variant: v, name: variantName(v) } });
    return copy;
  });
}

export function addVariantProperty(store: DocStore, setId: string, name: string, defaultValue = 'Default') {
  const set = store.doc.nodes[setId];
  if (set?.type !== 'COMPONENT_SET' || !name.trim() || variantProperties(store.doc, setId).some(p => p.name === name)) return false;
  store.transact('Add variant property', () => {
    for (const c of set.children) { const v = { ...(store.doc.nodes[c].variant ?? {}), [name]: defaultValue }; store.apply({ t: 'set', id: c, props: { variant: v, name: variantName(v) } }); }
  });
  return true;
}
export function removeVariantProperty(store: DocStore, setId: string, name: string) {
  const set = store.doc.nodes[setId];
  store.transact('Remove variant property', () => {
    for (const c of set.children) { const v = { ...(store.doc.nodes[c].variant ?? {}) }; delete v[name]; store.apply({ t: 'set', id: c, props: { variant: v, name: variantName(v) } }); }
  });
}
export function renameVariantProperty(store: DocStore, setId: string, from: string, to: string) {
  const set = store.doc.nodes[setId];
  if (!to.trim() || from === to || variantProperties(store.doc, setId).some(p => p.name === to)) return false;
  store.transact('Rename variant property', () => {
    for (const c of set.children) { const old = store.doc.nodes[c].variant ?? {}; const v = Object.fromEntries(Object.entries(old).map(([k, x]) => [k === from ? to : k, x])); store.apply({ t: 'set', id: c, props: { variant: v, name: variantName(v) } }); }
  });
  return true;
}
/** Set one variant's value; refuses duplicates (two variants with identical values). */
export function setVariantValue(store: DocStore, variantId: string, name: string, value: string) {
  const c = store.doc.nodes[variantId];
  const set = store.doc.nodes[c.parent!];
  if (c.type !== 'COMPONENT' || set?.type !== 'COMPONENT_SET' || !value.trim()) return false;
  const v = { ...(c.variant ?? {}), [name]: value };
  if (set.children.some(o => o !== variantId && JSON.stringify(Object.entries(store.doc.nodes[o].variant ?? {}).sort()) === JSON.stringify(Object.entries(v).sort()))) return false;
  setProps(store, [variantId], { variant: v, name: variantName(v) }, 'Edit variant');
  return true;
}

/** Switch an instance to another variant. Overrides carry over to layers with the same name path. */
export function setInstanceVariant(store: DocStore, instId: string, change: Record<string, string>): boolean {
  const inst = store.doc.nodes[instId];
  const cur = inst?.componentId ? store.doc.nodes[inst.componentId] : undefined;
  const set = cur?.parent ? store.doc.nodes[cur.parent] : undefined;
  if (inst?.type !== 'INSTANCE' || !cur || set?.type !== 'COMPONENT_SET') return false;
  const want = { ...(cur.variant ?? {}), ...change };
  const target = set.children.find(c => Object.entries(want).every(([k, v]) => store.doc.nodes[c].variant?.[k] === v));
  if (!target || target === cur.id) return !!target;
  store.transact('Change variant', () => {
    // re-point old layers to the same-named layers of the new variant so their overrides survive the sync
    const newByPath = new Map<string, string>();
    const walkNew = (id: string) => { for (const c of store.doc.nodes[id].children) { newByPath.set(pathOf(store, target, c), c); if (store.doc.nodes[c].type !== 'INSTANCE') walkNew(c); } };
    walkNew(target);
    const walkOld = (id: string) => {
      for (const c of store.doc.nodes[id].children) {
        const n = store.doc.nodes[c];
        const nid = newByPath.get(pathOf(store, instId, c));
        if (nid) store.apply({ t: 'set', id: c, props: { sourceId: nid } });
        if (n.type !== 'INSTANCE') walkOld(c);
      }
    };
    walkOld(instId);
    store.apply({ t: 'set', id: instId, props: { componentId: target } });
  });
  return true;
}

export function addComponentProp(store: DocStore, ownerId: string, def: PropDef): boolean {
  const o = store.doc.nodes[ownerId];
  if (!o || !(o.type === 'COMPONENT_SET' || (o.type === 'COMPONENT' && store.doc.nodes[o.parent!]?.type !== 'COMPONENT_SET'))) return false;
  if ((o.props ?? []).some(p => p.name === def.name) || !def.name.trim()) return false;
  setProps(store, [ownerId], { props: [...(o.props ?? []), def] }, 'Add component property');
  return true;
}
export function removeComponentProp(store: DocStore, ownerId: string, name: string) {
  const o = store.doc.nodes[ownerId];
  store.transact('Remove component property', () => {
    store.apply({ t: 'set', id: ownerId, props: { props: (o.props ?? []).filter(p => p.name !== name) } });
    // drop bindings that referenced it
    const walk = (id: string) => {
      const n = store.doc.nodes[id];
      if (n.bind && Object.values(n.bind).includes(name)) { const b = Object.fromEntries(Object.entries(n.bind).filter(([, v]) => v !== name)); store.apply({ t: 'set', id, props: { bind: Object.keys(b).length ? b : undefined } }); }
      n.children.forEach(walk);
    };
    walk(ownerId);
  });
}
export function bindLayerProp(store: DocStore, layerId: string, key: 'characters' | 'visible' | 'componentId', propName: string | undefined) {
  const n = store.doc.nodes[layerId];
  const b = { ...(n.bind ?? {}) };
  if (propName) b[key] = propName; else delete b[key];
  setProps(store, [layerId], { bind: Object.keys(b).length ? b : undefined }, 'Bind component property');
}
export function setPropValue(store: DocStore, instId: string, name: string, value: string | boolean) {
  const inst = store.doc.nodes[instId];
  setProps(store, [instId], { propValues: { ...(inst.propValues ?? {}), [name]: value } }, 'Edit component property');
}
export function resetPropValue(store: DocStore, instId: string, name: string) {
  const v = { ...(store.doc.nodes[instId].propValues ?? {}) }; delete v[name];
  setProps(store, [instId], { propValues: v }, 'Reset component property');
}
void propDefsFor;
