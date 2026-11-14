import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useEditor } from './state';
import type { Action } from './actions';
import type { CanvasController } from './controller';
import type { EditorSession } from './session';
import { fontString, lineHeightPx } from '../engine/text';
import { localMatrix, renameNode, worldMatrix, type ExportSetting } from '@layr/core';
import { Select } from '../ui/Select';
import { Icon, type IconName } from '../icons';

export function Toasts() {
  const toasts = useEditor(s => s.toasts);
  return <div className="toasts">{toasts.map(t => <div key={t.id} className={`toast ${t.kind}`} role="status">{t.text}</div>)}</div>;
}

export function ContextMenu() {
  const menu = useEditor(s => s.menu);
  const set = useEditor(s => s.set);
  useEffect(() => { if (!menu) return; const close = () => set({ menu: null }); window.addEventListener('pointerdown', close); window.addEventListener('blur', close); return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close); }; }, [menu, set]);
  if (!menu) return null;
  const x = Math.min(menu.x, window.innerWidth - 230), y = Math.max(8, Math.min(menu.y, window.innerHeight - menu.items.length * 28 - 10));
  const choice = menu.items.some(i => i.checked !== undefined); // a pick-one menu: reserve a check slot and highlight the current row
  return (
    <div className={'menu' + (choice ? ' choice' : '')} style={{ left: x, top: y, maxHeight: window.innerHeight - y - 8 }} onPointerDown={e => e.stopPropagation()} role="menu">
      {menu.items.map((it, i) => it.separator ? <div key={i} className="menu-sep" /> : (
        <button key={i} role="menuitem" aria-checked={choice ? !!it.checked : undefined} className={it.checked ? 'checked' : ''} disabled={it.disabled} onClick={() => { set({ menu: null }); it.run?.(); }}>{choice && <span className="mk-check">{it.checked && <Icon n="check" size={16} />}</span>}{it.icon && <Icon n={it.icon as IconName} size={16} />}<span>{it.label}</span><kbd>{it.shortcut}</kbd></button>
      ))}
    </div>
  );
}

export function CommandPalette({ actions }: { actions: Action[] }) {
  const open = useEditor(s => s.paletteOpen);
  const set = useEditor(s => s.set);
  const [q, setQ] = useState(''); const [idx, setIdx] = useState(0);
  const list = useMemo(() => {
    const t = q.toLowerCase().split(/\s+/).filter(Boolean);
    return actions.filter(a => t.every(w => (a.label + ' ' + a.group).toLowerCase().includes(w)));
  }, [q, actions, open]);
  useEffect(() => { setIdx(0); }, [q]);
  useEffect(() => { if (open) setQ(''); }, [open]);
  if (!open) return null;
  const run = (a?: Action) => { if (!a || !a.enabled()) return; set({ paletteOpen: false }); setTimeout(a.run, 0); };
  return (
    <div className="modal-backdrop" onMouseDown={() => set({ paletteOpen: false })}>
      <div className="palette" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Command search">
        <input autoFocus placeholder="Search commands…" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(list.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
            if (e.key === 'Enter') run(list[idx]);
            if (e.key === 'Escape') set({ paletteOpen: false });
          }} />
        <div className="palette-list">
          {list.slice(0, 40).map((a, i) => <button key={a.id} className={i === idx ? 'on' : ''} disabled={!a.enabled()} onMouseEnter={() => setIdx(i)} onClick={() => run(a)}><span className="muted">{a.group}</span><span>{a.label}</span><kbd>{a.shortcut}</kbd></button>)}
          {!list.length && <div className="muted pad">No matching command</div>}
        </div>
      </div>
    </div>
  );
}

export function ExportDialog({ session }: { session: EditorSession }) {
  const open = useEditor(s => s.exportOpen); const set = useEditor(s => s.set);
  const [format, setFormat] = useState<ExportSetting['format']>('PNG'); const [scale, setScale] = useState(2); const [busy, setBusy] = useState(false);
  const sel = useEditor(s => s.selection);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={() => set({ exportOpen: false })}>
      <div className="modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Export">
        <h3>Export image</h3>
        <p className="muted">{sel.length ? `${sel.length} selected layer(s)` : 'No selection: the whole page is exported.'} Rendered with the same engine as the canvas.</p>
        <div className="row">
          <Select value={format} onChange={e => setFormat(e.target.value as ExportSetting['format'])}><option>PNG</option><option>JPG</option><option>WEBP</option></Select>
          <Select value={scale} onChange={e => setScale(Number(e.target.value))}>{[0.5, 1, 2, 3, 4].map(s => <option key={s} value={s}>{s}x</option>)}</Select>
        </div>
        <p className="muted small">JPG has no transparency (white background). Very large exports are scaled down to browser canvas limits. SVG/PDF export are not implemented yet.</p>
        <div className="row end">
          <button className="btn" onClick={() => set({ exportOpen: false })}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await session.exportSelection({ format, scale, suffix: scale === 1 ? '' : `@${scale}x` }); setBusy(false); set({ exportOpen: false }); }}>{busy ? 'Exporting…' : 'Export'}</button>
        </div>
      </div>
    </div>
  );
}

