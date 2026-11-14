import { DocStore } from './store';
import { newId, type AutoLayout, type Paint, type Effect, type SceneNode, type Style, type StyleType, type TextProps, type VarCollection, type VarScope, type VarType, type VarValue, type Variable } from './model';
import { defaultFor, pathInfo, resolveVariable, scopeAllows, type TokenFile } from './tokens';
import { topLevelOnly } from './commands';

const meta = (store: DocStore, kind: 'styles' | 'variables' | 'collections', id: string, value: unknown | null) => store.apply({ t: 'meta', kind, id, value });
const subtree = (store: DocStore, ids: string[]): string[] => {
  const out: string[] = [];
  const walk = (i: string) => { out.push(i); store.doc.nodes[i].children.forEach(walk); };
  ids.forEach(walk);
  return out;
};
const allNodes = (store: DocStore) => Object.keys(store.doc.nodes);

// ================= variables =================

export function createCollection(store: DocStore, name: string, modeNames: string[] = ['Mode 1']): string {
  const id = newId('col');
  const col: VarCollection = { id, name: name.trim() || 'Collection', modes: modeNames.map(n => ({ id: newId('mode'), name: n })) };
  store.transact('Create variable collection', () => meta(store, 'collections', id, col));
  return id;
}
export function renameCollection(store: DocStore, id: string, name: string) {
  const c = store.doc.collections[id]; if (!c || !name.trim()) return;
  store.transact('Rename collection', () => meta(store, 'collections', id, { ...c, name: name.trim() }));
}
export function deleteCollection(store: DocStore, id: string) {
  store.transact('Delete collection', () => {
    for (const v of Object.values(store.doc.variables)) if (v.collectionId === id) deleteVariable(store, v.id);
    // clear explicit modes that pointed into this collection
    for (const nid of allNodes(store)) { const n = store.doc.nodes[nid]; if (n.modeOverrides?.[id]) { const m = { ...n.modeOverrides }; delete m[id]; store.apply({ t: 'set', id: nid, props: { modeOverrides: Object.keys(m).length ? m : undefined } }); } }
    meta(store, 'collections', id, null);
  });
}
export function addMode(store: DocStore, collectionId: string, name: string): string | null {
  const c = store.doc.collections[collectionId];
  if (!c || !name.trim() || c.modes.some(m => m.name === name.trim())) return null;
  const mode = { id: newId('mode'), name: name.trim() };
  store.transact('Add mode', () => {
    meta(store, 'collections', collectionId, { ...c, modes: [...c.modes, mode] });
    // new modes start as a copy of the default mode so bindings keep resolving
    for (const v of Object.values(store.doc.variables)) if (v.collectionId === collectionId && v.values[c.modes[0].id] !== undefined) meta(store, 'variables', v.id, { ...v, values: { ...v.values, [mode.id]: structuredClone(v.values[c.modes[0].id]) } });
  });
  return mode.id;
}
export function renameMode(store: DocStore, collectionId: string, modeId: string, name: string) {
  const c = store.doc.collections[collectionId];
  if (!c || !name.trim() || c.modes.some(m => m.name === name.trim() && m.id !== modeId)) return false;
  store.transact('Rename mode', () => meta(store, 'collections', collectionId, { ...c, modes: c.modes.map(m => (m.id === modeId ? { ...m, name: name.trim() } : m)) }));
  return true;
}
export function removeMode(store: DocStore, collectionId: string, modeId: string) {
  const c = store.doc.collections[collectionId];
  if (!c || c.modes.length < 2) return false;
  store.transact('Remove mode', () => {
    meta(store, 'collections', collectionId, { ...c, modes: c.modes.filter(m => m.id !== modeId) });
    for (const v of Object.values(store.doc.variables)) if (v.collectionId === collectionId && modeId in v.values) { const values = { ...v.values }; delete values[modeId]; meta(store, 'variables', v.id, { ...v, values }); }
    for (const nid of allNodes(store)) { const n = store.doc.nodes[nid]; if (n.modeOverrides?.[collectionId] === modeId) { const m = { ...n.modeOverrides }; delete m[collectionId]; store.apply({ t: 'set', id: nid, props: { modeOverrides: Object.keys(m).length ? m : undefined } }); } }
  });
  return true;
}

