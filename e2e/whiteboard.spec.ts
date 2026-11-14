import { expect, test, type Page } from '@playwright/test';
import { signup } from './helpers';

const board = (page: Page) => page.evaluate(() => structuredClone((window as any).__jam.store.board));
const items = async (page: Page, kind?: string) => Object.values((await board(page)).items as Record<string, any>).filter((i: any) => !kind || i.kind === kind) as any[];
const cbox = async (page: Page) => (await page.getByTestId('jam-canvas').boundingBox())!;
async function at(page: Page, x: number, y: number) { const b = await cbox(page); return { x: b.x + x, y: b.y + y }; }
async function click(page: Page, x: number, y: number) { const p = await at(page, x, y); await page.mouse.click(p.x, p.y); }
async function drag(page: Page, x1: number, y1: number, x2: number, y2: number) { const a = await at(page, x1, y1), b = await at(page, x2, y2); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up(); }
const tool = (page: Page, name: string) => page.getByRole('toolbar', { name: 'Whiteboard tools' }).getByRole('button', { name, exact: true });
async function newBoard(page: Page) {
  await signup(page);
  await page.getByRole('button', { name: 'New whiteboard' }).first().click();
  await expect(page.getByTestId('jam-canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__jam?.api);
  await page.waitForTimeout(150);
}
const saved = (page: Page) => expect(page.locator('.jam-save')).toHaveText('Saved', { timeout: 10_000 });

test('dashboard offers whiteboards and no longer shows Slides', async ({ page }) => {
  await signup(page);
  await expect(page.getByRole('button', { name: 'New whiteboard' }).first()).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Slides' })).toHaveCount(0);
  await page.getByRole('button', { name: 'New whiteboard' }).first().click();
  await expect(page.getByTestId('jam-editor')).toBeVisible();
  await page.getByRole('button', { name: 'Back to files' }).click();
  await page.getByRole('tablist', { name: 'Open files' }).getByRole('button', { name: 'Home' }).click();
  await expect(page.locator('.hcard').first()).toContainText('Untitled whiteboard');
  await page.getByRole('button', { name: 'Whiteboards' }).click();
  await expect(page.locator('.hcard')).toHaveCount(1);
});

test('sidebar: only All files, Designs, Design systems and Whiteboards; each filters by type and All shows everything', async ({ page }) => {
  await signup(page);
  const nav = page.getByRole('navigation', { name: 'Files' });
  await expect(nav.getByRole('button')).toHaveText([/^All files\d+$/, /^Designs\d+$/, /^Design systems\d+$/, /^Whiteboards\d+$/]);
  // one of each type
  await page.getByRole('button', { name: 'New whiteboard' }).first().click(); await page.waitForFunction(() => !!(window as any).__jam?.api);
  await page.getByRole('tablist', { name: 'Open files' }).getByRole('button', { name: 'Home' }).click();
  await page.locator('.hmain').getByRole('button', { name: 'New design file' }).click(); await page.waitForFunction(() => !!(window as any).__layr);
  await page.getByRole('tablist', { name: 'Open files' }).getByRole('button', { name: 'Home' }).click();
  await page.locator('.hmain').getByRole('button', { name: 'New design system' }).click();
  await page.getByRole('tablist', { name: 'Open files' }).getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'All files' })).toBeVisible();
  await expect(page.locator('.hcard')).toHaveCount(3);
  await nav.getByRole('button', { name: 'Designs', exact: true }).click(); await expect(page.locator('.hcard')).toHaveCount(1); await expect(page.locator('.hcard .tchip')).toHaveText('Design');
  await nav.getByRole('button', { name: 'Design systems' }).click(); await expect(page.locator('.hcard')).toHaveCount(1); await expect(page.locator('.hcard .tchip')).toHaveText('Design system');
  await nav.getByRole('button', { name: 'Whiteboards' }).click(); await expect(page.locator('.hcard')).toHaveCount(1); await expect(page.locator('.hcard .tchip')).toHaveText('Whiteboard');
  await nav.getByRole('button', { name: 'All files' }).click(); await expect(page.locator('.hcard')).toHaveCount(3);
});

