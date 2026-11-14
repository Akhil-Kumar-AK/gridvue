import type { DocumentData, SceneNode, Style, StyleType, VarScope, VarType, VarValue, Variable } from './model';
import type { SetFn } from './layout';

// ---------------- resolution ----------------

/** The mode in force for `collectionId` at `nodeId`: nearest ancestor-or-self override, else the collection default. */
export function modeFor(doc: DocumentData, nodeId: string, collectionId: string): string {
  for (let c: SceneNode | undefined = doc.nodes[nodeId]; c; c = c.parent ? doc.nodes[c.parent] : undefined) {
    const m = c.modeOverrides?.[collectionId];
    if (m && doc.collections[collectionId]?.modes.some(x => x.id === m)) return m;
  }
  return doc.collections[collectionId]?.modes[0]?.id ?? '';
}

/** Follow aliases (cycle-safe). `modeOf` supplies the mode for each collection reached along the way. */
export function resolveVariable(doc: DocumentData, varId: string, modeOf: (collectionId: string) => string, depth = 0): string | number | boolean | undefined {
  const v = doc.variables[varId];
  if (!v || depth > 20) return undefined;
  const col = doc.collections[v.collectionId];
  const mode = modeOf(v.collectionId);
  const raw: VarValue | undefined = v.values[mode] ?? v.values[col?.modes[0]?.id ?? ''];
  if (raw === undefined) return undefined;
  if (typeof raw === 'object') return resolveVariable(doc, raw.alias, modeOf, depth + 1);
  return raw;
}

export const defaultFor = (t: VarType): string | number | boolean => (t === 'COLOR' ? '#000000' : t === 'FLOAT' ? 0 : t === 'STRING' ? '' : false);

/** Variable types and scopes allowed for each bindable path. */
export const PATH_INFO: Record<string, { type: VarType; scope: VarScope }> = {
  opacity: { type: 'FLOAT', scope: 'OPACITY' }, cornerRadius: { type: 'FLOAT', scope: 'RADIUS' }, strokeWeight: { type: 'FLOAT', scope: 'SIZE' },
  width: { type: 'FLOAT', scope: 'SIZE' }, height: { type: 'FLOAT', scope: 'SIZE' }, visible: { type: 'BOOLEAN', scope: 'VISIBILITY' },
  'layout.gap': { type: 'FLOAT', scope: 'SPACING' }, 'layout.padT': { type: 'FLOAT', scope: 'SPACING' }, 'layout.padR': { type: 'FLOAT', scope: 'SPACING' },
  'layout.padB': { type: 'FLOAT', scope: 'SPACING' }, 'layout.padL': { type: 'FLOAT', scope: 'SPACING' },
  'text.characters': { type: 'STRING', scope: 'TEXT_CONTENT' }, 'text.fontSize': { type: 'FLOAT', scope: 'FONT_SIZE' },
};
export function pathInfo(path: string): { type: VarType; scope: VarScope } | null {
  if (/^fills\.\d+\.color$/.test(path)) return { type: 'COLOR', scope: 'FILL' };
  if (/^strokes\.\d+\.color$/.test(path)) return { type: 'COLOR', scope: 'STROKE' };
  return PATH_INFO[path] ?? null;
}
export const scopeAllows = (v: Variable, scope: VarScope) => v.scopes.length === 0 || v.scopes.includes('ALL') || v.scopes.includes(scope);

// ---------------- applying styles + bindings to a node ----------------

type Work = Pick<SceneNode, 'fills' | 'strokes' | 'effects' | 'opacity' | 'cornerRadius' | 'strokeWeight' | 'width' | 'height' | 'visible'> & { text?: SceneNode['text']; layout?: SceneNode['layout'] };
const WORK_KEYS: (keyof Work)[] = ['fills', 'strokes', 'effects', 'opacity', 'cornerRadius', 'strokeWeight', 'width', 'height', 'visible', 'text', 'layout'];

