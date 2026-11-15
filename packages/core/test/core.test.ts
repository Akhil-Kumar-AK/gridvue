import { describe, expect, it } from 'vitest';
import {
  DocStore, addNode, align, createEmptyDocument, defaultNode, deleteNodes, distribute, duplicate, groupNodes, hitChain, invert, mul,
  pageIds, parseNativeFile, reorder, reparent, resizeNode, rotate, screenToWorld, setProps, translate, ungroupNodes, validateDocument, applyMask, booleanOperation, convertToVector, cutPath, flattenSelection,
  worldBounds, worldMatrix, worldToScreen, zoomAt, apply, fitCamera, migrate, DocumentError, solid, type NativeFile,
} from '../src';

const setup = () => {
  const store = new DocStore(createEmptyDocument());
  const page = pageIds(store.doc)[0];
  return { store, page };
};
const rect = (x: number, y: number, w = 10, h = 10) => defaultNode('RECT', { x, y, width: w, height: h });
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('geometry', () => {
  it('matrix inverse round-trips', () => {
    const m = mul(translate(30, -4), rotate(37));
    const p = apply(mul(m, invert(m)), { x: 12, y: 7 });
    close(p.x, 12); close(p.y, 7);
  });
  it('camera conversion is invertible and zoomAt keeps the anchor fixed', () => {
    const cam = { x: 100, y: -50, zoom: 2 };
    const w = screenToWorld(cam, { x: 40, y: 60 });
    const s = worldToScreen(cam, w);
    close(s.x, 40); close(s.y, 60);
    const z = zoomAt(cam, { x: 40, y: 60 }, 3.5);
    const w2 = screenToWorld(z, { x: 40, y: 60 });
    close(w2.x, w.x); close(w2.y, w.y);
  });
  it('fitCamera shows the whole rect', () => {
    const c = fitCamera({ x: 0, y: 0, w: 1000, h: 500 }, 500, 500, 0);
    close(c.zoom, 0.5);
  });
  it('nested transforms compose (rotated frame, child offset)', () => {
    const { store, page } = setup();
    const f = defaultNode('FRAME', { x: 100, y: 100, width: 200, height: 200, rotation: 90 });
    addNode(store, f, page);
    const r = rect(10, 0);
    addNode(store, r, f.id);
    const m = worldMatrix(store.doc, r.id);
    const p = apply(m, { x: 0, y: 0 });
    close(p.x, 100); close(p.y, 110); // child x offset of 10 runs down after a 90° turn
    const b = worldBounds(store.doc, r.id);
    close(b.w, 10); close(b.h, 10);
  });
  it('hit testing respects z-order, ellipse shape, clipping scope and locking', () => {
    const { store, page } = setup();
    const a = rect(0, 0, 100, 100), b = rect(50, 50, 100, 100);
    addNode(store, a, page); addNode(store, b, page);
    expect(hitChain(store.doc, page, { x: 75, y: 75 })).toEqual([b.id]);
    expect(hitChain(store.doc, page, { x: 10, y: 10 })).toEqual([a.id]);
    const e = defaultNode('ELLIPSE', { x: 300, y: 0, width: 100, height: 100 });
    addNode(store, e, page);
    expect(hitChain(store.doc, page, { x: 301, y: 1 })).toEqual([]);
    expect(hitChain(store.doc, page, { x: 350, y: 50 })).toEqual([e.id]);
    setProps(store, [b.id], { locked: true });
    expect(hitChain(store.doc, page, { x: 75, y: 75 })).toEqual([a.id]);
    const f = defaultNode('FRAME', { x: 500, y: 0, width: 100, height: 100 });
    addNode(store, f, page);
    const c = rect(80, 80, 100, 100); addNode(store, c, f.id);
    expect(hitChain(store.doc, page, { x: 650, y: 50 })).toEqual([]); // clipped part is not hittable
    expect(hitChain(store.doc, page, { x: 590, y: 90 })).toEqual([f.id, c.id]);
  });
});

describe('history', () => {
  it('undo/redo restores exact document state across op kinds', () => {
    const { store, page } = setup();
    const snap0 = structuredClone(store.doc);
    const r = rect(5, 5); addNode(store, r, page);
    const snap1 = structuredClone(store.doc);
    setProps(store, [r.id], { x: 99, name: 'Hello' });
    const snap2 = structuredClone(store.doc);
    const [d] = duplicate(store, [r.id]);
    expect(d).toBeTruthy();
    const snap3 = structuredClone(store.doc);
    deleteNodes(store, [r.id]);
    expect(store.doc.nodes[r.id]).toBeUndefined();
    store.undo(); expect(store.doc).toEqual(snap3);
    store.undo(); expect(store.doc).toEqual(snap2);
    store.undo(); expect(store.doc).toEqual(snap1);
    store.undo(); expect(store.doc).toEqual(snap0);
    expect(store.canUndo).toBe(false);
    store.redo(); expect(store.doc).toEqual(snap1);
    store.redo(); store.redo(); store.redo();
    expect(store.doc.nodes[r.id]).toBeUndefined();
    expect(store.canRedo).toBe(false);
  });
  it('a new edit clears the redo stack', () => {
    const { store, page } = setup();
    addNode(store, rect(0, 0), page);
    store.undo();
    expect(store.canRedo).toBe(true);
    addNode(store, rect(1, 1), page);
    expect(store.canRedo).toBe(false);
  });
  it('a drag (many sets in one transaction) is a single undo step and coalesces', () => {
    const { store, page } = setup();
    const r = rect(0, 0); addNode(store, r, page);
    store.begin('Move');
    for (let i = 1; i <= 50; i++) store.apply({ t: 'set', id: r.id, props: { x: i } });
    store.commit();
    expect(store.doc.nodes[r.id].x).toBe(50);
    store.undo();
    expect(store.doc.nodes[r.id].x).toBe(0);
    store.redo();
    expect(store.doc.nodes[r.id].x).toBe(50);
  });
  it('no-op sets do not create history entries', () => {
    const { store, page } = setup();
    const r = rect(5, 5); addNode(store, r, page);
    setProps(store, [r.id], { x: 5 });
    expect(store.undoLabel).toBe('Add rect');
  });
  it('rollback discards an in-flight transaction without history', () => {
    const { store, page } = setup();
    const r = rect(0, 0); addNode(store, r, page);
    store.begin('Move'); store.apply({ t: 'set', id: r.id, props: { x: 40 } }); store.rollback();
    expect(store.doc.nodes[r.id].x).toBe(0);
    expect(store.undoLabel).toBe('Add rect');
  });
  it('failed transactions roll back atomically', () => {
    const { store, page } = setup();
    const f = defaultNode('FRAME'); addNode(store, f, page);
    const before = structuredClone(store.doc);
    expect(() => store.transact('bad', () => {
      store.apply({ t: 'set', id: f.id, props: { x: 5 } });
      store.apply({ t: 'move', id: f.id, parent: f.id, index: 0 });
    })).toThrow();
    expect(store.doc).toEqual(before);
  });
});

describe('structure commands', () => {
  it('group keeps world bounds; ungroup restores; both undoable', () => {
    const { store, page } = setup();
    const a = rect(10, 10), b = rect(100, 60, 20, 20);
    addNode(store, a, page); addNode(store, b, page);
    const wa = worldBounds(store.doc, a.id), wb = worldBounds(store.doc, b.id);
    const g = groupNodes(store, [a.id, b.id])!;
    const G = store.doc.nodes[g];
    expect([G.x, G.y, G.width, G.height]).toEqual([10, 10, 110, 70]);
    expect(worldBounds(store.doc, a.id)).toEqual(wa);
    expect(worldBounds(store.doc, b.id)).toEqual(wb);
    // moving a child refits the group
    setProps(store, [b.id], { x: 200 });
    const gb = worldBounds(store.doc, g);
    close(gb.x + gb.w, 230); // child x is group-local: 10 + 200 + 20
    ungroupNodes(store, [g]);
    expect(store.doc.nodes[g]).toBeUndefined();
    expect(store.doc.nodes[a.id].parent).toBe(page);
    close(worldBounds(store.doc, a.id).x, 10);
    validateDocument(store.doc);
    store.undo(); expect(store.doc.nodes[g]).toBeDefined();
    validateDocument(store.doc);
  });
  it('reparent preserves world position through rotated parents', () => {
    const { store, page } = setup();
    const f = defaultNode('FRAME', { x: 200, y: 50, width: 300, height: 300, rotation: 30 });
    addNode(store, f, page);
    const r = rect(400, 400, 40, 20); addNode(store, r, page);
    const before = worldBounds(store.doc, r.id);
    reparent(store, [r.id], f.id);
    const after = worldBounds(store.doc, r.id);
    close(after.x, before.x, 1e-6); close(after.y, before.y, 1e-6);
    close(store.doc.nodes[r.id].rotation, 330, 1e-6);
    expect(() => reparent(store, [f.id], r.id)).not.toThrow(); // cycle is silently refused
    expect(store.doc.nodes[f.id].parent).toBe(page);
  });
  it('reorder front/back/forward/backward', () => {
    const { store, page } = setup();
    const [a, b, c] = [rect(0, 0), rect(1, 1), rect(2, 2)];
    [a, b, c].forEach(n => addNode(store, n, page));
    reorder(store, [a.id], 'front'); expect(store.doc.nodes[page].children).toEqual([b.id, c.id, a.id]);
    reorder(store, [a.id], 'back'); expect(store.doc.nodes[page].children).toEqual([a.id, b.id, c.id]);
    reorder(store, [a.id], 'forward'); expect(store.doc.nodes[page].children).toEqual([b.id, a.id, c.id]);
    reorder(store, [c.id], 'backward'); expect(store.doc.nodes[page].children).toEqual([b.id, c.id, a.id]);
  });
  it('duplicate deep-copies a subtree with fresh ids', () => {
    const { store, page } = setup();
    const f = defaultNode('FRAME'); addNode(store, f, page);
    const r = rect(1, 1); addNode(store, r, f.id);
    const [d] = duplicate(store, [f.id]);
    expect(d).not.toBe(f.id);
    const kid = store.doc.nodes[d].children[0];
    expect(kid).not.toBe(r.id);
    expect(store.doc.nodes[kid].parent).toBe(d);
    validateDocument(store.doc);
  });
  it('align and distribute', () => {
    const { store, page } = setup();
    const [a, b, c] = [rect(0, 0, 10, 10), rect(30, 5, 10, 10), rect(100, 9, 10, 10)];
    [a, b, c].forEach(n => addNode(store, n, page));
    distribute(store, [a.id, b.id, c.id], 'h');
    expect(store.doc.nodes[b.id].x).toBe(50);
    align(store, [a.id, b.id, c.id], 'top');
    expect([a, b, c].map(n => store.doc.nodes[n.id].y)).toEqual([0, 0, 0]);
    align(store, [a.id, b.id, c.id], 'right');
    expect([a, b, c].map(n => store.doc.nodes[n.id].x)).toEqual([100, 100, 100]);
  });
  it('resizing a group scales its children', () => {
    const { store, page } = setup();
    const a = rect(0, 0, 10, 10), b = rect(10, 10, 10, 10);
    addNode(store, a, page); addNode(store, b, page);
    const g = groupNodes(store, [a.id, b.id])!;
    store.transact('r', () => resizeNode(store, g, { width: 40, height: 40 }));
    expect(store.doc.nodes[b.id]).toMatchObject({ x: 20, y: 20, width: 20, height: 20 });
  });
});

