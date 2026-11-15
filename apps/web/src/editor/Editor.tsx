import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, api, buildNativeFile } from '../api';
import { Canvas } from './Canvas';
import { LeftPanel } from './Layers';
import { EmbedEditor } from './EmbedEditor';
import { Dock } from './Dock';
import { VariablesPage } from './Variables';
import { PrototypePanel } from './PrototypePanel';
import { FramePresets } from './FramePresets';
import { PanelHeader } from './PanelHeader';
import { CanvasTopBar } from './CanvasTopBar';
import { Player, pickStart } from '../proto/Player';
import { Icon } from '../icons';
import { Inspector } from './Inspector';
import { CommandPalette, ContextMenu, ExportDialog, FrameRename, ShareDialog, TextEditor, Toasts } from './Overlays';
import { buildActions, contextMenuItems, shortcutFor, type Action, isMac } from './actions';
import { EditorSession } from './session';
import { useEditor, storage, type Tool } from './state';
import { JamEditor } from '../jam/JamEditor';
import type { BoardData } from '@layr/core';
import type { FileMeta } from '../api';
import { DEFAULT_CANVAS_DARK, DEFAULT_CANVAS_LIGHT, type CanvasController } from './controller';

const viewByFile = new Map<string, { camera: { x: number; y: number; zoom: number }; pageId: string; selection: string[]; mode: 'design' | 'prototype' }>();

export function Editor({ fileId, onExit }: { fileId: string; onExit: () => void }) {
  const [session, setSession] = useState<EditorSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jam, setJam] = useState<{ file: FileMeta; role: FileMeta['role']; board: BoardData } | null>(null);
  useEffect(() => {
    let s: EditorSession | null = null; let alive = true;
    api.getFile(fileId).then(r => {
      if (!alive) return;
      if (r.file.type === 'whiteboard') { // FigJam-style boards have their own editor
        window.dispatchEvent(new CustomEvent('layr:rename', { detail: { id: r.file.id, name: r.file.name, type: 'whiteboard' } }));
        setJam({ file: r.file, role: r.role, board: r.document as unknown as BoardData }); return;
      }
      s = new EditorSession(r.file, r.role, r.document); setSession(s);
      window.dispatchEvent(new CustomEvent('layr:rename', { detail: { id: r.file.id, name: r.file.name, type: r.file.type } }));
      const v = viewByFile.get(fileId); // come back to where you were in this tab
      if (v && s.store.doc.nodes[v.pageId]) useEditor.getState().set({ camera: v.camera, pageId: v.pageId, selection: v.selection.filter(i => s!.store.doc.nodes[i]), mode: v.mode });
      else useEditor.getState().set({ mode: 'design' });
    }).catch((e: ApiError) => { if (!alive) return; if (e.status === 404) window.dispatchEvent(new CustomEvent('layr:gone', { detail: { id: fileId } })); setError(e.status === 404 ? 'This file does not exist or you do not have access.' : e.message); });
    return () => {
      alive = false;
      if (s) {
        const ui = useEditor.getState();
        viewByFile.set(fileId, { camera: ui.camera, pageId: ui.pageId, selection: ui.selection, mode: ui.mode });
        const done = s; void done.saveNow().finally(() => done.dispose()); // flush edits before the tab goes away
      }
    };
  }, [fileId]);
  if (error) return <div className="center-screen"><div className="card-msg"><h2>Cannot open file</h2><p>{error}</p><button className="btn primary" onClick={onExit}>Back to files</button></div></div>;
  if (jam) return <JamEditor key={jam.file.id} file={jam.file} role={jam.role} board={jam.board} onExit={onExit} />;
  if (!session) return <div className="center-screen muted">Loading…</div>;
  return <EditorShell key={session.file.id} session={session} onExit={onExit} />;
}

