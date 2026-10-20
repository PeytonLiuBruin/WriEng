// V3 resource/scope/cache and first-offline-core-learning acceptance.
// Staged: node tests/pages-subpath.mjs .build-next /WriEng/
// Existing URL: WRIENG_TEST_URL=http://127.0.0.1:4183/WriEng/ node tests/pages-subpath.mjs
// A pathname-only WRIENG_TEST_URL mounts that path on a temporary local server.
// Build/generate SW first. This script never builds or replaces dist/4173.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.env.WRIENG_TEST_URL || process.argv[3] || '/WriEng/';
const external = /^https?:\/\//.test(requested) ? new URL(requested) : null;
const prefix = (external?.pathname || requested).replace(/\/?$/, '/');
assert(prefix.startsWith('/') && !prefix.startsWith('//'), 'Use a path such as /WriEng/.');
let server;
let site;
if (external) site = external.origin + prefix;
else {
  const output = resolve(project, process.argv[2] || '.build-next');
  assert([resolve(project, 'dist'), resolve(project, '.build-next')].includes(output), 'Use a known build directory.');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.bib': 'text/plain' };
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (prefix !== '/' && path === prefix.slice(0, -1)) { response.writeHead(301, { Location: prefix }); response.end(); return; }
      if (!path.startsWith(prefix)) { response.writeHead(404); response.end('Outside app scope'); return; }
      const file = resolve(output, decodeURIComponent(path.slice(prefix.length)) || 'index.html');
      if (!file.startsWith(output + sep) || !(await stat(file)).isFile()) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  site = `http://127.0.0.1:${server.address().port}${prefix}`;
}
const origin = new URL(site).origin;
const executablePath = process.env.WRIENG_CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
assert(executablePath, 'Use installed Chrome; no browser is downloaded.');
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'UTC', serviceWorkers: 'allow' });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  const main = () => page.getByTestId('study-main');
  const word = () => page.getByTestId('study-word');
  const drawer = () => page.getByRole('dialog', { name: '词库与设置', exact: true });
  const state = () => page.evaluate(() => new Promise((done, reject) => {
    const request = indexedDB.open('wrieng-learning', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('app', 'readonly');
      const read = transaction.objectStore('app').get('state');
      read.onsuccess = () => done(read.result);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => db.close();
    };
  }));
  const poll = async (read, accept, description) => {
    const until = Date.now() + 30_000;
    while (Date.now() < until) { const value = await read(); if (accept(value)) return value; await page.waitForTimeout(50); }
    throw new Error(`Timed out: ${description}`);
  };
  const json = async path => {
    const response = await context.request.get(site + path);
    assert(response.ok(), `Missing app resource ${path}: ${response.status()}`);
    return response.json();
  };
  await page.goto(site);
  await main().waitFor(); await word().waitFor();
  const initial = await poll(state, value => Boolean(value?.session), 'direct study session');
  const firstTerm = (await word().innerText()).trim();
  for (const [selector, path] of [['link[rel="icon"]', 'icon.svg'], ['link[rel="manifest"]', 'manifest.webmanifest']]) {
    assert.equal(new URL(await page.locator(selector).getAttribute('href'), site).href, site + path);
  }
  const manifest = await json('manifest.webmanifest');
  for (const field of ['id', 'start_url', 'scope']) assert.equal(new URL(manifest[field], site + 'manifest.webmanifest').href, site);
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, site + 'manifest.webmanifest');
    assert(url.href.startsWith(site)); assert((await context.request.get(url.href)).ok());
  }
  const build = await json('sw-manifest.json');
  assert.deepEqual(build.onlineOnly, ['data/core-lexicon.json']);
  assert(!build.files.some(file => file.url === 'data/core-lexicon.json'), 'Do not duplicate bundled core data with the online audit JSON in precache.');
  for (const path of ['data/core-lexicon-manifest.json', 'licenses/WordNet-3.0-LICENSE.txt', 'licenses/COW-LICENSE.txt', 'licenses/ECDICT-LICENSE.txt']) assert(build.files.some(file => file.url === path), `Offline manifest omitted ${path}`);
  const coreData = await json('data/core-lexicon.json');
  assert.equal(coreData.metadata.count, coreData.entries.length);
  assert(coreData.entries.length >= 6000, 'The real source-backed core is shipped.');
  const core = coreData.entries.find(entry => entry.term === 'interdisciplinary') || coreData.entries.find(entry => entry.term.length >= 12 && entry.definitionEn && entry.arpabet);
  assert(core && core.id !== initial.session.queue[initial.session.index]);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const worker = await page.evaluate(async outside => {
    const registration = await navigator.serviceWorker.getRegistration();
    const cacheState = await new Promise((done, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => reject(new Error('No cache readiness message')), 20_000);
      channel.port1.onmessage = event => { clearTimeout(timeout); done(event.data); };
      navigator.serviceWorker.controller.postMessage({ type: 'WRIENG_GET_OFFLINE_STATUS' }, [channel.port2]);
    });
    return { scope: registration.scope, script: registration.active.scriptURL, outside: Boolean(await navigator.serviceWorker.getRegistration(outside)), cacheState };
  }, origin + '/outside-wrieng/');
  assert.equal(worker.scope, site); assert.equal(worker.script, site + 'sw.js');
  assert.equal(worker.cacheState.offlineReady, true); assert.equal(worker.cacheState.version, build.version);
  if (prefix !== '/') assert.equal(worker.outside, false);
  const cached = await page.evaluate(async name => (await (await caches.open(name)).keys()).map(request => request.url).sort(), `wrieng:${prefix}:${build.version}`);
  assert.deepEqual(cached, build.files.map(file => site + file.url).sort());
  const cachedIntegrity = await page.evaluate(async name => {
    const cache = await caches.open(name);
    return Promise.all((await cache.keys()).map(async request => {
      const response = await cache.match(request);
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      return { url: request.url, bytes: bytes.byteLength, sha256 };
    }));
  }, `wrieng:${prefix}:${build.version}`);
  for (const file of build.files) {
    const actual = cachedIntegrity.find(entry => entry.url === site + file.url);
    assert.equal(actual?.bytes, file.bytes, `Cached byte count: ${file.url}`);
    assert.equal(actual?.sha256, file.sha256, `Cached SHA-256: ${file.url}`);
  }

  // No core card has been opened or selected online. Select and learn it only after disconnection.
  await context.setOffline(true);
  await page.goto(site + 'review/tomorrow');
  await main().waitFor(); await word().waitFor();
  assert.equal((await word().innerText()).trim(), firstTerm);
  assert.deepEqual((await state()).events, initial.events);
  await page.getByRole('button', { name: '词库与设置', exact: true }).click();
  await drawer().getByRole('button', { name: '词库', exact: true }).click();
  await drawer().getByLabel('搜索词库', { exact: true }).fill(core.term);
  await drawer().locator('.cyber-library-card').filter({ hasText: core.term }).first().click();
  await drawer().getByRole('button', { name: '加入下一词', exact: true }).click();
  // The persisted add-next action closes the drawer asynchronously.
  await drawer().waitFor({ state: 'hidden' });
  await poll(state, value => value.session.nextWordIds?.includes(core.id) || value.session.queue.slice(value.session.index + 1).includes(core.id), 'selected offline core is saved for the next card');
  await main().getByRole('button', { name: '隐藏单词，开始回忆', exact: true }).click();
  await main().getByRole('button', { name: '键入', exact: true }).click();
  await main().getByRole('textbox', { name: '输入记住的单词' }).fill(firstTerm);
  await main().getByRole('button', { name: '提交并揭晓', exact: true }).click();
  await main().getByRole('button', { name: '记住了，下一词', exact: true }).click();
  await page.waitForFunction(term => document.querySelector('[data-testid="study-word"]')?.textContent?.trim() === term, core.term);
  const coreState = await state();
  assert.equal(coreState.session.queue[coreState.session.index], core.id);
  assert((await main().innerText()).includes(core.definitionEn), 'Offline first core study displays the real source definition.');
  assert.equal(coreState.events.length, initial.events.length + 1);
  await page.reload(); await word().waitFor();
  assert.equal((await word().innerText()).trim(), core.term);
  assert.deepEqual((await state()).events, coreState.events);
  assert(requests.filter(url => url.startsWith(origin)).every(url => url.startsWith(site)), 'App requests stay under the configured base.');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', app: 'v3', base: prefix, build: build.version, files: cached.length, verifiedCachedHashes: cachedIntegrity.length, coreEntries: coreData.entries.length, firstOfflineCore: { id: core.id, term: core.term }, pwaScope: worker.scope, outsideScopeControlled: worker.outside, retainedEvents: coreState.events.length, offlineDeepNavigation: true, offlineFirstCoreStudyAndRefresh: true, rawAuditJson: 'online download, deliberately not precached' }));
  await context.close();
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(done => server.close(done));
}
