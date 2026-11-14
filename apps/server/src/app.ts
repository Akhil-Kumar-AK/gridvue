import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { BoardError, createEmptyDocument, DocumentError, emptyBoard, migrate, validateBoard, validateDocument, type BoardData, type DocumentData } from '@layr/core';
import type { DB } from './db';
import { hashPassword, hashToken, newToken, verifyPassword } from './auth';
import { mailConfig, sendMail, type Attachment } from './mailer';
import { HttpError, Router, parseCookies, readBody, readJson, sendJson, type Ctx } from './http';

export interface Config { trustedOrigins: string[]; maxDocBytes: number; maxAssetBytes: number; cookieSecure: boolean; staticDir?: string }
export const defaultConfig = (): Config => ({
  // Origins (besides the server's own Host) allowed to make state-changing requests, e.g. the Vite dev server
  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? 'http://localhost:5273,http://127.0.0.1:5273').split(',').map(s => s.trim()).filter(Boolean),
  maxDocBytes: Number(process.env.MAX_DOC_BYTES ?? 64_000_000),
  maxAssetBytes: Number(process.env.MAX_ASSET_BYTES ?? 10_000_000),
  cookieSecure: process.env.COOKIE_SECURE === '1',
});

type Role = 'owner' | 'editor' | 'viewer';
const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };
const SESSION_MS = 14 * 24 * 3600 * 1000;
const now = () => Date.now();

function sniffImage(b: Buffer): string | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null; // SVG and everything else is refused: SVG can carry script and needs the sanitising importer
}

