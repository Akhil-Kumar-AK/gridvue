import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { groupMembers, makeItem, selectionBox, votesUsed, voteTotal, INK_COLORS, SHAPE_COLORS, SHAPE_KINDS, STICKY_COLORS, type BoardData, type JamItem, type ShapeKind } from '@layr/core';
import { api, download, type FileMeta } from '../api';
import { askConfirm, askText } from '../ui/dialogs';
import { Select } from '../ui/Select';
import { ContextMenu, ShareDialog, Toasts } from '../editor/Overlays';
import { useEditor, storage } from '../editor/state';
import { JamSession } from './session';
import { JamStore, useJam, type Panel, type Tool } from './store';
import { JamCanvas, connectedCopy, type CanvasApi } from './JamCanvas';
import { CommentsLayer, ContextBar, LinkEditor, STAMPS, Swatches, TextEditor, duplicate, groupToggle, isMac } from './JamOverlays';
import { Icon } from '../icons';
import { JIcon, ShapeGlyph, RouteGlyph, type JamIcon } from './icons';
import { TEMPLATES, placeTemplate } from './templates';
import { exportPng } from './render';
import { StampWheel } from './JamStamps';
import { TmvChip, TmvPanel, stopMusic } from './JamTimer';

const CLIP = 'layr-jam:';

export function JamEditor({ file, role, board, onExit }: { file: FileMeta; role: FileMeta['role']; board: BoardData; onExit: () => void }) {
  const session = useMemo(() => new JamSession(file, role, board), [file.id]);
  useEffect(() => { api.me().then(r => useJam.getState().set({ me: { id: r.user.id, name: r.user.name } })).catch(() => {}); return () => { stopMusic(); void session.saveNow().finally(() => session.dispose()); }; }, [session]);
  return <JamShell session={session} onExit={onExit} />;
}

