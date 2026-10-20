import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppData, AttemptEvent } from '../src/engine';

// The answer oracle reads the shipped dictionary/seed data outside the page.
// Expected answers never enter placement DOM attributes or visible hints.
const terms = new Map<string, string>();
const core = JSON.parse(readFileSync(resolve('src/content/core-lexicon.json'), 'utf8'));
for (const entry of core.entries) terms.set(entry.id, entry.term);
for (const file of readdirSync(resolve('src/content')).filter(file => file.endsWith('.ts'))) {
  const text = readFileSync(resolve('src/content', file), 'utf8');
  for (const match of text.matchAll(/term:\s*'((?:\\.|[^'])*)',\s*partOfSpeech:\s*'([^']+)'/g)) {
    const term = match[1].replace(/\\(['\\])/g, '$1');
    terms.set(`${term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${match[2].replace(/[^a-z]+/g, '')}-1`, term);
  }
}

async function state(page: Page): Promise<AppData> {
  return page.evaluate(() => new Promise<AppData>((resolve, reject) => {
    const request = indexedDB.open('wrieng-learning', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction('app', 'readonly');
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
      const database = request.result, transaction = database.transaction('app', 'readwrite');
      transaction.objectStore('app').put(data, 'state');
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), data);
}

const currentId = async (page: Page) => {
  const data = await state(page);
  return data.session?.queue[data.session.index];
};

async function openStudy(page: Page) {
  await page.goto('./');
  await expect.poll(async () => await page.getByTestId('placement-dialog').isVisible()
    || await page.getByTestId('study-word').isVisible()).toBe(true);
  if (await page.getByTestId('placement-dialog').isVisible()) await page.getByTestId('placement-later').click();
  await expect(page.getByTestId('study-word')).toBeVisible();
  await expect.poll(async () => Boolean((await state(page))?.session)).toBe(true);
}

async function settings(page: Page) {
  await page.locator('.cyber-tools-button').click();
  await expect(page.locator('.cyber-settings')).toBeVisible();
}

async function pressStudy(page: Page, key: string) {
  await page.locator('.cyber-study').focus();
  await page.keyboard.press(key);
}

async function capture(page: Page, name: string, info: TestInfo) {
  await info.attach(name, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  (page as Page & { learningErrors?: string[] }).learningErrors = errors;
});
test.afterEach(async ({ page, browser }, info) => {
  const errors = (page as Page & { learningErrors?: string[] }).learningErrors || [];
  await info.attach('isolated-learning-environment', { contentType: 'application/json', body: JSON.stringify({
    browser: browser.version(), headless: true, profile: 'new Playwright temporary profile', url: page.url(), errors,
  }, null, 2) });
  expect(errors).toEqual([]);
});

test('D skips without mastery and B reads previous words without recording a practice attempt', async ({ page }) => {
  await openStudy(page);
  const first = (await page.getByTestId('study-word').innerText()).trim(), firstId = await currentId(page);
  const history = await state(page);
  await pressStudy(page, 'd');
  await expect.poll(() => currentId(page)).not.toBe(firstId);
  const second = (await page.getByTestId('study-word').innerText()).trim(), secondId = await currentId(page);
  await pressStudy(page, 'd');
  await expect.poll(() => currentId(page)).not.toBe(secondId);
  const thirdId = await currentId(page);
  await pressStudy(page, 'b');
  await expect(page.getByTestId('previous-word')).toBeVisible();
  await expect(page.getByTestId('previous-word-term')).toContainText(second);
  await expect(page.getByTestId('previous-word').locator('canvas,input,.cyber-grade-buttons')).toHaveCount(0);
  await page.keyboard.press('b');
  await expect(page.getByTestId('previous-word-term')).toContainText(first);
  await expect(page.getByTestId('previous-word-older')).toBeDisabled();
  // D while reading history returns to the live card without skipping it.
  await page.keyboard.press('d');
  await expect(page.getByTestId('previous-word')).toHaveCount(0);
  expect(await currentId(page)).toBe(thirdId);
  const after = await state(page);
  expect(after.events).toEqual(history.events);
  expect(after.progress).toEqual(history.progress);
});

test('D and B ignore typing, contenteditable, IME, modifiers, repeats and modal dialogs', async ({ page }) => {
  await openStudy(page);
  const original = await currentId(page);
  await pressStudy(page, 'd'); // Ensure a previous word exists, so a leaked B is observable.
  await expect.poll(() => currentId(page)).not.toBe(original);
  const id = await currentId(page), before = await state(page);
  await page.locator('.cyber-stage-study .cyber-actions button').first().click();
  await page.locator('.cyber-mode-tabs button').nth(1).click();
  const input = page.locator('.cyber-recall-input');
  await input.fill('');
  await input.press('d'); await input.press('b');
  await expect(input).toHaveValue('db');
  await page.evaluate(() => {
    const textarea = document.createElement('textarea'); textarea.dataset.keyGuard = 'textarea';
    const editable = document.createElement('div'); editable.contentEditable = 'true'; editable.dataset.keyGuard = 'editable';
    Object.assign(editable.style, { minHeight: '40px' });
    document.body.append(textarea, editable);
  });
  for (const target of ['textarea', 'editable']) {
    const field = page.locator(`[data-key-guard="${target}"]`);
    await field.focus(); await field.press('d'); await field.press('b');
    if (target === 'textarea') await expect(field).toHaveValue('db');
    else await expect(field).toHaveText('db');
  }
  await page.locator('.cyber-study').focus();
  await page.evaluate(() => {
    for (const extra of [{ isComposing: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { repeat: true }]) {
      for (const key of ['d', 'b']) document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, bubbles: true, ...extra }));
    }
  });
  expect(await currentId(page)).toBe(id);
  await expect(page.getByTestId('previous-word')).toHaveCount(0);
  await settings(page);
  await page.locator('.cyber-close').focus();
  await page.keyboard.press('d'); await page.keyboard.press('b');
  await expect(page.locator('.cyber-drawer')).toBeVisible();
  expect(await currentId(page)).toBe(id);
  expect((await state(page)).events).toEqual(before.events);
});

async function instrumentSilentAudio(page: Page) {
  await page.addInitScript(() => {
    const probe = { contexts: 0, starts: 0, resumes: 0, values: [] as number[] };
    (window as Window & { audioProbe?: typeof probe }).audioProbe = probe;
    class Parameter {
      value = 0;
      setValueAtTime(value: number) { this.value = value; probe.values.push(value); return this; }
      linearRampToValueAtTime(value: number) { return this.setValueAtTime(value); }
      exponentialRampToValueAtTime(value: number) { return this.setValueAtTime(value); }
      setTargetAtTime(value: number) { return this.setValueAtTime(value); }
      cancelScheduledValues() { return this; }
      cancelAndHoldAtTime() { return this; }
    }
    class SilentContext {
      state = 'suspended'; currentTime = 1; destination = {};
      constructor() { probe.contexts++; }
      async resume() { probe.resumes++; this.state = 'running'; }
      async close() { this.state = 'closed'; }
      createGain() { return { gain: new Parameter(), connect() {}, disconnect() {} }; }
      createOscillator() { return { type: 'sine', frequency: new Parameter(), onended: null,
        connect() {}, disconnect() {}, start() { probe.starts++; }, stop() {} }; }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: SilentContext });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: SilentContext });
  });
}

