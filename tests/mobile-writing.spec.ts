import { test, expect, type Page, type Locator, type TestInfo } from '@playwright/test';
import type { AppData } from '../src/engine';

// Each test gets a fresh mobile context in a separate headless browser process.
// CDP touch events exercise the actual touch-to-pointer path, not mouse events.
async function state(page: Page): Promise<AppData> {
  return page.evaluate(() => new Promise<AppData>((resolve, reject) => {
    const request = indexedDB.open('wrieng-learning', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('app', 'readonly');
      const read = transaction.objectStore('app').get('state');
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => database.close();
    };
  }));
}

async function writeState(page: Page, data: AppData) {
  await page.evaluate(data => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('wrieng-learning', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('app', 'readwrite');
      transaction.objectStore('app').put(data, 'state');
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), data);
}

async function open(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('study-word')).toBeVisible();
  await expect.poll(async () => Boolean((await state(page))?.session)).toBe(true);
}

async function recall(page: Page, mode: 'handwriting' | 'typed' = 'handwriting') {
  await page.locator('.cyber-stage-study .cyber-actions button').first().click();
  await expect(page.getByTestId('recall-prompt')).toBeVisible();
  const desired = page.locator('.cyber-mode-tabs button').nth(mode === 'handwriting' ? 0 : 1);
  if (await desired.getAttribute('aria-pressed') !== 'true') await desired.click();
  await expect.poll(async () => (await state(page)).session?.mode).toBe(mode);
}

async function inkPixels(canvas: Locator) {
  return canvas.evaluate(element => {
    const bitmap = element as HTMLCanvasElement;
    const pixels = bitmap.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let count = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 32) count++;
    return count;
  });
}

async function drawTouch(page: Page, canvas: Locator, cancel = false) {
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  const point = (progress: number) => ({
    x: box.x + box.width * (0.14 + 0.64 * progress),
    y: box.y + box.height * (0.4 + Math.sin(progress * Math.PI * 2) * 0.16),
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(0)] });
  for (let index = 1; index <= 18; index++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(index / 18)] });
  }
  await touch.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  await touch.detach();
}

async function withinViewport(page: Page, locator: Locator, label: string) {
  const box = (await locator.boundingBox())!;
  const viewport = await page.evaluate(() => ({
    width: window.visualViewport?.width || innerWidth,
    height: window.visualViewport?.height || innerHeight,
    x: window.visualViewport?.offsetLeft || 0,
    y: window.visualViewport?.offsetTop || 0,
  }));
  expect(box.width, label).toBeGreaterThan(0);
  expect(box.height, label).toBeGreaterThan(0);
  expect(box.x, label).toBeGreaterThanOrEqual(viewport.x - 2);
  expect(box.y, label).toBeGreaterThanOrEqual(viewport.y - 2);
  expect(box.x + box.width, label).toBeLessThanOrEqual(viewport.x + viewport.width + 2);
  expect(box.y + box.height, label).toBeLessThanOrEqual(viewport.y + viewport.height + 2);
}

async function capture(page: Page, name: string, info: TestInfo) {
  await info.attach(name, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  (page as Page & { mobileErrors?: string[] }).mobileErrors = errors;
  await page.addInitScript(() => {
    (window as Window & { mobileDrags?: number }).mobileDrags = 0;
    document.addEventListener('dragstart', () => {
      const target = window as Window & { mobileDrags?: number };
      target.mobileDrags = (target.mobileDrags || 0) + 1;
    });
  });
});

test.afterEach(async ({ page, browser }, info) => {
  const errors = (page as Page & { mobileErrors?: string[] }).mobileErrors || [];
  await info.attach('isolated-mobile-environment', { contentType: 'application/json', body: JSON.stringify({
    browserVersion: browser.version(), headless: true,
    profile: 'Playwright temporary profile; no connection to user Chrome',
    emulation: 'iPhone 13 viewport, mobile user agent, touch and DPR; Chromium engine',
    realHardware: false, url: page.url(), errors,
  }, null, 2) });
  expect(errors, 'No uncaught runtime errors in the mobile context').toEqual([]);
});

