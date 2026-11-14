import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BrushId, EndPoint, SceneNode, WidthProfile } from '@layr/core';
import { BRUSHES, widthPolygon } from '../engine/strokeFx';
import { Icon, type IconName } from '../icons';
import { Select } from '../ui/Select';
import { useDraggable } from '../ui/useDraggable';

type Cap = 'NONE' | 'ROUND' | 'SQUARE';
type Join = 'MITER' | 'ROUND' | 'BEVEL';
const DEFAULT_MITER = 28.96;
let strokeBasicHeight = 0;
const ENDS: [EndPoint, string, string][] = [['NONE', 'None', 'caps'], ['ROUND', 'Round', 'caps'], ['SQUARE', 'Square', 'caps'], ['ARROW', 'Line arrow', 'arrows'], ['TRIANGLE', 'Triangle arrow', 'arrows'], ['REVERSED_TRIANGLE', 'Reversed triangle', 'arrows'], ['CIRCLE', 'Circle arrow', 'arrows'], ['DIAMOND', 'Diamond arrow', 'arrows']];
const EP_ICON: Record<EndPoint, IconName> = { NONE: 'epNone', ROUND: 'epRound', SQUARE: 'epSquare', ARROW: 'epArrow', TRIANGLE: 'epTriangle', REVERSED_TRIANGLE: 'epRevTriangle', CIRCLE: 'epCircle', DIAMOND: 'epDiamond' };
const PROFILES: [WidthProfile, string][] = [['UNIFORM', 'Uniform'], ['TAPER', 'Taper'], ['BULGE', 'Bulge'], ['TAPER_BOTH', 'Taper both ends']];
const DYN_DEFAULT = { frequency: 75, wiggle: 30, smoothen: 50 };

/** Little S-curve drawn with the real brush outline code, so the preview matches what the canvas draws. */
function BrushPreview({ id, direction, profile, flip }: { id: BrushId; direction: 'LEFT' | 'RIGHT'; profile?: WidthProfile; flip?: boolean }) {
  const pts = Array.from({ length: 40 }, (_, i) => { const t = i / 39; return { x: 6 + t * 188, y: 20 + Math.sin(t * Math.PI * 1.3) * -9 + t * 6 }; });
  const rings = widthPolygon({ pts, closed: false }, 13, { brush: { id, direction }, profile, flip });
  const d = rings.map(r => r.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('') + 'Z').join('');
  return <svg className="ss-brushprev" viewBox="0 0 200 40" width="100%" height="34" aria-hidden><path d={d} fill="currentColor" /></svg>;
}