/** Properties a node should have given its style references and variable bindings (diff against current values). */
export function desiredChanges(doc: DocumentData, n: SceneNode): Partial<SceneNode> {
  if (!n.styleRefs && !n.varBindings) return {};
  const w: Work = structuredClone(Object.fromEntries(WORK_KEYS.map(k => [k, (n as unknown as Record<string, unknown>)[k]]))) as Work;
  const r = n.styleRefs;
  if (r?.fill && doc.styles[r.fill]?.type === 'FILL') w.fills = structuredClone(doc.styles[r.fill].value.fills);
  if (r?.stroke && doc.styles[r.stroke]?.type === 'FILL') w.strokes = structuredClone(doc.styles[r.stroke].value.fills);
  if (r?.effect && doc.styles[r.effect]?.type === 'EFFECT') w.effects = structuredClone(doc.styles[r.effect].value.effects);
  if (r?.text && doc.styles[r.text]?.type === 'TEXT' && w.text) w.text = { ...w.text, ...structuredClone(doc.styles[r.text].value) };
  if (r?.layout && doc.styles[r.layout]?.type === 'LAYOUT' && w.layout) w.layout = { ...w.layout, ...structuredClone(doc.styles[r.layout].value) };
  const modeOf = (cid: string) => modeFor(doc, n.id, cid);
  for (const [path, vid] of Object.entries(n.varBindings ?? {})) {
    const info = pathInfo(path), variable = doc.variables[vid];
    if (!info || !variable || variable.type !== info.type) continue;
    const val = resolveVariable(doc, vid, modeOf);
    if (val === undefined) continue;
    const base = path.split('.')[0];
    if ((n.sourceId || n.componentId) && n.overrides?.includes(base)) continue; // a local override wins inside instances
    let m: RegExpExecArray | null;
    if ((m = /^(fills|strokes)\.(\d+)\.color$/.exec(path))) { const list = w[m[1] as 'fills' | 'strokes']; const p = list[Number(m[2])]; if (p?.type === 'SOLID' && typeof val === 'string') list[Number(m[2])] = { ...p, color: val }; }
    else if (path === 'opacity') w.opacity = Math.min(1, Math.max(0, Number(val) / 100));
    else if (path === 'visible') w.visible = val === true;
    else if (path === 'text.characters' && w.text) w.text = { ...w.text, characters: String(val) };
    else if (path === 'text.fontSize' && w.text) w.text = { ...w.text, fontSize: Math.max(1, Number(val)) };
    else if (path.startsWith('layout.') && w.layout) w.layout = { ...w.layout, [path.slice(7)]: Math.max(0, Number(val)) };
    else if (path === 'width' || path === 'height') (w as unknown as Record<string, number>)[path] = Math.max(0, Number(val));
    else if (path === 'cornerRadius' || path === 'strokeWeight') (w as unknown as Record<string, number>)[path] = Math.max(0, Number(val));
  }
  const out: Record<string, unknown> = {};
  for (const k of WORK_KEYS) {
    const cur = (n as unknown as Record<string, unknown>)[k], nxt = (w as unknown as Record<string, unknown>)[k];
    if (nxt !== undefined && JSON.stringify(cur) !== JSON.stringify(nxt)) out[k] = nxt;
  }
  return out as Partial<SceneNode>;
}

/** Apply styles/bindings to every node under `roots`. Returns ids whose properties changed. */
export function syncBindings(doc: DocumentData, roots: string[], set: SetFn): string[] {
  const changed: string[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    const ch = desiredChanges(doc, n);
    if (Object.keys(ch).length) { set(id, ch); changed.push(id); }
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return changed;
}

// ---------------- design tokens (JSON interchange) ----------------

export interface TokenFile {
  format: 'layr-tokens'; version: 1;
  collections: { name: string; modes: string[]; variables: { name: string; type: VarType; scopes?: VarScope[]; values: Record<string, string | number | boolean | { alias: string }> }[] }[];
}

/** Aliases are exported by "Collection/variable name" so the file is independent of ids. */
export function exportTokens(doc: DocumentData): TokenFile {
  const full = (v: Variable) => `${doc.collections[v.collectionId].name}/${v.name}`;
  return {
    format: 'layr-tokens', version: 1,
    collections: Object.values(doc.collections).map(c => ({
      name: c.name, modes: c.modes.map(m => m.name),
      variables: Object.values(doc.variables).filter(v => v.collectionId === c.id).map(v => ({
        name: v.name, type: v.type, scopes: v.scopes,
        values: Object.fromEntries(c.modes.filter(m => v.values[m.id] !== undefined).map(m => { const x = v.values[m.id]; return [m.name, typeof x === 'object' ? { alias: full(doc.variables[x.alias]) } : x]; })),
      })),
    })),
  };
}

export class TokenError extends Error {}
export function parseTokens(text: string): TokenFile {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new TokenError('Not valid JSON'); }
  if ((j?.format !== 'layr-tokens' && j?.format !== 'wireloom-tokens' && j?.format !== 'lumen-tokens') || j.version !== 1 || !Array.isArray(j.collections)) throw new TokenError('Not a Layr tokens file');
  for (const c of j.collections) {
    if (typeof c.name !== 'string' || !Array.isArray(c.modes) || !c.modes.length || !c.modes.every((m: unknown) => typeof m === 'string') || !Array.isArray(c.variables)) throw new TokenError('Malformed collection');
    for (const v of c.variables) if (typeof v.name !== 'string' || !['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'].includes(v.type) || typeof v.values !== 'object') throw new TokenError(`Malformed variable ${v?.name}`);
  }
  return j as TokenFile;
}

