import { BLEND_MODES, IMAGE_ADJUST_KEYS, ROOT_ID, SCHEMA_VERSION, type DocumentData, type ImageAdjust, type SceneNode } from './model';

export class DocumentError extends Error {}

/** Forward migrations keyed by the version they upgrade FROM. */
const migrations: Record<number, (d: any) => any> = {
  // v1 → v2: styles and variables were introduced
  1: d => ({ ...d, schemaVersion: 2, styles: d.styles ?? {}, variables: d.variables ?? {}, collections: d.collections ?? {} }),
};

export function migrate(raw: any): DocumentData {
  if (!raw || typeof raw !== 'object') throw new DocumentError('Document is not an object');
  let v = raw.schemaVersion;
  if (typeof v !== 'number') throw new DocumentError('Missing schemaVersion');
  if (v > SCHEMA_VERSION) throw new DocumentError(`Document schema v${v} is newer than supported v${SCHEMA_VERSION}`);
  let d = raw;
  while (v < SCHEMA_VERSION) {
    const m = migrations[v];
    if (!m) throw new DocumentError(`No migration from schema v${v}`);
    d = m(d); v = d.schemaVersion;
  }
  return d as DocumentData;
}

const NUM_FIELDS = ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'strokeWeight', 'cornerRadius'] as const;
const TYPES = new Set(['DOCUMENT', 'PAGE', 'FRAME', 'GROUP', 'RECT', 'ELLIPSE', 'LINE', 'TEXT', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'VECTOR', 'EMBED']);

