import { useEffect, useRef, useState } from 'react';
import type { BoardData } from '@layr/core';
import { api } from '../api';
import { Icon } from '../icons';
import { fitBoardCamera, renderBoardCanvas } from '../jam/render';

/** A prototype step that opens one of your whiteboards: a read-only view you can pan (drag) and zoom (wheel), with a button to open the board for editing. */
export function WhiteboardView({ fileId, fileName, onClose }: { fileId: string; fileName: string; onClose: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [err, setErr] = useState('');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const [tick, setTick] = useState(0);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const dark = document.documentElement.dataset.theme === 'dark';

  useEffect(() => {
    let alive = true;
    api.getFile(fileId).then(r => { if (alive) setBoard(r.document as BoardData); }).catch(() => { if (alive) setErr('This whiteboard is not available to you.'); });
    return () => { alive = false; };
  }, [fileId]);
  useEffect(() => { const el = wrap.current; if (!el) return; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight }); return () => ro.disconnect(); }, []);
  useEffect(() => { if (board && size.w && !cam) setCam(fitBoardCamera(board, size.w, size.h)); }, [board, size.w, size.h, cam]);
  useEffect(() => {
    const c = cv.current; if (!c || !board || !cam || !size.w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const src = renderBoardCanvas(board, size.w, size.h, dpr, dark, () => setTick(t => t + 1), cam);
    c.width = src.width; c.height = src.height; c.getContext('2d')!.drawImage(src, 0, 0);
  }, [board, cam, size.w, size.h, tick, dark]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true); }, [onClose]);

  const wheel = (e: React.WheelEvent) => {
    if (!cam) return; const r = cv.current!.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
    const z = Math.max(0.05, Math.min(4, cam.zoom * Math.exp(-e.deltaY * 0.0015)));
    setCam({ zoom: z, x: cam.x + px / cam.zoom - px / z, y: cam.y + py / cam.zoom - py / z });
  };
  return (
    <div className="wb-view" role="dialog" aria-label={`Whiteboard ${fileName}`} data-testid="wb-view">
      <div className="wb-bar">
        <span className="wb-title"><Icon n="whiteboard" size={18} />{fileName}</span>
        <span className="muted small">Drag to pan · wheel to zoom</span>
        <span className="spacer" />
        <button className="btn small" onClick={() => board && setCam(fitBoardCamera(board, size.w, size.h))}>Fit</button>
        <a className="btn small" href={`#/file/${fileId}`} target="_blank" rel="noreferrer">Open whiteboard</a>
        <button className="btn small primary" onClick={onClose}>Back to prototype</button>
      </div>
      <div className="wb-stage" ref={wrap}>
        {err ? <div className="center-screen muted">{err}</div> : !board ? <div className="center-screen muted">Loading whiteboard…</div>
          : <canvas ref={cv} style={{ width: size.w, height: size.h, display: 'block', cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none' }} data-testid="wb-canvas" onWheel={wheel}
              onPointerDown={e => { if (!cam) return; (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }; }}
              onPointerMove={e => { const d = drag.current; if (d && cam) setCam({ ...cam, x: d.cx - (e.clientX - d.x) / cam.zoom, y: d.cy - (e.clientY - d.y) / cam.zoom }); }}
              onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />}
      </div>
    </div>
  );
}
