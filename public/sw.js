/* WriEng's generated, same-origin-only application cache.
 * Build with `node scripts/generate-sw.mjs` after Vite. Do not edit dist/sw.js.
 */
const VERSION = '__WRIENG_CACHE_VERSION__';
const FILES = /* __WRIENG_PRECACHE_FILES__ */ [];
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `wrieng:${SCOPE.pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const FILE_URLS = new Set(FILES.map((file) => new URL(file, SCOPE).href));
const SHELL_URL = new URL('index.html', SCOPE).href;

async function status(target) {
  // Read without opening: a retiring worker must never recreate its old cache.
  const entries = await Promise.all(FILES.map((file) => caches.match(new URL(file, SCOPE).href, { cacheName: CACHE_NAME })));
  const cachedFiles = entries.filter(Boolean).length;
  const message = {
    type: 'WRIENG_OFFLINE_STATUS',
    version: VERSION,
    offlineReady: FILES.length > 0 && cachedFiles === FILES.length,
    cachedFiles,
  };
  if (target) target.postMessage(message);
  else {
    const windows = await self.clients.matchAll({ type: 'window' });
    for (const window of windows) window.postMessage(message);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (!FILES.length || VERSION.startsWith('__')) {
      throw new Error('WriEng offline cache requires a production build.');
    }
    try {
      const cache = await caches.open(CACHE_NAME);
      // addAll commits the request batch only if every response succeeds.
      await cache.addAll(FILES.map((file) => new Request(new URL(file, SCOPE), { cache: 'reload' })));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // An existing version remains active until the user accepts the update.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
    await status();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'WRIENG_ACTIVATE_UPDATE') {
    // Do not extend this message event with skipWaiting's promise: Chromium
    // can remain "activating" while it waits for that same event to finish.
    self.skipWaiting();
  } else if (event.data?.type === 'WRIENG_GET_OFFLINE_STATUS') {
    event.waitUntil(status(event.ports?.[0] || event.source));
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  if (request.mode === 'navigate') {
    // Use one consistent, completely cached build, including after a reload.
    event.respondWith((async () => {
      return (await caches.match(SHELL_URL, { cacheName: CACHE_NAME })) || fetch(request);
    })());
    return;
  }

  const canonical = new URL(url.href);
  canonical.search = '';
  canonical.hash = '';
  if (!FILE_URLS.has(canonical.href)) return;
  event.respondWith((async () => {
    return (await caches.match(canonical.href, { cacheName: CACHE_NAME })) || fetch(request);
  })());
});