describe('serialization and validation', () => {
  it('round-trips a native file', () => {
    const { store, page } = setup();
    const t = defaultNode('TEXT', { name: 'T' }); addNode(store, t, page);
    const f = defaultNode('RECT', { fills: [solid('#ff0000', 0.5)] }); addNode(store, f, page);
    const file: NativeFile = { format: 'layr-document', schemaVersion: 1, name: 'x', exportedAt: '', document: store.doc, assets: {} };
    const back = parseNativeFile(JSON.stringify(file));
    expect(back.document).toEqual(store.doc);
  });
  it('validates text-on-path data', () => {
    const { store, page } = setup();
    const t = defaultNode('TEXT', { name: 'T', width: 100, height: 40 });
    t.textPath = { closed: false, points: [{ x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 }, { x: 100, y: 40, ix: 0, iy: 0, ox: 0, oy: 0 }] };
    addNode(store, t, page);
    expect(() => validateDocument(store.doc)).not.toThrow();
    const bad = structuredClone(store.doc);
    bad.nodes[t.id].textPath!.points[1].x = NaN;
    expect(() => validateDocument(bad)).toThrow(/text path/);
    const bad2 = structuredClone(store.doc);
    bad2.nodes[t.id].textPath!.points = bad2.nodes[t.id].textPath!.points.slice(0, 1);
    expect(() => validateDocument(bad2)).toThrow(/text path/);
  });

  it('masks, boolean groups, vector conversion and cutting', () => {
    const { store, page } = setup();
    const a = rect(0, 0, 100, 60), b = defaultNode('ELLIPSE', { x: 40, y: 20, width: 80, height: 60 });
    addNode(store, a, page); addNode(store, b, page);
    // one layer toggles as a mask; undo restores it
    applyMask(store, [a.id]);
    expect(store.doc.nodes[a.id].isMask).toBe(true);
    applyMask(store, [a.id]);
    expect(store.doc.nodes[a.id].isMask).toBeFalsy();
    // two layers: grouped, the bottom one becomes the mask
    const mg = applyMask(store, [a.id, b.id])!;
    expect(store.doc.nodes[mg].type).toBe('GROUP');
    expect(store.doc.nodes[store.doc.nodes[mg].children[0]].isMask).toBe(true);
    store.undo();
    expect(store.doc.nodes[a.id].parent).toBe(page);
    // boolean group: needs two shapes, can change operation, validates
    expect(booleanOperation(store, [a.id], 'UNION')).toBeNull();
    const g = booleanOperation(store, [a.id, b.id], 'SUBTRACT')!;
    expect(store.doc.nodes[g].boolOp).toBe('SUBTRACT');
    booleanOperation(store, [g], 'INTERSECT');
    expect(store.doc.nodes[g].boolOp).toBe('INTERSECT');
    validateDocument(store.doc);
    const bad = structuredClone(store.doc); bad.nodes[a.id].boolOp = 'UNION';
    expect(() => validateDocument(bad)).toThrow(/boolean/);
    // flatten computes the outline: a rectangle minus an ellipse is one closed vector with real curves-as-points
    const flat = flattenSelection(store, [g])!;
    expect(store.doc.nodes[flat].type).toBe('VECTOR');
    expect(store.doc.nodes[g]).toBeUndefined();
    expect(store.doc.nodes[flat].path!.points.length).toBeGreaterThan(8);
    validateDocument(store.doc);
    store.undo();
    expect(store.doc.nodes[g].boolOp).toBe('INTERSECT');
    // convert a rectangle / ellipse to an editable path
    expect(convertToVector(store, a.id)).toBe(true);
    expect(store.doc.nodes[a.id].type).toBe('VECTOR');
    expect(store.doc.nodes[a.id].path!.points).toHaveLength(4);
    expect(convertToVector(store, b.id)).toBe(true);
    expect(store.doc.nodes[b.id].path!.points).toHaveLength(4);
    validateDocument(store.doc);
    // cut: a closed path opens; an open path splits in two layers
    const ids = cutPath(store, a.id, 0, 0.5);
    expect(ids).toHaveLength(1);
    expect(store.doc.nodes[a.id].path!.closed).toBe(false);
    const parts = cutPath(store, a.id, 1, 0.5);
    expect(parts).toHaveLength(2);
    validateDocument(store.doc);
  });

  it('rejects corrupt documents', () => {
    const { store, page } = setup();
    addNode(store, rect(0, 0), page);
    const bad = structuredClone(store.doc);
    bad.nodes[page].children.push('ghost');
    expect(() => validateDocument(bad)).toThrow(DocumentError);
    const bad2 = structuredClone(store.doc);
    const id = Object.keys(bad2.nodes).find(k => bad2.nodes[k].type === 'RECT')!;
    bad2.nodes[id].width = NaN as number;
    expect(() => validateDocument(bad2)).toThrow(/Non-finite/);
    const bad3 = structuredClone(store.doc);
    bad3.nodes[id].fills = [{ type: 'IMAGE', assetId: 'nope', scaleMode: 'FILL', opacity: 1, visible: true }];
    expect(() => validateDocument(bad3)).toThrow(/Missing asset/);
    expect(() => migrate({ schemaVersion: 99 })).toThrow(/newer/);
    expect(() => parseNativeFile('{"format":"figma"}')).toThrow(DocumentError);
  });
});

import { addAutoLayout, createComponent, createInstance, detachInstance, resetOverrides, setLayout, setSizing, DEFAULT_LAYOUT } from '../src';

describe('auto layout', () => {
  const frame = (store: DocStore, page: string, patch = {}) => { const f = defaultNode('FRAME', { x: 0, y: 0, width: 300, height: 200, layout: { ...DEFAULT_LAYOUT, mode: 'HORIZONTAL', gap: 10, padT: 5, padR: 5, padB: 5, padL: 5 }, ...patch }); addNode(store, f, page); return f; };
  const get = (s: DocStore, id: string) => s.doc.nodes[id];

  it('horizontal flow with gap and padding; hug sizes the frame', () => {
    const { store, page } = setup();
    const f = frame(store, page, { sizingH: 'HUG', sizingV: 'HUG' });
    const a = rect(0, 0, 40, 20), b = rect(0, 0, 60, 30);
    addNode(store, a, f.id); addNode(store, b, f.id);
    expect([get(store, a.id).x, get(store, a.id).y]).toEqual([5, 5]);
    expect([get(store, b.id).x, get(store, b.id).y]).toEqual([55, 5]);
    expect([get(store, f.id).width, get(store, f.id).height]).toEqual([5 + 40 + 10 + 60 + 5, 5 + 30 + 5]);
  });
  it('re-lays out when a child is resized, hidden, reordered or removed', () => {
    const { store, page } = setup();
    const f = frame(store, page, { sizingH: 'HUG', sizingV: 'HUG' });
    const a = rect(0, 0, 40, 20), b = rect(0, 0, 60, 30);
    addNode(store, a, f.id); addNode(store, b, f.id);
    setProps(store, [a.id], { width: 100 });
    expect(get(store, b.id).x).toBe(5 + 100 + 10);
    setProps(store, [a.id], { visible: false });
    expect(get(store, b.id).x).toBe(5);
    expect(get(store, f.id).width).toBe(70);
    setProps(store, [a.id], { visible: true });
    reorder(store, [a.id], 'front');
    expect(get(store, a.id).x).toBeGreaterThan(get(store, b.id).x);
    deleteNodes(store, [a.id]);
    expect(get(store, f.id).width).toBe(70);
    store.undo();
    expect(get(store, a.id)).toBeDefined();
    expect(get(store, f.id).width).toBe(5 + 100 + 10 + 60 + 5);
  });
  it('fill containers share free space; counter-axis alignment; space-between', () => {
    const { store, page } = setup();
    const f = frame(store, page, { width: 300, height: 100, layout: { ...DEFAULT_LAYOUT, mode: 'HORIZONTAL', gap: 10, padT: 0, padR: 10, padB: 0, padL: 10, counterAlign: 'CENTER' } });
    const a = rect(0, 0, 50, 20), b = rect(0, 0, 10, 40), c = rect(0, 0, 10, 40);
    [a, b, c].forEach(n => addNode(store, n, f.id));
    setSizing(store, [b.id, c.id], 'H', 'FILL');
    // free = 280 - 50 - 20 gaps = 210, split in two
    expect(get(store, b.id).width).toBe(105); expect(get(store, c.id).width).toBe(105);
    expect(get(store, a.id).y).toBe(40); // centered: (100-20)/2
    setSizing(store, [b.id, c.id], 'H', 'FIXED');
    setProps(store, [b.id, c.id], { width: 10 });
    setLayout(store, [f.id], { primaryAlign: 'SPACE_BETWEEN' });
    expect(get(store, a.id).x).toBe(10); expect(get(store, c.id).x).toBe(300 - 10 - 10);
  });
  it('nested hug/fill: inner frame fills outer, children relayout', () => {
    const { store, page } = setup();
    const outer = frame(store, page, { width: 400, height: 200, layout: { ...DEFAULT_LAYOUT, mode: 'VERTICAL', gap: 0, padT: 10, padR: 10, padB: 10, padL: 10 } });
    const inner = defaultNode('FRAME', { width: 50, height: 50, layout: { ...DEFAULT_LAYOUT, mode: 'HORIZONTAL', gap: 4, padT: 0, padR: 0, padB: 0, padL: 0 }, sizingH: 'FILL', sizingV: 'HUG' });
    addNode(store, inner, outer.id);
    const k1 = rect(0, 0, 10, 12), k2 = rect(0, 0, 10, 30);
    addNode(store, k1, inner.id); addNode(store, k2, inner.id);
    expect(get(store, inner.id).width).toBe(380); expect(get(store, inner.id).height).toBe(30);
    expect(get(store, k2.id).x).toBe(14);
    setProps(store, [k2.id], { height: 80 });
    expect(get(store, inner.id).height).toBe(80);
    setProps(store, [outer.id], { width: 200 });
    expect(get(store, inner.id).width).toBe(180);
  });
  it('absolute children keep their position and are excluded from flow', () => {
    const { store, page } = setup();
    const f = frame(store, page, { sizingH: 'HUG', sizingV: 'HUG' });
    const a = rect(0, 0, 40, 20), abs = rect(100, 100, 5, 5);
    addNode(store, a, f.id); addNode(store, abs, f.id);
    setProps(store, [abs.id], { absolute: true, x: 100, y: 100 });
    expect([get(store, abs.id).x, get(store, abs.id).y]).toEqual([100, 100]);
    expect(get(store, f.id).width).toBe(50);
  });
  it('add auto layout wraps a selection, infers direction, keeps order', () => {
    const { store, page } = setup();
    const a = rect(200, 0, 40, 40), b = rect(0, 5, 40, 40), c = rect(100, 0, 40, 40);
    [a, b, c].forEach(n => addNode(store, n, page));
    const fid = addAutoLayout(store, [a.id, b.id, c.id])!;
    expect(get(store, fid).layout!.mode).toBe('HORIZONTAL');
    expect(get(store, fid).children).toEqual([b.id, c.id, a.id]);
    expect(get(store, b.id).x).toBe(10);
    validateDocument(store.doc);
    store.undo(); expect(get(store, fid)).toBeUndefined(); validateDocument(store.doc);
  });
});

