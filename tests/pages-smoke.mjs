import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// LEGACY V2 ONLY: this suite targets the retired post-office onboarding/map UI.
// V3 acceptance uses tests/cyber.spec.ts and tests/pages-subpath.mjs instead.
if (process.env.WRIENG_ALLOW_LEGACY_PAGES_SMOKE !== '1') {
  throw new Error('Legacy v2 Pages smoke is disabled for v3. Use cyber.spec.ts and pages-subpath.mjs. Set WRIENG_ALLOW_LEGACY_PAGES_SMOKE=1 only to inspect an archived v2 build.');
}

// Isolated browser contexts only. This script never opens a user's Chrome profile.
// Usage: WRIENG_TEST_URL=http://127.0.0.1:4183/WriEng/ node tests/pages-smoke.mjs
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.env.WRIENG_TEST_URL || 'http://127.0.0.1:4183/WriEng/';
const base = new URL(requested.endsWith('/') ? requested : `${requested}/`);
assert(['http:', 'https:'].includes(base.protocol), 'Use an HTTP(S) preview or published URL.');
assert(base.pathname !== '/', 'Pages smoke requires the project subpath, such as /WriEng/.');
base.hash = '';
base.search = '';
const tag = /^(localhost|127\.0\.0\.1)$/.test(base.hostname) ? 'local' : 'published';
const screenshots = resolve(root, 'docs/screenshots-pages');
const results = resolve(root, 'docs/test-results-pages');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const executablePath = process.env.WRIENG_CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(path => existsSync(path));
const report = {
  schemaVersion: 1,
  target: base.href,
  startedAt: new Date().toISOString(),
  browser: null,
  status: 'running',
  checks: [],
  screenshots: [],
  errors: { page: [], console: [], request: [], http: [] },
};
const phases = new WeakMap();
let browser;

await mkdir(screenshots, { recursive: true });
await mkdir(results, { recursive: true });
// Keep all generated JSON/traces local without changing an existing repository file.
await writeFile(resolve(results, '.gitignore'), '*\n', { flag: 'wx' }).catch(error => {
  if (error.code !== 'EEXIST') throw error;
});

async function check(name, work) {
  const start = performance.now();
  try {
    const evidence = await work();
    report.checks.push({ name, status: 'passed', milliseconds: Math.round(performance.now() - start), evidence });
    console.log(`PASS ${name}`);
    return evidence;
  } catch (error) {
    report.checks.push({ name, status: 'failed', milliseconds: Math.round(performance.now() - start), error: error.stack || String(error) });
    console.error(`FAIL ${name}: ${error.message}`);
    throw error;
  }
}

async function poll(read, accept, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let observed;
  do {
    observed = await read();
    if (accept(observed)) return observed;
    await new Promise(resolvePoll => setTimeout(resolvePoll, 80));
  } while (Date.now() < deadline);
  throw new Error(`${description}; last value: ${JSON.stringify(observed)}`);
}

function watch(page, label) {
  phases.set(page, 'online');
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => report.errors.page.push({ page: label, phase: phases.get(page), message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.console.push({ page: label, phase: phases.get(page), message: message.text() });
  });
  page.on('requestfailed', request => report.errors.request.push({ page: label, phase: phases.get(page), url: request.url(), failure: request.failure()?.errorText }));
  page.on('response', response => {
    if (response.status() >= 400 && new URL(response.url()).origin === base.origin) {
      report.errors.http.push({ page: label, phase: phases.get(page), url: response.url(), status: response.status() });
    }
  });
}

function scoped(url) {
  const parsed = new URL(url, base);
  assert.equal(parsed.origin, base.origin, `Unexpected asset origin: ${parsed.href}`);
  assert(parsed.pathname.startsWith(base.pathname), `Asset escaped the Pages subpath: ${parsed.href}`);
  return parsed.href;
}

async function readState(page) {
  return page.evaluate(() => new Promise((resolveState, reject) => {
    const request = indexedDB.open('wrieng-learning', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('app', 'readonly');
      const item = transaction.objectStore('app').get('state');
      item.onsuccess = () => resolveState(item.result);
      item.onerror = () => reject(item.error);
      transaction.oncomplete = () => database.close();
    };
  }));
}

