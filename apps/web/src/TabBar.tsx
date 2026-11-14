import { useEffect, useRef } from 'react';
import { Icon } from './icons';
import { JIcon } from './jam/icons';
import { api } from './api';
import { useEditor, storage } from './editor/state';

export interface Tab { id: string; name: string; type?: string }

export function loadTabs(): Tab[] { try { const t = JSON.parse(storage.get('layr:tabs', '[]')); return Array.isArray(t) ? t.filter((x: Tab) => x && typeof x.id === 'string') : []; } catch { return []; } }
export function saveTabs(t: Tab[]) { storage.set('layr:tabs', JSON.stringify(t)); }

/** Browser-style file tabs: Home, one tab per open file, and a + that starts a new design file. */
export function TabBar({ tabs, activeId, onHome, onSelect, onClose, userName, onLogout }: { tabs: Tab[]; activeId: string | null; onHome: () => void; onSelect: (id: string) => void; onClose: (id: string) => void; userName: string; onLogout: () => void }) {
  const toast = useEditor(s => s.toast); const theme = useEditor(s => s.theme);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.querySelector('.tab-item.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [activeId, tabs.length]);
  return (
    <div className="tabbar" role="tablist" aria-label="Open files">
      <button className={'tab-home' + (activeId === null ? ' on' : '')} aria-label="Home" title="Home" onClick={onHome}><Icon n="home" size={20} /></button>
      <div className="tab-scroll" ref={scroller}>
        {tabs.map(t => (
          <div key={t.id} role="tab" aria-selected={t.id === activeId} className={'tab-item' + (t.id === activeId ? ' on' : '')} onClick={() => onSelect(t.id)} onAuxClick={e => { if (e.button === 1) onClose(t.id); }} title={t.name}>
            {t.type === 'whiteboard' ? <JIcon n="sticky" size={16} /> : t.type === 'designsystem' ? <Icon n="components" size={16} /> : <Icon n="frame" size={16} />}<span className="tab-name">{t.name}</span>
            <button className="tab-x" aria-label={`Close ${t.name}`} onClick={e => { e.stopPropagation(); onClose(t.id); }}><Icon n="close" size={12} /></button>
          </div>
        ))}
      </div>
      <button className="tab-plus" aria-label="New design file" title="New design file" onClick={async () => { try { const r = await api.createFile({ name: 'Untitled' }); location.hash = `#/file/${r.file.id}`; } catch (e) { toast((e as Error).message, 'error'); } }}><Icon n="plus" size={18} /></button>
      <button className="tab-user" aria-label="Account menu" title={userName} onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); useEditor.getState().set({ menu: { x: r.right - 210, y: r.bottom + 6, items: [
        { label: userName, disabled: true }, { label: '', separator: true },
        { label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', run: () => { const t = theme === 'dark' ? 'light' : 'dark'; useEditor.getState().set({ theme: t }); storage.set('layr:theme', t); } },
        { label: 'Sign out', run: onLogout },
      ] } }); }}><span className="avatar sm">{userName[0]?.toUpperCase()}</span><span className="tab-user-name">{userName}</span><Icon n="chevD" size={13} /></button>
    </div>
  );
}
