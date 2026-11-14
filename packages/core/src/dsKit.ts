/**
 * Tiny builder kit used to author the default design system. Pure data (no DOM): it produces ordinary
 * document nodes (auto-layout frames, text, shapes) and lays them out with the same engine the editor uses.
 *
 * Colours are written as design tokens: '$primary' (optionally '$primary/20' = 20 % opacity) resolves to the
 * token's light value AND is bound to the matching variable, so switching the Light/Dark mode or editing the
 * variable restyles every component. Plain '#rrggbb' strings are literals.
 */
import { createEmptyDocument, defaultNode, newId, solid, type AutoLayout, type DocumentData, type Effect, type Paint, type PathPoint, type SceneNode, type VarCollection, type Variable } from './model';
import { layoutTree, type TextFit } from './layout';

/** token → [light, dark] */
export const COLOR_TOKENS: Record<string, [string, string]> = {
  primary: ['#4F46E5', '#818CF8'], onPrimary: ['#FFFFFF', '#1E1B4B'],
  secondary: ['#E0E7FF', '#312E81'], onSecondary: ['#3730A3', '#C7D2FE'],
  background: ['#F9FAFB', '#0B0F19'], surface: ['#FFFFFF', '#111827'], surfaceAlt: ['#F3F4F6', '#1F2937'],
  border: ['#E5E7EB', '#374151'], borderStrong: ['#9CA3AF', '#6B7280'],
  text: ['#111827', '#F9FAFB'], textMuted: ['#6B7280', '#9CA3AF'], textDisabled: ['#9CA3AF', '#6B7280'], disabledBg: ['#F3F4F6', '#1F2937'],
  success: ['#16A34A', '#4ADE80'], successSoft: ['#DCFCE7', '#14532D'],
  warning: ['#D97706', '#FBBF24'], warningSoft: ['#FEF3C7', '#78350F'],
  danger: ['#DC2626', '#F87171'], dangerSoft: ['#FEE2E2', '#7F1D1D'],
  info: ['#2563EB', '#60A5FA'], infoSoft: ['#DBEAFE', '#1E3A8A'],
  inverse: ['#111827', '#F9FAFB'], onInverse: ['#F9FAFB', '#111827'],
};
export const RADIUS_TOKENS: Record<string, number> = { sm: 6, md: 8, lg: 12, xl: 16 };
export const FONT = 'Inter, Helvetica, Arial, sans-serif';
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const SHADOWS: Record<string, Effect[]> = {
  sm: [{ type: 'DROP_SHADOW', x: 0, y: 1, blur: 3, color: '#000000', opacity: 0.14, visible: true }],
  md: [{ type: 'DROP_SHADOW', x: 0, y: 4, blur: 12, color: '#000000', opacity: 0.16, visible: true }],
  lg: [{ type: 'DROP_SHADOW', x: 0, y: 12, blur: 32, color: '#000000', opacity: 0.24, visible: true }],
};

/** A node plus its children, before ids are wired into the document. */
export interface N { n: SceneNode; k: N[] }
export type Kid = N | false | null | undefined;
type Size = number | 'fill' | 'hug';

export interface FO {
  name?: string; w?: Size; h?: Size; dir?: 'row' | 'col'; gap?: number; pad?: number | number[];
  main?: 'start' | 'center' | 'end' | 'between'; cross?: 'start' | 'center' | 'end';
  fill?: string; stroke?: string; sw?: number; r?: number | 'sm' | 'md' | 'lg' | 'xl' | number[]; shadow?: 'sm' | 'md' | 'lg';
  op?: number; clip?: boolean; abs?: { x: number; y: number }; /** boolean component property driving visibility */ vis?: string; hidden?: boolean; dash?: number[];
}
export interface TO {
  s?: number; w?: number; c?: string; al?: 'LEFT' | 'CENTER' | 'RIGHT'; fw?: number | 'fill'; lh?: number; ls?: number; mono?: boolean;
  deco?: 'UNDERLINE' | 'STRIKE'; case?: 'UPPER'; italic?: boolean; prop?: string; abs?: { x: number; y: number }; vis?: string; hidden?: boolean; name?: string;
}

