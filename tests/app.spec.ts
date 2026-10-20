import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AppData } from '../src/engine';

const screenshotDirectory = resolve('docs/screenshots-v2');
const DAY = 86_400_000;
let pageErrors: string[] = [];
let consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await mkdir(screenshotDirectory, { recursive: true });
});

test.afterEach(async ({}, info) => {
  await info.attach('browser-errors', { body: JSON.stringify({ pageErrors, consoleErrors }, null, 2), contentType: 'application/json' });
  expect(pageErrors, 'No uncaught page errors').toEqual([]);
  // Expected offline network diagnostics remain in the attached evidence.
  const unexpected = info.title.includes('offline')
    ? consoleErrors.filter(message => !/ERR_INTERNET_DISCONNECTED|Failed to update a ServiceWorker/i.test(message))
    : consoleErrors;
  expect(unexpected, 'No unexpected browser console errors').toEqual([]);
});

async function screenshot(page: Page, name: string, info?: TestInfo) {
  const path = resolve(screenshotDirectory, `${name}.png`);
  // Let transient UI clear naturally, and capture fixed study overlays as an actual viewport.
  await expect(page.locator('.toast')).toHaveCount(0);
  const isOverlay = await page.getByRole('dialog').count() > 0;
  await page.screenshot({ path, fullPage: !isOverlay, animations: 'disabled' });
  if (info) await info.attach(name, { path, contentType: 'image/png' });
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

async function openHome(page: Page) {
  await page.goto('/');
  await expect(page.locator('.home-hero h1')).toBeVisible();
  await expect(page.locator('.hero-actions .primary')).toBeEnabled();
}

async function onboarding(page: Page) {
  await openHome(page);
  await page.getByRole('button', { name: '开始今日投递', exact: true }).click();
  const plan = page.getByRole('dialog', { name: /给自己的学习计划/ });
  await expect(plan).toBeVisible();
  await plan.getByRole('button', { name: '美国日常', exact: true }).click();
  await plan.getByLabel('每天愿意留多少时间？').selectOption('5');
  await plan.getByRole('button', { name: '保存我的计划' }).click();
  await expect(plan).not.toBeVisible();
  await page.getByRole('button', { name: '开始今日投递', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '今日投递练习' })).toBeVisible();
}

function study(page: Page) { return page.getByRole('dialog', { name: '今日投递练习' }); }
function navigation(page: Page) { return page.getByRole('navigation', { name: '主要导航' }); }

async function prepareTyped(page: Page) {
  const panel = study(page);
  const term = (await panel.locator('.display-word').textContent())!.trim();
  const id = (await state(page)).session!.queue[(await state(page)).session!.index];
  await panel.getByRole('button', { name: '藏起答案，开始回忆' }).click();
  await expect(panel.locator('.display-word')).toHaveCount(0);
  await expect(panel.locator('.answer-reveal')).toHaveCount(0);
  await panel.getByRole('button', { name: '键盘输入' }).click();
  await expect(panel.getByRole('textbox', { name: '输入你回忆的英文' })).toBeVisible();
  return { term, id };
}

async function submitTyped(page: Page, answer: string) {
  const panel = study(page);
  await panel.getByRole('textbox', { name: '输入你回忆的英文' }).fill(answer);
  await panel.getByRole('button', { name: '提交并揭晓' }).click();
  await expect(panel.locator('.answer-reveal')).toBeVisible();
}

async function good(page: Page) {
  const before = await state(page);
  await study(page).getByRole('button', { name: '独立想起了' }).click();
  await expect.poll(async () => (await state(page)).events.length).toBe(before.events.length + 1);
  await expect.poll(async () => (await state(page)).session?.index).toBe(before.session!.index + 1);
}

async function closeStudy(page: Page) {
  await study(page).getByRole('button', { name: '保存退出' }).click();
  await expect(study(page)).not.toBeVisible();
}

