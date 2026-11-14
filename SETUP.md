# Setup

Requirements: Node ≥ 22.13 (uses built-in `node:sqlite`), npm ≥ 10, Google Chrome for the e2e tests.

```bash
npm install
cp .env.example .env        # optional; defaults work locally
npm run seed                # demo users akhil@/ben@/cy@example.com (password123) + the FinPay demo file
npm run dev                 # API on :8787, web on :5273
```

Open http://localhost:5273. Dependency versions are pinned exactly in each `package.json`.

Production-style run: `npm run build` then `npm run start -w @layr/server` (the server serves `apps/web/dist`). Put it behind HTTPS and set `COOKIE_SECURE=1`.
Database migrations run automatically at start (`PRAGMA user_version`, append-only list in `apps/server/src/db.ts`). Back up `data/layr.db*`.
Environment variables are documented in `.env.example`. No AI provider is configured; no AI feature exists yet.

The product is named **Gridvue** (renamed from Layr; internal identifiers such as the `.layr` file extension, the `@layr/*` packages and browser-storage keys keep the old name so existing files and settings keep working). Files export as `.layr` (files exported under the earlier working name, `.lumen`, still import). Browser storage keys and the session cookie use the `layr` prefix, so preferences saved before the rename are not carried over.


## Demo file
`npm run seed` creates the accounts and a **Welcome to Gridvue** file containing the FinPay dashboard (`apps/server/src/demoDoc.ts`): ~330 real layers (frames, rectangles, text, vector icons, a donut built from stroked ellipses) so every part can be selected and edited. A demo file you have already edited is left alone; to get the dashboard back, delete that file and seed again.
