// Native SVG rasterization using the already installed Windows Chrome.
// Run: node scripts/render-icons.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = process.env.WRIENG_CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync);
assert(executablePath && existsSync(executablePath), 'An existing Chrome installation is required; no browser is downloaded.');
const source = await readFile(resolve(root, 'public/icon.svg'));
const browser = await chromium.launch({ executablePath, headless: true });
const generated = [];
try {
  for (const size of [192, 512]) {
    const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await page.setContent(`<html><head><style>html,body{width:100%;height:100%;margin:0;background:transparent}img{display:block;width:100%;height:100%}</style></head><body><img alt="WriEng" src="data:image/svg+xml;base64,${source.toString('base64')}"></body></html>`);
      await page.locator('img').evaluate(image => image.decode());
      const path = resolve(root, `public/icon-${size}.png`);
      const png = await page.screenshot({ path, type: 'png', omitBackground: true, animations: 'disabled' });
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
      generated.push({ file: `public/icon-${size}.png`, width: size, height: size, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ renderer: `Installed Chrome ${browser.version()}`, svgSha256: createHash('sha256').update(source).digest('hex'), generated }, null, 2));
} finally { await browser.close(); }
