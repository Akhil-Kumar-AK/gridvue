import polygonClipping from 'polygon-clipping';
import { DocStore } from './store';
import { localMatrix, mul, apply, type Mat, type Pt } from './geometry';
import { addNode, deleteNodes, groupNodes, setProps, topLevelOnly, duplicate } from './commands';
import { defaultNode, solid, type BoolOp, type PathPoint, type SceneNode, type VectorPath } from './model';
import { flatten, insertPoint, pathBounds, translatePath } from './path';
import { setVectorPath } from './vectorCommands';

const KAPPA = 0.5522847498;
const pt = (x: number, y: number, ix = 0, iy = 0, ox = 0, oy = 0): PathPoint => ({ x, y, ix, iy, ox, oy });

/** Path (in the node's local space) equivalent to a rectangle or ellipse, so it can be edited point by point. */
export function shapeToPath(store: DocStore, id: string): VectorPath | null {
  const n = store.doc.nodes[id];
  if (!n) return null;
  const w = n.width, h = n.height;
  if (n.type === 'ELLIPSE') {
    const rx = w / 2, ry = h / 2, kx = rx * KAPPA, ky = ry * KAPPA;
    return { closed: true, points: [pt(rx, 0, -kx, 0, kx, 0), pt(w, ry, 0, -ky, 0, ky), pt(rx, h, kx, 0, -kx, 0), pt(0, ry, 0, ky, 0, -ky)] };
  }
  if (n.type !== 'RECT') return null;
  const r = Math.max(0, Math.min(n.cornerRadius, w / 2, h / 2)), k = r * KAPPA;
  if (r < 0.01) return { closed: true, points: [pt(0, 0), pt(w, 0), pt(w, h), pt(0, h)] };
  return { closed: true, points: [
    pt(r, 0), pt(w - r, 0, 0, 0, k, 0), pt(w, r, 0, -k, 0, 0), pt(w, h - r, 0, 0, 0, k), pt(w - r, h, k, 0, 0, 0),
    pt(r, h, 0, 0, -k, 0), pt(0, h - r, 0, k, 0, 0), pt(0, r, 0, 0, 0, -k),
  ].map((p, i) => (i === 1 ? { ...p, ix: 0 } : p)) };
}

/** Turn a rectangle or ellipse into an editable vector, keeping its look. Returns false if it is not convertible. */
export function convertToVector(store: DocStore, id: string): boolean {
  const n = store.doc.nodes[id];
  if (!n || n.type === 'VECTOR') return n?.type === 'VECTOR';
  const path = shapeToPath(store, id);
  if (!path) return false;
  store.transact('Convert to vector', () => store.apply({ t: 'set', id, props: { type: 'VECTOR', path, cornerRadius: 0, cornerRadii: undefined } }));
  return true;
}

/** One layer: toggle it as a mask for the layers above it. Several layers: group them with the bottom-most one as the mask. */
export function applyMask(store: DocStore, ids: string[]): string | null {
  const tops = topLevelOnly(store, ids);
  if (!tops.length) return null;
  if (tops.length === 1) {
    const n = store.doc.nodes[tops[0]];
    setProps(store, [n.id], { isMask: n.isMask ? undefined : true }, n.isMask ? 'Remove mask' : 'Use as mask');
    return n.id;
  }
  let group: string | null = null;
  store.transact('Mask group', () => {
    group = groupNodes(store, tops);
    if (!group) return;
    const bottom = store.doc.nodes[group].children[0];
    store.apply({ t: 'set', id: group, props: { name: 'Mask group' } });
    store.apply({ t: 'set', id: bottom, props: { isMask: true } });
  });
  return group;
}

const OP_NAME: Record<BoolOp, string> = { UNION: 'Union', SUBTRACT: 'Subtract', INTERSECT: 'Intersect', EXCLUDE: 'Exclude' };
const OP_OK = new Set(['RECT', 'ELLIPSE', 'VECTOR', 'LINE', 'GROUP', 'FRAME']);

/** Combine layers with a boolean operation (non-destructive: the group renders the combined shape). */
export function booleanOperation(store: DocStore, ids: string[], op: BoolOp): string | null {
  const tops = topLevelOnly(store, ids);
  if (tops.length === 1 && store.doc.nodes[tops[0]].boolOp) { setProps(store, tops, { boolOp: op, name: OP_NAME[op] }, OP_NAME[op]); return tops[0]; }
  if (tops.length < 2 || tops.some(t => !OP_OK.has(store.doc.nodes[t].type))) return null;
  let group: string | null = null;
  store.transact(OP_NAME[op], () => {
    group = groupNodes(store, tops);
    if (group) store.apply({ t: 'set', id: group, props: { boolOp: op, name: OP_NAME[op], fills: [solid('#D9D9D9')] } });
  });
  return group;
}

/** Cut a vector at a point on its outline: closed paths open there, open paths split in two (the second half becomes a new layer). */
export function cutPath(store: DocStore, id: string, seg: number, t: number): string[] {
  const n = store.doc.nodes[id];
  if (n?.type !== 'VECTOR' || !n.path) return [id];
  const { path: p, index } = insertPoint(n.path, seg, t);
  const pts = p.points.map(q => ({ ...q }));
  const out: string[] = [id];
  store.transact('Cut path', () => {
    if (p.closed) {
      const rot = [...pts.slice(index), ...pts.slice(0, index + 1)];
      rot[0] = { ...rot[0], ix: 0, iy: 0 }; rot[rot.length - 1] = { ...rot[rot.length - 1], ox: 0, oy: 0 };
      setVectorPath(store, id, { points: rot, closed: false }, 'Cut path');
    } else {
      const a = pts.slice(0, index + 1), b = pts.slice(index);
      a[a.length - 1] = { ...a[a.length - 1], ox: 0, oy: 0 }; b[0] = { ...b[0], ix: 0, iy: 0 };
      if (a.length < 2 || b.length < 2) return;
      const copies = duplicate(store, [id]);
      setVectorPath(store, id, { points: a, closed: false }, 'Cut path');
      if (copies[0]) { setVectorPath(store, copies[0], { points: b, closed: false }, 'Cut path'); out.push(copies[0]); }
    }
  });
  return out;
}

