import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { alignPatches, centerOf, distributePatches, gridPatches, polyMid, flattenRoute, routeConnector, selectionBox, tableSize, CAPS, INK_COLORS, SHAPE_COLORS, SHAPE_KINDS, STICKY_COLORS, type BoardData, type Cap, type JamItem, type Route } from '@layr/core';
import { Select } from '../ui/Select';
import { askText } from '../ui/dialogs';
import { JIcon, ShapeGlyph, RouteGlyph, CapGlyph, type JamIcon } from './icons';
import { fitFont, fitText, fontOf, FONT, MONO, mctx } from './render';
import { useJam, type JamStore } from './store';
import { connectedCopy, toggleTimer, type CanvasApi } from './JamCanvas';
import { useEditor } from '../editor/state';

export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

// ---------- small controls ----------
export function Swatches({ colors, value, onPick, label }: { colors: string[]; value?: string; onPick: (c: string) => void; label: string }) {
  return (
    <div className="jm-swatches" role="listbox" aria-label={label}>
      {colors.map(c => <button key={c} role="option" aria-selected={c.toLowerCase() === value?.toLowerCase()} aria-label={`${label} ${c}`} className={'jm-sw' + (c.toLowerCase() === value?.toLowerCase() ? ' on' : '')} style={{ background: c }} onClick={() => onPick(c)} />)}
    </div>
  );
}
function Btn({ icon, label, on, onClick, disabled, children }: { icon?: JamIcon; label: string; on?: boolean; onClick?: () => void; disabled?: boolean; children?: React.ReactNode }) {
  return <button className={'jm-b' + (on ? ' on' : '')} aria-label={label} title={label} aria-pressed={on} disabled={disabled} onClick={onClick}>{icon ? <JIcon n={icon} size={18} /> : children}</button>;
}
function Sep() { return <span className="jm-sep" />; }
function Pop({ id, open, setOpen, trigger, children, label }: { id: string; open: string | null; setOpen: (v: string | null) => void; trigger: React.ReactNode; children: React.ReactNode; label: string }) {
  return (
    <span className="jm-popwrap">
      <button className={'jm-b' + (open === id ? ' on' : '')} aria-label={label} title={label} aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>{trigger}</button>
      {open === id && <div className="jm-pop" onPointerDown={e => e.stopPropagation()}>{children}</div>}
    </span>
  );
}
const Dot = ({ c }: { c?: string }) => <span className="jm-dot" style={{ background: c ?? '#fff' }} />;

