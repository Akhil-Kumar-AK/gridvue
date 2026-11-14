import { expect, test } from '@playwright/test';
import { doc, drag, newFile, nodesOf, signup } from './helpers';

test('layers drag and drop reparents (nest / un-nest)', async ({ page }) => {
  test.setTimeout(30_000);
  await signup(page); await newFile(page);
  await page.keyboard.press('f'); await drag(page, 60, 80, 460, 480);
  await page.keyboard.press('o'); await drag(page, 260, 140, 380, 260);
  await page.keyboard.press('f'); await drag(page, 700, 80, 800, 180); // second top-level frame (outside first)
  const [f1, f2] = await nodesOf(page, 'FRAME');
  const ell = (await nodesOf(page, 'ELLIPSE'))[0];
  expect(ell.parent).toBe(f1.id);
  const rows = page.locator('.layer');
  // list order is top→bottom: Frame(f2), Frame(f1), Ellipse(child of f1)
  await expect(rows).toHaveCount(3);
  const ellRow = rows.filter({ hasText: 'Ellipse' });
  const f2Row = rows.filter({ hasText: 'Frame' }).first();
  // drop in the middle of the other frame row => nest inside it
  await ellRow.dragTo(f2Row, { timeout: 5000 });
  expect((await doc(page)).nodes[ell.id].parent).toBe(f2.id);
  await page.keyboard.press('Meta+z');
  expect((await doc(page)).nodes[ell.id].parent).toBe(f1.id);

});
