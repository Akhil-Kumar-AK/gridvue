/**
 * Design systems as component libraries.
 *
 * A design system is an ordinary document (stored as a file of type "designsystem"). A design file links one of them;
 * its components are then offered in the Assets panel. Using a component copies its main component (plus the variables
 * and styles it is bound to) into a "Design system" page of the design file and creates an instance of that copy, so the
 * design file stays self-contained. Every copied node remembers where it came from (`libRef`), which lets
 * `syncLibraryComponents` pull later edits of the design system into the copies — and through them into every instance.
 */
import type { DocStore } from './store';
import { defaultNode, newId, pageIds, type DocumentData, type SceneNode } from './model';
import { createInstance } from './commands';

export const LIBRARY_PAGE = 'Design system';

export interface LibraryItem {
  /** component set id (or standalone component id) in the design system */
  id: string; name: string; category: string; kind: 'set' | 'component'; variants: number;
  /** a component to draw as the preview (the default variant) */
  previewId: string;
}

/** Every component (set) in a design system, grouped by the page it lives on. */
export function listLibraryComponents(doc: DocumentData): LibraryItem[] {
  const out: LibraryItem[] = [];
  for (const pid of pageIds(doc)) {
    const category = doc.nodes[pid].name;
    const visit = (id: string) => {
      const n = doc.nodes[id];
      if (n.type === 'COMPONENT_SET') { const vs = n.children.filter(c => doc.nodes[c].type === 'COMPONENT'); if (vs.length) out.push({ id: n.id, name: n.name, category, kind: 'set', variants: vs.length, previewId: vs[0] }); return; }
      if (n.type === 'COMPONENT') { out.push({ id: n.id, name: n.name, category, kind: 'component', variants: 1, previewId: n.id }); return; }
      if (n.type === 'FRAME' || n.type === 'GROUP') n.children.forEach(visit);
    };
    doc.nodes[pid].children.forEach(visit);
  }
  return out;
}

const refOf = (libId: string, id: string) => `${libId}:${id}`;
const refMap = (doc: DocumentData, libId: string) => { const m = new Map<string, string>(); const pre = `${libId}:`; for (const n of Object.values(doc.nodes)) if (n.libRef?.startsWith(pre)) m.set(n.libRef, n.id); return m; };
const subtreeOf = (doc: DocumentData, id: string): string[] => { const out: string[] = []; const w = (i: string) => { out.push(i); doc.nodes[i].children.forEach(w); }; w(id); return out; };
/** the set a variant belongs to, else the node itself */
const mainRootOf = (lib: DocumentData, id: string): string | null => {
  const n = lib.nodes[id]; if (!n) return null;
  if (n.type === 'COMPONENT') return lib.nodes[n.parent!]?.type === 'COMPONENT_SET' ? n.parent : n.id;
  return n.type === 'COMPONENT_SET' ? n.id : null;
};

/** Copy the variables, collections and styles a subtree is bound to (existing ones are left alone unless `refresh`). */
function copyTokens(store: DocStore, lib: DocumentData, ids: string[], refresh = false) {
  const vars = new Set<string>(), styles = new Set<string>();
  const addVar = (id: string) => { if (vars.has(id) || !lib.variables[id]) return; vars.add(id); for (const v of Object.values(lib.variables[id].values)) if (typeof v === 'object') addVar(v.alias); };
  for (const id of ids) { const n = lib.nodes[id]; Object.values(n.varBindings ?? {}).forEach(addVar); Object.values(n.styleRefs ?? {}).forEach(s => s && lib.styles[s] && styles.add(s)); }
  for (const vid of vars) {
    const v = lib.variables[vid];
    if (!store.doc.collections[v.collectionId]) store.apply({ t: 'meta', kind: 'collections', id: v.collectionId, value: lib.collections[v.collectionId] });
    else if (refresh) store.apply({ t: 'meta', kind: 'collections', id: v.collectionId, value: lib.collections[v.collectionId] });
    if (!store.doc.variables[vid] || refresh) store.apply({ t: 'meta', kind: 'variables', id: vid, value: v });
  }
  for (const sid of styles) if (!store.doc.styles[sid] || refresh) store.apply({ t: 'meta', kind: 'styles', id: sid, value: lib.styles[sid] });
}

