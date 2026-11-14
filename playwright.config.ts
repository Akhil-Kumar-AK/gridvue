import { defineConfig } from '@playwright/test';

// Runs against the Vite dev server (exposes window.__layr) + an isolated API server and database.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5274', channel: 'chrome', viewport: { width: 1440, height: 900 }, acceptDownloads: true, actionTimeout: 8000 },
  webServer: [
    {
      command: 'rm -f data/e2e.db* && DATABASE_PATH=data/e2e.db PORT=8788 TRUSTED_ORIGINS=http://localhost:5274 npx tsx apps/server/src/main.ts',
      url: 'http://localhost:8788/api/health', reuseExistingServer: false, timeout: 30_000,
    },
    {
      command: 'API_URL=http://localhost:8788 PORT=5274 npm run dev:web',
      url: 'http://localhost:5274', reuseExistingServer: false, timeout: 30_000,
    },
  ],
});
