import { expect, test } from '@playwright/test';
import { newFile, signup } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('feedback button floats without moving content; popup sends name, comment and screenshot', async ({ page }) => {
  const name = await signup(page);
  const fab = page.getByRole('button', { name: 'Feedback', exact: true });
  await expect(fab).toBeVisible();
  expect(await fab.evaluate(e => getComputedStyle(e.closest('.fb-root')!).position)).toBe('fixed');
  // opening the popup must not shift anything on the page
  const before = await page.locator('.hmain').boundingBox();
  await fab.click();
  await expect(page.getByTestId('feedback-popup')).toBeVisible();
  expect(await page.locator('.hmain').boundingBox()).toEqual(before);
  await expect(page.getByLabel('Your name')).toHaveValue(name); // prefilled from the signed-in name

  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('alert')).toContainText('comment'); // validation

  await page.getByLabel('Your name').fill('Pat Tester');
  await page.getByRole('button', { name: 'Bug' }).click();
  await page.getByLabel('Comment').fill('Export dialog closes by itself');
  await page.locator('.fb-pop input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.fb-shot')).toHaveCount(1);
  const [req] = await Promise.all([page.waitForRequest('**/api/feedback'), page.getByRole('button', { name: 'Submit' }).click()]);
  const body = req.postDataJSON();
  expect(body).toMatchObject({ name: 'Pat Tester', kind: 'bug', message: 'Export dialog closes by itself' });
  expect(body.screenshots).toHaveLength(1);
  expect(body.page).toMatch(/^\//);
  await expect(page.getByTestId('feedback-popup')).toContainText(/Thank you|Thanks/);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('feedback-popup')).toHaveCount(0);

  // available inside the editor too
  await newFile(page);
  await expect(page.getByRole('button', { name: 'Feedback', exact: true })).toBeVisible();
});