async function shot(page, name) {
  await poll(() => page.locator('.toast').count(), count => count === 0, 'Transient toast did not clear');
  const path = resolve(screenshots, `${tag}-${name}.png`);
  const overlay = await page.getByRole('dialog').count() > 0;
  await page.screenshot({ path, fullPage: !overlay, animations: 'disabled' });
  report.screenshots.push(path);
}

const study = page => page.getByRole('dialog', { name: '今日投递练习' });
const nav = page => page.getByRole('navigation', { name: '主要导航' });

async function home(page, navigate = true) {
  if (navigate) await page.goto(base.href, { waitUntil: 'networkidle' });
  await page.locator('.home-hero h1').waitFor({ state: 'visible' });
  await poll(() => page.locator('.hero-actions .primary').isEnabled(), Boolean, 'Home did not load local state');
}

async function onboard(page) {
  await page.getByRole('button', { name: '开始今日投递', exact: true }).click();
  const plan = page.getByRole('dialog', { name: /给自己的学习计划/ });
  await plan.waitFor({ state: 'visible' });
  await plan.getByRole('button', { name: '美国日常', exact: true }).click();
  await plan.getByLabel('每天愿意留多少时间？').selectOption('5');
  await plan.getByRole('button', { name: '保存我的计划' }).click();
  await plan.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '开始今日投递', exact: true }).click();
  await study(page).waitFor({ state: 'visible' });
}

async function hideAndType(page) {
  const panel = study(page);
  await panel.locator('.display-word').waitFor({ state: 'visible' });
  const term = (await panel.locator('.display-word').textContent()).trim();
  const before = await readState(page);
  const id = before.session.queue[before.session.index];
  await panel.getByRole('button', { name: '藏起答案，开始回忆' }).click();
  await poll(() => panel.locator('.display-word').count(), count => count === 0, 'Study answer was not hidden');
  assert.equal(await panel.locator('.answer-reveal').count(), 0, 'Answer reveal was visible before submission');
  await panel.getByRole('button', { name: '键盘输入' }).click();
  await panel.getByRole('textbox', { name: '输入你回忆的英文' }).waitFor({ state: 'visible' });
  assert(await panel.getByRole('button', { name: '提交并揭晓' }).isDisabled(), 'Blank recall must not submit');
  return { term, id };
}

async function submit(page, answer) {
  const panel = study(page);
  await panel.getByRole('textbox', { name: '输入你回忆的英文' }).fill(answer);
  await panel.getByRole('button', { name: '提交并揭晓' }).click();
  await panel.locator('.answer-reveal').waitFor({ state: 'visible' });
  assert((await panel.locator('.feedback-status').textContent()).includes('拼写一致'), 'Correct typed response was not checked deterministically');
}

async function grade(page) {
  const before = await readState(page);
  await study(page).getByRole('button', { name: '独立想起了' }).click();
  return poll(() => readState(page), data => data.events.length === before.events.length + 1
    && data.session.index === before.session.index + 1, 'Rating and next session state were not persisted');
}

async function closeStudy(page) {
  await study(page).getByRole('button', { name: '保存退出' }).click();
  await study(page).waitFor({ state: 'hidden' });
}