test('sticky, text, shape, connector, pen, section, table, undo and persistence', async ({ page }) => {
  await newBoard(page);
  // sticky: pick the tool, click, type
  await tool(page, 'Sticky note').click();
  await click(page, 300, 250);
  await page.keyboard.type('Hello jam');
  await page.keyboard.press('Escape');
  let st = await items(page, 'sticky'); expect(st).toHaveLength(1); expect(st[0].text).toBe('Hello jam');
  // shape by dragging
  await tool(page, 'Shape').click(); await page.getByRole('toolbar', { name: 'Shapes and connectors' }).getByRole('button', { name: 'Shape rect' }).click();
  await drag(page, 600, 200, 760, 300);
  await page.keyboard.type('Box'); await page.keyboard.press('Escape');
  const shapes = await items(page, 'shape'); expect(shapes).toHaveLength(1); expect(shapes[0].w).toBeGreaterThan(100); expect(shapes[0].text).toBe('Box');
  // connector sticky -> shape attaches both ends
  await tool(page, 'Shape').click(); await page.getByRole('button', { name: 'Connector elbow', exact: true }).click();
  await drag(page, 330, 250, 680, 250);
  const cons = await items(page, 'connector'); expect(cons).toHaveLength(1);
  expect(cons[0].from.id).toBe(st[0].id); expect(cons[0].to.id).toBe(shapes[0].id);
  // moving the sticky keeps the connector attached (ends reference ids)
  await page.keyboard.press('v'); await click(page, 300, 250); await page.keyboard.press('Shift+ArrowDown'); // nudge 20
  expect((await items(page, 'sticky'))[0].y).toBe(st[0].y + 20);
  // pen stroke
  await page.keyboard.press('p'); await drag(page, 300, 500, 500, 560);
  const strokes = await items(page, 'stroke'); expect(strokes).toHaveLength(1); expect(strokes[0].pts.length).toBeGreaterThan(4);
  // table + section
  await page.keyboard.press('b'); await click(page, 800, 500);
  expect(await items(page, 'table')).toHaveLength(1);
  await page.keyboard.press('Shift+S'); await drag(page, 150, 120, 450, 330); await page.keyboard.type('Ideas'); await page.keyboard.press('Escape');
  const secs = await items(page, 'section'); expect(secs).toHaveLength(1); expect(secs[0].text).toBe('Ideas');
  // undo twice removes the section then the table; redo brings the table back
  for (let i = 0; i < 3; i++) await page.keyboard.press('ControlOrMeta+z'); // rename, section, table
  expect((await items(page)).filter(i => i.kind === 'section' || i.kind === 'table')).toHaveLength(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await items(page, 'table')).toHaveLength(1);
  // persists across reload
  await saved(page);
  await page.reload(); await page.waitForFunction(() => !!(window as any).__jam);
  expect((await items(page)).map(i => i.kind).sort()).toEqual(['connector', 'shape', 'sticky', 'stroke', 'table']);
});

test('templates, voting, comments and the context toolbar', async ({ page }) => {
  await newBoard(page);
  await tool(page, 'More').click(); await page.getByRole('menuitem', { name: 'Templates…' }).click();
  await page.getByRole('button', { name: /Retrospective/ }).click();
  expect((await items(page, 'section')).length).toBe(3);
  await page.waitForTimeout(300);
  const stickies = await items(page, 'sticky'); expect(stickies.length).toBe(3);
  expect(stickies.every(s => !!s.parent)).toBe(true);
  // context bar appears for the selection and recolours the sticky
  const s0 = stickies[0]; const sp0 = await page.evaluate(([x, y]) => (window as any).__jam.api.worldToScreen({ x, y }), [s0.x + 40, s0.y + 40]);
  await click(page, sp0.x, sp0.y);
  await page.getByRole('button', { name: 'Sticky colour' }).first().click();
  await page.getByRole('option', { name: 'Sticky colour #c9a7ff' }).click();
  expect((await items(page, 'sticky')).some(s => s.color === '#c9a7ff')).toBe(true);
  // voting: start a session, then vote on a sticky
  await page.getByRole('button', { name: 'Timer, music and voting' }).click();
  await page.getByRole('button', { name: 'New vote' }).click();
  await page.keyboard.press('n'); await click(page, sp0.x, sp0.y); await click(page, sp0.x, sp0.y);
  expect(Object.values((await items(page, 'sticky')).find(s => s.id === s0.id).votes)[0]).toBe(2);
  await page.keyboard.down('Alt'); await click(page, sp0.x, sp0.y); await page.keyboard.up('Alt');
  expect(Object.values((await items(page, 'sticky')).find(s => s.id === s0.id).votes ?? {})[0]).toBe(1);
  // comments: the C tool opens a composer
  await page.keyboard.press('c'); await click(page, 120, 130);
  await page.getByLabel('Comment text').fill('Looks good'); await page.locator('.jm-thread').getByRole('button', { name: 'Comment', exact: true }).click();
  expect((await board(page)).comments).toHaveLength(1);
  await saved(page);
});

