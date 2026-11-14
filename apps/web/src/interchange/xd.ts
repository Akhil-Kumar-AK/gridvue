import { DocStore, addNode, createEmptyDocument, defaultNode, newId, pageIds, solid, type DocumentData, type Effect, type NativeFile, type Paint, type PathPoint, type SceneNode, type VectorPath } from '@layr/core';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import { toBase64, type AssetSource, type Imported } from './fig';

/*
 * Adobe XD (.xd) is a zip of JSON "graphic content" files (artwork/artboard-*​/graphics/graphicContent.agc), a manifest and resources/.
 * This reader and writer follow the community-documented structure. Adobe no longer ships XD, so neither side could be checked against the app.
 */
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const h2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0').toUpperCase();
const colorHex = (c: any) => (c?.value ? `#${h2(c.value.r)}${h2(c.value.g)}${h2(c.value.b)}` : '#000000');
const colorAlpha = (c: any) => num(c?.alpha, 1);
const sniff = (b: Uint8Array): string | null => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x47 && b[1] === 0x49 ? 'image/gif' : null);

/** SVG path data → paths (arcs become straight lines to their end point). */
export function parseSvgPath(d: string): VectorPath[] {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: VectorPath[] = [];
  let cur: PathPoint[] = [], closed = false, i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0;
  const pt = (px: number, py: number): PathPoint => ({ x: px, y: py, ix: 0, iy: 0, ox: 0, oy: 0 });
  const finish = () => { if (cur.length > 1) { if (closed && cur.length > 2 && Math.hypot(cur[0].x - cur.at(-1)!.x, cur[0].y - cur.at(-1)!.y) < 1e-3) { cur[0].ix = cur.at(-1)!.ix; cur[0].iy = cur.at(-1)!.iy; cur.pop(); } out.push({ points: cur, closed }); } cur = []; closed = false; };
  const n = () => parseFloat(toks[i++]);
  const cubic = (c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number) => { const p = cur.at(-1)!; p.ox = c1x - p.x; p.oy = c1y - p.y; const q = pt(ex, ey); q.ix = c2x - ex; q.iy = c2y - ey; cur.push(q); lcx = c2x; lcy = c2y; x = ex; y = ey; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'M') { finish(); x = n() + ox; y = n() + oy; sx = x; sy = y; cur.push(pt(x, y)); cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') { x = n() + ox; y = n() + oy; cur.push(pt(x, y)); }
    else if (C === 'H') { x = n() + ox; cur.push(pt(x, y)); }
    else if (C === 'V') { y = n() + oy; cur.push(pt(x, y)); }
    else if (C === 'C') cubic(n() + ox, n() + oy, n() + ox, n() + oy, n() + ox, n() + oy);
    else if (C === 'S') { const c1x = 2 * x - lcx, c1y = 2 * y - lcy; cubic(c1x, c1y, n() + ox, n() + oy, n() + ox, n() + oy); }
    else if (C === 'Q') { const qx = n() + ox, qy = n() + oy, ex = n() + ox, ey = n() + oy; cubic(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey); }
    else if (C === 'A') { i += 5; x = n() + ox; y = n() + oy; cur.push(pt(x, y)); }
    else if (C === 'Z') { closed = true; finish(); x = sx; y = sy; cur = [pt(x, y)]; cur.length = 0; cmd = ''; }
    else i++;
  }
  finish();
  return out;
}

