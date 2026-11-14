import { togglePathClosed, createComponentSet, addAutoLayout, removeAutoLayout, createComponent, createInstance, detachInstance, resetOverrides, enclosingInstance, addNode, deleteNodes, duplicate, groupNodes, reorder, setProps, topLevelOnly, ungroupNodes, type AlignMode, defaultNode } from '@layr/core';
import { useEditor, type MenuItem, type Tool } from './state';
import type { CanvasController } from './controller';
import { BOOL_ITEMS, runBoolItem } from './boolMenu';
import type { EditorSession } from './session';

export interface Action { id: string; label: string; shortcut?: string; group: string; enabled: () => boolean; run: () => void }

export const isMac = navigator.platform.toLowerCase().includes('mac');
export const mod = isMac ? '⌘' : 'Ctrl+';

/** Single registry used by keyboard shortcuts, the context menu, the command palette and toolbar buttons. */
export function buildActions(session: EditorSession, ctrl: () => CanvasController | null): Action[] {
  const ui = () => useEditor.getState();
  const store = session.store;
  const sel = () => topLevelOnly(store, ui().selection);
  const canEdit = () => session.canEdit && !store.inTransaction;
  const hasSel = () => canEdit() && sel().length > 0;
  const tool = (t: Tool) => () => ctrl()?.setTool(t);
  const A = (id: string, label: string, group: string, run: () => void, enabled: () => boolean = () => true, shortcut?: string): Action => ({ id, label, group, run, enabled, shortcut });
  const al = (m: AlignMode) => () => ctrl()?.alignSelection(m);

  return [
    A('tool.select', 'Move tool', 'Tools', tool('select'), () => true, 'V'),
    A('tool.hand', 'Hand tool', 'Tools', tool('hand'), () => true, 'H'),
    A('tool.frame', 'Frame tool', 'Tools', tool('frame'), canEdit, 'F'),
    A('tool.section', 'Section tool', 'Tools', tool('section'), canEdit),
    A('tool.rect', 'Rectangle tool', 'Tools', tool('rect'), canEdit, 'R'),
    A('tool.ellipse', 'Ellipse tool', 'Tools', tool('ellipse'), canEdit, 'O'),
    A('tool.arrow', 'Arrow tool', 'Tools', tool('arrow'), canEdit, '⇧L'),
    A('tool.textpath', 'Text on path tool', 'Tools', tool('textpath'), canEdit),
    ...BOOL_ITEMS.map(it => A(it.id, `${it.label} selection`, 'Object', () => runBoolItem(session, sel(), it), canEdit, it.shortcut)),
    A('tool.star', 'Star tool', 'Tools', tool('star'), canEdit),
    A('tool.polygon', 'Polygon tool', 'Tools', tool('polygon'), canEdit),
    A('tool.line', 'Line tool', 'Tools', tool('line'), canEdit, 'L'),
    A('tool.pen', 'Pen tool', 'Tools', tool('pen'), canEdit, 'P'),
    A('tool.brush', 'Brush tool', 'Tools', tool('brush'), canEdit, 'B'),
    A('tool.pencil', 'Pencil tool', 'Tools', tool('pencil'), canEdit, '⇧P'),
    A('vec.edit', 'Edit path', 'Vector', () => { const id = sel()[0]; if (id) ctrl()?.startVectorEdit(id); }, () => canEdit() && sel().length === 1 && store.doc.nodes[sel()[0]]?.type === 'VECTOR', '↵'),
    A('vec.close', 'Close / open path', 'Vector', () => { for (const i of sel()) togglePathClosed(store, i); }, () => hasSel() && sel().every(i => store.doc.nodes[i].type === 'VECTOR')),
    A('tool.text', 'Text tool', 'Tools', tool('text'), canEdit, 'T'),
    A('edit.undo', 'Undo', 'Edit', () => { store.undo(); }, () => session.canEdit && store.canUndo && !store.inTransaction, `${mod}Z`),
    A('edit.redo', 'Redo', 'Edit', () => { store.redo(); }, () => session.canEdit && store.canRedo && !store.inTransaction, `${mod}⇧Z`),
    A('edit.duplicate', 'Duplicate', 'Edit', () => { const ids = duplicate(store, sel()); ui().set({ selection: ids }); }, hasSel, `${mod}D`),
    A('edit.delete', 'Delete', 'Edit', () => { deleteNodes(store, sel()); ui().set({ selection: [] }); }, hasSel, '⌫'),
    A('edit.copy', 'Copy', 'Edit', () => { const n = session.copy(sel()); if (n) ui().toast(`Copied ${n} layer${n > 1 ? 's' : ''}`); }, () => sel().length > 0, `${mod}C`),
    A('edit.cut', 'Cut', 'Edit', () => { session.copy(sel()); deleteNodes(store, sel()); ui().set({ selection: [] }); }, hasSel, `${mod}X`),
    A('edit.paste', 'Paste', 'Edit', () => { const ids = session.paste(); if (ids.length) ui().set({ selection: ids }); }, () => canEdit() && session.clipboard.length > 0, `${mod}V`),
    A('edit.selectAll', 'Select all', 'Edit', () => {
      const first = sel()[0];
      const scope = first ? store.doc.nodes[store.doc.nodes[first].parent!] : store.doc.nodes[ui().pageId];
      ui().set({ selection: scope.children.filter(c => store.doc.nodes[c].visible && !store.doc.nodes[c].locked) });
    }, () => true, `${mod}A`),
    A('edit.deselect', 'Deselect', 'Edit', () => ui().set({ selection: [] }), () => true, 'Esc'),
    A('arrange.group', 'Group selection', 'Arrange', () => { const g = groupNodes(store, sel()); if (g) ui().set({ selection: [g] }); }, hasSel, `${mod}G`),
    A('arrange.frame', 'Frame selection', 'Arrange', () => { const g = groupNodes(store, sel(), 'FRAME'); if (g) ui().set({ selection: [g] }); }, hasSel, `${mod}⌥G`),
    A('arrange.ungroup', 'Ungroup', 'Arrange', () => { const ids = ungroupNodes(store, sel()); ui().set({ selection: ids }); }, () => hasSel() && sel().some(i => ['GROUP', 'FRAME'].includes(store.doc.nodes[i].type)), `${mod}⇧G`),
    A('arrange.front', 'Bring to front', 'Arrange', () => reorder(store, sel(), 'front'), hasSel, `${mod}]`),
    A('arrange.forward', 'Bring forward', 'Arrange', () => reorder(store, sel(), 'forward'), hasSel, ']'),
    A('arrange.backward', 'Send backward', 'Arrange', () => reorder(store, sel(), 'backward'), hasSel, '['),
    A('arrange.back', 'Send to back', 'Arrange', () => reorder(store, sel(), 'back'), hasSel, `${mod}[`),
    A('arrange.lock', 'Lock / unlock', 'Arrange', () => { const ids = sel(); const lock = !ids.every(i => store.doc.nodes[i].locked); setProps(store, ids, { locked: lock }, lock ? 'Lock' : 'Unlock'); }, hasSel, `${mod}⇧L`),
    A('arrange.hide', 'Show / hide', 'Arrange', () => { const ids = sel(); const hide = ids.every(i => store.doc.nodes[i].visible); setProps(store, ids, { visible: !hide }, hide ? 'Hide' : 'Show'); }, hasSel, `${mod}⇧H`),
    A('layout.add', 'Add auto layout', 'Layout', () => { const f = addAutoLayout(store, sel()); if (f) ui().set({ selection: [f] }); }, hasSel, '⇧A'),
    A('layout.remove', 'Remove auto layout', 'Layout', () => removeAutoLayout(store, sel()), () => hasSel() && sel().some(i => !!store.doc.nodes[i].layout), `${mod}⌥⇧A`),
    A('comp.create', 'Create component', 'Components', () => { const c = createComponent(store, sel()); if (c) ui().set({ selection: [c] }); }, hasSel, `${mod}⌥K`),
    A('comp.variants', 'Combine as variants', 'Components', () => { const g = createComponentSet(store, sel()); if (g) ui().set({ selection: [g] }); }, () => hasSel() && sel().some(i => store.doc.nodes[i].type === 'COMPONENT' && store.doc.nodes[store.doc.nodes[i].parent!].type !== 'COMPONENT_SET'), `${mod}⇧K`),
    A('comp.instance', 'Create instance of component', 'Components', () => { const id = sel().find(i => store.doc.nodes[i].type === 'COMPONENT'); if (!id) return; const n = createInstance(store, id); if (n) ui().set({ selection: [n] }); }, () => hasSel() && sel().some(i => store.doc.nodes[i].type === 'COMPONENT')),
    A('comp.detach', 'Detach instance', 'Components', () => { const ids = detachInstance(store, sel()); ui().set({ selection: ids }); }, () => hasSel() && sel().some(i => store.doc.nodes[i].type === 'INSTANCE'), `${mod}⌥B`),
    A('comp.reset', 'Reset all overrides', 'Components', () => resetOverrides(store, sel()), () => hasSel() && sel().some(i => !!enclosingInstance(store.doc, i))),
    A('comp.goMain', 'Go to main component', 'Components', () => { const i = store.doc.nodes[sel()[0]]; const c = i?.componentId; if (c && store.doc.nodes[c]) { ui().set({ selection: [c] }); ctrl()?.zoomToSelection(); } }, () => sel().length === 1 && store.doc.nodes[sel()[0]]?.type === 'INSTANCE'),
    A('align.left', 'Align left', 'Align', al('left'), hasSel), A('align.hcenter', 'Align horizontal centers', 'Align', al('hcenter'), hasSel), A('align.right', 'Align right', 'Align', al('right'), hasSel),
    A('align.top', 'Align top', 'Align', al('top'), hasSel), A('align.vcenter', 'Align vertical centers', 'Align', al('vcenter'), hasSel), A('align.bottom', 'Align bottom', 'Align', al('bottom'), hasSel),
    A('view.fit', 'Zoom to fit', 'View', () => ctrl()?.zoomToFit(), () => true, '⇧1'),
    A('view.selection', 'Zoom to selection', 'View', () => ctrl()?.zoomToSelection(), () => true, '⇧2'),
    A('view.100', 'Zoom to 100%', 'View', () => ctrl()?.zoomTo(1), () => true, '⇧0'),
    A('view.in', 'Zoom in', 'View', () => ctrl()?.zoomBy(1.25), () => true, `${mod}+`),
    A('view.out', 'Zoom out', 'View', () => ctrl()?.zoomBy(0.8), () => true, `${mod}−`),
    A('view.theme', 'Toggle light / dark theme', 'View', () => { const t = ui().theme === 'dark' ? 'light' : 'dark'; ui().set({ theme: t }); try { localStorage.setItem('layr:theme', t); } catch { /* ignore */ } }, () => true),
    A('proto.present', 'Present prototype', 'Prototype', () => window.dispatchEvent(new Event('layr:present')), () => true, `${mod}⌥↵`),
    A('mode.design', 'Design mode', 'Prototype', () => ui().set({ mode: 'design' }), () => true),
    A('mode.proto', 'Prototype mode', 'Prototype', () => ui().set({ mode: 'prototype', tool: 'select' }), () => true),
    A('vars.open', 'Open variables', 'Variables', () => ui().set({ leftTab: 'variables' }), () => true),
    A('file.export', 'Export selection…', 'File', () => ui().set({ exportOpen: true }), () => true, `${mod}⇧E`),
    A('file.exportNative', 'Export native file (.layr)', 'File', () => void session.exportNative(), () => true),
    A('file.exportFig', 'Export as Figma file (.fig)', 'File', () => void session.exportFigFile(), () => true),
    A('file.exportXd', 'Export as Adobe XD file (.xd)', 'File', () => void session.exportXdFile(), () => true),
    A('file.share', 'Share…', 'File', () => ui().set({ shareOpen: true }), () => session.role === 'owner'),
    A('file.addPage', 'Add page', 'File', () => session.addPage(), canEdit),
    A('file.addRect', 'Insert rectangle at center', 'Insert', () => {
      const c = ui().camera; const cx = c.x + 300 / c.zoom, cy = c.y + 200 / c.zoom;
      const n = defaultNode('RECT', { name: 'Rectangle', x: cx, y: cy }); const pid = session.insertionParent();
      addNode(store, n, pid); ui().set({ selection: [n.id] });
    }, canEdit),
  ];
}

