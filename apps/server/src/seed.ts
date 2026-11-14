import { resolve } from 'node:path';
import { buildDashboardDoc } from './demoDoc';
import { openDb } from './db';
import { hashPassword } from './auth';
import { randomUUID } from 'node:crypto';

/** Creates demo accounts + a sample file. Idempotent. Passwords are for LOCAL DEVELOPMENT ONLY. */
const db = openDb(resolve(process.env.DATABASE_PATH ?? './data/layr.db'));
const users = [
  { email: 'akhil@example.com', name: 'Akhil' },
  { email: 'ben@example.com', name: 'Ben Editor' },
  { email: 'cy@example.com', name: 'Cy Viewer' },
];
const ids: Record<string, string> = {};
for (const u of users) {
  const row = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email) as { id: string } | undefined;
  if (row) { ids[u.email] = row.id; continue; }
  const id = randomUUID();
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(id, u.email, u.name, await hashPassword('password123'), Date.now());
  db.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(randomUUID(), `${u.name}'s workspace`, id, Date.now());
  ids[u.email] = id;
}
const owner = ids['akhil@example.com'];
db.prepare("UPDATE files SET name = 'Welcome to Gridvue' WHERE name = 'Welcome to Layr'").run(); // renamed with the product
const existing = db.prepare("SELECT id, doc FROM files WHERE name = 'Welcome to Gridvue'").get() as { id: string; doc: string } | undefined;
if (!existing) {
  const ws = (db.prepare('SELECT id FROM workspaces WHERE owner_id = ?').get(owner) as { id: string }).id;
  const fid = randomUUID();
  db.prepare('INSERT INTO files (id, workspace_id, owner_id, name, type, doc, revision, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(fid, ws, owner, 'Welcome to Gridvue', 'design', JSON.stringify(buildDashboardDoc()), 1, Date.now(), Date.now());
  db.prepare('INSERT INTO file_opens VALUES (?,?,?)').run(owner, fid, Date.now());
  db.prepare('INSERT INTO file_members VALUES (?,?,?)').run(fid, ids['ben@example.com'], 'editor');
  db.prepare('INSERT INTO file_members VALUES (?,?,?)').run(fid, ids['cy@example.com'], 'viewer');
} else if (Object.keys((JSON.parse(existing.doc) as { nodes: object }).nodes).length < 12) {
  // the old three-layer demo: upgrade it to the dashboard (a file you have edited is never touched)
  db.prepare('UPDATE files SET doc = ?, revision = revision + 1, updated_at = ?, thumbnail = NULL WHERE id = ?').run(JSON.stringify(buildDashboardDoc()), Date.now(), existing.id);
}
console.log('Seeded users akhil@/ben@/cy@example.com (password: password123) and "Welcome to Gridvue".');
