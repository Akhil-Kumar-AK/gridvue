import { expect, test, type Locator, type Page } from '@playwright/test';
import { drag, newFile, nodesOf, signup } from './helpers';

/** Drag a floating panel by an empty spot of its header and report how far it moved. */
async function dragHeader(page: Page, panel: Locator, header: Locator, dx: number, dy: number) {
  const before = (await panel.boundingBox())!, h = (await header.boundingBox())!;
  // an empty spot in the header: scan from the right until the pointer is not over a control
  let x = h.x + h.width - 6; const y = h.y + h.height / 2;
  for (let i = 0; i < 40; i++) { const hit = await page.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); return !!el?.closest('button, input, select, textarea, [role=tab]'); }, [x, y]); if (!hit) break; x -= 8; }
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 }); await page.mouse.move(x + dx, y + dy, { steps: 4 }); await page.mouse.up();
  const after = (await panel.boundingBox())!;
  return { dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y) };
}

test('every sub-panel opened from the properties panel can be dragged by its header', async ({ page }) => {
  await signup(page); await newFile(page);
  // text layer (for type settings) and a rectangle with a stroke (for stroke settings and the colour picker)
  await page.keyboard.press('t'); await drag(page, 100, 120, 300, 200);
  await expect(page.locator('textarea.text-edit')).toBeFocused(); // typing before the editor has focus would trigger tool shortcuts
  await page.keyboard.type('Drag me'); await page.keyboard.press('Escape');
  await expect(page.locator('textarea.text-edit')).toHaveCount(0); // finish editing before using shortcuts again
  await page.keyboard.press('r'); await drag(page, 400, 150, 560, 280);
  await expect.poll(async () => (await nodesOf(page, 'RECT')).length).toBe(1);
  await page.getByRole('button', { name: 'Add stroke' }).click();

  // colour picker
  await page.getByRole('button', { name: 'Open color picker' }).first().click();
  const cp = page.getByRole('dialog', { name: 'Color picker' });
  let m = await dragHeader(page, cp, cp.locator('.cp-head'), -140, -90); // panels open near the bottom edge, so move up and left
  expect(m.dx).toBeLessThan(-100); expect(m.dy).toBeLessThan(-60);
  // controls inside the panel still work after moving it
  await cp.getByLabel('Colour value').fill('123456'); await cp.getByLabel('Colour value').press('Enter');
  await cp.getByRole('button', { name: 'Close color picker' }).click();

  // stroke settings
  await page.getByRole('button', { name: 'Stroke settings' }).click();
  const ss = page.getByRole('dialog', { name: 'Stroke settings' });
  m = await dragHeader(page, ss, ss.locator('.ss-head'), -120, -70);
  expect(m.dx).toBeLessThan(-80); expect(m.dy).toBeLessThan(-40);
  await ss.getByRole('button', { name: 'Close stroke settings' }).click();

  // type settings
  await page.locator('.layer', { hasText: 'Drag me' }).first().click();
  await page.getByRole('button', { name: 'Type settings' }).click();
  const ts = page.getByRole('dialog', { name: 'Type settings' });
  m = await dragHeader(page, ts, ts.locator('.ty-tabs'), -120, -70);
  expect(m.dx).toBeLessThan(-80); expect(m.dy).toBeLessThan(-40);
  // the panel stays inside the window
  const b = (await ts.boundingBox())!; expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0);
});
