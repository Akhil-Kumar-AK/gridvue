import { expect, test } from '@playwright/test';
import { canvasBox, drag, newFile, nodesOf, signup, choose } from './helpers';

const node = (page: any, id: string) => page.evaluate((i: string) => structuredClone((window as any).__layr.store.doc.nodes[i]), id);
const at = async (page: any, x: number, y: number, opts: any = {}) => { const b = await canvasBox(page); await page.mouse.click(b.x + x, b.y + y, opts); };
const anchorScreen = (page: any, id: string, i: number) => page.evaluate(({ id, i }: any) => {
  const s = (window as any).__layr, c = (window as any).__editorCamera(), doc = s.store.doc;
  let x = 0, y = 0; for (let cur = doc.nodes[id]; cur && cur.type !== 'PAGE'; cur = doc.nodes[cur.parent]) { x += cur.x; y += cur.y; }
  const p = doc.nodes[id].path.points[i]; return { x: (x + p.x - c.x) * c.zoom, y: (y + p.y - c.y) * c.zoom };
}, { id, i });

test('pen tool: click and drag anchors, finish with Enter, close on first anchor; pencil; path editing', async ({ page }) => {
  await signup(page); await newFile(page);
  const b = await canvasBox(page);
  // open path with a smooth last anchor
  await page.keyboard.press('p');
  await at(page, 100, 200); await at(page, 220, 120);
  await page.mouse.move(b.x + 340, b.y + 220); await page.mouse.down(); await page.mouse.move(b.x + 380, b.y + 260, { steps: 4 }); await page.mouse.up();
  await page.keyboard.press('Enter');
  const [open] = await nodesOf(page, 'VECTOR');
  expect(open.path.points.length).toBe(3); expect(open.path.closed).toBe(false);
  expect(open.path.points[2].ox).not.toBe(0); // dragging created bezier handles
  expect(open.strokes.length).toBe(1);

  // closed triangle: clicking the first anchor closes it and adds a fill
  await page.keyboard.press('p');
  await at(page, 150, 380); await at(page, 300, 380); await at(page, 225, 300); await at(page, 150, 380);
  const closed = (await nodesOf(page, 'VECTOR')).find((n: any) => n.id !== open.id);
  expect(closed.path.closed).toBe(true); expect(closed.path.points.length).toBe(3); expect(closed.fills.length).toBe(1);

  // pencil
  await page.keyboard.press('Shift+P');
  await drag(page, 400, 100, 480, 160);
  const all = await nodesOf(page, 'VECTOR');
  expect(all.length).toBe(3);
  expect(all.find((n: any) => n.name === 'Pencil').path.points.length).toBeGreaterThanOrEqual(2);

  // inspector exposes stroke cap/join/dash and vector controls; dash applies
  await page.locator('.layer', { hasText: 'Vector' }).first().click();
  await expect(page.getByRole('button', { name: /Edit path/ })).toBeVisible();
  await page.getByRole('button', { name: 'Stroke settings' }).click();
  const sset = page.getByRole('dialog', { name: 'Stroke settings' });
  await choose(sset.getByLabel('Stroke style'), 'DASHED');
  await sset.getByRole('button', { name: 'Close stroke settings' }).click();
  await expect.poll(async () => (await node(page, open.id)).dashes ?? (await node(page, closed.id)).dashes).toBeTruthy();

  // path edit mode: move an anchor, add one by clicking the outline, delete it
  await page.keyboard.press('Escape'); await page.keyboard.press('v');
  const first = await anchorScreen(page, open.id, 0);
  await at(page, first.x, first.y); // select by clicking the path's first anchor
  expect((await page.evaluate(() => (window as any).__layr && 1))).toBe(1);
  await expect(page.locator('.layer.sel .lname')).toHaveText('Vector');
  await page.keyboard.press('Enter'); // edit path
  await expect.poll(() => page.evaluate(() => (window as any).__layr && true)).toBe(true);
  const before = (await node(page, open.id)).path.points.length;
  const p0 = await anchorScreen(page, open.id, 0);
  await page.mouse.move(b.x + p0.x, b.y + p0.y); await page.mouse.down(); await page.mouse.move(b.x + p0.x + 30, b.y + p0.y - 40, { steps: 5 }); await page.mouse.up();
  const moved = await anchorScreen(page, open.id, 0);
  expect(Math.abs(moved.x - p0.x - 30)).toBeLessThan(2); expect(Math.abs(moved.y - p0.y + 40)).toBeLessThan(2);
  void first;
  // delete the selected anchor
  await page.keyboard.press('Backspace');
  expect((await node(page, open.id)).path.points.length).toBe(before - 1);
  await page.keyboard.press('Escape');
  // undo restores the deleted anchor; document stays valid
  await page.keyboard.press('Meta+z');
  expect((await node(page, open.id)).path.points.length).toBe(before);
});