test('library preference replaces an excluded stale question and preserves real learning history', async ({ page }) => {
  await open(page);
  const learnedTerm = (await page.getByTestId('study-word').innerText()).trim();
  await recall(page, 'typed');
  await page.locator('.cyber-recall-input').fill(learnedTerm);
  await page.locator('.cyber-recall-form button[type="submit"]').click();
  await expect(page.locator('.cyber-stage-feedback')).toBeVisible();
  await page.locator('.cyber-grade-buttons button').first().click();
  await expect.poll(async () => (await state(page)).events.length).toBe(1);
  const history = await state(page);
  const current = history.progress['receipt-noun-1'] ? 'refund-noun-1' : 'receipt-noun-1';
  const seeded: AppData = { ...history, settings: { ...history.settings, selectedDecks: ['daily'] }, session: {
    id: 'mobile-stale-library-question', queue: [current], index: 0, stage: 'recall', mode: 'typed',
    startedAt: Date.now(), presentedAt: Date.now(), response: 'stale-original-answer', hasInk: true,
    hinted: true, revealed: true, retry: true, forgot: true, correct: true, submittedAt: Date.now(),
    nextWordIds: ['receipt-noun-1'], skippedWordIds: [],
  } };
  await writeState(page, seeded);
  await page.reload();
  await expect(page.locator('.cyber-recall-input')).toHaveValue('stale-original-answer');
  await page.locator('.cyber-tools-button').click();
  const choices = page.locator('.cyber-settings fieldset input[type="checkbox"]');
  await choices.nth(4).check(); // GRE, after All / IELTS / TOEFL / CET6.
  await expect.poll(async () => (await state(page)).settings.selectedDecks.includes('gre')).toBe(true);
  await choices.nth(5).uncheck(); // Remove the daily-only introductions.
  await expect.poll(async () => (await state(page)).settings.selectedDecks).toEqual(['gre']);
  const changed = await state(page);
  expect(changed.session?.id).not.toBe(seeded.session!.id);
  expect(changed.session?.queue).not.toContain(current);
  expect(changed.session).toMatchObject({ index: 0, response: '', hasInk: false, hinted: false, revealed: false,
    retry: false, forgot: false, correct: false, nextWordIds: [] });
  expect(changed.session?.submittedAt).toBeUndefined();
  expect(changed.events).toEqual(history.events);
  expect(changed.progress).toEqual(history.progress);
  await page.locator('.cyber-close').click();
  await expect(page.getByTestId('study-word')).toBeVisible();
  await recall(page, 'typed');
  await expect(page.locator('.cyber-recall-input')).toHaveValue('');
});

test('setting zero new words removes the current unlearned question immediately', async ({ page }) => {
  await open(page);
  const before = await state(page);
  await recall(page, 'typed');
  await page.locator('.cyber-recall-input').fill('discard-this-old-answer');
  await page.locator('.cyber-tools-button').click();
  await page.locator('.cyber-settings select').selectOption('0');
  await expect.poll(async () => (await state(page)).settings.dailyNewLimit).toBe(0);
  await page.locator('.cyber-close').click();
  await expect(page.getByTestId('queue-done')).toBeVisible();
  await expect(page.locator('.cyber-recall-input')).toHaveCount(0);
  const after = await state(page);
  expect(after.events).toEqual(before.events);
  expect(after.progress).toEqual(before.progress);
});

