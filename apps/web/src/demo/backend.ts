/**
 * Browser-only stand-in for the Gridvue API, used by the demo build (VITE_DEMO=1, e.g. on Vercel).
 * Same routes and response shapes as apps/server, but everything lives in this browser's IndexedDB:
 * one person per browser, any name signs in, no sharing, nothing is uploaded anywhere.
 */
import { BoardError, DocumentError, createEmptyDocument, emptyBoard, migrate, validateBoard, validateDocument, type BoardData, type DocumentData } from '@layr/core';
import { kv } from './kv';

export interface DemoResponse { status: number; json?: unknown; blob?: Blob }
class HttpError extends Error { constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); } }

interface FileRec { id: string; ownerId: string; ownerName: string; name: string; type: 'design' | 'whiteboard' | 'designsystem'; projectId: string | null; doc: DocumentData | BoardData; revision: number; createdAt: number; updatedAt: number; deletedAt: number | null; libraryId: string | null; hasThumb: boolean }
interface AssetRec { id: string; fileId: string; mime: string; blob: Blob }
interface ProjectRec { id: string; ownerId: string; name: string; createdAt: number }
interface UserRec { id: string; name: string }

const USER_KEY = 'gridvue:demo:user';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const now = () => Date.now();
const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/ /g, '-').slice(0, 60) || 'guest';

const currentUser = (): UserRec | null => { try { const v = localStorage.getItem(USER_KEY); return v ? (JSON.parse(v) as UserRec) : null; } catch { return null; } };
const shownUser = (u: UserRec) => ({ id: u.id, email: `${u.id}@demo.gridvue`, name: u.name });
const requireStr = (v: unknown, field: string, max = 200): string => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpError(400, `Invalid ${field}`); return v.trim(); };

async function sniff(b: Blob): Promise<string | null> {
  const a = new Uint8Array(await b.slice(0, 12).arrayBuffer());
  const s = (i: number, n: number) => String.fromCharCode(...a.slice(i, i + n));
  if (a.length > 8 && a[0] === 0x89 && s(1, 3) === 'PNG') return 'image/png';
  if (a.length > 3 && a[0] === 0xff && a[1] === 0xd8 && a[2] === 0xff) return 'image/jpeg';
  if (a.length > 6 && s(0, 4) === 'GIF8') return 'image/gif';
  if (a.length > 12 && s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
  return null;
}
const b64ToBlob = (b64: string): Blob => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u]); };

const favKey = (u: string) => `fav:${u}`, openKey = (u: string) => `open:${u}`;
const getFav = async (u: string) => (await kv.get<string[]>(favKey(u))) ?? [];
const getOpens = async (u: string) => (await kv.get<Record<string, number>>(openKey(u))) ?? {};

const meta = async (f: FileRec, userId: string) => ({
  id: f.id, name: f.name, type: f.type, projectId: f.projectId, ownerId: f.ownerId, ownerName: f.ownerName, role: 'owner' as const,
  revision: f.revision, createdAt: f.createdAt, updatedAt: f.updatedAt, deletedAt: f.deletedAt, hasThumbnail: f.hasThumb, libraryId: f.libraryId,
  favorite: (await getFav(userId)).includes(f.id),
});
async function fileOf(userId: string, id: string): Promise<FileRec> {
  const f = await kv.get<FileRec>(`f:${id}`);
  if (!f || f.ownerId !== userId) throw new HttpError(404, 'File not found');
  return f;
}
const saveFile = (f: FileRec) => kv.set(`f:${f.id}`, f);
async function ownProject(userId: string, id: string): Promise<ProjectRec> {
  const p = await kv.get<ProjectRec>(`p:${id}`);
  if (!p || p.ownerId !== userId) throw new HttpError(404, 'Project not found');
  return p;
}
async function copyAssets(fromFile: string, toFile: string, doc: DocumentData): Promise<DocumentData> {
  const recs = (await kv.list<AssetRec>('a:')).filter(a => a.fileId === fromFile);
  if (!recs.length) return doc;
  const map = new Map<string, string>();
  for (const a of recs) { const nid = uuid(); map.set(a.id, nid); await kv.set(`a:${nid}`, { id: nid, fileId: toFile, mime: a.mime, blob: a.blob } satisfies AssetRec); }
  const out = structuredClone(doc);
  out.assets = Object.fromEntries(Object.entries(out.assets).map(([k, v]) => [map.get(k) ?? k, v]));
  for (const n of Object.values(out.nodes)) for (const p of [...n.fills, ...n.strokes]) if (p.type === 'IMAGE') p.assetId = map.get(p.assetId) ?? p.assetId;
  return out;
}

