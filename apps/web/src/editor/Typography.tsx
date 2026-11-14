import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SceneNode, TextCase, TextProps } from '@layr/core';
import { Icon, type IconName } from '../icons';
import { Select } from '../ui/Select';
import { useDraggable } from '../ui/useDraggable';
import { Bindable, StyleChip } from './BindControls';
import { NumberField } from './fields';
import { useEditor } from './state';
import type { EditorSession } from './session';

export const FONTS = ['Inter, Helvetica, Arial, sans-serif', 'Helvetica, Arial, sans-serif', 'Georgia, serif', '"Times New Roman", Times, serif', '"Courier New", monospace', 'Menlo, Monaco, monospace', 'system-ui, sans-serif'];
export const FONT_NAMES: Record<string, string> = { [FONTS[0]]: 'Inter', [FONTS[1]]: 'Helvetica / Arial', [FONTS[2]]: 'Georgia', [FONTS[3]]: 'Times New Roman', [FONTS[4]]: 'Courier New', [FONTS[5]]: 'Menlo', [FONTS[6]]: 'System UI' };
const WEIGHTS: [number, string][] = [[100, 'Thin'], [200, 'Extra Light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semi Bold'], [700, 'Bold'], [800, 'Extra Bold'], [900, 'Black']];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96, 128];

type Mixed<T> = { mixed: boolean; value: T | undefined };
export interface TypeApi { nodes: SceneNode[]; tset: (patch: Partial<TextProps>) => void; ro: boolean; styled: boolean }
const texts = (nodes: SceneNode[]) => nodes.filter(n => n.text);
export function tval<K extends keyof TextProps>(nodes: SceneNode[], k: K): Mixed<TextProps[K]> {
  const list = texts(nodes);
  if (!list.length) return { mixed: false, value: undefined };
  const first = list[0].text![k];
  return { mixed: list.some(n => JSON.stringify(n.text![k]) !== JSON.stringify(first)), value: first };
}

function Seg<T extends string>({ items, value, onChange, disabled, label }: { items: [T, ReactNode, string][]; value: T | undefined; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return <div className="ty-seg" role="group" aria-label={label}>{items.map(([v, node, title]) => <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} aria-label={title} title={title} disabled={disabled} onClick={() => onChange(v)}>{node}</button>)}</div>;
}

