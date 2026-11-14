import { expect, test } from '@playwright/test';
import { MOD, drag, newFile, nodesOf, signup, choose } from './helpers';

const node = (page: any, id: string) => page.evaluate((i: string) => structuredClone((window as any).__layr.store.doc.nodes[i]), id);

test('variants and component properties through the UI', async ({ page }) => {
  await signup(page); await newFile(page);
  await page.keyboard.press('f'); await drag(page, 60, 60, 260, 160);
  await page.keyboard.press('t'); await drag(page, 80, 80, 200, 110);
  await expect(page.locator('textarea.text-edit')).toBeFocused();
  await page.keyboard.type('Button'); await page.keyboard.press('Escape');
  await page.locator('.layer', { hasText: 'Frame' }).first().click();
  await page.keyboard.press(`${MOD}+Alt+k`);
  const comp = (await nodesOf(page, 'COMPONENT'))[0];
  // combine as variants (⌘⇧K), add a second variant
  await page.keyboard.press(`${MOD}+Shift+k`);
  const set = (await nodesOf(page, 'COMPONENT_SET'))[0];
  expect(set.children).toEqual([comp.id]);
  await page.getByRole('button', { name: 'Add variant', exact: true }).first().click();
  expect((await node(page, set.id)).children.length).toBe(2);
  const v2 = (await node(page, set.id)).children[1];
  expect((await node(page, v2)).variant).toEqual({ 'Property 1': 'Variant 2' });
  // give variant 2 a different fill
  await page.evaluate(id => (window as any).__layr.store.apply({ t: 'set', id, props: { fills: [{ type: 'SOLID', color: '#FF0000', opacity: 1, visible: true }] } }), v2);
  // text property bound to the label of the set's variants
  await page.locator('.layer', { hasText: 'Component set' }).first().click();
  await page.getByPlaceholder('New property name').fill('Label');
  await page.getByRole('button', { name: 'Add component property' }).click();
  expect((await node(page, set.id)).props[0]).toMatchObject({ name: 'Label', type: 'TEXT' });
  const label = (await node(page, comp.id)).children[0];
  await page.evaluate(({ id }) => (window as any).__layr.store.apply({ t: 'set', id, props: { bind: { characters: 'Label' } } }), { id: label });
  const label2 = (await node(page, v2)).children[0]; // each variant binds its own layer (bindings are per layer)
  await page.evaluate(({ id }) => (window as any).__layr.store.apply({ t: 'set', id, props: { bind: { characters: 'Label' } } }), { id: label2 });
  await page.evaluate(({ id }) => (window as any).__layr.store.apply({ t: 'set', id, props: { props: [{ name: 'Label', type: 'TEXT', default: 'Hello' }] } }), { id: set.id });
  // instance via the assets tab / action
  await page.evaluate(id => { const s = (window as any).__layr; (window as any).__inst = null; }, comp.id);
  await page.locator('.layer', { hasText: 'Property 1=Variant 1' }).first().click();
  await page.getByRole('button', { name: 'Create instance' }).click();
  const inst = (await nodesOf(page, 'INSTANCE'))[0];
  expect((await node(page, inst.children[0])).text.characters).toBe('Hello');
  // edit the property value on the instance
  await page.getByLabel('Label default').count();
  await page.locator('.vrow', { hasText: 'Label' }).locator('input').fill('Pay');
  await expect.poll(async () => (await node(page, inst.children[0])).text.characters).toBe('Pay');
  // switch variant from the dropdown: fill follows, property value stays
  await choose(page.locator('.vrow', { hasText: 'Property 1' }).getByRole('combobox'), 'Variant 2');
  await expect.poll(async () => (await node(page, inst.id)).fills[0].color).toBe('#FF0000');
  expect((await node(page, inst.children[0])).text.characters).toBe('Pay');
  await page.keyboard.press(`${MOD}+z`);
});
