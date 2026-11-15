import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BLEND_GROUPS, BLEND_LABEL, bindVariable, createCollection, createVariable, resolveVariable, modeFor, solid, type Paint, type LinearPaint, type SolidPaint, type ImagePaint, type PatternPaint } from '@layr/core';
import { Icon, type IconName } from '../icons';
import { activeSession } from './session';
import { useEditor } from './state';
import { Select } from '../ui/Select';
import { useDraggable } from '../ui/useDraggable';
import { useObjectUrl } from '../net';
import { askText, askConfirm } from '../ui/dialogs';
import { ImagePanel, PatternPanel } from './FillPanels';

// ---------- colour maths ----------
export type RGB = { r: number; g: number; b: number };
export const hexToRgb = (h: string): RGB => { const v = h.replace('#', '').padEnd(6, '0'); return { r: parseInt(v.slice(0, 2), 16) || 0, g: parseInt(v.slice(2, 4), 16) || 0, b: parseInt(v.slice(4, 6), 16) || 0 }; };
export const rgbToHex = ({ r, g, b }: RGB) => '#' + [r, g, b].map(x => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('').toUpperCase();
export function rgbToHsv({ r, g, b }: RGB) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, s: mx ? d / mx : 0, v: mx };
}
export function hsvToRgb(h: number, s: number, v: number): RGB {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
function rgbToHsl({ r, g, b }: RGB) {
  const { h, s: sv, v } = rgbToHsv({ r, g, b }); const l = v * (1 - sv / 2);
  return { h, s: l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l), l };
}
function hslToRgb(h: number, s: number, l: number): RGB { const v = l + s * Math.min(l, 1 - l); return hsvToRgb(h, v === 0 ? 0 : 2 * (1 - l / v), v); }

