import { useState, useSyncExternalStore } from 'react';
import {
  DEVICES, ExprError, addInteraction, deviceSpec, evaluate, flows, newAction, newInteraction, removeInteraction, setFlowStart, setProps, topFrameOf, topFrames, updateInteraction,
  type Animation, type Easing, type Interaction, type ProtoAction, type SceneNode, type Trigger,
} from '@layr/core';
import { useEditor, storage } from './state';
import type { EditorSession } from './session';
import { Icon } from '../icons';
import { NumberField, ColorField } from './fields';
import { Select } from '../ui/Select';

const TRIGGERS: [Trigger['type'], string][] = [['CLICK', 'On click / tap'], ['DRAG', 'On drag'], ['HOVER', 'While hovering'], ['PRESS', 'While pressing'], ['MOUSE_ENTER', 'Mouse enter'], ['MOUSE_LEAVE', 'Mouse leave'], ['MOUSE_DOWN', 'Mouse down'], ['MOUSE_UP', 'Mouse up'], ['KEY', 'Key press'], ['DELAY', 'After delay']];
const ACTIONS: [ProtoAction['type'], string][] = [['NAVIGATE', 'Navigate to'], ['BACK', 'Back'], ['OVERLAY_OPEN', 'Open overlay'], ['OVERLAY_SWAP', 'Swap overlay'], ['OVERLAY_CLOSE', 'Close overlay'], ['SCROLL_TO', 'Scroll to'], ['CHANGE_TO', 'Change to (component)'], ['SET_VAR', 'Set variable'], ['CONDITIONAL', 'Conditional'], ['LINK', 'Open link']];
const ANIMS: [Animation['type'], string][] = [['INSTANT', 'Instant'], ['DISSOLVE', 'Dissolve'], ['SMART_ANIMATE', 'Smart animate'], ['MOVE_IN', 'Move in'], ['MOVE_OUT', 'Move out'], ['PUSH', 'Push'], ['SLIDE_IN', 'Slide in'], ['SLIDE_OUT', 'Slide out']];
const EASINGS: [string, string][] = [['LINEAR', 'Linear'], ['EASE_IN', 'Ease in'], ['EASE_OUT', 'Ease out'], ['EASE_IN_OUT', 'Ease in and out'], ['EASE_IN_BACK', 'Ease in back'], ['EASE_OUT_BACK', 'Ease out back'], ['EASE_IN_OUT_BACK', 'Ease in and out back'], ['SPRING', 'Spring'], ['CUSTOM', 'Custom bezier']];
const POSITIONS = ['CENTER', 'TOP_LEFT', 'TOP_CENTER', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_CENTER', 'BOTTOM_RIGHT', 'BELOW_TRIGGER'];
const DIR_TYPES = ['MOVE_IN', 'MOVE_OUT', 'PUSH', 'SLIDE_IN', 'SLIDE_OUT'];

function AnimEditor({ a, onChange, ro }: { a: Animation; onChange: (a: Animation) => void; ro: boolean }) {
  const easingKey = typeof a.easing === 'object' ? 'CUSTOM' : a.easing;
  const bez = typeof a.easing === 'object' ? a.easing.bezier : [0.25, 0.1, 0.25, 1];
  return (
    <div className="stack animed">
      <div className="grid2">
        <Select value={a.type} disabled={ro} aria-label="Animation" onChange={e => { const type = e.target.value as Animation['type']; onChange({ ...a, type, direction: DIR_TYPES.includes(type) ? a.direction ?? 'LEFT' : undefined, duration: type === 'INSTANT' ? 0 : a.duration || 300 }); }}>{ANIMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        {DIR_TYPES.includes(a.type) ? <Select value={a.direction ?? 'LEFT'} disabled={ro} aria-label="Direction" onChange={e => onChange({ ...a, direction: e.target.value as 'LEFT' })}><option value="LEFT">← Left</option><option value="RIGHT">→ Right</option><option value="TOP">↑ Top</option><option value="BOTTOM">↓ Bottom</option></Select> : <span />}
      </div>
      {a.type !== 'INSTANT' && <div className="grid2">
        <Select value={easingKey} disabled={ro} aria-label="Easing" onChange={e => onChange({ ...a, easing: e.target.value === 'CUSTOM' ? { bezier: bez as [number, number, number, number] } : (e.target.value as Easing) })}>{EASINGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <NumberField label="ms" title="Duration (ms)" value={a.duration} min={0} max={10000} disabled={ro} onCommit={v => onChange({ ...a, duration: Math.round(v) })} />
      </div>}
      {easingKey === 'CUSTOM' && <div className="grid4">{[0, 1, 2, 3].map(i => <NumberField key={i} title={`Bezier ${['x1', 'y1', 'x2', 'y2'][i]}`} label={['x1', 'y1', 'x2', 'y2'][i]} value={bez[i]} disabled={ro} onCommit={v => { const b = [...bez] as [number, number, number, number]; b[i] = i % 2 === 0 ? Math.min(1, Math.max(0, v)) : v; onChange({ ...a, easing: { bezier: b } }); }} />)}</div>}
    </div>
  );
}

function ActionEditor({ session, node, a, onChange, onRemove, ro, depth = 0 }: { session: EditorSession; node: SceneNode; a: ProtoAction; onChange: (a: ProtoAction) => void; onRemove: () => void; ro: boolean; depth?: number }) {
  const doc = session.store.doc;
  const pageId = doc.nodes[node.id] ? (() => { let c: SceneNode | undefined = node; while (c && c.type !== 'PAGE') c = c.parent ? doc.nodes[c.parent] : undefined; return c?.id ?? useEditor.getState().pageId; })() : useEditor.getState().pageId;
  const frames = topFrames(doc, pageId);
  const layers = Object.values(doc.nodes).filter(n => n.type !== 'PAGE' && n.type !== 'DOCUMENT' && topFrameOf(doc, n.id) && doc.nodes[topFrameOf(doc, n.id)!].parent === pageId);
  const comps = Object.values(doc.nodes).filter(n => n.type === 'COMPONENT');
  const vars = Object.values(doc.variables);
  const dest = (id: string | undefined, set: (v: string) => void, list: SceneNode[], label: string) => (
    <Select value={id ?? ''} disabled={ro} aria-label={label} onChange={e => set(e.target.value)}>
      <option value="">Select…</option>{list.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
      {id && !doc.nodes[id] && <option value={id}>⚠ missing</option>}
    </Select>
  );
  const exprState = (src: string) => { if (!src.trim()) return 'Enter an expression, e.g. {count} + 1'; try { evaluate(src, () => 0); return ''; } catch (e) { return e instanceof ExprError ? e.message : 'Invalid expression'; } };
  const body = (() => {
    switch (a.type) {
      case 'NAVIGATE': return <>{dest(a.to, to => onChange({ ...a, to }), frames, 'Destination frame')}<AnimEditor a={a.anim} ro={ro} onChange={anim => onChange({ ...a, anim })} /></>;
      case 'OVERLAY_OPEN': case 'OVERLAY_SWAP': return <>
        {dest(a.to, to => onChange({ ...a, to }), frames.filter(f => f.id !== topFrameOf(doc, node.id)), 'Overlay frame')}
        <div className="grid2"><Select value={a.position} disabled={ro} aria-label="Overlay position" onChange={e => onChange({ ...a, position: e.target.value as 'CENTER' })}>{POSITIONS.map(p => <option key={p} value={p}>{p.replace('_', ' ').toLowerCase()}</option>)}</Select><span /></div>
        <label className="check"><input type="checkbox" disabled={ro} checked={a.closeOnOutside} onChange={e => onChange({ ...a, closeOnOutside: e.target.checked })} /> Close when clicking outside</label>
        <label className="check"><input type="checkbox" disabled={ro} checked={a.backdrop} onChange={e => onChange({ ...a, backdrop: e.target.checked })} /> Add background behind overlay</label>
        <AnimEditor a={a.anim} ro={ro} onChange={anim => onChange({ ...a, anim })} /></>;
      case 'OVERLAY_CLOSE': return <>{dest(a.to, to => onChange({ ...a, to: to || undefined }), frames, 'Overlay to close (blank = this/top)')}<AnimEditor a={a.anim} ro={ro} onChange={anim => onChange({ ...a, anim })} /></>;
      case 'BACK': return <AnimEditor a={a.anim} ro={ro} onChange={anim => onChange({ ...a, anim })} />;
      case 'SCROLL_TO': return <>{dest(a.to, to => onChange({ ...a, to }), layers, 'Scroll target layer')}<AnimEditor a={a.anim} ro={ro} onChange={anim => onChange({ ...a, anim })} /></>;
      case 'CHANGE_TO': return <>
        {node.type !== 'INSTANCE' && <div className="muted small">Select a component instance — “Change to” only applies to instances.</div>}
        {dest(a.to, to => onChange({ ...a, to }), comps, 'Component to change to')}<AnimEditor a={a.anim} ro={ro} onChange={anim => onChange({ ...a, anim })} /></>;
      case 'SET_VAR': return <>
        <Select value={a.variableId} disabled={ro} aria-label="Variable" onChange={e => onChange({ ...a, variableId: e.target.value })}><option value="">Select variable…</option>{vars.map(v => <option key={v.id} value={v.id}>{doc.collections[v.collectionId]?.name}/{v.name} ({v.type.toLowerCase()})</option>)}</Select>
        <input value={a.expr} disabled={ro} aria-label="Expression" placeholder="e.g. {count} + 1  or  &quot;Hello&quot;" onChange={e => onChange({ ...a, expr: e.target.value })} />
        {exprState(a.expr) && <div className="error small">{exprState(a.expr)}</div>}</>;
      case 'LINK': return <><input value={a.url} disabled={ro} aria-label="URL" onChange={e => onChange({ ...a, url: e.target.value })} />{!/^(https?:|mailto:)/i.test(a.url) && <div className="error small">Only http, https and mailto links are allowed</div>}</>;
      case 'CONDITIONAL': return (
        <div className="cond">
          {a.branches.map((b, i) => (
            <div key={i} className="branch">
              <div className="row"><b className="small">{i === 0 ? 'If' : 'Else if'}</b><input className="grow" value={b.cond} disabled={ro} aria-label="Condition" placeholder="{count} >= 3" onChange={e => onChange({ ...a, branches: a.branches.map((x, j) => (j === i ? { ...x, cond: e.target.value } : x)) })} />
                <button className="icon-btn" disabled={ro || a.branches.length < 2} title="Remove branch" onClick={() => onChange({ ...a, branches: a.branches.filter((_, j) => j !== i) })}><Icon n="minus" size={13} /></button></div>
              {exprState(b.cond) && <div className="error small">{exprState(b.cond)}</div>}
              <ActionList session={session} node={node} actions={b.actions} ro={ro} depth={depth + 1} onChange={actions => onChange({ ...a, branches: a.branches.map((x, j) => (j === i ? { ...x, actions } : x)) })} />
            </div>
          ))}
          <button className="btn small" disabled={ro} onClick={() => onChange({ ...a, branches: [...a.branches, { cond: 'true', actions: [] }] })}>+ Else if</button>
          <div className="branch"><b className="small">Else</b><ActionList session={session} node={node} actions={a.otherwise} ro={ro} depth={depth + 1} onChange={otherwise => onChange({ ...a, otherwise })} /></div>
        </div>);
    }
  })();
  return (
    <div className="actioned">
      <div className="row">
        <Select className="grow" value={a.type} disabled={ro} aria-label="Action" onChange={e => onChange(newAction(e.target.value as ProtoAction['type'], ''))}>{ACTIONS.filter(([k]) => depth < 2 || k !== 'CONDITIONAL').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <button className="icon-btn" disabled={ro} title="Remove action" aria-label="Remove action" onClick={onRemove}><Icon n="minus" size={14} /></button>
      </div>
      {body}
    </div>
  );
}

function ActionList({ session, node, actions, onChange, ro, depth = 0 }: { session: EditorSession; node: SceneNode; actions: ProtoAction[]; onChange: (a: ProtoAction[]) => void; ro: boolean; depth?: number }) {
  return <div className="stack">
    {actions.map((a, i) => <ActionEditor key={i} session={session} node={node} a={a} ro={ro} depth={depth} onChange={na => onChange(actions.map((x, j) => (j === i ? na : x)))} onRemove={() => onChange(actions.filter((_, j) => j !== i))} />)}
    <button className="btn small" disabled={ro} onClick={() => onChange([...actions, newAction('NAVIGATE', '')])}>+ Add action</button>
  </div>;
}

function KeyCapture({ value, onChange, ro }: { value: string; onChange: (k: string) => void; ro: boolean }) {
  return <input readOnly disabled={ro} value={value} placeholder="Press a key…" aria-label="Key" onKeyDown={e => { e.preventDefault(); e.stopPropagation(); onChange(e.key); }} />;
}

export function PrototypePanel({ session, onPresent }: { session: EditorSession; onPresent: () => void }) {
  const store = session.store;
  useSyncExternalStore(store.subscribe.bind(store), () => store.version);
  const selection = useEditor(s => s.selection);
  const set = useEditor(s => s.set);
  const pageId = useEditor(s => s.pageId);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const doc = store.doc, ro = !session.canEdit;
  const node = selection.length === 1 ? doc.nodes[selection[0]] : null;
  const page = doc.nodes[pageId];
  const flowList = flows(doc).filter(f => f.pageId === pageId);
  const isTopFrame = !!node && node.parent === pageId && ['FRAME', 'COMPONENT', 'COMPONENT_SET'].includes(node.type);

  const settings = page?.proto ?? { device: 'NONE', background: '#1e1e1e' };
  const spec = deviceSpec(settings.device);
  const [tips, setTips] = useState<Record<string, boolean>>(() => { try { return JSON.parse(storage.get('layr:protoTips', '{}')); } catch { return {}; } });
  const dismiss = (k: string) => { const n = { ...tips, [k]: true }; setTips(n); storage.set('layr:protoTips', JSON.stringify(n)); };
  const upd = (i: Interaction, patch: Partial<Interaction>) => updateInteraction(store, node!.id, i.id, patch);
  const setTrigger = (i: Interaction, t: Trigger) => upd(i, { trigger: t });

  return (
    <div className="ibody proto-panel">
      {!node && selection.length > 1 && <section className="isec"><div className="muted">Select a single layer to edit its interactions.</div></section>}
      {isTopFrame && (
        <section className="isec">
          <div className="isec-head"><h4>Flow starting point</h4><span className="isec-actions">{node!.flowStart === undefined && <button className="icon-btn" disabled={ro} title="Add flow starting point" aria-label="Add flow starting point" onClick={() => setFlowStart(store, node!.id, `Flow ${flows(doc).length + 1}`)}><Icon n="plus" size={16} /></button>}</span></div>
          {node!.flowStart !== undefined && <div className="row"><span className="ptag">▶</span><input className="grow" aria-label="Flow name" defaultValue={node!.flowStart} disabled={ro} key={node!.flowStart} onBlur={e => e.target.value.trim() && setFlowStart(store, node!.id, e.target.value.trim())} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} /><button className="icon-btn" disabled={ro} title="Remove starting point" onClick={() => setFlowStart(store, node!.id, undefined)}><Icon n="minus" size={14} /></button></div>}
          <label className="vrow"><span className="muted">Scrolling</span><Select value={node!.overflowScroll ?? 'NONE'} disabled={ro} aria-label="Overflow scrolling" onChange={e => setProps(store, [node!.id], { overflowScroll: e.target.value as 'NONE' }, 'Overflow scrolling')}><option value="NONE">No scrolling</option><option value="VERTICAL">Vertical</option><option value="HORIZONTAL">Horizontal</option><option value="BOTH">Both</option></Select></label>
        </section>
      )}
      {node && (
        <section className="isec">
          <div className="isec-head"><h4>Interactions</h4><span className="isec-actions"><button className="icon-btn" disabled={ro} title="Add interaction" aria-label="Add interaction" onClick={() => { const id = addInteraction(store, node.id); setOpen({ ...open, [id]: true }); }}><Icon n="plus" size={16} /></button></span></div>
          {!(node.interactions ?? []).length && <div className="muted small">Drag the blue handle on the canvas to another frame to connect, or press + to add an interaction.</div>}
          {(node.interactions ?? []).map(i => {
            const isOpen = open[i.id] ?? true;
            return (
              <div className="intbox" key={i.id}>
                <div className="row">
                  <button className="icon-btn" onClick={() => setOpen({ ...open, [i.id]: !isOpen })} aria-label="Toggle interaction"><Icon n={isOpen ? 'chevD' : 'chevR'} size={12} /></button>
                  <Select className="grow" value={i.trigger.type} disabled={ro} aria-label="Trigger" onChange={e => setTrigger(i, { type: e.target.value as Trigger['type'], key: e.target.value === 'KEY' ? i.trigger.key ?? '' : undefined, delay: e.target.value === 'DELAY' ? i.trigger.delay ?? 800 : undefined })}>{TRIGGERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                  <button className="icon-btn" disabled={ro} title="Remove interaction" aria-label="Remove interaction" onClick={() => removeInteraction(store, node.id, i.id)}><Icon n="minus" size={14} /></button>
                </div>
                {isOpen && <>
                  {i.trigger.type === 'KEY' && <KeyCapture value={i.trigger.key ?? ''} ro={ro} onChange={key => setTrigger(i, { ...i.trigger, key })} />}
                  {i.trigger.type === 'DELAY' && <NumberField label="ms" title="Delay in milliseconds" value={i.trigger.delay ?? 0} min={0} max={600000} disabled={ro} onCommit={v => setTrigger(i, { ...i.trigger, delay: Math.round(v) })} />}
                  <ActionList session={session} node={node} actions={i.actions} ro={ro} onChange={actions => upd(i, { actions })} />
                </>}
              </div>
            );
          })}
        </section>
      )}
      <section className="isec">
        <div className="isec-head"><h4>Prototype settings</h4></div>
        <Select className="fullsel" value={spec ? spec.id : 'NONE'} disabled={ro} aria-label="Prototype device" onChange={e => setProps(store, [pageId], { proto: { ...settings, device: e.target.value } }, 'Prototype device')}>
          <option value="NONE">No device</option>
          {(['Phone', 'Tablet', 'Laptop', 'Desktop'] as const).map(g => <optgroup key={g} label={g}>{DEVICES.filter(d => d.group === g).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</optgroup>)}
        </Select>
        {spec && <div className="devinfo"><span>Screen {spec.screen.w} × {spec.screen.h}</span>{isTopFrame && <button className="btn small" disabled={ro} onClick={() => setProps(store, [node!.id], { width: spec.screen.w, height: spec.screen.h }, 'Resize frame to device')}>Resize frame to fit</button>}</div>}
        <div className="bgrow"><ColorField color={settings.background} disabled={ro} onChange={c => setProps(store, [pageId], { proto: { ...settings, background: c } }, 'Prototype background')} /></div>
      </section>
      <section className="isec">
        <div className="isec-head"><h4>Flows</h4></div>
        {!flowList.length && <div className="muted small">No flow starting points on this page. Select a top-level frame and add one.</div>}
        <div className="flowlist">{flowList.map(f => <button key={f.frameId} className="flowitem" title={doc.nodes[f.frameId].name} onClick={() => set({ selection: [f.frameId] })}>{f.name}</button>)}</div>
      </section>
      {!tips.connection && <section className="tip">
        <div className="tip-head"><h4>Removing a connection</h4><button className="icon-btn" aria-label="Dismiss tip" onClick={() => dismiss('connection')}><Icon n="close" size={16} /></button></div>
        <div className="tip-body"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 4H4v16h3M4 12h2.500" /><circle cx="8.500" cy="12" r="2" /><path d="M14 10l5 5M19 10l-5 5" /></svg><span>To delete a connection, click and drag on either end.</span></div>
      </section>}
      {!tips.run && <section className="tip">
        <div className="tip-head"><h4>Running your prototype</h4><button className="icon-btn" aria-label="Dismiss tip" onClick={() => dismiss('run')}><Icon n="close" size={16} /></button></div>
        <div className="tip-body"><Icon n="play" size={22} /><span>Use the play button in the toolbar to play your prototype. If there are no connections, the play button can be used to play a presentation of your frames.</span></div>
      </section>}
    </div>
  );
}