function JamShell({ session, onExit }: { session: JamSession; onExit: () => void }) {
  const store = session.store; useSyncExternalStore(store.subscribe, () => store.version);
  const ui = useJam(); const set = ui.set; const theme = useEditor(s => s.theme); const toast = useEditor(s => s.toast);
  const [capi, setApi] = useState<CanvasApi | null>(null); const apiRef = useRef<CanvasApi | null>(null); apiRef.current = capi;
  const fileInput = useRef<HTMLInputElement>(null);
  const readonly = session.role === 'viewer';
  useEffect(() => { (window as unknown as { __jam: unknown }).__jam = { store, session, api: capi, ui: useJam }; }, [store, session, capi]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const fitted = useRef(false);
  useEffect(() => { if (capi && !fitted.current) { fitted.current = true; capi.fit(); } }, [capi]); // first open: frame the content once

  const sel = () => useJam.getState().selection.filter(i => store.board.items[i]);
  const setTool = (t: Tool, extra: Partial<ReturnType<typeof useJam.getState>> = {}) => set({ tool: t, panel: null, editing: null, ...extra });

  // ---------- clipboard ----------
  const copy = (cut: boolean) => {
    const ids = sel(); if (!ids.length) return;
    const all = new Set(ids); for (const i of ids) if (store.board.items[i].kind === 'section') for (const c of Object.values(store.board.items)) if (c.parent === i) all.add(c.id);
    const items = JamStore.clone(store.board, [...all]); const payload = CLIP + JSON.stringify(items);
    void navigator.clipboard?.writeText(payload).catch(() => {}); clipMem = payload;
    if (cut) { store.remove([...all]); set({ selection: [] }); } else toast(`Copied ${ids.length} item${ids.length > 1 ? 's' : ''}`);
  };
  const pasteItems = (items: JamItem[]) => {
    if (!items.length || !capi) return;
    const box = selectionBox({ items: Object.fromEntries(items.map(i => [i.id, i])), order: items.map(i => i.id) } as unknown as BoardData, items.filter(i => i.kind !== 'connector').map(i => i.id));
    const c = capi.viewportCenter(); const dx = box ? c.x - (box.x + box.w / 2) : 0, dy = box ? c.y - (box.y + box.h / 2) : 0;
    const ids = new Set(items.map(i => i.id));
    for (const it of items) { if (it.kind === 'connector') { for (const e of [it.from!, it.to!]) if (!e.id) { e.x = (e.x ?? 0) + dx; e.y = (e.y ?? 0) + dy; } } else { it.x += dx; it.y += dy; } if (it.parent && !ids.has(it.parent)) delete it.parent; }
    store.add(items); set({ selection: items.filter(i => i.kind !== 'connector').map(i => i.id), tool: 'select' });
  };
  const pasteText = (text: string) => {
    if (!capi) return; const c = capi.viewportCenter();
    if (text.startsWith(CLIP)) { try { const items = JSON.parse(text.slice(CLIP.length)) as JamItem[]; const fresh = JamStore.clone({ items: Object.fromEntries(items.map(i => [i.id, i])), order: items.map(i => i.id) } as unknown as BoardData, items.map(i => i.id)); pasteItems(fresh); } catch { toast('Clipboard content is not valid board data', 'error'); } return; }
    const t = text.trim(); if (!t) return;
    if (/^https?:\/\/\S+$/i.test(t)) { let host = t; try { host = new URL(t).host; } catch { /* keep */ } const it = makeItem('link', c.x - 140, c.y - 36, { url: t, text: host }); store.add([it]); set({ selection: [it.id] }); return; }
    const it = makeItem('text', c.x, c.y, { text: t.slice(0, 5000) }); store.add([it]); set({ selection: [it.id] });
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      const m = isMac ? e.metaKey : e.ctrlKey; const u = useJam.getState();
      if (editable(e.target)) return;
      if (e.code === 'Space') return;
      const k = e.key.toLowerCase();
      if (m && k === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); set({ selection: sel() }); return; }
      if (m && k === 'y') { e.preventDefault(); store.redo(); return; }
      if (m && k === 's') { e.preventDefault(); void session.saveNow().then(() => toast('All changes saved')); return; }
      if (readonly) { if (k === 'escape') set({ selection: [], tool: 'select' }); return; }
      if (m && k === 'a') { e.preventDefault(); set({ selection: store.board.order.filter(i => !store.board.items[i].locked) }); return; }
      if (m && k === 'c') { return; } // handled by the copy event so the system clipboard is written with user activation
      if (m && k === 'd') { e.preventDefault(); duplicate(store, sel(), capi); return; }
      if (m && k === 'g') { e.preventDefault(); const ids = sel(); if (e.shiftKey) store.change(b => { for (const i of ids) delete b.items[i].group; }); else if (ids.length > 1) groupToggle(store, ids); return; }
      if (m && k === 'l' && e.shiftKey) { e.preventDefault(); const ids = sel(); const all = ids.every(i => store.board.items[i].locked); store.patch(ids, { locked: all ? undefined : true }); return; }
      if (m && (e.key === ']' || e.key === '[')) { e.preventDefault(); store.reorder(sel(), e.key === ']' ? (e.shiftKey ? 'front' : 'forward') : (e.shiftKey ? 'back' : 'backward')); return; }
      if (m && (e.key === '=' || e.key === '+')) { e.preventDefault(); capi?.zoomTo(u.camera.zoom * 1.25); return; }
      if (m && e.key === '-') { e.preventDefault(); capi?.zoomTo(u.camera.zoom / 1.25); return; }
      if (m && e.key === '0') { e.preventDefault(); capi?.zoomTo(1); return; }
      if (m || e.altKey) return;
      if (e.key === 'Escape') { if (u.composer) set({ composer: null }); else if (u.panel) set({ panel: null }); else if (u.tool !== 'select') setTool('select'); else set({ selection: [], openComment: null }); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { const ids = sel(); if (ids.length) { e.preventDefault(); store.remove(ids.filter(i => !store.board.items[i]?.locked)); set({ selection: [] }); } return; }
      if (e.key.startsWith('Arrow')) { const ids = sel().filter(i => !store.board.items[i].locked && store.board.items[i].kind !== 'connector'); if (!ids.length) return; e.preventDefault(); const d = e.shiftKey ? 20 : 2; const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0; store.change(b => { for (const i of ids) { b.items[i].x += dx; b.items[i].y += dy; } }); return; }
      if (e.key === 'Enter') { const ids = sel(); if (ids.length === 1 && ['sticky', 'shape', 'text', 'section', 'code'].includes(store.board.items[ids[0]].kind)) { e.preventDefault(); set({ editing: { id: ids[0] } }); } return; }
      if (e.key === 'Tab') { const ids = sel(); if (ids.length === 1 && ['sticky', 'shape'].includes(store.board.items[ids[0]].kind)) { e.preventDefault(); const id = connectedCopy(store, ids[0], e.shiftKey ? 'b' : 'r'); if (id) set({ selection: [id], editing: { id } }); } return; }
      if (e.key === '1' && e.shiftKey || e.key === '!') { capi?.fit(); return; }
      if ((e.key === '2' && e.shiftKey) || e.key === '@') { capi?.fit(sel()); return; }
      if (e.key === '?' ) { set({ panel: ui.panel === 'help' ? null : 'help' }); return; }
      const tools: Record<string, () => void> = {
        v: () => setTool('select'), h: () => setTool('hand'), s: () => setTool(e.shiftKey ? 'section' : 'sticky'), t: () => setTool('text'), r: () => setTool('shape', { shape: 'rect' }), o: () => setTool('shape', { shape: 'ellipse' }),
        d: () => setTool('shape', { shape: 'diamond' }), x: () => setTool('connector'), p: () => setTool('pen', { pen: 'pen' }), m: () => setTool(e.shiftKey ? 'highlighter' : 'marker', { pen: e.shiftKey ? 'highlighter' : 'marker' }), e: () => setTool(e.shiftKey ? 'stamp' : 'eraser'),
        c: () => setTool('comment'), b: () => setTool('table'), k: () => setTool('code'), i: () => fileInput.current?.click(), l: () => setTool('link'), n: () => setTool('vote'),
      };
      if (tools[k]) { e.preventDefault(); tools[k](); }
    };
    const onCopy = (e: ClipboardEvent) => { if (editable(e.target)) return; const ids = sel(); if (!ids.length) return; e.preventDefault(); const all = new Set(ids); for (const i of ids) if (store.board.items[i].kind === 'section') for (const c of Object.values(store.board.items)) if (c.parent === i) all.add(c.id); const payload = CLIP + JSON.stringify(JamStore.clone(store.board, [...all])); e.clipboardData?.setData('text/plain', payload); clipMem = payload; };
    const onCut = (e: ClipboardEvent) => { if (editable(e.target) || readonly) return; onCopy(e); const ids = sel(); store.remove(ids.filter(i => !store.board.items[i]?.locked)); set({ selection: [] }); };
    const onPaste = (e: ClipboardEvent) => {
      if (editable(e.target) || readonly) return; e.preventDefault();
      const img = [...(e.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/')); if (img) { void capi?.insertImage(img); return; }
      const txt = e.clipboardData?.getData('text/plain') || clipMem; if (txt) pasteText(txt);
    };
    window.addEventListener('keydown', down); window.addEventListener('copy', onCopy); window.addEventListener('cut', onCut); window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('copy', onCopy); window.removeEventListener('cut', onCut); window.removeEventListener('paste', onPaste); };
  }, [session, capi, ui.panel]);

  // ---------- context menu ----------
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault(); const x = e.clientX, y = e.clientY; const ids = sel(); const locked = ids.length > 0 && ids.every(i => store.board.items[i].locked);
    const items = ids.length ? [
      { label: 'Copy', shortcut: isMac ? '⌘C' : 'Ctrl+C', run: () => copy(false) }, { label: 'Cut', shortcut: isMac ? '⌘X' : 'Ctrl+X', disabled: readonly, run: () => copy(true) },
      { label: 'Paste', shortcut: isMac ? '⌘V' : 'Ctrl+V', disabled: readonly, run: () => { void navigator.clipboard?.readText().then(pasteText).catch(() => clipMem && pasteText(clipMem)); } },
      { label: 'Duplicate', shortcut: isMac ? '⌘D' : 'Ctrl+D', disabled: readonly, run: () => duplicate(store, ids, capi) },
      { label: '', separator: true },
      { label: 'Bring to front', disabled: readonly, run: () => store.reorder(ids, 'front') }, { label: 'Send to back', disabled: readonly, run: () => store.reorder(ids, 'back') },
      { label: 'Group', disabled: readonly || ids.length < 2, run: () => groupToggle(store, ids) }, { label: 'Ungroup', disabled: readonly || !ids.some(i => store.board.items[i].group), run: () => store.change(b => { for (const i of ids) delete b.items[i].group; }) },
      { label: locked ? 'Unlock' : 'Lock', disabled: readonly, run: () => store.patch(ids, { locked: locked ? undefined : true }) },
      { label: '', separator: true }, { label: 'Delete', disabled: readonly, run: () => { store.remove(ids); set({ selection: [] }); } },
    ] : [
      { label: 'Paste', disabled: readonly, run: () => { void navigator.clipboard?.readText().then(pasteText).catch(() => clipMem && pasteText(clipMem)); } },
      { label: 'Select all', run: () => set({ selection: store.board.order.filter(i => !store.board.items[i].locked) }) },
      { label: 'Zoom to fit', run: () => capi?.fit() },
    ];
    setTimeout(() => useEditor.getState().set({ menu: { x, y, items } }), 0);
  };

  const rename = async () => {
    if (session.role !== 'owner') return;
    const n = await askText('Rename board', session.file.name, { okLabel: 'Rename' }); if (!n?.trim() || n.trim() === session.file.name) return;
    try { const r = await api.patchFile(session.file.id, { name: n.trim() }); session.file = r.file; window.dispatchEvent(new CustomEvent('layr:rename', { detail: { id: r.file.id, name: r.file.name, type: 'whiteboard' } })); store.replaceVersion(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const zoomPct = Math.round(ui.camera.zoom * 100);
  const boardMenu = (e: React.MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); useEditor.getState().set({ menu: { x: r.left, y: r.bottom + 6, items: [
    { label: ui.me.name, disabled: true }, { label: '', separator: true },
    { label: 'Undo', shortcut: isMac ? '⌘Z' : 'Ctrl+Z', disabled: readonly || !store.canUndo, run: () => { store.undo(); set({ selection: sel() }); } },
    { label: 'Redo', shortcut: isMac ? '⇧⌘Z' : 'Ctrl+Y', disabled: readonly || !store.canRedo, run: () => { store.redo(); set({ selection: sel() }); } },
    { label: '', separator: true },
    { label: `Comments (${store.board.comments.filter(c => !c.resolved).length})`, run: () => open('comments') }, { label: 'Export…', run: () => open('export') }, { label: 'Keyboard shortcuts', shortcut: '?', run: () => open('help') },
    { label: '', separator: true },
    { label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', run: () => { const t = theme === 'dark' ? 'light' : 'dark'; useEditor.getState().set({ theme: t }); storage.set('layr:theme', t); } },
    { label: 'Back to files', run: onExit },
  ] } }); };
  const zoomMenu = (e: React.MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); useEditor.getState().set({ menu: { x: r.left - 60, y: r.bottom + 6, items: [
    { label: `Zoom: ${zoomPct}%`, disabled: true }, { label: '', separator: true },
    { label: 'Zoom in', shortcut: isMac ? '⌘+' : 'Ctrl+', run: () => capi?.zoomTo(ui.camera.zoom * 1.25) }, { label: 'Zoom out', shortcut: isMac ? '⌘−' : 'Ctrl−', run: () => capi?.zoomTo(ui.camera.zoom / 1.25) },
    { label: 'Zoom to 100%', shortcut: isMac ? '⌘0' : 'Ctrl0', run: () => capi?.zoomTo(1) }, { label: 'Zoom to fit', shortcut: '⇧1', run: () => capi?.fit() }, { label: 'Zoom to selection', shortcut: '⇧2', run: () => capi?.fit(sel()) },
    { label: '', separator: true },
    { label: `${store.board.grid === 'dots' ? '✓ ' : '   '}Dot grid`, run: () => store.change(b => { b.grid = 'dots'; }) }, { label: `${store.board.grid === 'lines' ? '✓ ' : '   '}Line grid`, run: () => store.change(b => { b.grid = 'lines'; }) }, { label: `${store.board.grid === 'none' ? '✓ ' : '   '}No grid`, run: () => store.change(b => { b.grid = 'none'; }) },
  ] } }); };

  const voting = store.board.voting; const myVotes = votesUsed(store.board, ui.me.id);
  const open = (p: Panel) => set({ panel: ui.panel === p ? null : p });

  return (
    <div className={'jam' + (readonly ? ' ro' : '')} onContextMenu={openMenu} data-testid="jam-editor">
      <div className="jam-top">
        <div className="jam-chip left">
          <button className="jm-b" aria-label="Back to files" title="Back to files" onClick={onExit}><JIcon n="back2" size={18} /></button>
          <button className="jam-name" aria-label="Board name" title={session.role === 'owner' ? 'Rename' : session.file.name} onClick={rename}>{session.file.name}</button>
          <span className={'jam-save ' + ui.saveStatus} role="status">{{ saved: 'Saved', dirty: 'Unsaved', saving: 'Saving…', conflict: 'Conflict', error: 'Not saved', readonly: 'View only' }[ui.saveStatus]}</span>
        </div>
        <div className="jam-chip right">
          <button className="jam-me" aria-label="Board menu" title="Board menu" onClick={boardMenu}><span className="avatar sm">{ui.me.name[0]?.toUpperCase()}</span><span className="jam-me-c"><JIcon n="chevD" size={13} /></span></button>
          <button className={'jm-b big'} aria-label="View options" title="Zoom and grid" onClick={zoomMenu}><JIcon n="grid" size={19} /></button>
          <TmvChip open={ui.panel === 'tmv'} onClick={() => open('tmv')} />
          <button className="jm-b big" aria-label="Switch theme" title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => { const t = theme === 'dark' ? 'light' : 'dark'; useEditor.getState().set({ theme: t }); storage.set('layr:theme', t); }}><Icon n={theme === 'dark' ? 'sun' : 'moon'} size={19} /></button>
        </div>
      </div>

      <JamCanvas session={session} onApi={setApi} />
      <ContextBar store={store} api={capi} />
      <TextEditor store={store} api={capi} />
      <CommentsLayer store={store} api={capi} />
      <LinkEditor store={store} />
      {store.board.order.length === 0 && !readonly && <div className="jam-empty"><b>An empty board</b><span>Pick a tool below, or start from a template.</span><button className="btn primary" onClick={() => open('templates')}>Browse templates</button></div>}
      {ui.saveStatus === 'conflict' || ui.saveStatus === 'error' ? <div className="banner error jam-banner" role="alert"><span>{ui.saveMessage}</span>{ui.saveStatus === 'conflict' && <>
        <button className="btn small" onClick={async () => { try { const r = await api.createFile({ type: 'whiteboard', name: `${session.file.name} (my changes)`, import: { document: store.board } }); location.hash = `#/file/${r.file.id}`; } catch (e) { toast((e as Error).message, 'error'); } }}>Save mine as a copy</button>
        <button className="btn small" onClick={() => location.reload()}>Discard mine, reload latest</button></>}</div> : null}

      {!readonly && <Toolbar fileInput={fileInput} open={open} setTool={setTool} />}
      {ui.panel === 'templates' && <Templates onPick={t => { const items = placeTemplate(t, capi?.viewportCenter().x ?? 0, capi?.viewportCenter().y ?? 0, ui.me.name, store.board); store.add(items); set({ panel: null, selection: items.filter(i => i.kind !== 'connector').map(i => i.id) }); setTimeout(() => capi?.fit(items.map(i => i.id)), 30); }} />}
      {ui.panel === 'tmv' && <TmvPanel store={store} onClose={() => set({ panel: null })} />}
      {ui.panel === 'more' && <MorePanel store={store} capi={capi} fileInput={fileInput} session={session} />}
      {ui.panel === 'export' && <ExportPanel store={store} session={session} />}
      {ui.panel === 'comments' && <CommentList store={store} capi={capi} />}
      {ui.panel === 'help' && <Help />}
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void capi?.insertImage(f); e.target.value = ''; }} />
      <ShareDialog session={session as never} /><ContextMenu /><Toasts />
    </div>
  );
}
let clipMem = '';