const PRESET = ['#FFFFFF', '#F5F5F5', '#E6E6E6', '#B3B3B3', '#808080', '#4D4D4D', '#1A1A1A', '#000000', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#32ADE6', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E', '#8E8E93', '#FFD6D6', '#D6F5DD', '#D6E8FF', '#EAD6FF'];
const checker = 'repeating-conic-gradient(#555 0 25%, #888 0 50%) 0 0/10px 10px';

export type PickerPaint = Pick<SolidPaint, 'type' | 'color' | 'opacity' | 'blendMode'> | Pick<LinearPaint, 'type' | 'stops' | 'angle' | 'opacity' | 'blendMode'> | Omit<ImagePaint, 'visible'> | Omit<PatternPaint, 'visible'>;

interface Props {
  anchor: DOMRect;
  paint: PickerPaint;
  onChange: (p: PickerPaint) => void;
  onClose: () => void;
  gradients?: boolean;
  /** when set, choosing a library variable binds it to this property path on the given nodes */
  bind?: { ids: string[]; path: string };
  showOpacity?: boolean;
  /** offer Pattern and Image fills (fills only, not strokes or text) */
  fillTypes?: boolean;
  /** offer the droplet (blend mode) for this paint: fills and strokes */
  blend?: boolean;
}

export function ColorPopover({ anchor, paint, onChange, onClose, gradients = true, bind, showOpacity = true, fillTypes = false, blend = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'custom' | 'libraries'>('custom');
  const paintMode = paint.type === 'SOLID' ? 'solid' : paint.type === 'LINEAR' ? 'gradient' : paint.type === 'PATTERN' ? 'pattern' : 'image';
  const [forced, setForced] = useState<'pattern' | 'image' | null>(null);
  const mode = forced ?? paintMode;
  const [stop, setStop] = useState(0);
  const [fmt, setFmt] = useState<'HEX' | 'RGB' | 'HSL'>('HEX');
  const [docMode, setDocMode] = useState<'page' | 'preset'>('page');
  const [q, setQ] = useState(''); const [libFilter, setLibFilter] = useState('');
  const toast = useEditor(s => s.toast);
  const { pos, setPos, onPointerDown: dragStart } = useDraggable({ left: Math.max(8, anchor.left - 290), top: Math.max(8, anchor.top - 20) }, ref); // drag by the header, like the stroke and type panels
  useLayoutEffect(() => { const h = ref.current?.offsetHeight ?? 0; setPos(p => ({ left: p.left, top: Math.max(8, Math.min(p.top, window.innerHeight - h - 8)) })); }, [tab, paint.type, mode]);
  useEffect(() => {
    const down = (e: PointerEvent) => { const t = e.target as HTMLElement; if (!ref.current?.contains(t) && !t.closest?.('.sel-menu, .dlg-back, .menu') && !useEditor.getState().pickSource) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.sel-menu, .dlg-back')) { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [onClose]);

  const isGrad = paint.type === 'LINEAR';
  const cur = isGrad ? (paint as LinearPaint).stops[Math.min(stop, 1)] : paint.type === 'SOLID' ? (paint as SolidPaint) : { color: '#D9D9D9', opacity: paint.opacity };
  const curColor = cur.color;
  const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgb(curColor)));
  const last = useRef(curColor);
  useEffect(() => { if (curColor.toUpperCase() !== last.current.toUpperCase()) { setHsv(rgbToHsv(hexToRgb(curColor))); last.current = curColor; } }, [curColor, stop]);

  const emitColor = (hex: string, opacity?: number) => {
    last.current = hex;
    if (paint.type === 'SOLID') onChange({ ...paint, color: hex, opacity: opacity ?? paint.opacity });
    else { const g = paint as LinearPaint; const stops = g.stops.map((s, i) => (i === Math.min(stop, 1) ? { ...s, color: hex, ...(opacity !== undefined ? { opacity } : {}) } : s)); onChange({ ...g, stops }); }
  };
  const setHsvAndEmit = (n: { h: number; s: number; v: number }) => { setHsv(n); emitColor(rgbToHex(hsvToRgb(n.h, n.s, n.v))); };
  const opacity = isGrad ? (cur as { opacity: number }).opacity : (paint as SolidPaint).opacity;
  const setOpacity = (o: number) => { if (isGrad) { const g = paint as LinearPaint; onChange({ ...g, stops: g.stops.map((s, i) => (i === Math.min(stop, 1) ? { ...s, opacity: o } : s)) }); } else onChange({ ...(paint as SolidPaint), opacity: o }); };

  const drag = (onMove: (x: number, y: number) => void) => (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    const go = (ev: { clientX: number; clientY: number }) => { const r = el.getBoundingClientRect(); onMove(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))); };
    go(e);
    const mv = (ev: PointerEvent) => go(ev), up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };

  const s = activeSession;
  const doc = s?.store.doc;
  const pageColors = useMemo(() => {
    if (!doc) return [] as { color: string; opacity: number }[];
    const seen = new Map<string, { color: string; opacity: number }>();
    const walk = (id: string) => { const n = doc.nodes[id]; for (const p of [...n.fills, ...n.strokes]) if (p.type === 'SOLID') seen.set(`${p.color.toUpperCase()}/${p.opacity}`, { color: p.color.toUpperCase(), opacity: p.opacity }); n.children.forEach(walk); };
    walk(useEditor.getState().pageId);
    return [...seen.values()].slice(0, 48);
  }, [doc, tab]);

  const rgb = hexToRgb(curColor);
  const fmtText = fmt === 'HEX' ? curColor.replace('#', '').toUpperCase() : fmt === 'RGB' ? `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}` : (() => { const h = rgbToHsl(rgb); return `${Math.round(h.h)}, ${Math.round(h.s * 100)}%, ${Math.round(h.l * 100)}%`; })();
  const parse = (v: string) => {
    if (fmt === 'HEX') { const x = v.replace('#', ''); const full = x.length === 3 ? x.split('').map(c => c + c).join('') : x; return /^[0-9a-f]{6}$/i.test(full) ? '#' + full.toUpperCase() : null; }
    const n = v.split(/[ ,%]+/).filter(Boolean).map(Number);
    if (n.length !== 3 || n.some(x => !Number.isFinite(x))) return null;
    return fmt === 'RGB' ? rgbToHex({ r: n[0], g: n[1], b: n[2] }) : rgbToHex(hslToRgb(n[0], n[1] / 100, n[2] / 100));
  };
  const [text, setText] = useState(fmtText);
  useEffect(() => setText(fmtText), [fmtText, fmt]);

  const typeBtn = (icon: IconName, title: string, on: boolean, enabled: boolean, run?: (e: React.MouseEvent<HTMLButtonElement>) => void, why = 'not implemented yet') => <button key={title} className={'ptype-btn' + (on ? ' on' : '')} disabled={!enabled} title={enabled ? title : `${title}: ${why}`} aria-label={title} aria-pressed={on} onClick={run}><Icon n={icon} size={20} /></button>;
  const blendNow = (paint as { blendMode?: string }).blendMode ?? 'NORMAL';
  const openBlend = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const items = BLEND_GROUPS.flatMap((g, gi) => [...(gi ? [{ label: '', separator: true }] : []), ...g.map(b => ({ label: BLEND_LABEL[b], checked: blendNow === b, run: () => onChange({ ...paint, blendMode: b } as PickerPaint) }))]);
    useEditor.getState().set({ menu: { x: Math.min(r.right - 220, window.innerWidth - 240), y: r.bottom + 6, items } });
  };
  const toSolid = () => { setForced(null); if (paint.type !== 'SOLID') onChange({ type: 'SOLID', color: isGrad ? (paint as LinearPaint).stops[0].color : '#D9D9D9', opacity: paint.opacity }); };
  const toLinear = () => { setForced(null); if (!isGrad) onChange({ type: 'LINEAR', angle: 90, opacity: paint.opacity, stops: [{ pos: 0, color: paint.type === 'SOLID' ? (paint as SolidPaint).color : '#7C5CFF', opacity: 1 }, { pos: 1, color: '#FFFFFF', opacity: 1 }] }); };

  // libraries
  const cols = doc ? Object.values(doc.collections) : [];
  const colorVars = doc ? Object.values(doc.variables).filter(v => v.type === 'COLOR' && (!libFilter || v.collectionId === libFilter) && v.name.toLowerCase().includes(q.toLowerCase())) : [];
  const resolved = (id: string) => (doc ? String(resolveVariable(doc, id, c => modeFor(doc, useEditor.getState().pageId, c)) ?? '#000000') : '#000000');
  const pick = (id: string) => {
    if (bind && s) { if (bindVariable(s.store, bind.ids, bind.path, id)) { onClose(); return; } toast('That variable cannot be bound here', 'error'); return; }
    emitColor(resolved(id).toUpperCase());
  };
  const addVar = async () => {
    if (!s) return;
    let col = Object.values(s.store.doc.collections)[0]?.id; if (!col) col = createCollection(s.store, 'Colors', ['Mode 1']);
    const name = await askText('New color variable', `color/${curColor.replace('#', '').toLowerCase()}`, { message: 'Saved to the first collection.', okLabel: 'Save' });
    if (!name) return;
    if (createVariable(s.store, col, name, 'COLOR', curColor.toUpperCase(), ['ALL', 'FILL', 'STROKE'])) toast(`Saved “${name}” to library`); else toast('Name is empty or already used', 'error');
  };
  const eyedrop = async () => { try { const r = await new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper().open(); emitColor(r.sRGBHex.toUpperCase()); setHsv(rgbToHsv(hexToRgb(r.sRGBHex))); } catch { /* cancelled */ } };
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  const hueRgb = rgbToHex(hsvToRgb(hsv.h, 1, 1));
  const gradCss = isGrad ? `linear-gradient(90deg, ${(paint as LinearPaint).stops.map(st => st.color).join(', ')})` : '';

  return createPortal(
    <div ref={ref} className="cpop" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label="Color picker" onPointerDown={e => e.stopPropagation()}>
      <div className="cp-head" onPointerDown={dragStart} title="Drag to move">
        <button className={'cp-tab' + (tab === 'custom' ? ' on' : '')} onClick={() => setTab('custom')}>Custom</button>
        <button className={'cp-tab' + (tab === 'libraries' ? ' on' : '')} onClick={() => setTab('libraries')}>Libraries</button>
        <span className="spacer" />
        <button className="icon-btn cp-ic" title="Save this colour to the library (as a variable)" aria-label="Save to library" onClick={addVar}><Icon n="plus" size={20} /></button>
        <button className="icon-btn cp-ic" aria-label="Close color picker" onClick={onClose}><Icon n="close" size={20} /></button>
      </div>
      {tab === 'custom' ? <>
        <div className="cp-types">
          {typeBtn('fillSolid', 'Solid', mode === 'solid', true, toSolid)}
          {typeBtn('fillGradient', 'Linear gradient', mode === 'gradient', gradients, toLinear)}
          {typeBtn('fillPattern', 'Pattern', mode === 'pattern', fillTypes, () => setForced('pattern'), 'only available for layer fills')}
          {typeBtn('fillImage', 'Image', mode === 'image', fillTypes, () => setForced('image'), 'only available for layer fills')}
          <span className="spacer" />
          {typeBtn('drop', blendNow === 'NORMAL' ? 'Blend mode' : `Blend mode: ${BLEND_LABEL[blendNow as keyof typeof BLEND_LABEL]}`, blendNow !== 'NORMAL', blend || fillTypes, openBlend, 'only available for layer fills and strokes')}
        </div>
        {mode === 'pattern' && <PatternPanel paint={paint.type === 'PATTERN' ? (paint as unknown as PatternPaint) : null} opacity={paint.opacity} onChange={onChange} />}
        {mode === 'image' && <ImagePanel paint={paint.type === 'IMAGE' ? (paint as unknown as ImagePaint) : null} opacity={paint.opacity} onChange={onChange} />}
        {(mode === 'solid' || mode === 'gradient') && <>
        {isGrad && (
          <div className="cp-grad">
            <div className="gbar" style={{ background: gradCss }}>
              {(paint as LinearPaint).stops.map((st, i) => <button key={i} className={'gstop' + (stop === i ? ' on' : '')} style={{ left: `${st.pos * 100}%`, background: st.color }} aria-label={`Stop ${i + 1}`} onClick={() => setStop(i)} />)}
            </div>
            <label className="gangle"><span className="muted small">Angle</span><input type="number" aria-label="Gradient angle" value={Math.round((paint as LinearPaint).angle)} onChange={e => onChange({ ...(paint as LinearPaint), angle: Number(e.target.value) || 0 })} /></label>
          </div>
        )}
        <div className="cp-body">
          <div className="sv" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueRgb})` }} onPointerDown={drag((x, y) => setHsvAndEmit({ h: hsv.h, s: x, v: 1 - y }))} data-testid="cp-sv">
            <i className="knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: curColor }} />
          </div>
          <div className="cp-sliders">
            <button className="icon-btn eye" disabled={!hasEyeDropper} title={hasEyeDropper ? 'Pick a colour from the screen' : 'Eyedropper is not supported in this browser'} aria-label="Eyedropper" onClick={eyedrop}><Icon n="pipette" size={22} /></button>
            <div className="sliders">
              <div className="hue" onPointerDown={drag(x => setHsvAndEmit({ ...hsv, h: x * 360 }))} data-testid="cp-hue"><i className="knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: hueRgb }} /></div>
              {showOpacity && <div className="alpha" style={{ background: `linear-gradient(90deg, transparent, ${curColor}), ${checker}` }} onPointerDown={drag(x => setOpacity(Math.round(x * 100) / 100))} data-testid="cp-alpha"><i className="knob" style={{ left: `${opacity * 100}%` }} /></div>}
            </div>
          </div>
          <div className="cp-inputs">
            <Select value={fmt} aria-label="Colour format" onChange={e => setFmt(e.target.value as 'HEX')}><option>HEX</option><option>RGB</option><option>HSL</option></Select>
            <input className="cp-hex" aria-label="Colour value" value={text} onChange={e => setText(e.target.value)} onBlur={() => { const h = parse(text); if (h) { emitColor(h); setHsv(rgbToHsv(hexToRgb(h))); } else setText(fmtText); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            {showOpacity && <label className="cp-op"><input aria-label="Opacity" value={Math.round(opacity * 100)} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) setOpacity(Math.min(100, Math.max(0, n)) / 100); }} /><span>%</span></label>}
          </div>
        </div>
        <div className="cp-docs">
          <Select value={docMode} aria-label="Swatch source" onChange={e => setDocMode(e.target.value as 'page')}><option value="page">On this page</option><option value="preset">Preset</option></Select>
          <div className="swgrid">
            {(docMode === 'page' ? pageColors : PRESET.map(c => ({ color: c, opacity: 1 }))).map((c, i) => (
              <button key={i} className="sw" title={`${c.color}${c.opacity < 1 ? ` · ${Math.round(c.opacity * 100)}%` : ''}`} aria-label={`Use ${c.color}`} onClick={() => { emitColor(c.color, c.opacity); setHsv(rgbToHsv(hexToRgb(c.color))); }}
                style={{ background: c.opacity < 1 ? `linear-gradient(90deg, ${c.color} 50%, transparent 50%), ${checker}` : c.color }} />
            ))}
            {docMode === 'page' && !pageColors.length && <span className="muted small sw-empty">No colours on this page yet.</span>}
          </div>
        </div>
        </>}
      </> : <>
        <div className="cp-search"><Icon n="search" size={18} /><input placeholder="Search" aria-label="Search library colours" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="cp-libbar">
          <Select value={libFilter} aria-label="Library" onChange={e => setLibFilter(e.target.value)}><option value="">All libraries</option>{cols.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </div>
        <div className="cp-list">
          {cols.filter(c => !libFilter || c.id === libFilter).map(c => {
            const list = colorVars.filter(v => v.collectionId === c.id);
            if (!list.length) return null;
            return <div key={c.id}><div className="lib-h">{c.name}</div>{list.map(v => <button key={v.id} className="lib-row" onClick={() => pick(v.id)}><span className="sw" style={{ background: resolved(v.id) }} /><span>{v.name}</span></button>)}</div>;
          })}
          {doc && Object.values(doc.styles).some(st => st.type === 'FILL' && st.name.toLowerCase().includes(q.toLowerCase())) && !libFilter && (
            <div><div className="lib-h">Styles</div>{Object.values(doc.styles).filter(st => st.type === 'FILL' && st.name.toLowerCase().includes(q.toLowerCase())).map(st => {
              const p = st.value.fills?.find((f: Paint) => f.type === 'SOLID') as SolidPaint | undefined;
              return <button key={st.id} className="lib-row" onClick={() => p && emitColor(p.color.toUpperCase(), p.opacity)}><span className="sw" style={{ background: p?.color ?? '#888' }} /><span>{st.name}</span></button>;
            })}</div>
          )}
          {!colorVars.length && !(doc && Object.keys(doc.styles).length) && <div className="muted pad">No colour variables yet. Use + above to save the current colour, or define variables from Assets → Variables.</div>}
        </div>
      </>}
    </div>, document.body);
}

/** Swatch button that opens the popover. */
export function SwatchButton({ paint, onChange, gradients, bind, showOpacity, disabled, className, fillTypes, blend }: { paint: PickerPaint; onChange: (p: PickerPaint) => void; gradients?: boolean; bind?: Props['bind']; showOpacity?: boolean; disabled?: boolean; className?: string; fillTypes?: boolean; blend?: boolean }) {
  const [open, setOpen] = useState<DOMRect | null>(null);
  const imgUrl = useObjectUrl(paint.type === 'IMAGE' ? `/api/assets/${paint.assetId}` : null);
  const bg = paint.type === 'SOLID' ? paint.color
    : paint.type === 'LINEAR' ? `linear-gradient(${paint.angle}deg, ${paint.stops.map(s => s.color).join(', ')})`
    : paint.type === 'IMAGE' ? (imgUrl ? `center / cover url(${imgUrl}), ${checker}` : checker)
    : `radial-gradient(circle, #8b8ff7 1.6px, transparent 1.8px) 0 0 / 6px 6px, #3a3a3d`;
  return <>
    <button type="button" className={'swatchbtn ' + (className ?? '')} disabled={disabled} aria-label="Open color picker" title="Pick a colour" style={{ background: bg }} onClick={e => setOpen(e.currentTarget.getBoundingClientRect())} />
    {open && <ColorPopover anchor={open} paint={paint} onChange={onChange} onClose={() => setOpen(null)} gradients={gradients} bind={bind} showOpacity={showOpacity} fillTypes={fillTypes} blend={blend} />}
  </>;
}
export { solid };
