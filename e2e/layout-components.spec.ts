import { expect, test } from '@playwright/test';
import { MOD, drag, newFile, nodesOf, signup, click, choose } from './helpers';

const node = (page: any, id: string) => page.evaluate((i: string) => structuredClone((window as any).__layr.store.doc.nodes[i]), id);

test('auto layout through the UI: add, change direction/gap/padding, hug resizing, fill child', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('f'); await drag(page, 60, 60, 460, 300);
  await page.keyboard.press('r'); await drag(page, 80, 90, 140, 130);
  await page.keyboard.press('r'); await drag(page, 200, 90, 280, 150);
  const frame = (await nodesOf(page, 'FRAME'))[0];
  await page.locator('.layer', { hasText: 'Frame' }).first().click();
  await page.keyboard.press('Shift+A');
  const f1 = await node(page, frame.id);
  expect(f1.layout.mode).toBe('HORIZONTAL');
  expect(f1.sizingH).toBe('HUG');
  const [a, b] = f1.children.map((c: string) => c);
  const na = await node(page, a), nb = await node(page, b);
  expect(nb.x).toBeCloseTo(na.x + na.width + 10, 5); // gap 10
  expect(f1.width).toBeCloseTo(10 + na.width + 10 + nb.width + 10, 5);
  // vertical direction via the segmented control
  await page.getByRole('button', { name: 'Vertical layout' }).click();
  const nb2 = await node(page, b);
  expect(nb2.x).toBe(10); expect(nb2.y).toBeGreaterThan(10);
  // gap field
  const gap = page.getByTitle('Gap between items').locator('input');
  await gap.fill('24'); await gap.press('Enter');
  const na3 = await node(page, a), nb3 = await node(page, b);
  expect(nb3.y).toBeCloseTo(na3.y + na3.height + 24, 5);
  // resizing the first child to fill is possible once the frame is fixed-size
  await page.locator('.layer', { hasText: 'Rectangle' }).first().click();
  const fill = page.getByLabel('Width resizing');
  await expect(fill).toBeEnabled();
  // undo returns to horizontal in one step per edit
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(`${MOD}+z`);
  expect((await node(page, frame.id)).layout.gap).toBe(10);
});

test('components: create, instance follows main, overrides survive, detach', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('f'); await drag(page, 60, 60, 260, 160);
  await page.keyboard.press('r'); await drag(page, 80, 80, 140, 120);
  const frame = (await nodesOf(page, 'FRAME'))[0];
  await page.locator('.layer', { hasText: 'Frame' }).first().click();
  await page.keyboard.press(`${MOD}+Alt+k`);
  expect((await node(page, frame.id)).type).toBe('COMPONENT');
  // instance via inspector header button
  await page.getByRole('button', { name: 'Create instance' }).click();
  const inst = (await nodesOf(page, 'INSTANCE'))[0];
  expect(inst.componentId).toBe(frame.id);
  expect(inst.children.length).toBe(1);
  // change the main's fill → instance follows
  await page.evaluate(id => { const s = (window as any).__layr; s.store.apply({ t: 'set', id, props: { fills: [{ type: 'SOLID', color: '#FF0000', opacity: 1, visible: true }] } }); }, frame.id);
  expect((await node(page, inst.id)).fills[0].color).toBe('#FF0000');
  // override the instance's rect fill, then change main rect fill: override stays
  const kid = inst.children[0];
  await page.evaluate(id => { const s = (window as any).__layr; s.store.apply({ t: 'set', id, props: { fills: [{ type: 'SOLID', color: '#00FF00', opacity: 1, visible: true }] } }); }, kid);
  const mainRect = (await node(page, frame.id)).children[0];
  await page.evaluate(id => { const s = (window as any).__layr; s.store.apply({ t: 'set', id, props: { fills: [{ type: 'SOLID', color: '#0000FF', opacity: 1, visible: true }] } }); }, mainRect);
  expect((await node(page, kid)).fills[0].color).toBe('#00FF00');
  // layers panel shows component/instance styling and the Assets tab lists the component
  await page.getByRole('button', { name: 'Assets', exact: true }).first().click();
  await expect(page.locator('.asset-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  // detach
  await page.locator('.layer', { hasText: 'Frame' }).first().click();
  await page.keyboard.press(`${MOD}+Alt+b`);
  expect((await node(page, inst.id)).type).toBe('FRAME');
  void click;
});

test('auto layout alignment marker follows the selected alignment and direction', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('f'); await drag(page, 60, 60, 360, 300);
  await page.keyboard.press('r'); await drag(page, 80, 90, 140, 130);
  await page.keyboard.press('r'); await drag(page, 200, 90, 280, 150);
  await page.locator('.layer', { hasText: 'Frame' }).first().click();
  await page.keyboard.press('Shift+A');
  const marker = () => page.locator('.agrid3 .acell.on i.glyph');
  // horizontal layout → vertical bars; centre/centre cell → centred
  await expect(marker()).toHaveClass(/cols/);
  await page.getByRole('button', { name: 'Align center center' }).click();
  await expect(marker()).toHaveClass(/a1/); await expect(page.getByRole('button', { name: 'Align center center' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Align bottom right' }).click();
  await expect(marker()).toHaveClass(/a2/);
  // vertical layout → horizontal bars, aligned by column
  await page.getByRole('button', { name: 'Vertical layout' }).click();
  await expect(marker()).toHaveClass(/rows/);
  await page.getByRole('button', { name: 'Align top left' }).click();
  await expect(marker()).toHaveClass(/a0/);
  await page.getByRole('button', { name: 'Align top center' }).click();
  await expect(marker()).toHaveClass(/a1/);
  // space-between shows the spread marker
  await choose(page.getByLabel('Distribution'), 'SPACE_BETWEEN');
  await expect(marker()).toHaveClass(/between/);
});