test('onboarding → hidden typed recall → feedback → rating → refresh restores IndexedDB session', async ({ page }, info) => {
  await page.clock.install({ time: new Date('2026-10-17T09:00:00Z') });
  await onboarding(page);
  const { term, id } = await prepareTyped(page);
  await expect(study(page).getByRole('button', { name: '提交并揭晓' })).toBeDisabled();
  await submitTyped(page, term.toUpperCase());
  await expect(study(page).getByText('拼写一致。这个词，你找回来了。')).toBeVisible();
  const before = await state(page);
  expect(before.session?.stage).toBe('feedback');
  expect(before.events).toHaveLength(0);
  const submittedAt = Number(before.session?.submittedAt);
  expect(Number.isSafeInteger(submittedAt)).toBe(true);
  expect(submittedAt).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await screenshot(page, '04-typed-feedback', info);
  await page.reload();
  await page.getByRole('button', { name: '继续上次投递', exact: true }).click();
  await expect(study(page).locator('.original-answer')).toContainText(term.toUpperCase());
  expect((await state(page)).session?.submittedAt).toBe(submittedAt);
  const gradeAt = submittedAt + 5 * 60_000;
  await page.clock.setFixedTime(new Date(gradeAt));
  await good(page);
  const saved = await state(page);
  expect(saved.events[0]).toMatchObject({ wordId: id, mode: 'typed', result: 'correct', effectiveRating: 'good', answer: term.toUpperCase(), hasInk: false });
  expect(saved.events[0].submittedAt).toBe(submittedAt);
  expect(saved.events[0].at).toBe(gradeAt);
  expect(saved.events[0].at - saved.events[0].submittedAt).toBe(300_000);
  expect(saved.schemaVersion).toBe(2);
  expect(saved.events[0].schedulerVersion).toMatch(/fsrs6/);
  expect(saved.progress[id].dueAt).toBeGreaterThan(saved.events[0].at);
  expect(saved.progress[id].fsrsCard?.due).toBe(saved.progress[id].dueAt);
  expect(saved.session?.index).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: '继续上次投递', exact: true }).click();
  await expect(study(page).locator('.study-count')).toContainText('2 / 5');
  expect((await state(page)).events).toHaveLength(1);
});

test('handwriting rejects blank and tap, accepts real strokes, and stores only honest self assessment', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboarding(page);
  const panel = study(page);
  await panel.getByRole('button', { name: '藏起答案，开始回忆' }).click();
  const submit = panel.getByRole('button', { name: '提交并揭晓' });
  await expect(submit).toBeDisabled();
  const canvas = panel.getByRole('img', { name: '手写回忆区' });
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await canvas.scrollIntoViewIfNeeded();
  const tapBox = (await canvas.boundingBox())!;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tapBox.x + 20, y: tapBox.y + 30 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(submit).toBeDisabled();
  await panel.getByRole('button', { name: '撤销一笔' }).click();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await canvas.evaluate(element => element.addEventListener('pointerdown', event => {
    (element as HTMLElement).dataset.testPointer = (event as PointerEvent).pointerType;
  }, { once: true }));
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 20, y: box.y + 40 }] });
  for (let index = 1; index <= 24; index++) {
    const progress = index / 24;
    const x = box.x + 20 + (box.width * 0.7 - 20) * progress;
    const y = box.y + (progress <= 0.5 ? 40 + 140 * progress : 110 - 130 * (progress - 0.5));
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(canvas).toHaveAttribute('data-test-pointer', 'touch');
  await expect(submit).toBeEnabled();
  await screenshot(page, '05-mobile-handwriting', info);
  await submit.click();
  await expect(panel.getByText('手写自评 · 无 OCR')).toBeVisible();
  await expect(panel.getByText('请对照刚才写下的答案，自评回忆情况。')).toBeVisible();
  const snapshot = panel.getByRole('img', { name: '本次提交的手写笔迹' });
  await expect(snapshot).toBeVisible();
  await expect(snapshot).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect.poll(() => snapshot.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const darkPixels = await snapshot.evaluate(element => {
    const image = element as HTMLImageElement;
    const bitmap = document.createElement('canvas');
    bitmap.width = image.naturalWidth;
    bitmap.height = image.naturalHeight;
    const context = bitmap.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let dark = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] > 40 && pixels[offset] + pixels[offset + 1] + pixels[offset + 2] < 600) dark++;
    }
    return dark;
  });
  expect(darkPixels).toBeGreaterThan(100);
  expect(JSON.stringify(await state(page))).not.toMatch(/data:image|blob:|image\/png|base64,/);
  await snapshot.scrollIntoViewIfNeeded();
  await screenshot(page, '11-handwriting-self-assessment', info);
  await page.reload();
  await page.getByRole('button', { name: '继续上次投递', exact: true }).click();
  await expect(panel.getByRole('img', { name: '本次提交的手写笔迹' })).toHaveCount(0);
  await expect(panel.getByText('笔迹未保留：刷新或退出后，原始笔迹会释放。若无法确认，请选择需要再练。')).toBeVisible();
  await good(page);
  expect((await state(page)).events[0]).toMatchObject({ mode: 'handwriting', result: 'self-rated', hasInk: true, answer: null, requestedRating: 'good' });
  expect(JSON.stringify(await state(page))).not.toMatch(/data:image|blob:|image\/png|base64,/);
});

