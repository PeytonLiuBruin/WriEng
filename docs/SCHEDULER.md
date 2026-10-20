# WriEng FSRS scheduling, evidence, and migration

WriEng schema 2 uses **ts-fsrs 5.4.2**, implementing **FSRS-6**, under the MIT license. New events identify the exact integration as `ts-fsrs-5.4.2-fsrs6-wrieng-v2`. The production dependency is pinned in the lockfile. The former `wrieng-interval-v1` rules remain only as frozen historical replay logic; old events are never relabeled as FSRS reviews.

Official references: [package and API](https://github.com/open-spaced-repetition/ts-fsrs/tree/main/packages/fsrs), [upstream API documentation](https://open-spaced-repetition.github.io/ts-fsrs/), and [MIT license](https://github.com/open-spaced-repetition/ts-fsrs/blob/main/LICENSE). Implementation uses `createEmptyCard`, `fsrs(parameters)`, and `scheduler.next(card, assessmentTime, rating)`. The app does not implement its own replacement memory formula or run a parameter-training service.

## Fixed parameters and actual intervals

Parameter set `wrieng-fsrs6-retention90-v1` is stored in every schema-2 app state. Each new event also references that parameter-set ID. The complete snapshot, including all 21 weights, is serialized and checked on import:

```json
{
  "request_retention": 0.9,
  "maximum_interval": 36500,
  "enable_fuzz": false,
  "enable_short_term": true,
  "learning_steps": ["10m"],
  "relearning_steps": ["10m"],
  "w": [0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542]
}
```

These are pinned package weights, not individually optimized WriEng learner parameters. Retention 0.9 is a scheduling target, not a measured 90% success rate or a mastery claim. No long-term WriEng learning-effect trial has been conducted. The current UI supports Again, Hard, and Good; the library's Easy rating is not exposed.

For a new card with these parameters, actual library output is Again in 10 minutes, Hard in 15 minutes, and Good in 2 days. Later intervals depend on the card state, elapsed time, rating, and FSRS calculations; they do not follow the former fixed 1/3/7-day ladder. `previewIntervals(progress, now)` returns actual due timestamps for UI labels. Fuzz is disabled for reproducible replay. A failure, hint, early answer reveal, or immediate retry forces the effective FSRS rating to Again. Hard is reserved for unaided but effortful recall.

## Immutable recall evidence

Each event retains its unique ID, sense-level word ID, start (`startedAt`), original submission (`submittedAt`), assessment (`at`), mode, result, requested/effective ratings, assistance/retry flags, original-attempt link, timezone, and local-day snapshot. `startedAt ≤ submittedAt ≤ at`; an omitted submission input defaults to assessment time. Older v1 exports without that field import with `submittedAt = at`, without changing their recorded start or assessment times or inventing a more precise submission time. The exact original envelope remains available in the upgrade backup.

Typed submissions retain the original text (at most 500 characters). Handwriting retains stroke-presence evidence and an explicitly self-rated result, not an OCR confidence or an automatically verified answer. Images are not part of the learning history. A normal answer reveal after submission is not an early-reveal flag. Corrections append separate evidence and never replace the first error. Duplicate event IDs do not advance a card. Typed first-attempt correctness and handwriting self-assessment remain distinct statistics.

The session persists its submitted response and feedback stage before rating confirmation. Reload must resume that pending assessment. The UI recomputes typed correctness against the current sense and cannot turn an imported `correct` boolean into learning evidence by itself.

## Versioned replay and preserving existing appointments

Events replay in `(at, ordinal event ID)` order, independently of import order and machine locale. A legacy event uses its recorded effective rating and the frozen v1 policy: Again 10 minutes; Hard at least 1 day and previous interval ×1.2 capped at 30; Good 1/3/7/14/30/60/120/240/365 days, never shortening its previous interval. Historical v1 assisted-Hard events from the earliest v1 build are preserved as recorded; the stricter current assistance policy is applied only to new events.

During schema migration, a saved old progress appointment is retained in `legacyScheduleAnchors`, keyed by its legacy event ID. An anchor must reference an actual v1 event with the same sense and recorded last-review time. Its due date must be a valid timestamp from that event through the old policy's 365-day maximum. Unlinked progress claims cannot create events, good counts, or mastery. Earlier copies of an old backup cannot bring a preserved old appointment forward; for the same anchor the later valid saved due date wins. A subsequent new assessment supersedes that old appointment normally.

In parallel, historical ratings seed a model state through the pinned FSRS library. This is explicitly marked `fsrsOrigin: legacy-ratings-replay`: it is an initialization estimate from old evidence, not a claim that FSRS originally produced those reviews. Its `due` is set to the preserved old appointment; other internal memory fields come from FSRS replay. The first genuinely new review uses `scheduler.next` with that state and is marked `fsrsOrigin: fsrs-review`. Mixed-version histories therefore replay without changing the meaning or version of old events.

`WordProgress` preserves `dueAt`, `intervalDays`, `lastReviewedAt`, `lastEventId`, `lastRating`, and `firstSeenAt` for UI compatibility. Its compatibility counters remain an application good streak (`repetitions`) and Again count (`lapses`); the actual model counters are `fsrsCard.reps` and `fsrsCard.lapses`. `fsrsCard` stores due, last-review time, stability, difficulty, state, learning step, elapsed/scheduled days, and library repetition/lapse counts. Dates serialize as UTC epoch milliseconds; no JavaScript Date object or timezone-dependent midnight is persisted.

## Atomic migration, automatic backup, and explicit recovery

The IndexedDB database remains `wrieng-learning`, version 1, object store `app`; the persisted application envelope moves to schema 2. A readwrite transaction validates an old state, stores the exact original envelope under `pre-fsrs-v1-backup` if no earlier upgrade backup exists, and then writes schema 2. The same protection applies to importing an old JSON file into a fresh v2 database. A failed backup or state write rolls the whole transaction back. Reopening never replaces the first upgrade snapshot. Old v1 clients reject the unfamiliar schema instead of overwriting it.

`getMigrationBackupInfo()` returns `{available, createdAt, sourceSchema}`. `exportMigrationBackup()` returns the original schema-0/1 JSON or null; the UI offers this download without automatically restoring anything.

`restoreMigrationBackup()` is an explicit API, not a migration step or an automatic UI action. Before replacing current learning state, it keeps that current envelope in `before-migration-backup-restore`; `exportRestoreSafetyBackup()` can export that safety snapshot. Restoration returns a schema-2 compatible envelope derived from the old backup, with its original evidence, settings, session, and due appointments. The original upgrade backup remains unchanged. A failed restoration leaves current state intact. The normal UI does not expose an overwrite-restore button.

## Queue, persistence, and import bounds

Due reviews come first, earliest due first. New introductions follow content order within the remaining daily cap (default 10, validated 0–100), across all decks. Future reviews are omitted. Current-day limits use the selected timezone; original event timezone/day evidence and absolute due times remain preserved.

A single transaction saves an event with its updated model state. Concurrent writes serialize; duplicate submissions are idempotent. Saving a stale snapshot merges immutable events instead of erasing newer evidence. Import validates the whole JSON, scheduler version/parameters, event evidence, anchor relationships, and session fields before committing a merge. Events are the source of truth; imported model/progress claims are rebuilt. Unknown future algorithms or parameter sets are rejected instead of replayed under guessed defaults.

Compact import/export limits are 100 MB UTF-8 file bytes and 50,000 merged unique events, whichever comes first. Each resulting state is checked against the same export limit before commit. Sessions allow 10,000 sense IDs and 1 MB JSON; known draft fields are strings up to 500 characters, evidence flags are booleans, and times must follow session start and be no more than five minutes ahead of the current clock. Browser storage failures surface visibly; there is no silent volatile-memory fallback. Backups contain personal typed responses. Progress is local to the browser profile and origin, with no cloud synchronization.

## Verification and fixture

`src/fixtures/v1-progress.json` is a real v1-format import fixture with an original typed failure, a handwritten self-assessment, separate submission/assessment timestamps, and legacy due dates. Tests cover frozen v1 replay, direct equality with pinned FSRS output, full parameter persistence, duplicate/tie ordering, assistance clamps, queue/DST/day caps, actual IndexedDB v1→v2 migration and exact backup, refresh, mixed-version JSON merges, preserved old appointments, new FSRS reviews, invalid anchors/parameters, atomic quota failure, explicit recovery safety snapshots, and 50,000-event merge limits. Structural and scheduling tests do not prove learning efficacy or pronunciation accuracy.