async function audio(page: Page) {
  return page.evaluate(() => (window as Window & { audioProbe?: { contexts: number; starts: number; resumes: number; values: number[] } }).audioProbe!);
}

async function volume(page: Page, value: number) {
  await page.getByTestId('sound-volume').evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect.poll(async () => (await state(page)).settings.soundVolume).toBe(value / 100);
}

test('quiet sound never autoplays, volume and mute persist, and muted shortcuts stay silent', async ({ page }) => {
  await instrumentSilentAudio(page);
  await page.goto('./');
  await expect(page.getByTestId('placement-dialog')).toBeVisible();
  expect(await audio(page)).toMatchObject({ contexts: 0, starts: 0, resumes: 0 });
  await page.getByTestId('placement-later').click();
  await expect(page.getByTestId('study-word')).toBeVisible();
  expect((await state(page)).settings.soundVolume).toBe(0.12);
  await settings(page);
  await volume(page, 25);
  await page.getByTestId('sound-preview').click();
  await expect.poll(async () => (await audio(page)).starts).toBeGreaterThan(0);
  const played = await audio(page);
  // The frequency parameter is also instrumented, so inspect only gain-sized values.
  expect(Math.max(...played.values.filter(value => value > 0 && value < 1))).toBeLessThanOrEqual(0.18 * 0.25 + 0.00001);
  await page.getByTestId('sound-muted').check();
  await expect.poll(async () => (await state(page)).settings.soundEnabled).toBe(false);
  const starts = (await audio(page)).starts;
  await page.locator('.cyber-close').click();
  const id = await currentId(page);
  await pressStudy(page, 'd');
  await expect.poll(() => currentId(page)).not.toBe(id);
  expect((await audio(page)).starts).toBe(starts);
  await page.reload();
  await expect(page.getByTestId('study-word')).toBeVisible();
  expect(await audio(page)).toMatchObject({ contexts: 0, starts: 0, resumes: 0 });
  expect((await state(page)).settings).toMatchObject({ soundEnabled: false, soundVolume: 0.25 });
  await settings(page);
  await expect(page.getByTestId('sound-muted')).toBeChecked();
  await page.getByTestId('sound-muted').uncheck();
  await volume(page, 0);
  await page.locator('.cyber-close').click();
  const current = await currentId(page);
  await pressStudy(page, 'd');
  await expect.poll(() => currentId(page)).not.toBe(current);
  expect((await audio(page)).starts).toBe(0);
});

