import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AppData } from '../src/engine';

// A clean, isolated context per test; the installed Windows Chrome binary is in the config.
const screenshotDirectory = resolve(process.env.WRIENG_SCREENSHOT_DIR || 'docs/screenshots-v3');
const DAY = 86_400_000;
let pageErrors: string[] = [];
let consoleErrors: string[] = [];
let failedRequests: { url: string; error: string | null }[] = [];

function observe(page: Page) {
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? null }));
}

test.beforeEach(async ({ page }) => {
  pageErrors = []; consoleErrors = []; failedRequests = [];
  observe(page);
  await mkdir(screenshotDirectory, { recursive: true });
});

test.afterEach(async ({}, info) => {
  await info.attach('browser-errors', { body: JSON.stringify({ pageErrors, consoleErrors, failedRequests }, null, 2), contentType: 'application/json' });
  expect(pageErrors, 'No uncaught browser errors').toEqual([]);
  const unexpected = info.title.includes('offline')
    ? consoleErrors.filter(message => !/ERR_INTERNET_DISCONNECTED|Failed to update a ServiceWorker/i.test(message))
    : consoleErrors;
  expect(unexpected, 'No unexpected browser console errors').toEqual([]);
});

async function capture(page: Page, name: string, info: TestInfo) {
  const path = resolve(screenshotDirectory, `${name}.png`);
  // Viewport screenshots show the real controls a user sees, including fixed navigation.
  await page.screenshot({ path, fullPage: false, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function state(page: Page): Promise<AppData> {
  return page.evaluate(() => new Promise<AppData>((resolveData, reject) => {
    const request = indexedDB.open('wrieng-learning', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('app', 'readonly');
      const read = transaction.objectStore('app').get('state');
      read.onsuccess = () => resolveData(read.result);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => database.close();
    };
  }));
}

function main(page: Page) { return page.getByTestId('study-main'); }
function word(page: Page) { return page.getByTestId('study-word'); }
function drawer(page: Page) { return page.getByRole('dialog', { name: '词库与设置', exact: true }); }
const nextName = /^(?:记住了|有点费劲|需要再练|我写对了)，下一词/;

async function open(page: Page) {
  await page.goto('./');
  await expect(main(page)).toBeVisible();
  await expect(word(page)).toBeVisible();
  await expect.poll(async () => Boolean((await state(page))?.session)).toBe(true);
}

async function hideAnswer(page: Page) {
  const term = (await word(page).innerText()).trim();
  const before = await state(page);
  const id = before.session!.queue[before.session!.index];
  await main(page).getByRole('button', { name: '隐藏单词，开始回忆', exact: true }).click();
  await expect(page.getByTestId('recall-prompt')).toBeVisible();
  await expect(word(page)).toHaveCount(0);
  // The word must actually leave rendered text, not merely become transparent or blurred.
  const visible = await main(page).innerText();
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  expect(visible).not.toMatch(new RegExp(`\\b${escaped}\\b`, 'i'));
  const accessibleHints = await main(page).locator('[aria-label], [title], img[alt]').evaluateAll(elements => elements.map(element => [element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('alt')].filter(Boolean).join(' ')).join('\n'));
  expect(accessibleHints).not.toMatch(new RegExp(`\\b${escaped}\\b`, 'i'));
  expect(await main(page).locator('[style*="blur"], [aria-label="正确答案"]').count()).toBe(0);
  return { term, id };
}

async function typedMode(page: Page) {
  await main(page).getByRole('button', { name: '键入', exact: true }).click();
  await expect(main(page).getByRole('textbox', { name: '输入记住的单词' })).toBeVisible();
}

async function submitTyped(page: Page, answer: string) {
  await main(page).getByRole('textbox', { name: '输入记住的单词' }).fill(answer);
  await main(page).getByRole('button', { name: '提交并揭晓', exact: true }).click();
  await expect(word(page)).toBeVisible();
  await expect.poll(async () => (await state(page)).session?.stage).toBe('feedback');
}

async function grade(page: Page, name = '记住了，下一词') {
  const before = await state(page);
  await main(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect.poll(async () => (await state(page)).events.length).toBe(before.events.length + 1);
  await expect.poll(async () => (await state(page)).session?.stage).not.toBe('feedback');
  return state(page);
}

async function openDrawer(page: Page, tab: '词库' | '设置' | '记录' | '来源') {
  if (!(await drawer(page).isVisible())) {
    await page.getByRole('button', { name: '词库与设置', exact: true }).click();
  }
  await expect(drawer(page)).toBeVisible();
  await drawer(page).getByRole('button', { name: tab, exact: true }).click();
}

async function closeDrawer(page: Page) {
  await drawer(page).getByRole('button', { name: '关闭词库与设置', exact: true }).click();
  await expect(drawer(page)).not.toBeVisible();
}

async function noOverflow(page: Page, label: string) {
  const dimensions = await page.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth, `${label}: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.innerWidth + 1);
}

test('first visit immediately teaches a large word without a setup dialog', async ({ page, browser }, info) => {
  await open(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(word(page)).toHaveText(/^[a-z]+(?:[ '-][a-z]+)*$/i);
  await expect(main(page).getByRole('button', { name: '隐藏单词，开始回忆', exact: true })).toBeEnabled();
  await expect(main(page).getByRole('button', { name: '慢速', exact: true })).toBeVisible();
  const fontSize = await word(page).evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(60);
  expect((await state(page)).events).toHaveLength(0);
  await info.attach('execution-environment', { body: JSON.stringify({ platform: process.platform, browserVersion: browser.version(), target: page.url(), firstWord: (await word(page).innerText()).trim(), userProfile: 'isolated ephemeral Playwright context' }, null, 2), contentType: 'application/json' });
  await capture(page, '00-desktop-direct-study', info);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, '390px direct first visit');
  await capture(page, '00-mobile-direct-study', info);
});

test('hidden typed recall preserves original input and submission time through feedback refresh and next', async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-18T09:00:00Z') });
  await open(page);
  const { term, id } = await hideAnswer(page);
  await typedMode(page);
  await expect(main(page).getByRole('button', { name: '提交并揭晓', exact: true })).toBeDisabled();
  await capture(page, '01-hidden-recall', info);
  await submitTyped(page, term.toUpperCase());
  await expect(main(page)).toContainText(term.toUpperCase());
  const before = await state(page);
  expect(before.events).toHaveLength(0);
  const submittedAt = Number(before.session?.submittedAt);
  expect(Number.isSafeInteger(submittedAt)).toBe(true);
  await capture(page, '02-typed-feedback', info);
  await page.reload();
  await expect(word(page)).toHaveText(term);
  await expect(main(page).getByRole('button', { name: /^记住了，下一词/ })).toBeEnabled();
  expect((await state(page)).session?.submittedAt).toBe(submittedAt);
  await page.clock.setFixedTime(new Date(submittedAt + 300_000));
  const saved = await grade(page);
  expect(saved.events[0]).toMatchObject({ wordId: id, mode: 'typed', result: 'correct', effectiveRating: 'good', answer: term.toUpperCase(), hasInk: false });
  expect(saved.events[0].submittedAt).toBe(submittedAt);
  expect(saved.events[0].at).toBe(submittedAt + 300_000);
  expect(saved.events[0].schedulerVersion).toMatch(/fsrs6/);
  expect(saved.progress[id].fsrsCard?.due).toBe(saved.progress[id].dueAt);
  expect(saved.progress[id].dueAt).toBeGreaterThan(saved.events[0].at);
  const next = saved.session!.queue[saved.session!.index];
  expect(next).not.toBe(id);
  await page.reload();
  await expect(word(page)).toBeVisible();
  expect((await state(page)).events).toEqual(saved.events);
  expect((await state(page)).session!.queue[(await state(page)).session!.index]).toBe(next);
});

test('incorrect and hinted recalls cannot claim independent mastery', async ({ page }) => {
  await open(page);
  await hideAnswer(page);
  await typedMode(page);
  await submitTyped(page, 'deliberately-wrong-spelling');
  await expect(main(page).getByRole('button', { name: /^记住了，下一词/ })).toHaveCount(0);
  const wrong = await grade(page, '需要再练，下一词');
  expect(wrong.events[0]).toMatchObject({ result: 'incorrect', answer: 'deliberately-wrong-spelling', effectiveRating: 'again' });
  const event = wrong.events[0];
  expect(wrong.progress[event.wordId].dueAt - event.at).toBeGreaterThan(0);
  expect(wrong.progress[event.wordId].dueAt - event.at).toBeLessThanOrEqual(60 * 60_000);
  const { term } = await hideAnswer(page);
  await main(page).getByRole('button', { name: '首字母提示', exact: true }).click();
  await typedMode(page);
  await submitTyped(page, term);
  const nextButtons = main(page).getByRole('button', { name: nextName });
  await expect(nextButtons).toHaveCount(1);
  const hinted = await grade(page, '需要再练，下一词');
  expect(hinted.events[1]).toMatchObject({ result: 'correct', hinted: true, effectiveRating: 'again' });
});

test('handwriting rejects blank taps, accepts real touch strokes, and retains only self assessment', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await hideAnswer(page);
  await main(page).getByRole('button', { name: '手写', exact: true }).click();
  const submit = main(page).getByRole('button', { name: '提交并揭晓', exact: true });
  const canvas = main(page).getByRole('img', { name: '手写回忆区' });
  await expect(submit).toBeDisabled();
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await canvas.scrollIntoViewIfNeeded();
  const tapBox = (await canvas.boundingBox())!;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tapBox.x + 20, y: tapBox.y + 30 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(submit).toBeDisabled();
  await main(page).getByRole('button', { name: '撤销一笔', exact: true }).click();
  const box = (await canvas.boundingBox())!;
  await canvas.evaluate(element => element.addEventListener('pointerdown', event => {
    (element as HTMLElement).dataset.testPointer = (event as PointerEvent).pointerType;
  }, { once: true }));
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 20, y: box.y + 40 }] });
  for (let index = 1; index <= 24; index++) {
    const progress = index / 24;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
      x: box.x + 20 + (box.width * 0.7 - 20) * progress,
      y: box.y + (progress <= 0.5 ? 40 + 140 * progress : 110 - 130 * (progress - 0.5)),
    }] });
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(canvas).toHaveAttribute('data-test-pointer', 'touch');
  await expect(submit).toBeEnabled();
  await noOverflow(page, '390px handwriting');
  await capture(page, '03-mobile-handwriting', info);
  await submit.click();
  await expect(word(page)).toBeVisible();
  const snapshot = main(page).getByRole('img', { name: '本次提交的手写笔迹' });
  await expect(snapshot).toBeVisible();
  await expect.poll(() => snapshot.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const inkPixels = await snapshot.evaluate(element => {
    const image = element as HTMLImageElement;
    const bitmap = document.createElement('canvas');
    bitmap.width = image.naturalWidth; bitmap.height = image.naturalHeight;
    const ctx = bitmap.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let count = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 40) count++;
    return count;
  });
  expect(inkPixels).toBeGreaterThan(100);
  expect(JSON.stringify(await state(page))).not.toMatch(/data:image|blob:|image\/png|base64,/);
  await capture(page, '04-handwriting-self-assessment', info);
  await page.reload();
  await expect(main(page).getByRole('img', { name: '本次提交的手写笔迹' })).toHaveCount(0);
  await expect(main(page)).toContainText('笔迹未保留');
  const saved = await grade(page, '我写对了，下一词');
  expect(saved.events[0]).toMatchObject({ mode: 'handwriting', result: 'self-rated', hasInk: true, answer: null, requestedRating: 'good' });
  expect(JSON.stringify(saved)).not.toMatch(/data:image|blob:|image\/png|base64,/);
});

test('actual FSRS due time automatically resumes hidden cross-day review without a dashboard', async ({ page }, info) => {
  const start = Date.parse('2026-10-18T12:00:00Z');
  await page.clock.install({ time: new Date(start) });
  await open(page);
  const terms = new Map<string, string>();
  // Finish the real default daily allowance through the visible interface.
  for (let index = 0; index < 10; index++) {
    const { term, id } = await hideAnswer(page);
    terms.set(id, term);
    await typedMode(page);
    await submitTyped(page, term);
    await grade(page);
  }
  await expect.poll(async () => (await state(page)).session?.stage).toBe('done');
  await expect(page.getByTestId('queue-done')).toBeVisible();
  const initial = await state(page);
  expect(initial.events).toHaveLength(10);
  const reviewAt = Math.max(start + DAY, ...Object.values(initial.progress).map(progress => progress.dueAt)) + 60_000;
  await page.clock.setFixedTime(new Date(reviewAt));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('recall-prompt')).toBeVisible();
  await expect(word(page)).toHaveCount(0);
  const due = await state(page);
  const id = due.session!.queue[due.session!.index];
  expect(initial.progress[id]).toBeDefined();
  expect(initial.progress[id].dueAt).toBeLessThanOrEqual(reviewAt);
  await capture(page, '05-automatic-due-recall', info);
  await typedMode(page);
  await submitTyped(page, terms.get(id)!);
  const reviewed = await grade(page);
  expect(reviewed.events).toHaveLength(11);
  expect(new Set(reviewed.events.map(event => event.localDay)).size).toBe(2);
  expect(reviewed.events.at(-1)).toMatchObject({ wordId: id, revealed: false, hinted: false, result: 'correct', effectiveRating: 'good' });
  expect(reviewed.progress[id].dueAt).toBeGreaterThan(reviewAt);
  expect(reviewed.progress[id].fsrsCard?.due).toBe(reviewed.progress[id].dueAt);
  await page.reload();
  await expect(page.getByTestId('recall-prompt')).toBeVisible();
  expect((await state(page)).events).toEqual(reviewed.events);
  await info.attach('real-fsrs-due-evidence', { body: JSON.stringify({ initial, reviewAt, reviewed }, null, 2), contentType: 'application/json' });
});

test('a real 5000-plus-word library filters responsively, paginates, and queues a long word without losing current work', async ({ page }, info) => {
  await open(page);
  const term = (await word(page).innerText()).trim();
  const before = await state(page);
  const response = await page.request.get('data/core-lexicon.json');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type'], 'The public audit URL must serve JSON, not a SPA fallback').toContain('application/json');
  const lexicon = await response.json() as { metadata: { count: number }; entries: { term: string }[] };
  expect(lexicon.entries.length).toBeGreaterThanOrEqual(5_000);
  expect(lexicon.metadata.count).toBe(lexicon.entries.length);
  expect(new Set(lexicon.entries.map(entry => entry.term)).size).toBe(lexicon.entries.length);
  await openDrawer(page, '词库');
  const cards = drawer(page).locator('.cyber-library-card');
  const countText = await drawer(page).getByTestId('library-word-count').innerText();
  const count = Number(countText.replace(/,/g, '').match(/\d+/)?.[0]);
  expect(count).toBeGreaterThanOrEqual(lexicon.entries.length);
  await expect(cards).toHaveCount(40);
  const firstPage = await cards.first().innerText();
  await drawer(page).getByRole('button', { name: '下一页', exact: true }).click();
  await expect(cards.first()).not.toHaveText(firstPage);
  await drawer(page).getByRole('button', { name: '上一页', exact: true }).click();
  const timings: { query: string; milliseconds: number; hits: string }[] = [];
  const query = drawer(page).getByRole('searchbox', { name: '搜索词库' });
  for (const search of ['oxygen', 'landlord', 'thermostat', 'zzzznotawordzzzz', 'ab', '']) {
    const start = await page.evaluate(() => performance.now());
    await query.fill(search);
    await expect(query).toHaveValue(search);
    if (search === 'zzzznotawordzzzz') await expect(cards).toHaveCount(0);
    else if (search === '') await expect(cards).toHaveCount(40);
    else if (search === 'ab') await expect(cards).toHaveCount(40);
    // Search also matches definitions; e.g. "air" legitimately matches "oxygen".
    else await expect(cards.locator('strong').filter({ hasText: new RegExp(`^${search}$`, 'i') })).toHaveCount(1);
    // A frame must still be serviced after each real input and result update.
    await page.evaluate(() => new Promise<void>(resolveFrame => requestAnimationFrame(() => resolveFrame())));
    const duration = await page.evaluate(() => performance.now()) - start;
    expect(duration, `Filter ${search || '(all)'} should return within 2 seconds on this test PC`).toBeLessThan(2_000);
    timings.push({ query: search, milliseconds: Math.round(duration), hits: await drawer(page).getByTestId('library-word-count').innerText() });
  }
  const longTerm = [...lexicon.entries].sort((left, right) => right.term.length - left.term.length)[0].term;
  expect(longTerm.length).toBeGreaterThanOrEqual(16);
  await query.fill(longTerm);
  await expect(cards).toHaveCount(1);
  await cards.first().click();
  await page.getByRole('button', { name: '加入下一词', exact: true }).click();
  await expect(drawer(page)).not.toBeVisible();
  await expect(word(page)).toHaveText(term);
  const stillPending = await state(page);
  expect(stillPending.session!.queue[stillPending.session!.index]).toBe(before.session!.queue[before.session!.index]);
  expect(stillPending.events).toHaveLength(0);
  await hideAnswer(page);
  await typedMode(page);
  await submitTyped(page, term);
  // Seeing this word in the library is aided exposure, so any such flag must cap its rating.
  const next = main(page).getByRole('button', { name: nextName }).first();
  const selectedGrade = (await next.innerText()).startsWith('记住了') ? '记住了，下一词' : '需要再练，下一词';
  await grade(page, selectedGrade);
  await expect(word(page)).toHaveText(longTerm);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 740 });
    await noOverflow(page, `${width}px longest real word ${longTerm}`);
    const box = (await word(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    await capture(page, `08-long-word-${width}`, info);
  }
  await info.attach('library-scale-and-filter-timings', { body: JSON.stringify({ actualCoreEntries: lexicon.entries.length, visibleTotal: count, longTerm, timings }, null, 2), contentType: 'application/json' });
  await writeFile(info.outputPath('library-performance.json'), JSON.stringify({ actualCoreEntries: lexicon.entries.length, longTerm, timings }, null, 2));
});

test('offline learning and refresh preserve evidence; export restores and repeated import stays idempotent', async ({ page, context, browser }, info) => {
  await open(page);
  const { term } = await hideAnswer(page);
  await typedMode(page);
  await submitTyped(page, term);
  await grade(page);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 20_000 });
  const manifestResponse = await page.request.get('sw-manifest.json');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json() as { version: string; files: { url: string }[] };
  const cached = await page.evaluate(async () => Promise.all((await caches.keys()).filter(key => key.startsWith('wrieng:')).map(async key => ({ key, urls: (await (await caches.open(key)).keys()).map(request => request.url) }))));
  const activeCache = cached.find(cache => cache.key.endsWith(manifest.version));
  expect(activeCache).toBeDefined();
  expect(activeCache!.urls.slice().sort()).toEqual(manifest.files.map(file => new URL(file.url, page.url()).href).sort());
  await context.setOffline(true);
  await page.reload();
  await expect(word(page)).toBeVisible();
  expect((await state(page)).events).toHaveLength(1);
  const offlineTerm = await hideAnswer(page);
  await typedMode(page);
  await submitTyped(page, offlineTerm.term);
  const offlineSaved = await grade(page);
  expect(offlineSaved.events).toHaveLength(2);
  await openDrawer(page, '词库');
  await drawer(page).getByRole('searchbox', { name: '搜索词库' }).fill('oxygen');
  await expect(drawer(page).locator('.cyber-library-card strong').filter({ hasText: /^oxygen$/i })).toHaveCount(1);
  await drawer(page).getByRole('button', { name: '设置', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await drawer(page).getByRole('button', { name: '导出 JSON', exact: true }).click();
  const backupPath = info.outputPath('WriEng-v3-offline-backup.json');
  await (await downloadPromise).saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8')) as AppData;
  expect(backup.events).toEqual(offlineSaved.events);
  expect(backup.progress).toEqual(offlineSaved.progress);
  for (let repeat = 0; repeat < 2; repeat++) {
    await drawer(page).getByLabel('选择学习备份').setInputFiles(backupPath);
    await expect(page.locator('.cyber-toast')).toContainText('重复事件不会重复计分');
    await expect.poll(async () => (await state(page)).events).toEqual(offlineSaved.events);
    await expect(drawer(page).getByLabel('选择学习备份')).toHaveValue('');
  }
  await drawer(page).getByLabel('选择学习备份').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(drawer(page).getByRole('alert')).toContainText('导入未完成');
  expect((await state(page)).events).toEqual(offlineSaved.events);
  await capture(page, '09-offline-records-and-export', info);
  await context.setOffline(false);

  // Restore through the actual import UI into a second clean browser storage context.
  const restoredContext = await browser.newContext({ baseURL: info.project.use.baseURL, locale: 'zh-CN', timezoneId: 'UTC' });
  try {
    const restored = await restoredContext.newPage();
    observe(restored);
    await open(restored);
    expect((await state(restored)).events).toHaveLength(0);
    await openDrawer(restored, '设置');
    await drawer(restored).getByLabel('选择学习备份').setInputFiles(backupPath);
    await expect.poll(async () => (await state(restored)).events).toEqual(backup.events);
    expect((await state(restored)).progress).toEqual(backup.progress);
    await restored.reload();
    await expect(main(restored)).toBeVisible();
    expect((await state(restored)).events).toEqual(backup.events);
    expect((await state(restored)).progress).toEqual(backup.progress);
    await capture(restored, '10-restored-from-backup', info);
  } finally { await restoredContext.close(); }
  await info.attach('offline-cache-manifest', { body: JSON.stringify({ manifest, cached }, null, 2), contentType: 'application/json' });
});

test('direct learning reflows on desktop tablet 390 and 320px with persistent reduced motion', async ({ page, browser }, info) => {
  await open(page);
  for (const screen of [
    { name: '11-desktop-study', width: 1440, height: 1000 },
    { name: '12-tablet-study', width: 834, height: 1112 },
    { name: '13-mobile-study', width: 390, height: 844 },
    { name: '14-small-mobile-study', width: 320, height: 740 },
  ]) {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await expect(word(page)).toBeVisible();
    await noOverflow(page, screen.name);
    await capture(page, screen.name, info);
  }
  await openDrawer(page, '设置');
  const reduced = drawer(page).getByRole('checkbox', { name: /减少动态|减少动效|减少动画/ });
  await reduced.click();
  await expect(reduced).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.reload();
  await expect(word(page)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const reflow = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 720, height: 500 }, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'UTC', reducedMotion: 'reduce' });
  try {
    const zoomPage = await reflow.newPage();
    observe(zoomPage);
    await open(zoomPage);
    await noOverflow(zoomPage, '200 percent equivalent reflow');
    await capture(zoomPage, '15-200-percent-equivalent-reflow', info);
    await info.attach('reflow-method', { body: '720 CSS px × deviceScaleFactor 2 = 1440 physical px. This checks 200% equivalent reflow, not Chrome browser UI zoom.', contentType: 'text/plain' });
  } finally { await reflow.close(); }
});