test('exports a PNG and reads a pasted link as a card', async ({ page, context }) => {
  await newBoard(page);
  await tool(page, 'Sticky note').click(); await click(page, 400, 300); await page.keyboard.type('Export me'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Board menu' }).click(); await page.getByRole('menuitem', { name: 'Export…' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Whole board as PNG' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.png$/);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('timer, music and voting panel', async ({ page }) => {
  await newBoard(page);
  await page.getByRole('button', { name: 'Timer, music and voting' }).click();
  const panel = page.getByRole('dialog', { name: 'Timer, music and voting' });
  await expect(panel.getByRole('img', { name: '04:00' })).toBeVisible();
  await panel.getByRole('button', { name: 'Add one minute' }).click();
  await expect(panel.getByRole('img', { name: '05:00' })).toBeVisible();
  await panel.getByRole('button', { name: 'Start timer' }).click();
  await expect(panel.getByRole('button', { name: 'Pause timer' })).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(panel.getByRole('img', { name: /04:5[0-9]/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Pause timer' }).click();
  await panel.getByRole('button', { name: 'Reset timer' }).click();
  await expect(panel.getByRole('img', { name: '05:00' })).toBeVisible();
  await panel.getByRole('button', { name: 'Play music' }).click();
  await expect(panel.getByRole('button', { name: 'Pause music' })).toBeVisible();
  await panel.getByRole('button', { name: 'Pause music' }).click();
  await page.screenshot({ path: '/tmp/tmv.png' });
  await panel.getByRole('button', { name: 'New vote' }).click();
  expect((await board(page)).voting.active).toBe(true);
});

test('side plus handles duplicate the item without a connector; dragging one draws a connector', async ({ page }) => {
  await newBoard(page);
  await tool(page, 'Sticky note').click(); await click(page, 300, 250); await page.keyboard.type('One'); await page.keyboard.press('Escape');
  const s0 = (await items(page, 'sticky'))[0];
  const plus = await page.evaluate(([x, y, w, h]) => (window as any).__jam.api.worldToScreen({ x: x + w + 26, y: y + h / 2 }), [s0.x, s0.y, s0.w, s0.h]);
  await click(page, plus.x, plus.y);
  const st = await items(page, 'sticky'); expect(st).toHaveLength(2); expect(await items(page, 'connector')).toHaveLength(0);
  expect(st[1].x).toBeGreaterThan(s0.x + s0.w); expect(st[1].y).toBe(s0.y); expect(st[1].color).toBe(s0.color);
  await page.keyboard.press('Escape');
  // drag from the bottom plus of the first sticky into empty space: a connector, no new sticky
  await click(page, 300, 250);
  const down = await page.evaluate(([x, y, w, h]) => (window as any).__jam.api.worldToScreen({ x: x + w / 2, y: y + h + 26 }), [s0.x, s0.y, s0.w, s0.h]);
  await drag(page, down.x, down.y, down.x, down.y + 140);
  expect(await items(page, 'connector')).toHaveLength(1); expect(await items(page, 'sticky')).toHaveLength(2);
});

test('Tab on a sticky adds a connected sticky with a flow line', async ({ page }) => {
  await newBoard(page);
  await tool(page, 'Sticky note').click(); await click(page, 300, 250); await page.keyboard.type('A'); await page.keyboard.press('Tab'); await page.keyboard.type('B'); await page.keyboard.press('Escape');
  const st = await items(page, 'sticky'); expect(st.map(i => i.text)).toEqual(['A', 'B']);
  const c = await items(page, 'connector'); expect(c).toHaveLength(1); expect(c[0].from.id).toBe(st[0].id); expect(c[0].to.id).toBe(st[1].id);
});

test('stamp wheel: pick a stamp, place it, and choose any emoji from the picker', async ({ page }) => {
  await newBoard(page);
  await tool(page, 'Stamp').click();
  const wheel = page.getByRole('toolbar', { name: 'Stamps' });
  await expect(wheel).toBeVisible();
  await wheel.getByRole('button', { name: 'Stamp star' }).click();
  await expect(wheel).toHaveCount(0);
  await click(page, 300, 250); await click(page, 420, 250);
  let em = await items(page, 'emoji'); expect(em.map(e => e.emoji)).toEqual(['⭐', '⭐']);
  await tool(page, 'Stamp').click();
  await page.getByRole('toolbar', { name: 'Stamps' }).getByRole('button', { name: 'Stamp plus one' }).click();
  await click(page, 540, 250);
  await tool(page, 'Stamp').click();
  await page.getByRole('button', { name: 'More emoji' }).click();
  const pop = page.getByRole('dialog', { name: 'Emoji picker' });
  await expect(pop).toBeVisible();
  await pop.getByLabel('Search emoji').fill('rocket');
  await pop.getByRole('button', { name: /Emoji rocket/ }).click();
  await click(page, 660, 250);
  em = await items(page, 'emoji'); expect(em.map(e => e.emoji)).toEqual(['⭐', '⭐', '+1', '🚀']);
  await tool(page, 'Stamp').click();
  const w2 = page.getByRole('toolbar', { name: 'Stamps' });
  await w2.getByRole('button', { name: 'Stamp me' }).click(); await click(page, 780, 250);
  expect((await items(page, 'emoji')).pop().emoji).toBe('@E');
});

test('an emptied whiteboard drops its stale dashboard preview', async ({ page }) => {
  await newBoard(page);
  await tool(page, 'Sticky note').click(); await click(page, 300, 250); await page.keyboard.type('x'); await page.keyboard.press('Escape');
  await expect.poll(async () => (await page.evaluate(async () => (await (await fetch('/api/files')).json()).files[0].hasThumbnail)), { timeout: 12_000 }).toBe(true);
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('Delete');
  await expect.poll(async () => (await page.evaluate(async () => (await (await fetch('/api/files')).json()).files[0].hasThumbnail)), { timeout: 12_000 }).toBe(false);
});
