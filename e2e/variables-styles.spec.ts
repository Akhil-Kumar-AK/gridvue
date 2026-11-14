import { expect, test } from '@playwright/test';
import { MOD, drag, newFile, nodesOf, signup, answerDialog } from './helpers';

const node = (page: any, id: string) => page.evaluate((i: string) => structuredClone((window as any).__layr.store.doc.nodes[i]), id);

test('variables with modes, binding, theme switching, tokens and styles through the UI', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('f'); await drag(page, 60, 60, 360, 260);
  await page.keyboard.press('r'); await drag(page, 100, 100, 200, 180);
  const frame = (await nodesOf(page, 'FRAME'))[0], rect = (await nodesOf(page, 'RECT'))[0];

  // define Theme collection with Light/Dark modes and a colour variable, in the full-page variables view
  await page.getByRole('button', { name: 'Variables', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Variables' })).toBeVisible();
  await page.getByRole('button', { name: 'Add collection' }).first().click(); await answerDialog(page, 'Theme');
  await page.getByRole('button', { name: 'Add mode' }).click(); await answerDialog(page, 'Dark');
  await page.getByLabel('Mode name').first().fill('Light'); await page.getByLabel('Mode name').first().blur();
  await page.getByRole('button', { name: 'Create variable' }).click();
  await page.getByRole('menuitem', { name: 'Color' }).click();
  const nameIn = page.getByLabel('Variable name').first(); await nameIn.fill('bg'); await nameIn.blur();
  await page.getByLabel('bg Light colour').fill('FFFFFF'); await page.getByLabel('bg Light colour').blur();
  await page.getByLabel('bg Dark colour').fill('111111'); await page.getByLabel('bg Dark colour').blur();
  await expect.poll(() => page.evaluate(() => Object.values((window as any).__layr.store.doc.variables).map((v: any) => v.name))).toEqual(['bg']);
  await page.getByRole('button', { name: 'Close variables' }).click();
  await expect(page.getByTestId('design-canvas')).toBeVisible();

  // bind the rectangle's fill
  await page.locator('.layer', { hasText: 'Rectangle' }).first().click();
  await page.getByRole('button', { name: 'Bind variable to fills.0.color' }).click();
  await page.getByRole('menuitem', { name: /bg/ }).click();
  expect((await node(page, rect.id)).fills[0].color.toLowerCase()).toBe('#ffffff');
  await expect(page.locator('.vchip', { hasText: 'bg' })).toBeVisible();

  // switch the frame to Dark → bound child follows; undo restores
  await page.locator('.layer', { hasText: 'Frame' }).first().click();
  await page.getByLabel('Theme mode').click(); await page.getByRole('option', { name: 'Dark' }).click();
  await expect.poll(async () => (await node(page, rect.id)).fills[0].color.toLowerCase()).toBe('#111111');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(async () => (await node(page, rect.id)).fills[0].color.toLowerCase()).toBe('#ffffff');
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(async () => (await node(page, rect.id)).fills[0].color.toLowerCase()).toBe('#111111');

  // tokens export contains the variable with both modes
  const tokens = await page.evaluate(() => { const { exportTokens } = (window as any).__core; return exportTokens((window as any).__layr.store.doc); });
  expect(tokens.collections[0].variables[0].values).toEqual({ Light: '#FFFFFF', Dark: '#111111' });

  // style: create from the rectangle's stroke... use a fill style on a second rect
  await page.keyboard.press('r'); await drag(page, 230, 100, 300, 160);
  const rect2 = (await nodesOf(page, 'RECT')).find((n: any) => n.id !== rect.id);
  await page.getByRole('button', { name: 'fill styles' }).click();
  await page.getByRole('menuitem', { name: /Create style from this/ }).click(); await answerDialog(page, 'Brand/Soft');
  await expect.poll(async () => (await node(page, rect2.id)).styleRefs?.fill).toBeTruthy();
  await expect(page.locator('.vchip.style', { hasText: 'Brand/Soft' })).toBeVisible();
  const sid = (await node(page, rect2.id)).styleRefs.fill;
  await page.evaluate(id => { const s = (window as any).__layr; const st = s.store.doc.styles[id]; s.store.apply({ t: 'meta', kind: 'styles', id, value: { ...st, value: { fills: [{ type: 'SOLID', color: '#FF00FF', opacity: 1, visible: true }] } } }); }, sid);
  await expect.poll(async () => (await node(page, rect2.id)).fills[0].color).toBe('#FF00FF');
});
