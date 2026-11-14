import { expect, test } from '@playwright/test';
import { choose, drag, newFile, nodesOf, signup } from './helpers';

const SHOT = process.env.SHOT_DIR;

test('typography section and the type settings panel (basics, details, variable)', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('t'); await drag(page, 100, 120, 300, 200);
  await expect(page.locator('textarea.text-edit')).toBeFocused();
  await page.keyboard.type('Hello Layr and more words on a second line');
  await page.keyboard.press('Escape');
  const id = (await nodesOf(page, 'TEXT'))[0].id;
  const text = async () => (await nodesOf(page, 'TEXT'))[0].text;

  // compact section
  await expect(page.getByText('Typography', { exact: true })).toBeVisible();
  await choose(page.getByLabel('Font weight'), '600');
  expect((await text()).fontWeight).toBe(600);
  const size = page.getByTitle('Font size').locator('input'); await size.fill('24'); await size.press('Enter');
  expect((await text()).fontSize).toBe(24);
  await page.getByRole('button', { name: 'Font size presets' }).click();
  await page.getByRole('menuitem', { name: '32', exact: true }).click();
  expect((await text()).fontSize).toBe(32);
  const lh = page.getByTitle('Line height in px (0 = auto)').locator('input'); await lh.fill('40'); await lh.press('Enter');
  expect((await text()).lineHeight).toBe(40);
  await page.getByRole('button', { name: 'Align center' }).click();
  expect((await text()).align).toBe('CENTER');
  await page.getByRole('button', { name: 'Align middle' }).click();
  expect((await text()).vAlign).toBe('MIDDLE');
  await choose(page.getByLabel('Text resizing'), 'FIXED');

  // basics
  await page.getByRole('button', { name: 'Type settings' }).click();
  const pop = page.getByRole('dialog', { name: 'Type settings' });
  await expect(pop).toBeVisible();
  if (SHOT) await page.screenshot({ path: `${SHOT}/type-basics.png` });
  await pop.getByRole('button', { name: 'Justified' }).click(); expect((await text()).align).toBe('JUSTIFIED');
  await pop.getByRole('button', { name: 'Underline' }).click(); expect((await text()).decoration).toBe('UNDERLINE');
  await pop.getByRole('button', { name: 'Uppercase' }).click(); expect((await text()).textCase).toBe('UPPER');
  await pop.getByRole('button', { name: 'Bulleted list' }).click(); expect((await text()).listStyle).toBe('BULLET');
  const ps = pop.getByTitle('Paragraph spacing').locator('input'); await ps.fill('8'); await ps.press('Enter'); expect((await text()).paragraphSpacing).toBe(8);
  await pop.getByRole('button', { name: /Truncate with an ellipsis/ }).click(); expect((await text()).truncate).toBe(true);
  await choose(pop.getByLabel('Wrap style'), 'NONE'); expect((await text()).wrap).toBe('NONE');
  await pop.getByRole('button', { name: 'Trim to cap height' }).click(); expect((await text()).trim).toBe('CAP_HEIGHT');
  await page.waitForTimeout(400);
  if (SHOT) await page.getByTestId('design-canvas').screenshot({ path: `${SHOT}/type-canvas.png` });
  // undo the layout-changing options so the text stays readable for the rest
  await pop.getByRole('button', { name: 'No list' }).click(); await pop.getByRole('button', { name: 'Original case' }).first().click();
  await pop.getByRole('button', { name: 'No decoration' }).click();

  // the panel keeps the Basics height on the other tabs and can be dragged by its header
  const h0 = (await pop.boundingBox())!;
  await pop.getByRole('tab', { name: 'Details' }).click();
  expect(Math.abs((await pop.boundingBox())!.height - h0.height)).toBeLessThan(2);
  const bar = pop.locator('.ty-tabs'); const bb = (await bar.boundingBox())!;
  await page.mouse.move(bb.x + bb.width - 60, bb.y + 12); await page.mouse.down(); await page.mouse.move(bb.x + bb.width - 160, bb.y - 38, { steps: 5 }); await page.mouse.up();
  const h1 = (await pop.boundingBox())!;
  expect(Math.round(h0.x - h1.x)).toBeGreaterThan(60); expect(Math.round(h0.y - h1.y)).toBeGreaterThan(30);
  // details: OpenType flags are saved
  if (SHOT) await page.screenshot({ path: `${SHOT}/type-details.png` });
  await pop.getByRole('button', { name: 'Tabular figures: on' }).click();
  await pop.getByRole('button', { name: 'Kerning pairs: off' }).click();
  expect((await text()).features).toMatchObject({ tnum: true, kern: false });
  const indent = pop.getByTitle('Paragraph indent').locator('input'); await indent.fill('12'); await indent.press('Enter'); expect((await text()).paragraphIndent).toBe(12);

  // variable: weight + slant
  await pop.getByRole('tab', { name: 'Variable' }).click();
  expect(Math.abs((await pop.boundingBox())!.height - h0.height)).toBeLessThan(2);
  if (SHOT) await page.screenshot({ path: `${SHOT}/type-variable.png` });
  await pop.getByLabel('Weight slider').fill('700'); expect((await text()).fontWeight).toBe(700);
  await pop.getByLabel('Slant slider').fill('-8'); expect((await text()).slant).toBe(-8);
  await pop.getByRole('button', { name: 'Close type settings' }).click();
  await expect(pop).toBeHidden();
  void id;
});
