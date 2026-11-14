import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Icon } from './icons';
import { storage } from './editor/state';

type Kind = 'bug' | 'idea' | 'other';
const KINDS: [Kind, string][] = [['bug', 'Bug'], ['idea', 'Idea'], ['other', 'Other']];
const MAX_SHOTS = 4, MAX_BYTES = 5_000_000;

const toBase64 = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(new Error('Could not read the image')); r.readAsDataURL(f); });

/**
 * Floating feedback button (fixed, bottom-right; it never takes space from the page). The popup collects a name, a type, a comment and
 * optional screenshots (attach, drag in, or paste). The server stores the report and emails it to the product owner.
 */
export function FeedbackButton({ userName }: { userName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => storage.get('layr:feedbackName', '') || userName);
  const [kind, setKind] = useState<Kind>('bug');
  const [message, setMessage] = useState('');
  const [shots, setShots] = useState<{ id: number; file: File; url: string }[]>([]);
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const seq = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open]);
  useEffect(() => () => shots.forEach(s => URL.revokeObjectURL(s.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (files: File[]) => {
    setErr('');
    const imgs = files.filter(f => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
    if (files.length && !imgs.length) return setErr('Screenshots must be PNG, JPEG, GIF or WebP images.');
    const room = MAX_SHOTS - shots.length;
    const ok = imgs.filter(f => f.size <= MAX_BYTES).slice(0, room);
    if (imgs.some(f => f.size > MAX_BYTES)) setErr('Images over 5 MB were skipped.');
    else if (imgs.length > room) setErr(`You can attach up to ${MAX_SHOTS} screenshots.`);
    setShots(s => [...s, ...ok.map(file => ({ id: seq.current++, file, url: URL.createObjectURL(file) }))]);
  };
  const remove = (id: number) => setShots(s => { s.filter(x => x.id === id).forEach(x => URL.revokeObjectURL(x.url)); return s.filter(x => x.id !== id); });
  const reset = () => { shots.forEach(s => URL.revokeObjectURL(s.url)); setShots([]); setMessage(''); setKind('bug'); setState('idle'); setNote(''); setErr(''); };

  const submit = async () => {
    if (!name.trim()) return setErr('Please enter your name.');
    if (!message.trim()) return setErr('Please write a comment.');
    setErr(''); setState('sending');
    try {
      storage.set('layr:feedbackName', name.trim());
      const screenshots = await Promise.all(shots.map(async s => ({ base64: await toBase64(s.file) })));
      const r = await api.sendFeedback({ name: name.trim(), kind, message: message.trim(), page: location.href.replace(location.origin, ''), userAgent: `${navigator.userAgent} · ${window.innerWidth}×${window.innerHeight}`, screenshots });
      setNote(r.emailed ? 'Thank you! Your feedback was sent.' : r.configured ? 'Thanks! Your feedback was saved, but the email could not be delivered right now.' : 'Thanks! Your feedback was saved. (Email delivery is not set up on this server yet.)');
      setState('done');
    } catch (e) { setErr((e as Error).message); setState('idle'); }
  };

  return (
    <div className="fb-root">
      {open && (
        <section className="fb-pop" role="dialog" aria-label="Send feedback" data-testid="feedback-popup"
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
          onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); add([...e.dataTransfer.files]); } }}>
          <header><b>Send feedback</b><button className="icon-btn" aria-label="Close feedback" onClick={() => setOpen(false)}><Icon n="close" size={14} /></button></header>
          {state === 'done' ? (
            <div className="fb-done"><p>{note}</p><div className="fb-row"><button className="btn small" onClick={reset}>Send another</button><button className="btn small primary" onClick={() => { setOpen(false); reset(); }}>Close</button></div></div>
          ) : <>
            <p className="muted small">Found a bug or have an idea to improve Gridvue? Tell us. Your name and the page you are on are included.</p>
            <label className="fb-field">Your name<input value={name} maxLength={80} onChange={e => setName(e.target.value)} aria-label="Your name" /></label>
            <div className="fb-kinds" role="group" aria-label="Type">{KINDS.map(([k, l]) => <button key={k} className={'chip-btn' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</div>
            <label className="fb-field">Comment
              <textarea rows={5} value={message} maxLength={5000} placeholder={kind === 'bug' ? 'What went wrong? What did you expect?' : 'What would make this better?'} aria-label="Comment" onChange={e => setMessage(e.target.value)}
                onPaste={e => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); add(f); } }} />
            </label>
            {!!shots.length && <div className="fb-shots">{shots.map(s => <span key={s.id} className="fb-shot"><img src={s.url} alt={s.file.name} /><button aria-label={`Remove ${s.file.name}`} onClick={() => remove(s.id)}>×</button></span>)}</div>}
            <div className="fb-row">
              <button className="btn small" onClick={() => fileRef.current?.click()} disabled={shots.length >= MAX_SHOTS}><Icon n="image" size={13} /> Attach screenshot</button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={e => { add([...(e.target.files ?? [])]); e.target.value = ''; }} />
              <span className="spacer" />
              <button className="btn small primary" disabled={state === 'sending'} onClick={() => void submit()}>{state === 'sending' ? 'Sending…' : 'Submit'}</button>
            </div>
            <p className="muted small">You can also paste or drop an image here.</p>
            {err && <p className="fb-err" role="alert">{err}</p>}
          </>}
        </section>
      )}
      <button className={'fb-fab' + (open ? ' on' : '')} aria-label="Feedback" aria-expanded={open} title="Send feedback" onClick={() => setOpen(o => !o)}><Icon n="comment" size={18} /><span>Feedback</span></button>
    </div>
  );
}
