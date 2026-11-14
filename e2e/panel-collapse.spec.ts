import { expect, test } from '@playwright/test';
import { newFile, signup } from './helpers';

test('left panel collapses to the rail and expands again (persisted)', async ({ page }) => {
  await signup(page); await newFile(page);
  const rail = page.getByRole('navigation', { name: 'Sidebar' });
  await expect(page.getByText('Layers', { exact: true })).toBeVisible();
  const before = (await page.locator('.panel.left').boundingBox())!.width;
  await rail.getByRole('button', { name: 'Hide side panel' }).click();
  await expect(page.getByText('Layers', { exact: true })).toBeHidden();
  await expect.poll(async () => (await page.locator('.panel.left').boundingBox())!.width).toBeLessThan(80);
  expect(before).toBeGreaterThan(200);
  // the canvas must take the freed space and stay usable
  const cb = (await page.getByTestId('design-canvas').boundingBox())!;
  expect(cb.width).toBeGreaterThan(500);
  await page.keyboard.press('r');
  await page.mouse.move(cb.x + 100, cb.y + 150); await page.mouse.down(); await page.mouse.move(cb.x + 260, cb.y + 260, { steps: 5 }); await page.mouse.up();
  expect(await page.evaluate(() => Object.values((window as any).__layr.store.doc.nodes).filter((n: any) => n.type === 'RECT').length)).toBe(1);
  await page.reload(); await page.waitForFunction(() => !!(window as any).__layr);
  await expect(page.getByText('Layers', { exact: true })).toBeHidden(); // remembered
  await rail.getByRole('button', { name: 'Show side panel' }).click();
  await expect(page.getByText('Layers', { exact: true })).toBeVisible();
  await page.keyboard.press('Meta+\\'); await expect(page.getByText('Layers', { exact: true })).toBeHidden(); // shortcut
});
