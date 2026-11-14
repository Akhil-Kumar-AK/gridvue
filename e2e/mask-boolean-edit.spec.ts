import { expect, test } from '@playwright/test';
import { click, drag, newFile, nodesOf, signup } from './helpers';

const SHOT = process.env.SHOT_DIR;
/** canvas pixel (alpha-composited over the page colour) at canvas-relative coordinates */
const px = (page: any, x: number, y: number) => page.evaluate(([x, y]: number[]) => { const c = document.querySelector('[data-testid=design-canvas]') as HTMLCanvasElement; const d = c.width / c.getBoundingClientRect().width; return Array.from(c.getContext('2d')!.getImageData(x * d, y * d, 1, 1).data).slice(0, 3); }, [x, y]);
const lit = async (page: any, x: number, y: number) => (await px(page, x, y))[0] > 100;

test('mask, boolean operations, flatten and the edit-object bar from the properties panel', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('r'); await drag(page, 100, 100, 220, 200); // rectangle
  await page.keyboard.press('o'); await drag(page, 160, 140, 280, 250); // overlapping ellipse
  const rect = (await nodesOf(page, 'RECT'))[0], ell = (await nodesOf(page, 'ELLIPSE'))[0];

  // both selected → union, then change the operation on the same group
  await click(page, 110, 110); await click(page, 260, 195, { shift: true });
  await page.getByRole('button', { name: 'Boolean operations' }).click();
  if (SHOT) { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOT}/boolmenu.png` }); }
  await page.getByRole('menuitem', { name: /^Subtract/ }).click();
  const g1 = (await nodesOf(page, 'GROUP'))[0];
  expect(g1.boolOp).toBe('SUBTRACT'); expect(g1.children).toHaveLength(2);
  await page.waitForTimeout(400);
  expect(await lit(page, 120, 120)).toBe(true);   // rectangle only
  expect(await lit(page, 200, 190)).toBe(false);  // where the ellipse cuts it away
  expect(await lit(page, 260, 220)).toBe(false);  // ellipse only is not part of the result
  if (SHOT) await page.getByTestId('design-canvas').screenshot({ path: `${SHOT}/subtract.png` });
  await page.getByRole('button', { name: 'Boolean operations' }).click();
  await page.getByRole('menuitem', { name: /^Intersect/ }).click();
  expect((await nodesOf(page, 'GROUP'))[0].boolOp).toBe('INTERSECT');
  await page.waitForTimeout(400);
  expect(await lit(page, 120, 120)).toBe(false);
  expect(await lit(page, 200, 190)).toBe(true);   // only the overlap remains
  if (SHOT) await page.getByTestId('design-canvas').screenshot({ path: `${SHOT}/intersect.png` });
  await page.getByRole('button', { name: 'Boolean operations' }).click();
  await page.getByRole('menuitem', { name: /^Exclude/ }).click();
  await page.waitForTimeout(400);
  expect(await lit(page, 120, 120)).toBe(true);
  expect(await lit(page, 260, 220)).toBe(true);
  expect(await lit(page, 200, 190)).toBe(false);  // the overlap is removed
  if (SHOT) await page.getByTestId('design-canvas').screenshot({ path: `${SHOT}/exclude.png` });
  // flatten the group: one vector with the same outline, no group left
  await page.getByRole('button', { name: 'Boolean operations' }).click();
  await page.getByRole('menuitem', { name: /^Flatten/ }).click();
  await expect.poll(async () => (await nodesOf(page, 'GROUP')).length).toBe(0);
  const flat = (await nodesOf(page, 'VECTOR'))[0];
  expect(flat.path.points.length).toBeGreaterThan(8);
  await page.waitForTimeout(400);
  expect(await lit(page, 120, 120)).toBe(true);
  expect(await lit(page, 260, 220)).toBe(true);
  expect(await lit(page, 200, 190)).toBe(false);
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`);
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`);
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`);
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`);
  await expect.poll(async () => (await nodesOf(page, 'GROUP')).length).toBe(0);

  // mask: the rectangle masks the ellipse above it
  await click(page, 110, 110);
  await page.getByRole('button', { name: 'Mask selection', exact: true }).click();
  await expect.poll(async () => (await nodesOf(page, 'RECT'))[0].isMask).toBe(true);
  await page.waitForTimeout(400);
  expect(await lit(page, 120, 120)).toBe(false);  // the mask itself is not drawn
  expect(await lit(page, 260, 220)).toBe(false);  // masked layers are clipped to it
  expect(await lit(page, 200, 190)).toBe(true);
  if (SHOT) await page.getByTestId('design-canvas').screenshot({ path: `${SHOT}/mask.png` });
  await page.getByRole('button', { name: 'Mask selection', exact: true }).click();
  await expect.poll(async () => (await nodesOf(page, 'RECT'))[0].isMask).toBeFalsy();

  // edit object: a rectangle becomes a vector and the second bar appears
  await click(page, 110, 110);
  await page.getByRole('button', { name: 'Edit shape points' }).click();
  const bar = page.getByRole('toolbar', { name: 'Edit object' });
  await expect(bar).toBeVisible();
  if (SHOT) { await page.waitForTimeout(500); await page.screenshot({ path: `${SHOT}/editbar.png` }); }
  await expect.poll(async () => (await nodesOf(page, 'VECTOR')).length).toBe(1);
  for (const n of ['Move', 'Lasso', 'Paint', 'Bend', 'Cut', 'Erase', 'More']) await expect(bar.getByRole('button', { name: n })).toBeVisible();
  // erase one corner point
  const v = (await nodesOf(page, 'VECTOR'))[0];
  expect(v.path.points).toHaveLength(4);
  await bar.getByRole('button', { name: 'Erase' }).click();
  const b = await page.getByTestId('design-canvas').boundingBox();
  await page.mouse.click(b!.x + 100, b!.y + 100);
  await expect.poll(async () => (await nodesOf(page, 'VECTOR'))[0].path.points.length).toBe(3);
  // cut the outline: the closed path opens
  await bar.getByRole('button', { name: 'Cut' }).click();
  await page.mouse.click(b!.x + 160, b!.y + 200);
  await expect.poll(async () => (await nodesOf(page, 'VECTOR'))[0].path.closed).toBe(false);
  await bar.getByRole('button', { name: 'Done editing' }).click();
  await expect(bar).toBeHidden();
  void rect; void ell;
});
