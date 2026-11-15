import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { BLEND_GROUPS, BLEND_LABEL,   apply, localMatrix, resizeNode, rotate, setProps, solid, topLevelOnly, translateWorld, unionRects, worldBounds, normAngle, setLayout, setSizing, addAutoLayout, removeAutoLayout,
  DEFAULT_LAYOUT, enclosingInstance, addVariant, setNodeMode, distribute, togglePathClosed, type LayoutGuide, type AutoLayout, type Effect, type ExportSetting, type Paint, type SceneNode, type TextProps, type BlendMode, type Sizing,
} from '@layr/core';
import { applyMask } from '@layr/core';
import { BOOL_ITEMS, runBoolItem } from './boolMenu';
import { useEditor } from './state';
import type { EditorSession } from './session';
import { DEFAULT_CANVAS_DARK, DEFAULT_CANVAS_LIGHT, type CanvasController } from './controller';
import type { Action } from './actions';
import { ColorField, NumberField } from './fields';
import { SwatchButton } from './ColorPicker';
import { Icon, type IconName } from '../icons';
import { renderNodes } from '../engine/exportImage';
import { ComponentPanel } from './ComponentPanel';
import { FRAME_PRESETS } from './presetData';
import { Bindable, StyleChip, StyleMenuButton, VarMenuButton, isStyled } from './BindControls';
import { Select } from '../ui/Select';
import { StrokeSettings } from './StrokeSettings';
import { TypographySection, TypeSettings } from './Typography';

type Mixed<T> = { mixed: boolean; value: T };
function common<T>(nodes: SceneNode[], get: (n: SceneNode) => T, eq: (a: T, b: T) => boolean = (a, b) => a === b): Mixed<T> {
  const first = get(nodes[0]);
  return { mixed: nodes.some(n => !eq(get(n), first)), value: first };
}
const jeq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const TYPE_LABEL: Record<string, string> = { VECTOR: 'Vector', COMPONENT_SET: 'Component set', FRAME: 'Frame', GROUP: 'Group', RECT: 'Rectangle', ELLIPSE: 'Ellipse', LINE: 'Line', TEXT: 'Text', COMPONENT: 'Component', INSTANCE: 'Instance' };

function HexInput({ color, ro, onChange }: { color: string; ro: boolean; onChange: (c: string) => void }) {
  const [t, setT] = useState(color.replace('#', '').toUpperCase());
  useEffect(() => setT(color.replace('#', '').toUpperCase()), [color]);
  return <input className="cf-hex" aria-label="Hex colour" value={t} disabled={ro} maxLength={6} onChange={e => setT(e.target.value)} onBlur={() => (/^[0-9a-f]{6}$/i.test(t) ? onChange('#' + t.toUpperCase()) : setT(color.replace('#', '').toUpperCase()))} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />;
}
function Section({ title, actions, children, empty }: { title: string; actions?: ReactNode; children?: ReactNode; empty?: boolean }) {
  return (
    <section className={'isec' + (empty ? ' collapsed' : '')}>
      <div className="isec-head"><h4>{title}</h4><span className="isec-actions">{actions}</span></div>
      {children}
    </section>
  );
}
const IBtn = (p: { icon: IconName; title: string; onClick?: (e: React.MouseEvent) => void; disabled?: boolean; on?: boolean }) =>
  <button className={'icon-btn' + (p.on ? ' on' : '')} title={p.title} aria-label={p.title} disabled={p.disabled} onClick={p.onClick}><Icon n={p.icon} size={16} /></button>;