type Ctx = { method: string; url: URL; body: any; raw?: Blob; user: UserRec };
type Handler = (ctx: Ctx, params: Record<string, string>) => Promise<DemoResponse | unknown>;
const routes: { method: string; re: RegExp; keys: string[]; auth: boolean; fn: Handler }[] = [];
const add = (method: string, path: string, auth: boolean, fn: Handler) => {
  const keys: string[] = []; const re = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, auth, fn });
};

add('POST', '/api/auth/enter', false, async ctx => {
  const name = requireStr(ctx.body?.name, 'name', 60).replace(/\s+/g, ' ');
  const u: UserRec = { id: 'u-' + slug(name), name };
  const existing = await kv.get<UserRec>(`u:${u.id}`);
  const rec = existing ?? u; if (!existing) await kv.set(`u:${u.id}`, rec);
  localStorage.setItem(USER_KEY, JSON.stringify(rec));
  return { user: shownUser(rec) };
});
add('POST', '/api/auth/logout', false, async () => { localStorage.removeItem(USER_KEY); return { ok: true }; });
add('GET', '/api/me', true, async ctx => ({ user: shownUser(ctx.user), workspace: { id: `w-${ctx.user.id}`, name: `${ctx.user.name}'s workspace` } }));
add('GET', '/api/health', false, async () => ({ ok: true, demo: true }));

add('GET', '/api/projects', true, async ctx => ({ projects: (await kv.list<ProjectRec>('p:')).filter(p => p.ownerId === ctx.user.id).sort((a, b) => a.name.localeCompare(b.name)).map(p => ({ id: p.id, name: p.name })) }));
add('POST', '/api/projects', true, async ctx => { const p: ProjectRec = { id: uuid(), ownerId: ctx.user.id, name: requireStr(ctx.body?.name, 'name'), createdAt: now() }; await kv.set(`p:${p.id}`, p); return { project: { id: p.id, name: p.name } }; });
add('PATCH', '/api/projects/:id', true, async (ctx, { id }) => { const p = await ownProject(ctx.user.id, id); p.name = requireStr(ctx.body?.name, 'name'); await kv.set(`p:${p.id}`, p); return { project: { id: p.id, name: p.name } }; });
add('DELETE', '/api/projects/:id', true, async (ctx, { id }) => {
  const p = await ownProject(ctx.user.id, id); await kv.del(`p:${p.id}`);
  for (const f of await kv.list<FileRec>('f:')) if (f.projectId === p.id) { f.projectId = null; await saveFile(f); }
  return { ok: true };
});