async function resources(page) {
  const links = await page.evaluate(() => [
    ...[...document.querySelectorAll('script[src]')].map(element => ({ kind: 'script', url: element.src })),
    ...[...document.querySelectorAll('link[rel="stylesheet"],link[rel="modulepreload"],link[rel="icon"],link[rel="manifest"]')]
      .map(element => ({ kind: element.rel, url: element.href })),
  ]);
  assert(links.some(link => link.kind === 'script'), 'No production script found');
  assert(links.some(link => link.kind === 'stylesheet'), 'No production CSS found');
  for (const link of links) scoped(link.url);
  const manifestLink = links.find(link => link.kind === 'manifest');
  assert(manifestLink, 'No web manifest linked');
  const manifestResponse = await page.request.get(manifestLink.url);
  assert(manifestResponse.ok(), `Manifest HTTP ${manifestResponse.status()}`);
  const manifest = await manifestResponse.json();
  assert.equal(new URL(manifest.scope, manifestLink.url).href, base.href, 'Manifest scope is not the project directory');
  assert.equal(new URL(manifest.start_url, manifestLink.url).href, base.href, 'Manifest start URL escaped the project directory');
  assert.equal(new URL(manifest.id, manifestLink.url).href, base.href, 'Manifest identity is not scoped to the project');
  const icons = await Promise.all(manifest.icons.map(async icon => {
    const url = scoped(new URL(icon.src, manifestLink.url).href);
    const response = await page.request.get(url);
    assert(response.ok(), `Manifest icon failed: ${url}`);
    return { url, bytes: (await response.body()).length };
  }));
  const cacheManifestResponse = await page.request.get(new URL('sw-manifest.json', base).href);
  assert(cacheManifestResponse.ok(), `Build cache manifest HTTP ${cacheManifestResponse.status()}`);
  const cacheManifest = await cacheManifestResponse.json();
  assert(cacheManifest.version && Array.isArray(cacheManifest.files) && cacheManifest.files.length > 5, 'Incomplete production cache manifest');
  assert(cacheManifest.files.length < 200, 'Unexpectedly large cache manifest');
  const assets = [];
  for (let index = 0; index < cacheManifest.files.length; index += 4) {
    assets.push(...await Promise.all(cacheManifest.files.slice(index, index + 4).map(async file => {
      const url = scoped(new URL(file.url, base).href);
      const response = await page.request.get(url);
      assert(response.ok(), `Production resource HTTP ${response.status()}: ${url}`);
      const bytes = await response.body();
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      assert.equal(bytes.length, file.bytes, `Resource size mismatch: ${file.url}`);
      assert.equal(sha256, file.sha256, `Resource content differs from the deployed manifest: ${file.url}`);
      return { url, status: response.status(), bytes: bytes.length, sha256 };
    })));
  }
  return { initialLinks: links, manifest: { url: manifestLink.url, start_url: manifest.start_url, scope: manifest.scope, id: manifest.id, icons }, version: cacheManifest.version, assets };
}

async function serviceWorker(page, resourceEvidence) {
  await poll(() => page.locator('.connection').textContent(), text => text?.includes('离线词库已就绪'), 'App did not report the complete offline cache', 30_000);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 20_000 });
  const evidence = await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const names = await caches.keys();
    return {
      controller: navigator.serviceWorker.controller?.scriptURL,
      registrations: registrations.map(registration => ({ scope: registration.scope, script: registration.active?.scriptURL })),
      caches: await Promise.all(names.map(async name => ({ name, urls: (await (await caches.open(name)).keys()).map(request => request.url) }))),
    };
  });
  assert.equal(evidence.controller, new URL('sw.js', base).href, 'Controller script escaped the Pages base');
  assert.equal(evidence.registrations.length, 1, 'Unexpected registrations in a fresh context');
  assert.equal(evidence.registrations[0].scope, base.href, 'Service worker scope is not the Pages project path');
  const expectedName = `wrieng:${base.pathname}:${resourceEvidence.version}`;
  const cache = evidence.caches.find(entry => entry.name === expectedName);
  assert(cache, `Expected scoped cache missing: ${expectedName}`);
  for (const asset of resourceEvidence.assets) assert(cache.urls.includes(asset.url), `Uncached production resource: ${asset.url}`);
  return evidence;
}

