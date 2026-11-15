import { DocStore, addNode, createEmptyDocument, defaultNode, newId, pageIds, ROOT_ID, type DocumentData, type NativeFile, type Paint, type SceneNode, type VectorPath } from '@layr/core';
import { strToU8, unzipSync, zipSync, deflateSync } from 'fflate';
import { decodeFigmaBuffer } from '../figma/decode';
import { convertFigma } from '../figma/convert';
import { figmaCodec } from '../figma/schema';

export interface Imported { name: string; doc: DocumentData; assets: NativeFile['assets']; notes: string[] }
export type AssetSource = (id: string) => Promise<{ bytes: Uint8Array; mime: string }>;

const sniff = (b: Uint8Array): string | null => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x47 && b[1] === 0x49 ? 'image/gif' : b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 ? 'image/webp' : null);
export const toBase64 = (buf: Uint8Array) => { let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); };
const hex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

/** Open a .fig file (a zip holding canvas.fig and images/, or a bare fig-kiwi file) as a Layr document. */
export function importFig(bytes: Uint8Array, fileName: string): Imported {
  let canvas = bytes;
  const images = new Map<string, Uint8Array>();
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const z = unzipSync(bytes);
    if (!z['canvas.fig']) throw new Error('This .fig file has no canvas.fig inside');
    canvas = z['canvas.fig'];
    for (const [k, v] of Object.entries(z)) if (k.startsWith('images/') && k.length > 7) images.set(k.slice(7), v);
  }
  const doc = createEmptyDocument(), assets: NativeFile['assets'] = {};
  const byHash = new Map<string, string>();
  const conv = convertFigma(decodeFigmaBuffer(canvas), {
    image: h => {
      if (byHash.has(h)) return byHash.get(h)!;
      const data = images.get(h); const mime = data && sniff(data);
      if (!data || !mime) return null;
      const id = newId('asset');
      byHash.set(h, id); doc.assets[id] = { name: h.slice(0, 8), mime }; assets[id] = { mime, base64: toBase64(data) };
      return id;
    },
  });
  const store = new DocStore(doc);
  const pages = conv.pages.length ? conv.pages : [{ name: 'Page 1', trees: conv.trees }];
  if (!pages.some(p => p.trees.length)) throw new Error('No supported layers found in this Figma file');
  pages.forEach((pg, i) => {
    const pageId = i === 0 ? pageIds(store.doc)[0] : addNode(store, defaultNode('PAGE', { name: pg.name }), ROOT_ID);
    store.apply({ t: 'set', id: pageId, props: { name: pg.name } });
    for (const tree of pg.trees) { tree[0].parent = pageId; store.apply({ t: 'insert', nodes: tree, parent: pageId, index: store.doc.nodes[pageId].children.length }); }
  });
  return { name: fileName.replace(/\.fig$/i, ''), doc: store.doc, assets, notes: conv.notes };
}

// ---------------------------------------------------------------- export
const BLEND: Record<string, string> = { NORMAL: 'PASS_THROUGH', DARKEN: 'DARKEN', MULTIPLY: 'MULTIPLY', PLUS_DARKER: 'LINEAR_BURN', COLOR_BURN: 'COLOR_BURN', LIGHTEN: 'LIGHTEN', SCREEN: 'SCREEN', PLUS_LIGHTER: 'LINEAR_DODGE', COLOR_DODGE: 'COLOR_DODGE', OVERLAY: 'OVERLAY', SOFT_LIGHT: 'SOFT_LIGHT', HARD_LIGHT: 'HARD_LIGHT', DIFFERENCE: 'DIFFERENCE', EXCLUSION: 'EXCLUSION', HUE: 'HUE', SATURATION: 'SATURATION', COLOR: 'COLOR', LUMINOSITY: 'LUMINOSITY' };
const rgb = (h: string, a = 1) => { const v = h.replace('#', '').padEnd(6, '0'); return { r: parseInt(v.slice(0, 2), 16) / 255, g: parseInt(v.slice(2, 4), 16) / 255, b: parseInt(v.slice(4, 6), 16) / 255, a }; };
const pos = (i: number) => { const c = (n: number) => String.fromCharCode(33 + (n % 90)); return c(Math.floor(i / 8100)) + c(Math.floor(i / 90)) + c(i); };
const WEIGHT_NAME: Record<number, string> = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };

/** Path commands in Figma's blob encoding (0 close, 1 move, 2 line, 3 cubic; float32 little-endian). */
export function encodeCommands(paths: VectorPath[]): Uint8Array {
  const out: number[] = [];
  const f = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); out.push(...b); };
  for (const p of paths) {
    const P = p.points; if (P.length < 2) continue;
    out.push(1); f(P[0].x); f(P[0].y);
    const segs = p.closed ? P.length : P.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if (a.ox || a.oy || b.ix || b.iy) { out.push(3); f(a.x + a.ox); f(a.y + a.oy); f(b.x + b.ix); f(b.y + b.iy); f(b.x); f(b.y); } else { out.push(2); f(b.x); f(b.y); }
    }
    if (p.closed) out.push(0);
  }
  return Uint8Array.from(out);
}

