// Standalone browser regression: node tests/pwa-lifecycle.mjs
// Uses only a temporary local in-memory server and a fresh browser context.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = await readFile(resolve(root, 'public/sw.js'), 'utf8');
const chrome = process.env.WRIENG_CHROME_PATH || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
let version = 'lifecycle-v1';
const shell = '<!doctype html><html><head><title>WriEng offline fixture</title></head><body><script src="/pwa-test/assets/test.js"></script></body></html>';
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/pwa-test/sw.js') {
    const files = ['index.html', 'assets/test.js'];
    if (version === 'lifecycle-broken') files.push('missing.js');
    response.setHeader('Content-Type', 'text/javascript');
    response.end(template.replace('__WRIENG_CACHE_VERSION__', version)
      .replace('/* __WRIENG_PRECACHE_FILES__ */ []', JSON.stringify(files)));
  } else if (request.url === '/pwa-test/assets/test.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end('window.fixtureAsset = true;');
  } else if (['/pwa-test/', '/pwa-test/index.html'].includes(request.url)) {
    response.setHeader('Content-Type', 'text/html');
    response.end(shell);
  } else {
    response.statusCode = 404;
    response.end('Not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/pwa-test/`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
  const status = await page.evaluate(() => new Promise((done) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => done(event.data);
    navigator.serviceWorker.controller.postMessage({ type: 'WRIENG_GET_OFFLINE_STATUS' }, [channel.port2]);
  }));
  assert.equal(status.offlineReady, true);
  assert.equal(status.cachedFiles, 2);
  await page.evaluate(() => new Promise((done, reject) => {
    const request = indexedDB.open('wrieng-lifecycle-regression', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('progress');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('progress', 'readwrite');
      transaction.objectStore('progress').put({ reviews: 3 }, 'card');
      transaction.oncomplete = () => { db.close(); done(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }));
  await context.setOffline(true);
  await page.goto(`${origin}/pwa-test/review/tomorrow`);
  assert.equal(await page.title(), 'WriEng offline fixture');
  assert.equal(await page.evaluate(() => window.fixtureAsset), true);
  await page.reload();
  assert.equal(await page.title(), 'WriEng offline fixture');
  await context.setOffline(false);

  // One missing file must reject the update, leaving the complete old version.
  version = 'lifecycle-broken';
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
  });
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return !registration.installing && !registration.waiting;
  });
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['wrieng:/pwa-test/:lifecycle-v1']);

  version = 'lifecycle-v2';
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
  });
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller.state), 'activated');
  assert.deepEqual(await page.evaluate(() => caches.keys()), [
    'wrieng:/pwa-test/:lifecycle-v1', 'wrieng:/pwa-test/:lifecycle-v2',
  ]);
  await page.evaluate(() => new Promise(async (done) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => done(), { once: true });
    (await navigator.serviceWorker.getRegistration()).waiting.postMessage({ type: 'WRIENG_ACTIVATE_UPDATE' });
  }));
  // controllerchange can happen while the worker is still "activating".
  await page.waitForFunction(() => navigator.serviceWorker.controller.state === 'activated');
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['wrieng:/pwa-test/:lifecycle-v2']);
  const progress = await page.evaluate(() => new Promise((done) => {
    const request = indexedDB.open('wrieng-lifecycle-regression', 1);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('progress').objectStore('progress').get('card');
      get.onsuccess = () => { db.close(); done(get.result); };
    };
  }));
  assert.deepEqual(progress, { reviews: 3 });
  console.log('PASS PWA lifecycle: complete cache, real offline deep navigation/reload, missing-file rollback, waiting update, explicit activation, scoped cleanup, IndexedDB retained.');
  await context.close();
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
