import { expect, test } from '@playwright/test';
import { newFile, signup } from './helpers';

test('file card "more" menu floats above the page instead of opening inside the card', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.getByRole('tablist', { name: 'Open files' }).getByRole('button', { name: 'Home' }).click();
  const card = page.locator('.hcard').first();
  await expect(card).toBeVisible();
  await card.hover();
  await card.getByRole('button', { name: 'File actions' }).click();
  const menu = page.locator('.menu').filter({ has: page.getByRole('menuitem', { name: 'Duplicate' }) });
  await expect(menu).toBeVisible();
  const cb = (await card.boundingBox())!, mb = (await menu.boundingBox())!;
  // fully readable: not clipped by the card, and it opens below the card's thumbnail button, outside its overflow box
  expect(await menu.evaluate(el => !!el.closest('.hcard'))).toBe(false);
  expect(mb.width).toBeGreaterThan(120); expect(mb.height).toBeGreaterThan(100);
  expect(mb.y).toBeGreaterThan(cb.y);
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.locator('.hcard')).toHaveCount(2);
  // list view uses the same menu
  await page.getByRole('button', { name: 'List view' }).click();
  await page.locator('.lrow').nth(1).hover();
  await page.locator('.lrow').nth(1).getByRole('button', { name: 'File actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Move to trash' })).toBeVisible();
});
