/** Loads image assets served by the API and caches decoded bitmaps. */
export class ImageCache {
  private map = new Map<string, HTMLImageElement | 'loading' | 'error'>();
  constructor(private onLoad: () => void = () => {}) {}
  get(assetId: string): HTMLImageElement | null {
    const cur = this.map.get(assetId);
    if (cur && cur !== 'loading' && cur !== 'error') return cur;
    if (!cur) this.load(assetId);
    return null;
  }
  private load(assetId: string) {
    this.map.set(assetId, 'loading');
    const img = new Image();
    img.onload = () => { this.map.set(assetId, img); this.onLoad(); };
    img.onerror = () => { this.map.set(assetId, 'error'); };
    img.src = `/api/assets/${assetId}`;
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
