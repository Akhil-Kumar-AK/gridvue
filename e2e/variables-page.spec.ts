import { expect, test } from '@playwright/test';
import { drag, newFile, signup } from './helpers';
import { writeFileSync } from 'node:fs';

test('variables page: rail icons, groups, aliases, W3C tokens import/export, bind while designing', async ({ page }, info) => {
  await signup(page); await newFile(page);
  // the left rail has File, Assets, Variables (and search) — no disabled plugin/comment icons
  const rail = page.getByRole('navigation', { name: 'Sidebar' });
  await expect(rail.getByRole('button', { name: 'Variables' })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await expect(rail.locator('button[disabled]')).toHaveCount(0);
  await rail.getByRole('button', { name: 'Variables' }).click();
  await expect(page.getByTestId('design-canvas')).toBeHidden(); // the variables page takes over the canvas area

  // import W3C design tokens
  const f = info.outputPath('tokens.json');
  writeFileSync(f, JSON.stringify({ color: { $type: 'color', brand: { primary: { $value: '#2196F3' }, link: { $value: '{color.brand.primary}' } } }, space: { $type: 'dimension', m: { $value: '16px' } } }));
  await page.locator('input[type=file][accept*=".json"]').setInputFiles(f);
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).__layr.store.doc.variables).length)).toBe(3);
  // groups with counts, filtering, alias chip
  const region = page.getByRole('region', { name: 'Variables' });
  await expect(region.getByRole('button', { name: /^color\s*2$/ })).toBeVisible();
  await region.getByRole('button', { name: /^brand\s*2$/ }).click();
  await expect(region.getByLabel('Variable name')).toHaveCount(2);
  await expect(region.locator('.achip')).toContainText('color/brand/primary');
  await region.getByRole('button', { name: /^All\s*3$/ }).click();
  await region.getByLabel('Search variables').fill('space'); await expect(region.getByLabel('Variable name')).toHaveCount(1);
  await region.getByLabel('Search variables').fill('');
  // create a variable inside a group and an export round trip
  await region.getByRole('button', { name: /^color\s*2$/ }).click();
  await region.getByRole('button', { name: 'Create variable' }).click(); await page.getByRole('menuitem', { name: 'Number' }).click();
  await expect.poll(() => page.evaluate(() => Object.values((window as any).__layr.store.doc.variables).map((v: any) => v.name).sort())).toContain('color/Number');
  const exported = await page.evaluate(() => (window as any).__core.toDtcg((window as any).__layr.store.doc, Object.keys((window as any).__layr.store.doc.collections)[0]));
  expect(exported.color.brand.link.$value).toBe('{color.brand.primary}');
  // back to the canvas, bind while designing from the colour picker's Libraries tab
  await region.getByRole('button', { name: 'Close variables' }).click();
  await page.keyboard.press('r'); await drag(page, 100, 100, 220, 180);
  await page.getByRole('button', { name: 'Open color picker' }).first().click();
  const pop = page.getByRole('dialog', { name: 'Color picker' });
  await pop.getByRole('button', { name: 'Libraries' }).click();
  await pop.getByRole('button', { name: /brand\/primary/ }).click();
  await expect(page.locator('.vchip', { hasText: 'brand/primary' })).toBeVisible();
});
