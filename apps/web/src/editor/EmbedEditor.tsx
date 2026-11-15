import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { screenToWorld, worldBounds, worldToScreen, type BoardData } from '@layr/core';
import { api, type FileMeta } from '../api';
import { JamEditor } from '../jam/JamEditor';
import type { JamSession } from '../jam/session';
import { useJam } from '../jam/store';
import { useEditor } from './state';
import type { EditorSession } from './session';
import { jamToDesign } from './embedExport';
import { embedBarHeight } from '../engine/render';

/**
 * The selected whiteboard card is live: the real whiteboard is laid over its body, so you click, draw, zoom and drag right on the canvas.
 * Resize or move the card like any layer (header and corners). Drag items off the board onto the design to turn them into editable layers.
 * Only one card is live at a time (the selected one); the others show their saved preview picture.
 */
export function EmbedEditor({ session }: { session: EditorSession }) {
  const store = session.store;
  useSyncExternalStore(store.subscribe.bind(store), () => store.version);
  const cam = useEditor(s => s.camera);
  const sel = useEditor(s => s.selection);
  const want = sel.length === 1 && store.doc.nodes[sel[0]]?.type === 'EMBED' ? sel[0] : null;
  // switching cards unmounts the old board first so its pending save runs before the next board starts
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => {
    if (want === live) return;
    if (live !== null) { setLive(null); if (want === null) return; const t = setTimeout(() => setLive(want), 60); return () => clearTimeout(t); }
    setLive(want);
  }, [want, live]);
  const node = live ? store.doc.nodes[live] : undefined;
  if (!live || !node?.embed || live !== want) return null;
  return <LiveBoard key={live} session={session} nodeId={live} />;
}

function LiveBoard({ session, nodeId }: { session: EditorSession; nodeId: string }) {
  const store = session.store; const doc = store.doc;
  const node = doc.nodes[nodeId]; const embed = node.embed!;
  const cam = useEditor(s => s.camera);
  const [data, setData] = useState<{ file: FileMeta; role: FileMeta['role']; board: BoardData } | null>(null);
  const [err, setErr] = useState('');
  const jam = useRef<JamSession | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<{ x: number; y: number } | null>(null);
  const [hasSel, setHasSel] = useState(false);
  // the board's own store updates while its editor renders, so listen outside React's render phase
  useEffect(() => useJam.subscribe(s => { const v = s.selection.length > 0; queueMicrotask(() => setHasSel(v)); }), []);

  useEffect(() => {
    let alive = true;
    api.getFile(embed.fileId).then(r => { if (alive) setData({ file: r.file, role: r.role, board: r.document as BoardData }); }).catch(e => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [embed.fileId]);

  const stage = () => box.current?.parentElement as HTMLElement | null;
  const worldAt = (clientX: number, clientY: number) => { const r = stage()!.getBoundingClientRect(); return screenToWorld(useEditor.getState().camera, { x: clientX - r.left, y: clientY - r.top }); };

  // keyboard focus: the board owns the keys while you are working inside it; and drag-out detection
  useEffect(() => {
    let snap: Record<string, [number, number]> | null = null, sx = 0, sy = 0;
    const outside = (e: PointerEvent) => { const r = box.current?.getBoundingClientRect(); return !r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
    const down = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) {
        useEditor.getState().set({ embedFocus: true });
        const items = jam.current?.store.board.items; if (items) snap = Object.fromEntries(Object.values(items).map(i => [i.id, [i.x, i.y] as [number, number]]));
        sx = e.clientX; sy = e.clientY;
      } else { snap = null; useEditor.getState().set({ embedFocus: false }); }
    };
    const move = (e: PointerEvent) => { if (snap && e.buttons && Math.hypot(e.clientX - sx, e.clientY - sy) > 8 && outside(e)) setHint({ x: e.clientX, y: e.clientY }); else setHint(null); };
    const up = (e: PointerEvent) => {
      setHint(null);
      const s = snap; snap = null;
      const j = jam.current; if (!s || !j || !outside(e) || Math.hypot(e.clientX - sx, e.clientY - sy) < 8) return;
      const { clientX, clientY } = e;
      setTimeout(async () => { // after the board has finished its own drag handling
        const b = j.store.board;
        const moved = Object.values(b.items).filter(i => s[i.id] && (Math.abs(i.x - s[i.id][0]) > 1 || Math.abs(i.y - s[i.id][1]) > 1)).map(i => i.id);
        if (!moved.length) return;
        const ids = [...moved];
        j.store.undo(); // the board keeps its items where they were: dragging out copies them
        const sr = stage()?.getBoundingClientRect();
        if (!sr || clientX < sr.left || clientX > sr.right || clientY < sr.top || clientY > sr.bottom) return;
        const w = worldAt(clientX, clientY);
        await jamToDesign(session, j.store.board, ids, { ...w, center: true });
      }, 0);
    };
    window.addEventListener('pointerdown', down, true); window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); useEditor.getState().set({ embedFocus: false }); };
  }, []);

  // keep the compact toolbar inside the card
  useEffect(() => {
    const el = box.current; if (!el) return;
    // the toolbar follows the design's zoom (bigger when zoomed in, smaller when zoomed out) but never wider than the card
    const fit = () => { const dock = el.querySelector<HTMLElement>('.jam-dock2'); if (!dock) return; const z = useEditor.getState().camera.zoom; const k = Math.max(0.2, Math.min((el.clientWidth - 12) / Math.max(dock.scrollWidth, dock.offsetWidth), z * 1.05, 3)); el.style.setProperty('--dock-scale', String(k)); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); const t = setTimeout(fit, 400);
    const un = useEditor.subscribe(fit);
    return () => { ro.disconnect(); clearTimeout(t); un(); };
  }, [data]);

  if (node.rotation) return null;
  const b = worldBounds(doc, nodeId); const o = worldToScreen(cam, { x: b.x, y: b.y }); const z = cam.zoom;
  const bar = embedBarHeight(node.height) * z, pad = 8;
  const width = node.width * z - pad * 2, height = node.height * z - bar - pad;
  if (width < 110 || height < 90 || width > 3200 || height > 3200) return null; // too small (or far too large) to work in; the card then just shows the board
  const sendSelection = () => {
    const j = jam.current; if (!j) return;
    const ids = useJam.getState().selection.filter(i => j.store.board.items[i]);
    if (ids.length) void jamToDesign(session, j.store.board, ids, { x: b.x + b.w + 40, y: b.y });
  };
  return (
    <>
      <div ref={box} className="embed-live" data-testid="embed-live" role="group" aria-label={`Live whiteboard ${embed.fileName}`} style={{ left: o.x + pad, top: o.y + bar, width, height, borderRadius: `0 0 ${Math.max(6, 12 * z)}px ${Math.max(6, 12 * z)}px` }}
        onContextMenu={e => e.stopPropagation()}>
        {data ? <JamEditor key={data.file.id} file={data.file} role={data.role} board={data.board} embedded onExit={() => {}} onSession={s => { jam.current = s; }} onClosed={() => session.images.refresh('embed:')} />
          : <div className="center-screen muted">{err || 'Loading whiteboard…'}</div>}
        <button className="embed-send" disabled={!hasSel} title="Copy the selected board items into the design file as editable layers (or just drag them out of the board)" onClick={sendSelection}>Send selection to design</button>
      </div>
      {hint && <div className="embed-drop" style={{ left: hint.x + 14, top: hint.y + 14 }}>Release to add to the design</div>}
    </>
  );
}