test('real touch strokes prevent selection and page drag, recover after cancellation, and leave inputs and scrolling usable', async ({ page }, info) => {
  await open(page);
  await recall(page);
  const canvas = page.locator('.ink-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const startScroll = await page.evaluate(() => scrollY);
  await drawTouch(page, canvas, true);
  await expect.poll(() => inkPixels(canvas)).toBeGreaterThan(100);
  await drawTouch(page, canvas);
  await expect(page.locator('.cyber-ink-frame > button.cyber-primary')).toBeEnabled();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
  expect(await page.evaluate(() => (window as Window & { mobileDrags?: number }).mobileDrags)).toBe(0);
  expect(Math.abs(await page.evaluate(() => scrollY) - startScroll)).toBeLessThanOrEqual(2);
  const styles = await canvas.evaluate(element => ({
    touchAction: getComputedStyle(element).touchAction, userSelect: getComputedStyle(element).userSelect,
  }));
  expect(styles).toEqual({ touchAction: 'none', userSelect: 'none' });
  await capture(page, 'mobile-touch-ink-no-selection', info);
  await page.getByTestId('ink-fullscreen-toggle').click();
  await page.getByTestId('ink-fullscreen-exit').click();
  await page.locator('.cyber-mode-tabs button').nth(1).click();
  await page.locator('.cyber-recall-input').fill('normal editable input');
  await expect(page.locator('.cyber-recall-input')).toHaveValue('normal editable input');
  expect(await page.locator('.cyber-recall-input').evaluate(element => getComputedStyle(element).userSelect)).not.toBe('none');
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  // The short typed-recall page can fit entirely on a phone. Use the genuinely
  // scrollable settings drawer to test normal touch scrolling after drawing.
  await page.locator('.cyber-tools-button').click();
  const drawer = page.locator('.cyber-drawer');
  expect(await drawer.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
  const box = (await drawer.boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  const position = (progress: number) => ({ x: box.x + box.width * 0.8, y: box.y + box.height * (0.8 - 0.55 * progress) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [position(0)] });
  for (let index = 1; index <= 12; index++) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [position(index / 12)] });
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => drawer.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await touch.detach();
});

for (const fullscreen of ['denied', 'unavailable'] as const) {
  test(`fullscreen ${fullscreen} falls back, survives portrait/landscape resizing, and submits ink`, async ({ page }, info) => {
    await page.addInitScript(kind => {
      Object.defineProperty(Element.prototype, 'requestFullscreen', {
        configurable: true, writable: true,
        value: kind === 'unavailable' ? undefined : () => Promise.reject(new DOMException('Denied in mobile test', 'NotAllowedError')),
      });
    }, fullscreen);
    await open(page);
    await recall(page);
    const canvas = page.locator('.ink-canvas');
    await drawTouch(page, canvas);
    const oldCanvas = await canvas.elementHandle();
    await page.getByTestId('ink-fullscreen-toggle').click();
    const panel = page.locator('.ink-pad[data-fullscreen="true"]');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('ink-fullscreen-prompt')).toBeVisible();
    await expect(page.getByTestId('ink-fullscreen-submit')).toBeEnabled();
    expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    await expect.poll(() => inkPixels(canvas)).toBeGreaterThan(100);
    await withinViewport(page, page.getByTestId('ink-fullscreen-exit'), 'portrait exit');
    await withinViewport(page, page.getByTestId('ink-fullscreen-submit'), 'portrait submit');
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(async () => Math.round((await canvas.boundingBox())!.width)).toBeGreaterThan(700);
    await expect.poll(async () => Math.round((await canvas.boundingBox())!.height)).toBeGreaterThan(210);
    await withinViewport(page, canvas, 'landscape canvas');
    await withinViewport(page, page.getByTestId('ink-fullscreen-exit'), 'landscape exit');
    await withinViewport(page, page.getByTestId('ink-fullscreen-submit'), 'landscape submit');
    await expect.poll(() => inkPixels(canvas)).toBeGreaterThan(100);
    expect(await oldCanvas!.evaluate(element => element === document.querySelector('.ink-canvas'))).toBe(true);
    await capture(page, `landscape-fullscreen-${fullscreen}`, info);
    await page.getByTestId('ink-fullscreen-exit').click();
    await expect(panel).toHaveCount(0);
    await expect.poll(() => inkPixels(canvas)).toBeGreaterThan(100);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('ink-fullscreen-toggle').click();
    await expect(page.getByTestId('ink-fullscreen-submit')).toBeEnabled();
    await page.getByTestId('ink-fullscreen-submit').click();
    await expect(page.locator('.cyber-stage-feedback')).toBeVisible();
    const submitted = await state(page);
    expect(submitted.session).toMatchObject({ stage: 'feedback', mode: 'handwriting', hasInk: true });
    await expect(page.locator('.cyber-original-ink img')).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });
}

test('native fullscreen entry and clear/exit controls remain usable in a small landscape viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await open(page);
  await recall(page);
  await page.getByTestId('ink-fullscreen-toggle').click();
  await expect(page.locator('.ink-pad[data-fullscreen="true"]')).toBeVisible();
  const canvas = page.locator('.ink-canvas');
  await drawTouch(page, canvas);
  await expect(page.getByTestId('ink-fullscreen-submit')).toBeEnabled();
  await page.locator('.ink-toolbar .ink-action:not(.ink-fullscreen-submit)').nth(1).click();
  await expect(page.getByTestId('ink-fullscreen-submit')).toBeDisabled();
  expect(await inkPixels(canvas)).toBe(0);
  await withinViewport(page, page.getByTestId('ink-fullscreen-exit'), 'small landscape exit');
  await withinViewport(page, page.getByTestId('ink-fullscreen-submit'), 'small landscape submit');
  await info.attach('fullscreen-platform-result', { contentType: 'application/json', body: JSON.stringify(await page.evaluate(() => ({
    fullscreenEnabled: document.fullscreenEnabled, nativeFullscreen: Boolean(document.fullscreenElement),
    width: innerWidth, height: innerHeight, touchPoints: navigator.maxTouchPoints,
  })), null, 2) });
  await capture(page, 'small-landscape-controls', info);
  await page.getByTestId('ink-fullscreen-exit').click();
  await expect(page.locator('.ink-pad[data-fullscreen="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});
