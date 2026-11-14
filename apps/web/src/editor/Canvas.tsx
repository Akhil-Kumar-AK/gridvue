import { useEffect, useRef } from 'react';
import { CanvasController } from './controller';
import { useEditor } from './state';
import type { EditorSession } from './session';
import { DS_MIME } from '../designsystem/library';

export function Canvas({ session, onController }: { session: EditorSession; onController: (c: CanvasController) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<CanvasController | null>(null);

  useEffect(() => {
    const canvas = ref.current!, box = wrap.current!;
    const ctrl = new CanvasController(canvas, session);
    ctrlRef.current = ctrl; onController(ctrl);
    const fit = () => { const r = box.getBoundingClientRect(); ctrl.resize(r.width, r.height, window.devicePixelRatio || 1); };
    const ro = new ResizeObserver(fit); ro.observe(box); fit();
    const down = (e: PointerEvent) => ctrl.onPointerDown(e), move = (e: PointerEvent) => ctrl.onPointerMove(e), up = (e: PointerEvent) => ctrl.onPointerUp(e);
    const wheel = (e: WheelEvent) => ctrl.onWheel(e), dbl = (e: MouseEvent) => ctrl.onDoubleClick(e);
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('dblclick', dbl);
    const unsub = useEditor.subscribe((s, p) => { if (s.theme !== p.theme || s.selection !== p.selection || s.pageId !== p.pageId || s.camera !== p.camera || s.editingTextId !== p.editingTextId || s.guides !== p.guides || s.renaming !== p.renaming || s.hoverId !== p.hoverId) ctrl.requestRender(); });
    // first view: fit content
    ctrl.zoomToFit();
    return () => { ro.disconnect(); unsub(); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('dblclick', dbl); };
  }, [session]);

  return (
    <div ref={wrap} className="canvas-wrap"
      onDragOver={e => { if (e.dataTransfer.types.includes(DS_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } else if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={e => {
        const ds = e.dataTransfer.getData(DS_MIME); // a component dragged from the design system in the Assets panel
        if (ds && ctrlRef.current) {
          e.preventDefault();
          try { const { libId, nodeId } = JSON.parse(ds) as { libId: string; nodeId: string }; const r = wrap.current!.getBoundingClientRect(); const w = ctrlRef.current.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top }); session.insertFromLibrary(libId, nodeId, w, ctrlRef.current.dropParentAt(w)); } catch { /* ignore a malformed payload */ }
          return;
        }
        const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
        if (!f || !ctrlRef.current) return;
        e.preventDefault();
        const r = wrap.current!.getBoundingClientRect();
        void session.insertImage(f, ctrlRef.current.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top }));
      }}
      onContextMenu={e => e.preventDefault()}>
      <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }} data-testid="design-canvas" />
    </div>
  );
}
