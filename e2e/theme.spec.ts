import { expect, test } from '@playwright/test';
import { newFile, signup } from './helpers';

test('dark by default; rail toggle switches to light and back (remembered)', async ({ page }) => {
  await signup(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await newFile(page);
  const rail = page.getByRole('navigation', { name: 'Sidebar' });
  await rail.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const bg = await page.locator('.panel.left').evaluate(e => getComputedStyle(e).backgroundColor);
  expect(bg).toBe('rgb(255, 255, 255)');
  await page.reload(); await page.waitForFunction(() => !!(window as any).__layr);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await rail.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
