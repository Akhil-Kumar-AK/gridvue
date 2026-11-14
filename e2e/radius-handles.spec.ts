import { expect, test } from '@playwright/test';
import { canvasBox, drag, newFile, nodesOf, signup } from './helpers';

const handle = (page: any, id: string, corner: number) => page.evaluate(({ id, corner }: any) => {
  const s = (window as any).__layr, c = (window as any).__editorCamera(), doc = s.store.doc, n = doc.nodes[id];
  let x = 0, y = 0; for (let cur = n; cur && cur.type !== 'PAGE'; cur = doc.nodes[cur.parent]) { x += cur.x; y += cur.y; }
  const r = Math.min((n.cornerRadii ? n.cornerRadii[corner] : n.cornerRadius), Math.min(n.width, n.height) / 2), off = 14 / c.zoom;
  const lx = corner === 0 || corner === 3 ? r + off : n.width - r - off, ly = corner < 2 ? r + off : n.height - r - off;
  return { x: (x + lx - c.x) * c.zoom, y: (y + ly - c.y) * c.zoom };
}, { id, corner });

test('corner radius handles appear inside a selected rectangle and drag the radius (alt = single corner)', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('r'); await drag(page, 100, 100, 340, 260);
  const rect = (await nodesOf(page, 'RECT'))[0];
  const b = await canvasBox(page);
  const node = () => page.evaluate((id: string) => structuredClone((window as any).__layr.store.doc.nodes[id]), rect.id);
  // drag the top-left handle diagonally inwards → uniform radius
  const h0 = await handle(page, rect.id, 0);
  await page.mouse.move(b.x + h0.x, b.y + h0.y); await page.mouse.down(); await page.mouse.move(b.x + h0.x + 30, b.y + h0.y + 30, { steps: 6 }); await page.mouse.up();
  const n1 = await node();
  expect(n1.cornerRadius).toBeGreaterThan(15); expect(n1.cornerRadii).toBeUndefined();
  // alt-drag the bottom-right handle → only that corner changes
  const h2 = await handle(page, rect.id, 2);
  await page.keyboard.down('Alt');
  await page.mouse.move(b.x + h2.x, b.y + h2.y); await page.mouse.down(); await page.mouse.move(b.x + h2.x - 40, b.y + h2.y - 40, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up('Alt');
  const n2 = await node();
  expect(n2.cornerRadii).toBeTruthy(); expect(n2.cornerRadii[2]).toBeGreaterThan(n2.cornerRadii[0]);
  // one undo reverts the whole drag; dragging all the way in clamps to half the short side
  await page.keyboard.press('Meta+z');
  expect((await node()).cornerRadii).toBeUndefined();
  const h = await handle(page, rect.id, 0);
  await page.mouse.move(b.x + h.x, b.y + h.y); await page.mouse.down(); await page.mouse.move(b.x + 400, b.y + 400, { steps: 8 }); await page.mouse.up();
  const n3 = await node(); expect(n3.cornerRadius).toBeCloseTo(Math.min(n3.width, n3.height) / 2, 0);
  // text layers do not show the handles (no cornerRadius): the rectangle's inspector shows the new value
  await expect(page.getByTitle('Corner radius').locator('input')).toHaveValue(String(Math.round(n3.cornerRadius * 100) / 100));
});
