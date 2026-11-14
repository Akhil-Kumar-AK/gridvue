import { useEffect, useState } from 'react';
import { api, type User } from './api';
import { Dashboard } from './dashboard/Dashboard';
import { AuthScreen } from './dashboard/Auth';
import { Editor } from './editor/Editor';
import { Toasts } from './editor/Overlays';
import { Player, pickStart } from './proto/Player';
import type { DocumentData } from '@layr/core';
import { useEditor } from './editor/state';
import { DialogHost } from './ui/dialogs';
import { TabBar, loadTabs, saveTabs, type Tab } from './TabBar';

function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h;
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tabs, setTabs] = useState<Tab[]>(loadTabs);
  const hash = useHash();
  const theme = useEditor(s => s.theme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { api.me().then(r => setUser(r.user)).catch(() => setUser(null)); }, []);
  const m = /^#\/file\/([\w-]+)/.exec(hash);
  const activeId = m ? m[1] : null;
  // opening a file adds a tab; the tab list is remembered
  useEffect(() => { if (activeId && !tabs.some(t => t.id === activeId)) setTabs(t => [...t, { id: activeId, name: 'Loading…' }]); }, [activeId]);
  useEffect(() => saveTabs(tabs), [tabs]);
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<{ id: string; name: string; type?: string }>).detail; setTabs(t => t.map(x => (x.id === d.id ? { ...x, name: d.name, type: d.type ?? x.type } : x))); };
    window.addEventListener('layr:rename', h); return () => window.removeEventListener('layr:rename', h);
  }, []);
  useEffect(() => { // drop tabs for files that were deleted / are no longer accessible
    const h = (e: Event) => { const id = (e as CustomEvent<{ id: string }>).detail.id; setTabs(t => t.filter(x => x.id !== id)); };
    window.addEventListener('layr:gone', h); return () => window.removeEventListener('layr:gone', h);
  }, []);
  if (user === undefined) return <div className="center-screen muted">Loading…</div>;
  if (!user) return <><AuthScreen onAuth={setUser} /><Toasts /><DialogHost /></>;
  const play = /^#\/play\/([\w-]+)/.exec(hash);
  if (play) return <><StandalonePlayer id={play[1]} /><DialogHost /></>;
  const closeTab = (id: string) => {
    const i = tabs.findIndex(t => t.id === id), next = tabs.filter(t => t.id !== id);
    setTabs(next);
    if (id === activeId) location.hash = next.length ? `#/file/${(next[Math.min(i, next.length - 1)]).id}` : '#/';
  };
  const tabbar = <TabBar tabs={tabs} activeId={activeId} onHome={() => { location.hash = '#/'; }} onSelect={id => { location.hash = `#/file/${id}`; }} onClose={closeTab} userName={user.name} onLogout={async () => { await api.logout(); setUser(null); }} />;
  return (
    <div className="appshell">
      {tabbar}
      <div className="appbody">
        {m ? <Editor key={m[1]} fileId={m[1]} onExit={() => { location.hash = '#/'; }} />
          : <Dashboard user={user} onLogout={async () => { await api.logout(); setUser(null); }} />}
      </div>
      <Toasts /><DialogHost />
    </div>
  );
}

function StandalonePlayer({ id }: { id: string }) {
  const [doc, setDoc] = useState<DocumentData | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.getFile(id).then(r => setDoc(r.document)).catch(e => setErr(e.status === 404 ? 'This prototype does not exist or you do not have access.' : e.message)); }, [id]);
  if (err) return <div className="center-screen"><div className="card-msg"><h2>Cannot open prototype</h2><p>{err}</p><button className="btn primary" onClick={() => { location.hash = '#/'; }}>Back to files</button></div></div>;
  if (!doc) return <div className="center-screen muted">Loading…</div>;
  const start = pickStart(doc, doc.nodes[doc.rootId].children[0], []);
  if (!start) return <div className="center-screen"><div className="card-msg"><h2>Nothing to present</h2><p>This file has no top-level frames.</p></div></div>;
  return <Player doc={doc} startFrame={start} standalone onClose={() => { location.hash = `#/file/${id}`; }} />;
}