// ---------- bottom toolbar (FigJam layout: pointer/hand | pen, sticky, shapes | text, section, table, code, stamp, comment, widgets, +) ----------
function PenArt() { return (
  <svg viewBox="0 0 48 96" width="30" height="60" aria-hidden="true"><defs>
    <linearGradient id="pbody" x1="0" x2="1"><stop offset="0" stopColor="#c3c8d1" /><stop offset=".3" stopColor="#ffffff" /><stop offset=".7" stopColor="#f1f3f6" /><stop offset="1" stopColor="#b3b9c4" /></linearGradient>
    <linearGradient id="ptip" x1="0" x2="1"><stop offset="0" stopColor="#4a4a50" /><stop offset=".45" stopColor="#141416" /><stop offset="1" stopColor="#000" /></linearGradient></defs>
    <path d="M24 1c2 0 3.200 2 4 5l5.500 20h-19L20 6c.8-3 2-5 4-5z" fill="url(#ptip)" /><path d="M22 7c-1 5-3 12-4.500 17" stroke="#fff" strokeOpacity=".3" strokeWidth="1.800" strokeLinecap="round" fill="none" />
    <path d="M14.500 26h19L42 96H6z" fill="url(#pbody)" stroke="#aab0bb" strokeWidth="1.100" strokeLinejoin="round" /><path d="M14 26c6 3.500 14 3.500 20 0" fill="none" stroke="#9aa1ad" strokeWidth="1.200" /><path d="M10.500 58h27" stroke="#b9bfc9" strokeWidth="1.300" /><path d="M10 64h28" stroke="#e5e8ed" strokeWidth="1.200" /></svg>); }
