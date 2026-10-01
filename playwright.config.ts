import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: process.env.DEMO_BROWSER === '1' ? '**/demo.spec.ts' : undefined,
  testIgnore: process.env.DEMO_BROWSER === '1' ? [] : ['**/demo.spec.ts'],
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:5175',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    actionTimeout: 15000,
    viewport: { width: 1440, height: 1100 },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/browser-server.mjs',
    url: 'http://localhost:5175/api/health',
    timeout: 90000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
  },
});
