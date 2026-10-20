# Offline and installation

WriEng uses a production-build service worker on the app's own origin and path. The worker caches the full built application, including the vocabulary bundled into its JavaScript. It does not fetch fonts, lessons, analytics, or other resources from a third-party server. The Vite development server deliberately does not register an offline worker.

The complete runtime vocabulary, including all source-backed core entries, is bundled in the cached JavaScript and remains learnable offline. The separate `data/core-lexicon.json` is a complete audit download for use while connected; it is deliberately excluded from precache to avoid downloading and storing the same dictionary twice. Its public URL is retained. The core manifest and source license notices are still precached. `dist/sw-manifest.json` records this one exact exclusion in `onlineOnly`; no other application resource is excluded by that rule.

Run `node scripts/render-icons.mjs` to reproduce the 192px and 512px PNG icons from the existing native SVG using installed Windows Chrome. The script downloads no browser or images and prints source/output hashes and verified PNG dimensions.

## Run and verify

```powershell
npm install
npm run build
npm run preview -- --host 127.0.0.1
```

Open the local preview address printed by Vite in the Windows browser. Keep the tab open until the app reports that offline resources are ready. The first complete online load is required. `dist/sw-manifest.json` records the exact files, byte sizes, and SHA-256 digests used by that build. The project build command runs `node scripts/generate-sw.mjs` after Vite; run that command manually if invoking Vite directly.

To test, open the browser developer tools, select Network → Offline, then reload the same preview URL. Navigation under this app's scope falls back to its cached application shell. Learning, handwriting, self-assessment, and locally saved progress work without a connection. Speech depends on whether the operating system provides a local English voice; a browser voice backed by a remote service may be unavailable offline. WriEng does not promise speech or speech recognition offline.

The install button is shown only when the browser provides its install event. If no event is available, use the browser's own install/app menu when supported. Installing is optional: the cached website works in a normal tab too. On iOS use Safari's Share → Add to Home Screen after the online load. Service workers require HTTPS or localhost; opening `dist/index.html` as a file will not work.

## Cache and progress are separate

Application resources live in Cache Storage; learning progress lives in IndexedDB. Worker installation only succeeds after all build resources have been cached. A failed installation deletes the incomplete new cache and leaves the previous active version alone. Updates wait for the user to press the update button. That action activates the new build and reloads this page, so complete the current exercise first. Activation cleans only WriEng cache versions belonging to this application scope. It never deletes IndexedDB or resets learning history.

Browser storage can still be cleared by the user, browser cleanup, private browsing, device loss, or storage pressure. Use WriEng's progress export to keep a backup. An installed app is not a cloud sync service; the same browser profile and origin are required to see the same records.

## Integration API

`registerOffline(onState)` returns a promise containing `applyUpdate()`, `checkForUpdate()`, and `dispose()`. The callback reports actual browser connection events and worker cache messages. `offlineReady` becomes true only when the worker confirms its complete cache, while `updateAvailable` means a new worker is waiting. The status is one of `checking`, `installing`, `ready`, `update-ready`, `error`, `unsupported`, or `development`. Call `applyUpdate()` only from an explicit user action. Disposal removes page listeners; it does not unregister the worker or delete stored records.

Build output is local. These steps do not deploy or push anything.

## Browser regression

Run `node tests/pwa-lifecycle.mjs` to exercise the actual service worker against a temporary, local in-memory fixture in a fresh headless browser context. The test covers a complete cache, disconnected deep navigation and reload, a missing-resource update rollback, an update waiting for explicit consent, successful activation and cache cleanup, and retained IndexedDB records. It uses the installed Windows Chrome or Edge when found. To select another existing Chromium executable, set `WRIENG_CHROME_PATH`; otherwise Playwright uses its configured Chromium installation. Restricted Windows sandboxes may require permission for the browser to reach localhost.

This lifecycle regression tests the worker independently; the application's end-to-end tests separately validate its learning screens and progress records.
