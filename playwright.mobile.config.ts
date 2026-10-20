import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

// This launches a new headless process with Playwright's temporary profile.
// It never connects to an existing browser, user profile, or desktop window.
const bundled = chromium.executablePath();
const executablePath = process.env.WRIENG_MOBILE_BROWSER || [
  bundled,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find(path => existsSync(path));
const target = process.env.WRIENG_TEST_URL;
const production = process.env.WRIENG_PRODUCTION === '1';

export default defineConfig({
  testDir: './tests',
  testMatch: 'mobile-writing.spec.ts',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'docs/test-results-mobile',
  reporter: [
    ['list'],
    ['json', { outputFile: 'docs/test-results-mobile/results.json' }],
    ['html', { outputFolder: 'docs/e2e-report-mobile', open: 'never' }],
  ],
  use: {
    ...devices['iPhone 13'],
    browserName: 'chromium',
    headless: true,
    viewport: { width: 390, height: 844 },
    baseURL: target || (production ? 'http://127.0.0.1:4181/WriEng/' : 'http://127.0.0.1:4181'),
    locale: 'zh-CN',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: target ? undefined : {
    command: `node node_modules/vite/bin/vite.js ${production ? 'preview ' : ''}--host 127.0.0.1 --port 4181 --strictPort`,
    url: production ? 'http://127.0.0.1:4181/WriEng/' : 'http://127.0.0.1:4181',
    env: production ? { VITE_BASE_PATH: '/WriEng/' } : undefined,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
