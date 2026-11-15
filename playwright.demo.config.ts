import { defineConfig } from '@playwright/test';

// Tests the browser-only demo build (what gets deployed to Vercel): a static site with no API server behind it.
export default defineConfig({
  testDir: './e2e-demo',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5401', channel: 'chrome', viewport: { width: 1440, height: 900 }, actionTimeout: 8000 },
  webServer: { command: 'npm run build:demo && npm run preview -w @layr/web -- --port 5401 --strictPort', url: 'http://localhost:5401', reuseExistingServer: false, timeout: 120_000 },
});
