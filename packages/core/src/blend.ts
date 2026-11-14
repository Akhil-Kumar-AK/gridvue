import type { DocumentData, Paint, SceneNode } from './model';
import { newId } from './model';

const hex = (h: string): [number, number, number] => { const v = h.replace('#', '').padEnd(6, '0'); return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]; };
const toHex = (c: number[]) => '#' + c.map(x => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('').toUpperCase();
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpColor = (a: string, b: string, t: number) => { const x = hex(a), y = hex(b); return toHex([lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]); };

function blendPaints(a: Paint[], b: Paint[], t: number): Paint[] {
  if (a.length !== b.length) return b;
  return b.map((p, i) => {
    const q = a[i];
    if (p.type === 'SOLID' && q.type === 'SOLID') return { ...p, color: lerpColor(q.color, p.color, t), opacity: lerp(q.opacity, p.opacity, t) };
    if (p.type === 'LINEAR' && q.type === 'LINEAR' && p.stops.length === q.stops.length) return { ...p, angle: lerp(q.angle, p.angle, t), opacity: lerp(q.opacity, p.opacity, t), stops: p.stops.map((s, k) => ({ pos: lerp(q.stops[k].pos, s.pos, t), color: lerpColor(q.stops[k].color, s.color, t), opacity: lerp(q.stops[k].opacity, s.opacity, t) })) };
    return p;
  });
}

function blendProps(a: SceneNode, b: SceneNode, t: number): Partial<SceneNode> {
  const out: Partial<SceneNode> = {
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), width: lerp(a.width, b.width, t), height: lerp(a.height, b.height, t), rotation: lerp(a.rotation, b.rotation, t),
    opacity: lerp(a.opacity, b.opacity, t), cornerRadius: lerp(a.cornerRadius, b.cornerRadius, t), strokeWeight: lerp(a.strokeWeight, b.strokeWeight, t),
    fills: blendPaints(a.fills, b.fills, t), strokes: blendPaints(a.strokes, b.strokes, t),
  };
  if (a.text && b.text) out.text = { ...b.text, fontSize: lerp(a.text.fontSize, b.text.fontSize, t), letterSpacing: lerp(a.text.letterSpacing, b.text.letterSpacing, t), characters: t < 0.5 ? a.text.characters : b.text.characters };
  return out;
}

/**
 * Smart-animate: an intermediate document at progress t (0 = frame A, 1 = frame B).
 * Layers are matched by type + name (in order, per parent). Matched layers interpolate position, size, rotation, opacity,
 * radius, stroke weight, solid/gradient fills and text size; layers only in B fade in; layers only in A fade out.
 * Visibility, effects and layout settings come from B. Returns a clone — the inputs are never modified.
 */
export function blendFrames(docA: DocumentData, frameA: string, docB: DocumentData, frameB: string, t: number): { doc: DocumentData; frameId: string } {
  const doc = structuredClone(docB);
  const walk = (aId: string, bId: string) => {
    const a = docA.nodes[aId], b = doc.nodes[bId];
    Object.assign(b, blendProps(a, docB.nodes[bId], t));
    const usedA = new Set<string>();
    for (const cb of [...b.children]) {
      const cbN = docB.nodes[cb];
      const ca = a.children.find(x => !usedA.has(x) && docA.nodes[x].name === cbN.name && docA.nodes[x].type === cbN.type);
      if (ca) { usedA.add(ca); walk(ca, cb); }
      else doc.nodes[cb].opacity = cbN.opacity * t;
    }
    // layers that only exist in A: fade out in place
    a.children.forEach((ca, idx) => {
      if (usedA.has(ca)) return;
      const clone = (id: string, parent: string): string => {
        const src = docA.nodes[id], nid = newId();
        doc.nodes[nid] = { ...structuredClone(src), id: nid, parent, children: [] };
        doc.nodes[nid].children = src.children.map(c => clone(c, nid));
        return nid;
      };
      const nid = clone(ca, bId);
      doc.nodes[nid].opacity = docA.nodes[ca].opacity * (1 - t);
      b.children.splice(Math.min(idx, b.children.length), 0, nid);
    });
  };
  walk(frameA, frameB);
  return { doc, frameId: frameB };
}