export function createVariable(store: DocStore, collectionId: string, name: string, type: VarType, initial?: VarValue, scopes: VarScope[] = ['ALL']): string | null {
  const c = store.doc.collections[collectionId];
  if (!c || !name.trim() || Object.values(store.doc.variables).some(v => v.collectionId === collectionId && v.name === name.trim())) return null;
  const id = newId('var');
  const v: Variable = { id, collectionId, name: name.trim(), type, scopes, values: Object.fromEntries(c.modes.map(m => [m.id, initial ?? defaultFor(type)])) };
  store.transact('Create variable', () => meta(store, 'variables', id, v));
  return id;
}
export function renameVariable(store: DocStore, id: string, name: string) {
  const v = store.doc.variables[id];
  if (!v || !name.trim() || Object.values(store.doc.variables).some(o => o.id !== id && o.collectionId === v.collectionId && o.name === name.trim())) return false;
  store.transact('Rename variable', () => meta(store, 'variables', id, { ...v, name: name.trim() }));
  return true;
}
export function setVariableScopes(store: DocStore, id: string, scopes: VarScope[]) {
  const v = store.doc.variables[id]; if (!v) return;
  store.transact('Edit variable scopes', () => meta(store, 'variables', id, { ...v, scopes }));
}

/** Set the value of a variable in one mode. Aliases must target the same type and may not create a cycle. */
export function setVariableValue(store: DocStore, varId: string, modeId: string, value: VarValue): boolean {
  const v = store.doc.variables[varId];
  const c = v && store.doc.collections[v.collectionId];
  if (!v || !c || !c.modes.some(m => m.id === modeId)) return false;
  if (typeof value === 'object') {
    const target = store.doc.variables[value.alias];
    if (!target || target.type !== v.type || target.id === v.id) return false;
    const seen = new Set([v.id]);
    for (let cur: Variable | undefined = target; cur; ) { // walk any mode chain; reject if it comes back to v
      if (seen.has(cur.id)) return false; seen.add(cur.id);
      const next = Object.values(cur.values).find(x => typeof x === 'object') as { alias: string } | undefined;
      cur = next ? store.doc.variables[next.alias] : undefined;
    }
  } else if (typeof value !== (v.type === 'COLOR' || v.type === 'STRING' ? 'string' : v.type === 'FLOAT' ? 'number' : 'boolean')) return false;
  else if (v.type === 'COLOR' && !/^#[0-9a-f]{6}$/i.test(value as string)) return false;
  else if (v.type === 'FLOAT' && !Number.isFinite(value as number)) return false;
  store.transact('Edit variable', () => meta(store, 'variables', varId, { ...v, values: { ...v.values, [modeId]: value } }));
  return true;
}

export function deleteVariable(store: DocStore, id: string) {
  const v = store.doc.variables[id]; if (!v) return;
  store.transact('Delete variable', () => {
    const c = store.doc.collections[v.collectionId];
    const resolveLiteral = (mode: string) => resolveVariable(store.doc, id, () => mode) ?? defaultFor(v.type);
    // aliases to this variable become the literal it resolved to, per mode
    for (const o of Object.values(store.doc.variables)) {
      if (o.id === id) continue;
      let changed = false; const values = { ...o.values };
      for (const [mid, val] of Object.entries(values)) if (typeof val === 'object' && val.alias === id) { values[mid] = resolveLiteral(c.modes.some(m => m.id === mid) ? mid : c.modes[0].id) as VarValue; changed = true; }
      if (changed) meta(store, 'variables', o.id, { ...o, values });
    }
    for (const nid of allNodes(store)) { // unbind (keeps the current resolved value on the node)
      const n = store.doc.nodes[nid];
      if (n.varBindings && Object.values(n.varBindings).includes(id)) { const b = Object.fromEntries(Object.entries(n.varBindings).filter(([, x]) => x !== id)); store.apply({ t: 'set', id: nid, props: { varBindings: Object.keys(b).length ? b : undefined } }); }
    }
    meta(store, 'variables', id, null);
  });
}

/** Bind a property path of nodes to a variable (type and scope checked). */
export function bindVariable(store: DocStore, ids: string[], path: string, varId: string): boolean {
  const info = pathInfo(path), v = store.doc.variables[varId];
  if (!info || !v || v.type !== info.type || !scopeAllows(v, info.scope)) return false;
  store.transact('Bind variable', () => { for (const id of ids) store.apply({ t: 'set', id, props: { varBindings: { ...(store.doc.nodes[id].varBindings ?? {}), [path]: varId } } }); });
  return true;
}
export function unbindVariable(store: DocStore, ids: string[], path: string) {
  store.transact('Detach variable', () => {
    for (const id of ids) { const b = { ...(store.doc.nodes[id].varBindings ?? {}) }; delete b[path]; store.apply({ t: 'set', id, props: { varBindings: Object.keys(b).length ? b : undefined } }); }
  });
}
/** Choose the variable mode for a frame's subtree (undefined = inherit). */
export function setNodeMode(store: DocStore, ids: string[], collectionId: string, modeId: string | undefined) {
  store.transact('Change variable mode', () => {
    for (const id of ids) { const m = { ...(store.doc.nodes[id].modeOverrides ?? {}) }; if (modeId) m[collectionId] = modeId; else delete m[collectionId]; store.apply({ t: 'set', id, props: { modeOverrides: Object.keys(m).length ? m : undefined } }); }
  });
}

// ================= styles =================

export function styleValueFrom(node: SceneNode, type: StyleType, which: 'fill' | 'stroke' = 'fill'): unknown {
  if (type === 'FILL') return { fills: structuredClone(which === 'stroke' ? node.strokes : node.fills) };
  if (type === 'EFFECT') return { effects: structuredClone(node.effects) };
  if (type === 'TEXT' && node.text) { const { fontFamily, fontSize, fontWeight, italic, lineHeight, letterSpacing } = node.text; return { fontFamily, fontSize, fontWeight, italic, lineHeight, letterSpacing }; }
  if (type === 'LAYOUT' && node.layout) return structuredClone(node.layout);
  return null;
}

/** Create a style from a node's current properties and attach the node to it. */
export function createStyle(store: DocStore, nodeId: string, type: StyleType, name: string, which: 'fill' | 'stroke' = 'fill'): string | null {
  const n = store.doc.nodes[nodeId];
  const value = n && styleValueFrom(n, type, which);
  if (!n || value === null || !name.trim() || Object.values(store.doc.styles).some(s => s.type === type && s.name === name.trim())) return null;
  const id = newId('style');
  const style: Style = { id, type, name: name.trim(), value };
  store.transact('Create style', () => { meta(store, 'styles', id, style); attachStyle(store, [nodeId], type, id, which); });
  return id;
}
const refKey = (type: StyleType, which: 'fill' | 'stroke'): keyof NonNullable<SceneNode['styleRefs']> => (type === 'FILL' ? which : (type.toLowerCase() as 'text' | 'effect' | 'layout'));
export function attachStyle(store: DocStore, ids: string[], type: StyleType, styleId: string, which: 'fill' | 'stroke' = 'fill'): boolean {
  const s = store.doc.styles[styleId];
  if (!s || s.type !== type) return false;
  store.transact('Apply style', () => {
    for (const id of ids) {
      const n = store.doc.nodes[id];
      if ((type === 'TEXT' && !n.text) || (type === 'LAYOUT' && !n.layout)) continue;
      store.apply({ t: 'set', id, props: { styleRefs: { ...(n.styleRefs ?? {}), [refKey(type, which)]: styleId } } });
    }
  });
  return true;
}
export function detachStyle(store: DocStore, ids: string[], type: StyleType, which: 'fill' | 'stroke' = 'fill') {
  store.transact('Detach style', () => {
    for (const id of ids) { const r = { ...(store.doc.nodes[id].styleRefs ?? {}) }; delete r[refKey(type, which)]; store.apply({ t: 'set', id, props: { styleRefs: Object.keys(r).length ? r : undefined } }); }
  });
}
/** Edit a style's value: every node that uses it updates (and keeps updating). */
export function updateStyle(store: DocStore, styleId: string, value: unknown) {
  const s = store.doc.styles[styleId]; if (!s) return;
  store.transact('Edit style', () => meta(store, 'styles', styleId, { ...s, value }));
}
export function renameStyle(store: DocStore, styleId: string, name: string) {
  const s = store.doc.styles[styleId];
  if (!s || !name.trim() || Object.values(store.doc.styles).some(o => o.id !== styleId && o.type === s.type && o.name === name.trim())) return false;
  store.transact('Rename style', () => meta(store, 'styles', styleId, { ...s, name: name.trim() }));
  return true;
}
export function deleteStyle(store: DocStore, styleId: string) {
  store.transact('Delete style', () => {
    for (const nid of allNodes(store)) {
      const n = store.doc.nodes[nid];
      if (n.styleRefs && Object.values(n.styleRefs).includes(styleId)) { const r = Object.fromEntries(Object.entries(n.styleRefs).filter(([, x]) => x !== styleId)); store.apply({ t: 'set', id: nid, props: { styleRefs: Object.keys(r).length ? r : undefined } }); }
    }
    meta(store, 'styles', styleId, null);
  });
}

// ================= tokens import =================

/** Merge a tokens file into the document (collections/variables matched by name; new modes appended). Returns counts. */
export function importTokens(store: DocStore, file: TokenFile): { collections: number; variables: number; skipped: string[] } {
  const skipped: string[] = [];
  let nc = 0, nv = 0;
  store.transact('Import tokens', () => {
    const colByName = (n: string) => Object.values(store.doc.collections).find(c => c.name === n);
    const varByFull = (full: string) => { const i = full.indexOf('/'); const c = colByName(full.slice(0, i)); return c ? Object.values(store.doc.variables).find(v => v.collectionId === c.id && v.name === full.slice(i + 1)) : undefined; };
    for (const fc of file.collections) {
      let col = colByName(fc.name);
      if (!col) { createCollection(store, fc.name, fc.modes); col = colByName(fc.name)!; nc++; }
      for (const m of fc.modes) if (!store.doc.collections[col.id].modes.some(x => x.name === m)) addMode(store, col.id, m);
      for (const fv of fc.variables) {
        if (!/^[^\s].*$/.test(fv.name)) { skipped.push(fv.name); continue; }
        let v = Object.values(store.doc.variables).find(x => x.collectionId === col!.id && x.name === fv.name);
        if (v && v.type !== fv.type) { skipped.push(`${fv.name} (type differs)`); continue; }
        if (!v) { const id = createVariable(store, col.id, fv.name, fv.type, undefined, fv.scopes ?? ['ALL']); if (!id) { skipped.push(fv.name); continue; } v = store.doc.variables[id]; nv++; }
        void v;
      }
    }
    // second pass: values (aliases need every variable to exist)
    for (const fc of file.collections) {
      const col = colByName(fc.name)!;
      for (const fv of fc.variables) {
        const v = Object.values(store.doc.variables).find(x => x.collectionId === col.id && x.name === fv.name);
        if (!v || v.type !== fv.type) continue;
        for (const [modeName, val] of Object.entries(fv.values)) {
          const mode = store.doc.collections[col.id].modes.find(m => m.name === modeName);
          if (!mode) { skipped.push(`${fv.name}: unknown mode ${modeName}`); continue; }
          const value: VarValue | undefined = typeof val === 'object' ? (() => { const t = varByFull(val.alias); return t ? { alias: t.id } : undefined; })() : val;
          if (value === undefined || !setVariableValue(store, v.id, mode.id, value)) skipped.push(`${fv.name}: invalid value for ${modeName}`);
        }
      }
    }
  });
  return { collections: nc, variables: nv, skipped };
}
void (null as unknown as { a: Paint; b: Effect; c: AutoLayout; d: TextProps; e: typeof topLevelOnly; f: typeof subtree });
