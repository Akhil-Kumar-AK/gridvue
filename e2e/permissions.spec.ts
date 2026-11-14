import { expect, test } from '@playwright/test';
import { drag, newFile, nodesOf, signup, waitSaved, choose } from './helpers';

test('viewer cannot edit (UI and server), editor can; revocation closes access', async ({ browser }) => {
  const ownerCtx = await browser.newContext(), viewerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage(), viewer = await viewerCtx.newPage();
  const viewerName = await signup(viewer, undefined, `Vera Viewer ${Date.now().toString(36)}`);
  await signup(owner, undefined, `Olly Owner ${Date.now().toString(36)}`);
  await newFile(owner);
  await owner.keyboard.press('r'); await drag(owner, 100, 100, 220, 200);
  await waitSaved(owner);
  const fileUrl = owner.url();
  const fileId = fileUrl.split('/').pop()!;

  await owner.getByRole('button', { name: 'Share', exact: true }).click();
  await owner.getByPlaceholder('Name of a person who has signed in').fill(viewerName);
  await choose(owner.getByRole('dialog', { name: 'Share' }).getByRole('combobox').first(), 'viewer');
  await owner.getByRole('button', { name: 'Invite' }).click();
  await expect(owner.getByRole('dialog', { name: 'Share' }).getByText(viewerName).first()).toBeVisible();

  await viewer.goto(fileUrl);
  await viewer.waitForFunction(() => !!(window as any).__layr);
  await expect(viewer.getByTestId('save-status')).toHaveText('View only');
  expect((await nodesOf(viewer, 'RECT')).length).toBe(1);
  // tools disabled, drawing does nothing
  await expect(viewer.getByRole('button', { name: 'Rectangle' })).toBeDisabled();
  await viewer.keyboard.press('r'); await drag(viewer, 300, 300, 400, 400);
  expect((await nodesOf(viewer, 'RECT')).length).toBe(1);
  // server enforces it too
  const status = await viewer.evaluate(async id => {
    const s = (window as any).__layr;
    const r = await fetch(`/api/files/${id}/doc`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRevision: s.revision, doc: s.store.doc }) });
    return r.status;
  }, fileId);
  expect(status).toBe(403);

  // revoke: next request is 404
  const members = await owner.evaluate(async id => (await (await fetch(`/api/files/${id}/members`)).json()).members, fileId);
  await owner.evaluate(async ({ id, uid }) => { await fetch(`/api/files/${id}/members/${uid}`, { method: 'DELETE' }); }, { id: fileId, uid: members[0].id });
  const after = await viewer.evaluate(async id => (await fetch(`/api/files/${id}`)).status, fileId);
  expect(after).toBe(404);
  await ownerCtx.close(); await viewerCtx.close();
});

test('stale second tab gets a conflict banner instead of silently overwriting', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await signup(a); await newFile(a);
  await a.keyboard.press('r'); await drag(a, 100, 100, 200, 200); await waitSaved(a);
  const b = await ctx.newPage(); await b.goto(a.url()); await b.waitForFunction(() => !!(window as any).__layr);
  await a.keyboard.press('o'); await drag(a, 300, 100, 400, 200); await waitSaved(a);
  await b.keyboard.press('r'); await drag(b, 300, 300, 400, 400);
  await expect(b.getByRole('alert')).toContainText('changed elsewhere', { timeout: 10_000 });
  await expect(b.getByTestId('save-status')).toHaveText('Conflict');
  // the server still has tab A's version
  const rev = await a.evaluate(async () => (await (await fetch(`/api/files/${location.hash.split('/').pop()}`)).json()).document);
  expect(Object.values(rev.nodes as Record<string, any>).filter((n: any) => n.type === 'ELLIPSE').length).toBe(1);
  await ctx.close();
});