async function desktopFlow() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN', timezoneId: 'UTC', serviceWorkers: 'allow' });
  const page = await context.newPage();
  watch(page, 'desktop');
  const firstDay = Date.parse('2026-10-18T12:00:00Z');
  await page.clock.install({ time: new Date(firstDay) });
  try {
    await check('project subpath loads production application', async () => {
      await home(page);
      assert(new URL(page.url()).pathname.startsWith(base.pathname), 'Navigation left the project path');
      await shot(page, '00-desktop-home');
      return { url: page.url(), title: await page.title() };
    });
    const assets = await check('all production assets and manifest stay under the project base', () => resources(page));
    await check('service worker and complete cache have exact project scope', () => serviceWorker(page, assets));
    const terms = new Map();
    await check('hidden recall submission and feedback survive refresh', async () => {
      await onboard(page);
      const learned = await hideAndType(page);
      terms.set(learned.id, learned.term);
      await shot(page, '01-hidden-recall');
      await submit(page, learned.term.toUpperCase());
      const submitted = await readState(page);
      assert.equal(submitted.events.length, 0, 'Submission was graded before the user selected a rating');
      await shot(page, '02-typed-feedback');
      await page.reload();
      await home(page, false);
      await page.getByRole('button', { name: '继续上次投递', exact: true }).click();
      await study(page).locator('.original-answer').waitFor({ state: 'visible' });
      assert((await study(page).locator('.original-answer').textContent()).includes(learned.term.toUpperCase()));
      const resumed = await readState(page);
      assert.equal(resumed.session.submittedAt, submitted.session.submittedAt, 'Refresh changed original submission time');
      const saved = await grade(page);
      assert.equal(saved.events[0].wordId, learned.id);
      assert.equal(saved.events[0].result, 'correct');
      assert.equal(saved.events[0].answer, learned.term.toUpperCase());
      assert.match(saved.events[0].schedulerVersion, /fsrs6/);
      return { word: learned, submittedAt: saved.events[0].submittedAt, dueAt: saved.progress[learned.id].dueAt, schedulerVersion: saved.events[0].schedulerVersion };
    });
    await check('five learning rounds produce a due review and cross day evidence', async () => {
      for (let index = 1; index < 5; index++) {
        const learned = await hideAndType(page);
        terms.set(learned.id, learned.term);
        await submit(page, learned.term);
        await grade(page);
      }
      await study(page).getByRole('heading', { name: '今天的信，送到了。' }).waitFor({ state: 'visible' });
      await study(page).getByRole('button', { name: '回到词汇邮局' }).click();
      const initial = await readState(page);
      assert.equal(initial.events.length, 5);
      const reviewAt = Math.max(firstDay + 86_400_000, ...Object.values(initial.progress).map(progress => progress.dueAt)) + 60_000;
      await page.clock.setFixedTime(new Date(reviewAt));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await poll(() => page.locator('.stat-card').first().locator('strong').textContent(), text => Number.parseInt(text, 10) === 5, 'Due review count did not update');
      await shot(page, '03-due-review');
      await page.getByRole('button', { name: '开始今日投递', exact: true }).click();
      await study(page).getByText('到期复习 · 新情境').waitFor({ state: 'visible' });
      assert.equal(await study(page).locator('.display-word').count(), 0, 'Review exposed the answer before recall');
      const current = await readState(page);
      const id = current.session.queue[0];
      assert(terms.has(id), 'A new word displaced the due review');
      await study(page).getByRole('button', { name: '键盘输入' }).click();
      await submit(page, terms.get(id));
      const saved = await grade(page);
      assert.equal(saved.events.length, 6);
      assert.equal(new Set(saved.events.map(event => event.localDay)).size, 2);
      assert(saved.progress[id].dueAt > reviewAt, 'Review did not schedule a future revisit');
      assert.equal(saved.progress[id].fsrsCard.due, saved.progress[id].dueAt);
      await closeStudy(page);
      return { initialWords: [...terms], reviewAt, reviewedId: id, eventCount: saved.events.length, nextDue: saved.progress[id].dueAt };
    });
    await check('offline navigation reload and another submitted review remain persistent', async () => {
      const before = await readState(page);
      phases.set(page, 'offline');
      await context.setOffline(true);
      await poll(() => page.locator('.network-bar').textContent(), text => text?.includes('可继续学习'), 'Offline status not shown');
      await nav(page).getByRole('button', { name: '词库', exact: true }).click();
      const knownTerm = terms.values().next().value;
      await page.getByRole('textbox', { name: '搜索词库' }).fill(knownTerm);
      assert((await page.locator('.word-card strong').allTextContents()).includes(knownTerm), 'Offline vocabulary was unavailable');
      await nav(page).getByRole('button', { name: '旅程地图', exact: true }).click();
      const map = page.getByTestId('journey-map');
      await map.waitFor({ state: 'visible' });
      await poll(() => map.getAttribute('data-reason'), reason => reason === 'ready', 'Offline WebGL map did not become ready');
      assert.equal(await map.getAttribute('data-mode'), '3d', 'Expected the supported Chrome WebGL map after offline lazy loading');
      await shot(page, '04-offline-map');
      await page.reload();
      await home(page, false);
      const restored = await readState(page);
      assert.deepEqual(restored.events, before.events, 'Offline reload changed submitted evidence');
      await page.getByRole('button', { name: '继续上次投递', exact: true }).click();
      const id = restored.session.queue[restored.session.index];
      assert(terms.has(id), 'Expected another known due word in the saved session');
      assert.equal(await study(page).locator('.display-word').count(), 0);
      await study(page).getByRole('button', { name: '键盘输入' }).click();
      await submit(page, terms.get(id));
      const saved = await grade(page);
      assert.equal(saved.events.length, 7, 'Offline review did not save its evidence');
      await closeStudy(page);
      await page.reload();
      await home(page, false);
      assert.equal((await readState(page)).events.length, 7, 'Second offline reload lost a review');
      await shot(page, '04-offline-restored');
      return { url: page.url(), retainedEvents: 7, online: await page.evaluate(() => navigator.onLine) };
    });
  } catch (error) {
    await page.screenshot({ path: resolve(results, `${tag}-${runId}-desktop-failure.png`), fullPage: false }).catch(() => {});
    throw error;
  } finally {
    await context.setOffline(false).catch(() => {});
    await context.close();
  }
}

