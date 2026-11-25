import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1366, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // ビルド済みアセットを Worker（wrangler dev）で配信。モックモード・開発用認証なし
    command: `npx vite build && npx wrangler dev --port ${PORT} --var ENVIRONMENT:development --var AUTH_MODE:none --var DATA_MODE:mock --var SEARCH_LIMIT_PER_MINUTE:1000`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
