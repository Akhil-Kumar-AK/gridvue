import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  TokenError, addMode, createCollection, createVariable, deleteCollection, deleteVariable, exportTokens, fromDtcg, importTokens, looksLikeDtcg, parseTokens, removeMode,
  renameCollection, renameMode, renameVariable, setVariableScopes, setVariableValue, toDtcg, type VarScope, type VarType, type Variable,
} from '@layr/core';
import { download } from '../api';
import { useEditor, type MenuItem } from './state';
import type { EditorSession } from './session';
import { Icon } from '../icons';
import { SwatchButton } from './ColorPicker';
import { Select } from '../ui/Select';
import { askText, askConfirm } from '../ui/dialogs';

const SCOPE_FOR: Record<VarType, VarScope[]> = { COLOR: ['ALL', 'FILL', 'STROKE'], FLOAT: ['ALL', 'OPACITY', 'RADIUS', 'SPACING', 'SIZE', 'FONT_SIZE'], STRING: ['ALL', 'TEXT_CONTENT'], BOOLEAN: ['ALL', 'VISIBILITY'] };
const TYPE_LABEL: Record<VarType, string> = { COLOR: 'Color', FLOAT: 'Number', STRING: 'String', BOOLEAN: 'Boolean' };
const TYPE_ICON: Record<VarType, string> = { COLOR: '◔', FLOAT: '#', STRING: 'T', BOOLEAN: '◐' };

