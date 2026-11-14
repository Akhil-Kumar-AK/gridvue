import { fitText } from './render';
import { makeItem, selectionBox, type BoardData, type JamItem, type ShapeKind } from '@layr/core';

export interface JamTemplate { id: string; name: string; blurb: string; build: (ox: number, oy: number, author: string) => JamItem[] }

class Builder {
  items: JamItem[] = [];
  constructor(private ox: number, private oy: number, private author: string) {}
  section(x: number, y: number, w: number, h: number, text: string, color: string) { const s = makeItem('section', this.ox + x, this.oy + y, { w, h, text, color }); this.items.push(s); return s; }
  sticky(x: number, y: number, text: string, color: string, parent?: JamItem) { const s = makeItem('sticky', this.ox + x, this.oy + y, { text, color, author: this.author, w: 150, h: 150, fontSize: 16, parent: parent?.id }); this.items.push(s); return s; }
  shape(x: number, y: number, w: number, h: number, shape: ShapeKind, text: string, color = '#ffffff') { const s = makeItem('shape', this.ox + x, this.oy + y, { w, h, shape, text, color }); this.items.push(s); return s; }
  text(x: number, y: number, text: string, size = 28) { const t = makeItem('text', this.ox + x, this.oy + y, { text, fontSize: size, bold: true }); Object.assign(t, fitText(t)); this.items.push(t); return t; }
  link(a: JamItem, b: JamItem, as: 'r' | 'b' | 'l' | 't' = 'r', bs: 'r' | 'b' | 'l' | 't' = 'l', text = '') { const c = makeItem('connector', 0, 0, { from: { id: a.id, side: as }, to: { id: b.id, side: bs }, route: 'elbow', text }); this.items.push(c); return c; }
}

export const TEMPLATES: JamTemplate[] = [
  { id: 'brainstorm', name: 'Brainstorm', blurb: 'A topic and a section of sticky notes', build: (x, y, a) => { const b = new Builder(x, y, a); const s = b.section(0, 0, 720, 440, 'Ideas', '#ffe066'); b.text(0, -90, 'What should we build next?'); ['Idea one', 'Idea two', 'Idea three', 'Idea four', 'Idea five'].forEach((t, i) => b.sticky(30 + (i % 4) * 170, 30 + Math.floor(i / 4) * 170, t, ['#ffe066', '#ffb86b', '#8fe39a', '#8fb8ff', '#f4a6d7'][i], s)); return b.items; } },
  { id: 'retro', name: 'Retrospective', blurb: 'Went well, to improve, action items', build: (x, y, a) => { const b = new Builder(x, y, a); [['Went well', '#8fe39a'], ['To improve', '#ffb86b'], ['Action items', '#8fb8ff']].forEach(([n, c], i) => { const s = b.section(i * 400, 0, 370, 520, n, c); b.sticky(i * 400 + 30, 30, 'Add a note…', c, s); }); b.text(0, -90, 'Sprint retrospective'); return b.items; } },
  { id: 'kanban', name: 'Kanban board', blurb: 'To do, doing, done columns', build: (x, y, a) => { const b = new Builder(x, y, a); [['To do', '#d9dde3'], ['In progress', '#ffe066'], ['Done', '#8fe39a']].forEach(([n, c], i) => { const s = b.section(i * 330, 0, 300, 560, n, c); if (i === 0) { b.sticky(i * 330 + 75, 30, 'Task A', '#ffffff', s); b.sticky(i * 330 + 75, 200, 'Task B', '#ffffff', s); } if (i === 1) b.sticky(i * 330 + 75, 30, 'Task C', '#ffe066', s); }); return b.items; } },
  { id: 'flow', name: 'Flowchart', blurb: 'Start, decision and two outcomes', build: (x, y, a) => { const b = new Builder(x, y, a); const s = b.shape(0, 0, 160, 70, 'round', 'Start', '#8fe39a'), d = b.shape(0, 150, 160, 120, 'diamond', 'Ready?', '#ffe066'), yes = b.shape(260, 175, 160, 70, 'rect', 'Ship it', '#8fb8ff'), no = b.shape(-260, 175, 160, 70, 'rect', 'Keep working', '#ff8f8f'); b.link(s, d, 'b', 't'); b.link(d, yes, 'r', 'l', 'Yes'); b.link(d, no, 'l', 'r', 'No'); void a; return b.items; } },
  { id: 'mind', name: 'Mind map', blurb: 'A central idea with four branches', build: (x, y) => { const b = new Builder(x, y, ''); const c = b.shape(0, 0, 200, 90, 'ellipse', 'Main idea', '#c9a7ff'); [['Branch A', 360, -160], ['Branch B', 360, 160], ['Branch C', -360, -160], ['Branch D', -360, 160]].forEach(([t, dx, dy]) => { const n = b.shape(Number(dx), Number(dy), 160, 70, 'round', String(t), '#ffffff'); b.link(c, n, Number(dx) > 0 ? 'r' : 'l', Number(dx) > 0 ? 'l' : 'r'); }); return b.items; } },
  { id: 'swot', name: 'SWOT analysis', blurb: 'Strengths, weaknesses, opportunities, threats', build: (x, y, a) => { const b = new Builder(x, y, a); [['Strengths', '#8fe39a', 0, 0], ['Weaknesses', '#ff8f8f', 410, 0], ['Opportunities', '#8fb8ff', 0, 340], ['Threats', '#ffb86b', 410, 340]].forEach(([n, c, px, py]) => { const s = b.section(Number(px), Number(py), 380, 300, String(n), String(c)); b.sticky(Number(px) + 30, Number(py) + 30, 'Add a note…', String(c), s); }); return b.items; } },
];

/** Place items so their bounding box is centred on (cx, cy) once built around the origin. */
export function placeTemplate(t: JamTemplate, cx: number, cy: number, author: string, existing?: BoardData): JamItem[] {
  const items = t.build(0, 0, author);
  const tmp = { items: Object.fromEntries(items.map(i => [i.id, i])), order: items.map(i => i.id) } as unknown as BoardData;
  const box = selectionBox(tmp, items.map(i => i.id));
  const used = existing && existing.order.length ? selectionBox(existing, existing.order) : null;
  if (box) { let dx = cx - (box.x + box.w / 2), dy = cy - (box.y + box.h / 2);
    if (used && dx + box.x < used.x + used.w + 80 && dx + box.x + box.w > used.x - 80 && dy + box.y < used.y + used.h + 80 && dy + box.y + box.h > used.y - 80) { dx = used.x + used.w + 120 - box.x; dy = used.y - box.y; }
    for (const it of items) { if (it.kind === 'connector') continue; it.x += dx; it.y += dy; } }
  return items;
}
