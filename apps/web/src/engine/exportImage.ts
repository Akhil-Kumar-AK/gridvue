import { apply, boundsOfPoints, unionRects, worldBounds, worldMatrix, ROOT_ID, type DocumentData, type ExportSetting, type Rect } from '@layr/core';
import { drawNode, renderPadding } from './render';
import { ImageCache } from './images';

export function collectAssetIds(doc: DocumentData, ids: string[]): string[] {
  const out = new Set<string>();
  const walk = (id: string) => { const n = doc.nodes[id]; for (const p of [...n.fills, ...n.strokes]) if (p.type === 'IMAGE') out.add(p.assetId); n.children.forEach(walk); };
  ids.forEach(walk);
  return [...out];
}

/** Render nodes (and descendants) into a canvas. Bounds = union of node boxes + effect padding. */
export async function renderNodes(doc: DocumentData, ids: string[], images: ImageCache, scale: number, opts: { background?: string; maxPixels?: number } = {}): Promise<HTMLCanvasElement> {
  await images.ensure(collectAssetIds(doc, ids));
  const pad = Math.max(0, ...ids.map(i => renderPadding(doc.nodes[i])));
  const bs: Rect[] = ids.map(i => worldBounds(doc, i));
  const b = unionRects(bs);
  const box = { x: b.x - pad, y: b.y - pad, w: Math.max(1, b.w + pad * 2), h: Math.max(1, b.h + pad * 2) };
  const maxPx = opts.maxPixels ?? 16384 * 16384 / 4;
  let s = scale;
  if (box.w * s * box.h * s > maxPx || box.w * s > 16384 || box.h * s > 16384) s = Math.min(16384 / box.w, 16384 / box.h, Math.sqrt(maxPx / (box.w * box.h)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(box.w * s)); canvas.height = Math.max(1, Math.ceil(box.h * s));
  const c = canvas.getContext('2d')!;
  if (opts.background) { c.fillStyle = opts.background; c.fillRect(0, 0, canvas.width, canvas.height); }
  c.setTransform(s, 0, 0, s, -box.x * s, -box.y * s);
  for (const id of ids) {
    const n = doc.nodes[id];
    const parentM = n.parent && doc.nodes[n.parent].type !== 'PAGE' ? worldMatrix(doc, n.parent) : ([1, 0, 0, 1, 0, 0] as const);
    c.save(); c.transform(parentM[0], parentM[1], parentM[2], parentM[3], parentM[4], parentM[5]); // drawNode draws in its parent's space
    drawNode(c, doc, id, { images, scale: s }, parentM);
    c.restore();
  }
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, format: ExportSetting['format']): Promise<Blob> {
  const mime = format === 'PNG' ? 'image/png' : format === 'JPG' ? 'image/jpeg' : 'image/webp';
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error(`Browser could not encode ${format}`))), mime, 0.92));
}

export async function exportNodes(doc: DocumentData, ids: string[], images: ImageCache, setting: ExportSetting): Promise<Blob> {
  const canvas = await renderNodes(doc, ids, images, setting.scale, { background: setting.format === 'JPG' ? '#ffffff' : undefined });
  return canvasToBlob(canvas, setting.format);
}

/** Small PNG of a page for file thumbnails. */
export async function renderThumbnail(doc: DocumentData, pageId: string, images: ImageCache, w = 320, h = 200): Promise<Blob | null> {
  const kids = doc.nodes[pageId].children.filter(id => doc.nodes[id].visible);
  if (!kids.length) return null;
  const full = await renderNodes(doc, kids, images, 1, { background: '#f5f5f5' });
  const t = document.createElement('canvas'); t.width = w; t.height = h;
  const c = t.getContext('2d')!;
  c.fillStyle = '#f0f0f0'; c.fillRect(0, 0, w, h);
  const s = Math.min(w / full.width, h / full.height, 1);
  c.imageSmoothingQuality = 'high';
  c.drawImage(full, (w - full.width * s) / 2, (h - full.height * s) / 2, full.width * s, full.height * s);
  return canvasToBlob(t, 'PNG');
}
void ROOT_ID; void boundsOfPoints; void apply;