/** Full-page variables editor (opened from the left rail). Collections, groups (by `/` in names), modes as columns. */
export function VariablesPage({ session }: { session: EditorSession }) {
  const store = session.store;
  useSyncExternalStore(store.subscribe.bind(store), () => store.version);
  const set = useEditor(s => s.set);
  const toast = useEditor(s => s.toast);
  const [sel, setSel] = useState<string | null>(null);
  const [group, setGroup] = useState('');
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const doc = store.doc, ro = !session.canEdit;
  const cols = Object.values(doc.collections);
  const col = doc.collections[sel ?? ''] ?? cols[0];
  const all = col ? Object.values(doc.variables).filter(v => v.collectionId === col.id) : [];
  const countIn = (path: string) => all.filter(v => !path || v.name.startsWith(path + '/')).length;
  const groups = useMemo(() => {
    const paths = new Set<string>();
    for (const v of all) { const parts = v.name.split('/').slice(0, -1); parts.forEach((_, i) => paths.add(parts.slice(0, i + 1).join('/'))); }
    return [...paths].sort();
  }, [all.map(v => v.name).join('|')]);
  const shown = all.filter(v => (!group || v.name.startsWith(group + '/')) && v.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const fail = (m: string) => toast(m, 'error');
  const label = (v: Variable) => v.name.split('/').at(-1)!;

  const uniqueName = (base: string) => { let n = base, i = 2; while (all.some(v => v.name === n)) n = `${base} ${i++}`; return n; };
  const addVar = (type: VarType) => {
    if (!col) return;
    const prefix = group ? group + '/' : '';
    const id = createVariable(store, col.id, uniqueName(prefix + TYPE_LABEL[type]), type, undefined, ['ALL']);
    if (id) setTimeout(() => (document.querySelector(`[data-vid="${id}"] input`) as HTMLInputElement | null)?.select(), 50);
  };
  const typeMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuItem[] = (['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'] as VarType[]).map(t => ({ label: TYPE_LABEL[t], run: () => addVar(t) }));
    set({ menu: { x: r.left, y: r.top - items.length * 30 - 14, items } });
  };
  const rowMenu = (e: React.MouseEvent, v: Variable) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuItem[] = [{ label: 'SCOPES', disabled: true }, ...SCOPE_FOR[v.type].map(s => ({ label: `${(v.scopes.includes(s) || (!v.scopes.length && s === 'ALL')) ? '✓ ' : '   '}${s.replace('_', ' ').toLowerCase()}`, run: () => {
      let next: VarScope[] = s === 'ALL' ? ['ALL'] : (v.scopes.includes(s) ? v.scopes.filter(x => x !== s) : [...v.scopes.filter(x => x !== 'ALL'), s]);
      if (!next.length) next = ['ALL']; setVariableScopes(store, v.id, next);
    } })), { label: '', separator: true }, { label: 'Delete variable', run: () => deleteVariable(store, v.id) }];
    set({ menu: { x: Math.min(r.left - 160, window.innerWidth - 240), y: r.bottom + 4, items } });
  };

  const cell = (v: Variable, modeId: string) => {
    const raw = v.values[modeId];
    const alias = typeof raw === 'object' ? raw.alias : '';
    const targets = Object.values(doc.variables).filter(t => t.type === v.type && t.id !== v.id);
    const commit = (val: string | number | boolean | { alias: string }) => { if (!setVariableValue(store, v.id, modeId, val)) fail('That value is not valid (type mismatch, bad colour or alias cycle)'); };
    const target = alias ? doc.variables[alias] : null;
    const aliasColor = target && target.type === 'COLOR' ? String(Object.values(target.values)[0]) : null;
    return (
      <td key={modeId}>
        <div className="vcell2">
          {alias ? (
            <span className="achip" title="Alias — pick a different variable or set a value">
              {aliasColor && <i className="sw" style={{ background: aliasColor.startsWith('#') ? aliasColor : '#888' }} />}<span>{doc.collections[target!.collectionId].name}/{target!.name}</span>
            </span>
          ) : <>
            {v.type === 'COLOR' && <><SwatchButton paint={{ type: 'SOLID', color: String(raw), opacity: 1 }} gradients={false} showOpacity={false} disabled={ro} onChange={p => p.type === 'SOLID' && commit(p.color)} /><HexCell value={String(raw)} ro={ro} onCommit={c => commit(c)} label={`${v.name} ${doc.collections[v.collectionId].modes.find(m => m.id === modeId)?.name} colour`} /></>}
            {v.type === 'FLOAT' && <input className="cellin" type="number" disabled={ro} defaultValue={Number(raw)} key={String(raw)} onBlur={e => { if (e.target.value !== '' && Number(e.target.value) !== raw) commit(Number(e.target.value)); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label={`${v.name} value`} />}
            {v.type === 'STRING' && <input className="cellin" disabled={ro} defaultValue={String(raw)} key={String(raw)} onBlur={e => { if (e.target.value !== raw) commit(e.target.value); }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label={`${v.name} text`} />}
            {v.type === 'BOOLEAN' && <label className="check"><input type="checkbox" disabled={ro} checked={raw === true} onChange={e => commit(e.target.checked)} /> {raw === true ? 'True' : 'False'}</label>}
          </>}
          <Select className="aliassel" disabled={ro} title="Value or alias" aria-label="Value or alias" value={alias} onChange={e => { if (e.target.value) commit({ alias: e.target.value }); else commit(v.type === 'COLOR' ? '#000000' : v.type === 'FLOAT' ? 0 : v.type === 'STRING' ? '' : false); }}>
            <option value="">Value</option>{targets.map(t => <option key={t.id} value={t.id}>{doc.collections[t.collectionId].name}/{t.name}</option>)}
          </Select>
        </div>
      </td>
    );
  };

  const importFile = async (f: File) => {
    try {
      const text = await f.text();
      let file;
      try { const j = JSON.parse(text); file = looksLikeDtcg(j) ? fromDtcg(j, col?.name ?? f.name.replace(/\.[^.]+$/, '')) : parseTokens(text); } catch (e) { if (e instanceof TokenError) throw e; throw new TokenError('Not valid JSON'); }
      const r = importTokens(store, file);
      toast(`Imported ${r.variables} variables${r.collections ? `, ${r.collections} new collection(s)` : ''}${r.skipped.length ? ` (${r.skipped.length} skipped: ${r.skipped.slice(0, 2).join('; ')})` : ''}`);
    } catch (x) { fail(x instanceof TokenError ? x.message : `Import failed: ${(x as Error).message}`); }
  };

  let lastHead = '__none__';
  return (
    <div className="varspage" role="region" aria-label="Variables">
      <aside className="vp-left">
        <div className="vp-title"><b>Variables</b><span className="muted small">{session.file.name}</span></div>
        <div className="sec-head"><span className="sec-title">Collections</span><span className="sec-btns"><button className="icon-btn" disabled={ro} title="Add collection" aria-label="Add collection" onClick={() => { void askText('New collection', '', { placeholder: 'Collection name', okLabel: 'Create' }).then(n => { if (n?.trim()) { setSel(createCollection(store, n, ['Mode 1'])); setGroup(''); } }); }}><Icon n="plus" size={16} /></button></span></div>
        <div className="vp-list">
          {cols.map(c => <button key={c.id} className={'vp-item' + (c.id === col?.id ? ' on' : '')} onClick={() => { setSel(c.id); setGroup(''); }}><span>{c.name}</span><span className="muted">{Object.values(doc.variables).filter(v => v.collectionId === c.id).length}</span></button>)}
          {!cols.length && <div className="muted small pad">No collections yet. Create one to start.</div>}
        </div>
        {col && <>
          <div className="sec-head"><span className="sec-title">Groups</span></div>
          <div className="vp-list grow">
            <button className={'vp-item' + (!group ? ' on' : '')} onClick={() => setGroup('')}><span>All</span><span className="muted">{all.length}</span></button>
            {groups.map(g => <button key={g} className={'vp-item' + (group === g ? ' on' : '')} style={{ paddingLeft: 14 + (g.split('/').length - 1) * 14 }} onClick={() => setGroup(g)}><span>{g.split('/').at(-1)}</span><span className="muted">{countIn(g)}</span></button>)}
          </div>
        </>}
      </aside>
      <section className="vp-main">
        <div className="vp-top">
          <input className="vp-coll" disabled={ro || !col} key={col?.id + (col?.name ?? '')} defaultValue={col?.name ?? 'Variables'} aria-label="Collection name" onBlur={e => col && e.target.value !== col.name && renameCollection(store, col.id, e.target.value)} />
          <span className="spacer" />
          <div className="searchbox"><Icon n="search" size={15} /><input className="search" placeholder="Search" aria-label="Search variables" value={q} onChange={e => setQ(e.target.value)} /></div>
          <button className="vpbtn" disabled={ro} onClick={() => fileRef.current?.click()} title="Import a Gridvue tokens file or a W3C design-tokens JSON"><Icon n="upload" size={14} /><span className="lbl">Import</span></button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
          <button className="vpbtn" aria-label="Export" title="Export tokens" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); set({ menu: { x: Math.min(r.left, window.innerWidth - 260), y: r.bottom + 6, items: [
            { label: 'This collection (W3C design tokens)', disabled: !col, run: () => col && download(new Blob([JSON.stringify(toDtcg(doc, col.id), null, 2)], { type: 'application/json' }), `${col.name}.tokens.json`) },
            { label: 'All collections and modes (Gridvue format)', run: () => download(new Blob([JSON.stringify(exportTokens(doc), null, 2)], { type: 'application/json' }), `${session.file.name}.tokens.json`) },
          ] } }); }}><span className="lbl">Export</span><Icon n="chevD" size={13} /></button>
          <button className="vpbtn icon" disabled={ro || !col} aria-label="Delete collection" title="Delete collection" onClick={() => { if (col) void askConfirm(`Delete "${col.name}"?`, { message: `Its ${all.length} variable${all.length === 1 ? '' : 's'} will be removed.`, okLabel: 'Delete', danger: true }).then(yes => { if (yes) { deleteCollection(store, col.id); setSel(null); setGroup(''); } }); }}><Icon n="trash" size={15} /></button>
          <span className="vpsep" />
          <button className="vpbtn icon" aria-label="Close variables" title="Back to the canvas" onClick={() => set({ leftTab: 'file' })}><Icon n="close" size={16} /></button>
        </div>
        {!col ? <div className="blankstate"><h3>Define your design tokens</h3><p className="muted">Variables hold colours, numbers, text and booleans with modes (like Light and Dark). Bind them while you design from the ◇ button or the colour picker's Libraries tab.</p><button className="btn primary vpbtn-primary" disabled={ro} onClick={() => { void askText('New collection', '', { placeholder: 'Collection name', okLabel: 'Create' }).then(n => { if (n?.trim()) setSel(createCollection(store, n, ['Mode 1'])); }); }}>+ Collection</button></div> : <>
          <div className="vp-scroll">
            <table className="vtbl">
              <thead><tr><th className="c-name">Name</th>{col.modes.map(m => <th key={m.id}><span className="row">
                <input defaultValue={m.name} key={m.id + m.name} disabled={ro} aria-label="Mode name" onBlur={e => { if (e.target.value !== m.name && !renameMode(store, col.id, m.id, e.target.value)) { e.target.value = m.name; fail('Mode names must be unique and non-empty'); } }} />
                {col.modes.length > 1 && <button className="icon-btn" disabled={ro} title="Remove mode" aria-label={`Remove mode ${m.name}`} onClick={() => removeMode(store, col.id, m.id)}><Icon n="minus" size={13} /></button>}
              </span></th>)}
                <th className="c-add"><button className="icon-btn" disabled={ro} title="Add mode" aria-label="Add mode" onClick={() => { void askText('New mode', '', { placeholder: 'Mode name', okLabel: 'Add' }).then(n => { if (n && !addMode(store, col.id, n)) fail('Mode names must be unique and non-empty'); }); }}><Icon n="plus" size={16} /></button></th></tr></thead>
              <tbody>
                {shown.flatMap(v => {
                  const head = v.name.includes('/') ? v.name.split('/').slice(0, -1).join('/') : '';
                  const rows = [];
                  if (head !== lastHead) { lastHead = head; if (head && !group) rows.push(<tr key={'h' + head} className="vgh"><td colSpan={col.modes.length + 2}>{head}</td></tr>); }
                  rows.push(
                    <tr key={v.id} data-vid={v.id}>
                      <td className="c-name"><div className="row"><span className={`vt ${v.type}`} title={TYPE_LABEL[v.type]}>{TYPE_ICON[v.type]}</span>
                        <input defaultValue={group || !v.name.includes('/') ? (group ? v.name.slice(group.length + 1) : v.name) : label(v)} key={v.id + v.name + group} disabled={ro} aria-label="Variable name"
                          onBlur={e => { const full = group ? `${group}/${e.target.value}` : head ? `${head}/${e.target.value}` : e.target.value; const cur = v.name; if (full !== cur && !renameVariable(store, v.id, full)) { e.target.value = group ? cur.slice(group.length + 1) : label(v); fail('Variable names must be unique within a collection'); } }}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                        <button className="icon-btn rowact" title="Scopes and more" aria-label={`Options for ${v.name}`} onClick={e => rowMenu(e, v)}><Icon n="ellipsis" size={15} /></button></div></td>
                      {col.modes.map(m => cell(v, m.id))}<td />
                    </tr>);
                  return rows;
                })}
                {!shown.length && <tr><td colSpan={col.modes.length + 2} className="muted pad">{q ? 'No variables match.' : 'No variables here yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="vp-foot"><button className="vpbtn" disabled={ro} onClick={typeMenu} aria-label="Create variable"><Icon n="plus" size={14} /> Create variable</button>
            <span className="muted small">Tip: use “/” in a name to group variables (e.g. foundations/accent). Bind variables from the ◇ button or the colour picker → Libraries.</span></div>
        </>}
      </section>
    </div>
  );
}

function HexCell({ value, onCommit, ro, label }: { value: string; onCommit: (c: string) => void; ro: boolean; label: string }) {
  const [t, setT] = useState(value.replace('#', '').toUpperCase());
  const prev = useRef(value);
  if (prev.current !== value) { prev.current = value; setT(value.replace('#', '').toUpperCase()); }
  return <input className="cellin hexin" aria-label={label} value={t} disabled={ro} maxLength={6} onChange={e => setT(e.target.value)} onBlur={() => (/^[0-9a-f]{6}$/i.test(t) ? onCommit('#' + t.toUpperCase()) : setT(value.replace('#', '').toUpperCase()))} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />;
}