describe('components and instances', () => {
  const build = () => {
    const { store, page } = setup();
    const f = defaultNode('FRAME', { name: 'Button', x: 0, y: 0, width: 120, height: 40, fills: [solid('#0000ff')] });
    addNode(store, f, page);
    const label = defaultNode('TEXT', { name: 'Label', x: 10, y: 10 }); addNode(store, label, f.id);
    const comp = createComponent(store, [f.id])!;
    return { store, page, comp, label: label.id };
  };
  it('create component converts a frame in place', () => {
    const { store, comp } = build();
    expect(store.doc.nodes[comp].type).toBe('COMPONENT');
    validateDocument(store.doc);
  });
  it('instance mirrors children and follows main changes', () => {
    const { store, comp, label } = build();
    const inst = createInstance(store, comp)!;
    const I = store.doc.nodes[inst];
    expect(I.type).toBe('INSTANCE'); expect(I.children.length).toBe(1);
    const child = store.doc.nodes[I.children[0]];
    expect(child.sourceId).toBe(label);
    setProps(store, [comp], { fills: [solid('#ff0000')] });
    expect(store.doc.nodes[inst].fills).toEqual([solid('#ff0000')]);
    setProps(store, [label], { x: 33 });
    expect(store.doc.nodes[child.id].x).toBe(33);
    validateDocument(store.doc);
  });
  it('overrides survive main changes; reset restores; structure changes propagate', () => {
    const { store, page, comp, label } = build();
    const inst = createInstance(store, comp)!;
    const child = store.doc.nodes[inst].children[0];
    // override the text content and the root fill
    setProps(store, [child], { text: { ...store.doc.nodes[child].text!, characters: 'Override' } });
    setProps(store, [inst], { fills: [solid('#00ff00')] });
    expect(store.doc.nodes[child].overrides).toContain('text');
    setProps(store, [comp], { fills: [solid('#ff0000')], width: 200 });
    setProps(store, [label], { fills: [solid('#abcdef')] });
    expect(store.doc.nodes[inst].fills).toEqual([solid('#00ff00')]); // overridden
    expect(store.doc.nodes[inst].width).toBe(200); // not overridden → follows
    expect(store.doc.nodes[child].text!.characters).toBe('Override');
    expect(store.doc.nodes[child].fills).toEqual([solid('#abcdef')]); // non-overridden prop of an overridden node follows
    // add a layer to main → appears in instance
    addNode(store, rect(0, 0, 10, 10), comp);
    expect(store.doc.nodes[inst].children.length).toBe(2);
    validateDocument(store.doc);
    resetOverrides(store, [child]);
    expect(store.doc.nodes[child].text!.characters).toBe('Text');
    expect(store.doc.nodes[inst].fills).toEqual([solid('#ff0000')]);
    void page;
  });
  it('detach makes a plain frame; undo restores the link', () => {
    const { store, comp } = build();
    const inst = createInstance(store, comp)!;
    detachInstance(store, [inst]);
    expect(store.doc.nodes[inst].type).toBe('FRAME');
    setProps(store, [comp], { fills: [solid('#123456')] });
    expect(store.doc.nodes[inst].fills).not.toEqual([solid('#123456')]);
    store.undo(); store.undo();
    expect(store.doc.nodes[inst].type).toBe('INSTANCE');
    validateDocument(store.doc);
  });
  it('auto layout inside a component propagates to instances', () => {
    const { store, comp, label } = build();
    const inst = createInstance(store, comp)!;
    setProps(store, [comp], { layout: { ...DEFAULT_LAYOUT, mode: 'HORIZONTAL', padL: 20, padT: 4, padR: 4, padB: 4, gap: 0 } as never });
    expect(store.doc.nodes[inst].layout).toBeDefined();
    const kid = store.doc.nodes[inst].children[0];
    expect(store.doc.nodes[kid].x).toBe(20);
    expect(store.doc.nodes[label].x).toBe(20);
  });
});

import { addVariant, addVariantProperty, createComponentSet, setInstanceVariant, setVariantValue, addComponentProp, bindLayerProp, setPropValue, variantProperties } from '../src';

describe('variants and component properties', () => {
  const build = () => {
    const { store, page } = setup();
    const f = defaultNode('FRAME', { name: 'Button', width: 100, height: 40, fills: [solid('#0000ff')] }); addNode(store, f, page);
    const label = defaultNode('TEXT', { name: 'Label', x: 10, y: 10 }); addNode(store, label, f.id);
    const c1 = createComponent(store, [f.id])!;
    const set = createComponentSet(store, [c1])!;
    return { store, page, set, c1, label: label.id };
  };
  it('combines components into a set with variant values', () => {
    const { store, set, c1 } = build();
    expect(store.doc.nodes[set].type).toBe('COMPONENT_SET');
    expect(store.doc.nodes[c1].variant).toEqual({ 'Property 1': 'Variant 1' });
    const v2 = addVariant(store, set)!;
    expect(store.doc.nodes[v2].variant).toEqual({ 'Property 1': 'Variant 2' });
    expect(store.doc.nodes[v2].name).toBe('Property 1=Variant 2');
    expect(variantProperties(store.doc, set)[0].values).toEqual(['Variant 1', 'Variant 2']);
    addVariantProperty(store, set, 'Size', 'M');
    expect(store.doc.nodes[c1].variant).toEqual({ 'Property 1': 'Variant 1', Size: 'M' });
    expect(setVariantValue(store, v2, 'Size', 'M')).toBe(true);
    expect(setVariantValue(store, v2, 'Property 1', 'Variant 1')).toBe(false); // duplicate combination refused
    validateDocument(store.doc);
  });
  it('instances switch variants and keep same-named overrides', () => {
    const { store, set, c1 } = build();
    const v2 = addVariant(store, set)!;
    setProps(store, [v2], { fills: [solid('#ff0000')] });
    const inst = createInstance(store, c1)!;
    expect(store.doc.nodes[inst].parent).toBe(store.doc.nodes[set].parent); // placed outside the set
    const kid = store.doc.nodes[inst].children[0];
    setProps(store, [kid], { text: { ...store.doc.nodes[kid].text!, characters: 'Keep me' } });
    expect(setInstanceVariant(store, inst, { 'Property 1': 'Variant 2' })).toBe(true);
    expect(store.doc.nodes[inst].componentId).toBe(v2);
    expect(store.doc.nodes[inst].fills).toEqual([solid('#ff0000')]);
    const kid2 = store.doc.nodes[inst].children[0];
    expect(kid2).toBe(kid); // same layer survived thanks to name-path remap
    expect(store.doc.nodes[kid2].text!.characters).toBe('Keep me');
    expect(setInstanceVariant(store, inst, { 'Property 1': 'Nope' })).toBe(false);
    store.undo(); expect(store.doc.nodes[inst].componentId).toBe(c1);
    validateDocument(store.doc);
  });
  it('text and boolean properties drive bound layers; defaults apply; instance values override', () => {
    const { store, set, c1, label } = build();
    addComponentProp(store, set, { name: 'Label', type: 'TEXT', default: 'Click' });
    addComponentProp(store, set, { name: 'Show label', type: 'BOOLEAN', default: true });
    bindLayerProp(store, label, 'characters', 'Label');
    bindLayerProp(store, label, 'visible', 'Show label');
    const inst = createInstance(store, c1)!;
    const kid = store.doc.nodes[inst].children[0];
    expect(store.doc.nodes[kid].text!.characters).toBe('Click');
    setPropValue(store, inst, 'Label', 'Buy now');
    expect(store.doc.nodes[kid].text!.characters).toBe('Buy now');
    setPropValue(store, inst, 'Show label', false);
    expect(store.doc.nodes[kid].visible).toBe(false);
    expect(store.doc.nodes[kid].overrides ?? []).not.toContain('text'); // property values are not layer overrides
    // changing the default only affects instances without an explicit value
    const inst2 = createInstance(store, c1)!;
    expect(store.doc.nodes[store.doc.nodes[inst2].children[0]].text!.characters).toBe('Click');
    setProps(store, [set], { props: [{ name: 'Label', type: 'TEXT', default: 'Go' }, { name: 'Show label', type: 'BOOLEAN', default: true }] });
    expect(store.doc.nodes[store.doc.nodes[inst2].children[0]].text!.characters).toBe('Go');
    expect(store.doc.nodes[kid].text!.characters).toBe('Buy now');
    validateDocument(store.doc);
  });
  it('instance swap property replaces the nested instance and its children', () => {
    const { store, page, c1 } = build();
    const icon1 = defaultNode('FRAME', { name: 'Icon A', width: 10, height: 10 }); addNode(store, icon1, page);
    addNode(store, rect(0, 0, 4, 4), icon1.id);
    const iconA = createComponent(store, [icon1.id])!;
    const f2 = defaultNode('FRAME', { name: 'Icon B', x: 300, width: 20, height: 20, fills: [solid('#00ff00')] }); addNode(store, f2, page);
    const iconB = createComponent(store, [f2.id])!;
    const holder = defaultNode('FRAME', { name: 'Card', x: 0, y: 500, width: 80, height: 80 }); addNode(store, holder, page);
    const slot = createInstance(store, iconA, { parent: holder.id, x: 0, y: 0 })!;
    const card = createComponent(store, [holder.id])!;
    addComponentProp(store, card, { name: 'Icon', type: 'INSTANCE_SWAP', default: iconA });
    bindLayerProp(store, slot, 'componentId', 'Icon');
    const inst = createInstance(store, card)!;
    const nested = store.doc.nodes[inst].children[0];
    expect(store.doc.nodes[nested].componentId).toBe(iconA);
    expect(store.doc.nodes[nested].children.length).toBe(1);
    setPropValue(store, inst, 'Icon', iconB);
    const n2 = store.doc.nodes[store.doc.nodes[inst].children[0]];
    expect(n2.componentId).toBe(iconB);
    expect(n2.children.length).toBe(0);
    expect(n2.fills).toEqual([solid('#00ff00')]);
    validateDocument(store.doc);
    void c1;
  });
});

