import type { BoardData } from '@layr/core';
import { objectUrl } from '../net';
import { api } from '../api';
import { renderBoardCanvas } from '../jam/render';

/** Loads image assets served by the API and caches decoded bitmaps. */
export class ImageCache {
  private map = new Map<string, HTMLImageElement | 'loading' | 'error'>();
  constructor(private onLoad: () => void = () => {}) {}
  /** `path` overrides where the bytes come from (used for embedded whiteboard previews); the key is then any unique string. */
  get(assetId: string, path?: string): HTMLImageElement | null {
    const cur = this.map.get(assetId);
    if (cur && cur !== 'loading' && cur !== 'error') return cur;
    if (!cur) this.load(assetId, path);
    return null;
  }
  private boards = new Map<string, BoardData | 'loading' | 'error'>();
  private boardCv = new Map<string, { key: string; cv: HTMLCanvasElement }>();
  /** a whiteboard's content for a card in a design file (fetched once, then drawn live); null while loading */
  board(fileId: string): BoardData | null {
    const cur = this.boards.get(fileId);
    if (cur && cur !== 'loading' && cur !== 'error') return cur;
    if (!cur) { this.boards.set(fileId, 'loading'); api.getFile(fileId).then(r => { this.boards.set(fileId, r.document as BoardData); this.onLoad(); }).catch(() => { this.boards.set(fileId, 'error'); this.onLoad(); }); }
    return null;
  }
  boardFailed(fileId: string) { return this.boards.get(fileId) === 'error'; }
  /** the board drawn at w x h CSS px and `dpr`, cached until the size, scale, theme or content changes */
  boardCanvas(fileId: string, w: number, h: number, dpr: number, dark: boolean): HTMLCanvasElement | null {
    const b = this.board(fileId); if (!b) return null;
    const d = Math.min(dpr, 3000 / Math.max(w, h, 1));
    const key = `${Math.round(w)}x${Math.round(h)}@${d.toFixed(2)}${dark ? 'd' : 'l'}:${b.order.length}`;
    const hit = this.boardCv.get(fileId); if (hit && hit.key === key) return hit.cv;
    const cv = renderBoardCanvas(b, Math.round(w), Math.round(h), d, dark, () => { this.boardCv.delete(fileId); this.onLoad(); });
    this.boardCv.set(fileId, { key, cv }); return cv;
  }
  /** forget cached pictures whose key starts with `prefix` so they load again (e.g. a whiteboard preview that was just re-saved) */
  /** changes whenever previews are refreshed; used to bypass the browser's HTTP cache for whiteboard previews */
  embedRev = Date.now();
  refresh(prefix: string) { this.embedRev = Date.now(); for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k); if (prefix.startsWith('embed')) { this.boards.clear(); this.boardCv.clear(); } this.onLoad(); }
  /** true once loading this key has failed (e.g. a whiteboard that has no preview picture yet) */
  failed(key: string) { return this.map.get(key) === 'error'; }
  private load(assetId: string, path?: string) {
    this.map.set(assetId, 'loading');
    const img = new Image();
    img.onload = () => { this.map.set(assetId, img); this.onLoad(); };
    img.onerror = () => { this.map.set(assetId, 'error'); };
    void objectUrl(path ?? `/api/assets/${assetId}`).then(u => { if (u) img.src = u; else this.map.set(assetId, 'error'); });
  }
  /** Seed from an already-decoded image (e.g. right after upload). */
  put(assetId: string, img: HTMLImageElement) { this.map.set(assetId, img); }
  async ensure(ids: string[]): Promise<void> {
    await Promise.all(ids.map(id => new Promise<void>(res => {
      const cur = this.map.get(id);
      if (cur && cur !== 'loading') return res();
      const prevCb = this.onLoad;
      this.get(id);
      const t = setInterval(() => { const c = this.map.get(id); if (c && c !== 'loading') { clearInterval(t); this.onLoad = prevCb; res(); } }, 20);
      setTimeout(() => { clearInterval(t); res(); }, 8000);
    })));
  }
}