/** The compact Typography section: family, weight + size, line height + tracking, alignment, and the settings button. */
export function TypographySection({ session, ids, api, onSettings, open }: { session: EditorSession; ids: string[]; api: TypeApi; onSettings: (anchor: DOMRect) => void; open: boolean }) {
  const { nodes, tset, ro, styled } = api;
  const set = useEditor(s => s.set);
  const fam = tval(nodes, 'fontFamily'), wt = tval(nodes, 'fontWeight'), size = tval(nodes, 'fontSize'), lh = tval(nodes, 'lineHeight'), ls = tval(nodes, 'letterSpacing'), al = tval(nodes, 'align'), va = tval(nodes, 'vAlign');
  const lhPx = lh.mixed ? null : lh.value === 'AUTO' ? Math.round(size.value! * 1.2 * 100) / 100 : (lh.value as number);
  const sizeMenu = (e: React.MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); set({ menu: { x: Math.min(r.left - 60, window.innerWidth - 120), y: r.bottom + 6, items: SIZES.map(v => ({ label: String(v), run: () => tset({ fontSize: v }) })) } }); };
  const textIds = ids.filter(i => session.store.doc.nodes[i].type === 'TEXT');
  const weightKnown = WEIGHTS.some(([w]) => w === wt.value);
  return (
    <>
      {styled && <StyleChip session={session} ids={textIds} type="TEXT" ro={ro} />}
      <Select aria-label="Font family" value={fam.mixed ? '' : fam.value} disabled={ro || styled} onChange={e => tset({ fontFamily: e.target.value })}>
        {fam.mixed && <option value="">Mixed</option>}{FONTS.map(f => <option key={f} value={f}>{FONT_NAMES[f]}</option>)}
      </Select>
      <div className="ty-row2">
        <Select aria-label="Font weight" value={wt.mixed ? '' : weightKnown ? wt.value : ''} disabled={ro || styled} onChange={e => tset({ fontWeight: Number(e.target.value) })}>
          {(wt.mixed || !weightKnown) && <option value="">{wt.mixed ? 'Mixed' : String(wt.value)}</option>}{WEIGHTS.map(([w, l]) => <option key={w} value={w}>{l}</option>)}
        </Select>
        <Bindable session={session} ids={textIds} path="text.fontSize" ro={ro}>
          <div className="ty-size">
            <NumberField title="Font size" value={size.mixed ? null : size.value!} min={1} max={500} disabled={ro || styled} onCommit={v => tset({ fontSize: v })} />
            <button type="button" className="ty-caret" aria-label="Font size presets" title="Font size presets" disabled={ro || styled} onClick={sizeMenu}><Icon n="chevD" size={14} /></button>
          </div>
        </Bindable>
      </div>
      <div className="ty-row2">
        <NumberField label={<Icon n="lineHeightA" size={15} />} title="Line height in px (0 = auto)" value={lhPx} min={0} disabled={ro || styled} onCommit={v => tset({ lineHeight: v === 0 ? 'AUTO' : v })} />
        <NumberField label={<Icon n="letterSpacingA" size={15} />} title="Letter spacing" value={ls.mixed ? null : ls.value!} suffix="px" disabled={ro || styled} onCommit={v => tset({ letterSpacing: v })} />
      </div>
      <div className="ty-row3">
        <Seg<TextProps['align']> label="Text align" disabled={ro} value={al.mixed ? undefined : al.value} onChange={v => tset({ align: v })} items={[['LEFT', <Icon n="taL" size={16} />, 'Align left'], ['CENTER', <Icon n="taC" size={16} />, 'Align center'], ['RIGHT', <Icon n="taR" size={16} />, 'Align right']]} />
        <Seg<NonNullable<TextProps['vAlign']>> label="Vertical align" disabled={ro} value={va.mixed ? undefined : va.value ?? 'TOP'} onChange={v => tset({ vAlign: v === 'TOP' ? undefined : v })} items={[['TOP', <Icon n="vaTop" size={16} />, 'Align top'], ['MIDDLE', <Icon n="vaMid" size={16} />, 'Align middle'], ['BOTTOM', <Icon n="vaBottom" size={16} />, 'Align bottom']]} />
        <button type="button" className={'icon-btn ty-settings' + (open ? ' on' : '')} aria-label="Type settings" title="Type settings" aria-expanded={open} onClick={e => onSettings((e.currentTarget as HTMLElement).getBoundingClientRect())}><Icon n="strokeSettings" size={16} /></button>
      </div>
    </>
  );
}

// ---------- type settings popover ----------
const CASES: [TextCase, ReactNode, string][] = [['NONE', <Icon n="epNone" size={0} />, 'Original case'], ['UPPER', 'AG', 'Uppercase'], ['LOWER', 'ag', 'Lowercase'], ['TITLE', 'Ag', 'Title case'], ['SMALL_CAPS', <span className="sc">Ag</span>, 'Small caps']];
const caseItems = (): [TextCase, ReactNode, string][] => [['NONE', <span className="tdash" />, 'Original case'], ['UPPER', 'AG', 'Uppercase'], ['LOWER', 'ag', 'Lowercase'], ['TITLE', 'Ag', 'Title case'], ['SMALL_CAPS', <span className="sc">Ag</span>, 'Small caps'], ['SMALL_CAPS_FORCED', <span className="sc dim">Ag</span>, 'All small caps']];
void CASES;