export function ShareDialog({ session }: { session: EditorSession }) {
  const open = useEditor(s => s.shareOpen); const set = useEditor(s => s.set); const toast = useEditor(s => s.toast);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.members>> | null>(null);
  const [email, setEmail] = useState(''); const [role, setRole] = useState<'editor' | 'viewer'>('editor'); const [err, setErr] = useState('');
  const load = () => api.members(session.file.id).then(setData).catch(e => setErr(e.message));
  useEffect(() => { if (open) { setErr(''); void load(); } }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={() => set({ shareOpen: false })}>
      <div className="modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Share">
        <h3>Share “{session.file.name}”</h3>
        <form className="row" onSubmit={async e => { e.preventDefault(); setErr(''); try { await api.addMember(session.file.id, email, role); setEmail(''); await load(); toast('Access updated'); } catch (x) { setErr((x as Error).message); } }}>
          <input placeholder="Name of a person who has signed in" value={email} onChange={e => setEmail(e.target.value)} required />
          <Select value={role} onChange={e => setRole(e.target.value as 'editor')}><option value="editor">Can edit</option><option value="viewer">Can view</option></Select>
          <button className="btn primary">Invite</button>
        </form>
        {err && <div className="error">{err}</div>}
        <div className="members">
          {data && <div className="member"><span>{data.owner.name} <span className="muted">{data.owner.email}</span></span><span className="muted">Owner</span></div>}
          {data?.members.map(m => (
            <div className="member" key={m.id}>
              <span>{m.name} <span className="muted">{m.email}</span></span>
              <span className="row">
                <Select value={m.role} onChange={async e => { await api.addMember(session.file.id, m.email, e.target.value as 'editor'); await load(); }}><option value="editor">Can edit</option><option value="viewer">Can view</option></Select>
                <button className="btn small" onClick={async () => { await api.removeMember(session.file.id, m.id); await load(); toast('Access revoked'); }}>Remove</button>
              </span>
            </div>
          ))}
        </div>
        <p className="muted small">Invitations work for users who already have an account; email invitations and share links are not implemented. Role changes are enforced by the server on the collaborator's next request; live sessions are not yet pushed an update (needs the Phase 3 realtime channel).</p>
        <div className="row end"><button className="btn" onClick={() => set({ shareOpen: false })}>Done</button></div>
      </div>
    </div>
  );
}

/** Textarea overlay positioned over the text node being edited. */
export function TextEditor({ session, ctrl }: { session: EditorSession; ctrl: CanvasController | null }) {
  const id = useEditor(s => s.editingTextId);
  const cam = useEditor(s => s.camera);
  const ref = useRef<HTMLTextAreaElement>(null);
  const n = id ? session.store.doc.nodes[id] : null;
  useEffect(() => { if (id) setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 0); }, [id]);
  if (!id || !n?.text || !ctrl) return null;
  const t = n.text;
  const m = worldMatrix(session.store.doc, id);
  const sx = (m[4] - cam.x) * cam.zoom, sy = (m[5] - cam.y) * cam.zoom;
  const rot = Math.atan2(m[1], m[0]) * 180 / Math.PI;
  void localMatrix;
  const fill = n.fills.find(f => f.type === 'SOLID');
  return (
    <textarea ref={ref} className="text-edit" defaultValue={t.characters} spellCheck={false}
      style={{
        left: sx, top: sy, width: Math.max(n.width * cam.zoom, 12), height: Math.max(n.height * cam.zoom, lineHeightPx(t) * cam.zoom),
        font: fontString({ ...t, fontSize: t.fontSize * cam.zoom }), lineHeight: `${lineHeightPx(t) * cam.zoom}px`, letterSpacing: t.letterSpacing * cam.zoom,
        textAlign: (t.align === 'JUSTIFIED' ? 'justify' : t.align.toLowerCase()) as 'left', textTransform: ({ UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' } as Record<string, 'uppercase' | 'lowercase' | 'capitalize'>)[t.textCase ?? ''], fontVariantCaps: t.textCase === 'SMALL_CAPS' || t.textCase === 'SMALL_CAPS_FORCED' ? 'small-caps' : undefined, textDecoration: t.decoration === 'UNDERLINE' ? 'underline' : t.decoration === 'STRIKE' ? 'line-through' : undefined, color: n.textPath ? 'transparent' : fill && fill.type === 'SOLID' ? fill.color : '#000', transform: `rotate(${rot}deg)`, transformOrigin: '0 0',
        whiteSpace: t.resize === 'AUTO_WIDTH' ? 'pre' : 'pre-wrap',
      }}
      onChange={e => ctrl.liveText(id, e.target.value)}
      onBlur={e => ctrl.endTextEdit(e.target.value)}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') e.currentTarget.blur(); }}
    />
  );
}

/** Inline editor for a frame's name, placed over its title label (double-click the name above a frame). */
export function FrameRename({ session, ctrl }: { session: EditorSession; ctrl: CanvasController | null }) {
  const id = useEditor(s => s.renaming);
  useEditor(s => s.camera);
  const set = useEditor(s => s.set);
  const n = id ? session.store.doc.nodes[id] : null;
  const r = id && ctrl ? ctrl.titleRect(id) : null;
  if (!id || !n) return null;
  const done = (v: string | null) => { set({ renaming: null }); if (v !== null && v.trim() && v.trim() !== n.name) renameNode(session.store, id, v.trim()); };
  return (
    <input className="frame-rename" autoFocus defaultValue={n.name} aria-label="Frame name" style={{ left: (r?.x ?? 20) - 6, top: (r?.y ?? 20) - 4, minWidth: Math.max(120, (r?.w ?? 60) + 24) }}
      onFocus={e => e.currentTarget.select()} onBlur={e => done(e.target.value)}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { set({ renaming: null }); } }} />
  );
}
