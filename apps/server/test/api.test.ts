import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DocStore, addNode, createEmptyDocument, defaultNode, pageIds, solid, type DocumentData } from '@layr/core';
import { createApp, defaultConfig } from '../src/app';
import { openDb } from '../src/db';

let server: Server, base: string;
beforeAll(async () => {
  server = createApp(openDb(':memory:'), { ...defaultConfig(), maxAssetBytes: 2000 });
  await new Promise<void>(r => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown, raw?: Buffer) {
    const r = await fetch(base + path, { method, headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: (raw as unknown as BodyInit) ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
  }
}
const register = async (email: string) => { const c = new Client(); const r = await c.req('POST', '/api/auth/register', { email, name: email.split('@')[0], password: 'password123' }); expect(r.status).toBe(200); return c; };
const sampleDoc = (): DocumentData => { const s = new DocStore(createEmptyDocument()); addNode(s, defaultNode('RECT', { fills: [solid('#f00')] }), pageIds(s.doc)[0]); return s.doc; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('auth', () => {
  it('requires a session for protected routes and supports login/logout', async () => {
    const anon = new Client();
    expect((await anon.req('GET', '/api/files')).status).toBe(401);
    const a = await register('a1@x.com');
    expect((await a.req('GET', '/api/me')).status).toBe(200);
    expect((await new Client().req('POST', '/api/auth/login', { email: 'a1@x.com', password: 'wrong-password' })).status).toBe(401);
    const again = new Client();
    expect((await again.req('POST', '/api/auth/login', { email: 'A1@x.com', password: 'password123' })).status).toBe(200);
    const staleCookie = again.cookie;
    await again.req('POST', '/api/auth/logout', {});
    const replay = new Client(); replay.cookie = staleCookie; // the old token must be dead server-side
    expect((await replay.req('GET', '/api/me')).status).toBe(401);
  });
  it('rejects duplicate registration and weak passwords', async () => {
    await register('dup@x.com');
    const c = new Client();
    expect((await c.req('POST', '/api/auth/register', { email: 'dup@x.com', name: 'd', password: 'password123' })).status).toBe(409);
    expect((await c.req('POST', '/api/auth/register', { email: 'weak@x.com', name: 'd', password: 'short' })).status).toBe(400);
  });
  it('refuses cross-origin mutations', async () => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(403);
  });
});

describe('persistence', () => {
  it('creates, saves, reopens, versions and detects conflicts', async () => {
    const u = await register('p@x.com');
    const { body: created } = await u.req('POST', '/api/files', { name: 'My file' });
    const id = created.file.id;
    const open1 = await u.req('GET', `/api/files/${id}`);
    expect(open1.body.document.nodes.doc.type).toBe('DOCUMENT');
    const doc = sampleDoc();
    const save = await u.req('PUT', `/api/files/${id}/doc`, { baseRevision: 1, doc });
    expect(save.body.revision).toBe(2);
    const stale = await u.req('PUT', `/api/files/${id}/doc`, { baseRevision: 1, doc });
    expect(stale.status).toBe(409);
    expect(stale.body.currentRevision).toBe(2);
    const open2 = await u.req('GET', `/api/files/${id}`);
    expect(open2.body.document).toEqual(doc);
    expect(open2.body.file.revision).toBe(2);
  });
  it('rejects structurally invalid documents with 422 and keeps the old one', async () => {
    const u = await register('inv@x.com');
    const id = (await u.req('POST', '/api/files', {})).body.file.id;
    const bad = sampleDoc(); bad.nodes[pageIds(bad)[0]].children.push('ghost');
    expect((await u.req('PUT', `/api/files/${id}/doc`, { baseRevision: 1, doc: bad })).status).toBe(422);
    expect((await u.req('GET', `/api/files/${id}`)).body.file.revision).toBe(1);
  });
  it('stores image assets (sniffed), refuses SVG/oversize, and serves them to members only', async () => {
    const o = await register('img@x.com'), other = await register('img2@x.com');
    const id = (await o.req('POST', '/api/files', {})).body.file.id;
    const up = await o.req('POST', `/api/files/${id}/assets`, undefined, PNG);
    expect(up.body.mime).toBe('image/png');
    expect((await o.req('POST', `/api/files/${id}/assets`, undefined, Buffer.from('<svg onload=alert(1)/>'))).status).toBe(415);
    expect((await o.req('POST', `/api/files/${id}/assets`, undefined, Buffer.concat([PNG, Buffer.alloc(3000)]))).status).toBe(413);
    const got = await o.req('GET', `/api/assets/${up.body.assetId}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect((await other.req('GET', `/api/assets/${up.body.assetId}`)).status).toBe(404);
    // a doc referencing an unknown asset is refused
    const d = sampleDoc(); d.assets['x'] = { name: 'x', mime: 'image/png' };
    expect((await o.req('PUT', `/api/files/${id}/doc`, { baseRevision: 1, doc: d })).status).toBe(422);
  });
  it('duplicates files including assets, and supports trash/restore/permanent delete', async () => {
    const u = await register('dupf@x.com');
    const id = (await u.req('POST', '/api/files', { name: 'Orig' })).body.file.id;
    const { body: a } = await u.req('POST', `/api/files/${id}/assets`, undefined, PNG);
    const s = new DocStore(createEmptyDocument());
    const r = defaultNode('RECT', { fills: [{ type: 'IMAGE', assetId: a.assetId, scaleMode: 'FILL', opacity: 1, visible: true }] });
    addNode(s, r, pageIds(s.doc)[0]); s.apply({ t: 'asset', id: a.assetId, asset: { name: 'p.png', mime: 'image/png' } });
    expect((await u.req('PUT', `/api/files/${id}/doc`, { baseRevision: 1, doc: s.doc })).status).toBe(200);
    const dup = (await u.req('POST', `/api/files/${id}/duplicate`, {})).body.file;
    const dd = (await u.req('GET', `/api/files/${dup.id}`)).body.document as DocumentData;
    const newAsset = Object.keys(dd.assets)[0];
    expect(newAsset).toBeTruthy(); expect(newAsset).not.toBe(a.assetId);
    expect((await u.req('GET', `/api/assets/${newAsset}`)).status).toBe(200);
    expect((await u.req('DELETE', `/api/files/${dup.id}`)).status).toBe(200);
    expect((await u.req('GET', '/api/files?view=all')).body.files.map((f: any) => f.id)).not.toContain(dup.id);
    expect((await u.req('GET', '/api/files?view=trash')).body.files.map((f: any) => f.id)).toContain(dup.id);
    expect((await u.req('POST', `/api/files/${dup.id}/restore`, {})).status).toBe(200);
    expect((await u.req('DELETE', `/api/files/${dup.id}?permanent=1`)).status).toBe(409);
    await u.req('DELETE', `/api/files/${dup.id}`);
    expect((await u.req('DELETE', `/api/files/${dup.id}?permanent=1`)).status).toBe(200);
    expect((await u.req('GET', `/api/files/${dup.id}`)).status).toBe(404);
  });
  it('imports a native file with embedded assets', async () => {
    const u = await register('imp@x.com');
    const doc = sampleDoc();
    doc.assets['old'] = { name: 'a.png', mime: 'image/png' };
    const rect = Object.values(doc.nodes).find(n => n.type === 'RECT')!;
    rect.fills = [{ type: 'IMAGE', assetId: 'old', scaleMode: 'FILL', opacity: 1, visible: true }];
    const r = await u.req('POST', '/api/files', { name: 'Imported', import: { document: doc, assets: { old: { base64: PNG.toString('base64') } } } });
    expect(r.status).toBe(200);
    const d = (await u.req('GET', `/api/files/${r.body.file.id}`)).body.document as DocumentData;
    expect(Object.keys(d.assets)).not.toContain('old');
    const bad = await u.req('POST', '/api/files', { import: { document: doc, assets: {} } });
    expect(bad.status).toBe(400);
  });
});

describe('permissions (server-enforced)', () => {
  it('owner / editor / viewer / stranger matrix, and revocation', async () => {
    const owner = await register('own@x.com'), editor = await register('ed@x.com'), viewer = await register('vw@x.com'), stranger = await register('st@x.com');
    const id = (await owner.req('POST', '/api/files', { name: 'Shared' })).body.file.id;
    expect((await owner.req('POST', `/api/files/${id}/members`, { email: 'ed@x.com', role: 'editor' })).status).toBe(200);
    expect((await owner.req('POST', `/api/files/${id}/members`, { email: 'vw@x.com', role: 'viewer' })).status).toBe(200);
    expect((await owner.req('POST', `/api/files/${id}/members`, { email: 'nobody@x.com', role: 'viewer' })).status).toBe(404);

    const doc = sampleDoc();
    expect((await stranger.req('GET', `/api/files/${id}`)).status).toBe(404);
    expect((await stranger.req('PUT', `/api/files/${id}/doc`, { baseRevision: 1, doc })).status).toBe(404);
    expect((await viewer.req('GET', `/api/files/${id}`)).body.role).toBe('viewer');
    expect((await viewer.req('PUT', `/api/files/${id}/doc`, { baseRevision: 1, doc })).status).toBe(403);
    expect((await viewer.req('POST', `/api/files/${id}/assets`, undefined, PNG)).status).toBe(403);
    expect((await viewer.req('PATCH', `/api/files/${id}`, { name: 'hax' })).status).toBe(403);
    expect((await viewer.req('DELETE', `/api/files/${id}`)).status).toBe(403);
    expect((await viewer.req('POST', `/api/files/${id}/members`, { email: 'st@x.com', role: 'editor' })).status).toBe(403);
    expect((await editor.req('PUT', `/api/files/${id}/doc`, { baseRevision: 1, doc })).status).toBe(200);
    expect((await editor.req('PATCH', `/api/files/${id}`, { name: 'Renamed' })).status).toBe(200);
    expect((await editor.req('DELETE', `/api/files/${id}`)).status).toBe(403);
    expect((await editor.req('POST', `/api/files/${id}/members`, { email: 'st@x.com', role: 'editor' })).status).toBe(403);
    expect((await viewer.req('GET', '/api/files?view=shared')).body.files.length).toBe(1);

    // downgrade editor -> viewer takes effect on the next request
    await owner.req('POST', `/api/files/${id}/members`, { email: 'ed@x.com', role: 'viewer' });
    expect((await editor.req('PUT', `/api/files/${id}/doc`, { baseRevision: 2, doc })).status).toBe(403);
    // revoke viewer entirely
    const members = (await owner.req('GET', `/api/files/${id}/members`)).body.members;
    const vid = members.find((m: any) => m.email === 'vw@x.com').id;
    expect((await owner.req('DELETE', `/api/files/${id}/members/${vid}`)).status).toBe(200);
    expect((await viewer.req('GET', `/api/files/${id}`)).status).toBe(404);
  });
  it('search, sort, favorites, drafts and projects', async () => {
    const u = await register('list@x.com');
    const p = (await u.req('POST', '/api/projects', { name: 'Proj' })).body.project;
    const a = (await u.req('POST', '/api/files', { name: 'Banana' })).body.file.id;
    const b = (await u.req('POST', '/api/files', { name: 'Apple', projectId: p.id })).body.file.id;
    expect((await u.req('GET', '/api/files?q=ban')).body.files.map((f: any) => f.id)).toEqual([a]);
    expect((await u.req('GET', '/api/files?sort=name')).body.files.map((f: any) => f.name)).toEqual(['Apple', 'Banana']);
    expect((await u.req('GET', '/api/files?view=drafts')).body.files.map((f: any) => f.id)).toEqual([a]);
    expect((await u.req('GET', `/api/files?project=${p.id}`)).body.files.map((f: any) => f.id)).toEqual([b]);
    await u.req('PATCH', `/api/files/${b}`, { favorite: true });
    expect((await u.req('GET', '/api/files?view=favorites')).body.files.map((f: any) => f.id)).toEqual([b]);
    expect((await u.req('GET', '/api/files?q=%25')).body.files.length).toBe(0); // LIKE wildcards are escaped
    const other = await register('list2@x.com');
    expect((await other.req('PATCH', `/api/files/${a}`, { projectId: p.id })).status).toBe(404);
  });
  it('rejects unimplemented file types honestly', async () => {
    const u = await register('type@x.com');
    const r = await u.req('POST', '/api/files', { type: 'slides' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('not implemented');
  });
  it('whiteboards: create, validate, save with revision check, duplicate', async () => {
    const u = await register('jam@x.com');
    const c = await u.req('POST', '/api/files', { type: 'whiteboard', name: 'Retro' });
    expect(c.status).toBe(200);
    const id = c.body.file.id;
    expect(c.body.file.type).toBe('whiteboard');
    const g = await u.req('GET', `/api/files/${id}`);
    expect(g.body.document.kind).toBe('jam');
    const doc = structuredClone(g.body.document);
    doc.items.a = { id: 'a', kind: 'sticky', x: 10, y: 10, w: 168, h: 168, rot: 0, text: 'hi', color: '#ffe066' }; doc.order = ['a'];
    expect((await u.req('PUT', `/api/files/${id}/doc`, { baseRevision: 1, doc })).status).toBe(200);
    expect((await u.req('PUT', `/api/files/${id}/doc`, { baseRevision: 1, doc })).status).toBe(409);
    const bad = structuredClone(doc); bad.items.l = { id: 'l', kind: 'link', x: 0, y: 0, w: 10, h: 10, rot: 0, url: 'javascript:alert(1)' }; bad.order.push('l');
    expect((await u.req('PUT', `/api/files/${id}/doc`, { baseRevision: 2, doc: bad })).status).toBe(422);
    const dangling = structuredClone(doc); dangling.items.c = { id: 'c', kind: 'connector', x: 0, y: 0, w: 0, h: 0, rot: 0, from: { id: 'zzz' }, to: { x: 1, y: 1 } }; dangling.order.push('c');
    expect((await u.req('PUT', `/api/files/${id}/doc`, { baseRevision: 2, doc: dangling })).status).toBe(422);
    const d = await u.req('POST', `/api/files/${id}/duplicate`, {});
    expect(d.body.file.type).toBe('whiteboard');
    expect((await u.req('GET', `/api/files/${d.body.file.id}`)).body.document.items.a.text).toBe('hi');
  });
});

describe('name-only entry', () => {
  it('creates a guest per name, returns the same one for the same name, never exposes password accounts, and shares by name', async () => {
    const a = new Client(); const r1 = await a.req('POST', '/api/auth/enter', { name: 'Alex Morgan' });
    expect(r1.status).toBe(200); expect(r1.body.user.name).toBe('Alex Morgan');
    expect((await a.req('GET', '/api/me')).body.user.name).toBe('Alex Morgan');
    const f = (await a.req('POST', '/api/files', { name: 'Mine' })).body.file.id;
    const again = new Client(); const r2 = await again.req('POST', '/api/auth/enter', { name: ' alex   MORGAN ' });
    expect(r2.body.user.id).toBe(r1.body.user.id); expect((await again.req('GET', `/api/files/${f}`)).status).toBe(200);
    expect((await new Client().req('POST', '/api/auth/enter', { name: '   ' })).status).toBe(400);
    // a password account with the same name is never reachable by name alone
    const pw = new Client(); await pw.req('POST', '/api/auth/register', { email: 'real@x.com', name: 'Real Person', password: 'password123' });
    const other = new Client(); const r3 = await other.req('POST', '/api/auth/enter', { name: 'Real Person' });
    expect(r3.body.user.email).toMatch(/@guest\.gridvue$/); expect(r3.body.user.id).not.toBe((await pw.req('GET', '/api/me')).body.user.id);
    // sharing by name
    const b = new Client(); await b.req('POST', '/api/auth/enter', { name: 'Bea Viewer' });
    expect((await a.req('POST', `/api/files/${f}/members`, { email: 'bea viewer', role: 'viewer' })).status).toBe(200);
    expect((await b.req('GET', `/api/files/${f}`)).body.role).toBe('viewer');
    expect((await a.req('POST', `/api/files/${f}/members`, { email: 'nobody here', role: 'viewer' })).status).toBe(404);
  });
});

describe('demo file', () => {
  it('the FinPay dashboard is a valid document made only of editable layers', async () => {
    const { buildDashboardDoc } = await import('../src/demoDoc');
    const { validateDocument } = await import('@layr/core');
    const doc = buildDashboardDoc();
    validateDocument(doc);
    const nodes = Object.values(doc.nodes);
    expect(nodes.length).toBeGreaterThan(250);
    expect(nodes.filter(n => n.type === 'TEXT').every(n => !!n.text?.characters)).toBe(true);
    expect(nodes.every(n => n.type !== 'GROUP' || n.children.length > 0)).toBe(true);
    expect(Object.keys(doc.assets)).toHaveLength(0); // no flattened images: everything is a layer
  });
});

describe('oversized bodies', () => {
  it('answer 413 with a message instead of dropping the connection', async () => {
    const cookie = await (async () => { const r = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `big${Date.now()}@x.test`, name: 'Big', password: 'password123' }) }); return r.headers.get('set-cookie')!.split(';')[0]; })();
    const f = await (await fetch(`${base}/api/files`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'x' }) })).json() as { file: { id: string } };
    const r = await fetch(`${base}/api/files/${f.file.id}/assets`, { method: 'POST', headers: { cookie, 'content-type': 'image/png' }, body: new Uint8Array(3_000_000) });
    expect(r.status).toBe(413);
    expect((await r.json() as { error: string }).error).toMatch(/limit/);
  });
});
