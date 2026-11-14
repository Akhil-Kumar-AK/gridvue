import type { DocumentData, SceneNode } from './model';

export type SetFn = (id: string, props: Partial<SceneNode>) => void;
/** Optional text measurer: returns the size a TEXT node should take at its current width. */
export type TextFit = (n: SceneNode) => { width?: number; height: number } | null;

export const isLayoutNode = (n: SceneNode | undefined): n is SceneNode & { layout: NonNullable<SceneNode['layout']> } =>
  !!n && !!n.layout && (n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'COMPONENT_SET' || n.type === 'INSTANCE');

const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * Lay out one auto-layout subtree.
 * Rules:
 *  1. Children flow in child order, skipping hidden and `absolute` children (absolute ones keep their x/y).
 *  2. A frame with sizingH/V = HUG sizes itself to padding + content along that axis.
 *  3. FILL children share the free primary-axis space equally; FILL on the counter axis stretches to the inner size.
 *  4. HUG children that are themselves auto-layout frames are laid out first (bottom-up) so their size is known,
 *     then FILL children that are auto-layout frames are laid out again once their size is resolved.
 */
export function layoutTree(doc: DocumentData, id: string, set: SetFn, fit?: TextFit): void {
  const n = doc.nodes[id];
  if (!isLayoutNode(n)) return;
  const L = n.layout, horiz = L.mode === 'HORIZONTAL';
  const kidsAll = n.children.map(c => doc.nodes[c]);
  const flow = () => kidsAll.filter(k => k.visible && !k.absolute);
  const sz = (k: SceneNode, axis: 'main' | 'cross') => (axis === 'main' === horiz ? k.width : k.height);
  const sizing = (k: SceneNode, axis: 'main' | 'cross') => (axis === 'main' === horiz ? k.sizingH : k.sizingV) ?? 'FIXED';

  for (const k of kidsAll) if (isLayoutNode(k) && (k.sizingH === 'HUG' || k.sizingV === 'HUG')) layoutTree(doc, k.id, set, fit);

  const kids = flow();
  const padMain = horiz ? L.padL + L.padR : L.padT + L.padB;
  const padCross = horiz ? L.padT + L.padB : L.padL + L.padR;
  const gapTotal = Math.max(0, kids.length - 1) * L.gap;
  const mainHug = (horiz ? n.sizingH : n.sizingV) === 'HUG';
  const crossHug = (horiz ? n.sizingV : n.sizingH) === 'HUG';

  let mainSize = horiz ? n.width : n.height, crossSize = horiz ? n.height : n.width;
  if (mainHug) mainSize = padMain + gapTotal + kids.reduce((s, k) => s + sz(k, 'main'), 0);
  if (crossHug) crossSize = padCross + kids.reduce((m, k) => Math.max(m, sz(k, 'cross')), 0);
  const w = horiz ? mainSize : crossSize, h = horiz ? crossSize : mainSize;
  if (!eq(w, n.width) || !eq(h, n.height)) set(id, { width: Math.max(w, 0), height: Math.max(h, 0) });

  const innerMain = mainSize - padMain, innerCross = crossSize - padCross;
  const fills = kids.filter(k => sizing(k, 'main') === 'FILL' && !mainHug);
  const fixedMain = kids.reduce((s, k) => s + (fills.includes(k) ? 0 : sz(k, 'main')), 0);
  const fillEach = fills.length ? Math.max(0, (innerMain - fixedMain - gapTotal) / fills.length) : 0;
  const mains = kids.map(k => (fills.includes(k) ? fillEach : sz(k, 'main')));
  const crosses = kids.map(k => (sizing(k, 'cross') === 'FILL' && !crossHug ? Math.max(0, innerCross) : sz(k, 'cross')));

  const used = mains.reduce((s, m) => s + m, 0) + gapTotal;
  let gap = L.gap, cursor = horiz ? L.padL : L.padT;
  const free = innerMain - used;
  if (L.primaryAlign === 'CENTER') cursor += free / 2;
  else if (L.primaryAlign === 'MAX') cursor += free;
  else if (L.primaryAlign === 'SPACE_BETWEEN' && kids.length > 1) gap = L.gap + free / (kids.length - 1);

  kids.forEach((k, i) => {
    const crossStart = horiz ? L.padT : L.padL;
    const cOff = L.counterAlign === 'CENTER' ? (innerCross - crosses[i]) / 2 : L.counterAlign === 'MAX' ? innerCross - crosses[i] : 0;
    const pos = { main: cursor, cross: crossStart + cOff };
    const props: Partial<SceneNode> = {
      x: horiz ? pos.main : pos.cross, y: horiz ? pos.cross : pos.main,
      width: horiz ? mains[i] : crosses[i], height: k.type === 'LINE' ? 0 : horiz ? crosses[i] : mains[i],
    };
    const changed = Object.entries(props).some(([key, v]) => !eq((k as unknown as Record<string, number>)[key], v as number));
    if (changed) set(k.id, props);
    if (k.type === 'TEXT' && fit) { const s = fit(doc.nodes[k.id]); if (s && (!eq(s.height, doc.nodes[k.id].height) || (s.width !== undefined && !eq(s.width, doc.nodes[k.id].width)))) set(k.id, { ...(s.width !== undefined ? { width: s.width } : {}), height: s.height }); }
    cursor += mains[i] + gap;
  });

  for (const k of kidsAll) if (isLayoutNode(k) && (k.sizingH === 'FILL' || k.sizingV === 'FILL' )) layoutTree(doc, k.id, set, fit);
  // layout containers that are neither hugging nor filling still need their own children placed
  for (const k of kidsAll) if (isLayoutNode(k) && k.sizingH !== 'HUG' && k.sizingV !== 'HUG' && k.sizingH !== 'FILL' && k.sizingV !== 'FILL') layoutTree(doc, k.id, set, fit);
}

/** Topmost auto-layout ancestor-or-self whose layout is affected by a change at `startId`. */
export function layoutRootFor(doc: DocumentData, startId: string): string | null {
  let top: string | null = null;
  let x: SceneNode | undefined = doc.nodes[startId];
  while (x) {
    if (isLayoutNode(x)) top = x.id;
    const p: SceneNode | undefined = x.parent ? doc.nodes[x.parent] : undefined;
    if (!p || !isLayoutNode(p)) break;
    x = p;
  }
  return top;
}

/** Guess a layout from child positions (used by "Add auto layout"). */
export function inferLayout(doc: DocumentData, frameId: string): { mode: 'HORIZONTAL' | 'VERTICAL'; order: string[] } {
  const kids = doc.nodes[frameId].children.map(c => doc.nodes[c]);
  if (kids.length < 2) return { mode: 'VERTICAL', order: kids.map(k => k.id) };
  const xs = kids.map(k => k.x), ys = kids.map(k => k.y);
  const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
  const mode = spread(xs) > spread(ys) ? 'HORIZONTAL' : 'VERTICAL';
  const order = [...kids].sort((a, b) => (mode === 'HORIZONTAL' ? a.x - b.x : a.y - b.y)).map(k => k.id);
  return { mode, order };
}
