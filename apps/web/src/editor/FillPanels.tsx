import { useEffect, useRef, useState } from 'react';
import { IMAGE_ADJUST_KEYS, type ImageAdjust, type ImagePaint, type PatternAlign, type PatternPaint } from '@layr/core';
import { Icon } from '../icons';
import { Select } from '../ui/Select';
import { drawPaintPreview } from '../engine/render';
import { activeSession } from './session';
import { useEditor } from './state';
import type { PickerPaint } from './ColorPicker';

const strip = <T extends { visible?: boolean }>(p: T): Omit<T, 'visible'> => { const { visible: _v, ...rest } = p; void _v; return rest; };

/** Number box that edits as text and commits on Enter / blur. */
function NumBox({ value, min, max, label, icon, onCommit, ariaLabel }: { value: number; min: number; max: number; label?: string; icon?: React.ReactNode; onCommit: (v: number) => void; ariaLabel: string }) {
  const [t, setT] = useState(String(Math.round(value)));
  useEffect(() => setT(String(Math.round(value))), [value]);
  const commit = () => { const n = Number(t); if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n))); else setT(String(Math.round(value))); };
  return (
    <label className="fp-num">{icon ?? (label && <b>{label}</b>)}<input aria-label={ariaLabel} value={t} onChange={e => setT(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /><em>%</em></label>
  );
}

/** Draws a live preview of a paint (pattern tiles or an adjusted image) on a small canvas. */
function PaintCanvas({ paint, w, h }: { paint: PatternPaint | ImagePaint; w: number; h: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(paint);
  useEffect(() => {
    const s = activeSession, c = cv.current; if (!s || !c) return;
    let alive = true;
    const dpr = window.devicePixelRatio || 1; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const paintNow = () => {
      if (!alive) return; const g = c.getContext('2d'); if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      try { drawPaintPreview(g, s.store.doc, { ...paint, visible: true, opacity: 1 }, w, h, { images: s.images, scale: dpr }); } catch { /* preview only */ }
    };
    paintNow();
    if (paint.type === 'IMAGE') void s.images.ensure([paint.assetId]).then(paintNow);
    return () => { alive = false; };
  }, [key, w, h]);
  return <canvas ref={cv} className="fp-canvas" style={{ width: w, height: h }} aria-label="Fill preview" />;
}

const ALIGNS: { a: PatternAlign; label: string }[] = [
  { a: 'tl', label: 'top left' }, { a: 'tc', label: 'top centre' }, { a: 'tr', label: 'top right' },
  { a: 'ml', label: 'middle left' }, { a: 'c', label: 'centre' }, { a: 'mr', label: 'middle right' },
  { a: 'bl', label: 'bottom left' }, { a: 'bc', label: 'bottom centre' }, { a: 'br', label: 'bottom right' },
];

/** Pattern fill: repeat a layer from the canvas as a tile. Nothing is applied until a source layer has been chosen. */
export function PatternPanel({ paint, opacity, onChange }: { paint: PatternPaint | null; opacity: number; onChange: (p: PickerPaint) => void }) {
  const base: PatternPaint = { type: 'PATTERN', sourceId: null, tile: 'RECT', scale: 1, spacingX: 0, spacingY: 0, align: 'tl', opacity, visible: true };
  const [d, setD] = useState<PatternPaint>(paint ?? base);
  const dRef = useRef(d); dRef.current = d;
  const emit = useRef(onChange); emit.current = onChange;
  const [picking, setPicking] = useState(false);
  useEffect(() => { if (paint) setD(paint); }, [paint]);
  useEffect(() => () => { if (useEditor.getState().pickSource) useEditor.setState({ pickSource: null }); }, []);
  const apply = (patch: Partial<PatternPaint>) => { const n = { ...dRef.current, ...patch }; dRef.current = n; setD(n); if (n.sourceId) emit.current(strip(n) as PickerPaint); };
  const pick = () => {
    setPicking(true);
    useEditor.setState({ pickSource: id => { setPicking(false); apply({ sourceId: id }); } });
    useEditor.getState().toast('Click a layer on the canvas to repeat it. Press Esc to cancel.');
  };
  useEffect(() => { if (!picking) return; const t = setInterval(() => { if (!useEditor.getState().pickSource) setPicking(false); }, 200); return () => clearInterval(t); }, [picking]);
  const srcName = d.sourceId ? activeSession?.store.doc.nodes[d.sourceId]?.name : undefined;
  const missing = !!d.sourceId && !srcName;
  return (
    <div className="fp-body" data-testid="pattern-panel">
      <div className="fp-prev">
        {d.sourceId && !missing ? <><PaintCanvas paint={d} w={228} h={190} /><button className="fp-change" onClick={pick}>{picking ? 'Click a layer…' : `Source: ${srcName} · Change`}</button></>
          : <button className="fp-source" onClick={pick}><Icon n="move" size={16} />{picking ? 'Click a layer on the canvas…' : missing ? 'Source was deleted. Select source…' : 'Select source…'}</button>}
      </div>
      <div className="fp-rows">
        <div className="fp-row"><span>Tile type</span>
          <div className="fp-seg" role="group" aria-label="Tile type">
            <button className={d.tile === 'RECT' ? 'on' : ''} aria-label="Grid tiles" aria-pressed={d.tile === 'RECT'} title="Grid" onClick={() => apply({ tile: 'RECT' })}><svg width="26" height="26" viewBox="0 0 26 26" fill="currentColor"><g>{[5, 11, 17].flatMap(y => [5, 11, 17].map(x => <circle key={`${x}${y}`} cx={x + 2} cy={y + 2} r="1.5" />))}</g></svg></button>
            <button className={d.tile === 'OFFSET' ? 'on' : ''} aria-label="Offset tiles" aria-pressed={d.tile === 'OFFSET'} title="Offset rows" onClick={() => apply({ tile: 'OFFSET' })}><svg width="26" height="26" viewBox="0 0 26 26" fill="currentColor"><g>{[5, 11, 17].flatMap((y, i) => [5, 11, 17].map(x => <circle key={`${x}${y}`} cx={x + 2 + (i === 1 ? 3 : 0)} cy={y + 2} r="1.5" />))}</g></svg></button>
          </div>
        </div>
        <div className="fp-row"><span>Scale</span><NumBox ariaLabel="Pattern scale" value={d.scale * 100} min={2} max={2000} icon={<Icon n="expand" size={16} />} onCommit={v => apply({ scale: v / 100 })} /></div>
        <div className="fp-row"><span>Spacing</span><NumBox ariaLabel="Pattern spacing X" label="X" value={d.spacingX} min={-90} max={1000} onCommit={v => apply({ spacingX: v })} /></div>
        <div className="fp-row"><span /><NumBox ariaLabel="Pattern spacing Y" label="Y" value={d.spacingY} min={-90} max={1000} onCommit={v => apply({ spacingY: v })} /></div>
        <div className="fp-row top"><span>Alignment</span>
          <div className="fp-align" role="group" aria-label="Tile alignment">
            {ALIGNS.map(x => <button key={x.a} className={d.align === x.a ? 'on' : ''} aria-label={`Align ${x.label}`} aria-pressed={d.align === x.a} onClick={() => apply({ align: x.a })}><i /></button>)}
          </div>
        </div>
      </div>
    </div>
  );
}

const SLIDERS: { k: keyof ImageAdjust; label: string }[] = [
  { k: 'exposure', label: 'Exposure' }, { k: 'contrast', label: 'Contrast' }, { k: 'saturation', label: 'Saturation' }, { k: 'temperature', label: 'Temperature' },
  { k: 'tint', label: 'Tint' }, { k: 'highlights', label: 'Highlights' }, { k: 'shadows', label: 'Shadows' },
];

/** Image fill: upload, fit mode, quarter-turn rotation and non-destructive adjustments. */
export function ImagePanel({ paint, opacity, onChange }: { paint: ImagePaint | null; opacity: number; onChange: (p: PickerPaint) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const toast = useEditor(s => s.toast);
  const [busy, setBusy] = useState(false);
  const upload = async (f: File) => {
    const s = activeSession; if (!s) return;
    setBusy(true);
    try { const id = await s.addImageAsset(f); if (id) onChange({ type: 'IMAGE', assetId: id, scaleMode: paint?.scaleMode ?? 'FILL', rotation: paint?.rotation, adjust: paint?.adjust, opacity }); } finally { setBusy(false); }
  };
  const set = (patch: Partial<ImagePaint>) => { if (paint) onChange(strip({ ...paint, ...patch }) as PickerPaint); };
  const setAdj = (k: keyof ImageAdjust, v: number) => { if (!paint) return; const adjust = { ...(paint.adjust ?? {}), [k]: v }; if (!v) delete adjust[k]; set({ adjust }); };
  const rot = paint?.rotation ?? 0;
  return (
    <div className="fp-body" data-testid="image-panel">
      <div className="fp-imgtop">
        <Select value={paint?.scaleMode ?? 'FILL'} aria-label="Image fit" disabled={!paint} onChange={e => set({ scaleMode: e.target.value as ImagePaint['scaleMode'] })}><option value="FILL">Fill</option><option value="FIT">Fit</option><option value="STRETCH">Stretch</option><option value="TILE">Tile</option></Select>
        <button className="icon-btn fp-rot" aria-label="Rotate image 90 degrees" title={`Rotate 90° (now ${rot}°)`} disabled={!paint} onClick={() => set({ rotation: ((rot + 90) % 360) as 0 | 90 | 180 | 270 })}><Icon n="rotate90" size={20} /></button>
      </div>
      <div className="fp-imgprev">
        {paint ? <PaintCanvas paint={paint} w={228} h={190} /> : null}
        {!paint && <div className="fp-imgbtns">
          <button className="fp-up" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Uploading…' : 'Upload from computer'}</button>
          <button className="fp-ai" disabled title="AI image generation is not available: no AI provider is configured"><Icon n="image" size={16} />Make an image</button>
        </div>}
        {paint && <button className="fp-change" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Uploading…' : 'Replace image'}</button>}
        <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); else toast('No file chosen'); }} />
      </div>
      <div className="fp-sliders">
        {SLIDERS.map(({ k, label }) => (
          <label key={k} className="fp-slider"><span>{label}</span>
            <input type="range" min={-100} max={100} step={1} value={paint?.adjust?.[k] ?? 0} disabled={!paint} aria-label={label} onChange={e => setAdj(k, Number(e.target.value))} onDoubleClick={() => setAdj(k, 0)} title="Double-click to reset" />
          </label>
        ))}
      </div>
    </div>
  );
}
void IMAGE_ADJUST_KEYS;
