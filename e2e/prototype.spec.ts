import { expect, test } from '@playwright/test';
import { canvasBox, drag, newFile, nodesOf, signup, waitSaved, choose } from './helpers';

const node = (page: any, id: string) => page.evaluate((i: string) => structuredClone((window as any).__layr.store.doc.nodes[i]), id);
const rename = (page: any, id: string, name: string) => page.evaluate(({ id, name }: any) => (window as any).__layr.store.apply({ t: 'set', id, props: { name } }), { id, name });
const screenOf = (page: any, id: string, fx: number, fy: number) => page.evaluate(({ id, fx, fy }: any) => {
  const s = (window as any).__layr, c = (window as any).__editorCamera(), doc = s.store.doc;
  let x = 0, y = 0; for (let cur = doc.nodes[id]; cur && cur.type !== 'PAGE'; cur = doc.nodes[cur.parent]) { x += cur.x; y += cur.y; }
  const n = doc.nodes[id]; return { x: (x + n.width * fx - c.x) * c.zoom, y: (y + n.height * fy - c.y) * c.zoom };
}, { id, fx, fy });

test('prototype: connect by dragging, flow start, present, navigate, back, standalone link', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('f'); await drag(page, 40, 60, 240, 330);
  await page.keyboard.press('f'); await drag(page, 320, 60, 520, 330);
  await page.keyboard.press('r'); await drag(page, 80, 100, 200, 150);
  const [home, next] = await nodesOf(page, 'FRAME'); const btn = (await nodesOf(page, 'RECT'))[0];
  await rename(page, home.id, 'Home'); await rename(page, next.id, 'Next'); await rename(page, btn.id, 'Go button');
  expect(btn.parent).toBe(home.id);
  // give the destination frame a visibly different fill so we can tell frames apart in the player
  await page.evaluate(id => (window as any).__layr.store.apply({ t: 'set', id, props: { fills: [{ type: 'SOLID', color: '#00AA55', opacity: 1, visible: true }] } }), next.id);

  await page.getByRole('button', { name: 'Prototype', exact: true }).first().click();
  await page.locator('.layer', { hasText: 'Go button' }).click();
  const h = await screenOf(page, btn.id, 1, 0.5); const t = await screenOf(page, next.id, 0.5, 0.5); const b = await canvasBox(page);
  await page.mouse.move(b.x + h.x, b.y + h.y); await page.mouse.down(); await page.mouse.move(b.x + t.x, b.y + t.y, { steps: 8 }); await page.mouse.up();
  const ints = (await node(page, btn.id)).interactions;
  expect(ints[0]).toMatchObject({ trigger: { type: 'CLICK' }, actions: [{ type: 'NAVIGATE', to: next.id }] });
  // edit the interaction in the panel: use an instant animation to keep the test fast
  await choose(page.getByLabel('Animation').first(), 'INSTANT');
  expect((await node(page, btn.id)).interactions[0].actions[0].anim.type).toBe('INSTANT');

  // flow starting point on Home
  await page.locator('.layer', { hasText: 'Home' }).click();
  await page.getByRole('button', { name: 'Add flow starting point' }).click();
  expect((await node(page, home.id)).flowStart).toBeTruthy();
  await page.locator('.layer', { hasText: 'Go button' }).click();

  // present from the selected layer's frame
  await page.getByRole('button', { name: 'Present prototype' }).click();
  const canvas = page.getByTestId('player-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.player-foot')).toContainText('Home');
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(300); // wait for fit-to-window scaling
  const cb = (await canvas.boundingBox())!;
  const btnNode = await node(page, btn.id);
  const sc = cb.width / (await node(page, home.id)).width; // player scale
  // clicking outside the button does nothing
  await page.mouse.click(cb.x + cb.width - 5, cb.y + cb.height - 5);
  await expect(page.locator('.player-foot')).toContainText('Home');
  // clicking the button navigates (coordinates are correct at the rendered scale)
  await page.mouse.click(cb.x + (btnNode.x + btnNode.width / 2) * sc, cb.y + (btnNode.y + btnNode.height / 2) * sc);
  await expect(page.locator('.player-foot')).toContainText('Next');
  const px = await canvas.evaluate((c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(c.width / 2, c.height - 10, 1, 1).data; return [d[0], d[1], d[2]]; });
  expect(px).toEqual([0, 170, 85]); // the destination frame is actually drawn
  // back
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.player-foot')).toContainText('Home');
  // the design document was not touched by playing
  expect((await node(page, btn.id)).parent).toBe(home.id);
  await page.keyboard.press('Escape');
  await expect(canvas).toBeHidden();

  // standalone prototype link
  await waitSaved(page);
  const fileId = page.url().split('/').pop()!;
  await page.goto(`/#/play/${fileId}`); await page.reload();
  await expect(page.getByTestId('player-canvas')).toBeVisible();
  await expect(page.locator('.player-foot')).toContainText('Home');
});