test('first-use assessment can be deferred, persists that choice, and can be reopened', async ({ page }, info) => {
  await page.goto('./');
  await expect(page.getByTestId('placement-intro')).toBeVisible();
  await capture(page, 'first-use-placement-intro', info);
  await page.getByTestId('placement-later').click();
  await expect(page.getByTestId('study-word')).toBeVisible();
  const deferred = await state(page);
  expect(deferred.settings.vocabularyProfile).toMatchObject({ status: 'skipped', sampleSize: 0 });
  expect(deferred.events).toEqual([]); expect(deferred.progress).toEqual({});
  await page.reload();
  await expect(page.getByTestId('study-word')).toBeVisible();
  await expect(page.getByTestId('placement-dialog')).toHaveCount(0);
  await settings(page);
  await page.getByTestId('placement-retest').click();
  await expect(page.getByTestId('placement-intro')).toBeVisible();
  await page.getByTestId('placement-later').click();
  expect((await state(page)).events).toEqual([]);
});

for (const correct of [true, false]) {
  test(`ten typed placement answers adapt ${correct ? 'upward' : 'downward'} without practice credit`, async ({ page }, info) => {
    await page.goto('./');
    await expect(page.getByTestId('placement-intro')).toBeVisible();
    await page.getByTestId('placement-start').click();
    const asked: { id: string; band: number }[] = [];
    for (let index = 0; index < 10; index++) {
      const question = page.getByTestId('placement-question');
      await expect(question).toBeVisible();
      const id = (await question.getAttribute('data-word-id'))!, band = Number(await question.getAttribute('data-band'));
      const term = terms.get(id);
      expect(term, `Known source answer for ${id}`).toBeTruthy();
      expect(asked.map(item => item.id)).not.toContain(id);
      asked.push({ id, band });
      await expect(page.getByTestId('placement-answer')).toHaveValue('');
      await page.getByTestId('placement-answer').fill(correct ? term! : 'definitely-not-the-answer');
      await page.getByTestId('placement-submit').click();
      if (index < 9) await expect(question).not.toHaveAttribute('data-word-id', id);
    }
    await expect(page.getByTestId('placement-result')).toBeVisible();
    expect(new Set(asked.map(item => item.band)).size).toBeGreaterThanOrEqual(3);
    expect(asked.slice(0, 3).map(item => item.band)).toEqual([0, 2, 4]);
    expect(asked.at(-1)?.band).toBe(correct ? 4 : 0);
    const before = await state(page);
    expect(before.events).toEqual([]); expect(before.progress).toEqual({});
    await capture(page, `placement-${correct ? 'high' : 'low'}-result`, info);
    await page.getByTestId('placement-apply').click();
    await expect(page.getByTestId('placement-dialog')).toHaveCount(0);
    const after = await state(page);
    expect(after.settings.vocabularyProfile).toMatchObject({ status: 'completed', sampleSize: 10,
      correct: correct ? 10 : 0, targetBand: correct ? 4 : 0 });
    expect(after.events).toEqual([]); expect(after.progress).toEqual({});
    expect(after.settings.selectedDecks).toEqual(before.settings.selectedDecks);
    await expect(page.getByTestId('recommendation-reason')).toBeVisible();
    await info.attach('adaptive-question-bands', { contentType: 'application/json', body: JSON.stringify({ correct, asked, profile: after.settings.vocabularyProfile }, null, 2) });
  });
}

