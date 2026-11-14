import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { unionRects, worldBounds, type Rect } from '@layr/core';
import { useEditor, storage } from './state';
import type { EditorSession } from './session';
import type { CanvasController } from './controller';
import { Icon } from '../icons';

/** Overview of the page: top-level layers as tiles plus the current viewport; click or drag to move the camera. */
export function Minimap({ session, ctrl }: { session: EditorSession; ctrl: CanvasController | null }) {
  const store = session.store;
  const version = useSyncExternalStore(store.subscribe.bind(store), () => store.version);
  const cam = useEditor(s => s.camera);
  const pageId = useEditor(s => s.pageId);
  const dark = useEditor(s => s.theme) === 'dark';
  const [collapsed, setCollapsed] = useState(() => storage.get('layr:minimap', 'open') === 'closed');
  const ref = useRef<HTMLCanvasElement>(null);
  const map = useRef<{ bounds: Rect; scale: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const c = ref.current; if (!c || collapsed || !ctrl) return;
    const W = c.clientWidth, H = c.clientHeight, dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr;
    const x = c.getContext('2d')!; x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const doc = store.doc, kids = (doc.nodes[pageId]?.children ?? []).filter(i => doc.nodes[i].visible);
    const view: Rect = { x: cam.x, y: cam.y, w: ctrl.w / cam.zoom, h: ctrl.h / cam.zoom };
    const content = kids.length ? unionRects(kids.map(k => worldBounds(doc, k))) : view;
    const b = unionRects([content, view]);
    const pad = 10, scale = Math.min((W - pad * 2) / Math.max(b.w, 1), (H - pad * 2) / Math.max(b.h, 1));
    const ox = (W - b.w * scale) / 2 - b.x * scale, oy = (H - b.h * scale) / 2 - b.y * scale;
    map.current = { bounds: b, scale, ox, oy };
    x.clearRect(0, 0, W, H);
    for (const k of kids) {
      const n = doc.nodes[k], r = worldBounds(doc, k);
      const fill = n.fills.find(f => f.visible && f.type === 'SOLID');
      x.fillStyle = fill && fill.type === 'SOLID' ? fill.color : dark ? '#4a4663' : '#b9b3d6'; x.globalAlpha = 0.9;
      x.beginPath(); x.roundRect(r.x * scale + ox, r.y * scale + oy, Math.max(2, r.w * scale), Math.max(2, r.h * scale), 2); x.fill(); x.globalAlpha = 1;
    }
    x.strokeStyle = '#4f46e5'; x.lineWidth = 1.5; x.fillStyle = 'rgba(79,70,229,.14)';
    x.beginPath(); x.roundRect(view.x * scale + ox, view.y * scale + oy, view.w * scale, view.h * scale, 3); x.fill(); x.stroke();
  }, [version, cam, pageId, collapsed, dark, ctrl]);

  const jump = (e: React.PointerEvent) => {
    const m = map.current, c = ref.current; if (!m || !c || !ctrl) return;
    const r = c.getBoundingClientRect();
    const wx = (e.clientX - r.left - m.ox) / m.scale, wy = (e.clientY - r.top - m.oy) / m.scale;
    ctrl.setCamera({ ...cam, x: wx - ctrl.w / cam.zoom / 2, y: wy - ctrl.h / cam.zoom / 2 });
  };
  return (
    <div className={'minimap' + (collapsed ? ' collapsed' : '')} role="region" aria-label="Minimap">
      <header><span>Overview</span><button aria-label={collapsed ? 'Show minimap' : 'Hide minimap'} title={collapsed ? 'Show minimap' : 'Hide minimap'} onClick={() => { const n = !collapsed; setCollapsed(n); storage.set('layr:minimap', n ? 'closed' : 'open'); }}><Icon n={collapsed ? 'chevR' : 'chevD'} size={12} /></button></header>
      <canvas ref={ref} data-testid="minimap" onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); jump(e); }} onPointerMove={e => { if (e.buttons) jump(e); }} />
    </div>
  );
}

export function ZoomPill({ ctrl }: { ctrl: CanvasController | null }) {
  const zoom = useEditor(s => s.camera.zoom);
  return (
    <div className="zoompill" role="group" aria-label="Zoom">
      <button aria-label="Zoom out" onClick={() => ctrl?.zoomBy(0.8)}>−</button>
      <button aria-label="Reset zoom" title="Zoom to 100%" onClick={() => ctrl?.zoomTo(1)}>{Math.round(zoom * 100)}%</button>
      <button aria-label="Zoom in" onClick={() => ctrl?.zoomBy(1.25)}>+</button>
      <button aria-label="Zoom to fit" title="Zoom to fit (⇧1)" onClick={() => ctrl?.zoomToFit()}><Icon n="expand" size={14} /></button>
    </div>
  );
}
