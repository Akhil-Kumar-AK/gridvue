import { defaultNode, solid, type Effect, type Paint, type PathPoint, type SceneNode, type VectorPath } from '@layr/core';
import type { FigmaMessage } from './decode';

export interface Converted { trees: SceneNode[][]; notes: string[]; count: number; /** one entry per Figma page when the data came from a .fig file */ pages: { name: string; trees: SceneNode[][] }[] }
export interface ConvertOptions { /** resolves a Figma image hash (hex) to a stored asset id; without it images become grey placeholders */ image?: (hash: string) => string | null }

const hex2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, '0').toUpperCase();
const hex = (c: { r: number; g: number; b: number } | undefined) => (c ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}` : '#000000');
const gkey = (g: any) => (g ? `${g.sessionID}:${g.localID}` : '');
const num = (v: any, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Path commands from a Figma geometry blob: 0 close, 1 move, 2 line, 3 cubic, 4 quadratic (float32 little-endian). */
export function parseCommands(bytes: Uint8Array): VectorPath[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: VectorPath[] = [];
  let cur: PathPoint[] = [], closed = false, o = 0;
  const f = () => { const v = dv.getFloat32(o, true); o += 4; return v; };
  const finish = () => { if (cur.length > 1) { if (closed && cur.length > 2) { const a = cur[0], z = cur[cur.length - 1]; if (Math.abs(a.x - z.x) < 1e-3 && Math.abs(a.y - z.y) < 1e-3) { a.ix = z.ix; a.iy = z.iy; cur.pop(); } } out.push({ points: cur, closed }); } cur = []; closed = false; };
  const pt = (x: number, y: number): PathPoint => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });
  while (o < bytes.length) {
    const cmd = bytes[o++];
    if (cmd === 1) { finish(); cur.push(pt(f(), f())); }
    else if (cmd === 2) { if (!cur.length) continue; cur.push(pt(f(), f())); }
    else if (cmd === 3) {
      if (!cur.length) continue;
      const c1x = f(), c1y = f(), c2x = f(), c2y = f(), x = f(), y = f(), p = cur[cur.length - 1];
      p.ox = c1x - p.x; p.oy = c1y - p.y;
      const q = pt(x, y); q.ix = c2x - x; q.iy = c2y - y; cur.push(q);
    } else if (cmd === 4) {
      if (!cur.length) continue;
      const cx = f(), cy = f(), x = f(), y = f(), p = cur[cur.length - 1];
      p.ox = ((cx - p.x) * 2) / 3; p.oy = ((cy - p.y) * 2) / 3;
      const q = pt(x, y); q.ix = ((cx - x) * 2) / 3; q.iy = ((cy - y) * 2) / 3; cur.push(q);
    } else if (cmd === 0) { closed = true; finish(); }
    else break; // unknown command: stop rather than guess
  }
  finish();
  return out;
}

const WEIGHTS: [RegExp, number][] = [[/thin|hairline/i, 100], [/extra\s*light|ultra\s*light/i, 200], [/semi\s*bold|demi/i, 600], [/extra\s*bold|ultra\s*bold|heavy/i, 800], [/black/i, 900], [/bold/i, 700], [/medium/i, 500], [/light/i, 300]];
const weightOf = (style: string | undefined) => (style ? WEIGHTS.find(([re]) => re.test(style))?.[1] ?? 400 : 400);

/** Figma layers → Layr layers. Positions, sizes, paints, text, effects and vector geometry are kept; images become grey placeholders. */
export function convertFigma(msg: FigmaMessage, opts: ConvertOptions = {}): Converted {
  const notes = new Set<string>();
  const byKey = new Map<string, any>(), kids = new Map<string, any[]>();
  for (const nc of msg.nodeChanges) { if (!nc.guid || nc.phase === 'REMOVED') continue; byKey.set(gkey(nc.guid), nc); }
  for (const nc of byKey.values()) { const p = gkey(nc.parentIndex?.guid); (kids.get(p) ?? kids.set(p, []).get(p)!).push(nc); }
  for (const list of kids.values()) list.sort((a, b) => String(a.parentIndex?.position ?? '').localeCompare(String(b.parentIndex?.position ?? '')));
  const structural = new Set(['DOCUMENT', 'CANVAS']);
  const roots: any[] = [];
  for (const nc of byKey.values()) {
    if (structural.has(nc.type)) continue;
    const parent = byKey.get(gkey(nc.parentIndex?.guid));
    if (!parent || structural.has(parent.type)) roots.push(nc);
  }
  roots.sort((a, b) => String(a.parentIndex?.position ?? '').localeCompare(String(b.parentIndex?.position ?? '')));

  const paints = (list: any[] | undefined, size: { w: number; h: number }): Paint[] => {
    const out: Paint[] = [];
    for (const p of list ?? []) {
      const visible = p.visible !== false, opacity = num(p.opacity, 1);
      if (p.type === 'SOLID') out.push({ ...solid(hex(p.color), opacity * num(p.color?.a, 1)), visible });
      else if (typeof p.type === 'string' && p.type.startsWith('GRADIENT')) {
        const t = p.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, det = t.m00 * t.m11 - t.m01 * t.m10;
        const dx = det ? (t.m11 / det) * size.w : 1, dy = det ? (-t.m10 / det) * size.h : 0;
        if (p.type !== 'GRADIENT_LINEAR') notes.add('radial / angular gradients were approximated as linear gradients');
        out.push({ type: 'LINEAR', angle: (Math.atan2(dy, dx) * 180) / Math.PI + 0, opacity, visible, stops: (p.stops ?? []).map((s: any) => ({ pos: num(s.position), color: hex(s.color), opacity: num(s.color?.a, 1) })) });
      } else if (p.type === 'IMAGE') {
        const h = p.image?.hash ? Array.from(p.image.hash as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('') : '';
        const asset = h && opts.image ? opts.image(h) : null;
        if (asset) out.push({ type: 'IMAGE', assetId: asset, scaleMode: p.imageScaleMode === 'FIT' ? 'FIT' : p.imageScaleMode === 'STRETCH' ? 'STRETCH' : 'FILL', opacity, visible });
        else { out.push({ ...solid('#C8C8C8', opacity), visible }); notes.add('image fills are not on the Figma clipboard; they were replaced with grey'); }
      }
    }
    return out;
  };
  const effects = (list: any[] | undefined): Effect[] => {
    const out: Effect[] = [];
    for (const e of list ?? []) {
      if (e.type === 'DROP_SHADOW') out.push({ type: 'DROP_SHADOW', x: num(e.offset?.x), y: num(e.offset?.y), blur: num(e.radius), color: hex(e.color), opacity: num(e.color?.a, 1), visible: e.visible !== false });
      else if (e.type === 'FOREGROUND_BLUR' || e.type === 'LAYER_BLUR') out.push({ type: 'LAYER_BLUR', radius: num(e.radius), visible: e.visible !== false });
      else notes.add('inner shadows and background blurs are not supported');
    }
    return out;
  };

  const trees: SceneNode[][] = [];
  let count = 0;
  const make = (nc: any, parent: SceneNode | null, out: SceneNode[], masterOf?: Map<string, any>): SceneNode | null => {
    const t: string = nc.type;
    const w = Math.max(0, num(nc.size?.x)), h = Math.max(0, num(nc.size?.y));
    const m = nc.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    if (m.m00 * m.m11 - m.m01 * m.m10 < 0) notes.add('flipped layers lose their mirroring');
    let type: SceneNode['type'] | null = null;
    switch (t) {
      case 'FRAME': case 'SYMBOL': case 'INSTANCE': case 'SECTION': case 'COMPONENT': type = 'FRAME'; break;
      case 'GROUP': type = 'GROUP'; break;
      case 'RECTANGLE': case 'ROUNDED_RECTANGLE': type = 'RECT'; break;
      case 'ELLIPSE': type = 'ELLIPSE'; break;
      case 'LINE': type = 'LINE'; break;
      case 'TEXT': type = 'TEXT'; break;
      case 'VECTOR': case 'STAR': case 'REGULAR_POLYGON': case 'BOOLEAN_OPERATION': type = 'VECTOR'; break;
      default: notes.add(`${t.toLowerCase().replace(/_/g, ' ')} layers are not supported and were skipped`); return null;
    }
    const size = { w, h };
    const contours: VectorPath[] = [];
    if (type === 'VECTOR') for (const g of [...(nc.fillGeometry ?? []), ...(nc.fillGeometry?.length ? [] : nc.strokeGeometry ?? [])]) { const blob = msg.blobs[g.commandsBlob]; if (blob) contours.push(...parseCommands(blob.bytes)); }
    if (type === 'VECTOR' && !contours.length) {
      if (t === 'BOOLEAN_OPERATION' && (kids.get(gkey(nc.guid)) ?? []).length) type = 'GROUP'; else type = 'RECT';
    }
    const node = defaultNode(type, {
      name: String(nc.name ?? t), x: num(m.m02), y: num(m.m12), width: type === 'LINE' ? w : Math.max(1, w), height: type === 'LINE' ? 0 : Math.max(1, h),
      rotation: Math.abs(m.m00 - 1) + Math.abs(m.m10) > 1e-6 ? Math.round(((Math.atan2(m.m10, m.m00) * 180) / Math.PI) * 1000) / 1000 : 0,
      visible: nc.visible !== false, locked: !!nc.locked, opacity: num(nc.opacity, 1), parent: parent?.id ?? null,
      fills: type === 'GROUP' || type === 'LINE' ? [] : paints(nc.fillPaints, size), strokes: paints(nc.strokePaints, size), strokeWeight: num(nc.strokeWeight, 1),
      strokeAlign: nc.strokeAlign === 'CENTER' ? 'CENTER' : nc.strokeAlign === 'OUTSIDE' ? 'OUTSIDE' : 'INSIDE', effects: effects(nc.effects), clipsContent: type === 'FRAME' ? nc.frameMaskDisabled !== true : false,
    });
    if (type === 'LINE') { node.strokeAlign = 'CENTER'; if (!node.strokes.length) node.strokes = [solid('#000000')]; }
    if (nc.strokeCap === 'ROUND' || nc.strokeCap === 'SQUARE') node.strokeCap = nc.strokeCap;
    if (nc.strokeJoin === 'ROUND' || nc.strokeJoin === 'BEVEL') node.strokeJoin = nc.strokeJoin;
    if (Array.isArray(nc.strokeDashes) && nc.strokeDashes.length) node.dashes = nc.strokeDashes.map(Number);
    if (['MULTIPLY', 'SCREEN', 'OVERLAY', 'DARKEN', 'LIGHTEN'].includes(nc.blendMode)) node.blendMode = nc.blendMode;
    if (type === 'RECT' || type === 'FRAME') {
      const tl = nc.rectangleTopLeftCornerRadius, tr = nc.rectangleTopRightCornerRadius, br = nc.rectangleBottomRightCornerRadius, bl = nc.rectangleBottomLeftCornerRadius, all = num(nc.cornerRadius);
      if ([tl, tr, br, bl].some(v => typeof v === 'number')) { const r: [number, number, number, number] = [num(tl, all), num(tr, all), num(br, all), num(bl, all)]; if (r.every(v => v === r[0])) node.cornerRadius = r[0]; else node.cornerRadii = r; } else node.cornerRadius = all;
    }
    if (type === 'VECTOR') { node.path = contours[0]; if (contours.length > 1) node.subpaths = contours.slice(1); }
    if (type === 'GROUP' && t === 'BOOLEAN_OPERATION') node.boolOp = ({ UNION: 'UNION', SUBTRACT: 'SUBTRACT', INTERSECT: 'INTERSECT', XOR: 'EXCLUDE' } as Record<string, SceneNode['boolOp']>)[nc.booleanOperation as string] ?? 'UNION';
    if (type === 'TEXT') {
      const fs = num(nc.fontSize, 16), fam = String(nc.fontName?.family ?? 'Inter'), style = String(nc.fontName?.style ?? '');
      const lh = nc.lineHeight, ls = nc.letterSpacing;
      node.text = {
        characters: String(nc.textData?.characters ?? ''), fontFamily: fam === 'Inter' ? 'Inter, Helvetica, Arial, sans-serif' : `"${fam}", Inter, Helvetica, Arial, sans-serif`, fontSize: fs, fontWeight: weightOf(style), italic: /italic/i.test(style),
        lineHeight: !lh || lh.units === 'AUTO' ? 'AUTO' : lh.units === 'PERCENT' ? Math.round((num(lh.value) / 100) * fs * 100) / 100 : lh.units === 'RAW' ? num(lh.value) * fs : num(lh.value),
        letterSpacing: !ls ? 0 : ls.units === 'PERCENT' ? Math.round((num(ls.value) / 100) * fs * 100) / 100 : num(ls.value),
        align: (['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'].includes(nc.textAlignHorizontal) ? nc.textAlignHorizontal : 'LEFT') as 'LEFT',
        resize: nc.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'AUTO_WIDTH' : nc.textAutoResize === 'HEIGHT' ? 'AUTO_HEIGHT' : 'FIXED',
      };
      if (nc.textAlignVertical === 'CENTER') node.text.vAlign = 'MIDDLE'; else if (nc.textAlignVertical === 'BOTTOM') node.text.vAlign = 'BOTTOM';
      if (nc.textDecoration === 'UNDERLINE') node.text.decoration = 'UNDERLINE'; else if (nc.textDecoration === 'STRIKETHROUGH') node.text.decoration = 'STRIKE';
      if (['UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'].includes(nc.textCase)) node.text.textCase = nc.textCase;
      if (num(nc.paragraphSpacing)) node.text.paragraphSpacing = num(nc.paragraphSpacing);
    }
    if (nc.stackMode === 'HORIZONTAL' || nc.stackMode === 'VERTICAL') notes.add('auto layout was converted to fixed positions');
    out.push(node); count++;
    const mkids = (type === 'FRAME' || type === 'GROUP') ? (kids.get(gkey(nc.guid)) ?? []) : [];
    let list = mkids;
    if (t === 'INSTANCE' && !list.length && nc.symbolData?.symbolID) list = kids.get(gkey(nc.symbolData.symbolID)) ?? []; // instance whose master travelled with the paste
    for (const k of list) { const c = make(k, node, out, masterOf); if (c) node.children.push(c.id); }
    return node;
  };
  const pageOf = new Map<string, { name: string; trees: SceneNode[][] }>();
  const canvases = [...byKey.values()].filter(n => n.type === 'CANVAS').sort((a, b) => String(a.parentIndex?.position ?? '').localeCompare(String(b.parentIndex?.position ?? '')));
  for (const c of canvases) if (c.internalOnly !== true) pageOf.set(gkey(c.guid), { name: String(c.name ?? 'Page'), trees: [] });
  for (const r of roots) {
    const out: SceneNode[] = [];
    if (!make(r, null, out)) continue;
    trees.push(out);
    pageOf.get(gkey(r.parentIndex?.guid))?.trees.push(out);
  }
  const pages = [...pageOf.values()].filter(p => p.trees.length);
  return { trees, notes: [...notes], count, pages };
}