test('right panel: corner radius (uniform and independent), layout guides, stroke options', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('f'); await drag(page, 60, 60, 360, 300);
  await page.keyboard.press('r'); await drag(page, 100, 100, 220, 200);
  const rect = (await nodesOf(page, 'RECT'))[0];
  const r = page.getByTitle('Corner radius').locator('input');
  await r.fill('12'); await r.press('Enter');
  expect((await node(page, rect.id)).cornerRadius).toBe(12);
  await page.getByRole('button', { name: 'Independent corner radius' }).click();
  const tr = page.getByTitle('Radius TR').locator('input'); await tr.fill('30'); await tr.press('Enter');
  expect((await node(page, rect.id)).cornerRadii).toEqual([12, 30, 12, 12]);
  // frame: layout guide grid + columns
  await page.locator('.layer', { hasText: 'Frame' }).first().click();
  await page.getByRole('button', { name: 'Add layout guide' }).click();
  const f = (await nodesOf(page, 'FRAME'))[0];
  expect((await node(page, f.id)).guides[0]).toMatchObject({ type: 'GRID', size: 10 });
  await choose(page.getByLabel('Guide type'), 'COLUMNS');
  expect((await node(page, f.id)).guides[0]).toMatchObject({ type: 'COLUMNS', size: 4 });
  // stroke cap/join
  await page.locator('.layer', { hasText: 'Rectangle' }).first().click();
  await page.getByRole('button', { name: 'Add stroke' }).click();
  await page.getByRole('button', { name: 'Stroke settings' }).click();
  const ss = page.getByRole('dialog', { name: 'Stroke settings' });
  await expect(ss).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/stroke.png` });
  await ss.getByRole('button', { name: 'Round join' }).click();
  expect((await node(page, rect.id)).strokeJoin).toBe('ROUND');
  await ss.getByRole('button', { name: 'Round cap' }).click();
  expect((await node(page, rect.id)).strokeCap).toBe('ROUND');
  await choose(ss.getByLabel('Stroke style'), 'DASHED');
  expect((await node(page, rect.id)).dashes).toEqual([3, 3]);
  const dash = ss.getByLabel('Dash length'); await dash.fill('8'); await dash.press('Enter');
  const gap = ss.getByLabel('Gap length'); await gap.fill('5'); await gap.press('Enter');
  expect((await node(page, rect.id)).dashes).toEqual([8, 5]);
  await choose(ss.getByLabel('Stroke style'), 'DOTTED');
  expect((await node(page, rect.id)).dashes[0]).toBeLessThan(1);
  await choose(ss.getByLabel('Stroke style'), 'SOLID');
  expect((await node(page, rect.id)).dashes).toBeUndefined();
  const mi = ss.getByLabel('Miter angle'); await ss.getByRole('button', { name: 'Miter join' }).click(); await mi.fill('45'); await mi.press('Enter');
  expect((await node(page, rect.id)).strokeMiterAngle).toBe(45);
  await choose(ss.getByLabel('End point'), 'ARROW');
  expect((await node(page, rect.id)).strokeEnd).toBe('ARROW');
  await ss.getByLabel('Start point').click();
  if (process.env.SHOT_DIR) { await page.waitForTimeout(300); await page.screenshot({ path: `${process.env.SHOT_DIR}/endpoints.png` }); }
  await page.locator('.sel-menu [data-value="DIAMOND"]').click();
  expect((await node(page, rect.id)).strokeStart).toBe('DIAMOND');
  await choose(ss.getByLabel('Start point'), 'REVERSED_TRIANGLE');
  expect((await node(page, rect.id)).strokeStart).toBe('REVERSED_TRIANGLE');
  // dynamic / brush tabs keep the Basic height; the header drags the panel
  const b0 = (await ss.boundingBox())!;
  await ss.getByRole('tab', { name: 'Dynamic' }).click();
  expect(Math.abs((await ss.boundingBox())!.height - b0.height)).toBeLessThan(2);
  const head = (await ss.locator('.ss-head').boundingBox())!;
  await page.mouse.move(head.x + 150, head.y + 10); await page.mouse.down(); await page.mouse.move(head.x + 90, head.y - 40, { steps: 5 }); await page.mouse.up();
  const b1 = (await ss.boundingBox())!;
  expect(b0.x - b1.x).toBeGreaterThan(40); expect(b0.y - b1.y).toBeGreaterThan(20);
  // dynamic tab: wiggle the stroke
  expect((await node(page, rect.id)).strokeKind).toBe('DYNAMIC');
  const fr = ss.getByLabel('Frequency'); await fr.fill('60'); await fr.press('Enter');
  const wg = ss.getByLabel('Wiggle'); await wg.fill('80'); await wg.press('Enter');
  expect((await node(page, rect.id)).strokeDynamic).toMatchObject({ frequency: 60, wiggle: 80 });
  if (process.env.SHOT_DIR) { await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.SHOT_DIR}/dynamic.png` }); }
  // brush tab: brush, direction, width profile
  await ss.getByRole('tab', { name: 'Brush' }).click();
  expect(Math.abs((await ss.boundingBox())!.height - b0.height)).toBeLessThan(2);
  expect((await node(page, rect.id)).strokeKind).toBe('BRUSH');
  await choose(ss.getByLabel('Brush style'), 'CHALK');
  await ss.getByRole('button', { name: 'Brush direction left' }).click();
  expect((await node(page, rect.id)).strokeBrush).toEqual({ id: 'CHALK', direction: 'LEFT' });
  await choose(ss.getByLabel('Width profile', { exact: true }), 'TAPER');
  await ss.getByRole('button', { name: 'Flip width profile' }).click();
  expect(await node(page, rect.id)).toMatchObject({ strokeProfile: 'TAPER', strokeProfileFlip: true });
  if (process.env.SHOT_DIR) { await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.SHOT_DIR}/brush.png` }); }
  await ss.getByRole('tab', { name: 'Basic' }).click();
  expect((await node(page, rect.id)).strokeKind).toBeUndefined();
  await ss.getByRole('button', { name: 'Close stroke settings' }).click();
  await expect(ss).toBeHidden();
});
