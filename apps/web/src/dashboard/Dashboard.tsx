import { useCallback, useEffect, useRef, useState } from 'react';
import { parseNativeFile } from '@layr/core';
import { api, type FileMeta, type User } from '../api';
import { TEMPLATES } from '../editor/templates';
import { useEditor, storage, type MenuItem } from '../editor/state';
import { BrandMark, Icon, type IconName } from '../icons';
import { JIcon } from '../jam/icons';
import { HomeHero } from './HomeHero';
import { HomeSidebar } from './HomeSidebar';
import { Select } from '../ui/Select';
import { IMPORT_ACCEPT, createFromImport, importDesignFile } from '../interchange';
import { ContextMenu } from '../editor/Overlays';
import { askText, askConfirm } from '../ui/dialogs';
import { createDesignSystem } from '../designsystem/library';

type View = 'recent' | 'shared' | 'drafts' | 'all' | 'templates' | 'systems' | 'trash' | 'designs' | 'boards';
const ago = (t: number) => { const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} minutes ago`; if (s < 86400) return `${Math.floor(s / 3600)} hours ago`; const d = Math.floor(s / 86400); return d < 31 ? `${d} day${d > 1 ? 's' : ''} ago` : d < 365 ? `${Math.floor(d / 30)} month${d >= 60 ? 's' : ''} ago` : new Date(t).toLocaleDateString(); };
const NAV: [View, string, IconName | 'sticky'][] = [['all', 'All files', 'folder'], ['designs', 'Designs', 'frame'], ['systems', 'Design systems', 'book'], ['boards', 'Whiteboards', 'sticky']];
/** which file type each sidebar view shows (All shows everything) */
const VIEW_TYPE: Partial<Record<View, string>> = { designs: 'design', systems: 'designsystem', boards: 'whiteboard' };

export function Dashboard({ user, onLogout, topbar }: { user: User; onLogout: () => void; topbar?: React.ReactNode }) {
  const toast = useEditor(s => s.toast);
  const set = useEditor(s => s.set);
  const theme = useEditor(s => s.theme);
  const [view, setView] = useState<View>('all');
  const [project, setProject] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>(() => (storage.get('layr:dashLayout', 'grid') as 'grid' | 'list'));
  const [files, setFiles] = useState<FileMeta[] | null>(null);
  const [starred, setStarred] = useState<FileMeta[]>([]);
  const [allFiles, setAllFiles] = useState<FileMeta[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const importRef = useRef<HTMLInputElement>(null);

  const apiView = project ? 'all' : view === 'templates' || view in VIEW_TYPE ? 'all' : view;
  const load = useCallback(async () => {
    if (view === 'templates' && !project) { setFiles([]); return; }
    try {
      const params: Record<string, string> = { view: apiView };
      if (q) params.q = q; if (sort) params.sort = sort; if (project) params.project = project;
      setFiles((await api.listFiles(params)).files);
    } catch (e) { toast((e as Error).message, 'error'); setFiles([]); }
  }, [apiView, view, project, q, sort]);
  const loadSide = () => { api.projects().then(r => setProjects(r.projects)).catch(() => {}); api.listFiles({ view: 'favorites' }).then(r => setStarred(r.files)).catch(() => {}); api.listFiles({ view: 'all' }).then(r => setAllFiles(r.files)).catch(() => {}); };
  useEffect(() => { const t = setTimeout(load, q ? 200 : 0); return () => clearTimeout(t); }, [load]);
  useEffect(loadSide, []);
  useEffect(() => { storage.set('layr:dashLayout', layout); }, [layout]);

  const open = (id: string) => { location.hash = `#/file/${id}`; };
  const create = async (body: Parameters<typeof api.createFile>[0]) => { try { const r = await api.createFile({ ...body, projectId: project }); open(r.file.id); } catch (e) { toast((e as Error).message, 'error'); } };
  const createSystem = async () => { try { toast('Building your design system…'); const f = await createDesignSystem(project); open(f.id); } catch (e) { toast((e as Error).message, 'error'); } };
  const act = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg); await load(); loadSide(); } catch (e) { toast((e as Error).message, 'error'); } };
  const projName = (id: string | null) => (id ? projects.find(p => p.id === id)?.name ?? 'Project' : 'Drafts');
  const title = project ? projects.find(p => p.id === project)?.name : NAV.find(n => n[0] === view)?.[1] ?? 'Files';
  const shown = (files ?? []).filter(f => project || !VIEW_TYPE[view] || f.type === VIEW_TYPE[view]);

  const menu = (e: React.MouseEvent, items: MenuItem[]) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); set({ menu: { x: Math.min(r.left, window.innerWidth - 240), y: r.bottom + 6, items } }); };
  const workspaceItems: MenuItem[] = [
    { label: user.email, disabled: true },
    { label: '', separator: true },
    { label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', run: () => { const t = theme === 'dark' ? 'light' : 'dark'; set({ theme: t }); storage.set('layr:theme', t); } },
    { label: 'Sign out', run: onLogout },
  ];
  /** File actions open in the app's floating menu (not inside the card, which would clip it). */
  const fileItems = (f: FileMeta): MenuItem[] => f.deletedAt ? [
    { label: 'Restore', run: () => void act(() => api.restore(f.id), 'Restored') },
    { label: 'Delete forever', run: () => { void askConfirm(`Delete "${f.name}" forever?`, { message: 'This cannot be undone.', okLabel: 'Delete forever', danger: true }).then(yes => { if (yes) void act(() => api.deleteForever(f.id), 'Deleted forever'); }); } },
  ] : [
    { label: 'Open', run: () => open(f.id) },
    { label: 'Open prototype', run: () => { window.open(`#/play/${f.id}`, '_blank', 'noopener'); } },
    { label: 'Rename', disabled: f.role === 'viewer', run: () => { void askText('Rename file', f.name, { okLabel: 'Rename' }).then(n => { if (n?.trim()) void act(async () => { await api.patchFile(f.id, { name: n.trim() }); window.dispatchEvent(new CustomEvent('layr:rename', { detail: { id: f.id, name: n.trim() } })); }); }); } },
    { label: 'Duplicate', run: () => void act(() => api.duplicate(f.id), 'Duplicated') },
    { label: '', separator: true },
    ...(f.role === 'owner' ? [
      { label: 'Move to Drafts', disabled: f.projectId === null, run: () => void act(() => api.patchFile(f.id, { projectId: null }), 'Moved to Drafts') },
      ...projects.map(p => ({ label: `Move to ${p.name}`, disabled: f.projectId === p.id, run: () => void act(() => api.patchFile(f.id, { projectId: p.id }), `Moved to ${p.name}`) })),
      { label: '', separator: true },
    ] : []),
    { label: 'Move to trash', disabled: f.role !== 'owner', run: () => void act(() => api.trash(f.id), 'Moved to trash') },
  ];

  const card = (f: FileMeta) => (
    <article key={f.id} className="hcard" onDoubleClick={() => !f.deletedAt && open(f.id)}>
      <div className="hthumb" onClick={() => !f.deletedAt && open(f.id)}>
        {f.hasThumbnail ? <img src={`/api/files/${f.id}/thumbnail?v=${f.updatedAt}`} alt="" loading="lazy" /> : <span className="hph">{f.type === 'designsystem' && <Icon n="components" size={34} />}</span>}
        <span className={'tchip ' + (f.type === 'whiteboard' ? 'wb' : f.type === 'designsystem' ? 'sys' : 'des')}>{f.type === 'whiteboard' ? <JIcon n="sticky" size={12} /> : f.type === 'designsystem' ? <Icon n="components" size={12} /> : <Icon n="frame" size={12} />}{f.type === 'whiteboard' ? 'Whiteboard' : f.type === 'designsystem' ? 'Design system' : 'Design'}</span>
        {f.favorite && <span className="fav-flag" title="Starred"><Icon n="starFill" size={13} /></span>}
        <span className="hover-actions" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <span className="avatar sm" title={f.ownerName}>{f.ownerName[0]?.toUpperCase()}</span>
          <button className={'star' + (f.favorite ? ' on' : '')} aria-label={f.favorite ? 'Remove from starred' : 'Add to starred'} title={f.favorite ? 'Starred' : 'Star'} onClick={() => act(() => api.patchFile(f.id, { favorite: !f.favorite }))}><Icon n={f.favorite ? 'starFill' : 'star'} size={16} /></button>
          <button className="star" aria-label="File actions" onClick={e => menu(e, fileItems(f))}><Icon n="ellipsis" size={16} /></button>
        </span>
      </div>
      <div className="hinfo" onClick={() => !f.deletedAt && open(f.id)}>
        <span className={'ftype ' + (f.type === 'whiteboard' ? 'wb' : 'ds')}>{f.type === 'whiteboard' ? <JIcon n="sticky" size={18} /> : f.type === 'designsystem' ? <Icon n="components" size={18} /> : <Icon n="frame" size={18} />}</span>
        <span className="htext"><b title={f.name}>{f.name}</b><span className="muted">{f.type === 'designsystem' ? 'Design system · ' : ''}{f.role !== 'owner' ? `${f.ownerName} · ` : ''}{projName(f.projectId)} · {f.deletedAt ? 'Deleted' : 'Edited'} {ago(f.deletedAt ?? f.updatedAt)}</span></span>
      </div>
    </article>
  );

  return (
    <div className="home">
      <ContextMenu />
      <HomeSidebar view={view} project={project} onView={v => { setProject(null); setView(v); }} onProject={id => setProject(id)} q={q} setQ={setQ}
        files={allFiles} projects={projects} starred={starred} onOpen={open} theme={theme}
        onTheme={() => { const t = theme === 'dark' ? 'light' : 'dark'; set({ theme: t }); storage.set('layr:theme', t); }} onLogout={onLogout}
        onNewProject={async () => { const n = await askText('New project', '', { placeholder: 'Project name', okLabel: 'Create' }); if (n?.trim()) { await api.createProject(n.trim()).catch(e => toast(e.message, 'error')); loadSide(); } }}
        onRenameProject={async pr => { const n = await askText('Rename project', pr.name, { okLabel: 'Rename' }); if (n?.trim()) { await api.renameProject(pr.id, n.trim()); loadSide(); } }}
        onDeleteProject={async pr => { if (await askConfirm(`Delete project "${pr.name}"?`, { message: 'Its files move to Drafts.', okLabel: 'Delete', danger: true })) { await api.deleteProject(pr.id); if (project === pr.id) setProject(null); loadSide(); void load(); } }} />

      <div className="hcol">
            <main className="hmain">
        {view === 'all' && !project && <HomeHero user={user} files={files} starred={starred} onDesign={() => create({ name: 'Untitled' })} onBoard={() => create({ name: 'Untitled whiteboard', type: 'whiteboard' })} onSystem={() => void createSystem()} onImport={() => importRef.current?.click()} />}
        <div className="hbar">
          <div className="hbar-title">
            <button className="icon-btn" aria-label="Back" title="Back" onClick={() => history.back()}><Icon n="chevR" size={16} className="flip" /></button>
            <button className="icon-btn" aria-label="Forward" title="Forward" onClick={() => history.forward()}><Icon n="chevR" size={16} /></button>
            <h1>{title}</h1>
          </div>
          <span className="spacer" />
          {!(view === 'all' && !project) && <button className="newbtn" aria-label="New file" title="Create a design file, whiteboard or design system, or import" onClick={e => menu(e, [
            { label: 'New design file', run: () => create({ name: 'Untitled' }) },
            { label: 'New whiteboard', run: () => create({ name: 'Untitled whiteboard', type: 'whiteboard' }) },
            { label: 'New design system', run: () => void createSystem() },
            { label: '', separator: true },
            { label: 'Import .fig, .xd or .layr…', run: () => importRef.current?.click() },
          ])}><Icon n="plus" size={14} /> New <Icon n="chevD" size={12} /></button>}
          <Select className="filterbtn" aria-label="Sort" value={sort} onChange={e => setSort(e.target.value)}><option value="">Default order</option><option value="modified">Last modified</option><option value="created">Created</option><option value="name">Name</option></Select>
          <div className="seg viewseg" role="group" aria-label="Layout">
            <button className={layout === 'grid' ? 'on' : ''} aria-label="Grid view" title="Grid" onClick={() => setLayout('grid')}><Icon n="grid" size={16} /></button>
            <button className={layout === 'list' ? 'on' : ''} aria-label="List view" title="List" onClick={() => setLayout('list')}><Icon n="collapse" size={16} /></button>
            <input ref={importRef} type="file" accept={IMPORT_ACCEPT} hidden onChange={async e => {
            const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
            try {
              toast(`Importing ${f.name}…`);
              const r = await importDesignFile(f);
              const id = await createFromImport(r, project);
              open(id);
              if (r.notes.length) toast(`Imported with notes: ${r.notes.join('; ')}`);
            } catch (x) { toast(`Import failed: ${(x as Error).message}`, 'error'); }
          }} />
        </div>
        </div>

        {view === 'templates' && !project ? (
          <div className="hgrid">
            <article className="hcard"><div className="hthumb" onClick={() => create({ name: 'Untitled' })}><span className="hph"><Icon n="plus" size={34} /></span></div><div className="hinfo" onClick={() => create({ name: 'Untitled' })}><span className="ftype"><Icon n="frame" size={18} /></span><span className="htext"><b>Blank design file</b><span className="muted">Empty canvas</span></span></div></article>
            {TEMPLATES.map(t => <article key={t.id} className="hcard"><div className="hthumb" onClick={() => create({ name: t.name.split(' (')[0], import: { document: t.build(), assets: {} } })}><span className="hph"><Icon n="frame" size={34} /></span></div><div className="hinfo" onClick={() => create({ name: t.name.split(' (')[0], import: { document: t.build(), assets: {} } })}><span className="ftype"><Icon n="frame" size={18} /></span><span className="htext"><b>{t.name.split(' (')[0]}</b><span className="muted">Template · {t.name.match(/\((.*)\)/)?.[1]}</span></span></div></article>)}
          </div>
        ) : files === null ? <div className="muted">Loading…</div> : shown.length === 0 ? (
          <div className="blankstate"><BrandMark size={44} /><h3>{q ? 'Nothing matches your search' : view === 'trash' ? 'Trash is empty' : view === 'systems' ? 'No design systems yet' : view === 'designs' ? 'No design files yet' : view === 'boards' ? 'No whiteboards yet' : 'No files yet'}</h3><p className="muted">{q ? 'Try a different name.' : view === 'systems' ? 'Create one to get buttons, inputs, cards and 70+ more components, ready to link to any design file.' : 'Create a design file to start.'}</p>{!q && view === 'systems' && <button className="btn primary" onClick={() => void createSystem()}><Icon n="plus" size={13} /> Design system</button>}{!q && view !== 'trash' && !(view === 'all' && !project) && view !== 'systems' && <button className="btn primary" onClick={() => create({ name: 'Untitled' })}>New design file</button>}</div>
        ) : layout === 'grid' ? <div className="hgrid">{shown.map(card)}</div> : (
          <div className="filelist" role="table">
            <div className="lrow head" role="row"><span /><span>Name</span><span>Location</span><span>Edited</span><span /></div>
            {shown.map(f => (
              <div key={f.id} className="lrow" role="row" onDoubleClick={() => !f.deletedAt && open(f.id)}>
                <span className="lthumb" onClick={() => !f.deletedAt && open(f.id)}>{f.hasThumbnail ? <img src={`/api/files/${f.id}/thumbnail?v=${f.updatedAt}`} alt="" loading="lazy" /> : f.type === 'whiteboard' ? <JIcon n="sticky" size={18} /> : f.type === 'designsystem' ? <Icon n="components" size={18} /> : <Icon n="frame" size={18} />}</span>
                <span className="lname2" onClick={() => !f.deletedAt && open(f.id)}>{f.name}{f.role !== 'owner' && <i className="badge inline">{f.role}</i>}</span>
                <span className="muted">{projName(f.projectId)}</span>
                <span className="muted">{ago(f.updatedAt)}</span>
                <span className="card-btns on" onPointerDown={e => e.stopPropagation()}>
                  <button className={'icon-btn' + (f.favorite ? ' on' : '')} title="Star" aria-label={f.favorite ? 'Remove from starred' : 'Add to starred'} onClick={() => act(() => api.patchFile(f.id, { favorite: !f.favorite }))}><Icon n={f.favorite ? 'starFill' : 'star'} size={15} /></button>
                  <button className="icon-btn" aria-label="File actions" onClick={e => menu(e, fileItems(f))}><Icon n="ellipsis" size={15} /></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
      </div>
    </div>
  );
}