import {
  createCollection, createVariable, setVariableValue, bindVariable, unbindVariable, setNodeMode, addMode, removeMode, deleteVariable, deleteCollection, renameMode,
  createStyle, updateStyle, deleteStyle, detachStyle, attachStyle, exportTokens, parseTokens, importTokens, resolveVariable, modeFor, TokenError,
} from '../src';

describe('variables', () => {
  const themed = () => {
    const { store, page } = setup();
    const col = createCollection(store, 'Theme', ['Light', 'Dark']);
    const [light, dark] = store.doc.collections[col].modes.map(m => m.id);
    const bg = createVariable(store, col, 'bg', 'COLOR', '#ffffff')!;
    setVariableValue(store, bg, dark, '#111111');
    const f = defaultNode('FRAME', { x: 0, y: 0, width: 200, height: 100, fills: [solid('#ffffff')] }); addNode(store, f, page);
    const r = defaultNode('RECT', { width: 10, height: 10, fills: [solid('#ff0000')] }); addNode(store, r, f.id);
    return { store, page, col, light, dark, bg, f, r };
  };
  it('binding applies the value in the node\'s mode and re-resolves when a frame changes mode (undoable)', () => {
    const { store, col, light, dark, bg, f, r } = themed();
    expect(bindVariable(store, [r.id], 'fills.0.color', bg)).toBe(true);
    expect(store.doc.nodes[r.id].fills[0]).toMatchObject({ color: '#ffffff' });
    setNodeMode(store, [f.id], col, dark);
    expect(store.doc.nodes[r.id].fills[0]).toMatchObject({ color: '#111111' });
    expect(modeFor(store.doc, r.id, col)).toBe(dark);
    setVariableValue(store, bg, dark, '#222222'); // editing a value updates bound nodes
    expect(store.doc.nodes[r.id].fills[0]).toMatchObject({ color: '#222222' });
    setNodeMode(store, [f.id], col, light);
    expect(store.doc.nodes[r.id].fills[0]).toMatchObject({ color: '#ffffff' });
    store.undo(); expect(store.doc.nodes[r.id].fills[0]).toMatchObject({ color: '#222222' });
    validateDocument(store.doc);
  });
  it('moving a bound layer into a dark frame re-resolves it', () => {
    const { store, page, col, dark, bg, f, r } = themed();
    bindVariable(store, [r.id], 'fills.0.color', bg);
    const g = defaultNode('FRAME', { x: 400, width: 50, height: 50 }); addNode(store, g, page);
    setNodeMode(store, [g.id], col, dark);
    reparent(store, [r.id], g.id);
    expect(store.doc.nodes[r.id].fills[0]).toMatchObject({ color: '#111111' });
    reparent(store, [r.id], f.id);
    expect(store.doc.nodes[r.id].fills[0]).toMatchObject({ color: '#ffffff' });
  });
  it('numeric, boolean and text bindings (opacity %, gap, visibility, characters)', () => {
    const { store, page, col, light } = themed();
    const gap = createVariable(store, col, 'space/m', 'FLOAT', 16, ['SPACING'])!;
    const op = createVariable(store, col, 'dim', 'FLOAT', 40, ['OPACITY'])!;
    const show = createVariable(store, col, 'show', 'BOOLEAN', false)!;
    const txt = createVariable(store, col, 'title', 'STRING', 'Hi')!;
    const al = defaultNode('FRAME', { layout: { ...DEFAULT_LAYOUT, mode: 'HORIZONTAL', gap: 0 }, sizingH: 'HUG', sizingV: 'HUG' }); addNode(store, al, page);
    const a = rect(0, 0, 10, 10), b = rect(0, 0, 10, 10); addNode(store, a, al.id); addNode(store, b, al.id);
    expect(bindVariable(store, [al.id], 'layout.gap', gap)).toBe(true);
    expect(store.doc.nodes[b.id].x).toBe(10 + 16 + 10); // padding 10 + a(10) + gap 16 — layout reacted to the bound gap
    expect(bindVariable(store, [a.id], 'opacity', op)).toBe(true);
    expect(store.doc.nodes[a.id].opacity).toBeCloseTo(0.4);
    bindVariable(store, [b.id], 'visible', show);
    expect(store.doc.nodes[b.id].visible).toBe(false);
    const t = defaultNode('TEXT'); addNode(store, t, page); bindVariable(store, [t.id], 'text.characters', txt);
    expect(store.doc.nodes[t.id].text!.characters).toBe('Hi');
    setVariableValue(store, gap, light, 4);
    expect(store.doc.nodes[al.id].layout!.gap).toBe(4);
  });
  it('type and scope are enforced; invalid values refused', () => {
    const { store, col, r, light, bg } = themed();
    const n = createVariable(store, col, 'n', 'FLOAT', 1, ['SPACING'])!;
    expect(bindVariable(store, [r.id], 'fills.0.color', n)).toBe(false); // wrong type
    expect(bindVariable(store, [r.id], 'cornerRadius', n)).toBe(false); // wrong scope
    expect(setVariableValue(store, bg, light, 'red')).toBe(false);
    expect(setVariableValue(store, n, light, 'x' as never)).toBe(false);
    expect(createVariable(store, col, 'n', 'FLOAT')).toBeNull(); // duplicate name
  });
  it('aliases resolve across collections per mode, reject cycles and wrong types', () => {
    const { store, col, light, dark, bg } = themed();
    const brand = createCollection(store, 'Brand', ['Default']);
    const primary = createVariable(store, brand, 'primary', 'COLOR', '#0000ff')!;
    expect(setVariableValue(store, bg, dark, { alias: primary })).toBe(true);
    const bm = (cid: string) => (cid === col ? dark : store.doc.collections[cid].modes[0].id);
    expect(resolveVariable(store.doc, bg, bm)).toBe('#0000ff');
    expect(resolveVariable(store.doc, bg, () => light)).toBe('#ffffff');
    expect(setVariableValue(store, primary, store.doc.collections[brand].modes[0].id, { alias: bg })).toBe(false); // cycle
    const num = createVariable(store, brand, 'n', 'FLOAT', 1)!;
    expect(setVariableValue(store, bg, dark, { alias: num })).toBe(false); // type mismatch
    validateDocument(store.doc);
  });
  it('deleting variables/modes/collections cleans references and keeps values; remains valid', () => {
    const { store, col, light, dark, bg, f, r } = themed();
    bindVariable(store, [r.id], 'fills.0.color', bg);
    setNodeMode(store, [f.id], col, dark);
    const alias = createVariable(store, col, 'alias', 'COLOR')!;
    setVariableValue(store, alias, light, { alias: bg });
    deleteVariable(store, bg);
    expect(store.doc.nodes[r.id].varBindings).toBeUndefined();
    expect(store.doc.nodes[r.id].fills[0]).toMatchObject({ color: '#111111' }); // keeps the resolved value
    expect(store.doc.variables[alias].values[light]).toBe('#ffffff');
    validateDocument(store.doc);
    removeMode(store, col, dark);
    expect(store.doc.nodes[f.id].modeOverrides).toBeUndefined();
    expect(removeMode(store, col, light)).toBe(false); // last mode stays
    deleteCollection(store, col);
    expect(Object.keys(store.doc.variables).length).toBe(0);
    validateDocument(store.doc);
    store.undo(); expect(store.doc.collections[col]).toBeDefined(); validateDocument(store.doc);
  });
  it('a new mode starts as a copy of the default; mode names are unique', () => {
    const { store, col, light, bg } = themed();
    const m = addMode(store, col, 'High contrast')!;
    expect(store.doc.variables[bg].values[m]).toBe(store.doc.variables[bg].values[light]);
    expect(addMode(store, col, 'Light')).toBeNull();
    expect(renameMode(store, col, m, 'Light')).toBe(false);
  });
  it('variables inside instances resolve in the instance\'s mode, not the main component\'s', () => {
    const { store, page, col, dark, bg } = themed();
    const holder = defaultNode('FRAME', { name: 'Card', x: 600, y: 600, width: 80, height: 80, fills: [solid('#ffffff')] }); addNode(store, holder, page);
    bindVariable(store, [holder.id], 'fills.0.color', bg);
    const comp = createComponent(store, [holder.id])!;
    const darkFrame = defaultNode('FRAME', { x: 900, width: 200, height: 200 }); addNode(store, darkFrame, page);
    setNodeMode(store, [darkFrame.id], col, dark);
    const inst = createInstance(store, comp, { parent: darkFrame.id, x: 0, y: 0 })!;
    expect(store.doc.nodes[inst].fills[0]).toMatchObject({ color: '#111111' });
    expect(store.doc.nodes[comp].fills[0]).toMatchObject({ color: '#ffffff' });
    setVariableValue(store, bg, dark, '#333333');
    expect(store.doc.nodes[inst].fills[0]).toMatchObject({ color: '#333333' });
  });
  it('rejects documents with dangling references', () => {
    const { store, bg, r } = themed();
    bindVariable(store, [r.id], 'fills.0.color', bg);
    const bad = structuredClone(store.doc); delete bad.variables[bg];
    expect(() => validateDocument(bad)).toThrow(/missing variable/);
    const bad2 = structuredClone(store.doc); bad2.nodes[r.id].styleRefs = { fill: 'nope' };
    expect(() => validateDocument(bad2)).toThrow(/missing style/);
  });
  it('migrates v1 documents', () => {
    const d = createEmptyDocument() as any; d.schemaVersion = 1; delete d.styles; delete d.variables; delete d.collections;
    const m = migrate(d); expect(m.schemaVersion).toBe(2); expect(m.styles).toEqual({}); validateDocument(m);
  });
  it('tokens export/import round trip (including cross-collection aliases)', () => {
    const { store, col, dark, bg } = themed();
    const brand = createCollection(store, 'Brand', ['Default']);
    const primary = createVariable(store, brand, 'color/primary', 'COLOR', '#0000ff')!;
    setVariableValue(store, bg, dark, { alias: primary });
    const file = exportTokens(store.doc);
    const text = JSON.stringify(file);
    const fresh = new DocStore(createEmptyDocument());
    const res = importTokens(fresh, parseTokens(text));
    expect(res.skipped).toEqual([]); expect(res.collections).toBe(2); expect(res.variables).toBe(2);
    expect(exportTokens(fresh.doc)).toEqual(file);
    // idempotent merge
    importTokens(fresh, parseTokens(text)); expect(Object.keys(fresh.doc.variables).length).toBe(2);
    validateDocument(fresh.doc);
    expect(() => parseTokens('{"format":"x"}')).toThrow(TokenError);
    void col;
  });
});

