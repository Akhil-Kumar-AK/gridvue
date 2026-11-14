import { describe, expect, it } from 'vitest';
import { validateDocument, createEmptyDocument, DocStore, pageIds } from '@layr/core';
import { decodeFigmaBuffer, figmaBufferFromHtml, looksLikeFigma } from '../src/figma/decode';
import { convertFigma, parseCommands } from '../src/figma/convert';
import { clipboardHtml } from './figmaFixture';

describe('figma clipboard', () => {
  const html = clipboardHtml();
  it('recognises and decodes the buffer', () => {
    expect(looksLikeFigma(html)).toBe(true);
    expect(looksLikeFigma('<b>hello</b>')).toBe(false);
    const msg = decodeFigmaBuffer(figmaBufferFromHtml(html)!);
    expect(msg.nodeChanges).toHaveLength(7);
    expect(msg.nodeChanges[2].name).toBe('Card');
  });
  it('turns Figma layers into Layr layers with the same look and hierarchy', () => {
    const { trees, count, notes } = convertFigma(decodeFigmaBuffer(figmaBufferFromHtml(html)!));
    expect(trees).toHaveLength(2); // the frame and the loose ellipse
    expect(count).toBe(5);
    const [card, ...kids] = trees[0];
    expect(card).toMatchObject({ type: 'FRAME', name: 'Card', x: 100, y: 50, width: 200, height: 120, cornerRadius: 8, clipsContent: true });
    expect(card.fills[0]).toMatchObject({ type: 'SOLID', color: '#FFFFFF' });
    expect(card.effects[0]).toMatchObject({ type: 'DROP_SHADOW', y: 4, blur: 12, opacity: 0.25 });
    expect(card.children).toHaveLength(3);
    const bar = kids.find(n => n.name === 'Bar')!;
    expect(bar).toMatchObject({ type: 'RECT', x: 20, y: 20, cornerRadius: 4 });
    expect(bar.fills[0]).toMatchObject({ type: 'LINEAR', angle: 0 });
    const title = kids.find(n => n.name === 'Title')!;
    expect(title.text).toMatchObject({ characters: 'Hello Figma', fontSize: 18, fontWeight: 600, lineHeight: 27, letterSpacing: 2 });
    const tri = kids.find(n => n.name === 'Tri')!;
    expect(tri.type).toBe('VECTOR'); expect(tri.path!.closed).toBe(true); expect(tri.path!.points).toHaveLength(3);
    expect(tri.rotation).toBeCloseTo(30, 1);
    expect(tri.fills[0]).toMatchObject({ color: '#00FF00', opacity: 0.5 });
    expect(trees[1][0]).toMatchObject({ type: 'ELLIPSE', name: 'Dot' });
    expect(notes.join(' ')).toMatch(/image/);
  });
  it('produces nodes the document model accepts', () => {
    const store = new DocStore(createEmptyDocument());
    const page = pageIds(store.doc)[0];
    for (const tree of convertFigma(decodeFigmaBuffer(figmaBufferFromHtml(html)!)).trees) { tree[0].parent = page; store.apply({ t: 'insert', nodes: tree, parent: page, index: store.doc.nodes[page].children.length }); }
    validateDocument(store.doc);
    expect(Object.keys(store.doc.nodes).length).toBe(2 + 5);
  });
  it('reads path commands (move / line / cubic / quad / close)', () => {
    const b = new Uint8Array(1 + 8 + 1 + 24 + 1 + 16 + 1); const dv = new DataView(b.buffer); let o = 0;
    const cmd = (c: number, ...f: number[]) => { b[o++] = c; for (const v of f) { dv.setFloat32(o, v, true); o += 4; } };
    cmd(1, 0, 0); cmd(3, 10, 0, 20, 10, 20, 20); cmd(4, 10, 30, 0, 20); cmd(0);
    const [p] = parseCommands(b);
    expect(p.closed).toBe(true); expect(p.points).toHaveLength(3);
    expect(p.points[0]).toMatchObject({ ox: 10, oy: 0 });
    expect(p.points[1]).toMatchObject({ x: 20, y: 20, ix: 0, iy: -10 });
  });
});