export function importXd(bytes: Uint8Array, fileName: string): Imported {
  const z = unzipSync(bytes);
  const json = (k: string): any => { try { return JSON.parse(strFromU8(z[k])); } catch { return null; } };
  const doc = createEmptyDocument(), assets: NativeFile['assets'] = {}, notes = new Set<string>();
  const store = new DocStore(doc);
  const page = pageIds(store.doc)[0];
  const agcs = Object.keys(z).filter(k => k.endsWith('graphicContent.agc'));
  if (!agcs.length) throw new Error('This does not look like an Adobe XD file (no artwork found)');
  const geo = new Map<string, any>(), gradients: Record<string, any> = {}, imageIds = new Map<string, string>();
  for (const k of agcs) { const j = json(k); if (j?.artboards) for (const [id, g] of Object.entries<any>(j.artboards)) geo.set(id, g); Object.assign(gradients, j?.resources?.gradients ?? {}); }
  const asset = (uid: string): string | null => {
    if (imageIds.has(uid)) return imageIds.get(uid)!;
    const key = Object.keys(z).find(k => k.startsWith('resources/') && (k.endsWith(`/${uid}`) || k.includes(uid)));
    const data = key && z[key]; const mime = data && sniff(data);
    if (!data || !mime) return null;
    const id = newId('asset'); imageIds.set(uid, id); doc.assets[id] = { name: uid.slice(0, 8), mime }; assets[id] = { mime, base64: toBase64(data) };
    return id;
  };
  const paint = (f: any, w: number, h: number): Paint | null => {
    if (!f || f.type === 'none') return null;
    if (f.type === 'solid') return solid(colorHex(f.color), colorAlpha(f.color));
    if (f.type === 'gradient') {
      const gr = gradients[f.gradient?.ref] ?? f.gradient; if (!gr?.stops) return solid('#C8C8C8');
      const dx = (num(gr.x2, 1) - num(gr.x1)) * (gr.units === 'userSpaceOnUse' ? 1 : w), dy = (num(gr.y2) - num(gr.y1)) * (gr.units === 'userSpaceOnUse' ? 1 : h);
      if (gr.type && gr.type !== 'linear') notes.add('radial gradients were approximated as linear gradients');
      return { type: 'LINEAR', angle: (Math.atan2(dy, dx) * 180) / Math.PI + 0, opacity: 1, visible: true, stops: gr.stops.map((s: any) => ({ pos: num(s.offset), color: colorHex(s.color), opacity: colorAlpha(s.color) })) };
    }
    if (f.type === 'pattern') { const id = asset(f.pattern?.meta?.ux?.uid ?? ''); if (id) return { type: 'IMAGE', assetId: id, scaleMode: f.pattern?.meta?.ux?.scaleBehavior === 'fit' ? 'FIT' : 'FILL', opacity: 1, visible: true }; notes.add('some images could not be read and became grey'); return solid('#C8C8C8'); }
    return null;
  };
  const style = (n: SceneNode, st: any, w: number, h: number) => {
    const fill = paint(st?.fill, w, h); if (fill) n.fills = [fill];
    const s = st?.stroke;
    if (s && s.type !== 'none') { const p = paint(s, w, h); if (p) { n.strokes = [p]; n.strokeWeight = num(s.width, 1); n.strokeAlign = s.align === 'inside' ? 'INSIDE' : s.align === 'outside' ? 'OUTSIDE' : 'CENTER'; if (s.cap === 'round') n.strokeCap = 'ROUND'; else if (s.cap === 'square') n.strokeCap = 'SQUARE'; if (s.join === 'round') n.strokeJoin = 'ROUND'; else if (s.join === 'bevel') n.strokeJoin = 'BEVEL'; if (Array.isArray(s.dash) && s.dash.length) n.dashes = s.dash.map(Number); } }
    if (typeof st?.opacity === 'number') n.opacity = st.opacity;
    const fx: Effect[] = [];
    for (const f of st?.filters ?? []) if (f.type === 'dropShadow' && f.visible !== false) fx.push({ type: 'DROP_SHADOW', x: num(f.params?.dx), y: num(f.params?.dy), blur: num(f.params?.r), color: colorHex(f.params?.color), opacity: colorAlpha(f.params?.color), visible: true });
    if (fx.length) n.effects = fx;
  };
  const place = (n: SceneNode, t: any, lx: number, ly: number) => {
    const a = num(t?.a, 1), b = num(t?.b), c = num(t?.c), d = num(t?.d, 1);
    n.x = num(t?.tx) + a * lx + c * ly; n.y = num(t?.ty) + b * lx + d * ly;
    n.rotation = Math.abs(b) > 1e-6 || a < 0 ? Math.round(((Math.atan2(b, a) * 180) / Math.PI) * 1000) / 1000 : 0;
  };
  const walk = (o: any, parent: SceneNode | null, out: SceneNode[]): SceneNode | null => {
    const st = o.style, t = o.transform;
    let node: SceneNode | null = null;
    if (o.type === 'group') {
      node = defaultNode('GROUP', { name: o.name ?? 'Group' }); place(node, t, 0, 0);
      if (typeof st?.opacity === 'number') node.opacity = st.opacity;
    } else if (o.type === 'shape') {
      const s = o.shape ?? {}; const T = s.type;
      if (T === 'rect') { node = defaultNode('RECT', { name: o.name ?? 'Rectangle', width: num(s.width, 1), height: num(s.height, 1), fills: [] }); place(node, t, num(s.x), num(s.y)); const r = s.r; if (Array.isArray(r)) { if (r.every((v: number) => v === r[0])) node.cornerRadius = num(r[0]); else node.cornerRadii = [num(r[0]), num(r[1]), num(r[2]), num(r[3])]; } else node.cornerRadius = num(r); }
      else if (T === 'ellipse' || T === 'circle') { const rx = num(s.rx ?? s.r, 1), ry = num(s.ry ?? s.r, 1); node = defaultNode('ELLIPSE', { name: o.name ?? 'Ellipse', width: rx * 2, height: ry * 2, fills: [] }); place(node, t, num(s.cx) - rx, num(s.cy) - ry); }
      else if (T === 'line') { const dx = num(s.x2) - num(s.x1), dy = num(s.y2) - num(s.y1); node = defaultNode('LINE', { name: o.name ?? 'Line', width: Math.hypot(dx, dy) || 1, fills: [] }); place(node, t, num(s.x1), num(s.y1)); node.rotation = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + node.rotation) * 1000) / 1000; }
      else if (T === 'path' || T === 'compound' || T === 'polygon') {
        const d = T === 'polygon' ? `M${(s.points ?? []).map((p: any) => `${p.x} ${p.y}`).join('L')}Z` : String(s.path ?? '');
        const paths = parseSvgPath(d);
        if (!paths.length) return null;
        const xs = paths.flatMap(p => p.points.map(q => q.x)), ys = paths.flatMap(p => p.points.map(q => q.y)), x0 = Math.min(...xs), y0 = Math.min(...ys);
        const shift = (p: VectorPath): VectorPath => ({ closed: p.closed, points: p.points.map(q => ({ ...q, x: q.x - x0, y: q.y - y0 })) });
        node = defaultNode('VECTOR', { name: o.name ?? 'Path', width: Math.max(1, Math.max(...xs) - x0), height: Math.max(1, Math.max(...ys) - y0), fills: [], path: shift(paths[0]), subpaths: paths.length > 1 ? paths.slice(1).map(shift) : undefined });
        place(node, t, x0, y0);
      } else { notes.add(`${String(T)} shapes are not supported and were skipped`); return null; }
      style(node, st, node.width, node.height);
    } else if (o.type === 'text') {
      const tx = o.text ?? {}, f = st?.font ?? {}, fs = num(f.size, 16);
      node = defaultNode('TEXT', { name: String(o.name ?? tx.rawText ?? 'Text').slice(0, 60), width: num(tx.frame?.width, 100), height: num(tx.frame?.height, fs * 1.3), fills: [solid(colorHex(st?.fill?.color), colorAlpha(st?.fill?.color))] });
      place(node, t, 0, 0);
      const style2 = String(f.style ?? ''), ta = st?.textAttributes ?? {};
      node.text = { ...node.text!, characters: String(tx.rawText ?? ''), fontFamily: `"${f.family ?? 'Inter'}", Inter, Helvetica, Arial, sans-serif`, fontSize: fs, fontWeight: /black/i.test(style2) ? 900 : /extra\s*bold|heavy/i.test(style2) ? 800 : /semi\s*bold|demi/i.test(style2) ? 600 : /bold/i.test(style2) ? 700 : /medium/i.test(style2) ? 500 : /light/i.test(style2) ? 300 : /thin/i.test(style2) ? 100 : 400, italic: /italic|oblique/i.test(style2), letterSpacing: (num(ta.charSpacing) / 1000) * fs, lineHeight: ta.lineSpacing ? num(ta.lineSpacing) : 'AUTO', align: ta.paragraphAlign === 'center' ? 'CENTER' : ta.paragraphAlign === 'right' ? 'RIGHT' : 'LEFT', resize: tx.frame?.type === 'positioned' ? 'FIXED' : 'AUTO_WIDTH' };
      if (ta.underline) node.text.decoration = 'UNDERLINE'; else if (ta.strikethrough) node.text.decoration = 'STRIKE';
      if (typeof st?.opacity === 'number') node.opacity = st.opacity;
    } else return null;
    node.parent = parent?.id ?? null; node.visible = o.visible !== false;
    out.push(node);
    for (const k of o.group?.children ?? []) { const c = walk(k, node, out); if (c) node.children.push(c.id); }
    return node;
  };
  // artboards: geometry from the `artboards` maps, contents from each artboard's own graphicContent.agc
  const trees: SceneNode[][] = [];
  const artFiles = agcs.filter(k => /artwork\/artboard-/.test(k));
  for (const k of artFiles) {
    const j = json(k); const ab = j?.children?.[0]; if (!ab) continue;
    const uid = /artboard-([^/]+)\//.exec(k)![1], g = geo.get(`artboard-${uid}`) ?? geo.get(uid) ?? geo.get(ab.id) ?? ab.artboard ?? {};
    const w = num(g.width ?? ab.artboard?.width, 375), h = num(g.height ?? ab.artboard?.height, 812);
    const frame = defaultNode('FRAME', { name: ab.name ?? 'Artboard', x: num(g.x), y: num(g.y), width: w, height: h, fills: [solid('#FFFFFF')], clipsContent: true, parent: page });
    const out: SceneNode[] = [frame];
    const bg = paint(ab.style?.fill, w, h); if (bg) frame.fills = [bg];
    for (const c of ab.artboard?.children ?? []) { const n = walk(c, frame, out); if (n) frame.children.push(n.id); }
    trees.push(out);
  }
  const pasteboard = json(agcs.find(k => /pasteboard/.test(k)) ?? '');
  for (const c of pasteboard?.children ?? []) { if (c.type === 'artboard') continue; const out: SceneNode[] = []; const n = walk(c, null, out); if (n) { n.parent = page; trees.push(out); } }
  if (!trees.length) throw new Error('No supported layers found in this XD file');
  for (const tree of trees) { tree[0].parent = page; store.apply({ t: 'insert', nodes: tree, parent: page, index: store.doc.nodes[page].children.length }); }
  return { name: fileName.replace(/\.xd$/i, ''), doc: store.doc, assets, notes: [...notes] };
}