type Ring = [number, number][];
type Poly = Ring[];

const pathOf = (store: DocStore, n: SceneNode): VectorPath | null => (n.type === 'VECTOR' && n.path ? n.path : n.type === 'RECT' || n.type === 'ELLIPSE' ? shapeToPath(store, n.id) : n.type === 'FRAME' ? { closed: true, points: [pt(0, 0), pt(n.width, 0), pt(n.width, n.height), pt(0, n.height)] } : null);
/** Anchors and handles carried through a matrix (handles are offsets, so only the linear part applies). */
function mapPath(p: VectorPath, m: Mat): VectorPath {
  const v = (x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y });
  return { closed: p.closed, points: p.points.map(q => { const a = apply(m, q), i = v(q.ix, q.iy), o = v(q.ox, q.oy); return { x: a.x, y: a.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y }; }) };
}
/** Filled area of a layer (or boolean group) as polygons in the parent's space. */
function polygonsOf(store: DocStore, n: SceneNode, parentM: Mat): Poly[] {
  const m = mul(parentM, localMatrix(n));
  if (n.type === 'GROUP' || (n.type === 'FRAME' && n.children.length)) {
    const kids = n.children.map(id => store.doc.nodes[id]).filter(c => c.visible && !c.isMask).map(c => polygonsOf(store, c, m)).filter(g => g.length);
    if (!kids.length) return [];
    const op = n.boolOp ?? 'UNION';
    const [first, ...rest] = kids;
    return (op === 'SUBTRACT' ? polygonClipping.difference(first, ...rest) : op === 'INTERSECT' ? polygonClipping.intersection(first, ...rest) : op === 'EXCLUDE' ? polygonClipping.xor(first, ...rest) : polygonClipping.union(first, ...kids.slice(1))) as Poly[];
  }
  const p = pathOf(store, n);
  if (!p || p.points.length < 3) return [];
  return [[flatten({ ...p, closed: true }, 24).map(q => { const a = apply(m, q); return [a.x, a.y] as [number, number]; })]];
}
/** Curved contours of every plain shape under a layer, in the parent's space (used when merging without computing). */
function contoursOf(store: DocStore, n: SceneNode, parentM: Mat, out: { path: VectorPath; from: SceneNode }[]) {
  const m = mul(parentM, localMatrix(n));
  if (n.boolOp) { for (const poly of polygonsOf(store, n, parentM)) for (const ring of poly) out.push({ path: { closed: true, points: ring.slice(0, -1).map(([x, y]) => pt(x, y)) }, from: n }); return; }
  if (n.type === 'GROUP') { for (const id of n.children) if (store.doc.nodes[id].visible) contoursOf(store, store.doc.nodes[id], m, out); return; }
  const p = pathOf(store, n);
  if (p) out.push({ path: mapPath(p, m), from: n });
}
const firstLeaf = (store: DocStore, n: SceneNode): SceneNode => (n.children.length ? firstLeaf(store, store.doc.nodes[n.children[0]]) : n);

/** Flatten layers into one vector: boolean groups become their computed outline; other shapes merge into a compound path. */
export function flattenSelection(store: DocStore, ids: string[]): string | null {
  const tops = topLevelOnly(store, ids);
  if (!tops.length) return null;
  const parentId = store.doc.nodes[tops[0]].parent!;
  const first = store.doc.nodes[tops[0]];
  if (tops.length === 1 && (first.type === 'RECT' || first.type === 'ELLIPSE')) return convertToVector(store, first.id) ? first.id : null;
  if (tops.length === 1 && first.type === 'VECTOR') return first.id;
  const contours: { path: VectorPath; from: SceneNode }[] = [];
  const I: Mat = [1, 0, 0, 1, 0, 0];
  for (const t of tops) contoursOf(store, store.doc.nodes[t], I, contours);
  const usable = contours.filter(c => c.path.points.length >= 2);
  if (!usable.length) return null;
  const style = firstLeaf(store, first);
  const all = usable.map(c => c.path);
  const bs = all.map(pathBounds);
  const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  const w = Math.max(...bs.map(b => b.x + b.w)) - x0, h = Math.max(...bs.map(b => b.y + b.h)) - y0;
  const moved = all.map(p => translatePath(p, -x0, -y0));
  let result: string | null = null;
  store.transact('Flatten', () => {
    const topIndex = Math.max(...tops.map(t => store.doc.nodes[parentId].children.indexOf(t)));
    const node = defaultNode('VECTOR', {
      name: first.type === 'GROUP' ? first.name : 'Vector', x: x0, y: y0, width: Math.max(1, w), height: Math.max(1, h), path: moved[0], subpaths: moved.length > 1 ? moved.slice(1) : undefined,
      fills: style.fills.length ? structuredClone(style.fills) : [solid('#D9D9D9')], strokes: structuredClone(style.strokes), strokeWeight: style.strokeWeight, strokeAlign: style.strokeAlign,
      strokeCap: style.strokeCap, strokeJoin: style.strokeJoin, effects: structuredClone(style.effects),
    });
    deleteNodes(store, tops);
    result = addNode(store, node, parentId, Math.max(0, topIndex - tops.length + 1));
  });
  return result;
}
