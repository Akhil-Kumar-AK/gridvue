import type { BoardData } from '@layr/core';
import { ApiError, api, type FileMeta } from '../api';
import { JamStore, useJam } from './store';
import { exportPng } from './render';
import { useEditor } from '../editor/state';

/** One open whiteboard: store + debounced autosave with revision checking + thumbnail. */
export class JamSession {
  store: JamStore; file: FileMeta; role: FileMeta['role']; revision: number;
  private timer: ReturnType<typeof setTimeout> | null = null; private saving: Promise<void> | null = null; private disposed = false;
  constructor(file: FileMeta, role: FileMeta['role'], board: BoardData) {
    this.file = file; this.role = role; this.revision = file.revision; this.store = new JamStore(board);
    useJam.getState().set({ saveStatus: role === 'viewer' ? 'readonly' : 'saved', saveMessage: '', selection: [], tool: 'select', editing: null, panel: null });
    this.store.onChange = () => { if (this.role === 'viewer') return; const u = useJam.getState(); if (u.saveStatus === 'saved' || u.saveStatus === 'error') u.set({ saveStatus: 'dirty' }); this.schedule(700); };
    window.addEventListener('beforeunload', this.flushOnUnload);
    if (!board.order.length && file.hasThumbnail && role !== 'viewer') void api.deleteThumbnail(file.id).catch(() => {}); // clear a preview left behind by an earlier version
  }
  private flushOnUnload = () => { if (useJam.getState().saveStatus === 'dirty' && this.role !== 'viewer') void api.saveDoc(this.file.id, this.revision, this.store.board, true).catch(() => {}); };
  private schedule(ms: number) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => void this.saveNow(), ms); }
  async saveNow(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.saving) { await this.saving; }
    const ui = useJam.getState(); if (ui.saveStatus !== 'dirty' && ui.saveStatus !== 'error') return;
    const bad = this.store.valid(); if (bad) { ui.set({ saveStatus: 'error', saveMessage: `Board is invalid and was not saved: ${bad}` }); return; }
    ui.set({ saveStatus: 'saving' });
    const v = this.store.version;
    this.saving = (async () => {
      try {
        const r = await api.saveDoc(this.file.id, this.revision, this.store.board);
        this.revision = r.revision;
        useJam.getState().set(this.store.version === v ? { saveStatus: 'saved', saveMessage: '' } : { saveStatus: 'dirty' });
        if (this.store.version !== v) this.schedule(300);
        this.scheduleThumb();
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 409) useJam.getState().set({ saveStatus: 'conflict', saveMessage: 'This board was changed elsewhere. Your edits are kept in this tab.' });
        else { useJam.getState().set({ saveStatus: 'error', saveMessage: err.message }); this.schedule(4000); }
      } finally { this.saving = null; }
    })();
    await this.saving;
  }
  private thumbTimer: ReturnType<typeof setTimeout> | null = null;
  /** Refresh the dashboard preview shortly after saves settle (trailing, so the last state always wins). */
  private scheduleThumb() { if (this.thumbTimer) clearTimeout(this.thumbTimer); this.thumbTimer = setTimeout(() => { this.thumbTimer = null; void this.thumbnail(); }, 2500); }
  async thumbnail() {
    try {
      if (!this.store.board.order.length) { await api.deleteThumbnail(this.file.id); return; } // emptied board: drop the stale preview
      const b = await exportPng(this.store.board, null, false, 0.3, 480); if (b) await api.uploadThumbnail(this.file.id, b);
    } catch { /* best effort */ }
  }
  dispose() { this.disposed = true; if (this.thumbTimer) { clearTimeout(this.thumbTimer); this.thumbTimer = null; void this.thumbnail(); } if (this.timer) clearTimeout(this.timer); window.removeEventListener('beforeunload', this.flushOnUnload); }
}
export const toast = (t: string, k?: 'info' | 'error') => useEditor.getState().toast(t, k);
