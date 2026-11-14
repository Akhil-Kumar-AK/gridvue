import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { attachStyle, deleteStyle, renameStyle, styleValueFrom, updateStyle, pageIds, reparent, renameNode, setProps, topLevelOnly, createInstance, type SceneNode } from '@layr/core';
import { useEditor, storage } from './state';
import type { EditorSession } from './session';
import type { Action } from './actions';
import { BrandMark, Icon, type IconName } from '../icons';
import { askText, askConfirm } from '../ui/dialogs';
import { DesignSystemSection } from './DesignSystemPanel';

const TYPE_ICON: Record<string, IconName> = { FRAME: 'frame', GROUP: 'group', RECT: 'rect', ELLIPSE: 'ellipse', LINE: 'line', TEXT: 'text', COMPONENT: 'component', COMPONENT_SET: 'components', INSTANCE: 'instance', VECTOR: 'pen' };
type DropPos = 'before' | 'inside' | 'after';

function iconFor(n: SceneNode): IconName {
  if (n.isMask) return 'mask';
  if (n.boolOp) return 'boolean';
  if (n.type === 'FRAME' && n.layout) return 'layers';
  if (n.type === 'RECT' && n.fills.some(f => f.type === 'IMAGE')) return 'image';
  return TYPE_ICON[n.type] ?? 'rect';
}

