# Library switching and mobile handwriting fixes

Validated on 2026-10-20 against the `/WriEng/` production build.

## Behavior

- Changing practice libraries, daily new-word quota, or timezone rebuilds the session immediately. Answers, hints, pending feedback, and ink belong to the old question and are cleared. Attempt history and scheduled progress remain intact.
- Practice queues and due summaries follow the selected libraries, including learned words. Other libraries' history remains saved. Explicit manual “add next” selections still work.
- Loading an older, inconsistent session repairs and saves it before practice becomes available. Serialized settings writes and question-identity checks reject stale responses and grades.
- Handwriting suppresses text selection, callouts, and native dragging only inside the pad. Pointer capture, cancellation, and disabling end the active pointer safely. Ordinary inputs and scrolling outside it retain their browser behavior.
- Fullscreen writing keeps the same canvas and normalized stroke data through viewport changes. It includes exit, undo, clear, and submit, with safe-area padding and visual viewport sizing. Native fullscreen is requested from the user's tap; rejected or unavailable APIs retain the application fullscreen layout.

## Results

- **121/121 unit tests passed**, including the existing 107 and 14 new regressions.
- Typecheck and complete production build passed with `VITE_BASE_PATH=/WriEng/`.
- **8/8 existing browser regressions passed** against the production bundle, including typed/handwritten learning, due reviews, offline refresh, backup import/export, and responsive layouts.
- **6/6 mobile browser regressions passed** against the production bundle using an isolated headless Chromium process, iPhone 13 emulation, touch input, and genuine CDP touch gestures.
- Portrait `390×844`, landscape `844×390`, and small landscape `740×360` were exercised. The large landscape canvas exceeded `700×210` CSS pixels. Ink survived rotation on the same mounted canvas, all controls remained in the viewport, and both native fullscreen and rejected/unavailable API fallback were checked.
- The existing PWA lifecycle regression passed: complete cache, offline deep navigation/reload, incomplete-update rollback, explicit activation, scoped cleanup, and retained IndexedDB.
- Production cache version: `9a5f5c8bbeff5320c760`.

No real phone hardware or Safari engine was tested. Application fullscreen cannot hide browser chrome when native fullscreen is unavailable. Rotation is manual. Existing open clients receive the normal update prompt; applying it reloads the new code while preserving stored learning history.

## Repeat

```powershell
$env:VITE_BASE_PATH='/WriEng/'
npm test
npm run build
npx playwright test --config=playwright.production.config.ts
$env:WRIENG_PRODUCTION='1'
npx playwright test --config=playwright.mobile.config.ts
node tests/pwa-lifecycle.mjs
```

For deployed mobile checks, set `WRIENG_TEST_URL=https://peytonliubruin.github.io/WriEng/` before running the mobile suite. All browser tests use separate temporary profiles and run headlessly. Generated reports and screenshots are excluded from source control.