add('GET', '/api/files', true, async ctx => {
  const u = ctx.user.id, sp = ctx.url.searchParams;
  const view = sp.get('view') ?? 'all', q = sp.get('q')?.trim().toLowerCase(), project = sp.get('project');
  const sort = sp.get('sort') ?? (view === 'recent' ? 'opened' : 'modified');
  if (!['name', 'created', 'modified', 'opened'].includes(sort)) throw new HttpError(400, 'Invalid sort');
  const [favs, opens] = [await getFav(u), await getOpens(u)];
  let list = (await kv.list<FileRec>('f:')).filter(f => f.ownerId === u);
  list = view === 'trash' ? list.filter(f => f.deletedAt) : list.filter(f => !f.deletedAt);
  if (view === 'drafts') list = list.filter(f => !f.projectId);
  if (view === 'favorites') list = list.filter(f => favs.includes(f.id));
  if (view === 'shared') list = [];
  if (view === 'recent') list = list.filter(f => opens[f.id]);
  if (project) list = list.filter(f => f.projectId === project);
  if (q) list = list.filter(f => f.name.toLowerCase().includes(q));
  const key: Record<string, (a: FileRec, b: FileRec) => number> = { name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }), created: (a, b) => b.createdAt - a.createdAt, modified: (a, b) => b.updatedAt - a.updatedAt, opened: (a, b) => (opens[b.id] ?? 0) - (opens[a.id] ?? 0) };
  list.sort(key[sort]);
  return { files: await Promise.all(list.slice(0, 500).map(f => meta(f, u))) };
});

add('POST', '/api/files', true, async ctx => {
  const b = ctx.body ?? {};
  const name = b.name === undefined ? 'Untitled' : requireStr(b.name, 'name');
  const type = b.type ?? 'design';
  if (type !== 'design' && type !== 'whiteboard' && type !== 'designsystem') throw new HttpError(400, `File type "${String(b.type)}" is not implemented yet`);
  let projectId: string | null = null; if (b.projectId) projectId = (await ownProject(ctx.user.id, b.projectId)).id;
  const id = uuid(), t = now();
  let doc: DocumentData | BoardData;
  if (type === 'whiteboard') {
    doc = emptyBoard();
    if (b.import) { try { validateBoard(b.import.document); doc = b.import.document; } catch (e) { throw new HttpError(400, e instanceof BoardError ? e.message : 'Invalid board'); } }
  } else {
    let d: DocumentData = createEmptyDocument();
    const pending: { oldId: string; blob: Blob; mime: string }[] = [];
    if (b.import) {
      try { d = migrate(b.import.document); validateDocument(d); } catch (e) { throw new HttpError(400, e instanceof DocumentError ? e.message : 'Invalid document'); }
      for (const [aid, a] of Object.entries<any>(b.import.assets ?? {})) { const blob = b64ToBlob(String(a.base64)); const mime = await sniff(blob); if (!mime) throw new HttpError(400, `Asset ${aid} is not a supported image`); pending.push({ oldId: aid, blob: new Blob([blob], { type: mime }), mime }); }
      for (const aid of Object.keys(d.assets)) if (!pending.some(p => p.oldId === aid)) throw new HttpError(400, `Asset ${aid} missing from file`);
    }
    if (pending.length) { // give every imported image a fresh id owned by this file
      const map = new Map<string, string>();
      for (const p of pending) { const nid = uuid(); map.set(p.oldId, nid); await kv.set(`a:${nid}`, { id: nid, fileId: id, mime: p.mime, blob: p.blob } satisfies AssetRec); }
      d = structuredClone(d); d.assets = Object.fromEntries(Object.entries(d.assets).map(([k, v]) => [map.get(k) ?? k, v]));
      for (const n of Object.values(d.nodes)) for (const p of [...n.fills, ...n.strokes]) if (p.type === 'IMAGE') p.assetId = map.get(p.assetId) ?? p.assetId;
    }
    doc = d;
  }
  const f: FileRec = { id, ownerId: ctx.user.id, ownerName: ctx.user.name, name, type, projectId, doc, revision: 1, createdAt: t, updatedAt: t, deletedAt: null, libraryId: null, hasThumb: false };
  await saveFile(f);
  const opens = await getOpens(ctx.user.id); opens[id] = t; await kv.set(openKey(ctx.user.id), opens);
  return { file: await meta(f, ctx.user.id) };
});

