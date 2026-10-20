import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

// Always a new headless process and temporary profile; never attach to user tabs.
const executablePath = process.env.WRIENG_LEARNING_BROWSER || [
  chromium.executablePath(),
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find(path => existsSync(path));
const target = process.env.WRIENG_TEST_URL;
const production = process.env.WRIENG_PRODUCTION === '1';

export default defineConfig({
  testDir: './tests', testMatch: 'learning-tools.spec.ts',
  timeout: 60_000, expect: { timeout: 8_000 }, workers: 1, fullyParallel: false, retries: 0,
  outputDir: 'docs/test-results-learning',
  reporter: [['list'], ['json', { outputFile: 'docs/test-results-learning/results.json' }],
    ['html', { outputFolder: 'docs/e2e-report-learning', open: 'never' }]],
  use: {
    browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
    baseURL: target || (production ? 'http://127.0.0.1:4182/WriEng/' : 'http://127.0.0.1:4182'),
    locale: 'zh-CN', timezoneId: 'UTC', serviceWorkers: 'block',
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  webServer: target ? undefined : {
    command: `node node_modules/vite/bin/vite.js ${production ? 'preview ' : ''}--host 127.0.0.1 --port 4182 --strictPort`,
    url: production ? 'http://127.0.0.1:4182/WriEng/' : 'http://127.0.0.1:4182',
    env: production ? { VITE_BASE_PATH: '/WriEng/' } : undefined,
    reuseExistingServer: false, timeout: 30_000,
  },
});