export function createApp(db: DB, config: Config = defaultConfig()): Server {
  const router = new Router();
  const attempts = new Map<string, { n: number; reset: number }>();

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT id, email, name FROM users WHERE id = ?'),
    session: db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?'),
  };

  function fileRow(userId: string, fileId: string, min: Role = 'viewer') {
    const f = db.prepare('SELECT f.*, u.name AS owner_name FROM files f JOIN users u ON u.id = f.owner_id WHERE f.id = ?').get(fileId) as any;
    let role: Role | null = null;
    if (f) {
      if (f.owner_id === userId) role = 'owner';
      else { const m = db.prepare('SELECT role FROM file_members WHERE file_id = ? AND user_id = ?').get(fileId, userId) as any; role = m?.role ?? null; }
    }
    if (!f || !role) throw new HttpError(404, 'File not found');
    if (RANK[role] < RANK[min]) throw new HttpError(403, `Requires ${min} access`);
    if (f.deleted_at && min !== 'viewer' && !(min === 'owner')) throw new HttpError(409, 'File is in the trash');
    return { f, role };
  }
  const meta = (f: any, role: Role, userId: string) => ({
    id: f.id, name: f.name, type: f.type, projectId: f.project_id, ownerId: f.owner_id, ownerName: f.owner_name, role,
    revision: f.revision, createdAt: f.created_at, updatedAt: f.updated_at, deletedAt: f.deleted_at ?? null,
    hasThumbnail: !!f.has_thumb, libraryId: f.library_id ?? null, favorite: !!(db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND file_id = ?').get(userId, f.id)),
  });
  const metaFull = (userId: string, id: string) => {
    const r = db.prepare('SELECT f.id, f.name, f.type, f.project_id, f.owner_id, f.revision, f.created_at, f.updated_at, f.deleted_at, f.owner_id, (f.thumbnail IS NOT NULL) AS has_thumb, f.library_id, u.name AS owner_name FROM files f JOIN users u ON u.id=f.owner_id WHERE f.id = ?').get(id) as any;
    const { role } = fileRow(userId, id);
    return meta(r, role, userId);
  };

  const requireStr = (v: unknown, field: string, max = 200): string => {
    if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpError(400, `Invalid ${field}`);
    return v.trim();
  };

  // ---------- auth ----------
  function startSession(ctx: Ctx, userId: string) {
    const token = newToken();
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(hashToken(token), userId, now() + SESSION_MS);
    ctx.res.setHeader('Set-Cookie', `layr_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${config.cookieSecure ? '; Secure' : ''}`);
  }
  router.add('POST', '/api/auth/register', false, async ctx => {
    const b = await readJson(ctx.req, 10_000);
    const email = requireStr(b.email, 'email').toLowerCase(), name = requireStr(b.name, 'name', 80);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Invalid email');
    if (typeof b.password !== 'string' || b.password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (q.userByEmail.get(email)) throw new HttpError(409, 'Email already registered');
    const id = randomUUID();
    db.prepare('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)').run(id, email, name, await hashPassword(b.password), now());
    db.prepare('INSERT INTO workspaces (id,name,owner_id,created_at) VALUES (?,?,?,?)').run(randomUUID(), `${name}'s workspace`, id, now());
    startSession(ctx, id);
    return { user: { id, email, name } };
  });
  router.add('POST', '/api/auth/login', false, async ctx => {
    const b = await readJson(ctx.req, 10_000);
    const email = String(b.email ?? '').toLowerCase();
    const key = `${ctx.req.socket.remoteAddress}|${email}`;
    const a = attempts.get(key);
    if (a && a.reset > now() && a.n >= 10) throw new HttpError(429, 'Too many attempts, try again later');
    const u = q.userByEmail.get(email) as any;
    const ok = u && typeof b.password === 'string' && (await verifyPassword(b.password, u.password_hash));
    if (!ok) { const cur = a && a.reset > now() ? a : { n: 0, reset: now() + 15 * 60_000 }; cur.n++; attempts.set(key, cur); throw new HttpError(401, 'Invalid email or password'); }
    attempts.delete(key);
    startSession(ctx, u.id);
    return { user: { id: u.id, email: u.email, name: u.name } };
  });
  // Name-only entry: no password. A name maps to one guest account (so the same name returns to the same files).
  // Real password accounts are never reachable through this route.
  router.add('POST', '/api/auth/enter', false, async ctx => {
    const b = await readJson(ctx.req, 2_000);
    const name = requireStr(b.name, 'name', 60).replace(/\s+/g, ' ');
    let u = db.prepare("SELECT id, email, name FROM users WHERE name = ? COLLATE NOCASE AND email LIKE '%@guest.gridvue' ORDER BY created_at LIMIT 1").get(name) as any;
    if (!u) {
      const id = randomUUID(); const email = `${id}@guest.gridvue`;
      db.prepare('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)').run(id, email, name, '!', now()); // '!' never verifies
      db.prepare('INSERT INTO workspaces (id,name,owner_id,created_at) VALUES (?,?,?,?)').run(randomUUID(), `${name}'s workspace`, id, now());
      u = { id, email, name };
    }
    startSession(ctx, u.id);
    return { user: { id: u.id, email: u.email, name: u.name } };
  });
  router.add('POST', '/api/auth/logout', false, ctx => {
    const t = parseCookies(ctx.req.headers.cookie).layr_session;
    if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(t));
    ctx.res.setHeader('Set-Cookie', 'layr_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return { ok: true };
  });
  router.add('GET', '/api/me', true, ctx => {
    const user = q.userById.get(ctx.userId!);
    const workspace = db.prepare('SELECT id, name FROM workspaces WHERE owner_id = ? ORDER BY created_at LIMIT 1').get(ctx.userId!);
    return { user, workspace };
  });

  // ---------- projects ----------
  const workspaceOf = (userId: string) => (db.prepare('SELECT id FROM workspaces WHERE owner_id = ? ORDER BY created_at LIMIT 1').get(userId) as any).id as string;
  const ownProject = (userId: string, id: string) => {
    const p = db.prepare('SELECT p.* FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE p.id = ? AND w.owner_id = ?').get(id, userId) as any;
    if (!p) throw new HttpError(404, 'Project not found');
    return p;
  };
  router.add('GET', '/api/projects', true, ctx => ({ projects: db.prepare('SELECT p.id, p.name FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.owner_id = ? ORDER BY p.name').all(ctx.userId!) }));
  router.add('POST', '/api/projects', true, async ctx => {
    const b = await readJson(ctx.req, 10_000);
    const id = randomUUID(), name = requireStr(b.name, 'name', 80);
    db.prepare('INSERT INTO projects (id, workspace_id, name, created_at) VALUES (?,?,?,?)').run(id, workspaceOf(ctx.userId!), name, now());
    return { project: { id, name } };
  });
  router.add('PATCH', '/api/projects/:id', true, async ctx => {
    ownProject(ctx.userId!, ctx.params.id);
    const b = await readJson(ctx.req, 10_000);
    db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(requireStr(b.name, 'name', 80), ctx.params.id);
    return { ok: true };
  });
  router.add('DELETE', '/api/projects/:id', true, ctx => { ownProject(ctx.userId!, ctx.params.id); db.prepare('DELETE FROM projects WHERE id = ?').run(ctx.params.id); return { ok: true }; });

  // ---------- files ----------
  router.add('GET', '/api/files', true, ctx => {
    const u = ctx.userId!;
    const view = ctx.url.searchParams.get('view') ?? 'all';
    const search = ctx.url.searchParams.get('q')?.trim();
    const project = ctx.url.searchParams.get('project');
    const sort = ctx.url.searchParams.get('sort') ?? (view === 'recent' ? 'opened' : 'modified');
    const where: string[] = [];
    const args: any[] = [u, u, u, u];
    where.push('(f.owner_id = ? OR m.user_id IS NOT NULL)');
    args.push(u);
    // note: arg order below follows placeholder order in SQL
    if (view === 'trash') where.push('f.deleted_at IS NOT NULL AND f.owner_id = ?'), args.push(u);
    else where.push('f.deleted_at IS NULL');
    if (view === 'drafts') where.push('f.owner_id = ? AND f.project_id IS NULL'), args.push(u);
    if (view === 'favorites') where.push('fav.file_id IS NOT NULL');
    if (view === 'shared') where.push('m.user_id IS NOT NULL');
    if (view === 'recent') where.push('o.opened_at IS NOT NULL');
    if (project) where.push('f.project_id = ?'), args.push(project);
    if (search) where.push("f.name LIKE ? ESCAPE '\\'"), args.push(`%${search.replace(/[\\%_]/g, c => '\\' + c)}%`);
    const order = ({ name: 'f.name COLLATE NOCASE ASC', created: 'f.created_at DESC', modified: 'f.updated_at DESC', opened: 'o.opened_at DESC' } as Record<string, string>)[sort];
    if (!order) throw new HttpError(400, 'Invalid sort');
    const sql = `SELECT f.id, f.name, f.type, f.project_id, f.owner_id, f.revision, f.created_at, f.updated_at, f.deleted_at, (f.thumbnail IS NOT NULL) AS has_thumb, f.library_id, uo.name AS owner_name,
      CASE WHEN f.owner_id = ? THEN 'owner' ELSE m.role END AS role
      FROM files f JOIN users uo ON uo.id = f.owner_id
      LEFT JOIN file_members m ON m.file_id = f.id AND m.user_id = ?
      LEFT JOIN favorites fav ON fav.file_id = f.id AND fav.user_id = ?
      LEFT JOIN file_opens o ON o.file_id = f.id AND o.user_id = ?
      WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`;
    // placeholders in order: role-case(u), m(u), fav(u), o(u), then where args (first where arg 'u' for owner clause)
    const rows = db.prepare(sql).all(...(args as any[])) as any[];
    return { files: rows.map(r => ({ ...meta(r, r.role, u) })) };
  });

  router.add('POST', '/api/files', true, async ctx => {
    const b = await readJson(ctx.req, config.maxDocBytes * 2); // imports carry base64 assets
    const name = b.name === undefined ? 'Untitled' : requireStr(b.name, 'name');
    const ftype = b.type ?? 'design';
    if (ftype !== 'design' && ftype !== 'whiteboard' && ftype !== 'designsystem') throw new HttpError(400, `File type "${String(b.type)}" is not implemented yet (see FEATURE_MATRIX.md)`);
    if (ftype === 'whiteboard') { // whiteboards (FigJam-style boards) keep their own document format and carry no asset rows
      let board: BoardData = emptyBoard();
      if (b.import) { try { validateBoard(b.import.document); board = b.import.document; } catch (e) { throw new HttpError(400, e instanceof BoardError ? e.message : 'Invalid board'); } }
      let pid: string | null = null; if (b.projectId) pid = ownProject(ctx.userId!, b.projectId).id;
      const wid = randomUUID(), wt = now();
      db.prepare('INSERT INTO files (id, workspace_id, project_id, owner_id, name, type, doc, revision, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(wid, workspaceOf(ctx.userId!), pid, ctx.userId!, name, 'whiteboard', JSON.stringify(board), 1, wt, wt);
      db.prepare('INSERT OR REPLACE INTO file_opens VALUES (?,?,?)').run(ctx.userId!, wid, wt);
      return { file: metaFull(ctx.userId!, wid) };
    }
    let projectId: string | null = null;
    if (b.projectId) projectId = ownProject(ctx.userId!, b.projectId).id;
    let doc: DocumentData = createEmptyDocument();
    const assets: Array<{ oldId: string; mime: string; bytes: Buffer }> = [];
    if (b.import) { // native-format import: validated and assets re-sniffed
      try { doc = migrate(b.import.document); validateDocument(doc); } catch (e) { throw new HttpError(400, e instanceof DocumentError ? e.message : 'Invalid document'); }
      for (const [id, a] of Object.entries<any>(b.import.assets ?? {})) {
        const bytes = Buffer.from(String(a.base64), 'base64'); const mime = sniffImage(bytes);
        if (!mime) throw new HttpError(400, `Asset ${id} is not a supported image`);
        assets.push({ oldId: id, mime, bytes });
      }
      for (const id of Object.keys(doc.assets)) if (!assets.some(a => a.oldId === id)) throw new HttpError(400, `Asset ${id} missing from file`);
    }
    const id = randomUUID(), t = now();
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO files (id, workspace_id, project_id, owner_id, name, type, doc, revision, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id, workspaceOf(ctx.userId!), projectId, ctx.userId!, name, ftype, '{}', 1, t, t);
      const remap = remapAssets(id, assets, doc);
      db.prepare('UPDATE files SET doc = ? WHERE id = ?').run(JSON.stringify(remap), id);
      db.prepare('INSERT OR REPLACE INTO file_opens VALUES (?,?,?)').run(ctx.userId!, id, t);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { file: metaFull(ctx.userId!, id) };
  });

  function remapAssets(fileId: string, assets: Array<{ oldId: string; mime: string; bytes: Buffer }>, doc: DocumentData): DocumentData {
    if (!assets.length) return doc;
    const map = new Map<string, string>();
    for (const a of assets) {
      const nid = randomUUID(); map.set(a.oldId, nid);
      db.prepare('INSERT INTO assets (id,file_id,mime,bytes,created_at) VALUES (?,?,?,?,?)').run(nid, fileId, a.mime, a.bytes, now());
    }
    const out = structuredClone(doc);
    out.assets = Object.fromEntries(Object.entries(out.assets).map(([k, v]) => [map.get(k) ?? k, v]));
    for (const n of Object.values(out.nodes)) for (const p of [...n.fills, ...n.strokes]) if (p.type === 'IMAGE') p.assetId = map.get(p.assetId) ?? p.assetId;
    return out;
  }

  router.add('GET', '/api/files/:id', true, ctx => {
    const { f, role } = fileRow(ctx.userId!, ctx.params.id);
    db.prepare('INSERT OR REPLACE INTO file_opens VALUES (?,?,?)').run(ctx.userId!, f.id, now());
    const raw = JSON.parse(f.doc);
    return { file: metaFull(ctx.userId!, f.id), role, document: f.type === 'whiteboard' ? raw : migrate(raw) }; // older stored documents are upgraded on read
  });

  router.add('PUT', '/api/files/:id/doc', true, async ctx => {
    const { f } = fileRow(ctx.userId!, ctx.params.id, 'editor');
    const b = await readJson(ctx.req, config.maxDocBytes);
    if (!Number.isInteger(b.baseRevision)) throw new HttpError(400, 'baseRevision required');
    if (f.type === 'whiteboard') {
      try { validateBoard(b.doc); } catch (e) { throw new HttpError(422, e instanceof BoardError ? e.message : 'Invalid board'); }
      const t = now();
      const r = db.prepare('UPDATE files SET doc = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?').run(JSON.stringify(b.doc), t, f.id, b.baseRevision);
      if (r.changes === 0) { const cur = db.prepare('SELECT revision FROM files WHERE id = ?').get(f.id) as any; throw new HttpError(409, 'Revision conflict: file changed elsewhere', { currentRevision: cur.revision }); }
      return { revision: b.baseRevision + 1, updatedAt: t };
    }
    let doc: DocumentData;
    try { doc = migrate(b.doc); validateDocument(doc); } catch (e) { throw new HttpError(422, e instanceof DocumentError ? e.message : 'Invalid document'); }
    for (const id of Object.keys(doc.assets)) if (!db.prepare('SELECT 1 FROM assets WHERE id = ? AND file_id = ?').get(id, f.id)) throw new HttpError(422, `Unknown asset ${id}`);
    const t = now();
    const r = db.prepare('UPDATE files SET doc = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?').run(JSON.stringify(doc), t, f.id, b.baseRevision);
    if (r.changes === 0) {
      const cur = db.prepare('SELECT revision FROM files WHERE id = ?').get(f.id) as any;
      throw new HttpError(409, 'Revision conflict: file changed elsewhere', { currentRevision: cur.revision });
    }
    return { revision: b.baseRevision + 1, updatedAt: t };
  });

  router.add('PATCH', '/api/files/:id', true, async ctx => {
    const b = await readJson(ctx.req, 10_000);
    const u = ctx.userId!;
    if (b.favorite !== undefined) {
      fileRow(u, ctx.params.id);
      if (b.favorite) db.prepare('INSERT OR IGNORE INTO favorites VALUES (?,?)').run(u, ctx.params.id);
      else db.prepare('DELETE FROM favorites WHERE user_id = ? AND file_id = ?').run(u, ctx.params.id);
    }
    if (b.name !== undefined) { fileRow(u, ctx.params.id, 'editor'); db.prepare('UPDATE files SET name = ?, updated_at = ? WHERE id = ?').run(requireStr(b.name, 'name'), now(), ctx.params.id); }
    if (b.projectId !== undefined) {
      fileRow(u, ctx.params.id, 'owner');
      const pid = b.projectId === null ? null : ownProject(u, b.projectId).id;
      db.prepare('UPDATE files SET project_id = ? WHERE id = ?').run(pid, ctx.params.id);
    }
    if (b.libraryId !== undefined) { // link / unlink a design system (a file of type "designsystem" this user can read)
      const { f } = fileRow(u, ctx.params.id, 'editor');
      if (f.type !== 'design') throw new HttpError(400, 'Only design files can link a design system');
      let lib: string | null = null;
      if (b.libraryId !== null) { const { f: l } = fileRow(u, requireStr(b.libraryId, 'libraryId')); if (l.type !== 'designsystem' || l.deleted_at) throw new HttpError(400, 'Not a design system'); lib = l.id; }
      db.prepare('UPDATE files SET library_id = ? WHERE id = ?').run(lib, ctx.params.id);
    }
    return { file: metaFull(u, ctx.params.id) };
  });

  router.add('POST', '/api/files/:id/duplicate', true, ctx => {
    const { f } = fileRow(ctx.userId!, ctx.params.id); // viewers may copy what they can see into their own workspace
    const id = randomUUID(), t = now();
    const rows = db.prepare('SELECT id, mime, bytes FROM assets WHERE file_id = ?').all(f.id) as any[];
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO files (id, workspace_id, project_id, owner_id, name, type, doc, revision, thumbnail, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, workspaceOf(ctx.userId!), f.owner_id === ctx.userId ? f.project_id : null, ctx.userId!, `${f.name} (copy)`, f.type, '{}', 1, f.thumbnail, t, t);
      const doc = remapAssets(id, rows.map(r => ({ oldId: r.id, mime: r.mime, bytes: Buffer.from(r.bytes) })), JSON.parse(f.doc));
      db.prepare('UPDATE files SET doc = ? WHERE id = ?').run(JSON.stringify(doc), id);
      db.prepare('INSERT OR REPLACE INTO file_opens VALUES (?,?,?)').run(ctx.userId!, id, t);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { file: metaFull(ctx.userId!, id) };
  });

  router.add('DELETE', '/api/files/:id', true, ctx => {
    const { f } = fileRow(ctx.userId!, ctx.params.id, 'owner');
    if (ctx.url.searchParams.get('permanent') === '1') {
      if (!f.deleted_at) throw new HttpError(409, 'Move the file to the trash first');
      db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
    } else db.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').run(now(), f.id);
    return { ok: true };
  });
  router.add('POST', '/api/files/:id/restore', true, ctx => {
    const { f } = fileRow(ctx.userId!, ctx.params.id, 'owner');
    db.prepare('UPDATE files SET deleted_at = NULL WHERE id = ?').run(f.id);
    return { file: metaFull(ctx.userId!, f.id) };
  });

  // ---------- thumbnails & assets ----------
  router.add('PUT', '/api/files/:id/thumbnail', true, async ctx => {
    const { f } = fileRow(ctx.userId!, ctx.params.id, 'editor');
    const buf = await readBody(ctx.req, 300_000);
    if (sniffImage(buf) !== 'image/png') throw new HttpError(415, 'Thumbnail must be PNG');
    db.prepare('UPDATE files SET thumbnail = ? WHERE id = ?').run(buf, f.id);
    return { ok: true };
  });
  router.add('DELETE', '/api/files/:id/thumbnail', true, ctx => { // an emptied file must not keep showing its old preview
    const { f } = fileRow(ctx.userId!, ctx.params.id, 'editor');
    db.prepare('UPDATE files SET thumbnail = NULL WHERE id = ?').run(f.id);
    return { ok: true };
  });
  router.add('GET', '/api/files/:id/thumbnail', true, ctx => {
    const { f } = fileRow(ctx.userId!, ctx.params.id);
    if (!f.thumbnail) throw new HttpError(404, 'No thumbnail');
    return raw(ctx, 'image/png', Buffer.from(f.thumbnail));
  });
  router.add('POST', '/api/files/:id/assets', true, async ctx => {
    const { f } = fileRow(ctx.userId!, ctx.params.id, 'editor');
    const buf = await readBody(ctx.req, config.maxAssetBytes);
    const mime = sniffImage(buf);
    if (!mime) throw new HttpError(415, 'Only PNG, JPEG, GIF and WebP images are accepted');
    const id = randomUUID();
    db.prepare('INSERT INTO assets (id,file_id,mime,bytes,created_at) VALUES (?,?,?,?,?)').run(id, f.id, mime, buf, now());
    return { assetId: id, mime };
  });
  router.add('GET', '/api/assets/:id', true, ctx => {
    const a = db.prepare('SELECT * FROM assets WHERE id = ?').get(ctx.params.id) as any;
    if (!a) throw new HttpError(404, 'Asset not found');
    fileRow(ctx.userId!, a.file_id);
    return raw(ctx, a.mime, Buffer.from(a.bytes), 'private, max-age=31536000, immutable');
  });

  // ---------- sharing ----------
  router.add('GET', '/api/files/:id/members', true, ctx => {
    const { f } = fileRow(ctx.userId!, ctx.params.id, 'owner');
    const members = db.prepare('SELECT u.id, u.email, u.name, m.role FROM file_members m JOIN users u ON u.id = m.user_id WHERE m.file_id = ?').all(f.id);
    return { owner: db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(f.owner_id), members };
  });
  router.add('POST', '/api/files/:id/members', true, async ctx => {
    const { f } = fileRow(ctx.userId!, ctx.params.id, 'owner');
    const b = await readJson(ctx.req, 10_000);
    if (b.role !== 'editor' && b.role !== 'viewer') throw new HttpError(400, 'role must be editor or viewer');
    const who = String(b.email ?? '').trim();
    const target = (q.userByEmail.get(who.toLowerCase()) ?? db.prepare("SELECT * FROM users WHERE name = ? COLLATE NOCASE AND email LIKE '%@guest.gridvue' ORDER BY created_at LIMIT 1").get(who)) as any;
    if (!target) throw new HttpError(404, 'No one with that name or email has signed in yet');
    if (target.id === f.owner_id) throw new HttpError(400, 'That user already owns the file');
    db.prepare('INSERT INTO file_members VALUES (?,?,?) ON CONFLICT(file_id,user_id) DO UPDATE SET role = excluded.role').run(f.id, target.id, b.role);
    return { ok: true };
  });
  router.add('DELETE', '/api/files/:id/members/:userId', true, ctx => {
    const { f } = fileRow(ctx.userId!, ctx.params.id, 'owner');
    db.prepare('DELETE FROM file_members WHERE file_id = ? AND user_id = ?').run(f.id, ctx.params.userId);
    return { ok: true };
  });

  // ---------- feedback: stored, then emailed to the product owner (FEEDBACK_TO) with any screenshots attached ----------
  const feedbackHits = new Map<string, number[]>();
  router.add('POST', '/api/feedback', true, async ctx => {
    const u = ctx.userId!;
    const recent = (feedbackHits.get(u) ?? []).filter(t => now() - t < 3600_000);
    if (recent.length >= 10) throw new HttpError(429, 'You have sent a lot of feedback in the last hour. Please try again later.');
    const b = await readJson(ctx.req, 25_000_000);
    const name = requireStr(b.name, 'name', 80);
    const message = requireStr(b.message, 'message', 5000);
    const kind = ['bug', 'idea', 'other'].includes(b.kind) ? b.kind as string : 'other';
    const page = typeof b.page === 'string' ? b.page.slice(0, 500) : '';
    const ua = typeof b.userAgent === 'string' ? b.userAgent.slice(0, 300) : String(ctx.req.headers['user-agent'] ?? '').slice(0, 300);
    const shots: Attachment[] = [];
    if (b.screenshots !== undefined && !Array.isArray(b.screenshots)) throw new HttpError(400, 'Invalid screenshots');
    for (const [i, s] of (b.screenshots ?? []).slice(0, 4).entries()) {
      const data = Buffer.from(String(s?.base64 ?? ''), 'base64');
      if (data.length > 6_000_000) throw new HttpError(413, 'A screenshot is larger than 6 MB');
      const mime = sniffImage(data);
      if (!mime) throw new HttpError(400, 'Screenshots must be PNG, JPEG, GIF or WebP images');
      shots.push({ filename: `screenshot-${i + 1}.${mime.split('/')[1].replace('jpeg', 'jpg')}`, mime, data });
    }
    const account = q.userById.get(u) as { email: string; name: string } | undefined;
    const id = randomUUID(), t = now();
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO feedback (id,user_id,name,kind,message,page,user_agent,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, u, name, kind, message, page, ua, t);
      for (const s of shots) db.prepare('INSERT INTO feedback_images VALUES (?,?,?,?,?)').run(randomUUID(), id, s.filename, s.mime, s.data);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    feedbackHits.set(u, [...recent, t]);
    const cfg = mailConfig();
    let emailed = false;
    if (cfg) {
      const label = { bug: 'Bug', idea: 'Idea', other: 'Feedback' }[kind]!;
      const text = [`${label} from ${name}`, '', message, '', '— Details —', `Name entered: ${name}`, `Account: ${account?.name ?? '?'}${account?.email ? ` <${account.email}>` : ''}`, `Type: ${label}`, `Page: ${page || '(unknown)'}`, `Browser: ${ua}`, `Sent: ${new Date(t).toISOString()}`, `Screenshots attached: ${shots.length}`, `Feedback id: ${id}`].join('\n');
      try { await sendMail(cfg, `[Gridvue ${label}] ${name}: ${message.replace(/\s+/g, ' ').slice(0, 60)}`, text, shots); emailed = true; }
      catch (e) { console.error('Feedback email failed:', (e as Error).message); }
    } else console.warn('Feedback saved but email is not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS).');
    db.prepare('UPDATE feedback SET mail_status = ? WHERE id = ?').run(emailed ? 'sent' : cfg ? 'failed' : 'unconfigured', id);
    return { ok: true, emailed, configured: !!cfg };
  });

  router.add('GET', '/api/health', false, () => ({ ok: true }));

  // ---------- plumbing ----------
  const RAW = Symbol('raw');
  function raw(ctx: Ctx, mime: string, body: Buffer, cache = 'private, no-cache') {
    ctx.res.writeHead(200, { 'Content-Type': mime, 'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cache, 'Content-Security-Policy': "default-src 'none'; sandbox" });
    ctx.res.end(body);
    return RAW;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      if (!url.pathname.startsWith('/api/')) return serveStatic(config.staticDir, url.pathname, res);
      const method = req.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host && !config.trustedOrigins.includes(origin)) throw new HttpError(403, 'Cross-origin request refused');
      }
      const hit = router.match(method, url.pathname);
      if (!hit) throw new HttpError(router.allowed(url.pathname) ? 405 : 404, 'Not found');
      let userId: string | null = null;
      const tok = parseCookies(req.headers.cookie).layr_session;
      if (tok) { const s = q.session.get(hashToken(tok), now()) as any; userId = s?.user_id ?? null; }
      if (hit.route.auth && !userId) throw new HttpError(401, 'Not signed in');
      const out = await hit.route.handler({ req, res, url, params: hit.params, userId });
      if (out !== RAW && !res.writableEnded) sendJson(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) sendJson(res, e.status, { error: e.message, ...e.extra });
      else { console.error(e); sendJson(res, 500, { error: 'Internal server error' }); }
    }
  });
  return server;
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
function serveStatic(dir: string | undefined, pathname: string, res: import('node:http').ServerResponse) {
  if (!dir || !existsSync(dir)) { res.writeHead(404); return res.end('Web build not found. Run `npm run build` or use `npm run dev`.'); }
  let p = normalize(join(dir, decodeURIComponent(pathname)));
  if (!p.startsWith(dir)) { res.writeHead(403); return res.end(); }
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(dir, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
  res.end(readFileSync(p));
}