describe('styles', () => {
  it('fill style: create, share, edit propagates, detach keeps values, delete detaches', () => {
    const { store, page } = setup();
    const a = defaultNode('RECT', { width: 10, height: 10, fills: [solid('#ff0000')] }), b = defaultNode('RECT', { width: 10, height: 10, fills: [solid('#00ff00')] });
    addNode(store, a, page); addNode(store, b, page);
    const s = createStyle(store, a.id, 'FILL', 'Brand/Red')!;
    expect(attachStyle(store, [b.id], 'FILL', s)).toBe(true);
    expect(store.doc.nodes[b.id].fills[0]).toMatchObject({ color: '#ff0000' });
    updateStyle(store, s, { fills: [solid('#0000ff')] });
    expect(store.doc.nodes[a.id].fills[0]).toMatchObject({ color: '#0000ff' });
    expect(store.doc.nodes[b.id].fills[0]).toMatchObject({ color: '#0000ff' });
    detachStyle(store, [b.id], 'FILL');
    updateStyle(store, s, { fills: [solid('#123456')] });
    expect(store.doc.nodes[b.id].fills[0]).toMatchObject({ color: '#0000ff' }); // detached: keeps last value
    expect(store.doc.nodes[a.id].fills[0]).toMatchObject({ color: '#123456' });
    deleteStyle(store, s);
    expect(store.doc.nodes[a.id].styleRefs).toBeUndefined();
    expect(store.doc.nodes[a.id].fills[0]).toMatchObject({ color: '#123456' });
    validateDocument(store.doc);
    store.undo(); expect(store.doc.styles[s]).toBeDefined(); expect(store.doc.nodes[a.id].styleRefs).toEqual({ fill: s });
  });
  it('text, effect and layout styles; type mismatch refused; duplicate names refused', () => {
    const { store, page } = setup();
    const t = defaultNode('TEXT'); addNode(store, t, page);
    const t2 = defaultNode('TEXT'); addNode(store, t2, page);
    const ts = createStyle(store, t.id, 'TEXT', 'Body')!;
    updateStyle(store, ts, { ...store.doc.styles[ts].value, fontSize: 24, fontWeight: 700 });
    attachStyle(store, [t2.id], 'TEXT', ts);
    expect(store.doc.nodes[t2.id].text).toMatchObject({ fontSize: 24, fontWeight: 700, characters: 'Text' }); // characters are never style-controlled
    expect(createStyle(store, t.id, 'TEXT', 'Body')).toBeNull();
    const r = defaultNode('RECT', { effects: [{ type: 'DROP_SHADOW', x: 0, y: 2, blur: 4, color: '#000000', opacity: 0.2, visible: true }] }); addNode(store, r, page);
    const es = createStyle(store, r.id, 'EFFECT', 'Shadow/S')!;
    const r2 = rect(0, 0, 5, 5); addNode(store, r2, page); attachStyle(store, [r2.id], 'EFFECT', es);
    expect(store.doc.nodes[r2.id].effects.length).toBe(1);
    expect(attachStyle(store, [r2.id], 'FILL', es)).toBe(false);
    const f = defaultNode('FRAME', { layout: { ...DEFAULT_LAYOUT, gap: 7 } }); addNode(store, f, page);
    const ls = createStyle(store, f.id, 'LAYOUT', 'Stack S')!;
    updateStyle(store, ls, { ...store.doc.styles[ls].value, gap: 20 });
    expect(store.doc.nodes[f.id].layout!.gap).toBe(20);
    validateDocument(store.doc);
  });
});

import { corner, createVector, deletePoints, fitVector, flatten, insertPoint, nearestOnPath, pathBounds, pathToParentSpace, setSmooth, setVectorPath, simplify, smoothPolyline, togglePathClosed, type VectorPath } from '../src';

describe('vector paths', () => {
  const tri: VectorPath = { points: [corner(10, 10), corner(110, 10), corner(60, 90)], closed: true };
  it('creates a vector with a tight box and local path; validates', () => {
    const { store, page } = setup();
    const id = createVector(store, page, tri);
    const n = store.doc.nodes[id];
    expect([n.x, n.y, n.width, n.height]).toEqual([10, 10, 100, 80]);
    expect(n.path!.points[0]).toMatchObject({ x: 0, y: 0 });
    validateDocument(store.doc);
    store.undo(); expect(store.doc.nodes[id]).toBeUndefined();
  });
  it('hit testing: stroke proximity for open paths, interior for closed filled ones', () => {
    const { store, page } = setup();
    const open = createVector(store, page, { points: [corner(0, 0), corner(100, 0)], closed: false });
    expect(hitChain(store.doc, page, { x: 50, y: 2 })).toEqual([open]);
    expect(hitChain(store.doc, page, { x: 50, y: 30 })).toEqual([]);
    const closed = createVector(store, page, { points: [corner(200, 0), corner(300, 0), corner(250, 80)], closed: true });
    expect(hitChain(store.doc, page, { x: 250, y: 30 })).toEqual([closed]); // inside the fill
    expect(hitChain(store.doc, page, { x: 205, y: 70 })).toEqual([]); // inside the box but outside the triangle
  });
  it('bezier bounds include curve extrema and flatten follows the curve', () => {
    const p: VectorPath = { points: [{ x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 100 }, { x: 100, y: 0, ix: 0, iy: 100, ox: 0, oy: 0 }], closed: false };
    const b = pathBounds(p);
    expect(b.h).toBeGreaterThan(70); expect(b.h).toBeLessThan(80); // cubic peak = 0.75 * 100
    expect(flatten(p, 8).length).toBe(9);
  });
  it('insert point splits without changing the shape; delete keeps >= 2 anchors; smooth/sharp toggles', () => {
    const curve: VectorPath = { points: [{ x: 0, y: 0, ix: 0, iy: 0, ox: 30, oy: 60 }, { x: 100, y: 0, ix: -30, iy: 60, ox: 0, oy: 0 }], closed: false };
    const hit = nearestOnPath(curve, { x: 50, y: 45 })!;
    const { path, index } = insertPoint(curve, hit.seg, hit.t);
    expect(path.points.length).toBe(3); expect(index).toBe(1);
    const before = flatten(curve, 40), after = flatten(path, 20);
    // every sample of the new path lies on the old one (within flatten tolerance)
    for (const q of after) expect(Math.min(...before.map(b => Math.hypot(b.x - q.x, b.y - q.y)))).toBeLessThan(1.5);
    expect(deletePoints(path, [0, 1, 2])).toBeNull();
    expect(deletePoints(path, [1])!.points.length).toBe(2);
    const sharp = setSmooth(path, 1, false); expect(sharp.points[1]).toMatchObject({ ix: 0, ox: 0 });
    const smooth = setSmooth(sharp, 1, true); expect(Math.hypot(smooth.points[1].ox, smooth.points[1].oy)).toBeGreaterThan(0);
  });
  it('editing a path re-fits the node, rotation-safe (world position of anchors unchanged)', () => {
    const { store, page } = setup();
    const id = createVector(store, page, { points: [corner(0, 0), corner(100, 0), corner(100, 50)], closed: false });
    setProps(store, [id], { rotation: 90 });
    const wm = () => worldMatrix(store.doc, id);
    const anchorWorld = (i: number) => apply(wm(), store.doc.nodes[id].path!.points[i]);
    const a0 = anchorWorld(0), a2 = anchorWorld(2);
    setVectorPath(store, id, { ...store.doc.nodes[id].path!, points: [...store.doc.nodes[id].path!.points, corner(-40, 70)] });
    const b0 = anchorWorld(0), b2 = anchorWorld(2);
    expect(b0.x).toBeCloseTo(a0.x, 6); expect(b0.y).toBeCloseTo(a0.y, 6); expect(b2.x).toBeCloseTo(a2.x, 6); expect(b2.y).toBeCloseTo(a2.y, 6);
    fitVector(store, id); validateDocument(store.doc);
  });
  it('resizing scales the path; closing an open path adds a fill; parent-space conversion honours rotated parents', () => {
    const { store, page } = setup();
    const id = createVector(store, page, { points: [corner(0, 0), corner(100, 0), corner(100, 100)], closed: false });
    store.transact('r', () => resizeNode(store, id, { width: 200, height: 50 }));
    expect(store.doc.nodes[id].path!.points[1]).toMatchObject({ x: 200, y: 0 });
    togglePathClosed(store, id);
    expect(store.doc.nodes[id].path!.closed).toBe(true); expect(store.doc.nodes[id].fills.length).toBe(1);
    const f = defaultNode('FRAME', { x: 100, y: 100, width: 300, height: 300, rotation: 90 }); addNode(store, f, page);
    const local = pathToParentSpace(store, f.id, { points: [corner(100, 100), corner(100, 200)], closed: false });
    const w = apply(worldMatrix(store.doc, f.id), local.points[1]);
    expect(w.x).toBeCloseTo(100, 6); expect(w.y).toBeCloseTo(200, 6);
  });
  it('pencil pipeline: simplify + smooth keeps endpoints and reduces points', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: i, y: Math.sin(i / 10) * 20 }));
    const s = simplify(pts, 1);
    expect(s.length).toBeLessThan(25); expect(s[0]).toEqual(pts[0]); expect(s.at(-1)).toEqual(pts.at(-1));
    const p = smoothPolyline(s); expect(p.points[0]).toMatchObject({ ix: 0, iy: 0 });
    expect(p.closed).toBe(false);
  });
  it('invalid vectors are rejected', () => {
    const { store, page } = setup();
    const id = createVector(store, page, tri);
    const bad = structuredClone(store.doc); bad.nodes[id].path!.points = [corner(0, 0)];
    expect(() => validateDocument(bad)).toThrow(/invalid path/);
  });
});