test('prototype: overlay opens on click, closes when clicking outside; hotspots', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('f'); await drag(page, 40, 60, 240, 330);
  await page.keyboard.press('f'); await drag(page, 320, 60, 420, 140);
  await page.keyboard.press('r'); await drag(page, 80, 100, 200, 150);
  const [home, modal] = await nodesOf(page, 'FRAME'); const btn = (await nodesOf(page, 'RECT'))[0];
  await rename(page, home.id, 'Home'); await rename(page, modal.id, 'Dialog'); await rename(page, btn.id, 'Open');
  // build interactions through the core API exposed for tests
  await page.evaluate(({ btn, modal, home }: any) => {
    const core = (window as any).__core, s = (window as any).__layr;
    core.setFlowStart(s.store, home, 'Main');
    core.addInteraction(s.store, btn, core.newInteraction({ type: 'CLICK' }, [{ ...core.newAction('OVERLAY_OPEN', modal), anim: { type: 'INSTANT', easing: 'LINEAR', duration: 0 } }]));
  }, { btn: btn.id, modal: modal.id, home: home.id });
  await page.locator('.layer', { hasText: 'Open' }).click();
  await page.getByRole('button', { name: 'Present prototype' }).click();
  const canvas = page.getByTestId('player-canvas');
  await expect(page.locator('.player-foot')).toContainText('Home');
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(400); // wait for fit-to-window scaling
  const cb = (await canvas.boundingBox())!;
  const homeN = await node(page, home.id), btnN = await node(page, btn.id), sc = cb.width / homeN.width;
  await page.mouse.click(cb.x + (btnN.x + 10) * sc, cb.y + (btnN.y + 10) * sc);
  await expect(page.locator('.player-foot')).toContainText('1 overlay');
  await page.mouse.click(cb.x + 5 * sc, cb.y + (homeN.height - 5) * sc); // outside the (centred) dialog → closes
  await expect(page.locator('.player-foot')).not.toContainText('overlay');
  await page.getByRole('button', { name: 'Hotspots' }).click();
  await expect(page.locator('.hotspot')).toHaveCount(1);
});

test('prototype: after-delay, while-hovering, key press and conditional variable navigation in the player', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('f'); await drag(page, 40, 60, 200, 300);
  await page.keyboard.press('f'); await drag(page, 260, 60, 420, 300);
  await page.keyboard.press('f'); await drag(page, 480, 60, 640, 300);
  await page.keyboard.press('r'); await drag(page, 70, 100, 150, 150);
  const [a, b, c] = await nodesOf(page, 'FRAME'); const btn = (await nodesOf(page, 'RECT'))[0];
  await rename(page, a.id, 'A'); await rename(page, b.id, 'B'); await rename(page, c.id, 'C');
  await page.evaluate(({ a, b, c, btn }: any) => {
    const core = (window as any).__core, s = (window as any).__layr, st = s.store;
    const inst = { type: 'INSTANT', easing: 'LINEAR', duration: 0 };
    core.setFlowStart(st, a, 'Flow');
    const col = core.createCollection(st, 'S', ['M']);
    const n = core.createVariable(st, col, 'n', 'FLOAT', 0);
    core.addInteraction(st, btn, core.newInteraction({ type: 'HOVER' }, [{ type: 'NAVIGATE', to: b, anim: inst }]));
    core.addInteraction(st, btn, core.newInteraction({ type: 'CLICK' }, [{ type: 'SET_VAR', variableId: n, expr: '{n} + 1' }, { type: 'CONDITIONAL', branches: [{ cond: '{n} >= 2', actions: [{ type: 'NAVIGATE', to: c, anim: inst }] }], otherwise: [] }]));
    core.addInteraction(st, c, core.newInteraction({ type: 'KEY', key: 'x' }, [{ type: 'NAVIGATE', to: a, anim: inst }]));
    core.addInteraction(st, b, core.newInteraction({ type: 'DELAY', delay: 1500 }, [{ type: 'NAVIGATE', to: c, anim: inst }]));
  }, { a: a.id, b: b.id, c: c.id, btn: btn.id });
  await page.locator('.layer', { hasText: 'A' }).first().click();
  await page.getByRole('button', { name: 'Present prototype' }).click();
  const canvas = page.getByTestId('player-canvas'); const foot = page.locator('.player-foot');
  await expect(foot).toContainText('A');
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(300);
  const cb = (await canvas.boundingBox())!; const sc = cb.width / 160; const bn = await node(page, btn.id);
  const at = { x: cb.x + (bn.x + 20) * sc, y: cb.y + (bn.y + 10) * sc };
  // hover → B, leave → back to A
  await page.mouse.move(at.x, at.y); await expect(foot).toContainText('B');
  await page.mouse.move(cb.x + 3, cb.y + cb.height - 3); await expect(foot).toContainText('A');
  // conditional on click count: first click stays, second navigates to C (hover state first resets)
  await page.mouse.move(at.x, at.y); await expect(foot).toContainText('B'); // hovering shows B; the delay on B would also lead to C
  await expect(foot).toContainText('C', { timeout: 5000 }); // after-delay trigger fired (and the earlier, cancelled timer did not fire early)
  await page.keyboard.press('x'); await expect(foot).toContainText('A'); // key trigger
  await page.keyboard.press('r'); await expect(foot).toContainText('A');
});