/** Document under construction (set by `Kit.begin`). */
export class Kit {
  doc: DocumentData;
  tok: Record<string, string> = {};
  light: Record<string, string> = {};
  radius: Record<string, string> = {};
  constructor(public fit?: TextFit) {
    this.doc = createEmptyDocument();
    const root = this.doc.nodes[this.doc.rootId];
    for (const p of root.children) delete this.doc.nodes[p];
    root.children = [];
    const theme: VarCollection = { id: newId('col'), name: 'Theme', modes: [{ id: newId('mode'), name: 'Light' }, { id: newId('mode'), name: 'Dark' }] };
    const shape: VarCollection = { id: newId('col'), name: 'Shape', modes: [{ id: newId('mode'), name: 'Default' }] };
    this.doc.collections[theme.id] = theme; this.doc.collections[shape.id] = shape;
    for (const [name, [l, d]] of Object.entries(COLOR_TOKENS)) {
      const v: Variable = { id: newId('var'), collectionId: theme.id, name: `color/${name}`, type: 'COLOR', scopes: ['FILL', 'STROKE'], values: { [theme.modes[0].id]: l, [theme.modes[1].id]: d } };
      this.doc.variables[v.id] = v; this.tok[name] = v.id; this.light[name] = l;
    }
    for (const [name, px] of Object.entries(RADIUS_TOKENS)) {
      const v: Variable = { id: newId('var'), collectionId: shape.id, name: `radius/${name}`, type: 'FLOAT', scopes: ['RADIUS'], values: { [shape.modes[0].id]: px } };
      this.doc.variables[v.id] = v; this.radius[name] = v.id;
    }
  }
  addPage(name: string): string {
    const page = defaultNode('PAGE', { name, parent: this.doc.rootId });
    this.doc.nodes[page.id] = page; this.doc.nodes[this.doc.rootId].children.push(page.id);
    return page.id;
  }
  /** Write a built tree into the document under `parent`. */
  attach(root: N, parent: string): string {
    const walk = (x: N, p: string) => {
      x.n.parent = p; x.n.children = x.k.map(c => c.n.id);
      this.doc.nodes[x.n.id] = x.n; this.doc.nodes[p].children.includes(x.n.id) || this.doc.nodes[p].children.push(x.n.id);
      x.k.forEach(c => walk(c, x.n.id));
    };
    walk(root, parent);
    return root.n.id;
  }
  /** Two passes: the first sizes wrapped text, the second lets hugging parents pick up the final text heights. */
  layout(id: string) { for (let pass = 0; pass < 2; pass++) layoutTree(this.doc, id, (i, props) => { Object.assign(this.doc.nodes[i], props); }, this.fit); }
}

let K: Kit;
export function useKit(k: Kit) { K = k; }

function paintOf(c: string, path: string, binds: Record<string, string>): Paint {
  let key = c, op = 1;
  const m = /^(.*)\/(\d+)$/.exec(c);
  if (m) { key = m[1]; op = Number(m[2]) / 100; }
  if (key[0] === '$') {
    const name = key.slice(1);
    if (!(name in K.light)) throw new Error(`Unknown design token ${key}`);
    binds[path] = K.tok[name];
    return solid(K.light[name], op);
  }
  return solid(key, op);
}
const done = (n: SceneNode, binds: Record<string, string>) => { if (Object.keys(binds).length) n.varBindings = binds; return n; };
const kids = (k: Kid[]): N[] => k.filter((x): x is N => !!x);
const ALIGN = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN' } as const;

