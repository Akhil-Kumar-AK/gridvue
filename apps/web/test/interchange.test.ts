import { describe, expect, it } from 'vitest';
import { DocStore, addNode, createEmptyDocument, defaultNode, pageIds, solid, validateDocument } from '@layr/core';
import { exportFig, importFig } from '../src/interchange/fig';
import { exportXd, importXd, parseSvgPath } from '../src/interchange/xd';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));

function sample() {
  const store = new DocStore(createEmptyDocument());
  const page = pageIds(store.doc)[0];
  store.apply({ t: 'asset', id: 'asset_img', asset: { name: 'photo.png', mime: 'image/png' } });
  const frame = defaultNode('FRAME', { name: 'Card', x: 40, y: 30, width: 300, height: 200, cornerRadius: 12, fills: [solid('#FFFFFF')], effects: [{ type: 'DROP_SHADOW', x: 0, y: 4, blur: 10, color: '#000000', opacity: 0.2, visible: true }] });
  addNode(store, frame, page);
  addNode(store, defaultNode('RECT', { name: 'Bar', x: 10, y: 10, width: 120, height: 24, cornerRadii: [2, 8, 2, 8], fills: [{ type: 'LINEAR', angle: 45, opacity: 1, visible: true, stops: [{ pos: 0, color: '#FF0000', opacity: 1 }, { pos: 1, color: '#0000FF', opacity: 1 }] }], strokes: [solid('#112233')], strokeWeight: 2, strokeAlign: 'CENTER', dashes: [4, 2] }), frame.id);
  addNode(store, defaultNode('ELLIPSE', { name: 'Dot', x: 150, y: 20, width: 40, height: 40, rotation: 30, opacity: 0.5, fills: [solid('#00AA55')] }), frame.id);
  const t = defaultNode('TEXT', { name: 'Title', x: 10, y: 60, width: 200, height: 30, fills: [solid('#222222')] });
  t.text = { ...t.text!, characters: 'Hello', fontSize: 20, fontWeight: 600, italic: true, lineHeight: 28, letterSpacing: 1, align: 'CENTER', resize: 'FIXED', decoration: 'UNDERLINE', textCase: 'UPPER' };
  addNode(store, t, frame.id);
  addNode(store, defaultNode('VECTOR', { name: 'Ring', x: 20, y: 110, width: 60, height: 60, fills: [solid('#FF8800')], path: { closed: true, points: [{ x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 }, { x: 60, y: 0, ix: 0, iy: 0, ox: 0, oy: 30 }, { x: 60, y: 60, ix: 0, iy: -30, ox: 0, oy: 0 }, { x: 0, y: 60, ix: 0, iy: 0, ox: 0, oy: 0 }] }, subpaths: [{ closed: true, points: [{ x: 20, y: 20, ix: 0, iy: 0, ox: 0, oy: 0 }, { x: 40, y: 20, ix: 0, iy: 0, ox: 0, oy: 0 }, { x: 40, y: 40, ix: 0, iy: 0, ox: 0, oy: 0 }] }] }), frame.id);
  addNode(store, defaultNode('RECT', { name: 'Photo', x: 200, y: 100, width: 80, height: 60, fills: [{ type: 'IMAGE', assetId: 'asset_img', scaleMode: 'FIT', opacity: 1, visible: true }] }), frame.id);
  return store.doc;
}

