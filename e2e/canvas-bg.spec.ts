import { expect, test } from '@playwright/test';
import { canvasBox, newFile, signup, waitSaved } from './helpers';

const px = (page: any) => page.getByTestId('design-canvas').evaluate((c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(5, 5, 1, 1).data; return [d[0], d[1], d[2]]; });

test('canvas is a flat Figma-style grey and its colour is editable from the page panel (persisted)', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.evaluate(() => { localStorage.setItem('layr:theme', 'dark'); });
  const first = await px(page);
  expect(first[0]).toBe(first[1]); expect(first[1]).toBe(first[2]); // neutral grey: no blue/violet tint, no gradient
  // click the empty canvas → page panel with the background colour
  const b = await canvasBox(page); await page.mouse.click(b.x + 200, b.y + 200);
  const hex = page.locator('.pill .cf-hex').first();
  await hex.fill('204060'); await hex.press('Enter');
  await expect.poll(() => px(page)).toEqual([0x20, 0x40, 0x60]);
  await waitSaved(page);
  await page.reload(); await page.waitForFunction(() => !!(window as any).__layr);
  await expect.poll(() => px(page)).toEqual([0x20, 0x40, 0x60]);
  // reset returns to the default grey
  await page.mouse.click(b.x + 200, b.y + 200);
  await page.getByRole('button', { name: /Reset to the default canvas colour/ }).click();
  await expect.poll(async () => { const p = await px(page); return p[0] === p[1] && p[1] === p[2]; }).toBe(true);
});