function StickyArt({ color }: { color: string }) { return (
  <svg viewBox="0 0 100 100" width="48" height="48" aria-hidden="true"><defs>
    <linearGradient id="sfront" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={color} /><stop offset="1" stopColor={color} stopOpacity=".85" /></linearGradient>
    <linearGradient id="sfold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".7" /><stop offset="1" stopColor="#000" stopOpacity=".15" /></linearGradient></defs>
    <rect x="22" y="14" width="68" height="90" rx="3" fill={color} opacity=".55" transform="rotate(6 56 59)" /><rect x="16" y="12" width="68" height="90" rx="3" fill={color} opacity=".78" transform="rotate(2.500 50 57)" />
    <path d="M8 36C8 22 20 12 36 12H92v90H8z" fill="url(#sfront)" /><path d="M8 36C24 35 34 27 36 12 22 14 10 24 8 36z" fill="url(#sfold)" /><path d="M8 36C24 35 34 27 36 12" fill="none" stroke="#000" strokeOpacity=".18" strokeWidth="1.400" /></svg>); }
const PEN_COLORS = ['#1e1e1e', '#e5484d', '#f5a04a', '#f5c84a', '#7cc77c', '#5aa9f5', '#4f46e5', '#ffffff'];
const BARREL = <><path d="M14.500 26h19L42 96H6z" fill="url(#pbody)" stroke="#aab0bb" strokeWidth="1.100" strokeLinejoin="round" /><path d="M14 26c6 3.500 14 3.500 20 0" fill="none" stroke="#9aa1ad" strokeWidth="1.200" /><path d="M10.500 58h27" stroke="#b9bfc9" strokeWidth="1.300" /><path d="M10 64h28" stroke="#e5e8ed" strokeWidth="1.200" /></>;
/** The four drawing tools share the main pencil's barrel, gradients and outline; only the tip differs. */
function ToolArt({ kind }: { kind: 'pen' | 'highlighter' | 'marker' | 'eraser' }) {
  return (
    <svg viewBox="0 0 48 96" width="30" height="60" aria-hidden="true">
      {kind === 'pen' && <><path d="M24 1c2 0 3.200 2 4 5l5.500 20h-19L20 6c.8-3 2-5 4-5z" fill="url(#ptip)" /><path d="M22 7c-1 5-3 12-4.500 17" stroke="#fff" strokeOpacity=".3" strokeWidth="1.800" strokeLinecap="round" fill="none" />{BARREL}</>}
      {kind === 'highlighter' && <><path d="M16 4l13-2 5 24H14.500z" fill="#f7e04a" stroke="#d2bb2c" strokeWidth="1.100" strokeLinejoin="round" /><path d="M19 7c-.5 5-1.500 11-2.500 17" stroke="#fff" strokeOpacity=".5" strokeWidth="1.800" strokeLinecap="round" fill="none" />{BARREL}</>}
      {kind === 'marker' && <><path d="M18 5c1-3 11-3 12 0l3.500 21h-19z" fill="#7c4dff" stroke="#6238e0" strokeWidth="1.100" strokeLinejoin="round" /><path d="M21 7c-.5 5-1.500 11-2.500 17" stroke="#fff" strokeOpacity=".4" strokeWidth="1.800" strokeLinecap="round" fill="none" />{BARREL}<rect x="11" y="44" width="26" height="9" fill="#7c4dff" opacity=".28" /></>}
      {kind === 'eraser' && <><path d="M17 4h14a3 3 0 013 3l-.5 19h-19L14 7a3 3 0 013-3z" fill="#eaa5a1" stroke="#cf7f7a" strokeWidth="1.100" strokeLinejoin="round" /><path d="M18 7c-.5 5-1 11-1.500 17" stroke="#fff" strokeOpacity=".45" strokeWidth="1.800" strokeLinecap="round" fill="none" />{BARREL}</>}
    </svg>
  );
}
function ToolDefs() { return <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><defs><linearGradient id="pbody" x1="0" x2="1"><stop offset="0" stopColor="#c3c8d1" /><stop offset=".3" stopColor="#ffffff" /><stop offset=".7" stopColor="#f1f3f6" /><stop offset="1" stopColor="#b3b9c4" /></linearGradient><linearGradient id="ptip" x1="0" x2="1"><stop offset="0" stopColor="#4a4a50" /><stop offset=".45" stopColor="#141416" /><stop offset="1" stopColor="#000" /></linearGradient></defs></svg>; }
function PenFlyout() {
  const ui = useJam();
  const tools: { id: 'pen' | 'highlighter' | 'marker' | 'eraser'; label: string }[] = [{ id: 'pen', label: 'pen' }, { id: 'highlighter', label: 'highlighter' }, { id: 'marker', label: 'marker' }, { id: 'eraser', label: 'eraser' }];
  const custom = async () => { const v = await askText('Custom colour', ui.penColor, { message: 'Enter a hex colour such as #4f46e5.', okLabel: 'Use colour' }); if (v && /^#[0-9a-f]{6}$/i.test(v.trim())) ui.set({ penColor: v.trim().toLowerCase() }); else if (v) useEditor.getState().toast('Use a 6-digit hex colour like #4f46e5', 'error'); };
  const fine = ui.penWidth < 6;
  return (
    <div className="jam-flyout2 pens" onPointerDown={e => e.stopPropagation()} role="toolbar" aria-label="Drawing tools">
      <ToolDefs />
      {tools.map(t => <button key={t.id} className={'jp-tool' + (ui.tool === t.id ? ' on' : '')} aria-label={`Use ${t.label}`} aria-pressed={ui.tool === t.id} title={t.label} onClick={() => ui.set(t.id === 'eraser' ? { tool: 'eraser' } : { tool: t.id, pen: t.id })}><ToolArt kind={t.id} /></button>)}
      <span className="jm-sep tall" />
      <button className={'jp-style' + (fine ? ' on' : '')} aria-label="Fine line" title="Fine line" disabled={ui.tool === 'eraser'} onClick={() => ui.set({ penWidth: 3 })}><svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round"><path d="M5 20c4-12 8 6 12-6s5-3 8-6" /></svg></button>
      <button className={'jp-style' + (!fine ? ' on' : '')} aria-label="Bold line" title="Bold line" disabled={ui.tool === 'eraser'} onClick={() => ui.set({ penWidth: 9 })}><svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round"><path d="M7 20c3-8 6 4 9-3s4-3 7-6" /></svg></button>
      <span className="jm-sep tall" />
      {PEN_COLORS.map(c => <button key={c} className={'jp-col' + (ui.penColor.toLowerCase() === c ? ' on' : '')} style={{ background: c }} aria-label={`Ink colour ${c}`} onClick={() => ui.set({ penColor: c, tool: ui.tool === 'eraser' ? 'pen' : ui.tool })} />)}
      <button className="jp-col rainbow" aria-label="Custom colour" title="Custom colour" onClick={custom} />
    </div>
  );
}
function ShapeFlyout() {
  const ui = useJam(); const pick = (k: ShapeKind) => ui.set({ tool: 'shape', shape: k, panel: 'shapes' });
  const line = (route: 'straight' | 'elbow' | 'curve', arrow: boolean) => ui.set({ tool: 'connector', route, connArrow: arrow, panel: 'shapes' });
  const conn = (route: string, arrow: boolean) => ui.tool === 'connector' && ui.route === route && ui.connArrow === arrow;
  const quick: ShapeKind[] = ['rect', 'ellipse', 'diamond', 'triangle', 'triangleDown', 'round', 'cylinder'];
  const name = (r: string, a: boolean) => `Connector ${r}${a ? '' : ' no arrow'}`;
  return (
    <div className="jam-flyout2" onPointerDown={e => e.stopPropagation()} role="toolbar" aria-label="Shapes and connectors">
      <button className="jf-cur" aria-label="All shapes" title="All shapes" aria-expanded={ui.moreShapes} onClick={() => ui.set({ moreShapes: !ui.moreShapes })}><ShapeGlyph kind={ui.shape} size={26} /><JIcon n="chevD" size={12} /></button>
      <span className="jm-sep tall" />
      <button className={'jf' + (conn('elbow', true) ? ' on' : '')} aria-label={name('elbow', true)} title="Elbow connector" onClick={() => line('elbow', true)}><RouteGlyph route="elbow" /></button>
      <button className={'jf' + (conn('curve', true) ? ' on' : '')} aria-label={name('curve', true)} title="Curved connector" onClick={() => line('curve', true)}><RouteGlyph route="curve" /></button>
      <button className={'jf' + (conn('straight', true) ? ' on' : '')} aria-label={name('straight', true)} title="Arrow" onClick={() => line('straight', true)}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.600" strokeLinecap="round" strokeLinejoin="round"><path d="M5 19L19 5M10 5h9v9" /></svg></button>
      <button className={'jf' + (conn('straight', false) ? ' on' : '')} aria-label={name('straight', false)} title="Line" onClick={() => line('straight', false)}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.600" strokeLinecap="round"><path d="M5 19L19 5" /></svg></button>
      {quick.map(k => <button key={k} className={'jf' + (ui.tool === 'shape' && ui.shape === k ? ' on' : '')} aria-label={`Shape ${k}`} title={k} onClick={() => pick(k)}><ShapeGlyph kind={k} size={28} /></button>)}
      <span className="jm-sep tall" />
      <button className="jf-more" aria-label="More shapes" aria-expanded={ui.moreShapes} onClick={() => ui.set({ moreShapes: !ui.moreShapes })}>More shapes</button>
      {ui.moreShapes && <div className="jf-all"><div className="jm-grid shapes">{SHAPE_KINDS.map(k => <button key={k} className={'jm-b' + (ui.shape === k && ui.tool === 'shape' ? ' on' : '')} aria-label={`Shape ${k}`} title={k} onClick={() => pick(k)}><ShapeGlyph kind={k} size={22} /></button>)}</div><Swatches colors={SHAPE_COLORS} value={ui.shapeFill} label="New shape fill" onPick={c => ui.set({ shapeFill: c })} /></div>}
    </div>
  );
}
function Toolbar({ fileInput, open, setTool }: { fileInput: React.RefObject<HTMLInputElement | null>; open: (p: Panel) => void; setTool: (t: Tool, x?: Partial<ReturnType<typeof useJam.getState>>) => void }) {
  const ui = useJam(); const T = (id: Tool) => ui.tool === id;
  const drawing = T('pen') || T('marker') || T('highlighter') || T('eraser');
  const plus = (e: React.MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); useEditor.getState().set({ menu: { x: r.right - 200, y: r.top - 190, items: [
    { label: 'Add image…', shortcut: 'I', run: () => fileInput.current?.click() }, { label: 'Link card', shortcut: 'L', run: () => setTool('link') },
    { label: 'Emoji stamp', run: () => setTool('stamp') }, { label: '', separator: true },
    { label: 'Templates…', run: () => open('templates') }, { label: 'Timer, music and voting…', run: () => open('tmv') },
    { label: 'Keyboard shortcuts', shortcut: '?', run: () => open('help') },
  ] } }); };
  const ib = (id: Tool, icon: JamIcon, label: string, key: string, extra?: Partial<ReturnType<typeof useJam.getState>>) => <button className={'jt2' + (T(id) ? ' on' : '')} aria-label={label} aria-pressed={T(id)} title={`${label} (${key})`} onClick={() => setTool(id, extra)}><JIcon n={icon} size={20} /></button>;
  return (
    <>
      {T('sticky') && <div className="jam-opts"><span className="muted">Sticky colour</span><Swatches colors={STICKY_COLORS} value={ui.stickyColor} label="New sticky colour" onPick={c => ui.set({ stickyColor: c })} /></div>}
      {drawing && <PenFlyout />}
      <div className="jam-dock2" role="toolbar" aria-label="Whiteboard tools">
        <div className="jd-group">
          <button className={'jd-sel' + (T('select') ? ' on' : '')} aria-label="Select" aria-pressed={T('select')} title="Select (V)" onClick={() => setTool('select')}><svg width="18" height="18" viewBox="0 0 24 24" fill={T('select') ? '#fff' : 'none'} stroke={T('select') ? '#fff' : 'currentColor'} strokeWidth="1.600" strokeLinejoin="round"><path d="M5 3l14 7-6 2-2 6z" /></svg></button>
          <button className={'jd-sel' + (T('hand') ? ' on' : '')} aria-label="Hand" aria-pressed={T('hand')} title="Hand (H)" onClick={() => setTool('hand')}><JIcon n="hand" size={20} /></button>
        </div>
        <div className="jd-group art">
          <button className={'jd-art pen' + (drawing ? ' on' : '')} aria-label="Draw" aria-pressed={drawing} title="Pen (P), marker (M), highlighter, eraser (E)" onClick={() => setTool(ui.pen as Tool)}><PenArt /></button>
          <button className={'jd-art sticky' + (T('sticky') ? ' on' : '')} aria-label="Sticky note" aria-pressed={T('sticky')} title="Sticky note (S)" onClick={() => setTool('sticky')}><StickyArt color={ui.stickyColor} /></button>
          <button className={'jd-cluster' + (T('shape') || T('connector') ? ' on' : '')} aria-label="Shape" aria-pressed={T('shape') || T('connector')} aria-expanded={ui.panel === 'shapes'} title="Shapes and connectors (R, O, X)" onClick={() => { if (ui.panel === 'shapes') ui.set({ panel: null }); else ui.set({ tool: T('connector') ? 'connector' : 'shape', panel: 'shapes', editing: null }); }}>
            <span className="jc-sq" /><svg className="jc-arrow" width="26" height="22" viewBox="0 0 34 30" fill="none" stroke="currentColor" strokeWidth="2.400" strokeLinecap="round" strokeLinejoin="round"><path d="M5 24c0-10 9-14 22-12" /><path d="M21 5l7 7-7 7" /></svg><span className="jc-circ" />
          </button>
          {ui.panel === 'shapes' && <ShapeFlyout />}
        </div>
        <div className="jd-group tools">
          {ib('text', 'text', 'Text', 'T')}
          {ib('section', 'sectionBox', 'Section', 'Shift+S')}
          {ib('table', 'table', 'Table', 'B')}
          {ib('code', 'codeDoc', 'Code block', 'K')}
          <span className="stamp-wrap"><button className={'jt2' + (T('stamp') ? ' on' : '')} aria-label="Stamp" aria-pressed={T('stamp')} aria-expanded={ui.panel === 'stamps'} title="Stamps (Shift+E)" onClick={() => { if (ui.panel === 'stamps') ui.set({ panel: null }); else ui.set({ tool: 'stamp', panel: 'stamps', editing: null }); }}><JIcon n="stampTool" size={20} /></button>{ui.panel === 'stamps' && <StampWheel onPick={() => ui.set({ panel: null })} />}</span>
          {ib('comment', 'comment', 'Comment', 'C')}
          <button className={'jt2' + (ui.panel === 'more' ? ' on' : '')} aria-label="Widgets" title="Widgets: timer, vote, link, image, table, code" onClick={() => open('more')}><JIcon n="widgets" size={20} /></button>
          <button className="jd-plus" aria-label="More" title="Image, link, templates and more" onClick={plus}><JIcon n="plus" size={16} /></button>
        </div>
      </div>
    </>
  );
}

function Templates({ onPick }: { onPick: (t: (typeof TEMPLATES)[number]) => void }) {
  return (
    <div className="jam-panel" role="dialog" aria-label="Templates" onPointerDown={e => e.stopPropagation()}>
      <h4>Templates</h4>
      <div className="jam-tpl">{TEMPLATES.map(t => <button key={t.id} className="jam-tcard" onClick={() => onPick(t)}><b>{t.name}</b><span className="muted">{t.blurb}</span></button>)}</div>
    </div>
  );
}

function MorePanel({ store, capi, fileInput, session }: { store: JamStore; capi: CanvasApi | null; fileInput: React.RefObject<HTMLInputElement | null>; session: JamSession }) {
  const ui = useJam(); const v = store.board.voting; const [per, setPer] = useState('3');
  const c = capi?.viewportCenter() ?? { x: 0, y: 0 };
  const add = (it: JamItem) => { store.add([it]); ui.set({ selection: [it.id], panel: null, tool: 'select' }); };
  const total = Object.values(store.board.items).reduce((a, i) => a + voteTotal(i), 0);
  return (
    <div className="jam-panel" role="dialog" aria-label="More tools" onPointerDown={e => e.stopPropagation()}>
      <h4>Widgets</h4>
      <div className="jam-wgrid">
        <button className="jam-w" onClick={() => add(makeItem('timer', c.x - 110, c.y - 42))}><JIcon n="timer" size={20} />Timer</button>
        <button className="jam-w" onClick={() => { ui.set({ panel: null, tool: 'vote' }); }}><JIcon n="vote" size={20} />Vote</button>
        <button className="jam-w" onClick={() => { ui.set({ panel: null, tool: 'link' }); }}><JIcon n="link" size={20} />Link</button>
        <button className="jam-w" onClick={() => fileInput.current?.click()}><JIcon n="image" size={20} />Image</button>
        <button className="jam-w" onClick={() => add(makeItem('table', c.x - 180, c.y - 60))}><JIcon n="table" size={20} />Table</button>
        <button className="jam-w" onClick={() => add(makeItem('code', c.x - 180, c.y - 90))}><JIcon n="code" size={20} />Code</button>
      </div>
      <h4>Voting session</h4>
      {!v?.active ? (
        <div className="jam-vrow">
          <label>Votes per person <Select className="jm-sel" aria-label="Votes per person" value={per} onChange={e => setPer(e.target.value)}>{[1, 2, 3, 5, 8, 10].map(n => <option key={n}>{n}</option>)}</Select></label>
          <button className="btn primary small" onClick={() => { store.change(b => { b.voting = { active: true, perUser: Number(per), hidden: b.voting?.hidden ?? false }; }); ui.set({ tool: 'vote', panel: null }); }}>Start voting</button>
        </div>
      ) : (
        <div className="jam-vrow col">
          <span className="muted">{v.perUser} votes each · {total} cast · Alt-click removes a vote</span>
          <label className="row"><input type="checkbox" checked={v.hidden} onChange={e => store.change(b => { b.voting!.hidden = e.target.checked; })} /> Hide other people’s votes</label>
          <div className="row"><button className="btn small" onClick={() => store.change(b => { b.voting!.active = false; b.voting!.hidden = false; })}>End voting</button></div>
        </div>
      )}
      {total > 0 && !v?.active && <button className="btn small" onClick={async () => { if (await askConfirm('Clear all votes?', { okLabel: 'Clear votes', danger: true })) store.change(b => { for (const i of Object.values(b.items)) delete i.votes; }); }}>Clear all votes ({total})</button>}
      <h4>Board</h4>
      <div className="jam-vrow"><button className="btn small" onClick={() => ui.set({ panel: 'help' })}>Keyboard shortcuts</button><span className="muted small">{store.board.order.length} items · {session.file.name}</span></div>
    </div>
  );
}

function ExportPanel({ store, session }: { store: JamStore; session: JamSession }) {
  const ui = useJam(); const dark = useEditor(s => s.theme) === 'dark'; const [scale, setScale] = useState('2'); const [busy, setBusy] = useState(false);
  const ids = ui.selection.filter(i => store.board.items[i]);
  const png = async (which: 'all' | 'sel') => { setBusy(true); try { const ids2 = which === 'sel' ? ids : null; const b = await exportPng(store.board, ids2, dark, Number(scale)); if (!b) { useEditor.getState().toast('Nothing to export', 'error'); return; } download(b, `${session.file.name}${which === 'sel' ? ' (selection)' : ''}.png`); } finally { setBusy(false); } };
  return (
    <div className="jam-panel right" role="dialog" aria-label="Export" onPointerDown={e => e.stopPropagation()}>
      <h4>Export</h4>
      <div className="jam-vrow"><label>Scale <Select className="jm-sel" aria-label="Export scale" value={scale} onChange={e => setScale(e.target.value)}><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option></Select></label></div>
      <div className="jam-vrow col">
        <button className="btn primary" disabled={busy} onClick={() => png('all')}>Whole board as PNG</button>
        <button className="btn" disabled={busy || !ids.length} onClick={() => png('sel')}>Selection as PNG</button>
        <button className="btn" onClick={() => download(new Blob([JSON.stringify({ format: 'layr-whiteboard', exportedAt: new Date().toISOString(), name: session.file.name, board: store.board })], { type: 'application/json' }), `${session.file.name}.layrjam.json`)}>Board file (.layrjam.json)</button>
      </div>
    </div>
  );
}

function CommentList({ store, capi }: { store: JamStore; capi: CanvasApi | null }) {
  const ui = useJam(); const cs = store.board.comments;
  return (
    <div className="jam-panel right" role="dialog" aria-label="Comments" onPointerDown={e => e.stopPropagation()}>
      <h4>Comments</h4>
      <label className="row small"><input type="checkbox" checked={ui.showResolved} onChange={e => ui.set({ showResolved: e.target.checked })} /> Show resolved</label>
      {!cs.length && <p className="muted small">No comments yet. Press C and click the board to start a thread.</p>}
      <div className="jam-clist">{cs.filter(c => ui.showResolved || !c.resolved).map(c => <button key={c.id} className="jam-citem" onClick={() => { const it = c.itemId ? store.board.items[c.itemId] : null; capi?.fit(it ? [it.id] : undefined); if (!it) { const cam = ui.camera; ui.set({ camera: { ...cam, x: c.x - (capi?.size().w ?? 800) / 2 / cam.zoom, y: c.y - (capi?.size().h ?? 600) / 2 / cam.zoom } }); } ui.set({ openComment: c.id, panel: null }); }}><b>{c.author}</b><span>{c.text}</span>{c.resolved && <em className="muted small">Resolved</em>}</button>)}</div>
    </div>
  );
}

function Help() {
  const m = isMac ? '⌘' : 'Ctrl';
  const rows: [string, string][] = [['V / H', 'Select / hand (hold Space to pan)'], ['S, Shift+S', 'Sticky note, section'], ['T', 'Text'], ['R, O, D', 'Rectangle, ellipse, diamond'], ['X', 'Connector'], ['P, M, Shift+M, E', 'Pen, marker, highlighter, eraser'], ['B, K, L', 'Table, code block, link card'], ['C', 'Comment'], ['N', 'Vote (during a session)'], ['I', 'Add image'], ['Tab', 'Add connected item (sticky or shape)'], [`${m}+D`, 'Duplicate (or Alt-drag)'], [`${m}+G / ⇧${m}+G`, 'Group / ungroup'], [`${m}+]  /  [`, 'Bring forward / send backward'], ['⇧1 / ⇧2', 'Zoom to fit / selection'], [`${m}+scroll`, 'Zoom'], ['Enter', 'Edit text of the selected item'], ['Shift (drag)', 'Constrain proportions, axis or angle']];
  return <div className="jam-panel right wide" role="dialog" aria-label="Keyboard shortcuts" onPointerDown={e => e.stopPropagation()}><h4>Keyboard shortcuts</h4><div className="jam-keys">{rows.map(([k, d]) => <div key={k}><kbd>{k}</kbd><span>{d}</span></div>)}</div></div>;
}
void groupMembers; void storage;
