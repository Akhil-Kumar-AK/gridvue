import { useState } from 'react';
import { addNode, defaultNode, topFrames, unionRects, worldBounds, rectsIntersect } from '@layr/core';
import type { EditorSession } from './session';
import type { CanvasController } from './controller';
import { useEditor } from './state';
import { FRAME_PRESETS, type FramePreset } from './presetData';

/** Create a top-level frame of the preset size in the middle of the viewport (shifted right if that spot is taken). */
export function insertPresetFrame(session: EditorSession, ctrl: CanvasController | null, p: FramePreset): string | null {
  const ui = useEditor.getState();
  if (!session.canEdit) { ui.toast('View-only: you cannot edit this file', 'error'); return null; }
  const cam = ui.camera, vw = (ctrl?.w ?? 800) / cam.zoom, vh = (ctrl?.h ?? 600) / cam.zoom;
  let x = Math.round(cam.x + vw / 2 - p.w / 2), y = Math.round(cam.y + vh / 2 - p.h / 2);
  const doc = session.store.doc;
  const others = topFrames(doc, ui.pageId).map(f => worldBounds(doc, f.id));
  for (let guard = 0; guard < 50; guard++) {
    const hit = others.find(o => rectsIntersect({ x, y, w: p.w, h: p.h }, o));
    if (!hit) break;
    x = Math.round(hit.x + hit.w + 40);
  }
  void unionRects;
  const f = defaultNode('FRAME', { name: p.name, x, y, width: p.w, height: p.h });
  addNode(session.store, f, ui.pageId);
  ui.set({ selection: [f.id], tool: 'select' });
  ctrl?.setTool('select');
  return f.id;
}

/** Right-panel preset list shown while the Frame tool is active. */
export function FramePresets({ session, ctrl }: { session: EditorSession; ctrl: CanvasController | null }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ social: true });
  return (
    <div className="ibody presets" role="region" aria-label="Frame presets">
      <div className="ihead"><h3>Frame</h3></div>
      {FRAME_PRESETS.map(g => (
        <section key={g.id} className="pgroup">
          <button className="pgh" aria-expanded={!!open[g.id]} onClick={() => setOpen({ ...open, [g.id]: !open[g.id] })}><span className="tri" aria-hidden>{open[g.id] ? '▾' : '▸'}</span>{g.label}</button>
          {open[g.id] && g.items.map(p => (
            <button key={p.name} className="pitem" onClick={() => insertPresetFrame(session, ctrl, p)} title={`Add a ${p.w} × ${p.h} frame`}><span>{p.name}</span><span className="dims">{p.w}×{p.h}</span></button>
          ))}
        </section>
      ))}
      <div className="muted small pad">Pick a size to add a frame, or drag on the canvas to draw a custom one.</div>
    </div>
  );
}
