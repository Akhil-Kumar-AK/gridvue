import { expect, test, type Page } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const home = (p: Page) => p.getByRole('tablist', { name: 'Open files' }).getByRole('button', { name: 'Home' }).click();
async function signIn(page: Page, name: string) {
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toContainText(new RegExp(name, 'i')); // the stored spelling of the name is kept
}
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
}

test('demo build: any name signs in, files live in the browser, nothing talks to a server', async ({ page }) => {
  const apiCalls: string[] = []; const failed: string[] = [];
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(`${r.method()} ${r.url()}`); });
  page.on('response', r => { if (r.status() >= 400 && new URL(r.url()).pathname.startsWith('/api/')) failed.push(r.url()); });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));

  await page.goto('/');
  await expect(page.getByText(/Demo mode: nothing is uploaded/)).toBeVisible();
  const note = page.getByLabel('About this demo');
  await expect(note).toContainText('demo, for testing only'); await expect(note).toContainText('run it locally');
  const gh = note.getByRole('link', { name: 'Open the GitHub repository' });
  await expect(gh).toHaveAttribute('href', 'https://github.com/Akhil-Kumar-AK/gridvue'); await expect(gh).toHaveAttribute('target', '_blank'); await expect(gh).toHaveAttribute('rel', /noopener/);
  await page.screenshot({ path: 'test-results/login-demo-note.png' });
  await page.setViewportSize({ width: 1280, height: 680 }); await expect(gh).toBeVisible(); await gh.scrollIntoViewIfNeeded(); await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'Demo Tester');
  await expect(page.getByRole('heading', { name: 'All files' })).toBeVisible();

  // design file: draw, it saves, survives a reload
  await page.locator('.hmain').getByRole('button', { name: 'New design file' }).click();
  const canvas = page.getByTestId('design-canvas'); await expect(canvas).toBeVisible();
  const cb = (await canvas.boundingBox())!;
  await page.keyboard.press('r'); await page.mouse.move(cb.x + 150, cb.y + 150); await page.mouse.down(); await page.mouse.move(cb.x + 300, cb.y + 260, { steps: 6 }); await page.mouse.up();
  await expect(page.locator('.layer', { hasText: 'Rectangle' })).toHaveCount(1);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Account menu' })).toContainText('Demo Tester'); // still signed in
  await page.getByRole('tab', { name: /Untitled/ }).click().catch(() => {});
  await expect(page.locator('.layer', { hasText: 'Rectangle' })).toHaveCount(1); // the file reopened with its layer

  // image fill: upload through the picker, image bytes are stored and served locally
  await page.locator('.layer', { hasText: 'Rectangle' }).first().click();
  await page.getByRole('button', { name: 'Open color picker' }).first().click();
  const pop = page.getByRole('dialog', { name: 'Color picker' });
  await pop.locator('.cp-types').getByRole('button', { name: 'Image' }).click();
  await pop.locator('input[type=file]').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
  await expect(pop.getByRole('button', { name: 'Replace image' })).toBeVisible({ timeout: 10_000 });
  await pop.getByRole('button', { name: 'Close color picker' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  // sharing is explained, not silently broken
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByPlaceholder('Name of a person who has signed in').fill('Someone');
  await page.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByText(/Sharing is not available in this demo/)).toBeVisible();
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Done' }).click();

  // whiteboard
  await home(page);
  await page.locator('.hmain').getByRole('button', { name: 'New whiteboard' }).click();
  await expect(page.getByTestId('jam-canvas')).toBeVisible();
  await page.getByRole('toolbar', { name: 'Whiteboard tools' }).getByRole('button', { name: 'Sticky note' }).click();
  const jb = (await page.getByTestId('jam-canvas').boundingBox())!;
  await page.mouse.click(jb.x + 300, jb.y + 300); await page.keyboard.type('hello demo'); await page.keyboard.press('Escape');
  await expect(page.locator('.jam-save')).toHaveText('Saved', { timeout: 10_000 });
  await page.waitForTimeout(3500); // the board preview is refreshed a moment after a save

  // dashboard shows both files; the design file got a real thumbnail
  await home(page);
  await expect(page.locator('.hcard')).toHaveCount(2);
  await expect.poll(async () => page.locator('.hthumb img').count(), { timeout: 10_000 }).toBeGreaterThan(0); // previews are stored and shown from the browser

  // another name gets an empty workspace; the first one comes back with its files
  await signOut(page); await signIn(page, 'Other Person');
  await expect(page.locator('.hcard')).toHaveCount(0);
  await signOut(page); await signIn(page, 'demo tester');
  await expect(page.locator('.hcard')).toHaveCount(2);

  expect(apiCalls, 'the demo must never call a server').toEqual([]);
  expect(failed).toEqual([]); expect(errors).toEqual([]);
});
