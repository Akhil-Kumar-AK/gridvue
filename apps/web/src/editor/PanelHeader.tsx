import { useSyncExternalStore } from 'react';
import { useEditor } from './state';
import type { Action } from './actions';
import type { CanvasController } from './controller';
import type { EditorSession } from './session';
import { Icon } from '../icons';

/** Top of the right panel: account, present and share on one row; Design / Prototype and zoom on the next. */
export function PanelHeader({ session, actions, ctrl, present, onShare }: { session: EditorSession; actions: Action[]; ctrl: CanvasController | null; present: () => void; onShare: () => void }) {
  const store = session.store;
  useSyncExternalStore(store.subscribe.bind(store), () => store.version);
  const mode = useEditor(s => s.mode), set = useEditor(s => s.set), userName = useEditor(s => s.userName);
  const zoom = useEditor(s => s.camera.zoom);
  const a = (id: string) => actions.find(x => x.id === id)!;
  const menuAt = (e: React.MouseEvent, items: { label: string; shortcut?: string; disabled?: boolean; run?: () => void }[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    set({ menu: { x: Math.min(r.left, window.innerWidth - 240), y: r.bottom + 6, items } });
  };
  return (
    <div className="rhead">
      <div className="rrow">
        <button className="avatar-btn" aria-label="Account" title={userName} onClick={e => menuAt(e, [{ label: userName || 'Signed in', disabled: true }, { label: session.role === 'owner' ? 'Owner' : session.role === 'editor' ? 'Can edit' : 'Can view', disabled: true }])}>
          <span className="avatar">{(userName || '?')[0].toUpperCase()}</span><span className="chev"><Icon n="chevD" size={13} /></span>
        </button>
        <span className="spacer" />
        <span className="play-split">
          <button className="icon-btn squarebtn" title="Present prototype (⌥⌘↵)" aria-label="Present prototype" onClick={present}><Icon n="play" size={18} /></button>
          <button className="icon-btn caretbtn" aria-label="Present options" title="Present options" onClick={e => menuAt(e, [{ label: 'Present prototype', shortcut: '⌥⌘↵', run: present }])}><Icon n="chevD" size={13} /></button>
        </span>
        {session.role === 'owner' ? <button className="btn primary share" onClick={onShare}>Share</button> : <span className="muted small role">{session.role}</span>}
      </div>
      <div className="rrow modes">
        <div className="mode-tabs" role="group" aria-label="Mode">
          <button className={mode === 'design' ? 'on' : ''} aria-pressed={mode === 'design'} onClick={() => set({ mode: 'design' })}>Design</button>
          <button className={mode === 'prototype' ? 'on' : ''} aria-pressed={mode === 'prototype'} onClick={() => { ctrl?.cancelGesture(); ctrl?.exitVectorEdit(); set({ mode: 'prototype', tool: 'select' }); }}>Prototype</button>
        </div>
        <span className="spacer" />
        <button className="zoom-btn" data-testid="zoom-level" aria-label="Zoom level" title="Zoom options" onClick={e => menuAt(e, ['view.in', 'view.out', 'view.100', 'view.fit', 'view.selection'].map(id => ({ label: a(id).label, shortcut: a(id).shortcut, disabled: !a(id).enabled(), run: a(id).run })))}>{Math.round(zoom * 100)}%<Icon n="chevD" size={13} /></button>
      </div>
    </div>
  );
}