// ---------- floating context toolbar ----------
export function ContextBar({ store, api }: { store: JamStore; api: CanvasApi | null }) {
  const ui = useJam(); const [open, setOpen] = useState<string | null>(null);
  const board = store.board; const its = ui.selection.map(i => board.items[i]).filter(Boolean);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(null), [ui.selection.join(','), ui.editing?.id]);
  if (!its.length || ui.tool !== 'select' || ui.editing || !api) return null;
  const box = selectionBox(board, its.map(i => i.id)); if (!box) return null;
  const a = api.worldToScreen({ x: box.x + box.w / 2, y: box.y }), bttm = api.worldToScreen({ x: box.x + box.w / 2, y: box.y + box.h });
  const W = api.size().w; const top = a.y - 64 < 56 ? bttm.y + 20 : a.y - 58; const left = Math.min(Math.max(a.x, 220), W - 220);
  const ids = its.map(i => i.id); const one = its.length === 1 ? its[0] : null; const kinds = new Set(its.map(i => i.kind));
  const patch = (p: Partial<JamItem>) => store.patch(ids, p);
  const locked = its.every(i => i.locked); const view = useJam.getState().me;
  const textual = its.every(i => ['sticky', 'shape', 'text'].includes(i.kind));
  const refit = (p: Partial<JamItem>) => store.change(b => { for (const id of ids) { const it = b.items[id]; Object.assign(it, p); if (it.kind === 'text') { const f = fitText(it); it.w = f.w; it.h = f.h; } } });
  const t0 = its[0];
  return (
    <div className="jm-ctx" ref={ref} style={{ left, top }} onPointerDown={e => e.stopPropagation()} role="toolbar" aria-label="Selection tools">
      {kinds.size === 1 && kinds.has('sticky') && <>
        <Pop id="sc" open={open} setOpen={setOpen} label="Sticky colour" trigger={<Dot c={t0.color} />}><Swatches colors={STICKY_COLORS} value={t0.color} label="Sticky colour" onPick={c => patch({ color: c })} /></Pop>
        <Sep />
      </>}
      {kinds.size === 1 && kinds.has('shape') && <>
        <Pop id="sh" open={open} setOpen={setOpen} label="Shape" trigger={<ShapeGlyph kind={t0.shape!} size={18} />}>
          <div className="jm-grid">{SHAPE_KINDS.map(k => <button key={k} className={'jm-b' + (t0.shape === k ? ' on' : '')} aria-label={`Shape ${k}`} title={k} onClick={() => patch({ shape: k })}><ShapeGlyph kind={k} size={20} /></button>)}</div>
        </Pop>
        <Pop id="fill" open={open} setOpen={setOpen} label="Fill" trigger={<Dot c={t0.color} />}><Swatches colors={SHAPE_COLORS} value={t0.color} label="Fill" onPick={c => patch({ color: c })} /></Pop>
        <Pop id="stroke" open={open} setOpen={setOpen} label="Outline" trigger={<span className="jm-ring" style={{ borderColor: t0.stroke }} />}>
          <Swatches colors={INK_COLORS} value={t0.stroke} label="Outline" onPick={c => patch({ stroke: c })} />
          <div className="jm-row">{[0, 1, 2, 4, 6].map(w => <button key={w} className={'jm-b' + ((t0.strokeW ?? 2) === w ? ' on' : '')} aria-label={`Outline ${w}`} onClick={() => patch({ strokeW: w })}>{w}</button>)}</div>
          <div className="jm-row">{(['solid', 'dashed', 'dotted'] as const).map(d => <button key={d} className={'jm-b wide' + ((t0.dash ?? 'solid') === d ? ' on' : '')} aria-label={`Dash ${d}`} onClick={() => patch({ dash: d })}>{d}</button>)}</div>
        </Pop>
        <Sep />
      </>}
      {kinds.size === 1 && kinds.has('text') && <>
        <Pop id="tc" open={open} setOpen={setOpen} label="Text colour" trigger={<span className="jm-tc" style={{ color: t0.textColor }}>A</span>}><Swatches colors={INK_COLORS} value={t0.textColor} label="Text colour" onPick={c => patch({ textColor: c })} /></Pop><Sep />
      </>}
      {textual && <>
        <Select className="jm-sel" aria-label="Font size" value={String(t0.fontSize ?? 16)} onChange={e => refit({ fontSize: Number(e.target.value) })}>{[10, 12, 14, 16, 18, 20, 24, 32, 40, 56, 72].map(n => <option key={n} value={n}>{n}</option>)}</Select>
        <Btn icon="bold" label="Bold" on={!!t0.bold} onClick={() => refit({ bold: !t0.bold })} />
        <Btn icon="italic" label="Italic" on={!!t0.italic} onClick={() => refit({ italic: !t0.italic })} />
        <Btn icon="underline" label="Underline" on={!!t0.underline} onClick={() => patch({ underline: !t0.underline })} />
        <Btn icon="strike" label="Strikethrough" on={!!t0.strike} onClick={() => patch({ strike: !t0.strike })} />
        <Pop id="al" open={open} setOpen={setOpen} label="Text alignment" trigger={<JIcon n={t0.align === 'center' || (!t0.align && t0.kind === 'shape') ? 'alignCenter' : t0.align === 'right' ? 'alignRight' : 'alignLeft'} size={18} />}>
          <div className="jm-row">{(['left', 'center', 'right'] as const).map(al => <Btn key={al} icon={al === 'left' ? 'alignLeft' : al === 'center' ? 'alignCenter' : 'alignRight'} label={`Align ${al}`} on={t0.align === al} onClick={() => patch({ align: al })} />)}</div>
        </Pop><Sep />
      </>}
      {one?.kind === 'connector' && <>
        <Pop id="route" open={open} setOpen={setOpen} label="Connector type" trigger={<RouteGlyph route={one.route ?? 'elbow'} />}>
          <div className="jm-row">{(['straight', 'elbow', 'curve'] as Route[]).map(r => <button key={r} className={'jm-b' + (one.route === r ? ' on' : '')} aria-label={`Connector ${r}`} title={r} onClick={() => patch({ route: r })}><RouteGlyph route={r} /></button>)}</div>
        </Pop>
        <Pop id="cs" open={open} setOpen={setOpen} label="Start cap" trigger={<span className="jm-flip"><CapGlyph cap={one.capStart ?? 'none'} /></span>}><div className="jm-row">{CAPS.map(c => <button key={c} className={'jm-b' + ((one.capStart ?? 'none') === c ? ' on' : '')} aria-label={`Start ${c}`} onClick={() => patch({ capStart: c as Cap })}><span className="jm-flip"><CapGlyph cap={c} /></span></button>)}</div></Pop>
        <Pop id="ce" open={open} setOpen={setOpen} label="End cap" trigger={<CapGlyph cap={one.capEnd ?? 'arrow'} />}><div className="jm-row">{CAPS.map(c => <button key={c} className={'jm-b' + ((one.capEnd ?? 'arrow') === c ? ' on' : '')} aria-label={`End ${c}`} onClick={() => patch({ capEnd: c as Cap })}><CapGlyph cap={c} /></button>)}</div></Pop>
        <Pop id="cc" open={open} setOpen={setOpen} label="Line" trigger={<Dot c={one.stroke} />}>
          <Swatches colors={INK_COLORS} value={one.stroke} label="Line colour" onPick={c => patch({ stroke: c })} />
          <div className="jm-row">{[1, 2, 4, 6].map(w => <button key={w} className={'jm-b' + ((one.strokeW ?? 2) === w ? ' on' : '')} aria-label={`Line ${w}`} onClick={() => patch({ strokeW: w })}>{w}</button>)}</div>
          <div className="jm-row">{(['solid', 'dashed', 'dotted'] as const).map(d => <button key={d} className={'jm-b wide' + ((one.dash ?? 'solid') === d ? ' on' : '')} aria-label={`Dash ${d}`} onClick={() => patch({ dash: d })}>{d}</button>)}</div>
        </Pop>
        <Btn label="Label" onClick={() => useJam.getState().set({ editing: { id: one.id } })}>Aa</Btn><Sep />
      </>}
      {one?.kind === 'stroke' && <>
        <Pop id="pc" open={open} setOpen={setOpen} label="Ink colour" trigger={<Dot c={one.stroke} />}>
          <Swatches colors={INK_COLORS} value={one.stroke} label="Ink colour" onPick={c => patch({ stroke: c })} />
          <div className="jm-row">{[2, 3, 5, 8, 12].map(w => <button key={w} className={'jm-b' + ((one.strokeW ?? 3) === w ? ' on' : '')} aria-label={`Width ${w}`} onClick={() => patch({ strokeW: w })}>{w}</button>)}</div>
        </Pop><Sep />
      </>}
      {one?.kind === 'section' && <>
        <Pop id="secc" open={open} setOpen={setOpen} label="Section colour" trigger={<Dot c={one.color} />}><Swatches colors={STICKY_COLORS} value={one.color} label="Section colour" onPick={c => patch({ color: c })} /></Pop>
        <Btn label="Rename section" onClick={() => useJam.getState().set({ editing: { id: one.id } })}>Aa</Btn>
        <Btn label="Fit to contents" onClick={() => { const kids = Object.values(board.items).filter(i => i.parent === one.id); const b = selectionBox(board, kids.map(k => k.id)); if (b) patch({ x: b.x - 30, y: b.y - 30, w: b.w + 60, h: b.h + 60 }); }}>Fit</Btn><Sep />
      </>}
      {one?.kind === 'table' && <>
        <Btn icon="rowAdd" label="Add row" onClick={() => tableOp(store, one.id, 'addRow')} /><Btn icon="colAdd" label="Add column" onClick={() => tableOp(store, one.id, 'addCol')} />
        <Btn icon="rowDel" label="Delete last row" disabled={one.rowH!.length < 2} onClick={() => tableOp(store, one.id, 'delRow')} /><Btn icon="colDel" label="Delete last column" disabled={one.colW!.length < 2} onClick={() => tableOp(store, one.id, 'delCol')} /><Sep />
      </>}
      {one?.kind === 'code' && <>
        <Select className="jm-sel" aria-label="Language" value={one.lang ?? 'javascript'} onChange={e => patch({ lang: e.target.value })}>{['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'html', 'css', 'json', 'sql', 'bash', 'text'].map(l => <option key={l}>{l}</option>)}</Select>
        <Btn icon="copy" label="Copy code" onClick={() => { void navigator.clipboard?.writeText(one.text ?? ''); useEditor.getState().toast('Code copied'); }} /><Sep />
      </>}
      {one?.kind === 'timer' && <>
        <Btn icon="play" label="Start or pause" onClick={() => toggleTimer(store, one)} />
        {[1, 3, 5, 10].map(m => <Btn key={m} label={`${m} minutes`} on={one.duration === m * 60000} onClick={() => patch({ duration: m * 60000, startedAt: null, pausedLeft: null })}>{m}m</Btn>)}<Sep />
      </>}
      {one?.kind === 'link' && <>
        <Btn icon="open" label="Open link" onClick={() => window.open(one.url, '_blank', 'noopener,noreferrer')} />
        <Btn label="Edit link" onClick={() => window.dispatchEvent(new CustomEvent('jam:edit-link', { detail: one.id }))}>Edit</Btn><Sep />
      </>}
      {one?.kind === 'emoji' && <><Pop id="em" open={open} setOpen={setOpen} label="Change stamp" trigger={<span style={{ fontSize: 16 }}>{one.emoji}</span>}><div className="jm-grid emo">{STAMPS.map(s => <button key={s} className="jm-b" aria-label={`Stamp ${s}`} onClick={() => patch({ emoji: s })}>{s}</button>)}</div></Pop><Sep /></>}
      {its.length > 1 && <>
        <Pop id="aln" open={open} setOpen={setOpen} label="Align" trigger={<JIcon n="alignL" size={18} />}>
          <div className="jm-row">{(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map(h => <Btn key={h} icon={({ left: 'alignL', hcenter: 'alignHC', right: 'alignR', top: 'alignT', vcenter: 'alignVC', bottom: 'alignB' } as const)[h]} label={`Align ${h}`} onClick={() => applyPatches(store, alignPatches(board, ids, h))} />)}</div>
          <div className="jm-row"><Btn icon="distH" label="Distribute horizontally" onClick={() => applyPatches(store, distributePatches(board, ids, 'h'))} /><Btn icon="distV" label="Distribute vertically" onClick={() => applyPatches(store, distributePatches(board, ids, 'v'))} /><Btn icon="grid" label="Arrange in a grid" onClick={() => applyPatches(store, gridPatches(board, ids))} /></div>
        </Pop>
        <Btn icon="group" label={its.every(i => i.group && i.group === t0.group) ? 'Ungroup' : 'Group'} on={its.every(i => i.group && i.group === t0.group)} onClick={() => groupToggle(store, ids)} /><Sep />
      </>}
      <Btn icon={locked ? 'unlock' : 'lock'} label={locked ? 'Unlock' : 'Lock'} on={locked} onClick={() => store.patch(ids, { locked: locked ? undefined : true })} />
      <Btn icon="comment" label="Comment on selection" onClick={() => { const c = api.worldToScreen({ x: box.x + box.w, y: box.y }); const w = api.screenToWorld({ x: c.x, y: c.y }); useJam.getState().set({ composer: { x: w.x, y: w.y, itemId: ids[0] }, tool: 'select' }); }} />
      <Btn icon="copy" label="Duplicate" onClick={() => duplicate(store, ids, api)} />
      <Pop id="more" open={open} setOpen={setOpen} label="Arrange" trigger={<JIcon n="more" size={18} />}>
        <div className="jm-row"><Btn icon="front" label="Bring to front" onClick={() => store.reorder(ids, 'front')} /><Btn icon="back" label="Send to back" onClick={() => store.reorder(ids, 'back')} /></div>
        {textual && one && (one.kind === 'sticky' || one.kind === 'shape') && <div className="jm-row"><Btn label="Duplicate to the right" onClick={() => { const id = connectedCopy(store, one.id, 'r', false); if (id) useJam.getState().set({ selection: [id] }); }}>+ →</Btn><Btn label="Duplicate below" onClick={() => { const id = connectedCopy(store, one.id, 'b', false); if (id) useJam.getState().set({ selection: [id] }); }}>+ ↓</Btn></div>}
      </Pop>
      <Btn icon="trash" label="Delete" onClick={() => { store.remove(ids); useJam.getState().set({ selection: [] }); }} />
      <span className="sr-only">{view.name}</span>
    </div>
  );
}

export const STAMPS = ['👍', '👎', '❤️', '🎉', '🔥', '⭐', '✅', '❌', '❓', '❗', '💡', '🚀', '👀', '🙌', '😀', '😂', '😍', '🤔', '😮', '😢', '😡', '👏', '💯', '⚡', '📌', '🏆', '🎯', '💬', '🧠', '🐞'];

function applyPatches(store: JamStore, p: Record<string, Partial<JamItem>>) { if (Object.keys(p).length) store.change(b => { for (const [id, v] of Object.entries(p)) Object.assign(b.items[id], v); }); }
export function groupToggle(store: JamStore, ids: string[]) {
  const b = store.board; const g = b.items[ids[0]]?.group; const same = g && ids.every(i => b.items[i]?.group === g);
  store.change(bd => { if (same) for (const i of ids) delete bd.items[i].group; else { const gid = 'g' + Math.random().toString(36).slice(2, 9); for (const i of ids) if (bd.items[i].kind !== 'connector') bd.items[i].group = gid; } });
}
export function duplicate(store: JamStore, ids: string[], api: CanvasApi | null) {
  const cl = (store.constructor as typeof JamStore).clone(store.board, ids, 28, 28); if (!cl.length) return;
  store.add(cl); useJam.getState().set({ selection: cl.filter(c => c.kind !== 'connector').map(c => c.id) }); void api;
}
export function tableOp(store: JamStore, id: string, op: 'addRow' | 'addCol' | 'delRow' | 'delCol') {
  store.change(b => {
    const t = b.items[id]; if (!t?.cells) return; const cols = t.colW!.length;
    if (op === 'addRow') { t.cells.push(Array(cols).fill('')); t.rowH!.push(40); }
    if (op === 'addCol') { t.cells.forEach(r => r.push('')); t.colW!.push(120); }
    if (op === 'delRow' && t.rowH!.length > 1) { t.cells.pop(); t.rowH!.pop(); }
    if (op === 'delCol' && cols > 1) { t.cells.forEach(r => r.pop()); t.colW!.pop(); }
    const s = tableSize(t); t.w = s.w; t.h = s.h;
  });
}

// ---------- inline text editor ----------
export function TextEditor({ store, api }: { store: JamStore; api: CanvasApi | null }) {
  const ed = useJam(s => s.editing); const cam = useJam(s => s.camera); const set = useJam(s => s.set);
  const ref = useRef<HTMLTextAreaElement>(null);
  const it = ed ? store.board.items[ed.id] : null;
  useLayoutEffect(() => { if (!ed) return; store.begin(); const t = ref.current; if (t) { t.focus(); if (it?.kind === 'section' && !ed.cell) t.select(); else t.setSelectionRange(t.value.length, t.value.length); } return () => store.end(); }, [ed?.id, ed?.cell?.join(',')]);
  if (!ed || !it || !api) return null;
  const z = cam.zoom; const board = store.board;
  const read = (): string => (ed.cell ? it.cells![ed.cell[0]][ed.cell[1]] : it.kind === 'code' ? it.text ?? '' : it.text ?? '');
  const write = (v: string) => store.change(b => {
    const t = b.items[ed.id]; if (!t) return;
    if (ed.cell) t.cells![ed.cell[0]][ed.cell[1]] = v; else t.text = v;
    if (t.kind === 'text') { const f = fitText(t, v); t.w = f.w; t.h = f.h; }
  });
  const done = () => set({ editing: null });
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); done(); return; }
    if (e.key === 'Tab' && !ed.cell && (it.kind === 'sticky' || it.kind === 'shape')) { e.preventDefault(); done(); const id = connectedCopy(store, it.id, e.shiftKey ? 'b' : 'r'); if (id) set({ selection: [id], editing: { id } }); return; }
    if (e.key === 'Tab' && ed.cell) { e.preventDefault(); const [r, c] = ed.cell; const cols = it.colW!.length, rows = it.rowH!.length; const n = r * cols + c + (e.shiftKey ? -1 : 1); if (n >= 0 && n < rows * cols) set({ editing: { id: ed.id, cell: [Math.floor(n / cols), n % cols] } }); return; }
    if (e.key === 'Enter' && (it.kind === 'connector' || it.kind === 'section' || (e.metaKey || e.ctrlKey))) { e.preventDefault(); done(); return; }
    e.stopPropagation();
  };
  // geometry in screen space
  let style: React.CSSProperties; let cls = 'jm-edit';
  const sc = (x: number, y: number) => api.worldToScreen({ x, y });
  if (it.kind === 'connector') { const m = polyMid(flattenRoute(routeConnector(board, it))); const p = sc(m.x, m.y); style = { left: p.x - 70, top: p.y - 13, width: 140, height: 26, fontSize: 13, textAlign: 'center', padding: '3px 6px', background: 'var(--bg)', color: 'var(--fg)' }; cls += ' line'; }
  else if (it.kind === 'section') { const p = sc(it.x, it.y - 30); style = { left: p.x + 4, top: p.y + 2 * z, width: Math.min(it.w, 260) * z - 8, height: 26 * z, fontSize: 14 * z, fontWeight: 600, padding: '0 8px', background: 'transparent', color: '#1e1e1e' }; cls += ' line'; }
  else if (ed.cell) { let x = it.x; for (let c = 0; c < ed.cell[1]; c++) x += it.colW![c]; let y = it.y; for (let r = 0; r < ed.cell[0]; r++) y += it.rowH![r]; const p = sc(x, y); style = { left: p.x, top: p.y, width: it.colW![ed.cell[1]] * z, height: it.rowH![ed.cell[0]] * z, fontSize: (it.fontSize ?? 14) * z, padding: `${6 * z}px ${8 * z}px`, background: '#fff', color: '#1e1e1e', fontWeight: ed.cell[0] === 0 ? 700 : 500 }; }
  else if (it.kind === 'code') { const p = sc(it.x, it.y + 30); style = { left: p.x, top: p.y, width: it.w * z, height: (it.h - 30) * z, fontSize: (it.fontSize ?? 13) * z, lineHeight: 1.55, fontFamily: MONO, padding: `${6 * z}px ${14 * z}px ${6 * z}px ${42 * z}px`, background: 'transparent', color: '#c0caf5', whiteSpace: 'pre', overflow: 'auto' }; }
  else {
    const p = sc(it.x, it.y); const ctx = mctx(); const pad = it.kind === 'sticky' ? Math.max(10, it.w * 0.07) : it.kind === 'shape' ? 10 : 4;
    const f = it.kind === 'text' ? { size: it.fontSize ?? 20 } : (ctx.font = fontOf(it, it.fontSize ?? 16), fitFont(ctx, it, it.text ?? '', it.w - pad * 2, it.h - pad * 2, it.fontSize ?? (it.kind === 'sticky' ? 18 : 16)));
    style = { left: p.x, top: p.y, width: it.w * z, height: it.kind === 'text' ? Math.max(it.h, 24) * z : it.h * z, fontSize: f.size * z, lineHeight: 1.3, fontWeight: it.bold ? 700 : it.kind === 'sticky' ? 600 : 500, fontStyle: it.italic ? 'italic' : 'normal', padding: pad * z, textAlign: it.align ?? (it.kind === 'shape' ? 'center' : 'left'), background: 'transparent', color: it.kind === 'text' ? (it.textColor ?? 'var(--fg)') : it.kind === 'shape' && (it.color === '#2b2b2b') ? '#fff' : '#1e1e1e', transform: it.rot ? `rotate(${it.rot}deg)` : undefined, transformOrigin: 'center', borderRadius: it.kind === 'sticky' ? 5 * z : 0 };
    if (it.kind === 'shape') { style.display = 'block'; style.paddingTop = Math.max(pad * z, (it.h * z - (f.size * z * 1.3 * Math.max(1, (it.text ?? '').split('\n').length))) / 2); }
    if (it.kind === 'sticky') style.paddingTop = Math.max(pad * z, (it.h * z - (f.size * z * 1.3 * Math.max(1, (it.text ?? '').split('\n').length))) / 2);
  }
  return <textarea ref={ref} className={cls} style={{ fontFamily: it.kind === 'code' ? MONO : FONT, ...style }} value={read()} placeholder={it.kind === 'connector' ? 'Label' : it.kind === 'section' ? 'Section' : ''} spellCheck={false} aria-label="Edit text" onChange={e => write(e.target.value)} onBlur={done} onKeyDown={onKey} onPointerDown={e => e.stopPropagation()} />;
}

