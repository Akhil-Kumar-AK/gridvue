import { booleanOperation, flattenSelection, type BoolOp } from '@layr/core';
import type { IconName } from '../icons';
import { useEditor } from './state';
import type { EditorSession } from './session';

export interface BoolItem { id: string; label: string; icon: IconName; shortcut: string; op?: BoolOp }
const sk = (k: string) => `⌥⇧${k}`;
export const BOOL_ITEMS: BoolItem[] = [
  { id: 'bool.union', op: 'UNION', label: 'Union', icon: 'boolUnion', shortcut: sk('U') },
  { id: 'bool.subtract', op: 'SUBTRACT', label: 'Subtract', icon: 'boolSubtract', shortcut: sk('S') },
  { id: 'bool.intersect', op: 'INTERSECT', label: 'Intersect', icon: 'boolIntersect', shortcut: sk('I') },
  { id: 'bool.exclude', op: 'EXCLUDE', label: 'Exclude', icon: 'boolExclude', shortcut: sk('E') },
  { id: 'bool.flatten', label: 'Flatten', icon: 'boolFlatten', shortcut: sk('F') },
];

/** Run a boolean item on the selection; selects the result (or explains what is missing). */
export function runBoolItem(session: EditorSession, ids: string[], item: BoolItem) {
  const { set, toast } = useEditor.getState();
  const g = item.op ? booleanOperation(session.store, ids, item.op) : flattenSelection(session.store, ids);
  if (g) set({ selection: [g] }); else toast(item.op ? 'Select two or more shapes to combine' : 'Select shapes to flatten', 'error');
}