/** Floating "Stroke settings" panel opened from the Stroke section: style, dash, gap, cap, end points, join and miter angle. */
export function StrokeSettings({ anchor, nodes, ro, commit, onClose }: { anchor: DOMRect; nodes: SceneNode[]; ro: boolean; commit: (patch: Partial<SceneNode>, label?: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const n = nodes[0];
  const dashes = n.dashes ?? [];
  const style: 'SOLID' | 'DASHED' | 'DOTTED' = !dashes.length ? 'SOLID' : dashes[0] < 0.5 ? 'DOTTED' : 'DASHED';
  const [dash, setDash] = useState(String(dashes[0] ?? 3)), [gap, setGap] = useState(String(dashes[1] ?? dashes[0] ?? 3));
  const panelLeft = document.querySelector('.panel.right')?.getBoundingClientRect().left ?? anchor.left;
  const { pos, setPos, onPointerDown } = useDraggable({ left: Math.max(8, panelLeft - 272 - 10), top: Math.max(8, anchor.top - 60) }, ref);
  const kindNow = n.strokeKind ?? 'BASIC';
  // the Basic tab sets the panel height; the other tabs keep it and scroll if they need more
  useLayoutEffect(() => { if (kindNow === 'BASIC' && ref.current) strokeBasicHeight = ref.current.offsetHeight; });
  useEffect(() => { setDash(String(dashes[0] ?? 3)); setGap(String(dashes[1] ?? dashes[0] ?? 3)); }, [JSON.stringify(dashes)]);
  useLayoutEffect(() => { const h = ref.current?.offsetHeight ?? 0; setPos(p => ({ left: p.left, top: Math.max(8, Math.min(p.top, window.innerHeight - h - 8)) })); }, []);
  useEffect(() => {
    const down = (e: PointerEvent) => { const t = e.target as HTMLElement; if (!ref.current?.contains(t) && !t.closest?.('.sel-menu, .dlg-back')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.sel-menu')) { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, []);

  const [miterTxt, setMiterTxt] = useState('');
  const cap: Cap = n.strokeCap ?? 'NONE', join: Join = n.strokeJoin ?? 'MITER', miter = n.strokeMiterAngle ?? DEFAULT_MITER;
  const setStyle = (s: string) => {
    if (s === 'SOLID') commit({ dashes: undefined }, 'Stroke style');
    else if (s === 'DOTTED') commit({ dashes: [0.01, Math.max(2, n.strokeWeight * 2)], strokeCap: 'ROUND' }, 'Stroke style');
    else commit({ dashes: [Number(dash) || 3, Number(gap) || 3] }, 'Stroke style');
  };
  const setDashGap = (d: string, g: string) => { const a = Number(d), b = Number(g); if (Number.isFinite(a) && a > 0 && Number.isFinite(b) && b >= 0) commit({ dashes: [a, b] }, 'Dash pattern'); };
  const seg = <T extends string>(items: [T, IconName, string][], cur: T, set: (v: T) => void) => (
    <div className="ss-seg">{items.map(([v, ic, label]) => <button key={v} type="button" className={cur === v ? 'on' : ''} aria-label={label} aria-pressed={cur === v} title={label} disabled={ro} onClick={() => set(v)}><Icon n={ic} size={20} /></button>)}</div>
  );
  const numField = (value: string, set: (v: string) => void, done: () => void, label: string, disabled: boolean, suffix?: string) => (
    <label className="ss-num"><input aria-label={label} value={value} disabled={disabled} onChange={e => set(e.target.value)} onBlur={done} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />{suffix && <span>{suffix}</span>}</label>
  );

  const kind = n.strokeKind ?? 'BASIC', dyn = n.strokeDynamic ?? DYN_DEFAULT, brush = n.strokeBrush ?? { id: 'CHARCOAL' as BrushId, direction: 'RIGHT' as const };
  const profileRow = (
    <div className="ss-row"><span>Width profile</span>
      <div className="ss-profile">
        <Select aria-label="Width profile" value={n.strokeProfile ?? 'UNIFORM'} disabled={ro} onChange={e => commit({ strokeProfile: e.target.value === 'UNIFORM' ? undefined : (e.target.value as WidthProfile) }, 'Width profile')}>{PROFILES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        <button type="button" className={'icon-btn ss-flip' + (n.strokeProfileFlip ? ' on' : '')} aria-label="Flip width profile" aria-pressed={!!n.strokeProfileFlip} title="Flip width profile" disabled={ro || !n.strokeProfile || n.strokeProfile === 'UNIFORM'} onClick={() => commit({ strokeProfileFlip: n.strokeProfileFlip ? undefined : true }, 'Flip width profile')}><Icon n="flipProfile" size={18} /></button>
      </div></div>
  );
  const endRow = (
    <div className="ss-body ss-split">
      <div className="ss-row"><span>End points</span>
        <div className="ss-pair">
          <Select className="ss-ep" aria-label="Start point" value={n.strokeStart ?? 'NONE'} disabled={ro} iconFor={v => <Icon n={EP_ICON[v as EndPoint]} size={22} />} onChange={e => commit({ strokeStart: e.target.value === 'NONE' ? undefined : (e.target.value as EndPoint) }, 'Start point')}>{['caps', 'arrows'].map(g => <optgroup key={g} label={g === 'caps' ? '' : ' '}>{ENDS.filter(e => e[2] === g).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}</Select>
          <Select className="ss-ep" aria-label="End point" value={n.strokeEnd ?? 'NONE'} disabled={ro} iconFor={v => <span className="ss-epflip"><Icon n={EP_ICON[v as EndPoint]} size={22} /></span>} onChange={e => commit({ strokeEnd: e.target.value === 'NONE' ? undefined : (e.target.value as EndPoint) }, 'End point')}>{['caps', 'arrows'].map(g => <optgroup key={g} label={g === 'caps' ? '' : ' '}>{ENDS.filter(e => e[2] === g).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}</Select>
        </div></div>
    </div>
  );

  return (
    <div ref={ref} className="ss-pop" role="dialog" aria-label="Stroke settings" style={{ left: pos.left, top: pos.top, height: kind === 'BASIC' ? undefined : (strokeBasicHeight || 440) }}>
      <div className="ss-head" onPointerDown={onPointerDown}><b>Stroke settings</b><button className="icon-btn" aria-label="Close stroke settings" onClick={onClose}><Icon n="close" size={16} /></button></div>
      <div className="ss-tabs" role="tablist">
        {([['BASIC', 'Basic'], ['DYNAMIC', 'Dynamic'], ['BRUSH', 'Brush']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} disabled={ro} onClick={() => commit({ strokeKind: k === 'BASIC' ? undefined : k }, 'Stroke type')}>{l}</button>
        ))}
      </div>
      <div className="ss-scroll">
      {kind === 'BASIC' && <>
        <div className="ss-body">
          <div className="ss-row"><span>Style</span>
            <Select aria-label="Stroke style" value={style} disabled={ro} onChange={e => setStyle(e.target.value)}><option value="SOLID">Solid</option><option value="DASHED">- - - Dashed</option><option value="DOTTED">··· Dotted</option></Select></div>
          <div className="ss-row"><span>Dash</span>{numField(dash, setDash, () => setDashGap(dash, gap), 'Dash length', ro || style !== 'DASHED')}</div>
          <div className="ss-row"><span>Gap</span>{numField(gap, setGap, () => setDashGap(dash, gap), 'Gap length', ro || style === 'SOLID')}</div>
          <div className="ss-row"><span>Dash cap</span>{seg<Cap>([['NONE', 'epNone', 'Butt cap'], ['ROUND', 'epRound', 'Round cap'], ['SQUARE', 'epSquare', 'Square cap']], cap, v => commit({ strokeCap: v }, 'Stroke cap'))}</div>
          {profileRow}
        </div>
        {endRow}
        <div className="ss-body ss-split">
          <div className="ss-row"><span>Join</span>{seg<Join>([['MITER', 'joinMiter', 'Miter join'], ['BEVEL', 'joinBevel', 'Bevel join'], ['ROUND', 'joinRound', 'Round join']], join, v => commit({ strokeJoin: v }, 'Stroke join'))}</div>
          <div className="ss-row"><span>Miter angle</span>{numField(miterTxt || String(Math.round(miter * 100) / 100), setMiterTxt, () => { const v = Number(miterTxt); if (miterTxt && Number.isFinite(v) && v >= 1 && v <= 180) commit({ strokeMiterAngle: v }, 'Miter angle'); setMiterTxt(''); }, 'Miter angle', ro || join !== 'MITER', '°')}</div>
        </div>
      </>}
      {kind === 'DYNAMIC' && <>
        <div className="ss-body">
          {(['frequency', 'wiggle', 'smoothen'] as const).map(k => (
            <div className="ss-row" key={k}><span>{k[0].toUpperCase() + k.slice(1)}</span>
              <label className="ss-num"><Icon n={k === 'frequency' ? 'dynFrequency' : k === 'wiggle' ? 'dynWiggle' : 'dynSmoothen'} size={18} />
                <input aria-label={k[0].toUpperCase() + k.slice(1)} disabled={ro} defaultValue={dyn[k]} key={k + dyn[k]} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  onBlur={e => { const v = Math.min(100, Math.max(0, Number(e.target.value))); if (Number.isFinite(v)) commit({ strokeDynamic: { ...dyn, [k]: Math.round(v) } }, 'Dynamic stroke'); else e.target.value = String(dyn[k]); }} /><span>%</span></label></div>
          ))}
        </div>
        {endRow}
      </>}
      {kind === 'BRUSH' && <>
        <div className="ss-body">
          <Select className="ss-brushsel" aria-label="Brush style" value={brush.id} disabled={ro} onChange={e => commit({ strokeBrush: { ...brush, id: e.target.value as BrushId } }, 'Brush')}
            iconFor={v => <BrushPreview id={v as BrushId} direction={brush.direction} />}>{BRUSHES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</Select>
          <div className="ss-row"><span>Direction</span>{seg<'LEFT' | 'RIGHT'>([['LEFT', 'arrowLeft', 'Brush direction left'], ['RIGHT', 'arrowRight', 'Brush direction right']], brush.direction, v => commit({ strokeBrush: { ...brush, direction: v } }, 'Brush direction'))}</div>
        </div>
        <div className="ss-body ss-split">{profileRow}</div>
      </>}
      </div>
    </div>
  );
}