export function Inspector({ session, ctrl, actions }: { session: EditorSession; ctrl: CanvasController | null; actions: Action[] }) {
  const store = session.store;
  const vectorEdit = useEditor(s => s.vectorEdit);
  const [strokeSet, setStrokeSet] = useState<DOMRect | null>(null);
  const [typeSet, setTypeSet] = useState<DOMRect | null>(null);
  useSyncExternalStore(store.subscribe.bind(store), () => store.version);
  const selection = useEditor(s => s.selection);
  const set = useEditor(s => s.set);
  const fileInput = useRef<HTMLInputElement>(null);
  const [indep, setIndep] = useState(false);
  const [indepCorners, setIndepCorners] = useState(false);
  const ids = topLevelOnly(store, selection);
  const nodes = ids.map(i => store.doc.nodes[i]).filter(Boolean);
  const ro = !session.canEdit;
  const act = (id: string) => actions.find(a => a.id === id)!;
  const commit = (props: Partial<SceneNode>, label?: string) => setProps(store, ids, props, label);

  if (!nodes.length) {
    const page = store.doc.nodes[useEditor.getState().pageId];
    return (
      <div className="ibody">
        <Section title="Page" actions={page?.canvasBg ? <IBtn icon="rotate90" title="Reset to the default canvas colour" disabled={ro} onClick={() => setProps(store, [page.id], { canvasBg: undefined }, 'Canvas background')} /> : undefined}>
          <div className="muted pad0">{page?.name} · {page?.children.length ?? 0} top-level layers</div>
          <div className="prow"><div className="pill"><ColorField color={page?.canvasBg ?? (useEditor.getState().theme === 'dark' ? DEFAULT_CANVAS_DARK : DEFAULT_CANVAS_LIGHT)} disabled={ro} onChange={c => setProps(store, [page.id], { canvasBg: c }, 'Canvas background')} /></div></div>
          <div className="muted small">Canvas background — click empty canvas to edit it here.</div>
        </Section>
        <Section title="Selection"><div className="muted pad0">Select a layer to edit its properties.{ro && ' This file is view-only for you.'}</div></Section>
      </div>
    );
  }

  const single = nodes.length === 1 ? nodes[0] : null;
  const multiBox = unionRects(ids.map(i => worldBounds(store.doc, i)));
  const anyText = nodes.some(n => n.type === 'TEXT');
  const hasText = nodes.every(n => n.type === 'TEXT');
  const isLineAll = nodes.every(n => n.type === 'LINE');
  const frameLike = nodes.every(n => ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(n.type));
  const hasLayout = frameLike && nodes.every(n => !!n.layout);
  const parentLayout = nodes.every(n => { const p = store.doc.nodes[n.parent!]; return !!p?.layout; });
  const canFill = nodes.every(n => n.type !== 'LINE' && n.type !== 'GROUP');
  const canStroke = nodes.every(n => n.type !== 'GROUP' && n.type !== 'TEXT');
  const cm = <T,>(g: (n: SceneNode) => T, eq?: (a: T, b: T) => boolean) => common(nodes, g, eq);
  const inInstance = nodes.some(n => !!enclosingInstance(store.doc, n.id));
  const L = hasLayout ? nodes[0].layout! : null;
  const headIcon: IconName = single ? (({ TEXT: 'text', ELLIPSE: 'ellipse', VECTOR: 'pen', RECT: 'rect', GROUP: 'group', LINE: 'line', INSTANCE: 'instance', COMPONENT: 'component', COMPONENT_SET: 'components' } as Record<string, IconName>)[single.type] ?? (single.layout ? 'layers' : 'frame')) : 'layers';
  const hasRadius = nodes.every(n => ['RECT', 'FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(n.type));
  const radiusMixed = nodes.some(n => n.cornerRadius !== nodes[0].cornerRadius || !!n.cornerRadii !== !!nodes[0].cornerRadii);
  const boundVisible = nodes.every(n => n.varBindings?.visible) ? true : false;
  const layoutStyled = isStyled(nodes, 'LAYOUT');
  const textStyled = isStyled(nodes.filter(n => n.text), 'TEXT');
  const modeCols = Object.values(store.doc.collections).filter(c => c.modes.length > 1);

  const setX = (v: number) => { if (single) commit({ x: v }, 'Move'); else store.transact('Move', () => { for (const id of ids) translateWorld(store, id, v - multiBox.x, 0); }); };
  const setY = (v: number) => { if (single) commit({ y: v }, 'Move'); else store.transact('Move', () => { for (const id of ids) translateWorld(store, id, 0, v - multiBox.y); }); };
  const setSize = (axis: 'w' | 'h', v: number) => {
    store.transact('Resize', () => {
      for (const id of ids) {
        const n = store.doc.nodes[id];
        if (n.type === 'TEXT' && n.text) { const t = { ...n.text }; if (axis === 'w' && t.resize === 'AUTO_WIDTH') t.resize = 'AUTO_HEIGHT'; if (axis === 'h') t.resize = 'FIXED'; store.apply({ t: 'set', id, props: { text: t } }); }
        resizeNode(store, id, { width: axis === 'w' ? Math.max(v, 1) : n.width, height: axis === 'h' ? Math.max(v, 1) : n.height });
      }
      session.fitText(ids);
    });
  };
  const setRotation = (v: number) => {
    store.transact('Rotate', () => {
      for (const id of ids) {
        const n = store.doc.nodes[id];
        const c = apply(localMatrix(n), { x: n.width / 2, y: n.height / 2 });
        const off = apply(rotate(v), { x: n.width / 2, y: n.height / 2 });
        store.apply({ t: 'set', id, props: { rotation: normAngle(v), x: c.x - off.x, y: c.y - off.y } });
      }
    });
  };
  const rotate90 = () => setRotation(normAngle((single ? single.rotation : nodes[0].rotation) + 90));

  const fills = cm(n => n.fills, jeq), strokes = cm(n => n.strokes, jeq), effects = cm(n => n.effects, jeq);
  const tv = <K extends keyof TextProps>(k: K): Mixed<TextProps[K] | undefined> => common(nodes.filter(n => n.text), n => n.text![k], jeq);
  const tset = (patch: Partial<TextProps>) => session.updateText(ids.filter(i => store.doc.nodes[i].type === 'TEXT'), patch);

  // ---- header menu ----
  const openMore = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const by = (id: string) => ({ label: act(id).label, shortcut: act(id).shortcut, disabled: !act(id).enabled(), run: act(id).run });
    set({ menu: { x: r.right - 220, y: r.bottom + 4, items: [by('layout.add'), by('layout.remove'), { label: '', separator: true }, by('comp.create'), by('comp.variants'), by('comp.instance'), by('comp.detach'), by('comp.reset'), by('comp.goMain'), { label: '', separator: true }, by('arrange.group'), by('arrange.frame'), by('arrange.ungroup'), { label: '', separator: true }, by('arrange.lock'), by('arrange.hide')] } });
  };
  const compIcon: { icon: IconName; title: string; run: () => void } = single?.type === 'INSTANCE' ? { icon: 'instance', title: 'Detach instance', run: act('comp.detach').run }
    : single?.type === 'COMPONENT' ? { icon: 'component', title: 'Create instance', run: act('comp.instance').run }
    : single?.type === 'COMPONENT_SET' ? { icon: 'component', title: 'Add variant', run: () => { const f = single.children[single.children.length - 1]; if (f) { const id = addVariant(store, single.id); if (id) set({ selection: [id] }); } } } : { icon: 'component', title: 'Create component', run: act('comp.create').run };

  // ---- paint rows ----
  const paintRow = (prefix: 'fills' | 'strokes', list: Paint[], idx: number, write: (l: Paint[]) => void) => {
    const p = list[idx];
    const upd = (np: Paint) => write(list.map((x, i) => (i === idx ? np : x)));
    const typeMenu = (e: React.MouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const items = [{ label: `${p.type === 'SOLID' ? '✓ ' : '   '}Solid`, run: () => upd(solid(p.type === 'LINEAR' ? p.stops[0].color : '#D9D9D9', p.opacity)) },
        { label: `${p.type === 'LINEAR' ? '✓ ' : '   '}Linear gradient`, run: () => upd({ type: 'LINEAR', angle: 90, opacity: p.opacity, visible: true, stops: [{ pos: 0, color: p.type === 'SOLID' ? p.color : '#7C5CFF', opacity: 1 }, { pos: 1, color: '#0D99FF', opacity: 1 }] }) }];
      items.push({ label: `${p.type === 'PATTERN' ? '✓ ' : '   '}Pattern`, run: () => upd({ type: 'PATTERN', sourceId: null, tile: 'RECT', scale: 1, spacingX: 0, spacingY: 0, align: 'tl', opacity: p.opacity, visible: true }) });
      if (p.type === 'IMAGE') items.push({ label: '✓ Image', run: () => {} });
      set({ menu: { x: Math.min(r.left - 120, window.innerWidth - 240), y: r.bottom + 4, items } });
    };
    return (
      <div className="prow" key={idx}>
        <div className="pill">
          {/* one stable swatch for every fill type, so the open picker survives switching between Solid / Gradient / Pattern / Image */}
          <Bindable session={session} ids={ids} path={`${prefix}.${idx}.color`} ro={ro}>
            <span className="cf">
              <SwatchButton paint={p} disabled={ro} fillTypes={prefix === 'fills'} blend bind={{ ids, path: `${prefix}.${idx}.color` }}
                onChange={np => upd((np.type === p.type ? { ...p, ...np } : { visible: p.visible, ...np }) as Paint)} />
              {p.type === 'SOLID' ? <HexInput color={p.color} ro={ro} onChange={c => upd({ ...p, color: c })} />
                : p.type === 'LINEAR' ? <span className="cf-hex gradlabel">Linear</span>
                : p.type === 'PATTERN' ? <span className="cf-hex gradlabel">{p.sourceId && session.store.doc.nodes[p.sourceId] ? `Pattern: ${session.store.doc.nodes[p.sourceId].name}` : 'Pattern'}</span>
                : <Select className="plain" value={p.scaleMode} disabled={ro} onChange={e => upd({ ...p, scaleMode: e.target.value as 'FILL' })}><option value="FILL">Fill</option><option value="FIT">Fit</option><option value="STRETCH">Stretch</option><option value="TILE">Tile</option></Select>}
            </span>
          </Bindable>
          <span className="pdiv" />
          <NumberField value={Math.round(p.opacity * 100)} suffix="%" min={0} max={100} disabled={ro} onCommit={v => upd({ ...p, opacity: v / 100 })} />
          <button className="icon-btn" title="Paint type" aria-label="Paint type" disabled={ro} onClick={typeMenu}><Icon n="chevD" size={11} /></button>
        </div>
        <IBtn icon={p.visible ? 'eye' : 'eyeOff'} title={p.visible ? 'Hide' : 'Show'} disabled={ro} onClick={() => upd({ ...p, visible: !p.visible })} />
        <IBtn icon="minus" title="Remove" disabled={ro} onClick={() => write(list.filter((_, i) => i !== idx))} />
      </div>
    );
  };
  const effRow = (list: Effect[], idx: number, write: (l: Effect[]) => void) => {
    const e = list[idx];
    const upd = (ne: Effect) => write(list.map((x, i) => (i === idx ? ne : x)));
    return (
      <div className="stack" key={idx}>
        <div className="row">
          <Select className="grow" value={e.type} disabled={ro} onChange={ev => upd(ev.target.value === 'DROP_SHADOW' ? { type: 'DROP_SHADOW', x: 0, y: 4, blur: 8, color: '#000000', opacity: 0.25, visible: true } : { type: 'LAYER_BLUR', radius: 4, visible: true })}><option value="DROP_SHADOW">Drop shadow</option><option value="LAYER_BLUR">Layer blur</option></Select>
          <IBtn icon={e.visible ? 'eye' : 'eyeOff'} title="Toggle" disabled={ro} onClick={() => upd({ ...e, visible: !e.visible })} />
          <IBtn icon="minus" title="Remove" disabled={ro} onClick={() => write(list.filter((_, i) => i !== idx))} />
        </div>
        {e.type === 'DROP_SHADOW' ? (
          <div className="grid2">
            <NumberField label="X" value={e.x} disabled={ro} onCommit={v => upd({ ...e, x: v })} /><NumberField label="Y" value={e.y} disabled={ro} onCommit={v => upd({ ...e, y: v })} />
            <NumberField label="B" title="Blur" value={e.blur} min={0} disabled={ro} onCommit={v => upd({ ...e, blur: v })} />
            <div className="pfield"><ColorField color={e.color} disabled={ro} onChange={c => upd({ ...e, color: c })} /><NumberField value={Math.round(e.opacity * 100)} suffix="%" min={0} max={100} disabled={ro} onCommit={v => upd({ ...e, opacity: v / 100 })} /></div>
          </div>
        ) : <NumberField label="R" title="Blur radius" value={e.radius} min={0} disabled={ro} onCommit={v => upd({ ...e, radius: v })} />}
      </div>
    );
  };

  // ---- selection colors (real: recolors everywhere inside the selection) ----
  const colors = (() => {
    const seen = new Map<string, number>();
    const walk = (id: string) => { const n = store.doc.nodes[id]; for (const p of [...n.fills, ...n.strokes]) if (p.type === 'SOLID') seen.set(p.color.toUpperCase(), (seen.get(p.color.toUpperCase()) ?? 0) + 1); n.children.forEach(walk); };
    ids.forEach(walk);
    return [...seen.keys()];
  })();
  const recolor = (from: string, to: string) => store.transact('Change selection colors', () => {
    const walk = (id: string) => {
      const n = store.doc.nodes[id];
      const map = (l: Paint[]) => l.map(p => (p.type === 'SOLID' && p.color.toUpperCase() === from ? { ...p, color: to } : p));
      if (jeq(map(n.fills), n.fills) === false || jeq(map(n.strokes), n.strokes) === false) store.apply({ t: 'set', id, props: { fills: map(n.fills), strokes: map(n.strokes) } });
      n.children.forEach(walk);
    };
    ids.forEach(walk);
  });

  const x = single ? single.x : multiBox.x, y = single ? single.y : multiBox.y;
  const w = single ? single.width : multiBox.w, h = single ? single.height : multiBox.h;
  const hasImage = nodes.some(n => n.fills.some(f => f.type === 'IMAGE'));
  const sizingH = cm(n => n.sizingH ?? 'FIXED'), sizingV = cm(n => n.sizingV ?? 'FIXED');
  const canHug = (n: SceneNode) => !!n.layout || n.type === 'TEXT';
  const sizeMenu = (axis: 'H' | 'V') => {
    const cur = axis === 'H' ? sizingH : sizingV;
    const opts: [Sizing, string][] = [['FIXED', 'Fixed']];
    if (nodes.every(canHug)) opts.push(['HUG', 'Hug contents']);
    if (parentLayout) opts.push(['FILL', 'Fill container']);
    return (
      <Select className="sizing" title={`${axis === 'H' ? 'Width' : 'Height'} resizing`} aria-label={`${axis === 'H' ? 'Width' : 'Height'} resizing`} value={cur.mixed ? '' : cur.value} disabled={ro || opts.length < 2}
        onChange={e => {
          const v = e.target.value as Sizing;
          store.transact('Resizing', () => {
            if (anyText) for (const id of ids) { const n = store.doc.nodes[id]; if (n.type === 'TEXT' && n.text) store.apply({ t: 'set', id, props: { text: { ...n.text, resize: v === 'HUG' ? (axis === 'H' ? 'AUTO_WIDTH' : 'AUTO_HEIGHT') : n.text.resize } } }); }
            setSizing(store, ids.filter(i => store.doc.nodes[i].type !== 'TEXT' || v !== 'HUG'), axis, v);
          });
        }}>
        {cur.mixed && <option value="">Mixed</option>}{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
    );
  };
  const alignCell = (col: number, row: number) => {
    if (!L) return null;
    const horiz = L.mode === 'HORIZONTAL';
    const prim = (['MIN', 'CENTER', 'MAX'] as const)[horiz ? col : row], counter = (['MIN', 'CENTER', 'MAX'] as const)[horiz ? row : col];
    const between = L.primaryAlign === 'SPACE_BETWEEN';
    const primIdx = horiz ? col : row, counterIdx = horiz ? row : col;
    const on = between ? primIdx === 1 && L.counterAlign === counter : L.primaryAlign === prim && L.counterAlign === counter;
    // the marker mirrors the layout: stacked rows for a vertical layout, side-by-side columns for a horizontal one;
    // bars sit left/centre/right (vertical) or top/centre/bottom (horizontal) like the chosen alignment, spread apart for space-between
    const glyph = `glyph ${horiz ? 'cols' : 'rows'} a${counterIdx}${between ? ' between' : ''}`;
    return <button key={`${col}${row}`} className={'acell' + (on ? ' on' : '')} disabled={ro} aria-pressed={on} aria-label={`Align ${['top', 'center', 'bottom'][row]} ${['left', 'center', 'right'][col]}`} title={`Align ${['top', 'center', 'bottom'][row]} ${['left', 'center', 'right'][col]}`} onClick={() => setLayout(store, ids, { primaryAlign: prim, counterAlign: counter })}>{on ? <i className={glyph}><b /></i> : <i />}</button>;
  };

  return (
    <div className="ibody">
      {ro && <div className="notice">View-only: you can inspect but not edit this file.</div>}
      <div className="ihead">
        <span className={'ltile' + (single && ['COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(single.type) ? ' comp' : '')}><Icon n={headIcon} size={16} /></span>
        <b className="lname2" title={single?.name}>{single ? single.name : `${nodes.length} layers`}</b>
        <span className="ltype">{single ? TYPE_LABEL[single.type] : ''}</span>
        <span className="isec-actions">
          <IBtn icon={compIcon.icon} title={compIcon.title} disabled={ro} onClick={compIcon.run} />
          <IBtn icon="mask" title="Mask selection" disabled={ro || !ids.length} on={nodes.length === 1 && !!nodes[0].isMask} onClick={() => { const g = applyMask(store, ids); if (g) useEditor.getState().set({ selection: [g] }); }} />
          <IBtn icon="boolUnion" title="Boolean operations" disabled={ro || !ids.length} onClick={e => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            useEditor.getState().set({ menu: { x: Math.min(r.left, window.innerWidth - 240), y: r.bottom + 6, items: BOOL_ITEMS.map(it => ({ label: it.label, icon: it.icon, shortcut: it.shortcut, run: () => runBoolItem(session, ids, it) })) } });
          }} />
          <IBtn icon="editObject" title="Edit shape points" disabled={ro || nodes.length !== 1} on={!!vectorEdit} onClick={() => ctrl?.editObject()} />
          <IBtn icon="ellipsis" title="More actions" onClick={openMore} />
        </span>
      </div>
      {single?.type === 'INSTANCE' && (
        <div className="ibanner"><Icon n="instance" size={14} /> Instance of <b>{store.doc.nodes[single.componentId ?? '']?.name ?? 'missing component'}</b>
          <button className="btn small" onClick={act('comp.goMain').run} disabled={!act('comp.goMain').enabled()}>Go to main</button>
          <button className="btn small" disabled={ro || !(single.overrides?.length || single.children.some(c => store.doc.nodes[c].overrides?.length))} onClick={act('comp.reset').run}>Reset</button></div>
      )}
      {inInstance && single?.type !== 'INSTANCE' && <div className="ibanner"><Icon n="instance" size={14} /> Layer inside an instance{single?.overrides?.length ? ` · overrides: ${single.overrides.join(', ')}` : ''}</div>}

      {single && <ComponentPanel session={session} node={single} ro={ro} />}


      <section className="isec alignsec">
        <div className="alignpill" role="group" aria-label="Align">
          {([['left', 'alignL', 'Align left'], ['hcenter', 'alignHC', 'Align horizontal centers'], ['right', 'alignR', 'Align right'], ['top', 'alignT', 'Align top'], ['vcenter', 'alignVC', 'Align vertical centers'], ['bottom', 'alignB', 'Align bottom']] as const).map(([m, ic, t]) => <button key={m} disabled={ro} title={t} aria-label={t} onClick={() => ctrl?.alignSelection(m)}><Icon n={ic} size={18} /></button>)}
          <button disabled={ro || ids.length < 3} title="Distribute horizontal spacing (select 3 or more layers)" aria-label="Distribute horizontally" onClick={() => distribute(store, ids, 'h')}><Icon n="distribute" size={18} /></button>
        </div>
      </section>

      {single?.type === 'EMBED' && single.embed && (
        <Section title="Whiteboard">
          <div className="grid2" style={{ gridTemplateColumns: '1fr' }}>
            <div className="muted" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={single.embed.fileName}>{single.embed.fileName}</div>
            <button className="btn small" onClick={() => { location.hash = `#/file/${single.embed!.fileId}`; }}>Open in its own tab</button>
            <div className="muted" style={{ fontSize: 12 }}>Work right inside the card: click, draw, zoom and drag. Resize the card from its corners. Drag items out of the board onto the design to turn them into editable layers.</div>
          </div>
        </Section>
      )}

      <Section title="Layout">
        <div className="grid2">
          <NumberField label="X" value={x} disabled={ro || (parentLayout && !nodes.every(n => n.absolute))} title={parentLayout ? 'Position is controlled by the parent auto layout (use Absolute position to opt out)' : undefined} onCommit={setX} />
          <NumberField label="Y" value={y} disabled={ro || (parentLayout && !nodes.every(n => n.absolute))} onCommit={setY} />
        </div>
        {!frameLike && (
        <div className="grid2 wh">
          <div className="whf"><NumberField label="W" value={w} min={1} disabled={ro} onCommit={v => setSize('w', v)} />{sizeMenu('H')}</div>
          <div className="whf"><NumberField label="H" value={isLineAll ? 0 : h} min={1} disabled={ro || isLineAll} onCommit={v => setSize('h', v)} />{sizeMenu('V')}</div>
        </div>
        )}
        <div className="grid2">
          <NumberField label={<Icon n="rotate90" size={13} />} title="Rotation (degrees, about the centre)" value={cm(n => normAngle(n.rotation)).mixed ? null : normAngle(nodes[0].rotation)} disabled={ro} onCommit={setRotation} suffix="°" />
          {hasRadius ? <div className="whf"><Bindable session={session} ids={ids} path="cornerRadius" ro={ro}><NumberField label={<Icon n="corner" size={13} />} title="Corner radius" value={radiusMixed ? null : (nodes[0].cornerRadii ? null : nodes[0].cornerRadius)} min={0} disabled={ro || !!nodes[0].cornerRadii} onCommit={v => commit({ cornerRadius: v, cornerRadii: undefined }, 'Corner radius')} /></Bindable>
            <IBtn icon="expand" title="Independent corner radius" disabled={ro} on={indepCorners || !!nodes[0].cornerRadii} onClick={() => { if (nodes[0].cornerRadii) { commit({ cornerRadii: undefined, cornerRadius: nodes[0].cornerRadii[0] }, 'Corner radius'); setIndepCorners(false); } else setIndepCorners(!indepCorners); }} /></div> : <span />}
        </div>
        {hasRadius && (indepCorners || nodes[0].cornerRadii) && (
          <div className="grid2 corners">
            {(['TL', 'TR', 'BL', 'BR'] as const).map(k => { const idx = { TL: 0, TR: 1, BR: 2, BL: 3 }[k]; const cur = nodes[0].cornerRadii ?? [nodes[0].cornerRadius, nodes[0].cornerRadius, nodes[0].cornerRadius, nodes[0].cornerRadius]; return (
              <NumberField key={k} label={k} title={`Radius ${k}`} value={cur[idx]} min={0} disabled={ro} onCommit={v => { const next = [...cur] as [number, number, number, number]; next[idx] = v; commit({ cornerRadii: next, cornerRadius: 0 }, 'Corner radius'); }} />
            ); })}
          </div>
        )}
        <div className="seg wide rotseg">
          <button disabled={ro} title="Rotate 90°" aria-label="Rotate 90°" onClick={rotate90}><Icon n="rotate90" size={16} /></button>
          <button disabled title="Flip horizontal is not implemented (the transform model has no mirroring yet)"><Icon n="flipH" size={16} /></button>
          <button disabled title="Flip vertical is not implemented (the transform model has no mirroring yet)"><Icon n="flipV" size={16} /></button>
        </div>
        {parentLayout && <label className="check"><input type="checkbox" disabled={ro} checked={nodes.every(n => !!n.absolute)} onChange={e => commit({ absolute: e.target.checked || undefined }, 'Absolute position')} /> Ignore auto layout (absolute position)</label>}
        {single && ['FRAME', 'COMPONENT'].includes(single.type) && (
          <Select aria-label="Resize to preset" value="" disabled={ro} onChange={e => { const p = FRAME_PRESETS.flatMap(g => g.items).find(i => `${i.name}|${i.w}x${i.h}` === e.target.value); if (p) { setSize('w', p.w); setSize('h', p.h); } }}>
            <option value="">Resize to preset…</option>
            {FRAME_PRESETS.map(g => <optgroup key={g.id} label={g.label}>{g.items.map(i => <option key={i.name + i.w} value={`${i.name}|${i.w}x${i.h}`}>{i.name} — {i.w}×{i.h}</option>)}</optgroup>)}
          </Select>
        )}
      </Section>

      {frameLike && (
        <Section title="Auto layout" actions={
          <button className={'icon-btn alon' + (hasLayout ? ' on' : '')} disabled={ro} aria-pressed={hasLayout} aria-label={hasLayout ? 'Remove auto layout' : 'Add auto layout'} title={hasLayout ? 'Remove auto layout' : `Add auto layout (${act('layout.add').shortcut})`}
            onClick={() => (hasLayout ? removeAutoLayout(store, ids) : act('layout.add').run())}><Icon n="autoOn" size={20} /></button>}>
          <div className="alrow">
            <div className="seg4 alseg" role="group" aria-label="Layout mode">
              <button className={!hasLayout ? 'on' : ''} disabled={ro} title="Freeform (no auto layout)" aria-label="Freeform" onClick={() => removeAutoLayout(store, ids)}><Icon n="free" size={20} /></button>
              <button className={L?.mode === 'VERTICAL' ? 'on' : ''} disabled={ro} title="Vertical auto layout" aria-label="Vertical layout" onClick={() => { if (!hasLayout) { const f = addAutoLayout(store, ids); if (f) setLayout(store, [f], { mode: 'VERTICAL' }); } else setLayout(store, ids, { mode: 'VERTICAL' }); }}><Icon n="vertical" size={20} /></button>
              <button className={L?.mode === 'HORIZONTAL' ? 'on' : ''} disabled={ro} title="Horizontal auto layout" aria-label="Horizontal layout" onClick={() => { if (!hasLayout) { const f = addAutoLayout(store, ids); if (f) setLayout(store, [f], { mode: 'HORIZONTAL' }); } else setLayout(store, ids, { mode: 'HORIZONTAL' }); }}><Icon n="horizontal" size={20} /></button>
              <button disabled title="Grid layout is not implemented"><Icon n="grid" size={20} /></button>
            </div>
            <button className="icon-btn sidebtn" disabled title="Wrapping is not implemented"><Icon n="wrap" size={20} /></button>
          </div>
          <div className="alrow">
            <div className="grid2 wh grow">
              <div className="whf"><NumberField label="W" value={w} min={1} disabled={ro} onCommit={v => setSize('w', v)} />{sizeMenu('H')}</div>
              <div className="whf"><NumberField label="H" value={isLineAll ? 0 : h} min={1} disabled={ro || isLineAll} onCommit={v => setSize('h', v)} />{sizeMenu('V')}</div>
            </div>
            <button className="icon-btn sidebtn" disabled={ro || !hasLayout} aria-label="Hug contents" title="Resize to fit content (hug) — needs auto layout" onClick={() => { setSizing(store, ids, 'H', 'HUG'); setSizing(store, ids, 'V', 'HUG'); }}><Icon n="hug" size={20} /></button>
          </div>
          {L && layoutStyled && <StyleChip session={session} ids={ids} type="LAYOUT" ro={ro} />}
          {L && (
            <div className="autolayout" style={layoutStyled ? { opacity: .55, pointerEvents: 'none' } : undefined}>
              <div className="alrow top">
                <div className="agrid3" role="group" aria-label="Alignment">{[0, 1, 2].flatMap(r => [0, 1, 2].map(c => alignCell(c, r)))}</div>
                <div className="gapcol">
                  <div className="gapfield">
                    <Bindable session={session} ids={ids} path="layout.gap" ro={ro}><NumberField label={<Icon n="gap" size={16} />} title="Gap between items" value={L.gap} min={0} disabled={ro} onCommit={v => setLayout(store, ids, { gap: v })} /></Bindable>
                    <Select className="sizing chevsel" aria-label="Distribution" title="Distribution: packed or space between" value={L.primaryAlign === 'SPACE_BETWEEN' ? 'SPACE_BETWEEN' : 'PACKED'} disabled={ro} onChange={e => setLayout(store, ids, { primaryAlign: e.target.value === 'SPACE_BETWEEN' ? 'SPACE_BETWEEN' : 'MIN' })}><option value="PACKED">Gap: packed</option><option value="SPACE_BETWEEN">Gap: auto (space between)</option></Select>
                  </div>
                </div>
                <StyleMenuButton session={session} ids={ids} type="LAYOUT" ro={ro} />
              </div>
              <div className="alrow">
                <div className="grid2 grow">
                  {!indep ? <>
                    <NumberField label={<Icon n="padH" size={16} />} title="Horizontal padding" value={L.padL === L.padR ? L.padL : null} min={0} disabled={ro} onCommit={v => setLayout(store, ids, { padL: v, padR: v })} />
                    <NumberField label={<Icon n="padV" size={16} />} title="Vertical padding" value={L.padT === L.padB ? L.padT : null} min={0} disabled={ro} onCommit={v => setLayout(store, ids, { padT: v, padB: v })} />
                  </> : (['padL', 'padT', 'padR', 'padB'] as const).map(k => <Bindable key={k} session={session} ids={ids} path={`layout.${k}`} ro={ro}><NumberField label={k[3]} title={`Padding ${k.slice(3)}`} value={L[k]} min={0} disabled={ro} onCommit={v => setLayout(store, ids, { [k]: v })} /></Bindable>)}
                </div>
                <button className={'icon-btn sidebtn' + (indep ? ' on' : '')} aria-label="Independent padding" title="Independent padding" aria-pressed={indep} onClick={() => setIndep(!indep)}><Icon n="padAll" size={20} /></button>
              </div>
            </div>
          )}
        {nodes.every(n => ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(n.type)) && <label className="check"><input type="checkbox" disabled={ro} checked={nodes.every(n => n.clipsContent)} onChange={e => commit({ clipsContent: e.target.checked })} /> Clip content</label>}
        </Section>
      )}

      <Section title="Appearance" actions={<>
        <VarMenuButton session={session} ids={ids} path="visible" ro={ro} />
        <IBtn icon={cm(n => n.visible).mixed || nodes[0].visible ? 'eye' : 'eyeOff'} title="Toggle visibility" disabled={ro || !!boundVisible} onClick={act('arrange.hide').run} />
        <IBtn icon="drop" title={`Blend mode: ${cm(n => n.blendMode).mixed ? 'mixed' : BLEND_LABEL[nodes[0].blendMode].toLowerCase()}`} disabled={ro} onClick={e => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const cur = cm(n => n.blendMode);
          const items = BLEND_GROUPS.flatMap((g, gi) => [...(gi ? [{ label: '', separator: true }] : []), ...g.map(b => ({ label: BLEND_LABEL[b], checked: !cur.mixed && nodes[0].blendMode === b, run: () => commit({ blendMode: b }, 'Blend mode') }))]);
          set({ menu: { x: Math.min(r.left - 120, window.innerWidth - 240), y: r.bottom + 4, items } });
        }} />
      </>}>
        <div className="approw one">
          <Bindable session={session} ids={ids} path="opacity" ro={ro}><NumberField label={<Icon n="drop" size={13} />} title="Layer opacity" suffix="%" value={cm(n => n.opacity).mixed ? null : Math.round(nodes[0].opacity * 100)} min={0} max={100} disabled={ro} onCommit={v => commit({ opacity: v / 100 })} /></Bindable>
        </div>
        {frameLike && modeCols.map(c => (
          <label className="vrow" key={c.id} title="Variable mode used by this frame and everything inside it"><span className="muted ell">{c.name}</span>
            <Select value={cm(n => n.modeOverrides?.[c.id] ?? '').mixed ? '' : (nodes[0].modeOverrides?.[c.id] ?? '')} disabled={ro} aria-label={`${c.name} mode`} onChange={e => setNodeMode(store, ids, c.id, e.target.value || undefined)}>
              <option value="">Auto (inherit)</option>{c.modes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select></label>
        ))}
      </Section>

      {anyText && (<>
        <Section title="Typography" actions={<StyleMenuButton session={session} ids={ids.filter(i => store.doc.nodes[i].type === 'TEXT')} type="TEXT" ro={ro} />}>
          <TypographySection session={session} ids={ids} api={{ nodes, tset, ro, styled: textStyled }} open={!!typeSet} onSettings={r => setTypeSet(typeSet ? null : r)} />
          <Select aria-label="Text resizing" value={tv('resize').mixed ? '' : tv('resize').value} disabled={ro} onChange={e => tset({ resize: e.target.value as TextProps['resize'] })}>
            {tv('resize').mixed && <option value="">Mixed</option>}<option value="AUTO_WIDTH">Auto width</option><option value="AUTO_HEIGHT">Auto height</option><option value="FIXED">Fixed size</option>
          </Select>
          {hasText && single && <Bindable session={session} ids={ids} path="text.characters" ro={ro}><textarea className="textarea" aria-label="Text content" disabled={ro} value={single.text!.characters} rows={3} onChange={e => tset({ characters: e.target.value })} /></Bindable>}
        </Section>
        {typeSet && <TypeSettings anchor={typeSet} api={{ nodes, tset, ro, styled: textStyled }} onClose={() => setTypeSet(null)} />}
      </>)}

      {canFill && (
        <Section title="Fill" actions={<><StyleMenuButton session={session} ids={ids} type="FILL" which="fill" ro={ro} /><IBtn icon="plus" title="Add fill" disabled={ro} onClick={() => commit({ fills: fills.mixed ? [solid('#D9D9D9')] : [...fills.value, solid('#D9D9D9')] }, 'Add fill')} /></>} empty={!fills.mixed && fills.value.length === 0}>
          {isStyled(nodes, 'FILL', 'fill') ? <StyleChip session={session} ids={ids} type="FILL" which="fill" ro={ro} /> : fills.mixed ? <div className="muted pad0">Mixed fills — “+” replaces them.</div> : fills.value.map((_, i) => paintRow('fills', fills.value, i, l => commit({ fills: l }, 'Edit fill')))}
          {hasImage && !fills.mixed && single && <>
            <button className="btn small" disabled={ro} onClick={() => fileInput.current?.click()}>Replace image…</button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void session.replaceImage(ids, f); e.target.value = ''; }} />
          </>}
        </Section>
      )}
      {canStroke && (<>
        <Section title="Stroke" actions={<><StyleMenuButton session={session} ids={ids} type="FILL" which="stroke" ro={ro} /><IBtn icon="plus" title="Add stroke" disabled={ro} onClick={() => commit({ strokes: strokes.mixed ? [solid('#000000')] : [...strokes.value, solid('#000000')] }, 'Add stroke')} /></>} empty={!strokes.mixed && strokes.value.length === 0}>
          {isStyled(nodes, 'FILL', 'stroke') ? <StyleChip session={session} ids={ids} type="FILL" which="stroke" ro={ro} /> : strokes.mixed ? <div className="muted pad0">Mixed strokes — “+” replaces them.</div> : <>
            {strokes.value.map((_, i) => paintRow('strokes', strokes.value, i, l => commit({ strokes: l }, 'Edit stroke')))}
            {strokes.value.length > 0 && (
              <div className="strokerow">
                {!isLineAll && !nodes.some(n => n.type === 'VECTOR') && <Select aria-label="Stroke position" value={cm(n => n.strokeAlign).mixed ? '' : nodes[0].strokeAlign} disabled={ro} onChange={e => commit({ strokeAlign: e.target.value as 'INSIDE' })}><option value="INSIDE">Inside</option><option value="CENTER">Center</option><option value="OUTSIDE">Outside</option></Select>}
                <Bindable session={session} ids={ids} path="strokeWeight" ro={ro}><NumberField label={<Icon n="strokeWeight" size={13} />} title="Stroke weight" value={cm(n => n.strokeWeight).mixed ? null : nodes[0].strokeWeight} min={0} disabled={ro} onCommit={v => commit({ strokeWeight: v })} /></Bindable>
                <button className={'icon-btn strokebtn' + (strokeSet ? ' on' : '')} aria-label="Stroke settings" title="Stroke settings" aria-expanded={!!strokeSet} onClick={e => setStrokeSet(strokeSet ? null : (e.currentTarget as HTMLElement).getBoundingClientRect())}><Icon n="strokeSettings" size={16} /></button>
              </div>
            )}
          </>}
        </Section>
        {strokeSet && nodes.length > 0 && <StrokeSettings anchor={strokeSet} nodes={nodes} ro={ro} commit={commit} onClose={() => setStrokeSet(null)} />}
      </>)}
      {!nodes.every(n => n.type === 'GROUP') && (
        <Section title="Effects" actions={<><StyleMenuButton session={session} ids={ids} type="EFFECT" ro={ro} /><IBtn icon="plus" title="Add effect"disabled={ro} onClick={() => commit({ effects: effects.mixed ? [] : [...effects.value, { type: 'DROP_SHADOW', x: 0, y: 4, blur: 8, color: '#000000', opacity: 0.25, visible: true }] }, 'Add effect')} /></>} empty={!effects.mixed && effects.value.length === 0}>
          {isStyled(nodes, 'EFFECT') ? <StyleChip session={session} ids={ids} type="EFFECT" ro={ro} /> : effects.mixed ? <div className="muted pad0">Mixed effects.</div> : effects.value.map((_, i) => effRow(effects.value, i, l => commit({ effects: l }, 'Edit effect')))}
        </Section>
      )}
      {colors.length > 0 && (
        <Section title="Selection colors" actions={<span className="swatches">{colors.slice(0, 5).map(c => <label key={c} className="swatch" title={`Change ${c} everywhere in the selection`} style={{ background: c }}><input type="color" value={c.toLowerCase()} disabled={ro} onChange={e => recolor(c, e.target.value.toUpperCase())} /></label>)}{colors.length > 5 && <span className="muted">+{colors.length - 5}</span>}</span>} />
      )}
      {nodes.every(n => n.type === 'VECTOR') && single && single.path && (
        <Section title="Vector">
          <div className="row"><button className="btn grow" disabled={ro} onClick={act('vec.edit').run}>Edit path ↵</button><button className="btn grow" disabled={ro} onClick={() => togglePathClosed(store, single.id)}>{single.path.closed ? 'Open path' : 'Close path'}</button></div>
          <div className="muted small">{single.path.points.length} anchors · double-click an anchor to switch smooth/corner · click the outline to add one · ⌫ deletes.</div>
        </Section>
      )}
      {frameLike && (
        <Section title="Layout guide" actions={<IBtn icon="plus" title="Add layout guide" disabled={ro} onClick={() => commit({ guides: [...(nodes[0].guides ?? []), { type: 'GRID', size: 10, gutter: 0, margin: 0, color: '#FF0000', opacity: 0.1, visible: true }] }, 'Add layout guide')} />} empty={!(nodes[0].guides ?? []).length}>
          {(nodes[0].guides ?? []).map((g, i) => {
            const list = nodes[0].guides ?? [];
            const upd = (patch: Partial<LayoutGuide>) => commit({ guides: list.map((x, j) => (j === i ? { ...x, ...patch } : x)) }, 'Edit layout guide');
            return (
              <div className="stack" key={i}>
                <div className="row">
                  <Select className="grow" value={g.type} disabled={ro} aria-label="Guide type" onChange={e => { const t = e.target.value as LayoutGuide['type']; upd(t === 'GRID' ? { type: t, size: 10 } : { type: t, size: 4, gutter: 20, margin: 0, opacity: 0.1 }); }}><option value="GRID">Grid</option><option value="COLUMNS">Columns</option><option value="ROWS">Rows</option></Select>
                  <IBtn icon={g.visible ? 'eye' : 'eyeOff'} title="Toggle guide" disabled={ro} onClick={() => upd({ visible: !g.visible })} />
                  <IBtn icon="minus" title="Remove guide" disabled={ro} onClick={() => commit({ guides: list.filter((_, j) => j !== i) }, 'Remove layout guide')} />
                </div>
                <div className="grid2">
                  <NumberField label={g.type === 'GRID' ? 'Sz' : '#'} title={g.type === 'GRID' ? 'Cell size' : 'Count'} value={g.size} min={1} disabled={ro} onCommit={v => upd({ size: Math.round(v) || 1 })} />
                  {g.type !== 'GRID' && <NumberField label="G" title="Gutter" value={g.gutter} min={0} disabled={ro} onCommit={v => upd({ gutter: v })} />}
                  {g.type !== 'GRID' && <NumberField label="M" title="Margin" value={g.margin} min={0} disabled={ro} onCommit={v => upd({ margin: v })} />}
                  <ColorField color={g.color} disabled={ro} onChange={c => upd({ color: c })} />
                </div>
              </div>
            );
          })}
        </Section>
      )}
      <ExportSection session={session} nodes={nodes} ro={ro} />
      <PreviewSection session={session} ids={ids} />
    </div>
  );
}

function ExportSection({ session, nodes, ro }: { session: EditorSession; nodes: SceneNode[]; ro: boolean }) {
  const store = session.store;
  const first = nodes[0];
  const list = first.exportSettings;
  const write = (l: ExportSetting[]) => setProps(store, nodes.map(n => n.id), { exportSettings: l }, 'Edit export settings');
  const name = nodes.length === 1 ? first.name : `${nodes.length} layers`;
  return (
    <Section title="Export" actions={<IBtn icon="plus" title="Add export setting" disabled={ro} onClick={() => write([...list, { format: 'PNG', scale: 1, suffix: '' }])} />} empty={!list.length}>
      {list.map((s, i) => (
        <div className="row" key={i}>
          <Select title="Scale" value={s.scale} disabled={ro} onChange={e => write(list.map((x, j) => (j === i ? { ...x, scale: Number(e.target.value), suffix: Number(e.target.value) === 1 ? '' : `@${e.target.value}x` } : x)))}>{[0.5, 1, 2, 3, 4].map(v => <option key={v} value={v}>{v}x</option>)}</Select>
          <Select className="grow" title="Format" value={s.format} disabled={ro} onChange={e => write(list.map((x, j) => (j === i ? { ...x, format: e.target.value as ExportSetting['format'] } : x)))}><option>PNG</option><option>JPG</option><option>WEBP</option></Select>
          <IBtn icon="minus" title="Remove" disabled={ro} onClick={() => write(list.filter((_, j) => j !== i))} />
        </div>
      ))}
      <button className="btn wide" onClick={async () => { if (!list.length) return useEditor.getState().set({ exportOpen: true }); for (const s of list) await session.exportSelection(s); }}>Export {name}</button>
    </Section>
  );
}

function PreviewSection({ session, ids }: { session: EditorSession; ids: string[] }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const version = useSyncExternalStore(session.store.subscribe.bind(session.store), () => session.store.version);
  useEffect(() => {
    if (!open || !host.current) return;
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const c = await renderNodes(session.store.doc, ids.filter(i => session.store.doc.nodes[i]), session.images, 1);
        if (dead || !host.current) return;
        c.style.maxWidth = '100%'; c.style.maxHeight = '220px'; c.style.objectFit = 'contain';
        host.current.replaceChildren(c);
      } catch { /* preview is best effort */ }
    }, 150);
    return () => { dead = true; clearTimeout(t); };
  }, [open, version, ids.join(',')]);
  return (
    <div className="preview">
      <button className="prev-toggle" onClick={() => setOpen(!open)} aria-expanded={open}><Icon n={open ? 'chevD' : 'chevR'} size={12} /> Preview</button>
      {open && <div ref={host} className="prev-box" />}
    </div>
  );
}
void DEFAULT_LAYOUT; void ({} as AutoLayout);
