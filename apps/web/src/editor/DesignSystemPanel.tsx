import { useEffect, useMemo, useRef, useState } from 'react';
import { addMissingComponents, buildDefaultDesignSystem, listLibraryComponents, syncLibraryComponents, importedCount, type DocumentData, type LibraryItem } from '@layr/core';
import { api, type FileMeta } from '../api';
import { Icon } from '../icons';
import { Select } from '../ui/Select';
import { autoTextSize } from '../engine/text';
import { askConfirm } from '../ui/dialogs';
import { DS_MIME, cachedLibrary, createDesignSystem, loadLibrary, previewOf, type Preview } from '../designsystem/library';
import { useEditor } from './state';
import type { EditorSession } from './session';

/** One component of a linked design system: live preview, drag it onto the canvas or press Insert. */
function Tile({ libId, doc, item, canEdit, onInsert }: { libId: string; doc: DocumentData; item: LibraryItem; canEdit: boolean; onInsert: () => void }) {
  const [src, setSrc] = useState<Preview | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { io.disconnect(); void previewOf(libId, doc, item.previewId).then(u => alive && setSrc(u)); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [libId, doc, item.previewId]);
  return (
    <div ref={ref} className="ds-tile" data-testid="ds-tile" draggable={canEdit} title={canEdit ? 'Drag onto the canvas, or double-click to insert' : 'View only'}
      onDragStart={e => { e.dataTransfer.setData(DS_MIME, JSON.stringify({ libId, nodeId: item.id })); e.dataTransfer.setData('text/plain', item.name); e.dataTransfer.effectAllowed = 'copy'; const img = ref.current?.querySelector('img'); if (img) e.dataTransfer.setDragImage(img, 20, 20); }}
      onDoubleClick={() => canEdit && onInsert()}>
      <div className="ds-prev">{src ? <img src={src.url} alt={item.name} draggable={false} style={{ width: Math.min(src.w, 240) }} /> : <span className="ds-ph" />}</div>
      <div className="ds-meta">
        <span className="ds-name"><b>{item.name}</b><span className="muted">{item.kind === 'set' ? `${item.variants} variants` : 'Component'}</span></span>
        <button className="btn small" disabled={!canEdit} onClick={onInsert} aria-label={`Insert ${item.name}`}>Insert</button>
      </div>
    </div>
  );
}

