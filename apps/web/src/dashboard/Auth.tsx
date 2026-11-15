import { useState } from 'react';
import { api, type User } from '../api';
import { BrandMark, Icon } from '../icons';
import { JIcon } from '../jam/icons';
import { useEditor, storage } from '../editor/state';
import { DEMO } from '../net';

const Cursor = ({ color }: { color: string }) => <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3l15 7-6.500 2.200L10 19z" fill={color} stroke="#fff" strokeWidth="1.600" strokeLinejoin="round" /></svg>;

/** The hero is a small, living canvas: a UI frame, sticky notes, a flow line, a selection box, a palette and two collaborator cursors. */
function Stage() {
  return (
    <div className="gv-stage" aria-hidden="true">
      <i className="gv-blob b1" /><i className="gv-blob b2" /><i className="gv-grid" />
      <svg className="gv-flow" viewBox="0 0 600 700" fill="none"><path className="gv-flowline" d="M250 215C330 215 330 330 410 330" /><path className="gv-flowline d2" d="M300 505C300 440 190 470 190 420" /><path d="M404 322l12 8-12 8" stroke="#c7d2fe" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <div className="gv-frame">
        <div className="gv-bar"><span /><span /><span /><em>Landing · 1440</em></div>
        <div className="gv-hero-block"><b /><u /></div>
        <div className="gv-lines"><i /><i /><i /></div>
        <div className="gv-cta"><span>Get started</span><span className="alt">Learn more</span></div>
      </div>
      <div className="gv-sticky s1"><b>Ship it</b><span>before Friday ✨</span></div>
      <div className="gv-sticky s2"><b>Ask Varsha</b><span>about the grid</span></div>
      <div className="gv-select"><div className="gv-circle" /><i className="h h1" /><i className="h h2" /><i className="h h3" /><i className="h h4" /><em>120 × 120</em></div>
      <div className="gv-palette"><i style={{ background: '#4f46e5' }} /><i style={{ background: '#22d3ee' }} /><i style={{ background: '#fbbf24' }} /><i style={{ background: '#f472b6' }} /><i style={{ background: '#34d399' }} /></div>
      <div className="gv-stamp st1">🎉</div><div className="gv-stamp st2">⭐</div><div className="gv-stamp st3">💡</div>
      <div className="gv-cursor c1"><Cursor color="#22d3ee" /><span style={{ background: '#22d3ee', color: '#06303a' }}>Akhil</span></div>
      <div className="gv-cursor c2"><Cursor color="#f472b6" /><span style={{ background: '#f472b6', color: '#4a0f2c' }}>Varsha</span></div>
    </div>
  );
}

export const REPO_URL = 'https://github.com/Akhil-Kumar-AK/gridvue';
/** Shown on the hosted demo (and any non-local deployment), not when you run the app on your own machine. */
const showDemoNote = DEMO || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const GitHubMark = () => <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>;

const loadNames = (): string[] => { try { const v = JSON.parse(storage.get('layr:names', '[]')); return Array.isArray(v) ? v.filter((x: unknown) => typeof x === 'string').slice(0, 4) : []; } catch { return []; } };

export function AuthScreen({ onAuth }: { onAuth: (u: User) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [recent] = useState(loadNames);
  const theme = useEditor(s => s.theme); const set = useEditor(s => s.set);
  const first = name.trim().split(' ')[0];
  const enter = async (n: string) => {
    setError(''); setBusy(true);
    try { const r = await api.enter(n); storage.set('layr:names', JSON.stringify([r.user.name, ...loadNames().filter(x => x.toLowerCase() !== r.user.name.toLowerCase())].slice(0, 4))); onAuth(r.user); }
    catch (x) { setError((x as Error).message); } finally { setBusy(false); }
  };
  const feats: { icon: React.ReactNode; t: string; d: string }[] = [
    { icon: <Icon n="frame" size={20} />, t: 'Design', d: 'Frames, auto layout, components and variables' },
    { icon: <JIcon n="sticky" size={20} />, t: 'Whiteboard', d: 'Stickies, connectors, stamps and voting' },
    { icon: <Icon n="play" size={20} />, t: 'Prototype', d: 'Link screens and present on real devices' },
  ];
  return (
    <div className="gv-split">
      <aside className="gv-left">
        <Stage />
        <div className="gv-brand"><BrandMark size={32} /><span>Gridvue</span></div>
        <div className="gv-copy">
          <h1>Where layout<br />meets <em>vision</em>.</h1>
          <p>Frames, auto layout, prototypes and a whiteboard — one canvas for every idea.</p>
          <div className="gv-chips"><span>Design</span><span>Whiteboard</span><span>Prototype</span><span>Variables</span></div>
        </div>
      </aside>
      <main className="gv-right">
        <div className="gv-top"><span className="gv-eyebrow">Welcome</span>
          <button type="button" className="gv-theme" aria-label="Switch theme" title="Switch theme" onClick={() => { const t = theme === 'dark' ? 'light' : 'dark'; set({ theme: t }); storage.set('layr:theme', t); }}><Icon n={theme === 'dark' ? 'sun' : 'moon'} size={17} /></button></div>
        <div className="gv-mid">
          <form className="gv-panel" onSubmit={e => { e.preventDefault(); void enter(name); }}>
            <div className="gv-head">
              <div className={'gv-avatar' + (first ? ' on' : '')} aria-hidden="true">{first ? first[0].toUpperCase() : <BrandMark size={48} />}</div>
              <div><h2>{first ? <>Hi, <span>{first}</span> 👋</> : 'Welcome to Gridvue'}</h2>
                <p className="gv-sub">{first ? 'Ready when you are. Your canvas is waiting.' : 'Tell us your name and jump straight in.'}</p></div>
            </div>
            <label className="gv-field"><span>Your name</span>
              <input value={name} onChange={e => setName(e.target.value)} required maxLength={60} autoComplete="name" autoFocus placeholder="e.g. Alex Morgan" />
            </label>
            {error && <div className="error" role="alert">{error}</div>}
            <button className="gv-go" disabled={busy || !name.trim()}>{busy ? 'Opening…' : 'Continue'}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
            {recent.length > 0 && <div className="gv-recent"><span>Continue as</span>{recent.map(n => <button type="button" key={n} onClick={() => void enter(n)} disabled={busy}><i>{n[0]?.toUpperCase()}</i>{n}</button>)}</div>}
            <p className="gv-note">{DEMO ? 'Demo mode: nothing is uploaded. Your files stay in this browser only (clearing site data removes them) and nobody else can see them.' : 'No password: your name opens your own files on this server. Enter the same name again to come back to them.'}</p>
          </form>
          {showDemoNote && <aside className="gv-demo" aria-label="About this demo">
            <div className="gv-demo-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.800h.01" /></svg></div>
            <div className="gv-demo-body">
              <b>This is a demo, for testing only</b>
              <p>Gridvue will go live based on users’ responses and feedback. Some features will not work properly without a server. To try the full application, open the GitHub repository, download it and run it locally. It works fully there.</p>
              <a className="gv-demo-btn" href={REPO_URL} target="_blank" rel="noopener noreferrer"><GitHubMark />Open the GitHub repository</a>
            </div>
          </aside>}
          <ul className="gv-feats">{feats.map(f => <li key={f.t}><span className="ic">{f.icon}</span><b>{f.t}</b><span>{f.d}</span></li>)}</ul>
        </div>
        <div className="gv-legal">{DEMO ? 'Gridvue · demo build' : 'Gridvue · local build'}</div>
      </main>
    </div>
  );
}
