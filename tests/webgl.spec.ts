import { test, expect, chromium, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const screenshots = resolve('docs/screenshots-v2');
const navigation = (page: Page) => page.getByRole('navigation', { name: '主要导航' });
const map = (page: Page) => page.getByTestId('journey-map');
const canvas = (page: Page) => page.getByTestId('journey-webgl');

async function openMap(page: Page) {
  await page.goto('/');
  await expect(page.locator('.hero-actions .primary')).toBeEnabled();
  await navigation(page).getByRole('button', { name: '旅程地图', exact: true }).click();
  await expect(map(page)).toBeVisible();
}

async function ready3D(page: Page) {
  await expect(map(page)).toHaveAttribute('data-mode', '3d', { timeout: 20_000 });
  await expect(canvas(page)).toHaveAttribute('data-renderer', 'webgl2');
  await expect.poll(async () => Number(await canvas(page).getAttribute('data-frame-count'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await canvas(page).getAttribute('data-draw-calls'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await canvas(page).getAttribute('data-triangles'))).toBeGreaterThan(0);
}

async function capture(page: Page, name: string, info: TestInfo) {
  await mkdir(screenshots, { recursive: true });
  const path = resolve(screenshots, `${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}

test.beforeEach(async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  (page as Page & { qaErrors?: string[] }).qaErrors = pageErrors;
});
test.afterEach(async ({ page }, info) => {
  const errors = (page as Page & { qaErrors?: string[] }).qaErrors || [];
  await info.attach('webgl-page-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
  expect(errors, 'No uncaught errors during WebGL or fallback lifecycle').toEqual([]);
});

test('real WebGL2 renders triangles; orbit drag, wheel zoom, reset and node selection work', async ({ page }, info) => {
  await openMap(page);
  await ready3D(page);
  const renderer = canvas(page);
  const original = await renderer.getAttribute('data-camera');
  await renderer.scrollIntoViewIfNeeded();
  const box = (await renderer.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.62, { steps: 14 });
  await page.mouse.up();
  await expect.poll(() => renderer.getAttribute('data-camera')).not.toBe(original);
  const afterDrag = await renderer.getAttribute('data-camera');
  await page.mouse.wheel(0, -260);
  await expect.poll(() => renderer.getAttribute('data-camera')).not.toBe(afterDrag);
  const beforeButtonZoom = await renderer.getAttribute('data-camera');
  await map(page).getByRole('button', { name: '放大地图', exact: true }).click();
  await expect.poll(() => renderer.getAttribute('data-camera')).not.toBe(beforeButtonZoom);
  await map(page).getByRole('button', { name: '重置视角', exact: true }).click();
  await expect.poll(() => renderer.getAttribute('data-camera')).toBe(original);

  const nodes = map(page).locator('[data-testid^="journey-menu-"]');
  await expect(nodes).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await nodes.nth(index).click();
    await expect(nodes.nth(index)).toHaveAttribute('aria-pressed', 'true');
    await expect(map(page).locator('[data-testid^="journey-menu-"][aria-pressed="true"]')).toHaveCount(1);
    await expect(map(page).locator('[data-testid^="journey-node-"]').nth(index)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.waitForTimeout(600);
  const idleFrames = await renderer.getAttribute('data-frame-count');
  await page.waitForTimeout(220);
  expect(await renderer.getAttribute('data-frame-count'), 'Idle scene does not submit continuous frames').toBe(idleFrames);
  await info.attach('renderer-diagnostics', {
    body: JSON.stringify(await renderer.evaluate(element => ({ ...((element as HTMLElement).dataset) })), null, 2),
    contentType: 'application/json',
  });
  await capture(page, '12-webgl-orbit-map', info);
});

test('WebGL context loss changes to the usable two dimensional map', async ({ page }, info) => {
  await openMap(page);
  await ready3D(page);
  const supported = await canvas(page).evaluate(element => {
    const gl = (element as HTMLCanvasElement).getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(supported, 'Use a real WEBGL_lose_context extension, rather than a synthetic loss event').toBe(true);
  await expect(map(page)).toHaveAttribute('data-mode', '2d');
  await expect(map(page)).toHaveAttribute('data-reason', 'context-lost');
  await expect(canvas(page)).toHaveCount(0);
  const nodes = map(page).locator('[data-testid^="journey-menu-"]');
  await expect(nodes).toHaveCount(4);
  await nodes.last().click();
  await expect(nodes.last()).toHaveAttribute('aria-pressed', 'true');
  await capture(page, '13-context-loss-fallback', info);
});

test('system reduced motion uses 2D without requesting the Three renderer chunk', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMap(page);
  await expect(map(page)).toHaveAttribute('data-mode', '2d');
  await expect(map(page)).toHaveAttribute('data-reason', 'reduced-motion');
  await expect(canvas(page)).toHaveCount(0);
  const requests = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  expect(requests.some(url => /WorldScene-[^/]+\.js/.test(url))).toBe(false);
  await info.attach('resources-with-reduced-motion', { body: JSON.stringify(requests, null, 2), contentType: 'application/json' });
  await capture(page, '14-reduced-motion-2d', info);
});

test('visibility handler stops frames while hidden and renderer unmounts before practice', async ({ page }, info) => {
  await openMap(page);
  await ready3D(page);
  await canvas(page).evaluate(element => {
    // Headless Chrome reports all tabs visible, even after bringToFront.
    // This explicitly exercises the visibility event handler, not a real hidden tab.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(canvas(page)).toHaveAttribute('data-paused', 'true');
  const frames = await canvas(page).getAttribute('data-frame-count');
  await map(page).getByRole('button', { name: '放大地图', exact: true }).click();
  await page.waitForTimeout(220);
  expect(await canvas(page).getAttribute('data-frame-count')).toBe(frames);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'visibilityState');
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(canvas(page)).toHaveAttribute('data-paused', 'false');
  await expect.poll(async () => Number(await canvas(page).getAttribute('data-frame-count'))).toBeGreaterThan(Number(frames));
  await info.attach('visibility-method', { body: 'Simulated document.visibilityState/hidden getters plus a synthetic visibilitychange event. Frames remained unchanged for 220 ms, including a zoom request, and resumed afterward. Headless tab visibility is not represented as a real background-tab measurement.', contentType: 'text/plain' });

  await page.getByRole('button', { name: /回到今日投递|返回今日投递/ }).click();
  const plan = page.getByRole('dialog', { name: /给自己的学习计划/ });
  if (await plan.isVisible()) {
    await plan.getByRole('button', { name: '美国日常', exact: true }).click();
    await plan.getByRole('button', { name: '保存我的计划' }).click();
    await page.getByRole('button', { name: /开始今日投递|回到今日投递|返回今日投递/ }).click();
  }
  await expect(page.getByRole('dialog', { name: '今日投递练习' })).toBeVisible();
  await expect(canvas(page)).toHaveCount(0);
  await expect(map(page)).toHaveCount(0);
});

test('home and first recall do not load the Three renderer', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('.hero-actions .primary')).toBeEnabled();
  await expect(canvas(page)).toHaveCount(0);
  await page.getByRole('button', { name: '开始今日投递', exact: true }).click();
  const plan = page.getByRole('dialog', { name: /给自己的学习计划/ });
  await plan.getByRole('button', { name: '美国日常', exact: true }).click();
  await plan.getByRole('button', { name: '保存我的计划' }).click();
  await page.getByRole('button', { name: '开始今日投递', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '今日投递练习' })).toBeVisible();
  await expect(canvas(page)).toHaveCount(0);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  expect(resources.some(url => /WorldScene-[^/]+\.js/.test(url))).toBe(false);
  await info.attach('first-recall-resources', { body: JSON.stringify(resources, null, 2), contentType: 'application/json' });
});

test('disabled WebGL provides four usable fallback nodes with no renderer', async ({}, info) => {
  const inherited = info.project.use.launchOptions || {};
  const browser = await chromium.launch({ ...inherited, headless: true, args: [...(inherited.args || []), '--disable-webgl'] });
  try {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, locale: 'zh-CN', timezoneId: 'UTC' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await openMap(page);
    await expect(map(page)).toHaveAttribute('data-mode', '2d');
    await expect(map(page)).toHaveAttribute('data-reason', 'unavailable');
    await expect(canvas(page)).toHaveCount(0);
    const nodes = map(page).locator('[data-testid^="journey-menu-"]');
    await expect(nodes).toHaveCount(4);
    await nodes.nth(2).click();
    await expect(nodes.nth(2)).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
    await capture(page, '15-webgl-disabled-fallback', info);
  } finally { await browser.close(); }
});

test('journey map fits 320 390 834 and 1440 pixel layouts', async ({ page }, info) => {
  for (const width of [320, 390, 834, 1440]) {
    await page.setViewportSize({ width, height: width >= 834 ? 1100 : 844 });
    await openMap(page);
    await expect(map(page)).toHaveAttribute('data-mode', /^(2d|3d)$/);
    await expect(map(page)).toHaveAttribute('data-reason', /^(ready|reduced-motion|low-power|manual|unavailable)$/, { timeout: 20_000 });
    if (await map(page).getAttribute('data-mode') === '3d') await ready3D(page);
    const toggle = map(page).getByRole('button', { name: /切换为[二三]维地图/ });
    const toggleBox = (await toggle.boundingBox())!;
    expect(toggleBox.width, `${width}px mode toggle width`).toBeGreaterThanOrEqual(44);
    expect(toggleBox.height, `${width}px mode toggle height`).toBeGreaterThanOrEqual(44);
    const markers = map(page).locator('[data-testid^="journey-node-"]:visible');
    const targetEvidence = [];
    for (let index = 0; index < await markers.count(); index += 1) {
      const marker = markers.nth(index);
      await marker.scrollIntoViewIfNeeded();
      const markerBox = (await marker.boundingBox())!;
      expect(markerBox.width, `${width}px marker ${index + 1} width`).toBeGreaterThanOrEqual(44);
      expect(markerBox.height, `${width}px marker ${index + 1} height`).toBeGreaterThanOrEqual(44);
      expect(await marker.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return target === element || element.contains(target);
      }), `${width}px marker ${index + 1} center is not covered`).toBe(true);
      await marker.click();
      await expect(marker).toHaveAttribute('aria-pressed', 'true');
      targetEvidence.push({ testId: await marker.getAttribute('data-testid'), ...markerBox });
    }
    await info.attach(`map-touch-targets-${width}px`, { body: JSON.stringify({ toggle: toggleBox, markers: targetEvidence }, null, 2), contentType: 'application/json' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Journey at ${width}px has no horizontal overflow`).toBe(true);
    const box = (await map(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    await capture(page, `16-map-${width}px`, info);
  }
});