import { PrototypeRuntime, evaluate, ease, newAction, newInteraction, addInteraction, connectTo, setFlowStart, flows, reverseAnim, ExprError, topFrameOf, INSTANT, DEFAULT_ANIM, removeInteraction, updateInteraction } from '../src';

describe('prototype expressions and easing', () => {
  const vars: Record<string, string | number | boolean> = { n: 4, name: 'Ada', on: true };
  const ev = (s: string) => evaluate(s, k => vars[k]);
  it('arithmetic, precedence, strings, comparisons, logic', () => {
    expect(ev('1 + 2 * 3')).toBe(7); expect(ev('(1 + 2) * 3')).toBe(9); expect(ev('{n} * 2 - 1')).toBe(7); expect(ev('10 % 4')).toBe(2); expect(ev('-{n}')).toBe(-4);
    expect(ev('"Hi " + {name}')).toBe('Hi Ada'); expect(ev('{n} >= 4 && {on}')).toBe(true); expect(ev('{n} == 5 || !{on}')).toBe(false); expect(ev('{name} != "Bob"')).toBe(true);
  });
  it('rejects bad input safely (no code execution)', () => {
    expect(() => ev('1 +')).toThrow(ExprError); expect(() => ev('{missing}')).toThrow(/Unknown variable/); expect(() => ev('1 / 0')).toThrow(/zero/);
    expect(() => ev('alert(1)')).toThrow(ExprError); expect(() => ev('"a" * 2')).toThrow(/number/); expect(() => ev('(1')).toThrow(ExprError);
  });
  it('easing hits endpoints and is monotone for standard curves; back overshoots', () => {
    for (const e of ['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT', 'SPRING'] as const) { expect(ease(e, 0)).toBe(0); expect(ease(e, 1)).toBe(1); }
    expect(ease('EASE_IN', 0.5)).toBeLessThan(0.5); expect(ease('EASE_OUT', 0.5)).toBeGreaterThan(0.5);
    expect(ease('EASE_IN_BACK', 0.2)).toBeLessThan(0); expect(Math.max(...[...Array(21)].map((_, i) => ease('EASE_OUT_BACK', i / 20)))).toBeGreaterThan(1);
    expect(ease({ bezier: [0, 0, 1, 1] }, 0.37)).toBeCloseTo(0.37, 2);
  });
  it('reversing an animation flips direction and in/out', () => {
    expect(reverseAnim({ type: 'MOVE_IN', direction: 'LEFT', easing: 'LINEAR', duration: 1 })).toMatchObject({ type: 'MOVE_OUT', direction: 'RIGHT' });
    expect(reverseAnim({ type: 'DISSOLVE', easing: 'LINEAR', duration: 1 }).type).toBe('DISSOLVE');
  });
});

