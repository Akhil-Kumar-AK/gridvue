import { expect, test } from '@playwright/test';
import { drag, newFile, nodesOf, signup, choose } from './helpers';

const node = (page: any, id: string) => page.evaluate((i: string) => structuredClone((window as any).__layr.store.doc.nodes[i]), id);
// 1x1 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('picker fill types: Solid, Gradient, Pattern, Image (no Video); pattern from a layer and image adjustments', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('r'); await drag(page, 100, 100, 330, 300);   // the layer to fill
  await page.keyboard.press('r'); await drag(page, 420, 120, 480, 180);   // the tile source
  const rects = await nodesOf(page, 'RECT'); const target = rects[0], source = rects[1];
  await page.keyboard.press('v'); const cb = (await page.getByTestId('design-canvas').boundingBox())!;
  await page.mouse.click(cb.x + 200, cb.y + 200); // select the big one
  await page.getByRole('button', { name: 'Open color picker' }).first().click();
  const pop = page.getByRole('dialog', { name: 'Color picker' });
  const types = pop.locator('.cp-types');
  await expect(types.getByRole('button', { name: 'Solid' })).toBeEnabled();
  await expect(types.getByRole('button', { name: 'Linear gradient' })).toBeEnabled();
  await expect(types.getByRole('button', { name: 'Pattern' })).toBeEnabled();
  await expect(types.getByRole('button', { name: 'Image' })).toBeEnabled();
  await expect(types.getByRole('button', { name: 'Video' })).toHaveCount(0);

  // ---- pattern: pick the second rectangle as the tile
  await types.getByRole('button', { name: 'Pattern' }).click();
  await expect(pop.getByTestId('pattern-panel')).toBeVisible();
  expect((await node(page, target.id)).fills[0].type).toBe('SOLID'); // nothing changes until a source is chosen
  await pop.getByRole('button', { name: /Select source/ }).click();
  await page.mouse.click(cb.x + 450, cb.y + 150);
  await expect.poll(async () => (await node(page, target.id)).fills[0].type).toBe('PATTERN');
  expect((await node(page, target.id)).fills[0].sourceId).toBe(source.id);
  await expect(pop).toBeVisible(); // the picker stays open after picking
  await pop.getByRole('button', { name: 'Offset tiles' }).click();
  await pop.getByLabel('Pattern scale').fill('50'); await pop.getByLabel('Pattern scale').press('Enter');
  await pop.getByLabel('Pattern spacing X').fill('20'); await pop.getByLabel('Pattern spacing X').press('Enter');
  await pop.getByRole('button', { name: 'Align centre' }).click();
  await expect.poll(async () => { const f = (await node(page, target.id)).fills[0]; return [f.tile, f.scale, f.spacingX, f.align].join('|'); }).toBe('OFFSET|0.5|20|c');
  // the canvas really shows the repeated tile (sample inside the big rectangle: some pixels differ from the grey default)
  const painted = await page.evaluate(() => { const c = document.querySelector('[data-testid=design-canvas]') as HTMLCanvasElement; const g = c.getContext('2d')!; const d = g.getImageData(Math.round(c.width * 0.2), Math.round(c.height * 0.25), 60, 60).data; const seen = new Set<string>(); for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`); return seen.size; });
  expect(painted).toBeGreaterThan(0);

  // ---- image: upload, mode, rotation and adjustments
  await types.getByRole('button', { name: 'Image' }).click();
  await expect(pop.getByTestId('image-panel')).toBeVisible();
  await expect(pop.getByRole('button', { name: 'Make an image' })).toBeDisabled();
  await pop.locator('input[type=file]').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(async () => (await node(page, target.id)).fills[0].type).toBe('IMAGE');
  await pop.getByLabel('Exposure').fill('40');
  await pop.getByLabel('Saturation').fill('-60');
  await expect.poll(async () => { const f = (await node(page, target.id)).fills[0]; return `${f.adjust?.exposure}|${f.adjust?.saturation}`; }).toBe('40|-60');
  await pop.getByLabel('Exposure').dblclick();
  await expect.poll(async () => (await node(page, target.id)).fills[0].adjust?.exposure).toBeUndefined();
  await choose(pop.getByLabel('Image fit'), 'TILE');
  await pop.getByRole('button', { name: 'Rotate image 90 degrees' }).click();
  await expect.poll(async () => { const f = (await node(page, target.id)).fills[0]; return `${f.scaleMode}|${f.rotation}`; }).toBe('TILE|90');
  // back to solid
  await types.getByRole('button', { name: 'Solid' }).click();
  await expect.poll(async () => (await node(page, target.id)).fills[0].type).toBe('SOLID');
});

test('blend mode menu lists every mode in groups, marks the current one and applies the choice', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('r'); await drag(page, 100, 100, 330, 300);
  const rect = (await nodesOf(page, 'RECT'))[0];
  await page.getByRole('button', { name: /^Blend mode/ }).click();
  const menu = page.getByRole('menu');
  const names = ['Normal', 'Darken', 'Multiply', 'Plus darker', 'Color burn', 'Lighten', 'Screen', 'Plus lighter', 'Color dodge', 'Overlay', 'Soft light', 'Hard light', 'Difference', 'Exclusion', 'Hue', 'Saturation', 'Color', 'Luminosity'];
  await expect(menu.getByRole('menuitem')).toHaveText(names);
  await expect(menu.locator('.menu-sep')).toHaveCount(5);
  await expect(menu.getByRole('menuitem', { name: 'Normal' })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: 'test-results/blend-menu.png' });
  await menu.getByRole('menuitem', { name: 'Soft light' }).click();
  await expect.poll(async () => (await node(page, rect.id)).blendMode).toBe('SOFT_LIGHT');
  await page.getByRole('button', { name: /^Blend mode/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Soft light' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitem', { name: 'Luminosity' }).click();
  await expect.poll(async () => (await node(page, rect.id)).blendMode).toBe('LUMINOSITY');
});

test('picker droplet sets the blend mode of a fill and of a stroke', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('r'); await drag(page, 100, 100, 330, 300);
  const rect = (await nodesOf(page, 'RECT'))[0];
  await page.getByRole('button', { name: 'Open color picker' }).first().click();
  const pop = page.getByRole('dialog', { name: 'Color picker' });
  const drop = pop.locator('.cp-types').getByRole('button', { name: /^Blend mode/ });
  await expect(drop).toBeEnabled();
  await drop.click();
  await expect(page.getByRole('menuitem')).toHaveCount(18);
  await expect(page.getByRole('menuitem', { name: 'Normal' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitem', { name: 'Multiply' }).click();
  await expect(pop).toBeVisible(); // choosing a mode does not close the picker
  await expect.poll(async () => (await node(page, rect.id)).fills[0].blendMode).toBe('MULTIPLY');
  expect((await node(page, rect.id)).blendMode).toBe('NORMAL'); // the layer itself is untouched
  await expect(pop.locator('.cp-types').getByRole('button', { name: 'Blend mode: Multiply' })).toHaveAttribute('aria-pressed', 'true');
  // the fill really blends: a red fill multiplied over the dark canvas stays dark instead of showing pure red
  await pop.getByLabel('Colour value').fill('FF0000'); await pop.getByLabel('Colour value').press('Enter');
  await page.waitForTimeout(150);
  const px = () => page.evaluate(() => { const c = document.querySelector('[data-testid=design-canvas]') as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(Math.round(c.width * 0.25), Math.round(c.height * 0.3), 1, 1).data; return [d[0], d[1], d[2]]; });
  const blended = await px();
  await pop.locator('.cp-types').getByRole('button', { name: /^Blend mode/ }).click();
  await page.getByRole('menuitem', { name: 'Normal' }).click();
  await expect.poll(async () => (await node(page, rect.id)).fills[0].blendMode).toBe('NORMAL');
  await page.waitForTimeout(150);
  const normal = await px();
  expect(normal[0]).toBeGreaterThan(blended[0] + 40); // normal shows bright red, multiply keeps it dark
  // strokes get the droplet too
  await pop.getByRole('button', { name: 'Close color picker' }).click();
  await page.getByRole('button', { name: 'Add stroke' }).click();
  await page.getByRole('button', { name: 'Open color picker' }).nth(1).click();
  const pop2 = page.getByRole('dialog', { name: 'Color picker' });
  await pop2.locator('.cp-types').getByRole('button', { name: /^Blend mode/ }).click();
  await page.getByRole('menuitem', { name: 'Screen' }).click();
  await expect.poll(async () => (await node(page, rect.id)).strokes[0]?.blendMode).toBe('SCREEN');
});
