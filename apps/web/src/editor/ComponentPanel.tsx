import { useState } from 'react';
import {
  createComponentSet, addComponentProp, addVariant, addVariantProperty, bindLayerProp, enclosingComponent, enclosingInstance, propDefsFor, removeComponentProp, removeVariantProperty,
  renameVariantProperty, resetPropValue, setInstanceVariant, setPropValue, setVariantValue, variantProperties, type PropDef, type SceneNode,
} from '@layr/core';
import type { EditorSession } from './session';
import { useEditor } from './state';
import { Icon } from '../icons';
import { Select } from '../ui/Select';

/** Variants + component property controls. Rendered for a single selected node. */
export function ComponentPanel({ session, node, ro }: { session: EditorSession; node: SceneNode; ro: boolean }) {
  const store = session.store, doc = store.doc;
  const toast = useEditor(s => s.toast);
  const [newProp, setNewProp] = useState('');
  const [newType, setNewType] = useState<PropDef['type']>('TEXT');
  const [newVar, setNewVar] = useState('');
  const comps = Object.values(doc.nodes).filter(n => n.type === 'COMPONENT');

  const propsEditor = (ownerId: string) => {
    const defs = doc.nodes[ownerId].props ?? [];
    const upd = (name: string, patch: Partial<PropDef>) => store.transact('Edit component property', () => store.apply({ t: 'set', id: ownerId, props: { props: defs.map(d => (d.name === name ? { ...d, ...patch } : d)) } }));
    return (
      <section className="isec">
        <div className="isec-head"><h4>Properties</h4></div>
        {defs.map(d => (
          <div className="stack" key={d.name}>
            <div className="row">
              <span className="ptag" title={d.type}>{d.type === 'TEXT' ? 'T' : d.type === 'BOOLEAN' ? '◐' : '◇'}</span>
              <b className="grow ell">{d.name}</b>
              <button className="icon-btn" disabled={ro} title="Remove property" onClick={() => removeComponentProp(store, ownerId, d.name)}><Icon n="minus" size={14} /></button>
            </div>
            {d.type === 'TEXT' && <input value={String(d.default)} disabled={ro} onChange={e => upd(d.name, { default: e.target.value })} aria-label={`${d.name} default`} />}
            {d.type === 'BOOLEAN' && <label className="check"><input type="checkbox" disabled={ro} checked={d.default === true} onChange={e => upd(d.name, { default: e.target.checked })} /> Default on</label>}
            {d.type === 'INSTANCE_SWAP' && <Select value={String(d.default)} disabled={ro} onChange={e => upd(d.name, { default: e.target.value })}>{comps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
          </div>
        ))}
        <div className="row">
          <input className="grow" placeholder="New property name" value={newProp} disabled={ro} onChange={e => setNewProp(e.target.value)} />
          <Select value={newType} disabled={ro} onChange={e => setNewType(e.target.value as PropDef['type'])}><option value="TEXT">Text</option><option value="BOOLEAN">Boolean</option><option value="INSTANCE_SWAP">Instance swap</option></Select>
          <button className="icon-btn" disabled={ro || !newProp.trim()} title="Add property" aria-label="Add component property" onClick={() => {
            const def: PropDef = newType === 'TEXT' ? { name: newProp.trim(), type: 'TEXT', default: 'Text' } : newType === 'BOOLEAN' ? { name: newProp.trim(), type: 'BOOLEAN', default: true } : { name: newProp.trim(), type: 'INSTANCE_SWAP', default: comps[0]?.id ?? '' };
            if (def.type === 'INSTANCE_SWAP' && !def.default) return toast('Create another component to swap with first', 'error');
            if (addComponentProp(store, ownerId, def)) setNewProp(''); else toast('A property with that name already exists', 'error');
          }}><Icon n="plus" size={14} /></button>
        </div>
      </section>
    );
  };

  // ---- component set ----
  if (node.type === 'COMPONENT_SET') {
    const vp = variantProperties(doc, node.id);
    return <>
      <section className="isec">
        <div className="isec-head"><h4>Variants</h4><span className="isec-actions"><button className="icon-btn" disabled={ro} title="Add variant" aria-label="Add variant" onClick={() => addVariant(store, node.id)}><Icon n="plus" size={16} /></button></span></div>
        {vp.map(p => (
          <div className="stack" key={p.name}>
            <div className="row">
              <input className="grow" defaultValue={p.name} disabled={ro} aria-label="Variant property name" onBlur={e => { if (e.target.value !== p.name && !renameVariantProperty(store, node.id, p.name, e.target.value)) { e.target.value = p.name; toast('Name is empty or already used', 'error'); } }} />
              <button className="icon-btn" disabled={ro || vp.length < 2} title="Remove variant property" onClick={() => removeVariantProperty(store, node.id, p.name)}><Icon n="minus" size={14} /></button>
            </div>
            <div className="muted small">{p.values.join(' · ')}</div>
          </div>
        ))}
        <div className="row">
          <input className="grow" placeholder="New variant property" value={newVar} disabled={ro} onChange={e => setNewVar(e.target.value)} />
          <button className="icon-btn" disabled={ro || !newVar.trim()} title="Add variant property" aria-label="Add variant property" onClick={() => { if (addVariantProperty(store, node.id, newVar.trim())) setNewVar(''); else toast('Name is empty or already used', 'error'); }}><Icon n="plus" size={14} /></button>
        </div>
        <div className="muted small">{node.children.length} variants · select one to rename its values.</div>
      </section>
      {propsEditor(node.id)}
    </>;
  }

  // ---- variant component inside a set ----
  const setNode = node.parent ? doc.nodes[node.parent] : undefined;
  if (node.type === 'COMPONENT' && setNode?.type === 'COMPONENT_SET') {
    const vp = variantProperties(doc, setNode.id);
    return (
      <section className="isec">
        <div className="isec-head"><h4>Variant</h4></div>
        {vp.map(p => (
          <label className="vrow" key={p.name}><span className="muted">{p.name}</span>
            <input key={node.variant?.[p.name]} defaultValue={node.variant?.[p.name] ?? ''} disabled={ro} list={`vals-${p.name}`} aria-label={`${p.name} value`}
              onBlur={e => { if (e.target.value !== node.variant?.[p.name] && !setVariantValue(store, node.id, p.name, e.target.value)) { e.target.value = node.variant?.[p.name] ?? ''; toast('Another variant already has that combination', 'error'); } }} />
          </label>
        ))}
        <div className="muted small">Properties are defined on the parent set.</div>
      </section>
    );
  }
  // ---- standalone component ----
  if (node.type === 'COMPONENT') {
    return <>
      <section className="isec"><div className="isec-head"><h4>Variants</h4></div>
        <button className="btn wide" disabled={ro} onClick={() => { const g = createComponentSet(store, [node.id]); if (g) useEditor.getState().set({ selection: [g] }); }}>Combine as variants</button></section>
      {propsEditor(node.id)}
    </>;
  }

  // ---- instance ----
  if (node.type === 'INSTANCE' && node.componentId && doc.nodes[node.componentId]) {
    const main = doc.nodes[node.componentId];
    const set = main.parent ? doc.nodes[main.parent] : undefined;
    const vp = set?.type === 'COMPONENT_SET' ? variantProperties(doc, set.id) : [];
    const defs = propDefsFor(doc, main.id);
    if (!vp.length && !defs.length) return null;
    return (
      <section className="isec">
        <div className="isec-head"><h4>Instance properties</h4></div>
        {vp.map(p => (
          <label className="vrow" key={p.name}><span className="muted">{p.name}</span>
            <Select value={main.variant?.[p.name] ?? ''} disabled={ro} onChange={e => setInstanceVariant(store, node.id, { [p.name]: e.target.value })}>{p.values.map(v => <option key={v}>{v}</option>)}</Select>
          </label>
        ))}
        {defs.map(d => {
          const v = node.propValues?.[d.name] ?? d.default;
          const explicit = node.propValues && d.name in node.propValues;
          return (
            <label className="vrow" key={d.name}><span className="muted ell" title={d.name}>{d.name}</span>
              <span className="row">
                {d.type === 'TEXT' && <input className="grow" value={String(v)} disabled={ro} onChange={e => setPropValue(store, node.id, d.name, e.target.value)} />}
                {d.type === 'BOOLEAN' && <input type="checkbox" checked={v === true} disabled={ro} onChange={e => setPropValue(store, node.id, d.name, e.target.checked)} />}
                {d.type === 'INSTANCE_SWAP' && <Select className="grow" value={String(v)} disabled={ro} onChange={e => setPropValue(store, node.id, d.name, e.target.value)}>{comps.filter(c => !enclosingComponent(doc, node.id) || c.id !== enclosingComponent(doc, node.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
                {explicit && <button className="icon-btn" title="Reset to default" disabled={ro} onClick={() => resetPropValue(store, node.id, d.name)}><Icon n="rotate90" size={13} /></button>}
              </span>
            </label>
          );
        })}
      </section>
    );
  }

  // ---- a layer inside a main component: bind attributes to properties ----
  const comp = enclosingComponent(doc, node.id);
  if (comp && !enclosingInstance(doc, node.id) && node.id !== comp) {
    const defs = propDefsFor(doc, comp);
    const opts = (t: PropDef['type']) => defs.filter(d => d.type === t);
    const row = (label: string, key: 'characters' | 'visible' | 'componentId', t: PropDef['type']) => (
      <label className="vrow" key={key}><span className="muted">{label}</span>
        <Select value={node.bind?.[key] ?? ''} disabled={ro} onChange={e => bindLayerProp(store, node.id, key, e.target.value || undefined)}>
          <option value="">Not linked</option>{opts(t).map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
        </Select>
      </label>
    );
    if (!defs.length) return null;
    return (
      <section className="isec"><div className="isec-head"><h4>Component properties</h4></div>
        {node.type === 'TEXT' && row('Text', 'characters', 'TEXT')}
        {row('Visibility', 'visible', 'BOOLEAN')}
        {node.type === 'INSTANCE' && row('Swap', 'componentId', 'INSTANCE_SWAP')}
      </section>
    );
  }
  return null;
}
