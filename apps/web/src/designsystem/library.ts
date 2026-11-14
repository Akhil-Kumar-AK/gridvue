import { buildDefaultDesignSystem, type DocumentData } from '@layr/core';
import { api, type FileMeta } from '../api';
import { autoTextSize } from '../engine/text';
import { ImageCache } from '../engine/images';
import { renderNodes } from '../engine/exportImage';

/** Create a new design system file pre-filled with the default component library. */
export async function createDesignSystem(projectId: string | null = null, name = 'Design system'): Promise<FileMeta> {
  const document = buildDefaultDesignSystem(autoTextSize);
  return (await api.createFile({ name, type: 'designsystem', projectId, import: { document, assets: {} } })).file;
}

interface Loaded { file: FileMeta; doc: DocumentData; at: number }
const cache = new Map<string, Loaded>();
const inflight = new Map<string, Promise<Loaded>>();
const TTL = 30_000;

export const cachedLibrary = (id: string): Loaded | undefined => cache.get(id);

/** Fetch a design system document (cached briefly; `force` always refetches). */
export function loadLibrary(id: string, force = false): Promise<Loaded> {
  const hit = cache.get(id);
  if (hit && !force && Date.now() - hit.at < TTL) return Promise.resolve(hit);
  let p = inflight.get(id);
  if (!p) {
    p = api.getFile(id).then(r => {
      if (r.file.type !== 'designsystem') throw new Error('The linked file is not a design system');
      const l: Loaded = { file: r.file, doc: r.document as DocumentData, at: Date.now() };
      cache.set(id, l); previews.forEach((_, k) => { if (k.startsWith(`${id}:`)) previews.delete(k); });
      return l;
    }).finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

// ---- component previews (rendered with the same renderer as the canvas) ----
export interface Preview { url: string; w: number; h: number }
const previews = new Map<string, Preview>();
const images = new ImageCache(() => {});
export async function previewOf(libId: string, doc: DocumentData, nodeId: string): Promise<Preview | null> {
  const key = `${libId}:${nodeId}`;
  const hit = previews.get(key);
  if (hit) return hit;
  try {
    const n = doc.nodes[nodeId];
    const scale = Math.min(2, 560 / Math.max(1, n.width), 360 / Math.max(1, n.height));
    const canvas = await renderNodes(doc, [nodeId], images, scale);
    const p: Preview = { url: canvas.toDataURL('image/png'), w: canvas.width / scale, h: canvas.height / scale };
    previews.set(key, p); return p;
  } catch { return null; }
}

/** drag-and-drop payload type for a design-system component dragged from the Assets panel */
export const DS_MIME = 'application/x-layr-component';