// ---------------------------------------------------------------- export
const rgbv = (hex: string, alpha = 1) => { const v = hex.replace('#', '').padEnd(6, '0'); return { mode: 'RGB', value: { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) }, alpha }; };
const svgPath = (paths: VectorPath[]) => paths.map(p => { const P = p.points; if (P.length < 2) return ''; let d = `M${P[0].x} ${P[0].y}`; const segs = p.closed ? P.length : P.length - 1; for (let i = 0; i < segs; i++) { const a = P[i], b = P[(i + 1) % P.length]; d += a.ox || a.oy || b.ix || b.iy ? `C${a.x + a.ox} ${a.y + a.oy} ${b.x + b.ix} ${b.y + b.iy} ${b.x} ${b.y}` : `L${b.x} ${b.y}`; } return d + (p.closed ? 'Z' : ''); }).join('');
const uuid = () => crypto.randomUUID();

/** Layr page → .xd: top-level frames become artboards, everything else goes on the pasteboard. Images are stored in resources/. */
export async function exportXd(doc: DocumentData, pageId: string, fileName: string, getAsset: AssetSource): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const uidOf = new Map<string, string>();
  for (const id of Object.keys(doc.assets)) { try { const a = await getAsset(id); const uid = uuid(); uidOf.set(id, uid); files[`resources/${uid}`] = a.bytes; } catch { /* skip */ } }
  const gradients: Record<string, any> = {};
  const fill = (p: Paint, w: number, h: number): any => {
    if (p.type === 'SOLID') return { type: 'solid', color: rgbv(p.color, p.opacity) };
    if (p.type === 'LINEAR') {
      const a = (p.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a), half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2, ref = uuid();
      gradients[ref] = { type: 'linear', x1: (w / 2 - dx * half) / (w || 1), y1: (h / 2 - dy * half) / (h || 1), x2: (w / 2 + dx * half) / (w || 1), y2: (h / 2 + dy * half) / (h || 1), stops: p.stops.map(s => ({ offset: s.pos, color: rgbv(s.color, s.opacity) })) };
      return { type: 'gradient', gradient: { ref } };
    }
    const uid = uidOf.get(p.assetId); if (!uid) return { type: 'solid', color: rgbv('#C8C8C8') };
    return { type: 'pattern', pattern: { width: w, height: h, meta: { ux: { uid, scaleBehavior: p.scaleMode === 'FIT' ? 'fit' : 'fill' } } } };
  };
  const styleOf = (n: SceneNode) => {
    const st: any = { opacity: n.opacity };
    const f = n.fills.find(x => x.visible); st.fill = f ? fill(f, n.width, n.height) : { type: 'none' };
    const s = n.strokes.find(x => x.visible);
    if (s) st.stroke = { ...fill(s, n.width, n.height), width: n.strokeWeight, align: n.strokeAlign.toLowerCase(), cap: (n.strokeCap ?? 'NONE') === 'NONE' ? 'butt' : n.strokeCap!.toLowerCase(), join: (n.strokeJoin ?? 'MITER').toLowerCase(), dash: n.dashes ?? [] };
    const sh = n.effects.filter(e => e.type === 'DROP_SHADOW' && e.visible) as Extract<Effect, { type: 'DROP_SHADOW' }>[];
    if (sh.length) st.filters = sh.map(e => ({ type: 'dropShadow', visible: true, params: { dx: e.x, dy: e.y, r: e.blur, color: rgbv(e.color, e.opacity) } }));
    return st;
  };
  const tf = (n: SceneNode) => { const r = (n.rotation * Math.PI) / 180; return { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), tx: n.x, ty: n.y }; };
  const node = (n: SceneNode): any | null => {
    const base: any = { id: uuid(), name: n.name, visible: n.visible, transform: tf(n) };
    switch (n.type) {
      case 'GROUP': return { ...base, type: 'group', style: { opacity: n.opacity }, group: { children: n.children.map(c => node(doc.nodes[c])).filter(Boolean) } };
      case 'FRAME': case 'COMPONENT': case 'COMPONENT_SET': case 'INSTANCE': {
        const bg = { id: uuid(), name: `${n.name} background`, visible: true, type: 'shape', transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, shape: { type: 'rect', x: 0, y: 0, width: n.width, height: n.height, r: n.cornerRadii ?? [n.cornerRadius, n.cornerRadius, n.cornerRadius, n.cornerRadius] }, style: styleOf(n) };
        return { ...base, type: 'group', style: { opacity: n.opacity }, group: { children: [bg, ...n.children.map(c => node(doc.nodes[c])).filter(Boolean)] } };
      }
      case 'RECT': return { ...base, type: 'shape', style: styleOf(n), shape: { type: 'rect', x: 0, y: 0, width: n.width, height: n.height, r: n.cornerRadii ?? [n.cornerRadius, n.cornerRadius, n.cornerRadius, n.cornerRadius] } };
      case 'ELLIPSE': return { ...base, type: 'shape', style: styleOf(n), shape: { type: 'ellipse', cx: n.width / 2, cy: n.height / 2, rx: n.width / 2, ry: n.height / 2 } };
      case 'LINE': return { ...base, type: 'shape', style: styleOf(n), shape: { type: 'line', x1: 0, y1: 0, x2: n.width, y2: 0 } };
      case 'VECTOR': return { ...base, type: 'shape', style: styleOf(n), shape: { type: 'path', path: svgPath([n.path!, ...(n.subpaths ?? [])]) } };
      case 'TEXT': {
        const t = n.text!, fam = t.fontFamily.split(',')[0].replace(/["']/g, '').trim() || 'Inter';
        const w = ({ 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' } as Record<number, string>)[t.fontWeight] ?? 'Regular';
        const st = styleOf(n);
        return { ...base, type: 'text', style: { ...st, font: { family: fam, style: t.italic ? `${w}Italic` : w, size: t.fontSize }, textAttributes: { charSpacing: (t.letterSpacing / t.fontSize) * 1000, lineSpacing: t.lineHeight === 'AUTO' ? 0 : t.lineHeight, paragraphAlign: t.align.toLowerCase(), underline: t.decoration === 'UNDERLINE', strikethrough: t.decoration === 'STRIKE' } },
          text: { rawText: t.characters, paragraphs: [{ lines: [[{ x: 0, y: t.fontSize, from: 0, to: t.characters.length }]] }], frame: t.resize === 'AUTO_WIDTH' ? { type: 'autoWidth' } : { type: 'positioned', width: n.width, height: n.height } } };
      }
      default: return null;
    }
  };
  const page = doc.nodes[pageId];
  const artboards: Record<string, any> = {}, manifestArtboards: any[] = [], pasteboard: any[] = [];
  for (const id of page.children) {
    const n = doc.nodes[id];
    if (n.type === 'FRAME' || n.type === 'COMPONENT') {
      const uid = uuid(), key = `artboard-${uid}`;
      artboards[key] = { x: n.x, y: n.y, width: n.width, height: n.height, viewportHeight: n.height };
      const content = { version: '1.1', resources: { gradients: {} as Record<string, any> }, children: [{ id: uuid(), type: 'artboard', name: n.name, style: styleOf(n), artboard: { children: n.children.map(c => node(doc.nodes[c])).filter(Boolean), ref: uid, meta: { ux: {} } } }] };
      content.resources.gradients = gradients; // gradients created while walking this artboard (shared map is fine: refs are unique)
      files[`artwork/${key}/graphics/graphicContent.agc`] = strToU8(JSON.stringify(content));
      manifestArtboards.push({ id: uid, path: key, name: n.name, type: 'application/vnd.adobe.sparkler.artboard+dcx' });
    } else { const x = node(n); if (x) pasteboard.push(x); }
  }
  files['artwork/pasteboard/graphics/graphicContent.agc'] = strToU8(JSON.stringify({ version: '1.1', artboards, resources: { gradients }, children: pasteboard }));
  files['manifest'] = strToU8(JSON.stringify({ type: 'application/vnd.adobe.sparkler.project+dcx', name: fileName, children: [{ path: 'artwork', type: 'application/vnd.adobe.sparkler.artboard.collection', children: manifestArtboards }, { path: 'resources', type: 'application/vnd.adobe.sparkler.resources' }] }));
  files['mimetype'] = strToU8('application/vnd.adobe.sparkler.project+dcx');
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: k.startsWith('resources/') ? 0 : 6 }]])));
}
