import { expect, test } from '@playwright/test';
import { choose, newFile, nodesOf, signup } from './helpers';

test('design system: create from the dashboard, link to a design file, drag components onto the canvas', async ({ page }) => {
  await signup(page);
  // the Design system button sits next to "New design file" on the dashboard
  await expect(page.getByRole('button', { name: 'New design system' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'New design system' }).first().click();
  await expect(page.getByTestId('design-canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__layr);
  const sets = await nodesOf(page, 'COMPONENT_SET');
  expect(sets.length).toBeGreaterThan(60); // buttons, inputs, cards, navigation, platform chrome …
  const dsId = await page.evaluate(() => (window as any).__layr.file.id);
  await page.getByRole('button', { name: 'Home' }).click();

  // a design file starts unlinked; link it from the Assets (book) panel
  await newFile(page);
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await expect(page.getByTestId('ds-section')).toContainText('Link a design system to drag');
  const options = await page.evaluate(async () => (await (await fetch('/api/files?view=all')).json()).files.filter((f: any) => f.type === 'designsystem').map((f: any) => f.id));
  await choose(page.locator('.ds-link .filterbtn'), options[0]);
  await expect(page.getByTestId('ds-tile').first()).toBeVisible();
  expect(await page.getByTestId('ds-tile').count()).toBeGreaterThan(80);
  await expect(page.getByTestId('ds-tile').filter({ hasText: 'Button' }).first()).toBeVisible();

  // drag the Button tile onto the canvas
  const tile = page.getByTestId('ds-tile').filter({ has: page.locator('b', { hasText: /^Button$/ }) });
  const canvas = (await page.getByTestId('design-canvas').boundingBox())!;
  await tile.dragTo(page.getByTestId('design-canvas'), { targetPosition: { x: canvas.width / 2, y: canvas.height / 2 } });
  await expect.poll(async () => (await nodesOf(page, 'INSTANCE')).length).toBe(1);
  const inst = (await nodesOf(page, 'INSTANCE'))[0];
  expect(inst.name).toContain('Type=Primary'); // the default variant, not the first-built one
  expect(inst.name).toContain('Size=M');
  // a second drop reuses the copied main component instead of importing again
  await tile.dragTo(page.getByTestId('design-canvas'), { targetPosition: { x: canvas.width / 2 + 120, y: canvas.height / 2 + 80 } });
  await expect.poll(async () => (await nodesOf(page, 'INSTANCE')).length).toBe(2);
  expect((await nodesOf(page, 'COMPONENT_SET')).length).toBe(1);

  // the link survives a reload and the picker lists it as linked
  await page.reload();
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await expect(page.getByTestId('ds-section')).toContainText('Linked to');
  expect(await page.evaluate(() => (window as any).__layr.file.libraryId)).toBe(dsId);

  // unlink keeps the instances
  await page.getByRole('button', { name: 'Unlink design system' }).click();
  await page.getByRole('button', { name: 'Unlink', exact: true }).click();
  await expect(page.getByTestId('ds-section')).toContainText('Link a design system to drag');
  expect((await nodesOf(page, 'INSTANCE')).length).toBe(2);
});
