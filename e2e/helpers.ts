import { expect, type Locator, type Page } from '@playwright/test';

let counter = 0;
export const uniqueEmail = (p = 'u') => `${p}${Date.now()}${counter++}@e2e.test`;

/** Name-only sign-in. Each call uses a fresh unique name unless one is passed, so tests start with an empty workspace. Returns the name. */
export async function signup(page: Page, _email?: string, name = `E2E ${Date.now().toString(36)}${counter++}`) {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: /New design file/ }).first()).toBeVisible();
  return name;
}

export async function newFile(page: Page) {
  await page.getByRole('button', { name: /New design file/ }).first().click();
  await expect(page.getByTestId('design-canvas')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__layr);
}

export const doc = (page: Page) => page.evaluate(() => structuredClone((window as any).__layr.store.doc));
export const nodesOf = async (page: Page, type: string) => Object.values((await doc(page)).nodes as Record<string, any>).filter(n => n.type === type);

export async function canvasBox(page: Page) {
  const b = await page.getByTestId('design-canvas').boundingBox();
  if (!b) throw new Error('no canvas');
  return b;
}
/** Drag on the canvas using real mouse input; coordinates are relative to the canvas element. */
export async function drag(page: Page, x1: number, y1: number, x2: number, y2: number, mods: string[] = []) {
  const b = await canvasBox(page);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(b.x + x1, b.y + y1);
  await page.mouse.down();
  await page.mouse.move((b.x + x1 + b.x + x2) / 2, (b.y + y1 + b.y + y2) / 2, { steps: 4 });
  await page.mouse.move(b.x + x2, b.y + y2, { steps: 4 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}
export async function click(page: Page, x: number, y: number, opts: { shift?: boolean } = {}) {
  const b = await canvasBox(page);
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.click(b.x + x, b.y + y);
  if (opts.shift) await page.keyboard.up('Shift');
}
export async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });
}
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

export async function makePng(page: Page, color = '#ff3366', w = 120, h = 80): Promise<Buffer> {
  const b64 = await page.evaluate(({ color, w, h }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d')!; x.fillStyle = color; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(10, 10, 30, 30);
    return c.toDataURL('image/png').split(',')[1];
  }, { color, w, h });
  return Buffer.from(b64, 'base64');
}

/** Type into the app's own prompt dialog (the in-app replacement for window.prompt) and confirm it. */
export async function answerDialog(page: Page, text: string) {
  const input = page.locator('.dlg input');
  await input.fill(text); await input.press('Enter');
}
/** Pick an option by value in one of the app's custom selects. */
export async function choose(combo: Locator, value: string) {
  await combo.click();
  await combo.page().locator(`.sel-menu [data-value="${value}"]`).click();
}