describe('prototype runtime', () => {
  const proto = () => {
    const { store, page } = setup();
    const mk = (name: string, x: number, fill = '#ffffff') => { const f = defaultNode('FRAME', { name, x, y: 0, width: 300, height: 400, fills: [solid(fill)] }); addNode(store, f, page); return f; };
    const home = mk('Home', 0), detail = mk('Detail', 400), modal = mk('Modal', 800);
    const btn = defaultNode('RECT', { name: 'Go', x: 20, y: 20, width: 100, height: 40 }); addNode(store, btn, home.id);
    return { store, page, home, detail, modal, btn };
  };
  const click = (rt: PrototypeRuntime, x: number, y: number) => { const h = rt.hitChainAt({ x, y }); return rt.fire({ type: 'CLICK' }, h.chain); };

  it('navigates on click at the right coordinates, history/back with reversed animation, flows', () => {
    const { store, home, detail, btn } = proto();
    setFlowStart(store, home.id, 'Main flow');
    expect(flows(store.doc)).toEqual([{ name: 'Main flow', frameId: home.id, pageId: store.doc.nodes[home.id].parent }]);
    addInteraction(store, btn.id, newInteraction({ type: 'CLICK' }, [{ type: 'NAVIGATE', to: detail.id, anim: { type: 'MOVE_IN', direction: 'LEFT', easing: 'EASE_OUT', duration: 300 } }]));
    store.apply({ t: 'set', id: detail.id, props: { fills: [solid('#00ff00')] } });
    const bk = defaultNode('RECT', { name: 'Back', x: 10, y: 10, width: 50, height: 30 }); addNode(store, bk, detail.id);
    addInteraction(store, bk.id, newInteraction({ type: 'CLICK' }, [newAction('BACK')]));
    const rt = new PrototypeRuntime(store.doc, home.id);
    expect(click(rt, 200, 200)).toEqual([]); // outside the button
    const t = click(rt, 50, 30);
    expect(t).toEqual([expect.objectContaining({ kind: 'navigate', from: home.id, to: detail.id })]);
    expect(rt.frame).toBe(detail.id); expect(rt.canGoBack).toBe(true);
    const back = click(rt, 20, 20);
    expect(back[0]).toMatchObject({ kind: 'navigate', to: home.id, anim: { type: 'MOVE_OUT', direction: 'RIGHT' } });
    expect(rt.frame).toBe(home.id); expect(rt.canGoBack).toBe(false);
    expect(store.doc.nodes[home.id].fills[0]).toMatchObject({ color: '#ffffff' }); // design doc untouched
  });
  it('an interaction can open a whiteboard on click or hover; an unset board is reported', () => {
    const { store, home, btn } = proto();
    addInteraction(store, btn.id, newInteraction({ type: 'CLICK' }, [{ type: 'WHITEBOARD', fileId: 'board_1', fileName: 'Roadmap' }]));
    const rt = new PrototypeRuntime(store.doc, home.id);
    expect(click(rt, 50, 30)).toEqual([{ kind: 'whiteboard', fileId: 'board_1', fileName: 'Roadmap' }]);
    expect(rt.frame).toBe(home.id); // opening a board does not leave the frame
    const h = defaultNode('RECT', { name: 'Hover', x: 150, y: 20, width: 100, height: 40 }); addNode(store, h, home.id);
    addInteraction(store, h.id, newInteraction({ type: 'HOVER' }, [{ type: 'WHITEBOARD', fileId: 'board_2', fileName: 'Ideas' }]));
    const rt2 = new PrototypeRuntime(store.doc, home.id);
    expect(rt2.fire({ type: 'HOVER' }, rt2.hitChainAt({ x: 200, y: 30 }).chain)).toEqual([{ kind: 'whiteboard', fileId: 'board_2', fileName: 'Ideas' }]);
    expect(newAction('WHITEBOARD')).toEqual({ type: 'WHITEBOARD', fileId: '', fileName: '' });
    expect(rt.run([newAction('WHITEBOARD')], btn.id)).toEqual([{ kind: 'error', message: 'Pick a whiteboard for this interaction' }]);
  });
  it('bubbles to ancestors; deepest interaction wins; hidden/clipped layers are not hit', () => {
    const { store, home, detail, modal, btn } = proto();
    addInteraction(store, home.id, newInteraction({ type: 'CLICK' }, [newAction('NAVIGATE', modal.id)]));
    addInteraction(store, btn.id, newInteraction({ type: 'CLICK' }, [newAction('NAVIGATE', detail.id)]));
    const rt = new PrototypeRuntime(store.doc, home.id);
    expect(click(rt, 50, 30)[0]).toMatchObject({ to: detail.id });
    rt.restart(); expect(click(rt, 250, 300)[0]).toMatchObject({ to: modal.id }); // frame itself
  });
  it('overlays: open positions, backdrop blocks clicks outside, close on outside, swap, close action', () => {
    const { store, home, modal, detail, btn } = proto();
    store.apply({ t: 'set', id: modal.id, props: { width: 200, height: 100 } });
    addInteraction(store, btn.id, newInteraction({ type: 'CLICK' }, [{ ...(newAction('OVERLAY_OPEN', modal.id) as any), position: 'BOTTOM_CENTER' }]));
    const x = defaultNode('RECT', { name: 'X', x: 0, y: 0, width: 40, height: 40 }); addNode(store, x, modal.id);
    addInteraction(store, x.id, newInteraction({ type: 'CLICK' }, [newAction('OVERLAY_CLOSE')]));
    addInteraction(store, detail.id, newInteraction({ type: 'KEY', key: 'Escape' }, []));
    const rt = new PrototypeRuntime(store.doc, home.id);
    expect(click(rt, 50, 30)[0]).toMatchObject({ kind: 'overlayOpen', frame: modal.id });
    expect(rt.overlayOrigin(0)).toEqual({ x: 50, y: 300 }); // bottom centre of a 300x400 frame
    expect(click(rt, 50, 30)).toEqual([]); // backdrop swallows clicks under the overlay
    expect(rt.hitChainAt({ x: 60, y: 310 }).chain).toContain(x.id); // overlay content is hit-tested with its own origin
    expect(click(rt, 60, 310)[0]).toMatchObject({ kind: 'overlayClose', frame: modal.id });
    expect(rt.overlays.length).toBe(0);
  });
  it('conditional logic and variables: set, increment, branch, bound text updates', () => {
    const { store, page, home, detail, btn } = proto();
    const col = createCollection(store, 'State', ['Default']);
    const count = createVariable(store, col, 'count', 'FLOAT', 0)!;
    const label = createVariable(store, col, 'label', 'STRING', 'zero')!;
    const t = defaultNode('TEXT', { name: 'T' }); addNode(store, t, home.id); bindVariable(store, [t.id], 'text.characters', label);
    addInteraction(store, btn.id, newInteraction({ type: 'CLICK' }, [
      { type: 'SET_VAR', variableId: count, expr: '{count} + 1' },
      { type: 'CONDITIONAL', branches: [{ cond: '{count} >= 3', actions: [newAction('NAVIGATE', detail.id)] }, { cond: '{count} == 2', actions: [{ type: 'SET_VAR', variableId: label, expr: '"two"' }] }], otherwise: [{ type: 'SET_VAR', variableId: label, expr: '"count is " + {count}' }] },
    ]));
    const rt = new PrototypeRuntime(store.doc, home.id);
    click(rt, 50, 30); expect(rt.store.doc.nodes[t.id].text!.characters).toBe('count is 1'); expect(rt.frame).toBe(home.id);
    click(rt, 50, 30); expect(rt.store.doc.nodes[t.id].text!.characters).toBe('two');
    const out = click(rt, 50, 30); expect(out[0]).toMatchObject({ kind: 'navigate' }); expect(rt.variableValue('count')).toBe(3);
    expect(store.doc.variables[count].values[store.doc.collections[col].modes[0].id]).toBe(0); // original document untouched
    // errors surface instead of throwing
    addInteraction(store, btn.id, newInteraction({ type: 'MOUSE_ENTER' }, [{ type: 'SET_VAR', variableId: count, expr: '{nope}' }]));
    const rt2 = new PrototypeRuntime(store.doc, home.id);
    expect(rt2.fire({ type: 'MOUSE_ENTER' }, [btn.id])[0]).toMatchObject({ kind: 'error' });
    void page;
  });
  it('change-to switches component variants (keeping overrides) and reports a snapshot for animation', () => {
    const { store, page } = proto();
    const f = defaultNode('FRAME', { name: 'Toggle', x: 0, y: 900, width: 60, height: 30, fills: [solid('#999999')] }); addNode(store, f, page);
    const c1 = createComponent(store, [f.id])!;
    const set = createComponentSet(store, [c1])!;
    const on = addVariant(store, set)!; setProps(store, [on], { fills: [solid('#00cc00')] });
    const screen = defaultNode('FRAME', { name: 'Screen', x: 1200, width: 200, height: 200 }); addNode(store, screen, page);
    const inst = createInstance(store, c1, { parent: screen.id, x: 10, y: 10 })!;
    addInteraction(store, inst, newInteraction({ type: 'CLICK' }, [newAction('CHANGE_TO', on)]));
    const rt = new PrototypeRuntime(store.doc, screen.id);
    const t = click(rt, 20, 20);
    expect(t[0]).toMatchObject({ kind: 'change', frame: screen.id });
    expect((t[0] as any).before.nodes[inst].fills[0].color).toBe('#999999');
    expect(rt.store.doc.nodes[inst].fills[0]).toMatchObject({ color: '#00cc00' });
    expect(store.doc.nodes[inst].fills[0]).toMatchObject({ color: '#999999' });
  });
  it('scroll-to, links (scheme allow-list), delayed and key triggers, missing destinations', () => {
    const { store, home, detail, btn } = proto();
    store.apply({ t: 'set', id: home.id, props: { overflowScroll: 'VERTICAL' } });
    const far = defaultNode('RECT', { name: 'Far', x: 10, y: 700, width: 50, height: 50 }); addNode(store, far, home.id);
    addInteraction(store, btn.id, newInteraction({ type: 'CLICK' }, [newAction('SCROLL_TO', far.id)]));
    addInteraction(store, home.id, newInteraction({ type: 'KEY', key: 'a' }, [newAction('LINK'), { type: 'LINK', url: 'javascript:alert(1)' }]));
    addInteraction(store, far.id, newInteraction({ type: 'DELAY', delay: 1500 }, [newAction('NAVIGATE', detail.id)]));
    const rt = new PrototypeRuntime(store.doc, home.id);
    expect(click(rt, 50, 30)[0]).toMatchObject({ kind: 'scroll', to: { x: 10, y: 700 } });
    expect(rt.hitChainAt({ x: 20, y: 20 }).chain).toContain(far.id); // scrolled content is hit-tested at its scrolled position
    const k = rt.fireKey('A'); expect(k[0]).toMatchObject({ kind: 'link' }); expect(k[1]).toMatchObject({ kind: 'error' });
    expect(rt.delayed()).toEqual([expect.objectContaining({ node: far.id, ms: 1500 })]);
    deleteNodes(store, [detail.id]);
    const rt2 = new PrototypeRuntime(store.doc, home.id);
    expect(rt2.run([newAction('NAVIGATE', detail.id)], btn.id)[0]).toMatchObject({ kind: 'error' });
  });
  it('connectTo, update/remove interactions (undoable), topFrameOf', () => {
    const { store, home, detail, btn } = proto();
    const id = connectTo(store, btn.id, detail.id);
    expect(store.doc.nodes[btn.id].interactions![0].actions[0]).toMatchObject({ type: 'NAVIGATE', to: detail.id, anim: DEFAULT_ANIM });
    updateInteraction(store, btn.id, id, { trigger: { type: 'HOVER' } });
    expect(store.doc.nodes[btn.id].interactions![0].trigger.type).toBe('HOVER');
    removeInteraction(store, btn.id, id); expect(store.doc.nodes[btn.id].interactions).toBeUndefined();
    store.undo(); expect(store.doc.nodes[btn.id].interactions!.length).toBe(1);
    expect(topFrameOf(store.doc, btn.id)).toBe(home.id);
    void INSTANT;
  });
});

import { blendFrames, lerpColor } from '../src';
describe('smart animate', () => {
  it('interpolates matched layers, fades unmatched ones, never mutates inputs', () => {
    const { store, page } = setup();
    const mk = (x: number) => { const f = defaultNode('FRAME', { name: 'F', x, width: 100, height: 100, fills: [solid('#000000')] }); addNode(store, f, page); return f; };
    const A = mk(0), B = mk(300);
    const ra = defaultNode('RECT', { name: 'Box', x: 0, y: 0, width: 10, height: 10, fills: [solid('#ff0000')] }); addNode(store, ra, A.id);
    const rb = defaultNode('RECT', { name: 'Box', x: 80, y: 40, width: 30, height: 10, fills: [solid('#0000ff')] }); addNode(store, rb, B.id);
    addNode(store, defaultNode('RECT', { name: 'OnlyA', width: 5, height: 5 }), A.id);
    addNode(store, defaultNode('RECT', { name: 'OnlyB', width: 5, height: 5 }), B.id);
    const before = JSON.stringify(store.doc);
    const { doc, frameId } = blendFrames(store.doc, A.id, store.doc, B.id, 0.5);
    expect(JSON.stringify(store.doc)).toBe(before);
    const kids = doc.nodes[frameId].children.map(c => doc.nodes[c]);
    const box = kids.find(k => k.name === 'Box')!;
    expect([box.x, box.y, box.width]).toEqual([40, 20, 20]);
    expect(box.fills[0]).toMatchObject({ color: lerpColor('#ff0000', '#0000ff', 0.5) });
    expect(kids.find(k => k.name === 'OnlyB')!.opacity).toBeCloseTo(0.5); expect(kids.find(k => k.name === 'OnlyA')!.opacity).toBeCloseTo(0.5);
    const end = blendFrames(store.doc, A.id, store.doc, B.id, 1);
    expect(end.doc.nodes[end.frameId].children.map(c => end.doc.nodes[c]).find(k => k.name === 'Box')!.x).toBe(80);
    expect(end.doc.nodes[end.frameId].children.map(c => end.doc.nodes[c]).find(k => k.name === 'OnlyA')!.opacity).toBe(0);
  });
});

import { fromDtcg, toDtcg, looksLikeDtcg } from '../src';
describe('W3C design tokens', () => {
  const dtcg = { color: { $type: 'color', brand: { primary: { $value: '#2196F3' }, bg: { $value: '#fff' }, link: { $value: '{color.brand.primary}' } } }, space: { $type: 'dimension', m: { $value: '16px' } }, label: { $type: 'string', $value: 'Hello' } };
  it('detects, imports (inheriting $type, aliases, units) and exports back', () => {
    expect(looksLikeDtcg(dtcg)).toBe(true); expect(looksLikeDtcg({ format: 'layr-tokens' })).toBe(false);
    const store = new DocStore(createEmptyDocument());
    const res = importTokens(store, fromDtcg(dtcg, 'Tokens'));
    expect(res.skipped).toEqual([]); expect(res.variables).toBe(5);
    const byName = (n: string) => Object.values(store.doc.variables).find(v => v.name === n)!;
    const mode = Object.values(store.doc.collections)[0].modes[0].id;
    expect(byName('color/brand/bg').values[mode]).toBe('#FFFFFF'); expect(byName('space/m').values[mode]).toBe(16);
    expect(byName('color/brand/link').values[mode]).toEqual({ alias: byName('color/brand/primary').id });
    const back = toDtcg(store.doc, Object.keys(store.doc.collections)[0]) as any;
    expect(back.color.brand.primary).toEqual({ $type: 'color', $value: '#2196F3' });
    expect(back.color.brand.link.$value).toBe('{color.brand.primary}');
    validateDocument(store.doc);
  });
  it('rejects unsupported or invalid tokens with a clear error', () => {
    expect(() => fromDtcg({ a: { $type: 'shadow', $value: {} } })).toThrow(/Unsupported/);
    expect(() => fromDtcg({ a: { $type: 'color', $value: 'red' } })).toThrow(/Invalid/);
    expect(() => fromDtcg({})).toThrow(/No tokens/);
  });
});

