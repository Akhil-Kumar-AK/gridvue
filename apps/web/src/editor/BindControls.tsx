import type { ReactNode } from 'react';
import { bindVariable, detachStyle, attachStyle, createStyle, pathInfo, scopeAllows, unbindVariable, type SceneNode, type StyleType } from '@layr/core';
import type { EditorSession } from './session';
import { useEditor, type MenuItem } from './state';
import { Icon } from '../icons';
import { askText, askConfirm } from '../ui/dialogs';

/** The variable bound at `path` on every node, or null (mixed / unbound). */
export function boundVar(nodes: SceneNode[], path: string): string | null {
  const first = nodes[0]?.varBindings?.[path];
  return first && nodes.every(n => n.varBindings?.[path] === first) ? first : null;
}

export function VarMenuButton({ session, ids, path, ro }: { session: EditorSession; ids: string[]; path: string; ro: boolean }) {
  const doc = session.store.doc;
  const info = pathInfo(path);
  const open = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cur = boundVar(ids.map(i => doc.nodes[i]), path);
    const items: MenuItem[] = [];
    const vars = Object.values(doc.variables).filter(v => info && v.type === info.type && scopeAllows(v, info.scope));
    for (const col of Object.values(doc.collections)) {
      const list = vars.filter(v => v.collectionId === col.id);
      if (!list.length) continue;
      items.push({ label: col.name.toUpperCase(), disabled: true });
      for (const v of list) items.push({ label: `${cur === v.id ? '✓ ' : '   '}${v.name}`, run: () => { if (!bindVariable(session.store, ids, path, v.id)) useEditor.getState().toast('That variable cannot be bound here', 'error'); } });
    }
    if (!items.length) items.push({ label: 'No compatible variables yet', disabled: true });
    items.push({ label: '', separator: true });
    if (cur) items.push({ label: 'Detach variable', run: () => unbindVariable(session.store, ids, path) });
    items.push({ label: 'Local variables…', run: () => useEditor.getState().set({ leftTab: 'variables' }) });
    useEditor.getState().set({ menu: { x: Math.min(r.left, window.innerWidth - 240), y: r.bottom + 4, items } });
  };
  return <button className="icon-btn vbtn" disabled={ro} title="Bind a variable" aria-label={`Bind variable to ${path}`} onClick={open}><Icon n="variable" size={14} /></button>;
}

/** Wraps a control: shows the control + a variable button, or a chip when the property is variable-bound. */
export function Bindable({ session, ids, path, ro, children }: { session: EditorSession; ids: string[]; path: string; ro: boolean; children: ReactNode }) {
  const doc = session.store.doc;
  const vid = boundVar(ids.map(i => doc.nodes[i]), path);
  const v = vid ? doc.variables[vid] : null;
  if (v) {
    const val = ids.length === 1 ? previewValue(session, ids[0], path) : '';
    return (
      <div className="vchip" title={`Bound to ${doc.collections[v.collectionId]?.name}/${v.name}`}>
        <Icon n="variable" size={13} /><span className="vname">{v.name}</span>{val !== '' && <span className="vval">{val}</span>}
        <button className="icon-btn" disabled={ro} title="Detach variable" aria-label="Detach variable" onClick={() => unbindVariable(session.store, ids, path)}><Icon n="close" size={11} /></button>
      </div>
    );
  }
  return <div className="bindable">{children}<VarMenuButton session={session} ids={ids} path={path} ro={ro} /></div>;
}
function previewValue(session: EditorSession, id: string, path: string): string {
  const n = session.store.doc.nodes[id];
  let m: RegExpExecArray | null;
  if ((m = /^(fills|strokes)\.(\d+)\.color$/.exec(path))) { const p = n[m[1] as 'fills'][Number(m[2])]; return p?.type === 'SOLID' ? p.color.toUpperCase() : ''; }
  if (path === 'opacity') return `${Math.round(n.opacity * 100)}`;
  if (path === 'visible') return n.visible ? 'on' : 'off';
  if (path === 'text.characters') return (n.text?.characters ?? '').slice(0, 14);
  if (path === 'text.fontSize') return String(n.text?.fontSize ?? '');
  if (path.startsWith('layout.')) return String(n.layout?.[path.slice(7) as 'gap'] ?? '');
  return String((n as unknown as Record<string, unknown>)[path] ?? '');
}

/** Section-header button for shared styles of one type. */
export function StyleMenuButton({ session, ids, type, which = 'fill', ro }: { session: EditorSession; ids: string[]; type: StyleType; which?: 'fill' | 'stroke'; ro: boolean }) {
  const doc = session.store.doc;
  const key = type === 'FILL' ? which : (type.toLowerCase() as 'text' | 'effect' | 'layout');
  const open = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cur = doc.nodes[ids[0]]?.styleRefs?.[key];
    const items: MenuItem[] = Object.values(doc.styles).filter(s => s.type === type).map(s => ({ label: `${cur === s.id ? '✓ ' : '   '}${s.name}`, run: () => attachStyle(session.store, ids, type, s.id, which) }));
    if (!items.length) items.push({ label: 'No styles yet', disabled: true });
    items.push({ label: '', separator: true });
    items.push({ label: 'Create style from this…', disabled: ids.length !== 1, run: () => { void askText(`${type[0] + type.slice(1).toLowerCase()} style name`, '', { okLabel: 'Create' }).then(name => { if (name && !createStyle(session.store, ids[0], type, name, which)) useEditor.getState().toast('Could not create style (name taken or nothing to capture)', 'error'); }); } });
    if (cur) items.push({ label: 'Detach style', run: () => detachStyle(session.store, ids, type, which) });
    useEditor.getState().set({ menu: { x: Math.min(r.left - 160, window.innerWidth - 240), y: r.bottom + 4, items } });
  };
  return <button className="icon-btn" disabled={ro} title="Styles" aria-label={`${type === 'FILL' && which === 'stroke' ? 'stroke' : type.toLowerCase()} styles`} onClick={open}><Icon n="styleDots" size={16} /></button>;
}

/** Chip shown in a section when a style drives it. */
export function StyleChip({ session, ids, type, which = 'fill', ro }: { session: EditorSession; ids: string[]; type: StyleType; which?: 'fill' | 'stroke'; ro: boolean }) {
  const doc = session.store.doc;
  const key = type === 'FILL' ? which : (type.toLowerCase() as 'text' | 'effect' | 'layout');
  const id = doc.nodes[ids[0]]?.styleRefs?.[key];
  const s = id && ids.every(i => doc.nodes[i].styleRefs?.[key] === id) ? doc.styles[id] : null;
  if (!s) return null;
  return <div className="vchip style" title="Edit this style from Assets → Styles"><Icon n="styleDots" size={13} /><span className="vname">{s.name}</span><button className="icon-btn" disabled={ro} title="Detach style" aria-label="Detach style" onClick={() => detachStyle(session.store, ids, type, which)}><Icon n="close" size={11} /></button></div>;
}
export const isStyled = (nodes: SceneNode[], type: StyleType, which: 'fill' | 'stroke' = 'fill') => {
  const key = type === 'FILL' ? which : (type.toLowerCase() as 'text' | 'effect' | 'layout');
  const id = nodes[0]?.styleRefs?.[key];
  return !!id && nodes.every(n => n.styleRefs?.[key] === id);
};