/** Structural integrity check; throws DocumentError on the first problem. Used on every server write. */
export function validateDocument(doc: DocumentData): void {
  if (doc.schemaVersion !== SCHEMA_VERSION) throw new DocumentError('Unsupported schemaVersion');
  const nodes = doc.nodes;
  if (!nodes || typeof nodes !== 'object') throw new DocumentError('nodes missing');
  const root = nodes[doc.rootId];
  if (doc.rootId !== ROOT_ID || !root || root.type !== 'DOCUMENT' || root.parent !== null) throw new DocumentError('Invalid root');
  const seen = new Set<string>();
  const walk = (id: string, parent: string | null, depth: number) => {
    if (depth > 200) throw new DocumentError('Tree too deep');
    const n = nodes[id];
    if (!n) throw new DocumentError(`Dangling child ${id}`);
    if (seen.has(id)) throw new DocumentError(`Node ${id} appears twice`);
    seen.add(id);
    if (n.id !== id) throw new DocumentError(`Node key/id mismatch ${id}`);
    if (n.parent !== parent) throw new DocumentError(`Bad parent pointer on ${id}`);
    if (!TYPES.has(n.type)) throw new DocumentError(`Unknown node type ${n.type}`);
    for (const f of NUM_FIELDS) if (typeof n[f] !== 'number' || !Number.isFinite(n[f])) throw new DocumentError(`Non-finite ${f} on ${id}`);
    if (!Array.isArray(n.children) || !Array.isArray(n.fills) || !Array.isArray(n.strokes) || !Array.isArray(n.effects)) throw new DocumentError(`Bad arrays on ${id}`);
    if (n.type === 'VECTOR' && (!n.path || n.path.points.length < 2 || n.path.points.some(p => ![p.x, p.y, p.ix, p.iy, p.ox, p.oy].every(Number.isFinite)))) throw new DocumentError(`Vector ${id} has an invalid path`);
    if (n.textPath && (n.type !== 'TEXT' || n.textPath.points.length < 2 || n.textPath.points.some(p => ![p.x, p.y, p.ix, p.iy, p.ox, p.oy].every(Number.isFinite)))) throw new DocumentError(`Text node ${id} has an invalid text path`);
    if (n.subpaths && (n.type !== 'VECTOR' || n.subpaths.some(sp => sp.points.length < 2 || sp.points.some(p => ![p.x, p.y, p.ix, p.iy, p.ox, p.oy].every(Number.isFinite))))) throw new DocumentError(`Vector ${id} has an invalid sub-path`);
    for (const k of ['strokeStart', 'strokeEnd'] as const) if (n[k] !== undefined && !['NONE', 'ROUND', 'SQUARE', 'ARROW', 'TRIANGLE', 'REVERSED_TRIANGLE', 'CIRCLE', 'DIAMOND'].includes(n[k] as string)) throw new DocumentError(`Node ${id} has an invalid ${k}`);
    if (n.strokeKind !== undefined && !['BASIC', 'DYNAMIC', 'BRUSH'].includes(n.strokeKind)) throw new DocumentError(`Node ${id} has an invalid stroke kind`);
    if (n.strokeProfile !== undefined && !['UNIFORM', 'TAPER', 'BULGE', 'TAPER_BOTH'].includes(n.strokeProfile)) throw new DocumentError(`Node ${id} has an invalid width profile`);
    if (n.strokeDynamic && !(['frequency', 'wiggle', 'smoothen'] as const).every(k => Number.isFinite(n.strokeDynamic![k]))) throw new DocumentError(`Node ${id} has an invalid dynamic stroke`);
    if (n.strokeBrush && !['CHARCOAL', 'MARKER', 'CHALK', 'INK'].includes(n.strokeBrush.id)) throw new DocumentError(`Node ${id} has an invalid brush`);
    if (n.strokeMiterAngle !== undefined && !(n.strokeMiterAngle >= 1 && n.strokeMiterAngle <= 180)) throw new DocumentError(`Node ${id} has an invalid miter angle`);
    if (n.boolOp && (n.type !== 'GROUP' || !['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE'].includes(n.boolOp))) throw new DocumentError(`Node ${id} has an invalid boolean operation`);
    if (n.type === 'EMBED' && (!n.embed || typeof n.embed.fileId !== 'string' || !n.embed.fileId || typeof n.embed.fileName !== 'string' || n.embed.kind !== 'whiteboard' || n.children.length)) throw new DocumentError(`Embed ${id} is invalid`);
    if (n.embed && n.type !== 'EMBED') throw new DocumentError(`Node ${id} has an embed but is not an embed`);
    if (n.type === 'TEXT' && !n.text) throw new DocumentError(`Text node ${id} lacks text props`);
    for (const p of [...n.fills, ...n.strokes]) if (p.type === 'IMAGE' && !doc.assets[p.assetId]) throw new DocumentError(`Missing asset ${p.assetId}`);
    if (n.blendMode !== undefined && !BLEND_MODES.includes(n.blendMode)) throw new DocumentError(`Node ${id} has an invalid blend mode`);
    for (const p of [...n.fills, ...n.strokes]) {
      if (p.blendMode !== undefined && !BLEND_MODES.includes(p.blendMode)) throw new DocumentError(`Node ${id} has a paint with an invalid blend mode`);
      if (p.type === 'IMAGE') {
        if (!['FILL', 'FIT', 'STRETCH', 'TILE'].includes(p.scaleMode)) throw new DocumentError(`Node ${id} has an invalid image mode`);
        if (p.rotation !== undefined && ![0, 90, 180, 270].includes(p.rotation)) throw new DocumentError(`Node ${id} has an invalid image rotation`);
        for (const [k, v] of Object.entries(p.adjust ?? {})) if (!IMAGE_ADJUST_KEYS.includes(k as keyof ImageAdjust) || !(typeof v === 'number' && v >= -100 && v <= 100)) throw new DocumentError(`Node ${id} has an invalid image adjustment`);
      } else if (p.type === 'PATTERN') {
        if (p.sourceId !== null && typeof p.sourceId !== 'string') throw new DocumentError(`Node ${id} has an invalid pattern source`);
        if (!['RECT', 'OFFSET'].includes(p.tile)) throw new DocumentError(`Node ${id} has an invalid pattern tile type`);
        if (!(Number.isFinite(p.scale) && p.scale >= 0.02 && p.scale <= 20)) throw new DocumentError(`Node ${id} has an invalid pattern scale`);
        for (const k of ['spacingX', 'spacingY'] as const) if (!(Number.isFinite(p[k]) && p[k] >= -90 && p[k] <= 1000)) throw new DocumentError(`Node ${id} has an invalid pattern spacing`);
        if (!['tl', 'tc', 'tr', 'ml', 'c', 'mr', 'bl', 'bc', 'br'].includes(p.align)) throw new DocumentError(`Node ${id} has an invalid pattern alignment`);
      }
    }
    n.children.forEach(c => walk(c, id, depth + 1));
  };
  for (const k of ['styles', 'variables', 'collections'] as const) if (!doc[k] || typeof doc[k] !== 'object') throw new DocumentError(`${k} missing`);
  for (const x of Object.values(doc.variables)) {
    const c = doc.collections[x.collectionId];
    if (!c) throw new DocumentError(`Variable ${x.name} has no collection`);
    for (const mode of Object.keys(x.values)) if (!c.modes.some(m => m.id === mode)) throw new DocumentError(`Variable ${x.name} has a value for unknown mode`);
    for (const val of Object.values(x.values)) if (typeof val === 'object' && !doc.variables[val.alias]) throw new DocumentError(`Variable ${x.name} aliases a missing variable`);
  }
  const checkRefs = (n: SceneNode) => {
    for (const vid of Object.values(n.varBindings ?? {})) if (!doc.variables[vid]) throw new DocumentError(`Node ${n.id} binds missing variable`);
    for (const sid of Object.values(n.styleRefs ?? {})) if (sid && !doc.styles[sid]) throw new DocumentError(`Node ${n.id} references missing style`);
    for (const [cid, mid] of Object.entries(n.modeOverrides ?? {})) if (!doc.collections[cid]?.modes.some(m => m.id === mid)) throw new DocumentError(`Node ${n.id} has an invalid mode override`);
  };
  walk(doc.rootId, null, 0);
  Object.values(nodes).forEach(checkRefs);
  if (seen.size !== Object.keys(nodes).length) throw new DocumentError('Orphan nodes present');
  if (root.children.some(c => nodes[c]?.type !== 'PAGE') || root.children.length === 0) throw new DocumentError('Document children must be pages');
}

/** Native interchange format. Assets are embedded base64 so a file is self-contained. */
export interface NativeFile {
  format: 'layr-document';
  schemaVersion: number;
  name: string;
  exportedAt: string;
  document: DocumentData;
  assets: Record<string, { mime: string; base64: string }>;
}
export function parseNativeFile(text: string): NativeFile {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new DocumentError('Not valid JSON'); }
  if (j?.format !== 'layr-document' && j?.format !== 'wireloom-document' && j?.format !== 'lumen-document') throw new DocumentError('Not a Layr document file');
  j.document = migrate(j.document);
  validateDocument(j.document);
  return j as NativeFile;
}
