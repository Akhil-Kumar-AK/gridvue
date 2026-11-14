import { expect, test } from '@playwright/test';
import { canvasBox, drag, newFile, signup } from './helpers';

/** canvas pixel (device px) at canvas-relative coordinates */
const px = (page: any, x: number, y: number) => page.evaluate(([x, y]: number[]) => { const c = document.querySelector('[data-testid=design-canvas]') as HTMLCanvasElement; const d = c.width / c.getBoundingClientRect().width; return Array.from(c.getContext('2d')!.getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data).slice(0, 3); }, [x, y]);

test('hovering the canvas lights up the layer row, hovering a row outlines the object', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('f'); await drag(page, 60, 60, 400, 300);
  await page.keyboard.press('r'); await drag(page, 120, 120, 240, 220);
  await page.keyboard.press('Escape'); await page.keyboard.press('v');
  await page.mouse.click((await canvasBox(page)).x + 700, (await canvasBox(page)).y + 500); // deselect
  const rows = page.locator('.layer');
  await expect(rows).toHaveCount(2);
  const rectRow = rows.filter({ hasText: 'Rectangle' });

  // canvas → panel
  const b = await canvasBox(page);
  await page.mouse.move(b.x + 180, b.y + 170);
  await expect(rectRow).toHaveClass(/hov/);
  await page.mouse.move(b.x + 700, b.y + 500);
  await expect(rectRow).not.toHaveClass(/hov/);

  // panel → canvas: the rectangle's top edge is drawn in the accent colour
  await page.waitForTimeout(150);
  const before = await px(page, 180, 120);
  await rectRow.hover();
  await page.waitForTimeout(300);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/hover.png` });
  const after = await px(page, 180, 120);
  expect(after).not.toEqual(before);
  expect(after[2]).toBeGreaterThan(180); expect(after[0]).toBeLessThan(140); // indigo accent (#4f46e5)
  await page.mouse.move(b.x + 700, b.y + 500);
  await page.waitForTimeout(300);
  expect(await px(page, 180, 120)).toEqual(before);
});
