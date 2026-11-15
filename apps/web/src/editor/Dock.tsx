import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SwatchButton } from './ColorPicker';
import { PenArt, BrushArt, PencilArt } from './DrawArt';
import { useEditor, type Tool, type DrawStyle, type VecTool } from './state';
import { togglePathClosed, deletePoints, setVectorPath } from '@layr/core';
import { Icon, type IconName } from '../icons';
import { api } from '../api';
import type { CanvasController } from './controller';
import type { EditorSession } from './session';

interface Item { id: string; label: string; icon: IconName; key?: string; tool?: Tool; run?: () => void; disabled?: string }
interface Group { id: string; items: Item[]; hint?: string }

const STYLES: { id: DrawStyle; label: string }[] = [{ id: 'basic', label: 'Basic' }, { id: 'flat', label: 'Flat' }, { id: 'dashed', label: 'Dashed' }, { id: 'dotted', label: 'Dotted' }];
function StrokePreview({ style, size }: { style: DrawStyle; size: number }) {
  const w = Math.min(10, Math.max(2, size / 2));
  return <svg width="110" height="24" viewBox="0 0 110 24" aria-hidden><path d="M6 17C26 5 44 6 58 13s30 4 46-6" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap={style === 'flat' ? 'butt' : 'round'} strokeDasharray={style === 'dashed' ? `${w * 2} ${w * 2}` : style === 'dotted' ? `0.01 ${w * 2}` : undefined} /></svg>;
}
/** Options bar shown above the dock while the brush or pencil is active: colour, size and stroke style. */
function DrawOptions({ which }: { which: 'brush' | 'pencil' }) {
  const o = useEditor(s => s.drawOpts[which]);
  const set = useEditor(s => s.set);
  const all = useEditor(s => s.drawOpts);
  const [menu, setMenu] = useState(false);
  const upd = (p: Partial<typeof o>) => set({ drawOpts: { ...all, [which]: { ...o, ...p } } });
  const max = which === 'brush' ? 100 : 24;
  return (
    <div className="dock-opts" role="group" aria-label={`${which} options`} onPointerDown={e => e.stopPropagation()}>
      <SwatchButton className="do-swatch" paint={{ type: 'SOLID', color: o.color, opacity: 1 }} gradients={false} showOpacity={false} onChange={pt => pt.type === 'SOLID' && upd({ color: pt.color })} />
      <input className="do-num" type="number" min={1} max={max} aria-label="Stroke size" value={o.size} onChange={e => upd({ size: Math.min(max, Math.max(1, Number(e.target.value) || 1)) })} />
      <input className="do-range" type="range" min={1} max={max} aria-label="Stroke size slider" value={o.size} onChange={e => upd({ size: Number(e.target.value) })} style={{ ['--p' as string]: `${((o.size - 1) / (max - 1)) * 100}%` }} />
      <div className="do-style dd">
        <button className="do-stylebtn" aria-label="Stroke style" aria-expanded={menu} onClick={() => setMenu(!menu)}><StrokePreview style={o.style} size={o.size} /><Icon n="chevD" size={12} /></button>
        {menu && <div className="menu dd-menu up" role="menu">{STYLES.map(st => <button key={st.id} role="menuitem" className={o.style === st.id ? 'cur' : ''} onClick={() => { upd({ style: st.id }); setMenu(false); }}><StrokePreview style={st.id} size={o.size} /><span>{st.label}</span></button>)}</div>}
      </div>
    </div>
  );
}

