import {
  DocStore, addNode, defaultNode, insertLibraryComponent, newId, pageIds, solid, subtreeIds, topLevelOnly, worldBounds, ROOT_ID,
  type DocumentData, type ExportSetting, type SceneNode, type TextProps,
} from '@layr/core';
import { migrate } from '@layr/core';
import { ApiError, api, buildNativeFile, download, type FileMeta } from '../api';
import { ImageCache } from '../engine/images';
import { autoTextSize } from '../engine/text';
import { decodeFigmaBuffer, figmaBufferFromHtml } from '../figma/decode';
import { convertFigma } from '../figma/convert';
import { exportFig } from '../interchange/fig';
import { exportXd } from '../interchange/xd';
import { exportNodes, renderThumbnail } from '../engine/exportImage';
import { storage, useEditor } from './state';
import { cachedLibrary } from '../designsystem/library';

/** The open file (used by pickers that need document colours / variables). */
export let activeSession: EditorSession | null = null;
const BACKUP = (id: string) => `layr:backup:${id}`;

/** One open file: document store + autosave + local recovery. */
export class EditorSession {
  store: DocStore;
  images: ImageCache;
  revision: number;
  role: FileMeta['role'];
  readonly file: FileMeta;
  clipboard: SceneNode[][] = [];
  requestRender: () => void = () => {};
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private backupTimer: ReturnType<typeof setTimeout> | null = null;
  private thumbTimer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  private savedVersion = 0;
  private retry = 0;
  private disposed = false;
  recovered = false;

  constructor(file: FileMeta, role: FileMeta['role'], doc: DocumentData) {
    this.file = file; this.role = role; this.revision = file.revision;
    activeSession = this;
    if (import.meta.env.DEV) (window as unknown as { __layr: EditorSession; __editorCamera: () => unknown }).__layr = this; 
    if (import.meta.env.DEV) void import('@layr/core').then(m => { (window as unknown as { __core: unknown }).__core = m; });
    if (import.meta.env.DEV) (window as unknown as { __editorCamera: () => unknown }).__editorCamera = () => useEditor.getState().camera; // debugging handles for browser tests
    this.images = new ImageCache(() => this.requestRender());
    // Crash recovery: a local backup is only trusted if it was based on the revision we just loaded.
    try {
      const raw = storage.get(BACKUP(file.id), '');
      if (raw && role !== 'viewer') {
        const b = JSON.parse(raw) as { base: number; doc: DocumentData };
        if (b.base === file.revision && JSON.stringify(b.doc) !== JSON.stringify(doc)) { doc = migrate(b.doc); this.recovered = true; }
        else if (b.base !== file.revision) { try { localStorage.removeItem(BACKUP(file.id)); } catch { /* ignore */ } }
      }
    } catch { /* corrupt backup ignored */ }
    this.store = new DocStore(doc);
    this.store.textFit = autoTextSize; // lets auto layout size text nodes
    this.savedVersion = this.recovered ? -1 : this.store.version;
    const pid = pageIds(doc)[0];
    useEditor.getState().set({ pageId: pid, selection: [], saveStatus: role === 'viewer' ? 'readonly' : this.recovered ? 'dirty' : 'saved', saveMessage: '', tool: 'select', editingTextId: null });
    this.store.subscribe(() => this.onChange());
    window.addEventListener('beforeunload', this.beforeUnload);
    if (this.recovered) { this.scheduleSave(200); useEditor.getState().toast('Recovered unsaved changes from this device'); }
  }

  get canEdit() { return this.role !== 'viewer'; }
  get pageId() { return useEditor.getState().pageId; }

  private beforeUnload = (e: BeforeUnloadEvent) => {
    if (this.canEdit && this.store.version !== this.savedVersion) { this.writeBackup(); e.preventDefault(); e.returnValue = ''; }
  };

