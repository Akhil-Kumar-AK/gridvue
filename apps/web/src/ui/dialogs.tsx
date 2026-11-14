import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

interface DialogState {
  kind: 'prompt' | 'confirm';
  title: string; message?: string; value?: string; okLabel: string; danger?: boolean; placeholder?: string;
  resolve: (v: string | boolean | null) => void;
}
const useDialog = create<{ d: DialogState | null; set: (d: DialogState | null) => void }>(set => ({ d: null, set: d => set({ d }) }));

/** In-app replacement for `window.prompt`: resolves to the entered text, or null when cancelled. */
export function askText(title: string, value = '', opts: { message?: string; okLabel?: string; placeholder?: string } = {}): Promise<string | null> {
  return new Promise(resolve => useDialog.getState().set({ kind: 'prompt', title, value, message: opts.message, okLabel: opts.okLabel ?? 'OK', placeholder: opts.placeholder, resolve: v => resolve(v as string | null) }));
}
/** In-app replacement for `window.confirm`. */
export function askConfirm(title: string, opts: { message?: string; okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise(resolve => useDialog.getState().set({ kind: 'confirm', title, message: opts.message, okLabel: opts.okLabel ?? 'OK', danger: opts.danger, resolve: v => resolve(v === true) }));
}

/** Mount once near the app root. */
export function DialogHost() {
  const d = useDialog(s => s.d), setD = useDialog(s => s.set);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null), okBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (d) { setText(d.value ?? ''); setTimeout(() => { if (d.kind === 'prompt') { input.current?.focus(); input.current?.select(); } else okBtn.current?.focus(); }, 0); } }, [d]);
  if (!d) return null;
  const done = (v: string | boolean | null) => { setD(null); d.resolve(v); };
  const ok = () => done(d.kind === 'prompt' ? text : true);
  return (
    <div className="modal-backdrop dlg-back" onPointerDown={e => { if (e.target === e.currentTarget) done(d.kind === 'prompt' ? null : false); }}>
      <div className="modal dlg" role="dialog" aria-modal="true" aria-label={d.title} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') done(d.kind === 'prompt' ? null : false); if (e.key === 'Enter' && (d.kind === 'prompt' || document.activeElement === okBtn.current)) { e.preventDefault(); ok(); } }}>
        <h3>{d.title}</h3>
        {d.message && <p className="muted">{d.message}</p>}
        {d.kind === 'prompt' && <input ref={input} value={text} placeholder={d.placeholder} aria-label={d.title} onChange={e => setText(e.target.value)} />}
        <div className="dlg-actions">
          <button className="btn" onClick={() => done(d.kind === 'prompt' ? null : false)}>Cancel</button>
          <button ref={okBtn} className={'btn primary' + (d.danger ? ' danger' : '')} onClick={ok}>{d.okLabel}</button>
        </div>
      </div>
    </div>
  );
}