function EditorShell({ session, onExit }: { session: EditorSession; onExit: () => void }) {
  const [ctrl, setCtrl] = useState<CanvasController | null>(null);
  const ctrlRef = useRef<CanvasController | null>(null);
  useEffect(() => { ctrlRef.current = ctrl; }, [ctrl]);
  const store = session.store;
  useSyncExternalStore(store.subscribe.bind(store), () => store.version);
  const ui = useEditor();
  // animate only the collapse / expand itself (not live resizing)
  const [navAnim, setNavAnim] = useState(false);
  const prevCollapsed = useRef(ui.leftCollapsed);
  if (prevCollapsed.current !== ui.leftCollapsed) { prevCollapsed.current = ui.leftCollapsed; if (!navAnim) setNavAnim(true); } // same commit as the new column widths, so the transition runs
  useEffect(() => { if (!navAnim) return; const t = setTimeout(() => setNavAnim(false), 380); return () => clearTimeout(t); }, [navAnim]);
  const set = ui.set;
  const actions = useMemo(() => buildActions(session, () => ctrlRef.current), [session]);
  const byId = (id: string) => actions.find(a => a.id === id)!;
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { document.documentElement.dataset.theme = ui.theme; }, [ui.theme]);

  // ---- global keyboard ----
  useEffect(() => {
    const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (useEditor.getState().playing) return; // the player owns the keyboard while presenting
      if (useEditor.getState().embedFocus) return; // so does a live whiteboard card while you work inside it
      const c = ctrlRef.current;
      const m = isMac ? e.metaKey : e.ctrlKey;
      if (m && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === '/')) { e.preventDefault(); set({ paletteOpen: !useEditor.getState().paletteOpen }); return; }
      if (m && e.key === '\\') { e.preventDefault(); const n = !useEditor.getState().leftCollapsed; set({ leftCollapsed: n }); storage.set('layr:leftCollapsed', n ? '1' : '0'); return; }
      if (editable(e.target)) return;
      if (m && e.key.toLowerCase() === 's') { e.preventDefault(); void session.saveNow().then(() => useEditor.getState().toast(useEditor.getState().saveStatus === 'saved' ? 'All changes saved' : 'Saving…')); return; }
      if (c && (e.key === 'Enter' || e.key === 'Escape') && c.penActive) { e.preventDefault(); c.finishPen(false); return; }
      if (c && c.vectorEditing) {
        if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); c.deleteAnchors(); return; }
        if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); c.exitVectorEdit(); return; }
      }
      if (e.key === 'Enter' && !m) { const a = byId('vec.edit'); if (a?.enabled()) { e.preventDefault(); a.run(); return; } }
      if (e.code === 'Space') { e.preventDefault(); c?.setSpace(true); return; }
      if (e.key.startsWith('Arrow')) { e.preventDefault(); const d = e.shiftKey ? 10 : 1; c?.nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0); return; }
      if (e.key === 'Escape') { c?.cancelGesture(); set({ menu: null, pickSource: null }); }
      const id = shortcutFor(e);
      if (!id) return;
      if (id === 'edit.paste') return; // let the browser raise a paste event (Figma layers, images, then Layr's own clipboard)
      const a = byId(id);
      if (!a) return;
      e.preventDefault();
      if (a.enabled()) a.run();
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') ctrlRef.current?.setSpace(false); };
    const paste = (e: ClipboardEvent) => {
      if (editable(e.target) || useEditor.getState().embedFocus) return;
      const html = e.clipboardData?.getData('text/html');
      if (html && session.pasteFigma(html)) { e.preventDefault(); return; }
      const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); void session.insertImage(f); return; }
      const a = byId('edit.paste'); if (a?.enabled()) { e.preventDefault(); a.run(); }
    };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('paste', paste);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('paste', paste); };
  }, [session, actions]);

  // ---- resizable panels ----
  const startResize = (side: 'left' | 'right') => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, start = side === 'left' ? ui.leftWidth : ui.rightWidth;
    const move = (ev: PointerEvent) => { const d = ev.clientX - startX; const w = Math.min(480, Math.max(180, side === 'left' ? start + d : start - d)); set(side === 'left' ? { leftWidth: w } : { rightWidth: w }); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); storage.set(side === 'left' ? 'layr:left2' : 'layr:right5', String(useEditor.getState()[side === 'left' ? 'leftWidth' : 'rightWidth'])); ctrlRef.current?.requestRender(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const openMenu = (e: React.MouseEvent) => { e.preventDefault(); const x = e.clientX, y = e.clientY; setTimeout(() => set({ menu: { x, y, items: contextMenuItems(actions) } }), 0); };

  const user = useEditor(s => s.userName);
  useEffect(() => { api.me().then(r => set({ userName: r.user.name })).catch(() => {}); }, []);
  const present = () => {
    const start = pickStart(store.doc, ui.pageId, ui.selection);
    if (!start) return useEditor.getState().toast('Prototypes play frames: put your layers (including whiteboard cards) inside a top-level frame to present', 'error');
    void session.saveNow();
    set({ playing: start });
  };
  useEffect(() => { const h = () => present(); window.addEventListener('layr:present', h); return () => window.removeEventListener('layr:present', h); });
  const [zoomMenu, setZoomMenu] = useState(false);
  useEffect(() => { if (!zoomMenu) return; const c = () => setZoomMenu(false); window.addEventListener('pointerdown', c); return () => window.removeEventListener('pointerdown', c); }, [zoomMenu]);
  const z = (id: string) => actions.find(x => x.id === id)!;

  return (
    <div className="editor" style={{ ['--canvas-bg' as string]: store.doc.nodes[ui.pageId]?.canvasBg ?? (ui.theme === 'dark' ? DEFAULT_CANVAS_DARK : DEFAULT_CANVAS_LIGHT) }}>
      <SaveBanner session={session} />
      <div className={'editor-body' + (navAnim ? ' anim' : '')} style={{ gridTemplateColumns: ui.leftTab === 'variables' ? '52px 1fr' : `${ui.leftCollapsed ? 58 : ui.leftWidth}px ${ui.leftCollapsed ? 0 : 4}px 1fr 4px ${ui.rightWidth}px` }}>
        <aside className="panel left" onContextMenu={openMenu}><LeftPanel session={session} actions={actions} onExit={onExit} /></aside>
        {ui.leftTab === 'variables' && <VariablesPage session={session} />}
        <div className="resizer" style={ui.leftTab === 'variables' ? { display: 'none' } : ui.leftCollapsed ? { visibility: 'hidden' } : undefined} onPointerDown={startResize('left')} role="separator" aria-orientation="vertical" />
        <main className="stage" style={ui.leftTab === 'variables' ? { display: 'none' } : undefined} onContextMenu={openMenu}>
          <Canvas session={session} onController={setCtrl} />
          <CanvasTopBar session={session} actions={actions} ctrl={ctrl} />
          <TextEditor session={session} ctrl={ctrl} /><FrameRename session={session} ctrl={ctrl} />
          <Dock session={session} ctrl={ctrl} onPickImage={() => fileInput.current?.click()} />
          <EmbedEditor session={session} />
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void session.insertImage(f); e.target.value = ''; }} />
        </main>
        <div className="resizer" style={ui.leftTab === 'variables' ? { display: 'none' } : undefined} onPointerDown={startResize('right')} role="separator" aria-orientation="vertical" />
        <aside className="panel right" style={ui.leftTab === 'variables' ? { display: 'none' } : undefined}>
          <PanelHeader session={session} actions={actions} ctrl={ctrl} present={present} onShare={z('file.share').run} />
          {ui.mode === 'prototype' ? <PrototypePanel session={session} onPresent={present} /> : ui.tool === 'frame' ? <FramePresets session={session} ctrl={ctrl} /> : <Inspector session={session} ctrl={ctrl} actions={actions} />}
        </aside>
      </div>
      <ContextMenu /><CommandPalette actions={actions} /><ExportDialog session={session} /><ShareDialog session={session} /><Toasts />
      {ui.playing && store.doc.nodes[ui.playing] && <Player doc={store.doc} startFrame={ui.playing} fileId={session.file.id} onClose={() => set({ playing: null })} />}
    </div>
  );
}

function SaveBanner({ session }: { session: EditorSession }) {
  const { saveStatus, saveMessage } = useEditor();
  if (saveStatus !== 'conflict' && saveStatus !== 'error') return null;
  return (
    <div className="banner error" role="alert">
      <span>{saveMessage}</span>
      {saveStatus === 'conflict' && <>
        <button className="btn small" onClick={async () => { try { const nf = await buildNativeFile(session.file, session.store.doc); const r = await api.createFile({ name: `${session.file.name} (my changes)`, import: nf }); location.hash = `#/file/${r.file.id}`; } catch (e) { useEditor.getState().toast((e as Error).message, 'error'); } }}>Save my version as a copy</button>
        <button className="btn small" onClick={() => { try { localStorage.removeItem(`layr:backup:${session.file.id}`); } catch { /* ignore */ } location.reload(); }}>Discard mine, reload latest</button>
      </>}
    </div>
  );
}

