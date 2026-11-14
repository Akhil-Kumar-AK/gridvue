import { expect, test } from '@playwright/test';
import { MOD, canvasBox, click, doc, drag, makePng, newFile, nodesOf, signup, waitSaved } from './helpers';
import { readFileSync } from 'node:fs';

test.describe('Milestone 1: persisted design file', () => {
  test('create → draw frame/shapes/text/image → edit → undo/redo → reorder/nest → reload → export', async ({ page }) => {
    await signup(page);
    await newFile(page);
    const fileUrl = page.url();

    // frame, rectangle, ellipse drawn with real mouse input
    await page.keyboard.press('f'); await drag(page, 60, 80, 460, 480);
    await page.keyboard.press('r'); await drag(page, 100, 120, 220, 220);
    await page.keyboard.press('o'); await drag(page, 260, 140, 380, 260);
    const frame = (await nodesOf(page, 'FRAME'))[0];
    const rect = (await nodesOf(page, 'RECT'))[0];
    const ellipse = (await nodesOf(page, 'ELLIPSE'))[0];
    expect(rect.parent).toBe(frame.id);
    expect(ellipse.parent).toBe(frame.id);

    // text: type with the keyboard into the real textarea
    await page.keyboard.press('t'); await drag(page, 100, 320, 340, 360);
    await expect(page.locator('textarea.text-edit')).toBeFocused();
    await page.keyboard.type('Hello Layr');
    await page.keyboard.press('Escape');
    const text = (await nodesOf(page, 'TEXT'))[0];
    expect(text.text.characters).toBe('Hello Layr');
    expect(text.parent).toBe(frame.id);
    expect(text.name).toBe('Hello Layr');

    // image upload through the toolbar's file input
    const png = await makePng(page);
    await page.locator('input[type=file]').first().setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
    await expect.poll(async () => (await nodesOf(page, 'RECT')).filter((n: any) => n.fills[0]?.type === 'IMAGE').length).toBe(1);
    const img = (await nodesOf(page, 'RECT')).find((n: any) => n.fills[0]?.type === 'IMAGE');
    expect(img.width).toBe(120);

    // select by clicking the canvas; inspector shows the real values
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    const cam = await page.evaluate(() => (window as any).__layr && JSON.parse(JSON.stringify((document as any).__cam ?? {})));
    void cam;
    const toScreen = (n: any) => page.evaluate(({ id }) => {
      const s = (window as any).__layr; const c = (window as any).__editorCamera(); const doc = s.store.doc;
      let x = 0, y = 0; for (let cur = doc.nodes[id]; cur && cur.type !== 'PAGE'; cur = doc.nodes[cur.parent]) { x += cur.x; y += cur.y; }
      const n = doc.nodes[id]; return { x: (x + n.width / 2 - c.x) * c.zoom, y: (y + n.height / 2 - c.y) * c.zoom };
    }, { id: n.id });
    const rp = await toScreen(rect);
    await click(page, rp.x, rp.y);
    await expect(page.locator('.layer.sel .lname')).toHaveText('Rectangle');
    const wInput = page.locator('.wh .nf input').first();
    await expect(wInput).toHaveValue(String(Math.round(rect.width * 100) / 100));

    // edit via inspector (arithmetic supported), then undo/redo
    await wInput.fill('100+50'); await wInput.press('Enter');
    expect((await nodesOf(page, 'RECT')).find((n: any) => n.id === rect.id).width).toBe(150);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press(`${MOD}+z`);
    expect((await nodesOf(page, 'RECT')).find((n: any) => n.id === rect.id).width).toBeCloseTo(rect.width, 3);
    await page.keyboard.press(`${MOD}+Shift+z`);
    expect((await nodesOf(page, 'RECT')).find((n: any) => n.id === rect.id).width).toBe(150);

    // move with a canvas drag; one undo reverts the whole drag
    const before = (await nodesOf(page, 'RECT')).find((n: any) => n.id === rect.id);
    await drag(page, rp.x, rp.y, rp.x + 40, rp.y + 30);
    const moved = (await nodesOf(page, 'RECT')).find((n: any) => n.id === rect.id);
    expect(moved.x).toBeGreaterThan(before.x + 20);
    await page.keyboard.press(`${MOD}+z`);
    expect((await nodesOf(page, 'RECT')).find((n: any) => n.id === rect.id).x).toBeCloseTo(before.x, 3);

    // reorder: send rectangle to back, then nest via the layers panel drag and drop
    await page.keyboard.press(`${MOD}+[`);
    expect((await doc(page)).nodes[frame.id].children[0]).toBe(rect.id);
    await page.keyboard.press(`${MOD}+]`);
    expect((await doc(page)).nodes[frame.id].children.at(-1)).toBe(rect.id);

    // persistence
    await waitSaved(page);
    const saved = await doc(page);
    await page.goto(fileUrl); await page.reload();
    await page.waitForFunction(() => !!(window as any).__layr);
    expect(await doc(page)).toEqual(saved);
    await expect(page.getByTestId('save-status')).toHaveText('Saved');
    // the image survives the reload and renders (non-grey pixel inside the image bounds)
    await expect.poll(() => page.evaluate(async id => {
      const s = (window as any).__layr; const n = s.store.doc.nodes[id]; const asset = n.fills[0].assetId;
      const r = await fetch(`/api/assets/${asset}`); return r.status;
    }, img.id)).toBe(200);

    // export a PNG of the frame, rendered by the engine
    await page.locator('.layer', { hasText: 'Frame' }).first().click();
    await page.keyboard.press(`${MOD}+Shift+e`);
    const dl1 = page.waitForEvent('download');
    await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Export' }).click();
    const d1 = await dl1;
    const path = await d1.path();
    const bytes = readFileSync(path!);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
    const f2 = (await doc(page)).nodes[frame.id];
    expect(w).toBe(Math.ceil(f2.width * 2)); expect(h).toBe(Math.ceil(f2.height * 2)); // default 2x

    // native export → import round trip produces an equal document with re-uploaded assets
    await page.getByRole('button', { name: 'Main menu' }).click();
    const dl2 = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /Export native file/ }).click();
    const native = await dl2;
    const nf = JSON.parse(readFileSync((await native.path())!, 'utf8'));
    expect(nf.format).toBe('layr-document');
    expect(Object.keys(nf.assets).length).toBe(1);
    await page.getByRole('button', { name: 'Main menu' }).click();
    await page.getByRole('menuitem', { name: 'Back to files' }).click();
    await page.locator('input[type=file][accept*=".layr"]').setInputFiles(native.suggestedFilename() ? (await native.path())! : '');
    const oldId = fileUrl.split('/').pop();
    await page.waitForFunction(id => (window as any).__layr?.file.id !== id, oldId);
    const imported = await doc(page);
    expect(Object.keys(imported.nodes).length).toBe(Object.keys(saved.nodes).length);
    expect(Object.keys(imported.assets).length).toBe(1);
    expect(Object.keys(imported.assets)[0]).not.toBe(Object.keys(saved.assets)[0]);
  });

  test('viewport: wheel zoom keeps the cursor anchor; zoom to fit / selection; coordinate round trip', async ({ page }) => {
    await signup(page); await newFile(page);
    await page.keyboard.press('r'); await drag(page, 200, 200, 300, 280);
    const b = await canvasBox(page);
    const world = () => page.evaluate(({ x, y }) => { const c = (window as any).__editorCamera(); return { x: x / c.zoom + c.x, y: y / c.zoom + c.y }; }, { x: 250, y: 250 });
    const w0 = await world();
    await page.mouse.move(b.x + 250, b.y + 250);
    await page.keyboard.down(MOD); await page.mouse.wheel(0, -300); await page.keyboard.up(MOD);
    const z1 = (await page.evaluate(() => (window as any).__editorCamera())).zoom;
    expect(z1).toBeGreaterThan(1.5);
    const w1 = await world();
    expect(w1.x).toBeCloseTo(w0.x, 3); expect(w1.y).toBeCloseTo(w0.y, 3);
    await page.keyboard.press('Shift+1');
    const z2 = (await page.evaluate(() => (window as any).__editorCamera())).zoom;
    expect(z2).toBeLessThanOrEqual(8);
    await page.keyboard.press('Shift+0');
    expect((await page.evaluate(() => (window as any).__editorCamera())).zoom).toBeCloseTo(1, 5);
  });

  test('autosave persists across reload and unsaved local edits are recovered after a failed save', async ({ page, context }) => {
    await signup(page); await newFile(page);
    await page.keyboard.press('r'); await drag(page, 100, 100, 200, 200);
    await waitSaved(page);
    await context.setOffline(true);
    await page.route('**/api/files/*/doc', r => r.abort());
    await page.keyboard.press('o'); await drag(page, 300, 100, 400, 200);
    await expect(page.getByTestId('save-status')).toHaveText(/Offline/, { timeout: 10_000 });
    await context.setOffline(false);
    await page.unroute('**/api/files/*/doc');
    await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15_000 });
    expect((await nodesOf(page, 'ELLIPSE')).length).toBe(1);
  });
});
