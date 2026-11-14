import { useSyncExternalStore } from 'react';
import type { Action } from './actions';
import type { CanvasController } from './controller';
import type { EditorSession } from './session';
import { Icon } from '../icons';

/** Floating bar over the canvas: undo / redo. (Mode and zoom live in the right panel header.) */
export function CanvasTopBar({ session, actions, ctrl }: { session: EditorSession; actions: Action[]; ctrl: CanvasController | null }) {
  const store = session.store;
  useSyncExternalStore(store.subscribe.bind(store), () => store.version);
  const a = (id: string) => actions.find(x => x.id === id)!;
  return (
    <div className="topfloat">
      <div className="tf-pill">
        <button className="tf-btn" aria-label="Undo" title={`Undo ${store.undoLabel ?? ''} (${a('edit.undo').shortcut})`} disabled={!a('edit.undo').enabled()} onClick={a('edit.undo').run}><Icon n="undo" size={18} /></button>
        <button className="tf-btn" aria-label="Redo" title={`Redo ${store.redoLabel ?? ''} (${a('edit.redo').shortcut})`} disabled={!a('edit.redo').enabled()} onClick={a('edit.redo').run}><Icon n="redo" size={18} /></button>
      </div>
    </div>
  );
}
