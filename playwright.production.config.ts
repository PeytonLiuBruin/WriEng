import { defineConfig } from '@playwright/test';
import desktop from './playwright.config';

// Serve and test the production bundle in the same process environment.
// Build first with VITE_BASE_PATH=/WriEng/; each test uses a fresh headless context.
const target = process.env.WRIENG_TEST_URL;
export default defineConfig({
  ...desktop,
  use: { ...desktop.use, baseURL: target || 'http://127.0.0.1:4174/WriEng/' },
  webServer: target ? undefined : {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/WriEng/',
    env: { VITE_BASE_PATH: '/WriEng/' },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
