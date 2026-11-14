import { expect, test } from '@playwright/test';
import { drag, newFile, nodesOf, signup, choose, answerDialog } from './helpers';

const node = (page: any, id: string) => page.evaluate((i: string) => structuredClone((window as any).__layr.store.doc.nodes[i]), id);

test('colour picker: custom (SV, hue, alpha, hex, formats, swatches, eyedropper state), gradient type, libraries bind', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('r'); await drag(page, 100, 100, 220, 180);
  const rect = (await nodesOf(page, 'RECT'))[0];
  await page.getByRole('button', { name: 'Open color picker' }).first().click();
  const pop = page.getByRole('dialog', { name: 'Color picker' });
  await expect(pop).toBeVisible();
  await expect(pop.getByRole('button', { name: 'Custom' })).toBeVisible(); await expect(pop.getByRole('button', { name: 'Libraries' })).toBeVisible();
  // hex input
  const hex = pop.getByLabel('Colour value'); await hex.fill('FF0000'); await hex.press('Enter');
  await expect.poll(async () => (await node(page, rect.id)).fills[0].color).toBe('#FF0000');
  // saturation square: top-left = white, bottom = black
  const sv = pop.getByTestId('cp-sv'); const b = (await sv.boundingBox())!;
  await page.mouse.click(b.x + 2, b.y + 2);
  await expect.poll(async () => { const c = (await node(page, rect.id)).fills[0].color as string; return [1, 3, 5].every(i => parseInt(c.slice(i, i + 2), 16) > 0xf0); }).toBe(true); // top-left corner ≈ white
  await page.mouse.click(b.x + b.width / 2, b.y + b.height - 2);
  await expect.poll(async () => { const c = (await node(page, rect.id)).fills[0].color as string; return [1, 3, 5].every(i => parseInt(c.slice(i, i + 2), 16) < 0x10); }).toBe(true); // bottom edge ≈ black
  // hue slider changes the hue of a saturated colour
  await page.mouse.click(b.x + b.width - 2, b.y + 2); // saturated, bright
  const hue = pop.getByTestId('cp-hue'); const hb = (await hue.boundingBox())!;
  await page.mouse.click(hb.x + hb.width * 0.33, hb.y + hb.height / 2); // ~120° = green
  await expect.poll(async () => { const c = (await node(page, rect.id)).fills[0].color as string; return parseInt(c.slice(3, 5), 16) > parseInt(c.slice(1, 3), 16) + 80; }).toBe(true);
  // alpha slider + opacity box
  const alpha = pop.getByTestId('cp-alpha'); const ab = (await alpha.boundingBox())!;
  await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await expect.poll(async () => Math.round((await node(page, rect.id)).fills[0].opacity * 10)).toBe(5);
  const op = pop.getByLabel('Opacity'); await op.fill('25'); await op.press('Enter');
  await expect.poll(async () => (await node(page, rect.id)).fills[0].opacity).toBeCloseTo(0.25, 2);
  // RGB format accepts "r, g, b"
  await choose(pop.getByLabel('Colour format'), 'RGB');
  await pop.getByLabel('Colour value').fill('10, 20, 30'); await pop.getByLabel('Colour value').press('Enter');
  await expect.poll(async () => (await node(page, rect.id)).fills[0].color).toBe('#0A141E');
  // page swatches include the colour in use; presets work
  await choose(pop.getByLabel('Swatch source'), 'preset');
  await pop.getByRole('button', { name: 'Use #FF3B30' }).click();
  await expect.poll(async () => (await node(page, rect.id)).fills[0].color).toBe('#FF3B30');
  // linear gradient type
  await pop.getByRole('button', { name: 'Linear gradient' }).click();
  await expect.poll(async () => (await node(page, rect.id)).fills[0].type).toBe('LINEAR');
  await choose(pop.getByLabel('Colour format'), 'HEX');
  await pop.getByRole('button', { name: 'Stop 2' }).click();
  await pop.getByLabel('Colour value').fill('0000FF'); await pop.getByLabel('Colour value').press('Enter');
  await expect.poll(async () => (await node(page, rect.id)).fills[0].stops[1].color).toBe('#0000FF');
  await pop.getByRole('button', { name: 'Solid' }).click();
  await expect.poll(async () => (await node(page, rect.id)).fills[0].type).toBe('SOLID');
  // libraries: save the colour as a variable with +, then bind it from the Libraries tab
  await pop.getByRole('button', { name: 'Save to library' }).click(); await answerDialog(page, 'brand/red');
  await expect.poll(() => page.evaluate(() => Object.values((window as any).__layr.store.doc.variables).length)).toBe(1);
  await pop.getByRole('button', { name: 'Libraries' }).click();
  await expect(pop.getByPlaceholder('Search')).toBeVisible(); await expect(pop.getByLabel('Library', { exact: true })).toBeVisible();
  await pop.getByRole('button', { name: /brand\/red/ }).click();
  await expect(pop).toBeHidden();
  expect((await node(page, rect.id)).varBindings?.['fills.0.color']).toBeTruthy();
  await expect(page.locator('.vchip', { hasText: 'brand/red' })).toBeVisible();
  // Escape / outside click closes
  await page.getByRole('button', { name: 'Detach variable' }).click();
  await page.getByRole('button', { name: 'Open color picker' }).first().click();
  await expect(pop).toBeVisible(); await page.keyboard.press('Escape'); await expect(pop).toBeHidden();
});