export function contextMenuItems(actions: Action[]): MenuItem[] {
  const by = (id: string): MenuItem => { const a = actions.find(x => x.id === id)!; return { label: a.label, shortcut: a.shortcut, disabled: !a.enabled(), run: a.run }; };
  const sep: MenuItem = { label: '', separator: true };
  return [by('edit.copy'), by('edit.cut'), by('edit.paste'), by('edit.duplicate'), sep, by('arrange.group'), by('arrange.frame'), by('arrange.ungroup'), by('layout.add'), by('comp.create'), by('comp.variants'), by('comp.instance'), by('comp.detach'), by('comp.goMain'), sep, by('arrange.front'), by('arrange.back'), sep, by('arrange.lock'), by('arrange.hide'), sep, by('file.export'), sep, by('edit.delete')];
}

/** key -> action id (without modifiers handled separately) */
export function shortcutFor(e: KeyboardEvent): string | null {
  const m = isMac ? e.metaKey : e.ctrlKey;
  const k = e.key.toLowerCase();
  if (m && !e.shiftKey && !e.altKey) {
    const map: Record<string, string> = { z: 'edit.undo', y: 'edit.redo', d: 'edit.duplicate', g: 'arrange.group', c: 'edit.copy', x: 'edit.cut', v: 'edit.paste', a: 'edit.selectAll', ']': 'arrange.front', '[': 'arrange.back', '=': 'view.in', '+': 'view.in', '-': 'view.out', '0': 'view.100' };
    return map[k] ?? null;
  }
  if (m && e.shiftKey && !e.altKey) { const map: Record<string, string> = { z: 'edit.redo', g: 'arrange.ungroup', l: 'arrange.lock', h: 'arrange.hide', e: 'file.export', k: 'comp.variants' }; return map[k] ?? null; }
  if (!m && e.altKey && e.shiftKey) { const bm: Record<string, string> = { KeyU: 'bool.union', KeyS: 'bool.subtract', KeyI: 'bool.intersect', KeyE: 'bool.exclude', KeyF: 'bool.flatten' }; return bm[e.code] ?? null; }
  if (m && e.altKey && e.shiftKey) { return e.code === 'KeyA' ? 'layout.remove' : null; }
  if (m && e.altKey) { return e.code === 'Enter' ? 'proto.present' : e.code === 'KeyG' ? 'arrange.frame' : e.code === 'KeyK' ? 'comp.create' : e.code === 'KeyB' ? 'comp.detach' : null; }
  if (e.altKey) return null;
  if (e.shiftKey) { if (e.code === 'KeyA') return 'layout.add'; if (e.code === 'KeyP') return 'tool.pencil'; const map: Record<string, string> = { '!': 'view.fit', '@': 'view.selection', ')': 'view.100' }; if (map[e.key]) return map[e.key]; if (e.code === 'Digit1') return 'view.fit'; if (e.code === 'Digit2') return 'view.selection'; if (e.code === 'Digit0') return 'view.100'; return null; }
  const map: Record<string, string> = { v: 'tool.select', h: 'tool.hand', f: 'tool.frame', r: 'tool.rect', o: 'tool.ellipse', l: 'tool.line', t: 'tool.text', p: 'tool.pen', b: 'tool.brush', ']': 'arrange.forward', '[': 'arrange.backward', backspace: 'edit.delete', delete: 'edit.delete', escape: 'edit.deselect' };
  return map[k] ?? null;
}