test('an incorrect typed answer cannot claim Good and schedules a short corrective retry', async ({ page }) => {
  await onboarding(page);
  await prepareTyped(page);
  await submitTyped(page, 'this-is-deliberately-wrong');
  await expect(study(page).getByRole('button', { name: '独立想起了' })).toHaveCount(0);
  await study(page).getByRole('button', { name: '需要再练' }).click();
  await expect.poll(async () => (await state(page)).events.length).toBe(1);
  const saved = await state(page);
  const event = saved.events[0];
  expect(event.result).toBe('incorrect');
  expect(event.answer).toBe('this-is-deliberately-wrong');
  const retryAfter = saved.progress[event.wordId].dueAt - event.at;
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(60 * 60_000);
  expect(event.schedulerVersion).toMatch(/fsrs6/);
});

test('due next day uses real elapsed scheduling and creates cross day recall evidence', async ({ page }, info) => {
  const firstDay = Date.parse('2026-10-17T12:00:00Z');
  await page.clock.install({ time: new Date(firstDay) });
  await onboarding(page);
  const terms = new Map<string, string>();
  for (let index = 0; index < 5; index++) {
    const { term, id } = await prepareTyped(page);
    terms.set(id, term);
    await submitTyped(page, term);
    await good(page);
  }
  await expect(study(page).getByRole('heading', { name: '今天的信，送到了。' })).toBeVisible();
  await study(page).getByRole('button', { name: '回到词汇邮局' }).click();
  const initial = await state(page);
  expect(initial.events).toHaveLength(5);
  // Advance beyond actual FSRS due dates rather than assuming v1's 1-day step.
  const reviewAt = Math.max(firstDay + DAY, ...Object.values(initial.progress).map(progress => progress.dueAt)) + 60_000;
  await page.clock.setFixedTime(new Date(reviewAt));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.stat-card').first().locator('strong')).toContainText('5');
  await screenshot(page, '06-next-day-due', info);
  await page.getByRole('button', { name: '开始今日投递', exact: true }).click();
  await expect(study(page).getByText('到期复习 · 新情境')).toBeVisible();
  await expect(study(page).locator('.display-word')).toHaveCount(0);
  const dueState = await state(page);
  const firstId = dueState.session!.queue[0];
  expect(initial.progress[firstId]).toBeDefined();
  await study(page).getByRole('button', { name: '键盘输入' }).click();
  await submitTyped(page, terms.get(firstId)!);
  await good(page);
  const reviewed = await state(page);
  expect(reviewed.events).toHaveLength(6);
  expect(new Set(reviewed.events.map(event => event.localDay)).size).toBe(2);
  expect(reviewed.events.at(-1)?.schedulerVersion).toMatch(/fsrs6/);
  expect(reviewed.progress[firstId].dueAt).toBeGreaterThan(reviewAt);
  expect(reviewed.progress[firstId].fsrsCard?.due).toBe(reviewed.progress[firstId].dueAt);
  await closeStudy(page);
  await expect(page.locator('.stat-card').nth(2).locator('strong')).toContainText('1');
});