async function sha1(b: Uint8Array): Promise<Uint8Array> { return new Uint8Array(await crypto.subtle.digest('SHA-1', b as BufferSource)); }

/** Layr document → .fig (zip with canvas.fig, meta.json and images/). */
export async function exportFig(doc: DocumentData, fileName: string, getAsset: AssetSource): Promise<Uint8Array> {
  const nodeChanges: any[] = [], blobs: { bytes: Uint8Array }[] = [];
  const guid = new Map<string, { sessionID: number; localID: number }>();
  let counter = 2;
  const g = (id: string) => { if (!guid.has(id)) guid.set(id, { sessionID: 1, localID: counter++ }); return guid.get(id)!; };
  const imageFiles: Record<string, Uint8Array> = {};
  const hashOf = new Map<string, Uint8Array>();
  for (const id of Object.keys(doc.assets)) { try { const a = await getAsset(id); const h = await sha1(a.bytes); hashOf.set(id, h); imageFiles[`images/${hex(h)}`] = a.bytes; } catch { /* missing asset: its fills fall back to grey */ } }

  const pb = (p: Paint) => (p.blendMode && p.blendMode !== 'NORMAL' ? BLEND[p.blendMode] ?? 'NORMAL' : 'NORMAL');
  const paints = (list: Paint[], w: number, h: number): any[] => list.map(p => {
    if (p.type === 'SOLID') return { type: 'SOLID', color: rgb(p.color, 1), opacity: p.opacity, visible: p.visible, blendMode: pb(p) };
    if (p.type === 'LINEAR') {
      const a = (p.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a), half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
      const S = { x: (w / 2 - dx * half) / (w || 1), y: (h / 2 - dy * half) / (h || 1) }, E = { x: (w / 2 + dx * half) / (w || 1), y: (h / 2 + dy * half) / (h || 1) };
      const u = { x: E.x - S.x, y: E.y - S.y }, uu = u.x * u.x + u.y * u.y || 1, v = { x: -u.y, y: u.x };
      return {
        type: 'GRADIENT_LINEAR', opacity: p.opacity, visible: p.visible, blendMode: pb(p), stops: p.stops.map(s => ({ color: rgb(s.color, s.opacity), position: s.pos })),
        transform: { m00: u.x / uu, m01: u.y / uu, m02: -(S.x * u.x + S.y * u.y) / uu, m10: v.x / uu, m11: v.y / uu, m12: 0.5 - (S.x * v.x + S.y * v.y) / uu },
      };
    }
    if (p.type === 'PATTERN') return { type: 'SOLID', color: rgb('#C8C8C8'), opacity: p.opacity, visible: p.visible }; // repeating-layer fills have no .fig equivalent here
    const hash = hashOf.get(p.assetId);
    if (!hash) return { type: 'SOLID', color: rgb('#C8C8C8'), opacity: p.opacity, visible: p.visible };
    return { type: 'IMAGE', opacity: p.opacity, visible: p.visible, blendMode: pb(p), image: { hash, name: doc.assets[p.assetId]?.name ?? '' }, imageScaleMode: p.scaleMode === 'FIT' ? 'FIT' : p.scaleMode === 'STRETCH' ? 'STRETCH' : 'FILL' };
  });

  const emit = (n: SceneNode, parentGuid: { sessionID: number; localID: number }, index: number) => {
    const rot = (n.rotation * Math.PI) / 180;
    const base: any = {
      guid: g(n.id), phase: 'CREATED', parentIndex: { guid: parentGuid, position: pos(index) }, name: n.name, visible: n.visible, locked: n.locked, opacity: n.opacity, blendMode: BLEND[n.blendMode] ?? 'PASS_THROUGH',
      size: { x: n.width, y: n.height }, transform: { m00: Math.cos(rot), m01: -Math.sin(rot), m02: n.x, m10: Math.sin(rot), m11: Math.cos(rot), m12: n.y },
    };
    if (n.type !== 'GROUP' && n.type !== 'TEXT') base.fillPaints = paints(n.fills, n.width, n.height);
    if (n.strokes.length) {
      Object.assign(base, { strokePaints: paints(n.strokes, n.width, n.height), strokeWeight: n.strokeWeight, strokeAlign: n.strokeAlign, strokeCap: n.strokeCap ?? 'NONE', strokeJoin: n.strokeJoin ?? 'MITER' });
      if (n.dashes?.length) base.strokeDashes = n.dashes;
    }
    const fx = n.effects.filter(e => e.visible).map(e => (e.type === 'DROP_SHADOW' ? { type: 'DROP_SHADOW', color: rgb(e.color, e.opacity), offset: { x: e.x, y: e.y }, radius: e.blur, visible: true, spread: 0 } : { type: 'FOREGROUND_BLUR', radius: e.radius, visible: true }));
    if (fx.length) base.effects = fx;
    switch (n.type) {
      case 'FRAME': case 'COMPONENT': case 'COMPONENT_SET': case 'INSTANCE': base.type = n.type === 'COMPONENT' ? 'SYMBOL' : 'FRAME'; base.frameMaskDisabled = !n.clipsContent; break;
      case 'GROUP': base.type = 'GROUP'; break;
      case 'EMBED': base.type = 'ROUNDED_RECTANGLE'; break; // a whiteboard card exports as a plain rounded rectangle
      case 'RECT': base.type = n.cornerRadius || n.cornerRadii ? 'ROUNDED_RECTANGLE' : 'RECTANGLE'; break;
      case 'ELLIPSE': base.type = 'ELLIPSE'; break;
      case 'LINE': base.type = 'LINE'; base.size = { x: n.width, y: 0 }; break;
      case 'VECTOR': { base.type = 'VECTOR'; const paths = [n.path!, ...(n.subpaths ?? [])]; blobs.push({ bytes: encodeCommands(paths) }); base.fillGeometry = [{ windingRule: n.subpaths?.length ? 'ODD' : 'NONZERO', commandsBlob: blobs.length - 1 }]; break; }
      case 'TEXT': {
        const t = n.text!;
        base.type = 'TEXT'; base.fillPaints = paints(n.fills, n.width, n.height);
        const fam = t.fontFamily.split(',')[0].replace(/["']/g, '').trim() || 'Inter', style = (WEIGHT_NAME[t.fontWeight] ?? 'Regular');
        Object.assign(base, {
          textData: { characters: t.characters }, fontSize: t.fontSize, fontName: { family: fam, style: t.italic ? (style === 'Regular' ? 'Italic' : `${style} Italic`) : style, postscript: '' },
          letterSpacing: { value: t.letterSpacing, units: 'PIXELS' }, textAlignHorizontal: t.align, textAlignVertical: t.vAlign === 'MIDDLE' ? 'CENTER' : t.vAlign ?? 'TOP',
          textAutoResize: t.resize === 'AUTO_WIDTH' ? 'WIDTH_AND_HEIGHT' : t.resize === 'AUTO_HEIGHT' ? 'HEIGHT' : 'NONE', textDecoration: t.decoration === 'UNDERLINE' ? 'UNDERLINE' : t.decoration === 'STRIKE' ? 'STRIKETHROUGH' : 'NONE',
          textCase: ({ UPPER: 'UPPER', LOWER: 'LOWER', TITLE: 'TITLE', SMALL_CAPS: 'SMALL_CAPS', SMALL_CAPS_FORCED: 'SMALL_CAPS_FORCED' } as Record<string, string>)[t.textCase ?? ''] ?? 'ORIGINAL',
        });
        if (t.lineHeight !== 'AUTO') base.lineHeight = { value: t.lineHeight, units: 'PIXELS' };
        if (t.paragraphSpacing) base.paragraphSpacing = t.paragraphSpacing;
        break;
      }
      default: return;
    }
    if ((n.type === 'RECT' || n.type === 'FRAME') && n.cornerRadii) Object.assign(base, { cornerRadius: n.cornerRadii[0], rectangleTopLeftCornerRadius: n.cornerRadii[0], rectangleTopRightCornerRadius: n.cornerRadii[1], rectangleBottomRightCornerRadius: n.cornerRadii[2], rectangleBottomLeftCornerRadius: n.cornerRadii[3] });
    else if (n.cornerRadius) base.cornerRadius = n.cornerRadius;
    nodeChanges.push(base);
    n.children.forEach((c, i) => emit(doc.nodes[c], base.guid, i));
  };

  nodeChanges.push({ guid: { sessionID: 0, localID: 0 }, phase: 'CREATED', type: 'DOCUMENT', name: 'Document', visible: true, opacity: 1 });
  doc.nodes[doc.rootId].children.forEach((pid, pi) => {
    const page = doc.nodes[pid], cg = g(pid);
    nodeChanges.push({ guid: cg, phase: 'CREATED', parentIndex: { guid: { sessionID: 0, localID: 0 }, position: pos(pi) }, type: 'CANVAS', name: page.name, visible: true, opacity: 1 });
    page.children.forEach((c, i) => emit(doc.nodes[c], cg, i));
  });
  const codec = figmaCodec();
  const data = codec.encodeMessage({ type: 'NODE_CHANGES', sessionID: 1, nodeChanges, blobs });
  const parts = [deflateSync(codec.binarySchema), deflateSync(data)];
  const head = new Uint8Array(12 + parts.reduce((n, p) => n + 4 + p.length, 0)), view = new DataView(head.buffer);
  head.set(strToU8('fig-kiwi')); view.setUint32(8, 15, true);
  let off = 12; for (const p of parts) { view.setUint32(off, p.length, true); off += 4; head.set(p, off); off += p.length; }
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  return zipSync({ 'canvas.fig': [head, { level: 0 }], 'meta.json': strToU8(JSON.stringify({ file_name: fileName, version: 1, developer_related_settings: {} })), 'thumbnail.png': png, ...Object.fromEntries(Object.entries(imageFiles).map(([k, v]) => [k, [v, { level: 0 }]])) });
}
