import { expect, test } from '@playwright/test';
import { choose, drag, newFile, nodesOf, signup } from './helpers';

test('prototype: an interaction can open one of your whiteboards (click or hover) and come back', async ({ page }) => {
  await signup(page);
  // a whiteboard with one note
  await page.getByRole('button', { name: 'New whiteboard' }).first().click();
  await expect(page.getByTestId('jam-canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__jam?.api);
  await page.getByRole('toolbar', { name: 'Whiteboard tools' }).getByRole('button', { name: 'Sticky note', exact: true }).click();
  const jb = (await page.getByTestId('jam-canvas').boundingBox())!;
  await page.mouse.click(jb.x + 300, jb.y + 250); await page.keyboard.type('Roadmap ideas'); await page.keyboard.press('Escape');
  await expect(page.locator('.jam-save')).toHaveText('Saved', { timeout: 10_000 });
  const boardId = await page.evaluate(() => location.hash.split('/').pop()!);

  // a design file with a frame and a button
  await page.getByRole('tablist', { name: 'Open files' }).getByRole('button', { name: 'Home' }).click();
  await newFile(page);
  await page.keyboard.press('f'); await drag(page, 40, 60, 300, 330);
  await page.keyboard.press('r'); await drag(page, 80, 100, 220, 150);
  const btn = (await nodesOf(page, 'RECT'))[0];
  await page.getByRole('button', { name: 'Prototype', exact: true }).first().click();
  await page.locator('.layer', { hasText: 'Rectangle' }).click();
  await page.getByRole('button', { name: 'Add interaction' }).click();
  await page.getByRole('button', { name: '+ Add action' }).click();
  await choose(page.getByLabel('Action', { exact: true }).first(), 'WHITEBOARD');
  const pick = page.getByLabel('Whiteboard to open');
  await expect(pick).toBeVisible();
  await choose(pick, boardId);
  const int = (await page.evaluate(id => structuredClone((window as any).__layr.store.doc.nodes[id].interactions), btn.id))[0];
  expect(int.actions[0]).toMatchObject({ type: 'WHITEBOARD', fileId: boardId });
  expect(int.actions[0].fileName).toBeTruthy();

  // present and click the button: the whiteboard opens inside the player
  await page.getByRole('button', { name: 'Present prototype' }).click();
  const canvas = page.getByTestId('player-canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(200);
  // the player fits the prototype to the window: wait until its size has settled before clicking
  let prev = 0; await expect.poll(async () => { const w = (await canvas.boundingBox())!.width; const settled = Math.abs(w - prev) < 1; prev = w; return settled; }).toBe(true);
  const cb = (await canvas.boundingBox())!;
  const spot = await page.evaluate(id => { const n = (window as any).__layr.store.doc.nodes[id]; const f = (window as any).__layr.store.doc.nodes[n.parent]; return { x: n.x + n.width / 2, y: n.y + n.height / 2, fw: f.width, fh: f.height }; }, btn.id);
  await page.mouse.click(cb.x + spot.x * (cb.width / spot.fw), cb.y + spot.y * (cb.height / spot.fh));
  const view = page.getByTestId('wb-view');
  await expect(view).toBeVisible();
  await expect(view).toContainText('Untitled whiteboard');
  await expect(view.getByTestId('wb-canvas')).toBeVisible();
  // the board is drawn (not blank): the canvas has coloured pixels from the sticky note
  await expect.poll(async () => page.getByTestId('wb-canvas').evaluate((c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] > 200 && d[i + 1] > 180 && d[i + 2] < 140) n++; return n; }), { timeout: 8000 }).toBeGreaterThan(5);
  await expect(view.getByRole('link', { name: 'Open whiteboard' })).toHaveAttribute('href', `#/file/${boardId}`);
  await view.getByRole('button', { name: 'Back to prototype' }).click();
  await expect(view).toHaveCount(0);
  await expect(canvas).toBeVisible();
});