const VEC_TOOLS: { id: VecTool; label: string; icon: IconName; hint: string }[] = [
  { id: 'move', label: 'Move', icon: 'move', hint: 'Drag points and handles; click the outline to add a point' },
  { id: 'lasso', label: 'Lasso', icon: 'lasso', hint: 'Drag around points to select them' },
  { id: 'paint', label: 'Paint', icon: 'paint', hint: 'Click the shape to fill it with the brush colour' },
  { id: 'bend', label: 'Bend', icon: 'bend', hint: 'Drag a segment to curve it; click a point to smooth or sharpen it' },
  { id: 'cut', label: 'Cut', icon: 'cut', hint: 'Click the outline to cut the path there' },
  { id: 'erase', label: 'Erase', icon: 'erase', hint: 'Click a point to delete it' },
];
/** Second floating bar (above the dock) with the point-editing tools, shown while a path is being edited. */
function EditBar({ session, ctrl }: { session: EditorSession; ctrl: CanvasController | null }) {
  const vt = useEditor(s => s.vecTool), set = useEditor(s => s.set), id = useEditor(s => s.vectorEdit);
  const store = session.store;
  const more = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const n = id ? store.doc.nodes[id] : null;
    set({ menu: { x: Math.min(r.left, window.innerWidth - 240), y: Math.max(8, r.top - 4 * 30 - 22), items: [
      { label: n?.path?.closed ? 'Open path' : 'Close path', run: () => id && togglePathClosed(store, id) },
      { label: 'Select all points', run: () => n?.path && set({ vecSel: n.path.points.map((_, i) => i) }) },
      { label: 'Delete selected points', run: () => { const sel = useEditor.getState().vecSel; if (!id || !n?.path || !sel.length) return; const np = deletePoints(n.path, sel); if (np) { setVectorPath(store, id, np, 'Delete points'); set({ vecSel: [] }); } } },
    ] } });
  };
  const btn = (t: typeof VEC_TOOLS[number]) => <button key={t.id} className={'eb-btn' + (vt === t.id ? ' on' : '')} aria-pressed={vt === t.id} title={t.hint} onClick={() => set({ vecTool: t.id })}><Icon n={t.icon} size={17} /><span>{t.label}</span></button>;
  return (
    <div className="dock-opts editbar" role="toolbar" aria-label="Edit object" onPointerDown={e => e.stopPropagation()}>
      {VEC_TOOLS.slice(0, 2).map(btn)}<i className="eb-sep" />{VEC_TOOLS.slice(2).map(btn)}<i className="eb-sep" />
      <button className="eb-btn" aria-label="More" onClick={more}><span>More</span><Icon n="chevD" size={12} /></button><i className="eb-sep" />
      <button className="eb-btn icon" aria-label="Done editing" title="Done (Esc)" onClick={() => ctrl?.exitVectorEdit()}><Icon n="close" size={17} /></button>
    </div>
  );
}

const DRAW_TOOLS: { tool: Tool; label: string; key: string; art: React.ReactNode }[] = [
  { tool: 'pen', label: 'Pen (vector)', key: 'P', art: <PenArt /> },
  { tool: 'brush', label: 'Brush', key: 'B', art: <BrushArt /> },
  { tool: 'pencil', label: 'Pencil', key: '⇧P', art: <PencilArt /> },
];

