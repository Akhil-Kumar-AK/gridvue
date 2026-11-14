import { DocStore } from './store';
import { addNode, setProps } from './commands';
import { defaultNode, solid, type SceneNode, type VectorPath } from './model';
import { apply, invert, rotate, worldMatrix, type Pt } from './geometry';
import { pathBounds, translatePath } from './path';

/** Re-fit a vector's box to its path (points stay put in world space even for rotated nodes). */
export function fitVector(store: DocStore, id: string) {
  const n = store.doc.nodes[id];
  if (n?.type !== 'VECTOR' || !n.path) return;
  const all = [n.path, ...(n.subpaths ?? [])];
  const bs = all.map(pathBounds);
  const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  const b = { x: x0, y: y0, w: Math.max(...bs.map(q => q.x + q.w)) - x0, h: Math.max(...bs.map(q => q.y + q.h)) - y0 };
  if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) return;
  const eps = 1e-6;
  if (Math.abs(b.x) < eps && Math.abs(b.y) < eps && Math.abs(b.w - n.width) < eps && Math.abs(b.h - n.height) < eps) return;
  const off = apply(rotate(n.rotation), { x: b.x, y: b.y });
  const props: Partial<SceneNode> = { path: translatePath(n.path, -b.x, -b.y), x: n.x + off.x, y: n.y + off.y, width: b.w, height: b.h };
  if (n.subpaths) props.subpaths = n.subpaths.map(sp => translatePath(sp, -b.x, -b.y));
  store.apply({ t: 'set', id, props });
}

/** Replace a vector's path (one history step per transaction) and re-fit its box. */
export function setVectorPath(store: DocStore, id: string, path: VectorPath, label = 'Edit path') {
  store.transact(label, () => { store.apply({ t: 'set', id, props: { path } }); fitVector(store, id); });
}

/** Create a vector from a path given in `parentId`'s local space. */
export function createVector(store: DocStore, parentId: string, path: VectorPath, patch: Partial<SceneNode> = {}): string {
  const node = defaultNode('VECTOR', { name: 'Vector', path, fills: path.closed ? [solid('#D9D9D9')] : [], strokes: [solid('#000000')], strokeWeight: 2, strokeAlign: 'CENTER', strokeCap: 'ROUND', strokeJoin: 'ROUND', ...patch });
  return store.transact('Add vector', () => {
    const b = pathBounds(path);
    node.x = b.x; node.y = b.y; node.width = b.w; node.height = b.h;
    node.path = translatePath(path, -b.x, -b.y);
    addNode(store, node, parentId);
    return node.id;
  });
}

/** Convert a world-space path into the local space of `parentId`. */
export function pathToParentSpace(store: DocStore, parentId: string, path: VectorPath): VectorPath {
  const inv = invert(parentId && store.doc.nodes[parentId].type !== 'PAGE' ? worldMatrix(store.doc, parentId) : [1, 0, 0, 1, 0, 0]);
  const lin = (x: number, y: number): Pt => ({ x: inv[0] * x + inv[2] * y, y: inv[1] * x + inv[3] * y });
  return { ...path, points: path.points.map(p => { const a = apply(inv, p), i = lin(p.ix, p.iy), o = lin(p.ox, p.oy); return { x: a.x, y: a.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y }; }) };
}

export function togglePathClosed(store: DocStore, id: string) {
  const n = store.doc.nodes[id];
  if (n?.type !== 'VECTOR' || !n.path) return;
  const wasClosed = n.path.closed;
  setVectorPath(store, id, { ...n.path, closed: !wasClosed }, wasClosed ? 'Open path' : 'Close path');
  if (!wasClosed && store.doc.nodes[id].fills.length === 0) setProps(store, [id], { fills: [solid('#D9D9D9')] }, 'Add fill');
}
