import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DocStore, addNode, createEmptyDocument, defaultNode, pageIds, solid } from '../packages/core/src';
import { exportFig, importFig } from '../apps/web/src/interchange/fig';
import { exportXd, importXd } from '../apps/web/src/interchange/xd';
import { newFile, nodesOf, signup } from './helpers';

function design() {
  const store = new DocStore(createEmptyDocument());
  const page = pageIds(store.doc)[0];
  const frame = defaultNode('FRAME', { name: 'Hero', x: 0, y: 0, width: 320, height: 200, fills: [solid('#F4F1FF')] });
  addNode(store, frame, page);
  addNode(store, defaultNode('RECT', { name: 'Card', x: 20, y: 90, width: 200, height: 80, cornerRadius: 10, fills: [solid('#FFFFFF')] }), frame.id);
  addNode(store, defaultNode('ELLIPSE', { name: 'Blob', x: 220, y: 20, width: 70, height: 70, fills: [solid('#7C5CFF')] }), frame.id);
  const t = defaultNode('TEXT', { name: 'Headline', x: 20, y: 30, width: 180, height: 40, fills: [solid('#111111')] });
  t.text = { ...t.text!, characters: 'Imported design', fontSize: 24, fontWeight: 700, resize: 'AUTO_WIDTH' };
  addNode(store, t, frame.id);
  return store.doc;
}
const noAssets = async () => { throw new Error('no assets'); };

for (const kind of ['fig', 'xd'] as const) {
  test(`import a .${kind} file from the home page, edit it, and export it again`, async ({ page }, info) => {
    const doc = design();
    const bytes = kind === 'fig' ? await exportFig(doc, 'Design', noAssets) : await exportXd(doc, pageIds(doc)[0], 'Design', noAssets);
    const path = info.outputPath(`design.${kind}`);
    (await import('node:fs')).writeFileSync(path, bytes);

    await signup(page);
    await page.locator('input[type=file][accept*=".fig"]').setInputFiles(path);
    await page.waitForFunction(() => !!(window as any).__layr, undefined, { timeout: 15000 });
    await expect(page.locator('.layer', { hasText: 'Hero' })).toBeVisible();
    await expect(page.locator('.layer', { hasText: 'Headline' })).toBeVisible();
    const text = (await nodesOf(page, 'TEXT'))[0];
    expect(text.text).toMatchObject({ characters: 'Imported design', fontSize: 24, fontWeight: 700 });
    expect((await nodesOf(page, 'RECT'))[0]).toMatchObject({ name: 'Card', cornerRadius: 10 });

    // it is a normal Layr file: edit a layer, then export it back out
    await page.locator('.layer', { hasText: 'Card' }).click();
    await page.getByRole('button', { name: 'Main menu' }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: new RegExp(kind === 'fig' ? 'Export as Figma file' : 'Export as Adobe XD file') }).click()]);
    expect(dl.suggestedFilename()).toMatch(new RegExp(`\\.${kind}$`));
    const out = new Uint8Array(readFileSync((await dl.path())!));
    const back = kind === 'fig' ? importFig(out, 'x.fig') : importXd(out, 'x.xd');
    const names = Object.values(back.doc.nodes).map(n => n.name);
    expect(names).toEqual(expect.arrayContaining(['Hero', 'Card', 'Blob', 'Headline']));
  });
}

test('a large import (7 MB of images) goes up in pieces instead of failing', async ({ page }, info) => {
  const store = new DocStore(createEmptyDocument());
  const pg = pageIds(store.doc)[0];
  store.apply({ t: 'asset', id: 'asset_big', asset: { name: 'big.png', mime: 'image/png' } });
  const frame = defaultNode('FRAME', { name: 'Big', width: 200, height: 200 });
  addNode(store, frame, pg);
  addNode(store, defaultNode('RECT', { name: 'Photo', width: 100, height: 100, fills: [{ type: 'IMAGE', assetId: 'asset_big', scaleMode: 'FILL', opacity: 1, visible: true }] }), frame.id);
  const png = new Uint8Array(7_000_000); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 8; i < png.length; i += 997) png[i] = i & 255; // some entropy
  const bytes = await exportFig(store.doc, 'Big', async () => ({ bytes: png, mime: 'image/png' }));
  const path = info.outputPath('big.fig');
  (await import('node:fs')).writeFileSync(path, bytes);
  await signup(page);
  await page.locator('input[type=file][accept*=".fig"]').setInputFiles(path);
  await page.waitForFunction(() => !!(window as any).__layr, undefined, { timeout: 30000 });
  await expect(page.locator('.layer', { hasText: 'Photo' })).toBeVisible();
  const d = await page.evaluate(() => structuredClone((window as any).__layr.store.doc));
  const photo = Object.values(d.nodes as Record<string, any>).find(n => n.name === 'Photo');
  expect(photo.fills[0].type).toBe('IMAGE');
  expect(Object.keys(d.assets)).toEqual([photo.fills[0].assetId]);
});