async function mobileFlow() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'UTC', serviceWorkers: 'allow' });
  const page = await context.newPage();
  watch(page, 'mobile');
  try {
    await check('mobile project page vocabulary and source links fit the viewport', async () => {
      await home(page);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile home has horizontal overflow');
      await shot(page, '05-mobile-home');
      await nav(page).getByRole('button', { name: '词库', exact: true }).click();
      await page.getByRole('textbox', { name: '搜索词库' }).fill('receipt');
      await page.locator('.word-card').first().waitFor({ state: 'visible' });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile vocabulary has horizontal overflow');
      await shot(page, '06-mobile-library');
      await page.getByRole('button', { name: '内容来源与学习方法', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible' });
      const localLinks = await dialog.locator('a[href]').evaluateAll((elements, origin) => elements.map(element => element.href).filter(href => new URL(href).origin === origin), base.origin);
      assert(localLinks.length > 0, 'No local license/source documents linked');
      const checked = await Promise.all(localLinks.map(async url => {
        scoped(url);
        const response = await page.request.get(url);
        assert(response.ok(), `Mobile source link HTTP ${response.status()}: ${url}`);
        return { url, status: response.status() };
      }));
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      return { viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth })), sourceLinks: checked };
    });
  } catch (error) {
    await page.screenshot({ path: resolve(results, `${tag}-${runId}-mobile-failure.png`), fullPage: false }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

try {
  assert(executablePath, 'Existing Windows Chrome was not found. Set WRIENG_CHROME_PATH; this script does not install a browser.');
  browser = await chromium.launch({ executablePath, headless: true });
  report.browser = { name: 'Windows Chrome', version: browser.version(), executablePath, isolated: true, headless: true };
  // Keep independent mobile checks available even if a desktop flow uncovers a defect.
  for (const [name, flow] of [['desktop', desktopFlow], ['mobile', mobileFlow]]) {
    const failedBefore = report.checks.filter(item => item.status === 'failed').length;
    try { await flow(); } catch (error) {
      if (report.checks.filter(item => item.status === 'failed').length === failedBefore) {
        report.checks.push({ name: `${name} flow setup or cleanup`, status: 'failed', error: error.stack || String(error) });
      }
    }
  }
  await check('no unexpected page console network or HTTP errors', async () => {
    const unexpectedConsole = report.errors.console.filter(error => !(error.phase === 'offline' && /ERR_INTERNET_DISCONNECTED|Failed to update a ServiceWorker/i.test(error.message)));
    const unexpectedRequests = report.errors.request.filter(error => !(error.phase === 'offline' && /ERR_INTERNET_DISCONNECTED/i.test(error.failure || '')));
    assert.deepEqual(report.errors.page, []);
    assert.deepEqual(unexpectedConsole, []);
    assert.deepEqual(unexpectedRequests, []);
    assert.deepEqual(report.errors.http, []);
    return { pageErrors: 0, unexpectedConsoleErrors: 0, unexpectedRequestFailures: 0, httpErrors: 0, collected: report.errors };
  });
  report.status = report.checks.every(item => item.status === 'passed') ? 'passed' : 'failed';
} catch (error) {
  report.status = 'failed';
  report.fatal = error.stack || String(error);
} finally {
  await browser?.close();
  report.completedAt = new Date().toISOString();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const path = resolve(results, `${tag}-${runId}.json`);
  await writeFile(path, json);
  await writeFile(resolve(results, `${tag}-latest.json`), json);
  console.log(JSON.stringify({ status: report.status, passed: report.checks.filter(item => item.status === 'passed').length, failed: report.checks.filter(item => item.status === 'failed').length, report: path, screenshots }, null, 2));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
