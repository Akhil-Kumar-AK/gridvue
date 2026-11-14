import { expect, test } from '@playwright/test';
import { newFile, nodesOf, signup } from './helpers';

test('frame tool shows size presets in the right panel; picking one adds a frame of that size', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('f');
  const panel = page.getByRole('region', { name: 'Frame presets' });
  await expect(panel).toBeVisible();
  for (const g of ['Phone', 'Tablet', 'Desktop', 'Presentation', 'Watch', 'Paper', 'Social media', 'Community', 'Archive']) await expect(panel.getByRole('button', { name: g, exact: true })).toBeVisible();
  // Social media is open by default and lists the sizes
  await expect(panel.getByRole('button', { name: /X \(Twitter\) post\s*1200×675/ })).toBeVisible();
  await panel.getByRole('button', { name: /Instagram post/ }).click();
  const f = (await nodesOf(page, 'FRAME'))[0];
  expect([f.width, f.height, f.name]).toEqual([1080, 1350, 'Instagram post']);
  await expect(panel).toBeHidden(); // back to the inspector with the new frame selected
  await expect(page.locator('.layer.sel .lname')).toHaveText('Instagram post');
  // a second preset does not overlap the first
  await page.keyboard.press('f');
  await page.getByRole('region', { name: 'Frame presets' }).getByRole('button', { name: 'Phone', exact: true }).click();
  await page.getByRole('region', { name: 'Frame presets' }).getByRole('button', { name: /iPhone 16 Pro\s*402×874/ }).click();
  const [a, b] = await nodesOf(page, 'FRAME');
  expect(b.width).toBe(402); expect(b.x >= a.x + a.width || a.x >= b.x + b.width).toBe(true);
  // resize the selected frame from the inspector
  await page.getByLabel('Resize to preset').click(); await page.getByRole('option', { name: 'A4 — 595×842' }).click();
  await expect.poll(async () => (await nodesOf(page, 'FRAME')).map((n: any) => [n.width, n.height]).some(([w, h]: number[]) => w === 595 && h === 842)).toBe(true);
});