function sizing(n: SceneNode, w: Size | undefined, h: Size | undefined, hugDefault: boolean) {
  if (typeof w === 'number') { n.width = w; n.sizingH = 'FIXED'; } else if (w === 'fill') n.sizingH = 'FILL'; else if (w === 'hug' || (hugDefault && w === undefined)) n.sizingH = 'HUG';
  if (typeof h === 'number') { n.height = h; n.sizingV = 'FIXED'; } else if (h === 'fill') n.sizingV = 'FILL'; else if (h === 'hug' || (hugDefault && h === undefined)) n.sizingV = 'HUG';
}
function look(n: SceneNode, o: FO, binds: Record<string, string>) {
  if (o.fill) n.fills = [paintOf(o.fill, 'fills.0.color', binds)];
  if (o.stroke) { n.strokes = [paintOf(o.stroke, 'strokes.0.color', binds)]; n.strokeWeight = o.sw ?? 1; n.strokeAlign = 'INSIDE'; if (o.dash) n.dashes = o.dash; }
  if (typeof o.r === 'number') n.cornerRadius = o.r;
  else if (typeof o.r === 'string') { n.cornerRadius = RADIUS_TOKENS[o.r]; binds.cornerRadius = K.radius[o.r]; }
  else if (Array.isArray(o.r)) n.cornerRadii = o.r as [number, number, number, number];
  if (o.shadow) n.effects = structuredClone(SHADOWS[o.shadow]);
  if (o.op !== undefined) n.opacity = o.op;
  if (o.abs) { n.absolute = true; n.x = o.abs.x; n.y = o.abs.y; }
  if (o.hidden) n.visible = false;
  if (o.vis) n.bind = { ...n.bind, visible: o.vis };
}

/** Auto-layout frame. Hugs its content unless a size is given. */
export function F(o: FO, ...k: Kid[]): N {
  const p = o.pad ?? 0; const [t, r, b, l] = typeof p === 'number' ? [p, p, p, p] : p.length === 2 ? [p[0], p[1], p[0], p[1]] : (p as number[]);
  const layout: AutoLayout = { mode: o.dir === 'col' ? 'VERTICAL' : 'HORIZONTAL', gap: o.gap ?? 0, padT: t, padR: r, padB: b, padL: l, primaryAlign: ALIGN[o.main ?? 'start'], counterAlign: { start: 'MIN', center: 'CENTER', end: 'MAX' }[o.cross ?? 'start'] as 'MIN' | 'CENTER' | 'MAX' };
  const n = defaultNode('FRAME', { name: o.name ?? 'Frame', layout, fills: [], clipsContent: !!o.clip, width: 100, height: 40 });
  const binds: Record<string, string> = {};
  sizing(n, o.w, o.h, true); look(n, o, binds);
  return { n: done(n, binds), k: kids(k) };
}
export const row = (o: FO, ...k: Kid[]) => F({ dir: 'row', cross: 'center', ...o }, ...k);
export const col = (o: FO, ...k: Kid[]) => F({ dir: 'col', ...o }, ...k);

function shape(type: 'RECT' | 'ELLIPSE', o: FO & { h?: Size }): N {
  const n = defaultNode(type, { name: o.name ?? (type === 'RECT' ? 'Rectangle' : 'Ellipse'), fills: [], width: 20, height: 20 });
  const binds: Record<string, string> = {};
  sizing(n, o.w, o.h, false); look(n, o, binds);
  return { n: done(n, binds), k: [] };
}
export const R = (o: FO) => shape('RECT', o);
export const E = (o: FO) => shape('ELLIPSE', o);
/** 1px divider (or `h`/`w` thick) */
export const Div = (o: FO & { v?: boolean } = {}) => R({ name: 'Divider', fill: '$border', ...(o.v ? { w: 1, h: 'fill' as Size } : { w: 'fill' as Size, h: 1 }), ...o });