add('GET', '/api/files/:id', true, async (ctx, { id }) => {
  const f = await fileOf(ctx.user.id, id);
  const opens = await getOpens(ctx.user.id); opens[id] = now(); await kv.set(openKey(ctx.user.id), opens);
  return { file: await meta(f, ctx.user.id), role: 'owner', document: f.type === 'whiteboard' ? f.doc : migrate(structuredClone(f.doc)) };
});

add('PUT', '/api/files/:id/doc', true, async (ctx, { id }) => {
  const f = await fileOf(ctx.user.id, id);
  if (f.deletedAt) throw new HttpError(409, 'File is in the trash');
  if (!Number.isInteger(ctx.body?.baseRevision)) throw new HttpError(400, 'baseRevision required');
  let doc: DocumentData | BoardData;
  if (f.type === 'whiteboard') { try { validateBoard(ctx.body.doc); } catch (e) { throw new HttpError(422, e instanceof BoardError ? e.message : 'Invalid board'); } doc = ctx.body.doc; }
  else {
    let d: DocumentData; try { d = migrate(ctx.body.doc); validateDocument(d); } catch (e) { throw new HttpError(422, e instanceof DocumentError ? e.message : 'Invalid document'); }
    for (const aid of Object.keys(d.assets)) { const a = await kv.get<AssetRec>(`a:${aid}`); if (!a || a.fileId !== f.id) throw new HttpError(422, `Unknown asset ${aid}`); }
    doc = d;
  }
  if (f.revision !== ctx.body.baseRevision) throw new HttpError(409, 'Revision conflict: file changed elsewhere', { currentRevision: f.revision });
  f.doc = doc; f.revision += 1; f.updatedAt = now(); await saveFile(f);
  return { revision: f.revision, updatedAt: f.updatedAt };
});

add('PATCH', '/api/files/:id', true, async (ctx, { id }) => {
  const b = ctx.body ?? {}, u = ctx.user.id; const f = await fileOf(u, id);
  if (b.favorite !== undefined) { const fav = await getFav(u); const next = b.favorite ? [...new Set([...fav, id])] : fav.filter(x => x !== id); await kv.set(favKey(u), next); }
  if (b.name !== undefined) { f.name = requireStr(b.name, 'name'); f.updatedAt = now(); }
  if (b.projectId !== undefined) f.projectId = b.projectId === null ? null : (await ownProject(u, b.projectId)).id;
  if (b.libraryId !== undefined) {
    if (f.type !== 'design') throw new HttpError(400, 'Only design files can link a design system');
    if (b.libraryId === null) f.libraryId = null;
    else { const l = await fileOf(u, requireStr(b.libraryId, 'libraryId')); if (l.type !== 'designsystem' || l.deletedAt) throw new HttpError(400, 'Not a design system'); f.libraryId = l.id; }
  }
  await saveFile(f);
  return { file: await meta(f, u) };
});

add('POST', '/api/files/:id/duplicate', true, async (ctx, { id }) => {
  const f = await fileOf(ctx.user.id, id); const nid = uuid(), t = now();
  const doc = f.type === 'whiteboard' ? structuredClone(f.doc) : await copyAssets(f.id, nid, structuredClone(f.doc) as DocumentData);
  const copy: FileRec = { ...f, id: nid, name: `${f.name} (copy)`, doc, revision: 1, createdAt: t, updatedAt: t, deletedAt: null, libraryId: f.libraryId };
  await saveFile(copy);
  const th = await kv.get<Blob>(`t:${f.id}`); if (th) await kv.set(`t:${nid}`, th);
  const opens = await getOpens(ctx.user.id); opens[nid] = t; await kv.set(openKey(ctx.user.id), opens);
  return { file: await meta(copy, ctx.user.id) };
});
add('DELETE', '/api/files/:id', true, async (ctx, { id }) => {
  const f = await fileOf(ctx.user.id, id);
  if (ctx.url.searchParams.get('permanent') === '1') {
    if (!f.deletedAt) throw new HttpError(409, 'Move the file to the trash first');
    await kv.del(`f:${id}`); await kv.del(`t:${id}`);
    for (const a of await kv.list<AssetRec>('a:')) if (a.fileId === id) await kv.del(`a:${a.id}`);
  } else { f.deletedAt = now(); await saveFile(f); }
  return { ok: true };
});
add('POST', '/api/files/:id/restore', true, async (ctx, { id }) => { const f = await fileOf(ctx.user.id, id); f.deletedAt = null; await saveFile(f); return { file: await meta(f, ctx.user.id) }; });

