import { expect, test } from '@playwright/test';
import { clipboardHtml } from '../apps/web/test/figmaFixture';
import { newFile, nodesOf, signup } from './helpers';

test('pasting layers copied in Figma recreates them as editable layers', async ({ page }) => {
  await signup(page); await newFile(page);
  const html = clipboardHtml();
  // a real paste event carrying Figma's clipboard HTML
  await page.evaluate(h => {
    const dt = new DataTransfer(); dt.setData('text/html', h); dt.setData('text/plain', ' ');
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, html);
  await expect.poll(async () => (await nodesOf(page, 'FRAME')).length).toBe(1);
  const frame = (await nodesOf(page, 'FRAME'))[0];
  expect(frame).toMatchObject({ name: 'Card', width: 200, height: 120, cornerRadius: 8 });
  expect(frame.children).toHaveLength(3);
  const text = (await nodesOf(page, 'TEXT'))[0];
  expect(text.text).toMatchObject({ characters: 'Hello Figma', fontWeight: 600, fontSize: 18 });
  expect((await nodesOf(page, 'VECTOR'))).toHaveLength(1);
  expect((await nodesOf(page, 'ELLIPSE'))).toHaveLength(1);
  // layers panel shows the hierarchy and the result is selected
  await expect(page.locator('.layer', { hasText: 'Card' })).toBeVisible();
  await expect(page.locator('.layer', { hasText: 'Title' })).toBeVisible();
  // the design is drawn (card is white on the dark canvas) and everything is editable
  await page.waitForTimeout(400);
  await page.locator('.layer', { hasText: 'Title' }).click();
  await expect(page.getByLabel('Text content')).toHaveValue('Hello Figma');
  // undo removes the whole paste in one step
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`);
  await expect.poll(async () => (await nodesOf(page, 'FRAME')).length).toBe(0);
});
