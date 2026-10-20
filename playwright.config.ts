import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Reuse the installed browser binary, never a user's browser profile or tabs.
const executablePath = process.env.WRIENG_CHROME_PATH || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find(path => existsSync(path));

export default defineConfig({
  testDir: './tests',
  // Archived v1/v2 suites remain available; v3 opens directly into learning.
  testMatch: ['cyber.spec.ts'],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'docs/test-results-v3',
  reporter: [
    ['list'],
    ['json', { outputFile: 'docs/test-results-v3/results.json' }],
    ['html', { outputFolder: 'docs/e2e-report-v3', open: 'never' }],
  ],
  use: {
    baseURL: process.env.WRIENG_TEST_URL || 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'UTC',
    serviceWorkers: 'allow',
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