const SECTIONS: { title: string; items: [string, string][] }[] = [
  { title: 'Numbers', items: [['pnum', 'Proportional figures'], ['tnum', 'Tabular figures'], ['frac', 'Fractions'], ['zero', 'Slashed zero']] },
  { title: 'Letterforms', items: [['dlig', 'Rare ligatures'], ['calt', 'Contextual alternates'], ['ordn', 'Ordinals']] },
  { title: 'Stylistic sets', items: [['ss01', 'Stylistic alternates'], ['ss02', 'Open digits'], ['ss03', 'Disambiguation'], ['ss04', 'r curves into round neighbors'], ['ss05', 'Disambiguation without slashed zero']] },
  { title: 'Character variants', items: [['cv01', 'Alternate one'], ['cv02', 'Open four'], ['cv03', 'Open six'], ['cv04', 'Open nine'], ['cv05', 'Lower-case L with tail'], ['cv06', 'r with curved tail'], ['cv07', 'Alternate German double s'], ['cv08', 'Upper-case i with serif'], ['cv09', 'Flat-top three'], ['cv10', 'Capital G with spur'], ['cv11', 'Single-storey a']] },
  { title: 'Horizontal spacing', items: [['kern', 'Kerning pairs']] },
  { title: 'More features', items: [['dnom', 'Fraction denominators'], ['numr', 'Fraction numerators'], ['sinf', 'Scientific inferiors']] },
];
/** Feature flags as a CSS font-feature-settings string (used by the preview). */
export const featureCss = (f: Record<string, boolean> | undefined) => Object.entries({ kern: true, ...f }).map(([k, v]) => `"${k}" ${v ? 1 : 0}`).join(', ');

function Toggle({ label, tag, on, set, disabled }: { label: string; tag: string; on: boolean; set: (v: boolean) => void; disabled: boolean }) {
  return (
    <div className="ty-line"><span title={tag}>{label}</span>
      <div className="ty-seg two" role="group" aria-label={label}>
        <button type="button" className={!on ? 'on' : ''} aria-pressed={!on} aria-label={`${label}: off`} disabled={disabled} onClick={() => set(false)}><span className="tdash" /></button>
        <button type="button" className={on ? 'on' : ''} aria-pressed={on} aria-label={`${label}: on`} disabled={disabled} onClick={() => set(true)}><Icon n="check" size={15} /></button>
      </div>
    </div>
  );
}

