import type { FileMeta } from '../api';
import { BrandMark, Icon } from '../icons';
import { JIcon } from '../jam/icons';

export type SideView = 'all' | 'designs' | 'systems' | 'boards';
interface Props {
  view: string; project: string | null; onView: (v: SideView) => void; onProject: (id: string) => void;
  q: string; setQ: (v: string) => void;
  files: FileMeta[]; projects: { id: string; name: string }[]; starred: FileMeta[]; onOpen: (id: string) => void;
  onNewProject: () => void; onRenameProject: (p: { id: string; name: string }) => void; onDeleteProject: (p: { id: string; name: string }) => void;
  theme: 'light' | 'dark'; onTheme: () => void; onLogout: () => void;
}
const PALETTE = ['#4f46e5', '#0d99ff', '#a259ff', '#f59e0b', '#10b981', '#ec4899'];

/** Sidebar: a usage-aware "All files" tile, three type tiles with live counts, colour-coded folders and starred files. */
export function HomeSidebar(p: Props) {
  const live = p.files.filter(f => !f.deletedAt);
  const n = { designs: live.filter(f => f.type === 'design').length, systems: live.filter(f => f.type === 'designsystem').length, boards: live.filter(f => f.type === 'whiteboard').length };
  const total = live.length;
  const on = (v: SideView) => !p.project && p.view === v;
  const rows: { v: SideView; label: string; icon: React.ReactNode; count: number; tone: string }[] = [
    { v: 'all', label: 'All files', icon: <Icon n="layers" size={16} />, count: total, tone: 'all' },
    { v: 'designs', label: 'Designs', icon: <Icon n="frame" size={16} />, count: n.designs, tone: 'blue' },
    { v: 'systems', label: 'Design systems', icon: <Icon n="book" size={16} />, count: n.systems, tone: 'indigo' },
    { v: 'boards', label: 'Whiteboards', icon: <JIcon n="sticky" size={16} />, count: n.boards, tone: 'violet' },
  ];
  const idx = p.project ? -1 : rows.findIndex(r => r.v === p.view);
  return (
    <aside className="hside hs">
      <a className="brand hbrandtop" href="#/" aria-label="Gridvue home"><BrandMark size={30} /><span>Gridvue</span></a>
      <div className="hsearch"><Icon n="search" size={16} /><input placeholder="Search files" aria-label="Search files" value={p.q} onChange={e => p.setQ(e.target.value)} /></div>
      <div className="hs-sec first"><span>Library</span></div>
      <nav className="hs-rows" aria-label="Files">
        <i className="hs-slider" aria-hidden="true" style={{ transform: `translateY(${Math.max(idx, 0) * 44}px)`, opacity: idx < 0 ? 0 : 1 }} data-tone={rows[Math.max(idx, 0)].tone} />
        {rows.map(r => (
          <button key={r.v} aria-label={r.label} aria-current={on(r.v) ? 'page' : undefined} className={`hs-rowbtn ${r.tone}` + (on(r.v) ? ' on' : '')} onClick={() => p.onView(r.v)}>
            <span className="hs-ico">{r.icon}</span>
            <span className="hs-name">{r.label}</span>
            <span className="hs-pill">{r.count}</span>
          </button>
        ))}
      </nav>
      <div className="hs-sec"><span>Projects</span><button className="icon-btn" title="New project" aria-label="New project" onClick={p.onNewProject}><Icon n="plus" size={14} /></button></div>
      <div className="hs-list">
        {p.projects.map((pr, i) => {
          const count = live.filter(f => f.projectId === pr.id).length;
          return (
            <div key={pr.id} className={'hs-item' + (p.project === pr.id ? ' on' : '')}>
              <button className="hs-itembtn" aria-label={pr.name} onClick={() => p.onProject(pr.id)}>
                <span className="hs-ico folder" style={{ color: PALETTE[i % PALETTE.length], background: `${PALETTE[i % PALETTE.length]}26` }}><Icon n="folder" size={15} /></span>
                <span className="hs-name">{pr.name}</span>
                <span className="hs-num">{count}</span>
              </button>
              <span className="hs-acts">
                <button className="hs-act" aria-label={`Rename ${pr.name}`} title="Rename" onClick={() => p.onRenameProject(pr)}><JIcon n="edit" size={16} /></button>
                <button className="hs-act danger" aria-label={`Delete ${pr.name}`} title="Delete project (files move to Drafts)" onClick={() => p.onDeleteProject(pr)}><JIcon n="trash" size={16} /></button>
              </span>
            </div>
          );
        })}
        {!p.projects.length && <div className="hs-empty">Group files into projects with the + above.</div>}
      </div>
      <div className="hs-sec"><span>Starred</span></div>
      <div className="hs-list">
        {p.starred.map(f => (
          <div key={f.id} className="hs-item">
            <button className="hs-itembtn hs-pinned" aria-label={f.name} onClick={() => p.onOpen(f.id)}>
              <span className={'hs-ico typed ' + (f.type === 'whiteboard' ? 'violet' : f.type === 'designsystem' ? 'indigo' : 'blue')}>{f.type === 'whiteboard' ? <JIcon n="sticky" size={14} /> : f.type === 'designsystem' ? <Icon n="components" size={14} /> : <Icon n="frame" size={14} />}</span>
              <span className="hs-name">{f.name}</span>
              <span className="hs-pill gold"><Icon n="starFill" size={11} /></span>
            </button>
          </div>
        ))}
        {!p.starred.length && <div className="hs-empty">Star a file to pin it here.</div>}
      </div>
      <div className="hs-foot">
        <button onClick={p.onTheme} aria-label="Toggle theme" title="Switch theme"><Icon n={p.theme === 'dark' ? 'sun' : 'moon'} size={15} />{p.theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
        <button onClick={p.onLogout} aria-label="Sign out"><Icon n="signout" size={15} />Sign out</button>
      </div>
    </aside>
  );
}