  dispose() {
    this.disposed = true;
    window.removeEventListener('beforeunload', this.beforeUnload);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.backupTimer) clearTimeout(this.backupTimer);
    if (this.thumbTimer) clearTimeout(this.thumbTimer);
  }

  private onChange() {
    // prune selection of nodes that no longer exist (undo/delete)
    const ui = useEditor.getState();
    const sel = ui.selection.filter(id => this.store.doc.nodes[id]);
    const patch: Record<string, unknown> = {};
    if (sel.length !== ui.selection.length) patch.selection = sel;
    if (!this.store.doc.nodes[ui.pageId]) patch.pageId = pageIds(this.store.doc)[0];
    if (Object.keys(patch).length) ui.set(patch);
    this.requestRender();
    if (!this.canEdit) return;
    if (this.store.version !== this.savedVersion) {
      if (ui.saveStatus === 'saved') ui.set({ saveStatus: 'dirty' });
      this.scheduleSave(900);
      if (this.backupTimer) clearTimeout(this.backupTimer);
      this.backupTimer = setTimeout(() => this.writeBackup(), 400);
    }
  }

  private writeBackup() {
    if (this.store.inTransaction) { // never snapshot a half-finished gesture
      if (this.backupTimer) clearTimeout(this.backupTimer);
      this.backupTimer = setTimeout(() => this.writeBackup(), 400);
      return;
    }
    storage.set(BACKUP(this.file.id), JSON.stringify({ base: this.revision, doc: this.store.doc, at: Date.now() }));
  }

  private scheduleSave(ms: number) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), ms);
  }

  async saveNow() { if (this.saveTimer) clearTimeout(this.saveTimer); await this.save(); }

  private async save() {
    if (this.disposed || !this.canEdit || this.saving) return;
    const ui = useEditor.getState();
    if (ui.saveStatus === 'conflict') return;
    if (this.store.inTransaction) return this.scheduleSave(300); // never persist a half-finished gesture
    const v = this.store.version;
    if (v === this.savedVersion) return;
    this.saving = true; ui.set({ saveStatus: 'saving', saveMessage: '' });
    try {
      const r = await api.saveDoc(this.file.id, this.revision, this.store.doc);
      this.revision = r.revision; this.savedVersion = v; this.retry = 0;
      if (this.store.version === v) {
        useEditor.getState().set({ saveStatus: 'saved' });
        try { localStorage.removeItem(BACKUP(this.file.id)); } catch { /* ignore */ }
      } else { useEditor.getState().set({ saveStatus: 'dirty' }); this.scheduleSave(300); }
      this.scheduleThumbnail();
    } catch (e) {
      const err = e as ApiError;
      this.writeBackup();
      if (err.status === 409) useEditor.getState().set({ saveStatus: 'conflict', saveMessage: 'This file was changed elsewhere. Your edits are kept on this device.' });
      else if (err.status === 403 || err.status === 404) useEditor.getState().set({ saveStatus: 'error', saveMessage: err.status === 403 ? 'You no longer have edit access.' : 'This file is no longer available.' });
      else if (err.status === 422 || err.status === 413) useEditor.getState().set({ saveStatus: 'error', saveMessage: err.message });
      else { this.retry++; useEditor.getState().set({ saveStatus: 'offline', saveMessage: err.message }); this.scheduleSave(Math.min(15000, 1500 * 2 ** this.retry)); }
    } finally { this.saving = false; }
  }

  private scheduleThumbnail() {
    if (this.thumbTimer) clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(async () => {
      try { const b = await renderThumbnail(this.store.doc, this.pageId, this.images); if (b) await api.uploadThumbnail(this.file.id, b); else await api.deleteThumbnail(this.file.id); } catch { /* thumbnails are best-effort */ }
    }, 4000);
  }

  // ---- edit helpers ----
  fitText(ids: string[]) {
    for (const id of ids) {
      const n = this.store.doc.nodes[id];
      if (n?.type !== 'TEXT') continue;
      const s = autoTextSize(n);
      if (s && (Math.abs((s.width ?? n.width) - n.width) > 0.01 || Math.abs(s.height - n.height) > 0.01)) this.store.apply({ t: 'set', id, props: { ...(s.width !== undefined ? { width: s.width } : {}), height: s.height } });
    }
  }
  updateText(ids: string[], patch: Partial<TextProps>, label = 'Edit text') {
    this.store.transact(label, () => {
      for (const id of ids) { const n = this.store.doc.nodes[id]; if (n?.text) this.store.apply({ t: 'set', id, props: { text: { ...n.text, ...patch } } }); }
      this.fitText(ids);
    });
  }

  /** Deepest visible clipping frame that is not inside `exclude`. */
  insertionParent(): string {
    const sel = useEditor.getState().selection;
    for (const id of sel) {
      const n = this.store.doc.nodes[id];
      if (n && (n.type === 'FRAME' || n.type === 'COMPONENT')) return n.id;
      if (n?.parent && ['FRAME', 'COMPONENT', 'COMPONENT_SET'].includes(this.store.doc.nodes[n.parent].type)) return n.parent;
    }
    return this.pageId;
  }

  /**
   * Put a component of the linked design system on the canvas (copying it into this file on first use) and select the new instance.
   * `at` is a world point to centre it on (drop position); without it the middle of the view is used.
   */
  insertFromLibrary(libId: string, nodeId: string, at?: { x: number; y: number }, parentId?: string): string | null {
    const ui = useEditor.getState();
    if (!this.canEdit) { ui.toast('View-only: you cannot edit this file', 'error'); return null; }
    const lib = cachedLibrary(libId);
    if (!lib) { ui.toast('The design system is still loading, try again in a moment', 'error'); return null; }
    try {
      const parent = parentId && this.store.doc.nodes[parentId] ? parentId : this.insertionParent();
      const pb = this.store.doc.nodes[parent].type === 'PAGE' ? { x: 0, y: 0 } : worldBounds(this.store.doc, parent);
      const cam = ui.camera;
      const c = at ?? { x: cam.x + (window.innerWidth / 2) / cam.zoom, y: cam.y + (window.innerHeight / 2) / cam.zoom };
      let id: string | null = null;
      this.store.transact('Add component from design system', () => {
        id = insertLibraryComponent(this.store, lib.doc, libId, nodeId, { parent, x: c.x - pb.x, y: c.y - pb.y });
        if (id) { const n = this.store.doc.nodes[id]; this.store.apply({ t: 'set', id, props: { x: n.x - n.width / 2, y: n.y - n.height / 2 } }); }
      });
      if (id) ui.set({ selection: [id], tool: 'select', pageId: this.pageOfNode(id) ?? ui.pageId });
      return id;
    } catch (e) { ui.toast((e as Error).message, 'error'); return null; }
  }
  private pageOfNode(id: string): string | null { for (let n: SceneNode | undefined = this.store.doc.nodes[id]; n; n = n.parent ? this.store.doc.nodes[n.parent] : undefined) if (n.type === 'PAGE') return n.id; return null; }

  async insertImage(file: File, at?: { x: number; y: number }) {
    const ui = useEditor.getState();
    if (!this.canEdit) return ui.toast('View-only: you cannot edit this file', 'error');
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return ui.toast('Unsupported image type (PNG, JPEG, GIF or WebP)', 'error');
    try {
      const up = await api.uploadAsset(this.file.id, file);
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not decode image')); i.src = URL.createObjectURL(file); });
      this.images.put(up.assetId, img);
      const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
      const parentId = this.insertionParent();
      const parent = this.store.doc.nodes[parentId];
      const cam = ui.camera;
      const center = at ?? { x: cam.x + (window.innerWidth / 2) / cam.zoom, y: cam.y + (window.innerHeight / 2) / cam.zoom };
      const pb = parent.type === 'PAGE' ? { x: 0, y: 0 } : worldBounds(this.store.doc, parentId);
      const node = defaultNode('RECT', { name: file.name.replace(/\.[^.]+$/, ''), width: w, height: h, x: center.x - pb.x - w / 2, y: center.y - pb.y - h / 2, fills: [{ type: 'IMAGE', assetId: up.assetId, scaleMode: 'FILL', opacity: 1, visible: true }] });
      this.store.transact('Place image', () => { this.store.apply({ t: 'asset', id: up.assetId, asset: { name: file.name, mime: up.mime, width: img.naturalWidth, height: img.naturalHeight } }); addNode(this.store, node, parentId); });
      ui.set({ selection: [node.id], tool: 'select' });
    } catch (e) { ui.toast((e as Error).message, 'error'); }
  }

  /** Paste layers copied in Figma (its clipboard HTML carries the layers as a compressed kiwi buffer). Returns false if the HTML is not from Figma. */
  pasteFigma(html: string): boolean {
    const buf = figmaBufferFromHtml(html);
    if (!buf) return false;
    const ui = useEditor.getState();
    if (!this.canEdit) { ui.toast('View-only: you cannot edit this file', 'error'); return true; }
    try {
      const msg = decodeFigmaBuffer(buf);
      if (import.meta.env.DEV) (window as unknown as { __figmaPaste?: unknown }).__figmaPaste = msg; // inspect what Figma sent: __figmaPaste.nodeChanges
      const { trees, notes, count } = convertFigma(msg);
      if (!trees.length) { ui.toast('Nothing to paste: the Figma selection had no supported layers', 'error'); return true; }
      const roots = trees.map(t => t[0]);
      const x0 = Math.min(...roots.map(r => r.x)), y0 = Math.min(...roots.map(r => r.y)), x1 = Math.max(...roots.map(r => r.x + r.width)), y1 = Math.max(...roots.map(r => r.y + r.height));
      const cam = ui.camera, cx = cam.x + window.innerWidth / 2 / cam.zoom, cy = cam.y + window.innerHeight / 2 / cam.zoom;
      const dx = Math.round(cx - (x0 + x1) / 2), dy = Math.round(cy - (y0 + y1) / 2);
      const parent = this.pageId, ids: string[] = [];
      this.store.transact('Paste from Figma', () => {
        for (const tree of trees) {
          tree[0].parent = parent; tree[0].x += dx; tree[0].y += dy;
          this.store.apply({ t: 'insert', nodes: tree, parent, index: this.store.doc.nodes[parent].children.length });
          ids.push(tree[0].id);
        }
      });
      ui.set({ selection: ids, tool: 'select' });
      ui.toast(`Pasted ${count} layer${count === 1 ? '' : 's'} from Figma${notes.length ? ` — ${notes[0]}${notes.length > 1 ? ` (+${notes.length - 1} more note${notes.length > 2 ? 's' : ''})` : ''}` : ''}`);
    } catch (e) { console.error('Figma paste failed', e); ui.toast(`Could not read the Figma clipboard: ${(e as Error).message}`, 'error'); }
    return true;
  }

  async replaceImage(ids: string[], file: File) {
    const ui = useEditor.getState();
    try {
      const up = await api.uploadAsset(this.file.id, file);
      this.store.transact('Replace image', () => {
        this.store.apply({ t: 'asset', id: up.assetId, asset: { name: file.name, mime: up.mime } });
        for (const id of ids) { const n = this.store.doc.nodes[id]; this.store.apply({ t: 'set', id, props: { fills: n.fills.map(f => (f.type === 'IMAGE' ? { ...f, assetId: up.assetId } : f)) } }); }
      });
    } catch (e) { ui.toast((e as Error).message, 'error'); }
  }

  copy(ids: string[]) {
    const tops = topLevelOnly(this.store, ids);
    this.clipboard = tops.map(t => subtreeIds(this.store, t).map(i => structuredClone(this.store.doc.nodes[i])));
    return tops.length;
  }
  paste(): string[] {
    if (!this.clipboard.length) return [];
    const out: string[] = [];
    this.store.transact('Paste', () => {
      for (const group of this.clipboard) {
        const map = new Map(group.map(n => [n.id, newId()]));
        const nodes = group.map(n => ({ ...structuredClone(n), id: map.get(n.id)!, parent: n.parent && map.has(n.parent) ? map.get(n.parent)! : n.parent, children: n.children.map(c => map.get(c)!) }));
        const origParent = group[0].parent;
        const parent = origParent && this.store.doc.nodes[origParent] ? origParent : this.pageId;
        this.store.apply({ t: 'insert', nodes, parent, index: this.store.doc.nodes[parent].children.length });
        out.push(nodes[0].id);
      }
    });
    return out;
  }

  addPage() {
    const n = pageIds(this.store.doc).length + 1;
    const p = defaultNode('PAGE', { name: `Page ${n}` });
    addNode(this.store, p, ROOT_ID);
    useEditor.getState().set({ pageId: p.id, selection: [] });
  }

  /** Export the selection (or page) using the given settings; defaults are used when none is stored. */
  async exportSelection(setting: ExportSetting) {
    const ui = useEditor.getState();
    const ids = ui.selection.length ? topLevelOnly(this.store, ui.selection) : this.store.doc.nodes[ui.pageId].children;
    if (!ids.length) return ui.toast('Nothing to export', 'error');
    try {
      const blob = await exportNodes(this.store.doc, ids, this.images, setting);
      const base = ids.length === 1 ? this.store.doc.nodes[ids[0]].name : this.store.doc.nodes[ui.pageId].name;
      download(blob, `${base}${setting.suffix}.${setting.format.toLowerCase()}`);
    } catch (e) { ui.toast(`Export failed: ${(e as Error).message}`, 'error'); }
  }

  private assetBytes = async (id: string) => {
    const r = await fetch(`/api/assets/${id}`);
    if (!r.ok) throw new Error(`Could not fetch asset ${id}`);
    return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get('content-type') ?? 'application/octet-stream' };
  };
  /** Export every page as a Figma file (.fig): layers, styles, text, vectors and images. */
  async exportFigFile() {
    const ui = useEditor.getState();
    try { ui.toast('Preparing Figma file…'); const bytes = await exportFig(this.store.doc, this.file.name, this.assetBytes); download(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), `${this.file.name}.fig`); }
    catch (e) { ui.toast(`Export failed: ${(e as Error).message}`, 'error'); }
  }
  /** Export the current page as an Adobe XD file: top-level frames become artboards. */
  async exportXdFile() {
    const ui = useEditor.getState();
    try { ui.toast('Preparing XD file…'); const bytes = await exportXd(this.store.doc, ui.pageId, this.file.name, this.assetBytes); download(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), `${this.file.name}.xd`); }
    catch (e) { ui.toast(`Export failed: ${(e as Error).message}`, 'error'); }
  }

  async exportNative() {
    try {
      const nf = await buildNativeFile(this.file, this.store.doc);
      download(new Blob([JSON.stringify(nf)], { type: 'application/json' }), `${this.file.name}.layr`);
    } catch (e) { useEditor.getState().toast(`Export failed: ${(e as Error).message}`, 'error'); }
  }
}
void solid;
