import { parseNativeFile, type DocumentData, type Paint } from '@layr/core';
import { api } from '../api';
import { importFig, type Imported } from './fig';
import { importXd } from './xd';

export const IMPORT_ACCEPT = '.layr,.fig,.xd,.wireloom,.lumen,application/json';

/** Read a design file from disk (.layr, .fig or .xd) into a document plus its image assets. */
export async function importDesignFile(file: File): Promise<Imported> {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  if (ext === 'fig') return importFig(new Uint8Array(await file.arrayBuffer()), file.name);
  if (ext === 'xd') return importXd(new Uint8Array(await file.arrayBuffer()), file.name);
  const nf = parseNativeFile(await file.text());
  return { name: nf.name || file.name.replace(/\.(layr|wireloom|lumen)$/i, ''), doc: nf.document, assets: nf.assets, notes: [] };
}

const GREY = { type: 'SOLID' as const, color: '#C8C8C8', opacity: 1, visible: true };
const withImages = (doc: DocumentData, map: (assetId: string) => string | null): DocumentData => {
  const out = structuredClone(doc);
  const fix = (list: Paint[]) => list.map(p => { if (p.type !== 'IMAGE') return p; const id = map(p.assetId); return id ? { ...p, assetId: id } : { ...GREY, opacity: p.opacity, visible: p.visible }; });
  for (const n of Object.values(out.nodes)) { n.fills = fix(n.fills); n.strokes = fix(n.strokes); }
  return out;
};
const toBlob = (b64: string, mime: string) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); };

/**
 * Create a file from an imported design. Small imports go up in one request; big ones (many or large images) create the file with grey
 * placeholders first, upload the images one by one, then save the document with the real image ids, so no single request is huge.
 */
export async function createFromImport(r: Imported, projectId: string | null): Promise<string> {
  const ids = Object.keys(r.doc.assets);
  const bytes = ids.reduce((n, id) => n + (r.assets[id]?.base64.length ?? 0), 0);
  if (bytes < 6_000_000) return (await api.createFile({ name: r.name, projectId, import: { document: r.doc, assets: r.assets } })).file.id;
  const first = withImages({ ...r.doc, assets: {} }, () => null);
  const { file } = await api.createFile({ name: r.name, projectId, import: { document: first, assets: {} } });
  const map = new Map<string, string>(), skipped: string[] = [];
  for (const id of ids) {
    const a = r.assets[id]; if (!a) continue;
    try { const up = await api.uploadAsset(file.id, toBlob(a.base64, a.mime)); map.set(id, up.assetId); } catch { skipped.push(id); }
  }
  const final = withImages(r.doc, id => map.get(id) ?? null);
  final.assets = Object.fromEntries([...map].map(([old, nu]) => [nu, r.doc.assets[old]]));
  await api.saveDoc(file.id, file.revision, final);
  if (skipped.length) r.notes.push(`${skipped.length} image${skipped.length === 1 ? ' was' : 's were'} too large to upload and became grey`);
  return file.id;
}
