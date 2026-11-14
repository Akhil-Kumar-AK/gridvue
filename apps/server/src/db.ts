import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Ordered, append-only migrations. `PRAGMA user_version` records how many have run. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL);
  CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE files (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'design',
    doc TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, thumbnail BLOB,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
  CREATE INDEX files_owner ON files(owner_id);
  CREATE TABLE file_members (file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK (role IN ('editor','viewer')), PRIMARY KEY (file_id, user_id));
  CREATE TABLE favorites (user_id TEXT NOT NULL, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, PRIMARY KEY (user_id, file_id));
  CREATE TABLE file_opens (user_id TEXT NOT NULL, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, opened_at INTEGER NOT NULL, PRIMARY KEY (user_id, file_id));
  CREATE TABLE assets (id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX assets_file ON assets(file_id);
  `,
  // design systems: a design file may link one file of type 'designsystem' as its component library
  `ALTER TABLE files ADD COLUMN library_id TEXT REFERENCES files(id) ON DELETE SET NULL;`,
  // user feedback (also emailed); screenshots are kept with the report
  `CREATE TABLE feedback (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, name TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, page TEXT, user_agent TEXT, created_at INTEGER NOT NULL, mail_status TEXT NOT NULL DEFAULT 'pending');
   CREATE TABLE feedback_images (id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL);`,
];

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version = ${i + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}