let typeBasicHeight = 0;
export function TypeSettings({ anchor, api, onClose }: { anchor: DOMRect; api: TypeApi; onClose: () => void }) {
  const { nodes, tset, ro } = api;
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'basics' | 'details' | 'variable'>('basics');
  const first = texts(nodes)[0]?.text;
  const panelLeft = document.querySelector('.panel.right')?.getBoundingClientRect().left ?? anchor.left;
  const { pos, setPos, onPointerDown } = useDraggable({ left: Math.max(8, panelLeft - 264 - 10), top: Math.max(8, anchor.top - 40) }, ref);
  // Basics decides the height; Details and Variable keep it and scroll when they need more room
  useLayoutEffect(() => { if (tab === 'basics' && ref.current) typeBasicHeight = ref.current.offsetHeight; });
  useLayoutEffect(() => { const h = ref.current?.offsetHeight ?? 0; setPos(p => ({ left: p.left, top: Math.max(8, Math.min(p.top, window.innerHeight - h - 8)) })); }, [tab]);
  useEffect(() => {
    const down = (e: PointerEvent) => { const t = e.target as HTMLElement; if (!ref.current?.contains(t) && !t.closest?.('.sel-menu, .dlg-back')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.sel-menu')) { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, []);
  if (!first) return null;
  const v = <K extends keyof TextProps>(k: K): TextProps[K] | undefined => tval(nodes, k).value;
  const feats = first.features ?? {};
  const setFeat = (tag: string, on: boolean) => tset({ features: { ...(first.features ?? {}), [tag]: on } });
  const preview = (
    <div className="ty-preview" style={{ fontFamily: first.fontFamily, fontWeight: first.fontWeight, fontStyle: first.italic || first.slant ? 'italic' : 'normal', letterSpacing: first.letterSpacing, textTransform: ({ UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' } as Record<string, 'uppercase' | 'lowercase' | 'capitalize'>)[first.textCase ?? ''], fontVariantCaps: first.textCase === 'SMALL_CAPS' || first.textCase === 'SMALL_CAPS_FORCED' ? 'small-caps' : undefined, textDecoration: first.decoration === 'UNDERLINE' ? 'underline' : first.decoration === 'STRIKE' ? 'line-through' : undefined, textAlign: first.align === 'JUSTIFIED' ? 'justify' : first.align.toLowerCase() as 'left', fontFeatureSettings: featureCss(first.features), fontSize: Math.min(28, Math.max(14, first.fontSize)) }}>
      {first.characters.trim() ? first.characters.slice(0, 80) : 'Preview'}
    </div>
  );
  const row = (label: string, control: ReactNode) => <div className="ty-line"><span>{label}</span>{control}</div>;
  return (
    <div ref={ref} className="ty-pop" role="dialog" aria-label="Type settings" style={{ left: pos.left, top: pos.top, height: tab === 'basics' ? undefined : Math.min(typeBasicHeight || 520, window.innerHeight - 16) }}>
      <div className="ty-tabs" role="tablist" onPointerDown={onPointerDown}>
        {([['basics', 'Basics'], ['details', 'Details'], ['variable', 'Variable']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        <button className="icon-btn ty-x" aria-label="Close type settings" onClick={onClose}><Icon n="close" size={16} /></button>
      </div>
      <div className="ty-scroll">
        {preview}
        {tab === 'basics' && <div className="ty-body">
          {row('Alignment', <Seg<TextProps['align']> label="Alignment" disabled={ro} value={v('align')} onChange={x => tset({ align: x })} items={[['LEFT', <Icon n="taL" size={16} />, 'Left'], ['CENTER', <Icon n="taC" size={16} />, 'Center'], ['RIGHT', <Icon n="taR" size={16} />, 'Right'], ['JUSTIFIED', <Icon n="taJ" size={16} />, 'Justified']]} />)}
          {row('Decoration', <Seg<NonNullable<TextProps['decoration']>> label="Decoration" disabled={ro} value={v('decoration') ?? 'NONE'} onChange={x => tset({ decoration: x === 'NONE' ? undefined : x })} items={[['NONE', <span className="tdash" />, 'No decoration'], ['UNDERLINE', <Icon n="decoU" size={16} />, 'Underline'], ['STRIKE', <Icon n="decoS" size={16} />, 'Strikethrough']]} />)}
          {row('Case', <Seg<TextCase> label="Case" disabled={ro} value={v('textCase') ?? 'NONE'} onChange={x => tset({ textCase: x === 'NONE' ? undefined : x })} items={caseItems()} />)}
          <div className="ty-rule" />
          {row('Vertical trim', <Seg<NonNullable<TextProps['trim']>> label="Vertical trim" disabled={ro} value={v('trim') ?? 'STANDARD'} onChange={x => tset({ trim: x === 'STANDARD' ? undefined : x })} items={[['STANDARD', <span className="trim std">Ag</span>, 'Standard line box'], ['CAP_HEIGHT', <span className="trim cap">Ag</span>, 'Trim to cap height']]} />)}
          {row('List style', <Seg<NonNullable<TextProps['listStyle']>> label="List style" disabled={ro} value={v('listStyle') ?? 'NONE'} onChange={x => tset({ listStyle: x === 'NONE' ? undefined : x })} items={[['NONE', <span className="tdash" />, 'No list'], ['BULLET', <Icon n="listBullet" size={16} />, 'Bulleted list'], ['NUMBER', <Icon n="listNumber" size={16} />, 'Numbered list']]} />)}
          {row('Paragraph spacing', <NumberField title="Paragraph spacing" value={v('paragraphSpacing') ?? 0} min={0} disabled={ro} onCommit={x => tset({ paragraphSpacing: x || undefined })} />)}
          {row('Truncate text', <Seg<'NONE' | 'ELLIPSIS'> label="Truncate text" disabled={ro} value={v('truncate') ? 'ELLIPSIS' : 'NONE'} onChange={x => tset({ truncate: x === 'ELLIPSIS' ? true : undefined })} items={[['NONE', <span className="tdash" />, 'Do not truncate'], ['ELLIPSIS', <span className="ell">A…</span>, 'Truncate with an ellipsis (fixed-size text)']]} />)}
          {row('Wrap style', <Select aria-label="Wrap style" value={v('wrap') ?? 'AUTO'} disabled={ro} onChange={e => tset({ wrap: e.target.value === 'AUTO' ? undefined : (e.target.value as 'NONE') })}><option value="AUTO">Auto</option><option value="NONE">No wrap</option></Select>)}
        </div>}
        {tab === 'details' && <div className="ty-body">
          <div className="ty-h">Indentation</div>
          <Toggle label="Hanging punctuation" tag="hang" on={!!feats.hang} set={x => setFeat('hang', x)} disabled={ro} />
          <Toggle label="Hanging lists" tag="hanglist" on={!!feats.hanglist} set={x => setFeat('hanglist', x)} disabled={ro} />
          {row('Paragraph indent', <NumberField title="Paragraph indent" value={v('paragraphIndent') ?? 0} min={0} disabled={ro} onCommit={x => tset({ paragraphIndent: x || undefined })} />)}
          <div className="ty-rule" />
          <div className="ty-h">Letter case</div>
          {row('Case', <Seg<TextCase> label="Letter case" disabled={ro} value={v('textCase') ?? 'NONE'} onChange={x => tset({ textCase: x === 'NONE' ? undefined : x })} items={caseItems().slice(0, 5)} />)}
          <Toggle label="Case-sensitive forms" tag="case" on={!!feats.case} set={x => setFeat('case', x)} disabled={ro} />
          <Toggle label="Capital spacing" tag="cpsp" on={!!feats.cpsp} set={x => setFeat('cpsp', x)} disabled={ro} />
          {SECTIONS.map(sec => <div key={sec.title}>
            <div className="ty-rule" /><div className="ty-h">{sec.title}</div>
            {sec.items.map(([tag, label]) => <Toggle key={tag} label={label} tag={tag} on={tag === 'kern' ? feats.kern !== false : !!feats[tag]} set={x => setFeat(tag, x)} disabled={ro} />)}
          </div>)}
          <p className="ty-note">Feature flags are saved with the file and applied in the preview. The canvas itself draws kerning, case and small caps; the rest need a font with those OpenType features.</p>
        </div>}
        {tab === 'variable' && <div className="ty-body">
          <div className="ty-vline"><span>Slant</span>
            <NumberField title="Slant (degrees)" value={v('slant') ?? 0} min={-12} max={0} disabled={ro} onCommit={x => tset({ slant: x || undefined })} /></div>
          <input className="ty-slider" type="range" min={-12} max={0} step={1} aria-label="Slant slider" disabled={ro} value={v('slant') ?? 0} style={{ ['--p' as string]: `${(((v('slant') ?? 0) + 12) / 12) * 100}%` }} onChange={e => tset({ slant: Number(e.target.value) || undefined })} />
          <div className="ty-vline"><span>Weight</span>
            <NumberField title="Weight" value={v('fontWeight') ?? 400} min={100} max={900} disabled={ro} onCommit={x => tset({ fontWeight: Math.round(x) })} /></div>
          <div className="ty-wslider">
            <input className="ty-slider" type="range" min={100} max={900} step={100} aria-label="Weight slider" disabled={ro} value={v('fontWeight') ?? 400} style={{ ['--p' as string]: `${(((v('fontWeight') ?? 400) - 100) / 800) * 100}%` }} onChange={e => tset({ fontWeight: Number(e.target.value) })} />
            <div className="ty-dots">{Array.from({ length: 9 }, (_, i) => <i key={i} className={(i * 100 + 100) <= (v('fontWeight') ?? 400) ? 'on' : ''} />)}</div>
          </div>
          <label className="check"><input type="checkbox" disabled={ro} checked={!!v('italic')} onChange={e => tset({ italic: e.target.checked })} /> Italic style</label>
        </div>}
      </div>
    </div>
  );
}