function libraryPage(store: DocStore): string {
  const doc = store.doc;
  const found = pageIds(doc).find(p => doc.nodes[p].name === LIBRARY_PAGE);
  if (found) return found;
  const page = defaultNode('PAGE', { name: LIBRARY_PAGE, parent: doc.rootId });
  store.apply({ t: 'insert', nodes: [page], parent: doc.rootId, index: doc.nodes[doc.rootId].children.length });
  return page.id;
}

/** Clone one library subtree into the document. Dependencies (components that instances inside it use) are imported first. */
function cloneInto(store: DocStore, lib: DocumentData, libId: string, libRootId: string, parentId: string, index: number): string {
  const sub = subtreeOf(lib, libRootId), inSub = new Set(sub);
  for (const id of sub) { const n = lib.nodes[id]; if (n.type === 'INSTANCE' && n.componentId && !inSub.has(n.componentId)) { const dep = mainRootOf(lib, n.componentId); if (dep) ensureImported(store, lib, libId, dep); } }
  copyTokens(store, lib, sub);
  const refs = refMap(store.doc, libId), idMap = new Map<string, string>();
  const nodes = sub.map(id => { const c = structuredClone(lib.nodes[id]); idMap.set(id, newId()); return c; });
  nodes.forEach((c, i) => {
    const old = sub[i];
    c.id = idMap.get(old)!; c.libRef = refOf(libId, old);
    c.parent = i === 0 ? parentId : idMap.get(lib.nodes[old].parent!)!;
    c.children = lib.nodes[old].children.map(k => idMap.get(k)!);
    if (c.componentId) c.componentId = idMap.get(c.componentId) ?? refs.get(refOf(libId, c.componentId));
    if (c.sourceId) c.sourceId = idMap.get(c.sourceId) ?? refs.get(refOf(libId, c.sourceId));
  });
  store.apply({ t: 'insert', nodes, parent: parentId, index });
  return idMap.get(libRootId)!;
}

/** Local id of the copy of a library component (set), importing it first if needed. */
function ensureImported(store: DocStore, lib: DocumentData, libId: string, libRootId: string): string {
  const have = refMap(store.doc, libId).get(refOf(libId, libRootId));
  if (have) return have;
  const page = libraryPage(store);
  const p = store.doc.nodes[page];
  const x = p.children.reduce((m, c) => Math.max(m, store.doc.nodes[c].x + store.doc.nodes[c].width), -80) + 80;
  const id = cloneInto(store, lib, libId, libRootId, page, p.children.length);
  store.apply({ t: 'set', id, props: { x, y: 0 } });
  return id;
}

/**
 * Put a component from a linked design system into the document: import (once) and create an instance.
 * `nodeId` may be a component set (the default variant is used), a variant, or a standalone component.
 */
export function insertLibraryComponent(store: DocStore, lib: DocumentData, libId: string, nodeId: string, at?: { parent?: string; x?: number; y?: number }): string | null {
  const rootId = mainRootOf(lib, nodeId);
  if (!rootId) return null;
  return store.transact('Add component from design system', () => {
    const local = ensureImported(store, lib, libId, rootId);
    const lr = store.doc.nodes[local];
    let target = local;
    if (lr.type === 'COMPONENT_SET') {
      const wanted = lib.nodes[nodeId].type === 'COMPONENT' ? refMap(store.doc, libId).get(refOf(libId, nodeId)) : undefined;
      target = wanted ?? lr.children.find(c => store.doc.nodes[c].type === 'COMPONENT')!;
    }
    return createInstance(store, target, at);
  });
}

/** How many components of this design system the document already carries. */
export function importedCount(doc: DocumentData, libId: string): number {
  const pre = `${libId}:`;
  return Object.values(doc.nodes).filter(n => (n.type === 'COMPONENT_SET' || (n.type === 'COMPONENT' && doc.nodes[n.parent!]?.type !== 'COMPONENT_SET')) && n.libRef?.startsWith(pre)).length;
}

const KEEP = new Set(['id', 'parent', 'children', 'libRef', 'sourceId', 'overrides', 'componentId', 'propValues']);
/**
 * Pull the current state of the design system into the copies already in the document: property edits, new / removed layers and variants,
 * and changed variable values. Instances follow automatically (they mirror their main component). Returns the number of components refreshed.
 */