export type { Style, StyleType };

// ---------------- W3C design tokens (DTCG) ----------------
const DTCG_TYPES: Record<string, VarType> = { color: 'COLOR', number: 'FLOAT', dimension: 'FLOAT', fontSize: 'FLOAT', string: 'STRING', fontFamily: 'STRING', boolean: 'BOOLEAN' };

/** True when the JSON looks like a W3C design-tokens tree (`$value` leaves) rather than our own format. */
export function looksLikeDtcg(j: any): boolean {
  const walk = (o: any, d: number): boolean => !!o && typeof o === 'object' && d < 12 && ('$value' in o || Object.values(o).some(v => walk(v, d + 1)));
  return !!j && typeof j === 'object' && j.format === undefined && walk(j, 0);
}

/** Convert a DTCG token tree into a TokenFile with one collection ("Tokens" by default) and a single mode. */
export function fromDtcg(j: any, collectionName = 'Tokens', modeName = 'Mode 1'): TokenFile {
  const vars: TokenFile['collections'][number]['variables'] = [];
  const colorOf = (v: unknown) => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(v)); if (!m) return null; let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join(''); return '#' + h.slice(0, 6).toUpperCase(); };
  const walk = (o: any, path: string[], inherited?: string) => {
    if (!o || typeof o !== 'object') return;
    const type = typeof o.$type === 'string' ? o.$type : inherited;
    if ('$value' in o) {
      const vt = DTCG_TYPES[type ?? ''];
      const name = path.join('/');
      const raw = o.$value;
      if (typeof raw === 'string' && /^\{[^{}]+\}$/.test(raw)) { if (vt) vars.push({ name, type: vt, values: { [modeName]: { alias: `${collectionName}/${raw.slice(1, -1).split('.').join('/')}` } } }); return; }
      if (!vt) throw new TokenError(`Unsupported or missing $type for "${name}"`);
      let value: string | number | boolean | null = null;
      if (vt === 'COLOR') value = colorOf(raw);
      else if (vt === 'FLOAT') { const n = typeof raw === 'number' ? raw : parseFloat(String(raw)); value = Number.isFinite(n) ? n : null; }
      else if (vt === 'BOOLEAN') value = typeof raw === 'boolean' ? raw : null;
      else value = String(Array.isArray(raw) ? raw[0] : raw);
      if (value === null) throw new TokenError(`Invalid ${type} value for "${name}"`);
      vars.push({ name, type: vt, values: { [modeName]: value } });
      return;
    }
    for (const [k, v] of Object.entries(o)) if (!k.startsWith('$')) walk(v, [...path, k], type);
  };
  walk(j, []);
  if (!vars.length) throw new TokenError('No tokens found');
  return { format: 'layr-tokens' as never, version: 1, collections: [{ name: collectionName, modes: [modeName], variables: vars }] } as unknown as TokenFile;
}

/** Export one collection (default mode) as a DTCG tree; aliases become `{group.token}` references. */
export function toDtcg(doc: DocumentData, collectionId: string, modeId?: string): Record<string, unknown> {
  const col = doc.collections[collectionId];
  const mode = modeId ?? col.modes[0].id;
  const out: Record<string, any> = {};
  const typeName = { COLOR: 'color', FLOAT: 'number', STRING: 'string', BOOLEAN: 'boolean' } as const;
  for (const v of Object.values(doc.variables).filter(x => x.collectionId === collectionId)) {
    const parts = v.name.split('/');
    let node = out;
    for (const p of parts.slice(0, -1)) node = (node[p] ??= {});
    const raw = v.values[mode] ?? v.values[col.modes[0].id];
    node[parts.at(-1)!] = typeof raw === 'object'
      ? { $type: typeName[v.type], $value: `{${doc.variables[raw.alias].name.split('/').join('.')}}` }
      : { $type: typeName[v.type], $value: raw };
  }
  return out;
}
