import { expect, test } from '@playwright/test';
import { canvasBox, drag, nodesOf, signup, waitSaved } from './helpers';

test('home page: recents cards, create via Design, star, tabs open/switch/close and keep work per file', async ({ page }) => {
  await signup(page);
  const tabs = page.getByRole('tablist', { name: 'Open files' });
  await expect(tabs.getByRole('button', { name: 'Home' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All files' })).toBeVisible();
  for (const b of ['New design file', 'New whiteboard', 'New design system', 'Import file']) await expect(page.locator('.hmain').getByRole('button', { name: b })).toHaveCount(1); // one entry point each on the page, no duplicates
  for (const gone of ['Slides', 'Make']) await expect(page.getByRole('button', { name: gone, exact: true })).toHaveCount(0);

  // Design pill creates a file and opens it in a tab
  await page.locator('.hmain').getByRole('button', { name: 'New design file' }).click();
  await page.waitForFunction(() => !!(window as any).__layr);
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await page.keyboard.press('r'); const b = await canvasBox(page); await page.mouse.move(b.x + 100, b.y + 100); await page.mouse.down(); await page.mouse.move(b.x + 220, b.y + 180, { steps: 4 }); await page.mouse.up();
  await waitSaved(page);
  const firstId = page.url().split('/').pop()!;

  // a second file in a second tab via the + button
  await tabs.getByRole('button', { name: 'New design file' }).click();
  await expect.poll(() => page.url().split('/').pop()).not.toBe(firstId);
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await page.waitForFunction(id => (window as any).__layr?.file.id !== id, firstId);
  await page.keyboard.press('o'); const b2 = await canvasBox(page); await page.mouse.move(b2.x + 300, b2.y + 200); await page.mouse.down(); await page.mouse.move(b2.x + 400, b2.y + 300, { steps: 4 }); await page.mouse.up();
  await waitSaved(page);

  // switching tabs shows each file's own content
  await tabs.getByRole('tab').first().click();
  await page.waitForFunction(id => (window as any).__layr?.file.id === id, firstId);
  expect((await nodesOf(page, 'RECT')).length).toBe(1); expect((await nodesOf(page, 'ELLIPSE')).length).toBe(0);
  await tabs.getByRole('tab').nth(1).click();
  await page.waitForFunction(id => (window as any).__layr?.file.id !== id, firstId);
  expect((await nodesOf(page, 'ELLIPSE')).length).toBe(1);

  // renaming in the file updates the tab title
  const name = page.getByLabel('File name'); await name.fill('Checkout flow'); await name.press('Enter');
  await expect(tabs.getByRole('tab', { name: /Checkout flow/ })).toBeVisible();

  // home shows both as cards with name + location + edited time; star it → appears under Starred
  await tabs.getByRole('button', { name: 'Home' }).click();
  await expect(page.locator('.hcard')).toHaveCount(2);
  const card = page.locator('.hcard', { hasText: 'Checkout flow' });
  await expect(card).toContainText('Drafts · Edited');
  await card.hover(); await card.getByRole('button', { name: 'Add to starred' }).click();
  await expect(page.locator('.hs-pinned', { hasText: 'Checkout flow' })).toBeVisible();
  // list view and search
  await page.getByRole('button', { name: 'List view' }).click(); await expect(page.locator('.lrow:not(.head)')).toHaveCount(2);
  await page.getByLabel('Search files').fill('checkout'); await expect(page.locator('.lrow:not(.head)')).toHaveCount(1);

  // closing the active tab falls back to a neighbour; closing the last returns home
  await page.getByLabel('Search files').fill('');
  await tabs.getByRole('tab').first().click();
  await tabs.getByRole('button', { name: /^Close / }).first().click();
  await expect(tabs.getByRole('tab')).toHaveCount(1);
  await tabs.getByRole('button', { name: /^Close / }).click();
  await expect(tabs.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'All files' })).toBeVisible();
  // reopen from home: work persisted and the tab returns
  await page.getByRole('button', { name: 'Grid view' }).click();
  await page.locator('.hcard', { hasText: 'Checkout flow' }).getByText('Checkout flow').first().click();
  await page.waitForFunction(() => !!(window as any).__layr);
  expect((await nodesOf(page, 'ELLIPSE')).length).toBe(1);
  await expect(tabs.getByRole('tab')).toHaveCount(1);
});