export function LeftPanel({ session, actions, onExit }: { session: EditorSession; actions: Action[]; onExit: () => void }) {
  const store = session.store;
  useSyncExternalStore(store.subscribe.bind(store), () => store.version);
  const { selection, pageId, hoverId, hoverFrom, saveStatus } = useEditor();
  const set = useEditor(s => s.set);
  const tab = useEditor(s => s.leftTab);
  const panelCollapsed = useEditor(s => s.leftCollapsed);
  const leftWidth = useEditor(s => s.leftWidth);
  const theme = useEditor(s => s.theme);
  const setTab = (t: 'file' | 'assets' | 'variables') => set({ leftTab: t });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const [dragIds, setDragIds] = useState<string[]>([]);
  const [pageQ, setPageQ] = useState<string | null>(null);
  const [assetQ, setAssetQ] = useState('');
  const doc = store.doc;
  const canEdit = session.canEdit;
  const pages = pageIds(doc);
  const shownPages = pageQ ? pages.filter(p => doc.nodes[p].name.toLowerCase().includes(pageQ.toLowerCase())) : pages;
  const statusText = { saved: 'Saved', dirty: 'Unsaved…', saving: 'Saving…', offline: 'Offline', conflict: 'Conflict', error: 'Not saved', readonly: 'View only' }[saveStatus];

  const clickRow = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) set({ selection: selection.includes(id) ? selection.filter(i => i !== id) : [...selection, id] });
    else set({ selection: [id] });
  };
  const onDrop = (target: SceneNode, pos: DropPos) => {
    const ids = topLevelOnly(store, dragIds);
    setDrop(null); setDragIds([]);
    if (!ids.length || ids.includes(target.id)) return;
    if (pos === 'inside') reparent(store, ids, target.id, undefined, 'Move layers');
    else {
      const parent = doc.nodes[target.parent!];
      const idx = parent.children.indexOf(target.id) + (pos === 'before' ? 1 : 0); // child order is bottom→top; panel is top→bottom
      reparent(store, ids, parent.id, idx, 'Move layers');
    }
  };

  /** is `child` somewhere below `anc` (used to light up a collapsed folder that hides the hovered layer) */
  const inside = (child: string, anc: string) => { let c = doc.nodes[child]?.parent; while (c) { if (c === anc) return true; c = doc.nodes[c]?.parent ?? null; } return false; };
  // hovering an object on the canvas brings its row into view in the panel
  useEffect(() => {
    if (!hoverId || hoverFrom !== 'canvas') return;
    let target: string | null = hoverId, anc = doc.nodes[hoverId]?.parent;
    while (anc) { if (collapsed.has(anc)) target = anc; anc = doc.nodes[anc]?.parent ?? null; } // a collapsed folder hides it: show the folder
    document.querySelector(`[data-layer-id="${target}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hoverId, hoverFrom]);

  const row = (id: string, depth: number): React.ReactNode => {
    const n = doc.nodes[id];
    const hasKids = n.children.length > 0 && n.type !== 'TEXT';
    const open = !collapsed.has(id);
    const selected = selection.includes(id);
    const purple = n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' || n.type === 'INSTANCE';
    return (
      <div key={id}>
        <div
          data-layer-id={id}
          className={`layer${selected ? ' sel' : ''}${hoverId === id && !selected ? ' hov' : ''}${hoverId && hoverId !== id && !selected && !open && inside(hoverId, id) ? ' hov-in' : ''}${n.visible ? '' : ' dim'}${purple ? ' comp' : ''}${drop?.id === id ? ` drop-${drop.pos}` : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          draggable={canEdit && renaming !== id}
          onDragStart={e => { const ids = selected ? selection : [id]; setDragIds(ids); e.dataTransfer.setData('text/plain', 'layer'); e.dataTransfer.effectAllowed = 'move'; if (!selected) set({ selection: [id] }); }}
          onDragOver={e => {
            if (!dragIds.length) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height;
            const container = ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET'].includes(n.type);
            setDrop({ id, pos: y < 0.28 ? 'before' : y > 0.72 ? 'after' : container ? 'inside' : y < 0.5 ? 'before' : 'after' });
          }}
          onDragLeave={() => setDrop(d => (d?.id === id ? null : d))}
          onDrop={e => { e.preventDefault(); if (drop) onDrop(n, drop.pos); }}
          onDragEnd={() => { setDrop(null); setDragIds([]); }}
          onClick={e => { e.stopPropagation(); clickRow(id, e); }}
          onMouseEnter={() => set({ hoverId: id, hoverFrom: 'panel' })} onMouseLeave={() => set({ hoverId: null, hoverFrom: null })}
          onDoubleClick={() => canEdit && setRenaming(id)}
        >
          <span className="chev" onClick={e => { e.stopPropagation(); setCollapsed(c => { const x = new Set(c); if (x.has(id)) x.delete(id); else x.add(id); return x; }); }}>{hasKids && <Icon n={open ? 'chevD' : 'chevR'} size={12} />}</span>
          <span className="licon"><Icon n={iconFor(n)} size={14} /></span>
          {renaming === id
            ? <input autoFocus defaultValue={n.name} onClick={e => e.stopPropagation()}
                onBlur={e => { setRenaming(null); const v = e.target.value.trim(); if (v && v !== n.name) renameNode(store, id, v); }}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); e.stopPropagation(); }} />
            : <span className="lname">{n.name}</span>}
          <span className="lactions">
            <button title={n.locked ? 'Unlock' : 'Lock'} disabled={!canEdit} className={n.locked ? 'always' : ''} onClick={e => { e.stopPropagation(); setProps(store, [id], { locked: !n.locked }, n.locked ? 'Unlock' : 'Lock'); }}><Icon n={n.locked ? 'lock' : 'unlock'} size={13} /></button>
            <button title={n.visible ? 'Hide' : 'Show'} disabled={!canEdit} className={n.visible ? '' : 'always'} onClick={e => { e.stopPropagation(); setProps(store, [id], { visible: !n.visible }, n.visible ? 'Hide' : 'Show'); }}><Icon n={n.visible ? 'eye' : 'eyeOff'} size={13} /></button>
          </span>
        </div>
        {hasKids && open && [...n.children].reverse().map(c => row(c, depth + 1))}
      </div>
    );
  };

  const comps = useMemo(() => Object.values(doc.nodes).filter(n => n.type === 'COMPONENT' && !n.libRef), [store.version]); // copies of design-system components are used through the Design system section
  const rail = (t: 'file' | 'assets' | 'variables', icon: IconName, label: string) => <button className={'rail-btn' + (tab === t ? ' on' : '')} title={label} aria-label={label} aria-pressed={tab === t} onClick={() => setTab(t)}><Icon n={icon} size={18} /></button>;

  return (
    <div className="left">
      <nav className="rail" aria-label="Sidebar">
        <button className="rail-btn logo-btn" title="Main menu" aria-label="Main menu" onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          const a = (id: string) => actions.find(x => x.id === id)!;
          const it = (id: string) => ({ label: a(id).label, shortcut: a(id).shortcut, disabled: !a(id).enabled(), run: a(id).run });
          set({ menu: { x: r.right + 6, y: r.top, items: [{ label: 'Back to files', run: async () => { await session.saveNow(); onExit(); } }, { label: '', separator: true }, it('edit.undo'), it('edit.redo'), { label: '', separator: true }, it('file.export'), it('file.exportNative'), it('file.exportFig'), it('file.exportXd'), it('file.share'), it('file.addPage'), { label: '', separator: true }, it('view.theme')] } });
        }}><BrandMark size={26} /></button>
        <span className="rail-sep" />
        {rail('file', 'file', 'File')}
        {rail('assets', 'book', 'Assets')}
        {rail('variables', 'settings', 'Variables')}
        <span className="spacer" />
        <button className="rail-btn" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => { const t = theme === 'dark' ? 'light' : 'dark'; set({ theme: t }); storage.set('layr:theme', t); }}><Icon n={theme === 'dark' ? 'sun' : 'moon'} size={18} /></button>
        <button className="rail-btn" aria-label={panelCollapsed ? 'Show side panel' : 'Hide side panel'} aria-pressed={panelCollapsed} title={`${panelCollapsed ? 'Show' : 'Hide'} side panel (⌘\\)`} onClick={() => { set({ leftCollapsed: !panelCollapsed }); storage.set('layr:leftCollapsed', panelCollapsed ? '0' : '1'); }}><Icon n={panelCollapsed ? 'panelOpen' : 'panelClose'} size={18} /></button>
        <button className="rail-btn" title="Command search (⌘K)" onClick={() => set({ paletteOpen: true })}><Icon n="search" size={18} /></button>
      </nav>
      {tab !== 'variables' && <div className={'left-main' + (panelCollapsed ? ' away' : '')} aria-hidden={panelCollapsed} style={{ width: Math.max(160, leftWidth - 50) }}>
        <div className="file-head">
          <div className="file-title" title="Back to files · rename in the field" >
            <FileTitle session={session} />
          </div>
          <div className="file-sub chips">
            <span data-testid="save-status" className={`chipst st ${saveStatus}`}>{saveStatus === 'saved' && <Icon n="check" size={13} />}{statusText}</span>
            {session.file.type === 'designsystem' && <span className="chipmuted ds-chip">Design system</span>}
            <span className="chipmuted">{session.file.projectId ? 'Project' : 'Drafts'}</span>
            {session.role !== 'owner' && <span className="chipmuted">{session.role}</span>}
          </div>
        </div>
        {tab === 'file' ? <>
          <div className="sec-head">
            {pageQ === null ? <span className="sec-title">Pages</span> : <input autoFocus className="page-q" placeholder="Filter pages" value={pageQ} onChange={e => setPageQ(e.target.value)} onBlur={() => !pageQ && setPageQ(null)} />}
            <span className="sec-btns">
              <button className="icon-btn" title="Filter pages" onClick={() => setPageQ(pageQ === null ? '' : null)}><Icon n="search" size={15} /></button>
              <button className="icon-btn" disabled={!canEdit} title="Add page" aria-label="Add page" onClick={() => session.addPage()}><Icon n="plus" size={15} /></button>
            </span>
          </div>
          <div className="pages">
            {shownPages.map(p => (
              <div key={p} className={'page-row' + (p === pageId ? ' sel' : '')} onClick={() => set({ pageId: p, selection: [] })}
                onDoubleClick={() => { if (!canEdit) return; void askText('Rename page', doc.nodes[p].name, { okLabel: 'Rename' }).then(name => { if (name?.trim()) renameNode(store, p, name.trim()); }); }}>
                <span className="pgname"><Icon n="file" size={16} />{doc.nodes[p].name}</span>
                {pages.length > 1 && canEdit && <button className="icon-btn" title="Delete page" onClick={e => { e.stopPropagation(); void askConfirm(`Delete "${doc.nodes[p].name}"?`, { message: 'The page and all its layers will be removed.', okLabel: 'Delete', danger: true }).then(yes => { if (yes) { const next = pages.find(x => x !== p)!; store.transact('Delete page', () => store.apply({ t: 'remove', id: p })); set({ pageId: next, selection: [] }); } }); }}><Icon n="minus" size={13} /></button>}
              </div>
            ))}
          </div>
          <div className="sec-head">
            <span className="sec-title">Layers</span>
            <span className="sec-btns"><button className="icon-btn" title="Collapse all layers" onClick={() => setCollapsed(new Set(Object.values(doc.nodes).filter(n => n.children.length).map(n => n.id)))}><Icon n="collapse" size={15} /></button></span>
          </div>
          <div className="layer-list" onClick={() => set({ selection: [] })}>
            {doc.nodes[pageId] && [...doc.nodes[pageId].children].reverse().map(c => row(c, 0))}
            {doc.nodes[pageId]?.children.length === 0 && <div className="muted pad">No layers yet. Press R, O, F or T to draw.</div>}
          </div>
        </> : <>
          <div className="sec-head"><span className="sec-title">Assets</span><span className="sec-btns"><button className="btn small" onClick={() => set({ leftTab: 'variables' })}><Icon n="variable" size={13} /> Variables</button></span></div>
          <div className="pad"><input className="page-q" placeholder="Search components" value={assetQ} onChange={e => setAssetQ(e.target.value)} /></div>
          <div className="layer-list">
            <DesignSystemSection session={session} q={assetQ} />
            {comps.filter(c => c.name.toLowerCase().includes(assetQ.toLowerCase())).map(c => (
              <div key={c.id} className="asset-row">
                <span className="licon comp"><Icon n="component" size={14} /></span>
                <span className="lname" title="Select main component" onClick={() => { set({ selection: [c.id] }); }}>{c.name}</span>
                <button className="btn small" disabled={!canEdit} title="Insert an instance of this component" onClick={() => { const id = createInstance(store, c.id, { parent: session.pageId, x: c.x + 40, y: c.y + c.height + 40 }); if (id) set({ selection: [id] }); }}>Insert</button>
              </div>
            ))}
            {(['FILL', 'TEXT', 'EFFECT', 'LAYOUT'] as const).map(t => {
              const list = Object.values(doc.styles).filter(x => x.type === t && x.name.toLowerCase().includes(assetQ.toLowerCase()));
              if (!list.length) return null;
              return <div key={t}><div className="sec-title pad">{t[0] + t.slice(1).toLowerCase()} styles</div>{list.map(st => {
                const first = selection[0] && doc.nodes[selection[0]];
                return (
                  <div key={st.id} className="asset-row">
                    <span className="licon"><Icon n="styleDots" size={14} /></span>
                    <span className="lname" title="Apply to selection" onClick={() => attachStyle(store, topLevelOnly(store, selection), t, st.id, 'fill')}>{st.name}</span>
                    <button className="icon-btn" disabled={!canEdit || !first} title="Update style from the selected layer" onClick={() => { const v = first && styleValueFrom(first, t); if (v) updateStyle(store, st.id, v); else set({}); }}><Icon n="redo" size={13} /></button>
                    <button className="icon-btn" disabled={!canEdit} title="Rename" onClick={() => { void askText('Rename style', st.name, { okLabel: 'Rename' }).then(n => { if (n && !renameStyle(store, st.id, n)) useEditor.getState().toast('Name is empty or already used', 'error'); }); }}>✎</button>
                    <button className="icon-btn" disabled={!canEdit} title="Delete style (layers keep their current look)" onClick={() => deleteStyle(store, st.id)}><Icon n="minus" size={13} /></button>
                  </div>
                );
              })}</div>;
            })}
            {!comps.length && !Object.keys(doc.styles).length && <div className="muted pad">No components or styles yet. Select a frame and choose “Create component” (⌥⌘K), or create a style from the ⁝⁝ button in the inspector. Link a design system above to reuse its components.</div>}
          </div>
        </>}
      </div>}
    </div>
  );
}

function FileTitle({ session }: { session: EditorSession }) {
  const [name, setName] = useState(session.file.name);
  return (
    <input className="file-name" value={name} aria-label="File name" disabled={!session.canEdit} onChange={e => setName(e.target.value)}
      onBlur={async () => { const v = name.trim(); if (!v) return setName(session.file.name); if (v !== session.file.name) { try { const { api } = await import('../api'); await api.patchFile(session.file.id, { name: v }); session.file.name = v; window.dispatchEvent(new CustomEvent('layr:rename', { detail: { id: session.file.id, name: v } })); } catch (e) { setName(session.file.name); useEditor.getState().toast((e as Error).message, 'error'); } } }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}