test('export and repeated import merge unchanged events; invalid backup leaves data intact', async ({ page }, info) => {
  await onboarding(page);
  const { term } = await prepareTyped(page);
  await submitTyped(page, term);
  await good(page);
  await closeStudy(page);
  await navigation(page).getByRole('button', { name: '学习记录', exact: true }).click();
  const before = await state(page);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON' }).click();
  const download = await downloadEvent;
  const backupPath = info.outputPath('WriEng-backup.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8')) as AppData;
  expect(backup.events).toEqual(before.events);
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.getByLabel('选择学习备份').setInputFiles(backupPath);
    await expect(page.locator('.toast')).toContainText('重复事件不会重复计分');
    await expect(page.getByLabel('选择学习备份')).toHaveValue('');
    expect((await state(page)).events).toEqual(before.events);
  }
  await page.getByLabel('选择学习备份').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('alert')).toContainText('导入未完成');
  expect((await state(page)).events).toEqual(before.events);
  await page.getByRole('button', { name: '关闭提示' }).click();
  await screenshot(page, '07-records-and-backup', info);
});

test('v1 backup migration preserves old evidence and due dates; new FSRS reviews survive export import and refresh', async ({ page, browser }, info) => {
  const fixturePath = resolve('src/fixtures/v1-progress.json');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as {
    schemaVersion: number;
    events: AppData['events'];
    progress: Record<string, { dueAt: number; lastEventId: string }>;
  };
  const reviewAt = Math.max(...Object.values(fixture.progress).map(progress => progress.dueAt)) + 60_000;
  await page.clock.install({ time: new Date(reviewAt) });
  await openHome(page);
  await navigation(page).getByRole('button', { name: '学习记录', exact: true }).click();
  await page.getByLabel('选择学习备份').setInputFiles(fixturePath);
  await expect.poll(async () => (await state(page)).schemaVersion).toBe(2);
  await expect.poll(async () => (await state(page)).events.length).toBe(fixture.events.length);
  const migrated = await state(page);
  expect(migrated.events).toEqual(fixture.events);
  expect(migrated.scheduler).toMatchObject({ algorithm: 'FSRS-6', packageVersion: '5.4.2', parameterSetId: 'wrieng-fsrs6-retention90-v1' });
  expect(migrated.scheduler.parameters.w).toHaveLength(21);
  for (const [id, progress] of Object.entries(fixture.progress)) {
    expect(migrated.progress[id].dueAt).toBe(progress.dueAt);
    expect(migrated.legacyScheduleAnchors[progress.lastEventId]).toMatchObject({ wordId: id, dueAt: progress.dueAt });
  }
  const oldDownloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出升级前快照', exact: true }).click();
  const oldBackupPath = info.outputPath('WriEng-original-v1.json');
  await (await oldDownloadEvent).saveAs(oldBackupPath);
  expect(JSON.parse(await readFile(oldBackupPath, 'utf8'))).toEqual(fixture);
  await screenshot(page, '17-v1-migrated-records', info);
  await page.reload();
  expect((await state(page)).events).toEqual(fixture.events);
  for (const [id, progress] of Object.entries(fixture.progress)) expect((await state(page)).progress[id].dueAt).toBe(progress.dueAt);

  await page.getByRole('button', { name: '开始今日投递', exact: true }).click();
  const panel = study(page);
  await expect(panel).toBeVisible();
  await expect(panel.locator('.display-word')).toHaveCount(0);
  const session = (await state(page)).session!;
  expect(session.queue[0]).toBe('receipt-noun-1');
  await panel.getByRole('button', { name: '键盘输入' }).click();
  await submitTyped(page, 'receipt');
  await good(page);
  const reviewed = await state(page);
  expect(reviewed.events.slice(0, fixture.events.length)).toEqual(fixture.events);
  const event = reviewed.events.at(-1)!;
  expect(event).toMatchObject({ wordId: 'receipt-noun-1', answer: 'receipt', mode: 'typed', result: 'correct', schedulerVersion: 'ts-fsrs-5.4.2-fsrs6-wrieng-v2', parameterSetId: 'wrieng-fsrs6-retention90-v1' });
  expect(reviewed.progress[event.wordId].dueAt).toBeGreaterThan(reviewAt);
  expect(reviewed.progress[event.wordId].fsrsCard?.due).toBe(reviewed.progress[event.wordId].dueAt);
  await closeStudy(page);
  await navigation(page).getByRole('button', { name: '学习记录', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const backupPath = info.outputPath('WriEng-schema2-migrated.json');
  await (await downloadEvent).saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8')) as AppData;
  expect(backup.events).toEqual(reviewed.events);
  expect(backup.progress).toEqual(reviewed.progress);
  await page.getByLabel('选择学习备份').setInputFiles(backupPath);
  await expect(page.locator('.toast')).toContainText('重复事件不会重复计分');
  expect((await state(page)).events).toEqual(reviewed.events);

  const restoredContext = await browser.newContext({ baseURL: info.project.use.baseURL, locale: 'zh-CN', timezoneId: 'UTC' });
  try {
    const restored = await restoredContext.newPage();
    restored.on('pageerror', error => pageErrors.push(error.message));
    await restored.clock.install({ time: new Date(reviewAt) });
    await openHome(restored);
    await navigation(restored).getByRole('button', { name: '学习记录', exact: true }).click();
    await restored.getByLabel('选择学习备份').setInputFiles(backupPath);
    await expect.poll(async () => (await state(restored)).events.length).toBe(reviewed.events.length);
    await restored.reload();
    expect((await state(restored)).events).toEqual(reviewed.events);
    expect((await state(restored)).progress).toEqual(reviewed.progress);
  } finally { await restoredContext.close(); }
  await info.attach('migration-evidence', { body: JSON.stringify({ original: fixture, migrated, reviewed }, null, 2), contentType: 'application/json' });
});

test('offline service worker caches complete app; navigation and reload preserve learning', async ({ page, context }, info) => {
  await onboarding(page);
  const { term } = await prepareTyped(page);
  await submitTyped(page, term);
  await good(page);
  await closeStudy(page);
  await expect(page.locator('.connection')).toHaveText('离线词库已就绪', { timeout: 20_000 });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const before = await state(page);
  const manifestResponse = await page.request.get('/sw-manifest.json');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json() as { version: string; files: { url: string; bytes: number; sha256: string }[] };
  expect(manifest.files.some(file => /WorldScene-.+\.js$/.test(file.url))).toBe(true);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    return Promise.all(keys.filter(key => key.startsWith('wrieng:')).map(async key => ({ key, urls: (await (await caches.open(key)).keys()).map(request => request.url) })));
  });
  const currentCache = cached.find(cache => cache.key.endsWith(manifest.version));
  expect(currentCache, 'Generated build version is the active complete offline cache').toBeDefined();
  expect(currentCache!.urls.slice().sort()).toEqual(manifest.files.map(file => new URL(file.url, page.url()).href).sort());
  await info.attach('offline-cache', { body: JSON.stringify(cached, null, 2), contentType: 'application/json' });
  await context.setOffline(true);
  await expect(page.locator('.network-bar')).toContainText('可继续学习');
  await navigation(page).getByRole('button', { name: '词库', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索词库' }).fill(term);
  await expect(page.locator('.word-card strong')).toContainText([term]);
  await navigation(page).getByRole('button', { name: '旅程地图', exact: true }).click();
  await expect(page.getByTestId('journey-map')).toHaveAttribute('data-mode', '3d');
  await expect(page.getByTestId('journey-webgl')).toHaveAttribute('data-renderer', 'webgl2');
  await page.reload();
  await expect(page.locator('.home-hero h1')).toBeVisible();
  await expect(page.locator('.network-bar')).toContainText('可继续学习');
  expect((await state(page)).events).toEqual(before.events);
  await screenshot(page, '08-offline-restored', info);
  await page.getByRole('button', { name: '继续上次投递', exact: true }).click();
  await expect(study(page).locator('.display-word')).toBeVisible();
  await context.setOffline(false);
});

test('navigation, searchable sourced word details, keyboard modal close and reduced motion persist', async ({ page }, info) => {
  await openHome(page);
  await navigation(page).getByRole('button', { name: '词库', exact: true }).click();
  const frequencyResponse = await page.request.get('/data/frequency-table.json');
  expect(frequencyResponse.ok()).toBe(true);
  const frequencyTable = await frequencyResponse.json() as { metadata: { termCount: number; sourceVersion: string }; terms: Record<string, number> };
  const displayedTerms = await page.locator('.word-card strong').allTextContents();
  expect(displayedTerms.length).toBeGreaterThan(100);
  expect(displayedTerms.length).toBe(frequencyTable.metadata.termCount);
  expect(frequencyTable.metadata.sourceVersion).toBe('3.1.1');
  await expect(page.locator('.collection-summary')).toContainText(`${displayedTerms.length} 个词义`);
  const frequencies = displayedTerms.map(term => frequencyTable.terms[term]);
  expect(frequencies.every(value => Number.isFinite(value))).toBe(true);
  expect(frequencies.every((value, index) => index === 0 || value <= frequencies[index - 1])).toBe(true);
  await page.getByRole('combobox', { name: '词库排序' }).selectOption('alphabetical');
  const alphabetical = await page.locator('.word-card strong').allTextContents();
  expect(alphabetical).toEqual([...displayedTerms].sort((left, right) => left.localeCompare(right, 'en')));
  await page.getByRole('combobox', { name: '词库排序' }).selectOption('frequency');
  const firstTerm = (await page.locator('.word-card strong').first().textContent())!.trim();
  await expect(page.locator('.word-card').first().locator('.word-frequency')).toContainText(frequencyTable.terms[firstTerm].toFixed(2));
  await page.getByRole('textbox', { name: '搜索词库' }).fill(firstTerm);
  await page.locator('.word-card').first().click();
  const wordModal = page.getByRole('dialog', { name: '词义与来源' });
  await expect(wordModal.locator('.display-word')).toHaveText(firstTerm);
  await wordModal.getByText('逐字段来源记录').click();
  await expect(wordModal.locator('pre')).toContainText('CC0-1.0');
  await expect(wordModal.locator('pre')).toContainText('CC-BY-SA-4.0');
  await expect(wordModal.locator('.detail-frequency')).toContainText(frequencyTable.terms[firstTerm].toFixed(2));
  await expect(wordModal.locator('.word-provenance')).toContainText('考试频率仍未知');
  await info.attach('frequency-ui-evidence', { body: JSON.stringify({ total: displayedTerms.length, firstTerm, firstZipf: frequencyTable.terms[firstTerm], sourceVersion: frequencyTable.metadata.sourceVersion }), contentType: 'application/json' });
  await screenshot(page, '18-frequency-and-provenance', info);
  await page.keyboard.press('Escape');
  await expect(wordModal).not.toBeVisible();
  await navigation(page).getByRole('button', { name: '旅程地图', exact: true }).click();
  await expect(page.getByTestId('journey-map')).toHaveAttribute('data-reason', 'ready', { timeout: 20_000 });
  await expect(page.locator('[data-testid^="journey-menu-"]')).toHaveCount(4);
  await screenshot(page, '09-journey-map', info);
  await navigation(page).getByRole('button', { name: '学习记录', exact: true }).click();
  // This controlled preference becomes checked after its IndexedDB transaction commits.
  await page.getByRole('checkbox').click();
  await expect(page.getByRole('checkbox')).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await expect(page.locator('.home-hero h1')).toBeVisible();
});

test('desktop tablet mobile and 200 percent equivalent reflow have no horizontal overflow', async ({ page, browser }, info) => {
  for (const screen of [
    { name: '00-desktop-home', width: 1440, height: 1000 },
    { name: '01-tablet-home', width: 834, height: 1112 },
    { name: '02-mobile-home', width: 390, height: 844 },
    { name: '03-small-mobile-home', width: 320, height: 740 },
  ]) {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await openHome(page);
    await expect(page.locator('.home-hero h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), screen.name).toBe(true);
    await screenshot(page, screen.name, info);
  }
  // A 720 CSS-pixel layout at 2x scale is the effective reflow of a 1440px desktop at 200%.
  // This verifies equivalent layout; it does not claim to change Chrome's browser UI zoom.
  const context = await browser.newContext({ viewport: { width: 720, height: 500 }, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'UTC' });
  const zoomPage = await context.newPage();
  zoomPage.on('pageerror', error => pageErrors.push(error.message));
  zoomPage.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await zoomPage.goto(new URL('/', page.url()).href);
  await expect(zoomPage.locator('.home-hero h1')).toBeVisible();
  expect(await zoomPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await screenshot(zoomPage, '10-200-percent-equivalent-reflow', info);
  await info.attach('zoom-method', { body: '200% equivalent reflow: 720 CSS pixels × deviceScaleFactor 2 = 1440 physical pixels. Not native browser UI zoom.', contentType: 'text/plain' });
  await context.close();
});
