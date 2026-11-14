import { resolve } from 'node:path';
import { createApp, defaultConfig } from './app';
import { openDb } from './db';

const db = openDb(resolve(process.env.DATABASE_PATH ?? './data/layr.db'));
const port = Number(process.env.PORT ?? 8787);
const staticDir = resolve(import.meta.dirname, '../../web/dist');
createApp(db, { ...defaultConfig(), staticDir }).listen(port, () => console.log(`Gridvue server listening on http://localhost:${port}`));
