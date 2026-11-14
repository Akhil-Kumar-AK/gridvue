import type { DocumentData, SceneNode } from './model';
import { newId } from './model';
import type { SetFn } from './layout';

/** Props never copied from a main component into an instance node. */
const NEVER_SYNC = new Set(['id', 'type', 'parent', 'children', 'sourceId', 'overrides', 'componentId', 'variant', 'props', 'bind', 'propValues']);
/** Props an instance ROOT keeps for itself regardless of overrides. */
const ROOT_OWN = new Set(['x', 'y', 'name', 'absolute', 'sizingH', 'sizingV', 'locked', 'visible']);

export interface InstanceOps {
  set: SetFn;
  insert: (nodes: SceneNode[], parent: string, index: number) => void;
  remove: (id: string) => void;
  move: (id: string, parent: string, index: number) => void;
}

/** Property definitions that apply to a main component (its set's, if it is a variant). */
export function propDefsFor(doc: DocumentData, componentId: string): import('./model').PropDef[] {
  const c = doc.nodes[componentId];
  if (!c) return [];
  const set = c.parent ? doc.nodes[c.parent] : undefined;
  return (set?.type === 'COMPONENT_SET' ? set.props : c.props) ?? [];
}
/** Variant property names → ordered unique values, derived from the variants of a component set. */
export function variantProperties(doc: DocumentData, setId: string): { name: string; values: string[] }[] {
  const set = doc.nodes[setId];
  const out = new Map<string, string[]>();
  for (const cid of set?.children ?? []) for (const [k, v] of Object.entries(doc.nodes[cid].variant ?? {})) { const l = out.get(k) ?? []; if (!l.includes(v)) l.push(v); out.set(k, l); }
  return [...out].map(([name, values]) => ({ name, values }));
}
export function variantName(v: Record<string, string>): string { return Object.entries(v).map(([k, x]) => `${k}=${x}`).join(', '); }

export function enclosingComponent(doc: DocumentData, id: string): string | null {
  for (let c: SceneNode | undefined = doc.nodes[id]; c; c = c.parent ? doc.nodes[c.parent] : undefined) if (c.type === 'COMPONENT') return c.id;
  return null;
}
export function enclosingInstance(doc: DocumentData, id: string): SceneNode | null {
  for (let c: SceneNode | undefined = doc.nodes[id]; c; c = c.parent ? doc.nodes[c.parent] : undefined) if (c.type === 'INSTANCE' && c.componentId) return c;
  return null;
}
export function instancesOf(doc: DocumentData, componentId: string): SceneNode[] {
  return Object.values(doc.nodes).filter(n => n.type === 'INSTANCE' && n.componentId === componentId);
}

function cloneProps(src: SceneNode, skipKeys: Set<string> | string[]): Partial<SceneNode> {
  const skip = new Set(skipKeys);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) if (!NEVER_SYNC.has(k) && !skip.has(k)) out[k] = structuredClone(v);
  return out as Partial<SceneNode>;
}

/**
 * Make the instance rooted at `instId` mirror its main component.
 *  - structure: nodes missing from the instance are created, nodes whose source vanished are removed, order follows main
 *  - properties: copied from the source node except keys listed in that node's `overrides`
 * Children of nested INSTANCE nodes are owned by that nested instance's own component.
 */
export function syncInstance(doc: DocumentData, instId: string, ops: InstanceOps): void {
  const root = doc.nodes[instId];
  const main = root?.componentId ? doc.nodes[root.componentId] : undefined;
  if (!root || !main || main.type !== 'COMPONENT') return;
  if (enclosingComponent(doc, instId) === main.id) return; // an instance may not contain its own main

  const syncNode = (src: SceneNode, dst: SceneNode, isRoot: boolean) => {
    const skip = new Set<string>(dst.overrides ?? []);
    if (isRoot) ROOT_OWN.forEach(k => skip.add(k));
    const props = cloneProps(src, skip);
    const changed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) if (JSON.stringify((dst as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)) changed[k] = v;
    // keys that exist on dst but not on src (e.g. layout removed from main)
    for (const k of Object.keys(dst)) if (!NEVER_SYNC.has(k) && !skip.has(k) && !(k in src) && !(isRoot && ROOT_OWN.has(k))) changed[k] = undefined;
    if (Object.keys(changed).length) ops.set(dst.id, changed as Partial<SceneNode>);
  };

  syncNode(main, root, true);
  const defs = propDefsFor(doc, main.id);
  const valueOf = (name: string) => { const d = defs.find(x => x.name === name); return d ? (root.propValues?.[name] ?? d.default) : undefined; };
  const applyBind = (s: SceneNode, d: SceneNode) => {
    if (!s.bind) return;
    if (s.bind.characters && d.text) { const v = valueOf(s.bind.characters); if (typeof v === 'string' && v !== d.text.characters) ops.set(d.id, { text: { ...d.text, characters: v } }); }
    if (s.bind.visible) { const v = valueOf(s.bind.visible); if (typeof v === 'boolean' && v !== d.visible) ops.set(d.id, { visible: v }); }
    if (s.bind.componentId && d.type === 'INSTANCE') { const v = valueOf(s.bind.componentId); if (typeof v === 'string' && doc.nodes[v]?.type === 'COMPONENT' && v !== d.componentId) ops.set(d.id, { componentId: v }); }
  };

  const walk = (srcParent: SceneNode, dstParent: SceneNode, depth = 0) => {
    if (depth > 50) return;
    const bySource = new Map<string, SceneNode>();
    for (const c of dstParent.children.map(i => doc.nodes[i])) if (c.sourceId) bySource.set(c.sourceId, c);
    const wanted = new Set(srcParent.children);
    for (const c of [...bySource.values()]) if (!wanted.has(c.sourceId!)) ops.remove(c.id);
    srcParent.children.forEach((sid, index) => {
      const s = doc.nodes[sid];
      let d = bySource.get(sid);
      if (!d) {
        const created: SceneNode = { ...structuredClone(s), id: newId(), parent: dstParent.id, children: [], sourceId: sid, overrides: [] };
        if (s.type === 'INSTANCE') { created.componentId = s.componentId; }
        ops.insert([created], dstParent.id, index);
        d = doc.nodes[created.id];
      } else {
        const cur = doc.nodes[dstParent.id].children.indexOf(d.id);
        if (cur !== index) ops.move(d.id, dstParent.id, index);
        syncNode(s, d, false);
      }
      applyBind(s, doc.nodes[d.id]);
      if (s.type === 'INSTANCE') syncInstance(doc, d.id, ops); // nested instance: its own component owns its children
      else walk(s, d, depth + 1);
    });
  };
  walk(main, root);
}

/** Ids that must stay set on instance copies so later syncs know their source. */
export const INSTANCE_LINK_KEYS = ['componentId', 'sourceId', 'overrides'] as const;