// ---------- comments ----------
export function CommentsLayer({ store, api }: { store: JamStore; api: CanvasApi | null }) {
  const ui = useJam(); const cam = ui.camera; void cam;
  const [text, setText] = useState(''); const [reply, setReply] = useState('');
  useEffect(() => { setText(''); setReply(''); }, [ui.composer?.x, ui.openComment]);
  if (!api) return null; const b = store.board;
  const pos = (c: { x: number; y: number; itemId?: string }) => { const it = c.itemId ? b.items[c.itemId] : null; return it ? api.worldToScreen({ x: it.x + it.w + 4, y: it.y - 4 }) : api.worldToScreen(c); };
  const live = b.comments.filter(c => ui.showResolved || !c.resolved);
  const submit = () => { const t = text.trim(); const co = ui.composer; if (!t || !co) return; const id = 'c' + Math.random().toString(36).slice(2, 10); store.change(bd => { bd.comments.push({ id, x: co.x, y: co.y, itemId: co.itemId, author: ui.me.name, text: t, at: Date.now() }); }); ui.set({ composer: null, openComment: id, tool: 'select' }); };
  const open = ui.openComment ? b.comments.find(c => c.id === ui.openComment) : null;
  return (
    <div className="jm-comments">
      {live.map(c => { const p = pos(c); return <button key={c.id} className={'jm-pin' + (c.resolved ? ' done' : '') + (ui.openComment === c.id ? ' on' : '')} style={{ left: p.x, top: p.y }} aria-label={`Comment by ${c.author}`} onPointerDown={e => e.stopPropagation()} onClick={() => ui.set({ openComment: ui.openComment === c.id ? null : c.id, composer: null })}>{c.author[0]?.toUpperCase()}</button>; })}
      {ui.composer && (() => { const p = pos(ui.composer); return (
        <div className="jm-thread" style={{ left: p.x + 18, top: p.y }} onPointerDown={e => e.stopPropagation()}>
          <textarea autoFocus placeholder="Add a comment" aria-label="Comment text" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); if (e.key === 'Escape') ui.set({ composer: null }); }} />
          <div className="row end"><button className="btn small" onClick={() => ui.set({ composer: null })}>Cancel</button><button className="btn small primary" disabled={!text.trim()} onClick={submit}>Comment</button></div>
        </div>); })()}
      {open && (() => { const p = pos(open); return (
        <div className="jm-thread" style={{ left: p.x + 18, top: p.y }} onPointerDown={e => e.stopPropagation()}>
          <div className="jm-msg"><b>{open.author}</b> <span className="muted small">{new Date(open.at).toLocaleString()}</span><p>{open.text}</p></div>
          {open.replies?.map((r, i) => <div className="jm-msg" key={i}><b>{r.author}</b> <span className="muted small">{new Date(r.at).toLocaleString()}</span><p>{r.text}</p></div>)}
          <textarea placeholder="Reply…" aria-label="Reply" value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && reply.trim()) { store.change(bd => { const c = bd.comments.find(x => x.id === open.id)!; (c.replies ??= []).push({ author: ui.me.name, text: reply.trim(), at: Date.now() }); }); setReply(''); } }} />
          <div className="row end">
            <button className="btn small" onClick={() => { store.change(bd => { bd.comments = bd.comments.filter(x => x.id !== open.id); }); ui.set({ openComment: null }); }}>Delete</button>
            <button className="btn small" disabled={!reply.trim()} onClick={() => { store.change(bd => { const c = bd.comments.find(x => x.id === open.id)!; (c.replies ??= []).push({ author: ui.me.name, text: reply.trim(), at: Date.now() }); }); setReply(''); }}>Reply</button>
            <button className="btn small primary" onClick={() => { store.change(bd => { const c = bd.comments.find(x => x.id === open.id)!; c.resolved = !c.resolved; }); ui.set({ openComment: null }); }}>{open.resolved ? 'Reopen' : 'Resolve'}</button>
          </div>
        </div>); })()}
    </div>
  );
}

export function LinkEditor({ store }: { store: JamStore }) {
  useEffect(() => {
    const h = async (e: Event) => {
      const id = (e as CustomEvent<string>).detail; const it = store.board.items[id]; if (!it) return;
      const url = await askText('Link', it.url === 'https://' ? '' : it.url ?? '', { message: 'Paste an http(s) link to show as a card.', placeholder: 'https://example.com', okLabel: 'Save' });
      if (url === null) { if (it.url === 'https://') store.remove([id]); return; }
      const v = url.trim().match(/^https?:\/\//i) ? url.trim() : url.trim() ? `https://${url.trim()}` : '';
      try { new URL(v); } catch { useEditor.getState().toast('That is not a valid link', 'error'); if (it.url === 'https://') store.remove([id]); return; }
      store.patch([id], { url: v });
    };
    window.addEventListener('jam:edit-link', h); return () => window.removeEventListener('jam:edit-link', h);
  }, [store]);
  return null;
}
export type { BoardData, JamItem, JamStore };
export { centerOf };
