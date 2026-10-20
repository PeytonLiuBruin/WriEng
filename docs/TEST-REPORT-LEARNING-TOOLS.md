# Shortcuts, quiet audio, placement and recommendations

Validated on 2026-10-20. The source retains the mobile handwriting/fullscreen fixes and the complete existing dictionary.

## Behavior

- Desktop **D** skips the current card without creating an attempt or mastery credit. **B** opens a read-only earlier word; repeated B moves farther back, and D returns to the current card. The current practice component remains mounted, preserving its unfinished input and ink. Read-only navigation does not re-grade, roll back, or increment learning counts.
- Letter shortcuts ignore input, textarea, select, contenteditable and ARIA text controls, IME composition, modifier/repeated/prevented keys, dialogs, popups and native fullscreen. A compact desktop hint explains the keys and counting policy.
- Synthesized sine cues last 55–85 ms with a smooth envelope, bounded gain and 120 ms cooldown. Default volume is **12%**, with persistent mute, volume and preview controls. Loading or changing preferences never creates/resumes audio; explicit click/key handlers do. Pending/active cues are cancelled on mute and cannot pile up. No third-party sound assets or services are used.
- New users can take a **10-question typed recall assessment**, defer it, or re-test later. Restored users retain their work and can opt in through settings. The first three items span available high/middle/low frequency groups; later items follow a bounded staircase. Repeated headwords are avoided. Results stay local until the user applies them and never create practice events.
- The result is a conservative frequency-group starting range with a limited-sample explanation. Frequency is not validated item difficulty, an exam level, or a scientifically precise total vocabulary count.
- Queue selection filters the selected libraries and skipped items, then uses the existing daily quota and due-review scheduler. Due reviews come first, with weak due cards prioritized. New words match the placement range and optional easier/harder adjustment. Further adjustment requires at least six recent independent typed first attempts over three distinct headwords; hints, prior reveals, retries and handwriting self-ratings do not establish spelling mastery. The UI explains the current selection reason. Explicit manual “add next” remains available.
- Volume, difficulty and assessment profiles round-trip through local storage/export/import. Older backups hydrate new defaults while retaining history, and stale/older snapshots do not erase newer preferences. No external AI, account or paid service is required.

## Verified results

- **222 unit/component tests passed** in 11 files, including all prior learning and phone regressions.
- Typecheck and complete `/WriEng/` production build passed.
- **8 existing desktop/browser scenarios**, **8 new learning-tools scenarios**, and **6 phone/fullscreen scenarios** passed against the same final production bundle.
- Browser tests checked D/B counts and conflicts; instrumented audio silence, gain, mute and persistence; deferral/re-test and two real 10-answer adaptive flows; preservation of existing users; recommendation library restrictions; and all prior mobile rotation, ink, touch, clear, submit and fullscreen fallback behavior.
- Final cache version: `938095ffc25b88ae6188`; assets: `index-ppKx5UwC.js` and `index-ChlaHuut.css`.
- Tests use isolated headless Chromium with fresh profiles, including iPhone 13 emulation and genuine CDP touch gestures. No physical phone, Safari engine, or human listening calibration was performed. Existing open application clients must accept the normal update prompt to load the new code.

The one old migration equality expectation was extended with the three new default settings; its original field checks and history assertions remain intact. Existing browser entry helpers explicitly defer the new assessment, and the daily quota locator now uses its accessible label.

## Repeat

```powershell
$env:VITE_BASE_PATH='/WriEng/'
npm test
npm run build
npx playwright test --config=playwright.production.config.ts
$env:WRIENG_PRODUCTION='1'
npx playwright test --config=playwright.learning.config.ts
npx playwright test --config=playwright.mobile.config.ts
```

Set `WRIENG_TEST_URL=https://peytonliubruin.github.io/WriEng/` to exercise the new learning-tools and phone suites on the deployed app with separate temporary profiles. Generated reports/screenshots are not published as application source.
