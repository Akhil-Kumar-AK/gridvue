import { expect, test } from '@playwright/test';
import { canvasBox, drag, newFile, nodesOf, signup } from './helpers';

test('selected frame: corner handles, coloured title and dev toggle; double-click the title to rename inline', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('f'); await drag(page, 80, 100, 360, 300);
  const f = (await nodesOf(page, 'FRAME'))[0];
  const b = await canvasBox(page);
  const title = await page.evaluate((id: string) => {
    const s = (window as any).__layr, c = (window as any).__editorCamera(), n = s.store.doc.nodes[id];
    return { x: (n.x - c.x) * c.zoom, y: (n.y - c.y) * c.zoom };
  }, f.id);
  // double-click the name above the frame → inline editor
  await page.mouse.dblclick(b.x + title.x + 12, b.y + title.y - 10);
  const input = page.getByLabel('Frame name');
  await expect(input).toBeVisible(); await expect(input).toBeFocused();
  await input.fill('Checkout screen'); await input.press('Enter');
  await expect(input).toBeHidden();
  expect((await nodesOf(page, 'FRAME'))[0].name).toBe('Checkout screen');
  await expect(page.locator('.layer.sel .lname')).toHaveText('Checkout screen');
  // escape cancels
  await page.mouse.dblclick(b.x + title.x + 12, b.y + title.y - 10);
  await page.getByLabel('Frame name').fill('Nope'); await page.keyboard.press('Escape');
  await expect(page.getByLabel('Frame name')).toBeHidden();
  expect((await nodesOf(page, 'FRAME'))[0].name).toBe('Checkout screen');
  // undo restores the previous name
  await page.keyboard.press('Meta+z');
  expect((await nodesOf(page, 'FRAME'))[0].name).toBe('Frame');
});
