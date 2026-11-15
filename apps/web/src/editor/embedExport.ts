import { SHAPE_POLY, addNode, corner, defaultNode, flattenRoute, routeConnector, selectionBox, solid, strokePoints, tableSize, timerLeft, type BoardData, type EndPoint, type JamItem, type Pt, type SceneNode } from '@layr/core';
import { api } from '../api';
import { exportPng } from '../jam/render';
import type { EditorSession } from './session';
import { useEditor } from './state';

const ALIGN = { left: 'LEFT', center: 'CENTER', right: 'RIGHT' } as const;
const SANS = 'Inter, Helvetica, Arial, sans-serif', MONO = 'ui-monospace, Menlo, Consolas, monospace';
const CAP: Record<string, EndPoint> = { arrow: 'ARROW', triangle: 'TRIANGLE', diamond: 'DIAMOND', circle: 'CIRCLE', bar: 'SQUARE' };
const SHADOW = { type: 'DROP_SHADOW' as const, x: 0, y: 3, blur: 8, color: '#000000', opacity: 0.22, visible: true };

interface TextOpts { size?: number; color?: string; bold?: boolean; italic?: boolean; align?: JamItem['align']; family?: string; wrap?: boolean }
function textNode(chars: string, x: number, y: number, w: number, o: TextOpts = {}): SceneNode {
  const base = defaultNode('TEXT').text!;
  return defaultNode('TEXT', {
    name: chars.replace(/\s+/g, ' ').trim().slice(0, 28) || 'Text', x, y, width: w, fills: [solid(o.color ?? '#1e1e1e')],
    text: { ...base, characters: chars, fontFamily: o.family ?? SANS, fontSize: o.size ?? 16, fontWeight: o.bold ? 700 : 400, italic: !!o.italic, align: ALIGN[o.align ?? 'left'], resize: 'AUTO_HEIGHT' },
  });
}
/** An editable vector layer through world-space points; the layer's box is the points' box (or `box`, when given). */
function vectorNode(name: string, pts: Pt[], closed: boolean, patch: Partial<SceneNode>, box?: { x: number; y: number; w: number; h: number }): SceneNode {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = box?.x ?? Math.min(...xs), y = box?.y ?? Math.min(...ys), w = Math.max(1, box?.w ?? Math.max(...xs) - x), h = Math.max(1, box?.h ?? Math.max(...ys) - y);
  return defaultNode('VECTOR', { name, x, y, width: w, height: h, fills: [], path: { closed, points: pts.map(p => corner(p.x - x, p.y - y)) }, ...patch });
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Turn whiteboard items into editable design layers: stickies, text, sections, tables, code blocks, link cards, stamps, timers, shapes,
 * pen / marker / highlighter drawings and connectors all become real frames, text, shapes and vector paths. Only photos arrive as image layers.
 * `origin` is where the selection lands, in design-file world coordinates (its top-left, or its centre with `center`). Returns how many layers were added.
 */
export async function jamToDesign(session: EditorSession, board: BoardData, ids: string[], origin: { x: number; y: number; center?: boolean }): Promise<number> {
  const items = board.order.filter(id => ids.includes(id)).map(id => board.items[id]).filter((it): it is JamItem => !!it);
  if (!items.length) return 0;
  const box = selectionBox(board, items.map(i => i.id))!;
  const dx = origin.x - box.x - (origin.center ? box.w / 2 : 0), dy = origin.y - box.y - (origin.center ? box.h / 2 : 0);
  const shift = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  type Pending = { node: SceneNode; kids: { node: SceneNode; kids?: SceneNode[] }[] };
  const pending: Pending[] = [];
  const pictures: { item: JamItem; blob: Blob; w: number; h: number; x: number; y: number; ew: number; eh: number }[] = [];
  const tc = (it: JamItem) => it.textColor;

  for (const it of items) {
    const x = it.x + dx, y = it.y + dy, rot = it.rot || 0, k = it.kind;
    if (k === 'sticky') {
      pending.push({ node: defaultNode('FRAME', { name: 'Sticky note', x, y, width: it.w, height: it.h, rotation: rot, fills: [solid(it.color ?? '#ffe066')], cornerRadius: 4, clipsContent: false, effects: [SHADOW] }), kids: [{ node: textNode(it.text ?? '', 12, 12, it.w - 24, { size: it.fontSize ?? 16, color: tc(it), bold: it.bold, italic: it.italic, align: it.align }) }] });
    } else if (k === 'text') {
      pending.push({ node: { ...textNode(it.text ?? '', x, y, it.w, { size: it.fontSize ?? 20, color: tc(it) ?? it.color, bold: it.bold, italic: it.italic, align: it.align }), rotation: rot }, kids: [] });
    } else if (k === 'section') {
      pending.push({ node: defaultNode('FRAME', { name: it.text || 'Section', x, y, width: it.w, height: it.h, fills: [solid(it.color ?? '#d9d9d9', 0.4)], strokes: [solid(it.stroke ?? it.color ?? '#9a9a9a')], strokeWeight: 1, cornerRadius: 8, clipsContent: false }), kids: [] });
    } else if (k === 'shape') {
      const kind = it.shape ?? 'rect', poly = SHAPE_POLY[kind];
      const style = { fills: [solid(it.color ?? '#ffffff')], strokes: [solid(it.stroke ?? '#1e1e1e')], strokeWeight: it.strokeW ?? 2, strokeAlign: 'INSIDE' as const, rotation: rot };
      const label = it.text ? { node: textNode(it.text, 8, Math.max(0, (it.h - (it.fontSize ?? 16) * 1.3) / 2), it.w - 16, { size: it.fontSize ?? 16, color: tc(it), bold: it.bold, italic: it.italic, align: 'center' }) } : null;
      let node: SceneNode;
      if (kind === 'ellipse') node = defaultNode('ELLIPSE', { name: 'Ellipse', x, y, width: it.w, height: it.h, ...style });
      else if (poly && kind !== 'rect') node = vectorNode(kind[0].toUpperCase() + kind.slice(1), poly.map(([px, py]) => ({ x: x + px * it.w, y: y + py * it.h })), true, style, { x, y, w: it.w, h: it.h });
      else node = defaultNode('RECT', { name: 'Rectangle', x, y, width: it.w, height: it.h, cornerRadius: kind === 'round' || kind === 'cylinder' || kind === 'speech' ? Math.round(Math.min(it.w, it.h) * 0.22) : 0, ...style });
      pending.push({ node, kids: label ? [label] : [] });
    } else if (k === 'stroke') {
      const pts = strokePoints(it).map(shift), hl = it.pen === 'highlighter';
      const weight = hl ? (it.strokeW ?? 14) * 3 : it.pen === 'marker' ? (it.strokeW ?? 6) * 1.6 : it.strokeW ?? 3;
      const col = it.stroke ?? '#1e1e1e';
      if (pts.length < 2) { const p = pts[0] ?? { x, y }; pending.push({ node: defaultNode('ELLIPSE', { name: 'Dot', x: p.x - weight / 2, y: p.y - weight / 2, width: weight, height: weight, fills: [solid(col)] }), kids: [] }); }
      else pending.push({ node: vectorNode(hl ? 'Highlighter' : it.pen === 'marker' ? 'Marker' : 'Pen stroke', pts, false, { strokes: [solid(col)], strokeWeight: weight, strokeAlign: 'CENTER', opacity: hl ? 0.38 : 1, blendMode: hl ? 'MULTIPLY' : 'NORMAL' }), kids: [] });
    } else if (k === 'connector') {
      const pts = flattenRoute(routeConnector(board, it)).map(shift);
      if (pts.length < 2) continue;
      pending.push({ node: vectorNode('Connector', pts, false, { strokes: [solid(it.stroke ?? '#1e1e1e')], strokeWeight: it.strokeW ?? 2, strokeAlign: 'CENTER', strokeStart: CAP[it.capStart ?? 'none'] ?? 'NONE', strokeEnd: CAP[it.capEnd ?? 'arrow'] ?? 'NONE' }), kids: [] });
    } else if (k === 'code') {
      pending.push({ node: defaultNode('FRAME', { name: 'Code block', x, y, width: it.w, height: it.h, rotation: rot, fills: [solid('#1e1f24')], cornerRadius: 8, clipsContent: true }), kids: [{ node: textNode(it.text ?? '', 14, 12, it.w - 28, { size: 13, color: '#e6e6e6', family: MONO }) }] });
    } else if (k === 'table') {
      const sz = tableSize(it), cw = it.colW ?? [], rh = it.rowH ?? [], cells = it.cells ?? [];
      const kids: { node: SceneNode; kids?: SceneNode[] }[] = [];
      let cy = 0;
      rh.forEach((h, r) => { let cx = 0; cw.forEach((w, c) => {
        const cell = defaultNode('RECT', { name: `Cell ${r + 1},${c + 1}`, x: cx, y: cy, width: w, height: h, fills: [solid(r === 0 ? '#f0f0f0' : it.color ?? '#ffffff')], strokes: [solid('#333333')], strokeWeight: 1, strokeAlign: 'INSIDE' });
        const t = cells[r]?.[c] ?? '';
        kids.push({ node: cell, kids: t ? [textNode(t, 8, Math.max(2, (h - 18) / 2), w - 16, { size: 14, bold: r === 0 })] : [] });
        cx += w; }); cy += h; });
      pending.push({ node: defaultNode('FRAME', { name: 'Table', x, y, width: sz.w, height: sz.h, rotation: rot, fills: [], clipsContent: false, effects: [SHADOW] }), kids });
    } else if (k === 'link') {
      const url = it.url ?? it.text ?? '';
      let host = url; try { host = new URL(url).host; } catch { /* keep as typed */ }
      pending.push({ node: defaultNode('FRAME', { name: 'Link card', x, y, width: it.w, height: it.h, rotation: rot, fills: [solid('#ffffff')], strokes: [solid('#d0d0d0')], strokeWeight: 1, cornerRadius: 10, clipsContent: true }), kids: [{ node: textNode(it.text && it.text !== url ? it.text : host, 14, 12, it.w - 28, { size: 15, bold: true }) }, { node: textNode(url, 14, Math.min(it.h - 24, 40), it.w - 28, { size: 12, color: '#6b7280' }) }] });
    } else if (k === 'emoji') {
      pending.push({ node: { ...textNode(it.emoji ?? '👍', x, y, it.w, { size: Math.round(it.h * 0.78), align: 'center', color: '#1e1e1e' }), rotation: rot, name: `Stamp ${it.emoji ?? ''}`.trim() }, kids: [] });
    } else if (k === 'timer') {
      pending.push({ node: defaultNode('FRAME', { name: 'Timer', x, y, width: it.w, height: it.h, rotation: rot, fills: [solid('#222222')], cornerRadius: 12, clipsContent: false }), kids: [{ node: textNode(mmss(timerLeft(it, Date.now())), 0, Math.max(4, (it.h - 52) / 2), it.w, { size: 40, bold: true, color: '#ffffff', align: 'center', family: MONO }) }] });
    } else if (k === 'image' && it.src) {
      try { const blob = await (await fetch(it.src)).blob(); const bm = await createImageBitmap(blob); pictures.push({ item: it, blob, w: bm.width, h: bm.height, x, y, ew: it.w, eh: it.h }); bm.close(); }
      catch { const b = await exportPng(board, [it.id], false, 2, 2400); if (b) { const bm = await createImageBitmap(b); const ib = selectionBox(board, [it.id])!; pictures.push({ item: it, blob: b, w: bm.width, h: bm.height, x: ib.x - 40 + dx, y: ib.y - 40 + dy, ew: ib.w + 80, eh: ib.h + 80 }); bm.close(); } }
    }
  }
  // photos upload first (async); everything is then applied as one undo step
  const uploaded: { p: (typeof pictures)[number]; assetId: string; mime: string }[] = [];
  for (const p of pictures) { const up = await api.uploadAsset(session.file.id, p.blob); uploaded.push({ p, assetId: up.assetId, mime: up.mime }); }
  const textIds: string[] = []; let count = 0;
  const place = (n: SceneNode, parent: string) => { addNode(session.store, n, parent); if (n.type === 'TEXT') textIds.push(n.id); };
  session.store.transact('Add from whiteboard', () => {
    for (const p of pending) {
      place(p.node, session.pageId); count++;
      for (const kid of p.kids) { place(kid.node, p.node.id); for (const g of kid.kids ?? []) place(g, kid.node.id); }
    }
    for (const u of uploaded) {
      session.store.apply({ t: 'asset', id: u.assetId, asset: { name: 'image.png', mime: u.mime, width: u.p.w, height: u.p.h } });
      place(defaultNode('RECT', { name: 'Image', x: u.p.x, y: u.p.y, width: u.p.ew, height: u.p.eh, fills: [{ type: 'IMAGE', assetId: u.assetId, scaleMode: 'FILL', opacity: 1, visible: true }] }), session.pageId); count++;
    }
  });
  session.fitText(textIds);
  useEditor.getState().toast(`Added ${count} editable layer${count === 1 ? '' : 's'} to the design`);
  return count;
}