export function Dock({ session, ctrl, onPickImage }: { session: EditorSession; ctrl: CanvasController | null; onPickImage: () => void }) {
  const tool = useEditor(s => s.tool);
  const vectorEdit = useEditor(s => s.vectorEdit);
  const set = useEditor(s => s.set);
  const [open, setOpen] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [drawMode, setDrawMode] = useState(false);
  const lastW = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // glide the dock to its new width when the tool set changes
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.transition = 'none'; el.style.width = '';
    const to = el.getBoundingClientRect().width, from = lastW.current;
    lastW.current = to;
    if (from == null || Math.abs(from - to) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.style.width = `${from}px`; void el.offsetWidth;
    el.style.transition = 'width .28s cubic-bezier(.3,.8,.3,1)'; el.style.width = `${to}px`;
    const done = () => { el.style.transition = ''; el.style.width = ''; };
    const t = setTimeout(done, 320);
    return () => clearTimeout(t);
  }, [drawMode]);
  const proto = useEditor(s => s.mode) === 'prototype';
  const edit = session.canEdit && !proto;
  useEffect(() => { if (!open) return; const c = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); }; window.addEventListener('pointerdown', c); return () => window.removeEventListener('pointerdown', c); }, [open]);

  /** List the user's whiteboards (and a "new whiteboard" option) in a menu above the dock. */
  const pickWhiteboard = async () => {
    const ui = useEditor.getState();
    try {
      const { files } = await api.listFiles({ view: 'all' });
      const boards = files.filter(f => f.type === 'whiteboard' && !f.deletedAt);
      const r = ref.current?.getBoundingClientRect();
      const items = [
        { label: 'New whiteboard', run: async () => { try { const b = await api.createFile({ name: 'Whiteboard', type: 'whiteboard' }); session.insertWhiteboard({ id: b.file.id, name: b.file.name }); } catch (e) { ui.toast((e as Error).message, 'error'); } } },
        ...(boards.length ? [{ label: '', separator: true }] : []),
        ...boards.slice(0, 12).map(b => ({ label: b.name, run: () => session.insertWhiteboard({ id: b.id, name: b.name }) })),
      ];
      ui.set({ menu: { x: Math.max(8, (r?.left ?? 200) + 40), y: Math.max(8, (r?.top ?? 400) - items.length * 34 - 24), items } });
    } catch (e) { ui.toast((e as Error).message, 'error'); }
  };

  const groups: Group[] = [
    { id: 'move', items: [{ id: 'select', label: 'Move', icon: 'move', key: 'V', tool: 'select' }] },
    { id: 'frame', items: [{ id: 'frame', label: 'Frame', icon: 'frame', key: 'F', tool: 'frame' }, { id: 'section', label: 'Section', icon: 'section', tool: 'section' }] },
    { id: 'shape', items: [{ id: 'rect', label: 'Rectangle', icon: 'rect', key: 'R', tool: 'rect' }, { id: 'line', label: 'Line', icon: 'line', key: 'L', tool: 'line' }, { id: 'ellipse', label: 'Ellipse', icon: 'ellipse', key: 'O', tool: 'ellipse' }, { id: 'arrow', label: 'Arrow', icon: 'arrow', key: '⇧L', tool: 'arrow' }, { id: 'star', label: 'Star', icon: 'star', tool: 'star' }, { id: 'polygon', label: 'Polygon', icon: 'polygon', tool: 'polygon' }, { id: 'image', label: 'Image…', icon: 'image', key: '⇧⌘K', run: onPickImage }, { id: 'whiteboard', label: 'Whiteboard…', icon: 'whiteboard', run: () => void pickWhiteboard() }] },
    { id: 'pen', items: [{ id: 'pen', label: 'Pen', icon: 'pen', key: 'P', tool: 'pen' }, { id: 'pencil', label: 'Pencil', icon: 'pencil', key: '⇧P', tool: 'pencil' }] },
    { id: 'text', items: [{ id: 'text', label: 'Text', icon: 'text', key: 'T', tool: 'text' }, { id: 'textpath', label: 'Text on path', icon: 'textPath', tool: 'textpath' }] },
  ];
  const cur = (g: Group) => g.items.find(i => i.id === chosen[g.id]) ?? g.items[0];
  const isOn = (g: Group) => g.items.some(i => i.tool === tool);
  const choose = (g: Group, i: Item) => {
    if (i.disabled) return;
    setOpen(null);
    if (i.run) return i.run();
    setChosen(c => ({ ...c, [g.id]: i.id }));
    if (i.tool) ctrl?.setTool(i.tool);
  };
  const needsEdit = (g: Group, i: Item) => !edit && g.id !== 'move';

  return (
    <div className={'dock' + (drawMode ? ' drawing' : '')} role="toolbar" aria-label="Tools" ref={ref}>
      {vectorEdit ? <EditBar session={session} ctrl={ctrl} /> : (tool === 'brush' || tool === 'pencil') && <DrawOptions which={tool} />}
      <div className="dock-main">
        {groups.map(g => {
          const c = cur(g);
          const allDisabled = g.items.every(i => i.disabled);
          if (g.id === 'pen' && drawMode) return null; // pen and pencil live in the draw section instead (no duplicates)
          return (
            <Fragment key={g.id}>
            <div className="dock-group">
              <button className={'dtool' + (isOn(g) ? ' on' : '')} title={`${c.label}${c.key ? ` (${c.key})` : ''}${c.disabled ? ` — ${c.disabled}` : ''}`} aria-label={c.label} aria-pressed={isOn(g)}
                disabled={allDisabled || needsEdit(g, c)} onClick={() => choose(g, c)}><Icon n={c.icon} size={20} /></button>
              {g.items.length > 1 && <button className="dcaret" aria-label={`${g.id} tools`} disabled={allDisabled} onClick={() => setOpen(open === g.id ? null : g.id)}><Icon n="chevD" size={10} /></button>}
              {open === g.id && (
                <div className="dmenu" role="menu">
                  {g.items.map(i => <button key={i.id} role="menuitem" disabled={!!i.disabled || needsEdit(g, i)} title={i.disabled} onClick={() => choose(g, i)}><span className="dcheck">{c.id === i.id ? '✓' : ''}</span><Icon n={i.icon} size={16} /><span className="dlabel">{i.label}</span><kbd>{i.key}</kbd></button>)}
                </div>
              )}
            </div>
            {g.id === 'move' && drawMode && (
              <div className="dock-group draw-tools">
                <i className="dock-sep" />
                {DRAW_TOOLS.map(t => <button key={t.tool} className={'dtool art' + (tool === t.tool ? ' on' : '')} title={`${t.label} (${t.key})`} aria-label={t.label} aria-pressed={tool === t.tool} disabled={!edit} onClick={() => ctrl?.setTool(t.tool)}>{t.art}</button>)}
                <i className="dock-sep" />
              </div>
            )}
            </Fragment>
          );
        })}
        <div className="dock-group"><button className="dtool" disabled title="Comments arrive with multiplayer (Phase 3)" aria-label="Comments"><Icon n="comment" size={20} /></button></div>
        <i className="dock-sep" />
        <div className="dock-modeseg" role="group" aria-label="Tool set">
          <button className={drawMode ? 'on' : ''} aria-pressed={drawMode} aria-label="Draw mode" title="Draw mode" onClick={() => { setDrawMode(true); setOpen(null); }}><Icon n="draw" size={20} /></button>
          <button className={!drawMode ? 'on' : ''} aria-pressed={!drawMode} aria-label="Design mode" title="Design mode" onClick={() => { setDrawMode(false); setOpen(null); }}><Icon n="design" size={20} /></button>
        </div>
      </div>
    </div>
  );
}