describe('.fig export and import', () => {
  it('round-trips layers, styles, text, vectors and images', async () => {
    const doc = sample();
    const bytes = await exportFig(doc, 'Sample', async () => ({ bytes: PNG, mime: 'image/png' }));
    expect(bytes[0]).toBe(0x50); // zip
    const back = importFig(bytes, 'Sample.fig');
    validateDocument(back.doc);
    const nodes = Object.values(back.doc.nodes);
    const by = (n: string) => nodes.find(x => x.name === n)!;
    const card = by('Card');
    expect(card).toMatchObject({ type: 'FRAME', x: 40, y: 30, width: 300, height: 200, cornerRadius: 12, clipsContent: true });
    expect(card.effects[0]).toMatchObject({ type: 'DROP_SHADOW', y: 4, blur: 10 });
    expect(card.children).toHaveLength(5);
    const bar = by('Bar');
    expect(bar.cornerRadii).toEqual([2, 8, 2, 8]);
    expect(bar.fills[0]).toMatchObject({ type: 'LINEAR' });
    expect((bar.fills[0] as { angle: number }).angle).toBeCloseTo(45, 3);
    expect(bar.strokes[0]).toMatchObject({ color: '#112233' }); expect(bar.strokeWeight).toBe(2); expect(bar.dashes).toEqual([4, 2]);
    expect(by('Dot')).toMatchObject({ type: 'ELLIPSE', opacity: 0.5 }); expect(by('Dot').rotation).toBeCloseTo(30, 2);
    expect(by('Title').text).toMatchObject({ characters: 'Hello', fontSize: 20, fontWeight: 600, italic: true, lineHeight: 28, letterSpacing: 1, align: 'CENTER', decoration: 'UNDERLINE', textCase: 'UPPER' });
    const ring = by('Ring');
    expect(ring.type).toBe('VECTOR'); expect(ring.path!.points).toHaveLength(4); expect(ring.subpaths).toHaveLength(1); expect(ring.path!.points[1].oy).toBe(30);
    const photo = by('Photo');
    expect(photo.fills[0]).toMatchObject({ type: 'IMAGE', scaleMode: 'FIT' });
    const id = (photo.fills[0] as { assetId: string }).assetId;
    expect(back.doc.assets[id].mime).toBe('image/png'); expect(back.assets[id].mime).toBe('image/png');
  });
  it('keeps several pages', async () => {
    const store = new DocStore(createEmptyDocument());
    const p1 = pageIds(store.doc)[0];
    addNode(store, defaultNode('RECT', { name: 'A', width: 10, height: 10 }), p1);
    const p2 = addNode(store, defaultNode('PAGE', { name: 'Second' }), store.doc.rootId);
    addNode(store, defaultNode('RECT', { name: 'B', width: 20, height: 20 }), p2);
    const back = importFig(await exportFig(store.doc, 'x', async () => { throw new Error('none'); }), 'x.fig');
    const pages = pageIds(back.doc);
    expect(pages).toHaveLength(2);
    expect(back.doc.nodes[pages[1]].name).toBe('Second');
    expect(back.doc.nodes[back.doc.nodes[pages[1]].children[0]].name).toBe('B');
  });
  it('rejects things that are not .fig files', () => {
    expect(() => importFig(new Uint8Array([1, 2, 3, 4]), 'x.fig')).toThrow();
  });
});

describe('.xd export and import', () => {
  it('round-trips artboards, shapes, text, vectors and images', async () => {
    const doc = sample();
    const page = pageIds(doc)[0];
    const bytes = await exportXd(doc, page, 'Sample', async () => ({ bytes: PNG, mime: 'image/png' }));
    const back = importXd(bytes, 'Sample.xd');
    validateDocument(back.doc);
    const nodes = Object.values(back.doc.nodes), by = (n: string) => nodes.find(x => x.name === n)!;
    const card = by('Card');
    expect(card).toMatchObject({ type: 'FRAME', x: 40, y: 30, width: 300, height: 200 });
    const bar = by('Bar');
    expect(bar).toMatchObject({ type: 'RECT', x: 10, y: 10, width: 120, height: 24 }); expect(bar.cornerRadii).toEqual([2, 8, 2, 8]);
    expect(bar.fills[0]).toMatchObject({ type: 'LINEAR' }); expect((bar.fills[0] as { angle: number }).angle).toBeCloseTo(45, 3);
    expect(bar.strokes[0]).toMatchObject({ color: '#112233' }); expect(bar.strokeWeight).toBe(2); expect(bar.dashes).toEqual([4, 2]);
    expect(by('Dot')).toMatchObject({ type: 'ELLIPSE', opacity: 0.5, width: 40, height: 40 });
    expect(by('Title').text).toMatchObject({ characters: 'Hello', fontSize: 20, fontWeight: 600, italic: true, align: 'CENTER', decoration: 'UNDERLINE' });
    const ring = by('Ring');
    expect(ring.type).toBe('VECTOR'); expect(ring.subpaths).toHaveLength(1); expect(ring.path!.points.length).toBe(4);
    const photo = by('Photo');
    expect(photo.fills[0]).toMatchObject({ type: 'IMAGE', scaleMode: 'FIT' });
    expect(Object.keys(back.assets)).toHaveLength(1);
  });
  it('parses SVG path data (relative, smooth, quadratic, close)', () => {
    const [p] = parseSvgPath('M10 10 l10 0 v10 h-10 z');
    expect(p.closed).toBe(true); expect(p.points).toHaveLength(4); expect(p.points[2]).toMatchObject({ x: 20, y: 20 });
    const [c] = parseSvgPath('M0 0 C0 10 10 10 10 0 S20 -10 20 0 Q25 5 30 0');
    expect(c.points).toHaveLength(4); expect(c.points[0]).toMatchObject({ ox: 0, oy: 10 });
  });
  it('rejects non-XD zips', () => {
    expect(() => importXd(Uint8Array.from([0x50, 0x4b, 5, 6, ...new Array(18).fill(0)]), 'x.xd')).toThrow();
  });
});