add('PUT', '/api/files/:id/thumbnail', true, async (ctx, { id }) => {
  const f = await fileOf(ctx.user.id, id);
  if (!ctx.raw || (await sniff(ctx.raw)) !== 'image/png') throw new HttpError(415, 'Thumbnail must be PNG');
  if (ctx.raw.size > 300_000) throw new HttpError(413, 'Thumbnail too large');
  await kv.set(`t:${id}`, new Blob([ctx.raw], { type: 'image/png' })); f.hasThumb = true; await saveFile(f);
  return { ok: true };
});
add('DELETE', '/api/files/:id/thumbnail', true, async (ctx, { id }) => { const f = await fileOf(ctx.user.id, id); await kv.del(`t:${id}`); f.hasThumb = false; await saveFile(f); return { ok: true }; });
add('GET', '/api/files/:id/thumbnail', true, async (ctx, { id }) => {
  await fileOf(ctx.user.id, id); const b = await kv.get<Blob>(`t:${id}`);
  if (!b) throw new HttpError(404, 'No thumbnail');
  return { status: 200, blob: b } satisfies DemoResponse;
});
add('POST', '/api/files/:id/assets', true, async (ctx, { id }) => {
  const f = await fileOf(ctx.user.id, id);
  if (!ctx.raw) throw new HttpError(415, 'Only PNG, JPEG, GIF and WebP images are accepted');
  if (ctx.raw.size > 10_000_000) throw new HttpError(413, 'Image is larger than 10 MB');
  const mime = await sniff(ctx.raw); if (!mime) throw new HttpError(415, 'Only PNG, JPEG, GIF and WebP images are accepted');
  const aid = uuid(); await kv.set(`a:${aid}`, { id: aid, fileId: f.id, mime, blob: new Blob([ctx.raw], { type: mime }) } satisfies AssetRec);
  return { assetId: aid, mime };
});
add('GET', '/api/assets/:id', true, async (ctx, { id }) => {
  const a = await kv.get<AssetRec>(`a:${id}`); if (!a) throw new HttpError(404, 'Asset not found');
  await fileOf(ctx.user.id, a.fileId);
  return { status: 200, blob: a.blob } satisfies DemoResponse;
});

// Sharing needs other people; the browser-only demo has exactly one person per browser.
add('GET', '/api/files/:id/members', true, async (ctx, { id }) => { await fileOf(ctx.user.id, id); return { owner: shownUser(ctx.user), members: [] }; });
add('POST', '/api/files/:id/members', true, async () => { throw new HttpError(403, 'Sharing is not available in this demo: your files stay in your own browser.'); });
add('DELETE', '/api/files/:id/members/:userId', true, async () => { throw new HttpError(403, 'Sharing is not available in this demo.'); });

export async function demoHandle(method: string, url: URL, body: unknown, raw?: Blob): Promise<DemoResponse> {
  try {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(url.pathname); if (!m) continue;
      const user = currentUser();
      if (r.auth && !user) throw new HttpError(401, 'Sign in required');
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const out = await r.fn({ method, url, body, raw, user: user as UserRec }, params);
      if (out && typeof out === 'object' && 'status' in (out as object) && ('blob' in (out as object) || 'json' in (out as object))) return out as DemoResponse;
      return { status: 200, json: out };
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, json: { error: e.message, ...e.extra } };
    console.error('Demo backend error', e);
    return { status: 500, json: { error: e instanceof Error ? e.message : 'Internal error' } };
  }
}