export function T(s: string, o: TO = {}): N {
  const size = o.s ?? 14, weight = o.w ?? 400, binds: Record<string, string> = {};
  const n = defaultNode('TEXT', { name: o.name ?? s.slice(0, 24), fills: [paintOf(o.c ?? '$text', 'fills.0.color', binds)] });
  n.text = { characters: s, fontFamily: o.mono ? MONO : FONT, fontSize: size, fontWeight: weight, italic: !!o.italic, lineHeight: o.lh ?? 'AUTO', letterSpacing: o.ls ?? 0, align: o.al ?? 'LEFT', resize: o.fw ? 'AUTO_HEIGHT' : 'AUTO_WIDTH', ...(o.deco ? { decoration: o.deco } : {}), ...(o.case ? { textCase: o.case } : {}) };
  const lh = typeof o.lh === 'number' ? o.lh : Math.round(size * 1.2 * 100) / 100;
  const est = s.length * size * 0.56;
  if (typeof o.fw === 'number') { n.width = o.fw; n.sizingH = 'FIXED'; n.height = Math.ceil(est / o.fw) * lh; }
  else if (o.fw === 'fill') { n.sizingH = 'FILL'; n.width = 200; n.height = lh; }
  else { n.width = Math.ceil(est); n.height = lh; }
  if (o.prop) n.bind = { characters: o.prop };
  if (o.vis) n.bind = { ...n.bind, visible: o.vis };
  if (o.hidden) n.visible = false;
  if (o.abs) { n.absolute = true; n.x = o.abs.x; n.y = o.abs.y; }
  return { n: done(n, binds), k: [] };
}

/** Open polyline in a w×h box (points in 0..w, 0..h) */
export function V(w: number, h: number, pts: [number, number][], o: { c?: string; sw?: number; closed?: boolean; fill?: string; name?: string } = {}): N {
  const binds: Record<string, string> = {};
  const path: PathPoint[] = pts.map(([x, y]) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 }));
  const n = defaultNode('VECTOR', { name: o.name ?? 'Line', width: w, height: h, fills: [], strokes: [paintOf(o.c ?? '$primary', 'strokes.0.color', binds)], strokeWeight: o.sw ?? 2, strokeAlign: 'CENTER', strokeCap: 'ROUND', strokeJoin: 'ROUND', path: { points: path, closed: !!o.closed } });
  if (o.fill) n.fills = [paintOf(o.fill, 'fills.0.color', binds)];
  return { n: done(n, binds), k: [] };
}

/** Simple glyph icon (system symbol fonts supply the shapes; swap for your own icon set) */
export const GLYPH: Record<string, string> = { check: '✓', close: '✕', down: '▾', up: '▴', right: '›', left: '‹', plus: '+', minus: '−', star: '★', starO: '☆', menu: '☰', home: '⌂', heart: '♥', warn: '⚠', info: 'ⓘ', dots: '⋯', gear: '⚙', cal: '▦', eye: '◉', user: '●', bell: '◆', mail: '✉', dl: '↓', ul: '↑', back: '←', fwd: '→', search: '⌕', dot: '•', circle: '○' };
export const Ic = (name: string, size = 16, c = '$text', o: TO = {}) => T(GLYPH[name] ?? name, { s: size, c, w: 600, name: `Icon/${name}`, ...o });

/** Magnifier built from shapes */
export function SearchIcon(size = 16, c = '$textMuted'): N {
  const s = size;
  const f = F({ name: 'Icon/search', w: s, h: s });
  f.n.layout = undefined; f.n.sizingH = 'FIXED'; f.n.sizingV = 'FIXED'; f.n.fills = []; f.n.clipsContent = false;
  const ring = E({ w: s * 0.62, h: s * 0.62, stroke: c, sw: 1.6 }); ring.n.x = s * 0.06; ring.n.y = s * 0.06;
  const handle = R({ w: s * 0.36, h: 1.8, fill: c, r: 1 }); handle.n.x = s * 0.62; handle.n.y = s * 0.7; handle.n.rotation = 45;
  f.k = [ring, handle];
  return f;
}
