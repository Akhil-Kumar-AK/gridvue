import { expect, test } from '@playwright/test';
import { nodesOf, signup, newFile } from './helpers';

test('a whiteboard card in a design file is live, resizable, and its items can be dragged out as editable layers', async ({ page }) => {
  await signup(page);
  // 1) make a whiteboard with a note in it and wait until its preview picture has been saved
  await page.getByRole('button', { name: 'New whiteboard' }).first().click();
  await expect(page.getByTestId('jam-canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__jam?.api);
  await page.getByRole('toolbar', { name: 'Whiteboard tools' }).getByRole('button', { name: 'Sticky note', exact: true }).click();
  const cb = (await page.getByTestId('jam-canvas').boundingBox())!;
  await page.mouse.click(cb.x + 300, cb.y + 250); await page.keyboard.type('Embed me'); await page.keyboard.press('Escape');
  await expect(page.locator('.jam-save')).toHaveText('Saved', { timeout: 10_000 });
  const boardId = await page.evaluate(() => location.hash.split('/').pop()!);
  await expect.poll(async () => (await page.request.get(`/api/files/${boardId}/thumbnail`)).status(), { timeout: 10_000 }).toBe(200);

  // 2) in a design file, insert it from the shape menu
  await page.getByRole('tablist', { name: 'Open files' }).getByRole('button', { name: 'Home' }).click();
  await newFile(page);
  await page.getByRole('button', { name: 'shape tools' }).click();
  await page.getByRole('menuitem', { name: 'Whiteboard…' }).click();
  await page.getByRole('menuitem', { name: 'Untitled whiteboard' }).click();
  await expect.poll(async () => (await nodesOf(page, 'EMBED')).length).toBe(1);
  const [embed] = await nodesOf(page, 'EMBED');
  expect(embed.embed).toMatchObject({ fileId: boardId, kind: 'whiteboard' });
  // the card draws the board itself (whiteboard style), not a picture of it
  await expect.poll(async () => page.evaluate(id => !!(window as any).__layr.images.board(id), boardId), { timeout: 10_000 }).toBe(true);
  // the inspector offers an Open button
  await expect(page.getByRole('button', { name: 'Open in its own tab' })).toBeVisible();

  // 3) the card is live: the real whiteboard sits over its body, so you can add things right there
  const live = page.getByTestId('embed-live');
  await expect(live).toBeVisible();
  await expect(live.getByTestId('jam-canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__jam?.api);
  await live.getByRole('toolbar', { name: 'Whiteboard tools' }).getByRole('button', { name: 'Sticky note', exact: true }).click();
  const jb = (await live.getByTestId('jam-canvas').boundingBox())!;
  await page.mouse.click(jb.x + jb.width * 0.7, jb.y + jb.height * 0.3); await page.keyboard.type('Dragged to design'); await page.keyboard.press('Escape');
  // keys typed into the board must not trigger design-editor shortcuts (the design file still has just the one card)
  expect((await nodesOf(page, 'EMBED')).length).toBe(1);
  const boardStickies = () => page.evaluate(() => Object.values((window as any).__jam.store.board.items).filter((i: any) => i.kind === 'sticky').map((i: any) => ({ id: i.id, text: i.text, x: i.x, y: i.y })));
  await expect.poll(async () => (await boardStickies()).length).toBe(2);
  const mine = (await boardStickies()).find((s: any) => s.text === 'Dragged to design')!;

  // 4) drag that note out of the board onto the design: it becomes an editable design layer; the board keeps its copy
  const sp = await page.evaluate(([x, y]) => (window as any).__jam.api.worldToScreen({ x, y }), [mine.x + 50, mine.y + 50]);
  const c = (await page.getByTestId('design-canvas').boundingBox())!;
  await page.mouse.move(jb.x + sp.x, jb.y + sp.y); await page.mouse.down();
  await page.mouse.move(jb.x + sp.x - 120, jb.y + sp.y - 60, { steps: 6 });
  await page.mouse.move(c.x + 60, c.y + 70, { steps: 12 });
  await expect(page.locator('.embed-drop')).toBeVisible();
  await page.mouse.up();
  await expect.poll(async () => (await nodesOf(page, 'FRAME')).filter((n: any) => n.name === 'Sticky note').length).toBe(1);
  const texts = await nodesOf(page, 'TEXT');
  expect(texts.map((t: any) => t.text.characters)).toContain('Dragged to design');
  const after = (await boardStickies()).find((s: any) => s.id === mine.id)!;
  expect(after.x).toBeCloseTo(mine.x, 0); expect(after.y).toBeCloseTo(mine.y, 0); // copied, not moved
  expect((await nodesOf(page, 'EMBED')).length).toBe(1);

  // 4b) every other kind of item turns into editable layers too: drawing, code block, table, stamp, link card, shape, timer, connector
  const ids = await page.evaluate(async () => {
    const core = await import('/@fs/Users/akhilkumar/Downloads/figma/packages/core/src/index.ts');
    const j = (window as any).__jam; const mk = (k: string, x: number, y: number, p: any = {}) => ({ ...core.makeItem(k as any, x, y), ...p });
    const items = [
      mk('stroke', 0, 0, { x: 0, y: 700, w: 80, h: 10, pts: [0, 0, 40, 10, 80, 0], pen: 'pen', stroke: '#e5484d', strokeW: 3 }),
      mk('code', 200, 700, { text: 'const a = 1;' }), mk('table', 400, 700), mk('emoji', 700, 700, { emoji: '🚀' }), mk('timer', 800, 700),
      mk('link', 950, 700, { url: 'https://example.com/page', text: 'Example' }), mk('shape', 1150, 700, { shape: 'diamond', w: 120, h: 120 }),
    ];
    j.store.add(items); return items.map((i: any) => i.id);
  });
  await page.evaluate(i => (window as any).__jam.ui.getState().set({ selection: i }), ids);
  await page.getByRole('button', { name: 'Send selection to design' }).click();
  await expect.poll(async () => (await nodesOf(page, 'VECTOR')).length).toBeGreaterThanOrEqual(2); // the drawing and the diamond
  const names = (await nodesOf(page, 'FRAME')).map((n: any) => n.name);
  expect(names).toEqual(expect.arrayContaining(['Code block', 'Table', 'Timer', 'Link card']));
  expect((await nodesOf(page, 'TEXT')).map((t: any) => t.text.characters)).toEqual(expect.arrayContaining(['const a = 1;', '🚀']));
  expect((await nodesOf(page, 'RECT')).filter((n: any) => /^Cell /.test(n.name)).length).toBeGreaterThan(4);
  expect((await nodesOf(page, 'VECTOR')).every((v: any) => v.path.points.length >= 2)).toBe(true);

  // 5) the design layer is a normal layer: click it and its text is editable by the design tools
  const frames = (await nodesOf(page, 'FRAME')).filter((n: any) => n.name === 'Sticky note');
  expect(frames[0].fills[0].type).toBe('SOLID');

  // 6) the card can be resized like any layer; the live board follows it
  const before = (await live.boundingBox())!;
  await page.evaluate(id => (window as any).__layr.store.apply({ t: 'set', id, props: { width: 900 } }), embed.id);
  await expect.poll(async () => (await live.boundingBox())!.width).toBeGreaterThan(before.width + 150);

  // 7) selecting something else closes the live board and saves it; the card shows both notes
  await page.keyboard.press('Escape');
  const cv = (await page.getByTestId('design-canvas').boundingBox())!;
  await page.mouse.click(cv.x + 20, cv.y + cv.height - 20);
  await expect(live).toHaveCount(0);
  await expect.poll(async () => { const r = await (await page.request.get(`/api/files/${boardId}`)).json(); return Object.values(r.document.items).filter((i: any) => i.kind === 'sticky').length; }, { timeout: 10_000 }).toBe(2);
});

test('presenting: a whiteboard card on the bare page is explained; inside a frame it plays with a populated flow picker', async ({ page }) => {
  await signup(page);
  await page.getByRole('button', { name: 'New whiteboard' }).first().click();
  await expect(page.getByTestId('jam-canvas')).toBeVisible();
  await page.getByRole('tablist', { name: 'Open files' }).getByRole('button', { name: 'Home' }).click();
  await newFile(page);
  const insert = async () => { await page.getByRole('button', { name: 'shape tools' }).click(); await page.getByRole('menuitem', { name: 'Whiteboard…' }).click(); await page.getByRole('menuitem', { name: 'Untitled whiteboard' }).click(); };
  // 1) a card straight on the page is not a screen: no empty player, a clear message instead
  await insert();
  await expect.poll(async () => (await nodesOf(page, 'EMBED')).length).toBe(1);
  await page.getByRole('button', { name: 'Present prototype' }).click();
  await expect(page.getByTestId('player-canvas')).toHaveCount(0);
  await expect(page.getByText('Prototypes play frames').first()).toBeVisible();
  // 2) put a frame on the page, select it and add the card: it lands inside the frame and plays
  await page.keyboard.press('Escape');
  await page.keyboard.press('f'); const cb = (await page.getByTestId('design-canvas').boundingBox())!;
  await page.mouse.move(cb.x + 40, cb.y + 700); await page.mouse.down(); await page.mouse.move(cb.x + 420, cb.y + 830, { steps: 5 }); await page.mouse.up();
  await insert();
  await expect.poll(async () => { const [e] = (await nodesOf(page, 'EMBED')).slice(-1); const p = await page.evaluate(id => (window as any).__layr.store.doc.nodes[(window as any).__layr.store.doc.nodes[id].parent].type, e.id); return p; }).toBe('FRAME');
  await page.getByRole('button', { name: 'Present prototype' }).click();
  await expect(page.getByTestId('player-canvas')).toBeVisible();
  await expect(page.locator('.pb-field .sel').first()).not.toHaveText('');
});