export function syncLibraryComponents(store: DocStore, lib: DocumentData, libId: string): number {
  const pre = `${libId}:`;
  const roots = Object.values(store.doc.nodes).filter(n => (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && n.libRef?.startsWith(pre) && store.doc.nodes[n.parent!]?.name === LIBRARY_PAGE && store.doc.nodes[n.parent!]?.type === 'PAGE');
  if (!roots.length) return 0;
  return store.transact('Update from design system', () => {
    let count = 0;
    const all = roots.flatMap(r => subtreeOf(store.doc, r.id)).map(i => store.doc.nodes[i].libRef?.slice(pre.length)).filter((x): x is string => !!x && !!lib.nodes[x]);
    copyTokens(store, lib, all, true);
    const syncNode = (localId: string, libNodeId: string, isRoot: boolean) => {
      const L = lib.nodes[libNodeId], loc = store.doc.nodes[localId];
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(L)) if (!KEEP.has(k) && !(isRoot && (k === 'x' || k === 'y')) && JSON.stringify((loc as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)) props[k] = structuredClone(v);
      for (const k of Object.keys(loc)) if (!KEEP.has(k) && !(isRoot && (k === 'x' || k === 'y')) && !(k in L)) props[k] = undefined;
      if (Object.keys(props).length) store.apply({ t: 'set', id: localId, props: props as Partial<SceneNode> });
      const refs = refMap(store.doc, libId);
      const wanted = new Set(L.children);
      for (const c of [...store.doc.nodes[localId].children]) { const r = store.doc.nodes[c].libRef; if (r?.startsWith(pre) && !wanted.has(r.slice(pre.length))) store.apply({ t: 'remove', id: c }); }
      L.children.forEach((lc, i) => {
        const existing = refs.get(refOf(libId, lc));
        if (existing && store.doc.nodes[existing]?.parent === localId) {
          const kids = store.doc.nodes[localId].children;
          if (kids[i] !== existing) store.apply({ t: 'move', id: existing, parent: localId, index: Math.min(i, kids.length - 1) });
          syncNode(existing, lc, false);
        } else cloneInto(store, lib, libId, lc, localId, Math.min(i, store.doc.nodes[localId].children.length));
      });
    };
    for (const r of roots) { if (!store.doc.nodes[r.id]) continue; const libNode = r.libRef!.slice(pre.length); if (lib.nodes[libNode]) { syncNode(r.id, libNode, true); count++; } }
    return count;
  });
}

/**
 * Add the components of `defaults` (e.g. the built-in library) that this design system lacks, matched by name.
 * Each goes onto the page named after its category (created if missing); existing components are never touched.
 * Returns how many were added.
 */
export function addMissingComponents(store: DocStore, defaults: DocumentData): number {
  const have = new Set(listLibraryComponents(store.doc).map(i => i.name.toLowerCase()));
  const missing = listLibraryComponents(defaults).filter(i => !have.has(i.name.toLowerCase()));
  if (!missing.length) return 0;
  store.transact('Add default components', () => {
    for (const item of missing) {
      const doc = store.doc;
      let page = pageIds(doc).find(p => doc.nodes[p].name === item.category);
      if (!page) { const pn = defaultNode('PAGE', { name: item.category, parent: doc.rootId }); store.apply({ t: 'insert', nodes: [pn], parent: doc.rootId, index: doc.nodes[doc.rootId].children.length }); page = pn.id; }
      const sub = subtreeOf(defaults, item.id), idMap = new Map(sub.map(id => [id, newId()]));
      copyTokens(store, defaults, sub);
      const nodes = sub.map((old, i) => {
        const c = structuredClone(defaults.nodes[old]);
        c.id = idMap.get(old)!; c.parent = i === 0 ? page! : idMap.get(defaults.nodes[old].parent!)!; c.children = defaults.nodes[old].children.map(k => idMap.get(k)!);
        return c;
      });
      const kids = store.doc.nodes[page].children;
      nodes[0].x = kids.reduce((m, c) => Math.max(m, store.doc.nodes[c].x + store.doc.nodes[c].width), -96) + 96; nodes[0].y = 0;
      store.apply({ t: 'insert', nodes, parent: page, index: kids.length });
    }
  });
  return missing.length;
}