import { alignPatches, distributePatches, emptyBoard, hitItem, itemsInRect, makeItem, pick, routeConnector, sectionAt, validateBoard, BoardError, timerLeft, votesUsed, fitStroke, gridPatches } from '../src/jam';
describe('whiteboard model', () => {
  const board = () => { const b = emptyBoard(); const add = (i: ReturnType<typeof makeItem>) => { b.items[i.id] = i; b.order.push(i.id); return i; }; return { b, add }; };
  it('validates good boards and rejects broken ones', () => {
    const { b, add } = board(); add(makeItem('sticky', 0, 0)); add(makeItem('shape', 300, 0)); validateBoard(b);
    const bad = structuredClone(b); bad.order.pop(); expect(() => validateBoard(bad)).toThrow(BoardError);
    const nan = structuredClone(b); nan.items[nan.order[0]].x = NaN; expect(() => validateBoard(nan)).toThrow(BoardError);
    const link = structuredClone(b); const l = makeItem('link', 0, 0, { url: 'javascript:1' }); link.items[l.id] = l; link.order.push(l.id); expect(() => validateBoard(link)).toThrow(/http/);
    const tbl = structuredClone(b); const t = makeItem('table', 0, 0); t.colW = [1]; tbl.items[t.id] = t; tbl.order.push(t.id); expect(() => validateBoard(tbl)).toThrow(BoardError);
  });
  it('routes elbow connectors orthogonally between item sides', () => {
    const { b, add } = board(); const a = add(makeItem('shape', 0, 0)), c = add(makeItem('shape', 400, 200));
    const k = add(makeItem('connector', 0, 0, { from: { id: a.id, side: 'r' }, to: { id: c.id, side: 'l' }, route: 'elbow' }));
    const r = routeConnector(b, k); expect(r.pts[0]).toEqual({ x: 140, y: 50 }); expect(r.pts[r.pts.length - 1]).toEqual({ x: 400, y: 250 });
    for (let i = 1; i < r.pts.length; i++) expect(r.pts[i].x === r.pts[i - 1].x || r.pts[i].y === r.pts[i - 1].y).toBe(true);
    const auto = add(makeItem('connector', 0, 0, { from: { id: a.id, side: 'auto' }, to: { id: c.id, side: 'auto' }, route: 'straight' }));
    expect(routeConnector(b, auto).pts).toHaveLength(2);
  });
  it('hit-tests shapes by outline, sections by title and border, and respects rotation', () => {
    const { b, add } = board(); const d = add(makeItem('shape', 0, 0, { shape: 'diamond', w: 100, h: 100 }));
    expect(hitItem(b, d, { x: 50, y: 50 })).toBe(true); expect(hitItem(b, d, { x: 5, y: 5 }, 0)).toBe(false);
    const s = add(makeItem('section', 500, 500, { w: 300, h: 200 }));
    expect(hitItem(b, s, { x: 600, y: 600 })).toBe(false); expect(hitItem(b, s, { x: 520, y: 490 })).toBe(true); expect(sectionAt(b, { x: 600, y: 600 })).toBe(s.id);
    const r = add(makeItem('sticky', 1000, 0, { w: 100, h: 20, rot: 90 }));
    expect(hitItem(b, r, { x: 1050, y: 40 })).toBe(true); expect(hitItem(b, r, { x: 1090, y: 10 })).toBe(false);
    expect(pick(b, { x: 50, y: 50 })).toBe(d.id);
    expect(itemsInRect(b, { x: -10, y: -10, w: 130, h: 130 })).toEqual([d.id]);
  });
  it('aligns, distributes and grids items; strokes refit; timers and votes count', () => {
    const { b, add } = board(); const a = add(makeItem('sticky', 0, 0)), c = add(makeItem('sticky', 500, 30)), e = add(makeItem('sticky', 200, 90));
    expect(alignPatches(b, [a.id, c.id, e.id], 'top')[c.id]).toEqual({ x: 500, y: 0 });
    const dist = distributePatches(b, [a.id, c.id, e.id], 'h'); expect(dist[e.id]!.x).toBeCloseTo((668 - 3 * 168) / 2 + 168 + 0 + 0, 0);
    expect(Object.keys(gridPatches(b, [a.id, c.id, e.id], 2))).toHaveLength(3);
    const s = fitStroke(makeItem('stroke', 100, 100, { pts: [0, 0, 50, 20, -10, 40] })); expect(s.x).toBe(90); expect(s.h).toBe(40);
    expect(timerLeft(makeItem('timer', 0, 0, { duration: 1000, startedAt: 100 }), 600)).toBe(500);
    b.items[a.id].votes = { u1: 2 }; b.items[c.id].votes = { u1: 1 }; expect(votesUsed(b, 'u1')).toBe(3);
  });
});

import { validateDocument as validateDoc, createEmptyDocument as emptyDoc, defaultNode as dNode, addNode as addN, DocStore as DS, pageIds as pIds, solid as sol } from '../src';
describe('pattern and image paints', () => {
  const docWith = (fill: any) => { const s = new DS(emptyDoc()); const n = dNode('RECT', { fills: [sol('#f00')] }); addN(s, n, pIds(s.doc)[0]); s.doc.nodes[n.id].fills = [fill]; return s.doc; };
  const pattern = { type: 'PATTERN', sourceId: null, tile: 'RECT', scale: 1, spacingX: 0, spacingY: 0, align: 'tl', opacity: 1, visible: true };
  it('accepts valid patterns (even with a missing source) and rejects bad fields', () => {
    expect(() => validateDoc(docWith(pattern))).not.toThrow();
    expect(() => validateDoc(docWith({ ...pattern, sourceId: 'gone' }))).not.toThrow();
    for (const bad of [{ tile: 'HEX' }, { scale: 0 }, { scale: 99 }, { spacingX: -100 }, { spacingY: NaN }, { align: 'x' }]) expect(() => validateDoc(docWith({ ...pattern, ...bad }))).toThrow(DocumentError);
  });
  it('validates image mode, rotation and adjustments', () => {
    const doc = docWith({ type: 'IMAGE', assetId: 'a1', scaleMode: 'TILE', rotation: 90, adjust: { exposure: 20 }, opacity: 1, visible: true }); doc.assets.a1 = { name: 'x', mime: 'image/png' } as any;
    expect(() => validateDoc(doc)).not.toThrow();
    for (const bad of [{ scaleMode: 'CROP' }, { rotation: 45 }, { adjust: { exposure: 500 } }, { adjust: { sharpen: 1 } }]) { const d = docWith({ type: 'IMAGE', assetId: 'a1', scaleMode: 'FILL', opacity: 1, visible: true, ...bad }); d.assets.a1 = { name: 'x', mime: 'image/png' } as any; expect(() => validateDoc(d)).toThrow(DocumentError); }
  });
});

import { BLEND_MODES as BMODES, BLEND_GROUPS as BGROUPS, BLEND_LABEL as BLABEL } from '../src';
describe('blend modes', () => {
  it('lists 18 unique modes, each labelled, and validation accepts them and rejects unknown ones', () => {
    expect(BMODES).toHaveLength(18); expect(new Set(BMODES).size).toBe(18); expect(BGROUPS.flat()).toEqual(BMODES);
    for (const m of BMODES) expect(BLABEL[m]).toBeTruthy();
    const s = new DS(emptyDoc()); const n = dNode('RECT', { fills: [sol('#f00')] }); addN(s, n, pIds(s.doc)[0]);
    for (const m of BMODES) { s.doc.nodes[n.id].blendMode = m; expect(() => validateDoc(s.doc)).not.toThrow(); }
    (s.doc.nodes[n.id] as any).blendMode = 'BURN_IT_ALL'; expect(() => validateDoc(s.doc)).toThrow();
  });
});

describe('per-paint blend modes', () => {
  it('accepts a blend mode on fills and strokes and rejects unknown ones', () => {
    const s = new DS(emptyDoc()); const n = dNode('RECT', { fills: [sol('#f00')] }); addN(s, n, pIds(s.doc)[0]);
    s.doc.nodes[n.id].fills = [{ ...sol('#f00'), blendMode: 'MULTIPLY' }]; s.doc.nodes[n.id].strokes = [{ ...sol('#000'), blendMode: 'SCREEN' }];
    expect(() => validateDoc(s.doc)).not.toThrow();
    (s.doc.nodes[n.id].fills[0] as any).blendMode = 'NOPE'; expect(() => validateDoc(s.doc)).toThrow();
  });
});

describe('whiteboard embed layer', () => {
  const withEmbed = (patch: Record<string, unknown> = {}) => {
    const { store, page } = setup();
    const n = defaultNode('EMBED', { name: 'Board', embed: { fileId: 'file_abc', fileName: 'Board', kind: 'whiteboard' }, ...patch });
    addNode(store, n, page);
    return { store, n };
  };
  it('accepts an embed that points at a whiteboard file', () => {
    const { store } = withEmbed();
    expect(() => validateDocument(store.doc)).not.toThrow();
  });
  it('rejects an embed without a target, with children, or an embed field on another layer', () => {
    const a = withEmbed({ embed: undefined }); expect(() => validateDocument(a.store.doc)).toThrow(DocumentError);
    const b = withEmbed({ embed: { fileId: '', fileName: 'x', kind: 'whiteboard' } }); expect(() => validateDocument(b.store.doc)).toThrow(DocumentError);
    const c = withEmbed({ embed: { fileId: 'f', fileName: 'x', kind: 'slides' } }); expect(() => validateDocument(c.store.doc)).toThrow(DocumentError);
    const { store, page } = setup(); addNode(store, defaultNode('RECT', { embed: { fileId: 'f', fileName: 'x', kind: 'whiteboard' } }), page);
    expect(() => validateDocument(store.doc)).toThrow(DocumentError);
  });
  it('survives duplicate, undo and a JSON round trip', () => {
    const { store, n } = withEmbed();
    const [copy] = duplicate(store, [n.id]);
    expect(store.doc.nodes[copy].embed?.fileId).toBe('file_abc');
    expect(() => validateDocument(JSON.parse(JSON.stringify(store.doc)))).not.toThrow();
  });
});