/** Top of the Assets (book) panel: link a design system to this file and browse its components. */
export function DesignSystemSection({ session, q }: { session: EditorSession; q: string }) {
  const toast = useEditor(s => s.toast);
  const isLib = session.file.type === 'designsystem';
  const canEdit = session.canEdit;
  const [libId, setLibId] = useState<string | null>(session.file.libraryId ?? null);
  const [lib, setLib] = useState<{ file: FileMeta; doc: DocumentData } | null>(() => (session.file.libraryId ? cachedLibrary(session.file.libraryId) ?? null : null));
  const [err, setErr] = useState('');
  const [options, setOptions] = useState<FileMeta[]>([]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!isLib) api.listFiles({ view: 'all' }).then(r => setOptions(r.files.filter(f => f.type === 'designsystem'))).catch(() => {}); }, [isLib]);
  useEffect(() => {
    if (!libId) { setLib(null); setErr(''); return; }
    let alive = true;
    loadLibrary(libId).then(l => { if (alive) { setLib(l); setErr(''); } }).catch(e => { if (alive) setErr((e as Error).message.includes('not a design system') ? (e as Error).message : 'Cannot open the linked design system (it may be deleted or not shared with you).'); });
    return () => { alive = false; };
  }, [libId]);

  const items = useMemo(() => (lib ? listLibraryComponents(lib.doc) : []), [lib]);
  const shown = useMemo(() => items.filter(i => !q || i.name.toLowerCase().includes(q.toLowerCase()) || i.category.toLowerCase().includes(q.toLowerCase())), [items, q]);
  const groups = useMemo(() => { const m = new Map<string, LibraryItem[]>(); for (const i of shown) m.set(i.category, [...(m.get(i.category) ?? []), i]); return [...m]; }, [shown]);

  const link = async (id: string | null) => {
    try { await api.setLibrary(session.file.id, id); session.file.libraryId = id; setLibId(id); }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  const createNew = async () => {
    setBusy(true);
    try { const f = await createDesignSystem(session.file.projectId); setOptions(o => [f, ...o]); await link(f.id); toast('Design system created and linked'); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const update = async () => {
    if (!libId) return;
    setBusy(true);
    try { const l = await loadLibrary(libId, true); setLib(l); const n = syncLibraryComponents(session.store, l.doc, libId); toast(n ? `Updated ${n} component${n === 1 ? '' : 's'} from the design system` : 'Nothing to update yet: no components from this design system are used in this file'); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const insert = (item: LibraryItem) => { if (libId) session.insertFromLibrary(libId, item.id); };

  if (isLib) return (
    <div className="ds-box"><div className="ds-head"><Icon n="components" size={15} /><b>This is a design system</b></div>
      <p className="muted small">Edit the components on the canvas. Link this design system from any design file (Assets → Design system) to reuse them there.</p>
      <button className="btn small" disabled={!canEdit} onClick={() => { const n = addMissingComponents(session.store, buildDefaultDesignSystem(autoTextSize)); toast(n ? `Added ${n} default component${n === 1 ? '' : 's'}` : 'All default components are already here'); }}><Icon n="plus" size={12} /> Add missing default components</button></div>
  );

  return (
    <div className="ds-section" data-testid="ds-section">
      <div className="ds-box">
        <div className="ds-head"><Icon n="components" size={15} /><b>Design system</b>
          {libId && <span className="ds-actions">
            <button className="icon-btn" title="Pull the latest design system changes into this file" aria-label="Update components" disabled={busy || !canEdit} onClick={() => void update()}><Icon n="redo" size={14} /></button>
            <button className="icon-btn" title="Open the design system" aria-label="Open design system" onClick={() => { location.hash = `#/file/${libId}`; }}><Icon n="frame" size={14} /></button>
            <button className="icon-btn" title="Unlink" aria-label="Unlink design system" disabled={!canEdit} onClick={() => { void (async () => { if (await askConfirm('Unlink this design system?', { message: `Components already used in this file stay (${importedCount(session.store.doc, libId)} copied). They just stop getting updates.`, okLabel: 'Unlink' })) await link(null); })(); }}><Icon n="minus" size={14} /></button>
          </span>}
        </div>
        {!libId ? <>
          <p className="muted small">Link a design system to drag its buttons, inputs, cards and more into this file.</p>
          <div className="ds-link">
            <Select className="filterbtn" aria-label="Link a design system" value="" disabled={!canEdit} onChange={e => { if (e.target.value) void link(e.target.value); }}>
              <option value="">{options.length ? 'Link a design system…' : 'No design systems yet'}</option>
              {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
            <button className="btn small primary" disabled={!canEdit || busy} onClick={() => void createNew()}><Icon n="plus" size={12} /> New</button>
          </div>
        </> : <div className="muted small ds-sub">{lib ? <>Linked to <a href={`#/file/${libId}`}>{lib.file.name}</a> · {items.length} components</> : err ? <span className="ds-err">{err}</span> : 'Loading…'}</div>}
      </div>
      {libId && lib && groups.map(([cat, list]) => {
        const isOpen = !!q || !closed.has(cat);
        return (
          <div key={cat} className="ds-group">
            <button className="ds-cat" aria-expanded={isOpen} onClick={() => setClosed(c => { const n = new Set(c); n.has(cat) ? n.delete(cat) : n.add(cat); return n; })}><Icon n="chevR" size={12} className={isOpen ? 'rot' : ''} /><span>{cat}</span><span className="muted">{list.length}</span></button>
            {isOpen && <div className="ds-grid">{list.map(i => <Tile key={i.id} libId={libId} doc={lib.doc} item={i} canEdit={canEdit} onInsert={() => insert(i)} />)}</div>}
          </div>
        );
      })}
      {libId && lib && !groups.length && <div className="muted pad">No design system components match “{q}”.</div>}
      {libId && lib && !!groups.length && <div className="sec-title pad ds-local">This file</div>}
    </div>
  );
}