function historicalEvent(id: string, wordId: string, at: number): AttemptEvent {
  return { id, wordId, mode: 'typed', result: 'incorrect', requestedRating: 'again', effectiveRating: 'again',
    hinted: false, revealed: false, retry: false, firstAttempt: true, firstAttemptId: id, sessionId: 'historical-fixture',
    roundId: id, startedAt: at - 2000, submittedAt: at - 1000, at, timezone: 'UTC', localDay: new Date(at).toISOString().slice(0, 10),
    schedulerVersion: 'ts-fsrs-5.4.2-fsrs6-wrieng-v2', parameterSetId: 'wrieng-fsrs6-retention90-v1', answer: 'old-miss', hasInk: false };
}

async function historicalState(page: Page, profile: boolean) {
  await openStudy(page);
  const current = await state(page), at = Date.now() - 2 * 86400000;
  const data: AppData = { ...current, session: null, progress: {}, legacyScheduleAnchors: {}, events: [
    historicalEvent('inside-daily-history', 'receipt-noun-1', at),
    historicalEvent('outside-gre-history', 'pragmatic-adjective-1', at + 1000),
  ], settings: { ...current.settings, selectedDecks: ['daily'], onboardingComplete: false,
    vocabularyProfile: profile ? { version: 1, status: 'completed', targetBand: 4, rangeLow: 3, rangeHigh: 4,
      sampleSize: 10, correct: 10, bandsTested: [0, 2, 4], assessedAt: Date.now() } : null } };
  if (!profile) {
    delete data.settings.vocabularyProfile;
    delete data.settings.soundVolume;
    delete data.settings.difficultyAdjustment;
  }
  await writeState(page, data); await page.reload();
  await expect(page.getByTestId('recall-prompt')).toBeVisible();
  return data;
}

test('existing learning history opens normally without forcing a new assessment or changing events', async ({ page }) => {
  const historical = await historicalState(page, false);
  await expect(page.getByTestId('placement-dialog')).toHaveCount(0);
  const loaded = await state(page);
  expect(loaded.events).toEqual(historical.events);
  expect(Object.keys(loaded.progress).sort()).toEqual(['pragmatic-adjective-1', 'receipt-noun-1']);
  expect(loaded.settings.soundVolume).toBe(0.12);
  expect(loaded.settings.difficultyAdjustment).toBe(0);
});

test('recommendations keep due weak words inside the manual library and difficulty changes preserve history', async ({ page }) => {
  const historical = await historicalState(page, true);
  const before = await state(page);
  expect(await currentId(page)).toBe('receipt-noun-1');
  expect(before.session?.queue).not.toContain('pragmatic-adjective-1');
  expect(before.progress['receipt-noun-1'].lastRating).toBe('again');
  expect(before.progress['pragmatic-adjective-1'].dueAt).toBeLessThan(Date.now());
  await expect(page.getByTestId('recommendation-reason')).toBeVisible();
  await settings(page);
  await page.getByTestId('difficulty-adjustment').selectOption('-1');
  await expect.poll(async () => (await state(page)).settings.difficultyAdjustment).toBe(-1);
  await page.locator('.cyber-close').click();
  const after = await state(page);
  expect(after.settings.selectedDecks).toEqual(['daily']);
  expect(after.settings.vocabularyProfile).toEqual(before.settings.vocabularyProfile);
  expect(after.events).toEqual(historical.events); expect(after.progress).toEqual(before.progress);
  expect(after.session?.queue).not.toContain('pragmatic-adjective-1');
  await page.reload();
  expect((await state(page)).settings.difficultyAdjustment).toBe(-1);
});
